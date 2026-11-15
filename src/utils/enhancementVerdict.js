import {
  VERDICTS, isBlank, parseNumber, needsLifeReview, suggestVerdict,
} from './designEnhancement.js';

/**
 * What the Design enhancement result panel shows and sends. Pure, so the rules
 * are tested without React. The server decides in the end (verdictAccess,
 * remarkRule, the due-date rule); this only keeps the form from sending what
 * it would refuse. A blank number is null ("not recorded"), never 0.
 */

// The same rule the sidebar and the app root use for a page id.
export function hasPageAccess(user, pageId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.pageAccess) return true; // null = all pages
  if (user.pageAccess.includes(pageId)) return true;
  // The old 'process-flow' permission grants every flow page.
  return pageId.startsWith('flow-') && user.pageAccess.includes('process-flow');
}

export const canRecordVerdict = (user) => hasPageAccess(user, 'flow-sample-followup');

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// A number with its unit, or "not recorded" for a blank. Never 0 for a blank.
export function showNumber(v, unit) {
  if (v === null || v === undefined || v === '') return 'not recorded';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'not recorded';
  return unit ? `${n} ${unit}` : String(n);
}

// A trial's productivity and recovery as the entry form sends them. `required` is
// true for an OK trial on an enhancement die. Returns { ok, errors, value }.
export function validateTrialNumbers({ productivity, recovery, required, result }) {
  // A failed trial measures nothing: whatever was typed before switching to Not OK is dropped.
  if (result === 'Not OK') return { ok: true, errors: {}, value: { productivity_kgh: null, recovery_pct: null } };
  const errors = {};
  const value = { productivity_kgh: null, recovery_pct: null };
  for (const [key, raw, label, pct] of [
    ['productivity_kgh', productivity, 'Productivity', false],
    ['recovery_pct', recovery, 'Recovery', true],
  ]) {
    if (isBlank(raw)) {
      if (required) errors[key] = `${label} is required for an OK trial`;
      continue;
    }
    const n = parseNumber(raw);
    if (Number.isNaN(n)) errors[key] = `${label} must be a number of 0 or more`;
    else if (pct && n > 100) errors[key] = `${label} cannot be more than 100`;
    else value[key] = n;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, errors: {}, value };
}

// Highest trial_no with result OK, as the server picks the trial a verdict snapshots.
export function latestOkTrial(trials) {
  let best = null;
  for (const t of Array.isArray(trials) ? trials : []) {
    if (t && t.result === 'OK' && (!best || Number(t.trial_no) > Number(best.trial_no))) best = t;
  }
  return best;
}

const snakeOf = (order) => ({ status: order?.STATUS, sample_status: order?.['Sample Status'] });

/**
 * Where the project is, for the panel. `order` is the display-shaped order
 * (STATUS, 'Sample Status'); `row` the stored enhancement row.
 *   cancelled | waiting (sample undecided) | rework (sample Rejected, project open)
 *   trial (verdict owed, sample Approved) | review (life review owed) | done
 */
export function panelStage(row, order) {
  const r = row || {};
  if (String(order?.STATUS || '').toUpperCase() === 'CANCELLED') return 'cancelled';
  if (r.final_verdict) return 'done';
  // A Rejected sample reopens the project, even one already awaiting its life review.
  if (order?.['Sample Status'] === 'Rejected') return 'rework';
  if (r.trial_verdict) return needsLifeReview(r, snakeOf(order)) ? 'review' : 'done';
  return order?.['Sample Status'] === 'Approved' ? 'trial' : 'waiting';
}

/**
 * The three Current / Target / Actual lines. The actual productivity and
 * recovery are the snapshot once a trial verdict exists, otherwise the latest
 * OK trial; the actual failure % exists only after a life review. A failure
 * target of undefined means the assessment is not required.
 */
export function resultRows(row, trials) {
  const r = row || {};
  const latest = latestOkTrial(trials);
  const saved = Boolean(r.trial_verdict);
  return [
    {
      key: 'productivity', name: 'Productivity', unit: 'kg/h',
      current: num(r.baseline_productivity_kgh), target: num(r.target_productivity_kgh),
      actual: saved ? num(r.trial_productivity_kgh) : latest ? num(latest.productivity_kgh) : null,
    },
    {
      key: 'recovery', name: 'Recovery', unit: '%',
      current: num(r.baseline_recovery_pct), target: num(r.target_recovery_pct),
      actual: saved ? num(r.trial_recovery_pct) : latest ? num(latest.recovery_pct) : null,
    },
    {
      key: 'failure', name: 'Die failure', unit: '%',
      current: num(r.baseline_failure_pct),
      target: r.failure_assessment_required ? num(r.target_failure_pct) : undefined,
      actual: num(r.actual_failure_pct),
    },
  ];
}

// The trial-stage suggestion, worked out here for when the server's suggestion
// is the final-stage one (a life review is owed). Same rule as the server's
// trialSuggestion: the latest OK trial against the productivity and recovery
// targets. A Rejected sample is in rework and gets no suggestion (the server
// answers the same).
export function trialSuggestion(row, order, trials) {
  const r = row || {};
  const latest = latestOkTrial(trials);
  if (!latest || order?.['Sample Status'] === 'Rejected') return null;
  return suggestVerdict({
    targets: { productivity: num(r.target_productivity_kgh), recovery: num(r.target_recovery_pct) },
    actuals: { productivity: num(latest.productivity_kgh), recovery: num(latest.recovery_pct) },
  });
}

// Does saving this form overwrite a saved one? Then a reason is needed (admin only).
export function formNeedsReason(form, row) {
  const r = row || {};
  return form === 'trial' ? Boolean(r.trial_verdict) : r.life_review_date != null;
}

// Would saving this trial verdict leave a life review owed? (drives the due-date field)
export function reviewOwedAfter(verdict, row, order) {
  if (!VERDICTS.includes(verdict)) return false;
  return needsLifeReview(
    { trial_verdict: verdict, failure_assessment_required: row?.failure_assessment_required, final_verdict: null },
    snakeOf(order),
  );
}

/**
 * Check the panel's form and build the request body.
 * `form` is 'trial' or 'review'. `values`: { verdict, remark, dueDate, failure, reason }.
 * `suggested` is the server's suggestion (null when there is none).
 */
export function validateVerdictForm({ form, row, order, values, suggested, today }) {
  const v = values || {};
  const errors = {};
  const known = VERDICTS.includes(v.verdict);
  if (!known) errors.verdict = 'Choose a verdict';
  const remark = typeof v.remark === 'string' ? v.remark.trim() : '';
  if (known && v.verdict !== (suggested ?? null) && !remark) {
    errors.remark = 'A remark is required when the verdict differs from the suggestion';
  }
  const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
  if (formNeedsReason(form, row) && !reason) errors.reason = 'Give a reason for this change';

  const body = { verdict: v.verdict };
  if (remark) body.remark = remark;
  if (reason) body.reason = reason;

  if (form === 'review') {
    let failure = null;
    if (isBlank(v.failure)) errors.failure = 'Enter the die failure %';
    else {
      failure = parseNumber(v.failure);
      if (Number.isNaN(failure)) errors.failure = 'Enter a number of 0 or more';
      else if (failure > 100) errors.failure = 'Cannot be more than 100';
    }
    body.actual_failure_pct = failure;
  } else if (reviewOwedAfter(v.verdict, row, order)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate || '')) errors.dueDate = 'Choose the review due date';
    else if (today && v.dueDate < today) errors.dueDate = 'The review date cannot be in the past';
    else body.life_review_due_date = v.dueDate;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, errors: {}, body };
}

/**
 * The explicit close of a project whose Rejected sample will not be reworked:
 * a remark is required. Returns { ok, errors, body }; the body is what the
 * server's trial-verdict endpoint accepts while the sample is Rejected.
 */
export function validateAbandonForm({ row, values }) {
  const remark = typeof values?.remark === 'string' ? values.remark.trim() : '';
  const reason = typeof values?.reason === 'string' ? values.reason.trim() : '';
  const errors = {};
  if (!remark) errors.remark = 'Say why the project is being closed';
  if (row?.trial_verdict && !reason) errors.reason = 'Give a reason for this change';
  if (Object.keys(errors).length) return { ok: false, errors };
  const body = { verdict: 'Not achieved', remark, abandon: true };
  if (reason) body.reason = reason;
  return { ok: true, errors: {}, body };
}

/**
 * Who may close a Rejected project as Not achieved. Anyone who can record a
 * verdict, until a trial verdict exists; after that it overwrites a saved
 * verdict, which is admin-only and needs a reason (the server's redo rule).
 */
export function closeRejectedAccess(user, row) {
  const saved = Boolean(row?.trial_verdict);
  const allowed = canRecordVerdict(user) && (!saved || user?.role === 'admin');
  return { allowed, needsReason: saved };
}

// The date the review-due box starts on: the stored one when a redo opens on a
// project that already has one, else the suggestion's default (approval + 6 months).
export function prefillDueDate(row, suggestion) {
  const stored = row && row.life_review_due_date ? String(row.life_review_due_date).slice(0, 10) : '';
  return stored || (suggestion && suggestion.defaultReviewDate) || '';
}
