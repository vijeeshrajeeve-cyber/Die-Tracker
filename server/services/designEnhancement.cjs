'use strict';
// Rules for Design enhancement projects: baseline validation, the suggested
// verdict and the derived project state. Pure -- no database access.
// A blank number is null ("not recorded"); it is never 0 and never defaulted.

const VERDICTS = ['Achieved', 'Partly achieved', 'Not achieved'];

// Plain number or plain decimal string with a dot. Anything else is invalid.
function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : NaN;
  if (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
  return NaN;
}

function isBlank(raw) {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

const NUMBER_FIELDS = [
  { key: 'baseline_failure_pct', pct: true },
  { key: 'baseline_productivity_kgh', pct: false },
  { key: 'baseline_recovery_pct', pct: true },
  { key: 'target_productivity_kgh', pct: false },
  { key: 'target_recovery_pct', pct: true },
];

function text(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t === '' ? null : t;
}

function validateBaseline(input) {
  const src = input || {};
  const issue = text(src.current_issue);
  if (!issue) return { ok: false, error: 'current_issue is required' };

  const required = src.failure_assessment_required === true;
  const value = { current_issue: issue, reference_dies: text(src.reference_dies) };

  const fields = [...NUMBER_FIELDS, { key: 'target_failure_pct', pct: true, optional: !required }];
  for (const { key, pct, optional } of fields) {
    const raw = src[key];
    if (isBlank(raw)) {
      if (optional) { value[key] = null; continue; }
      return { ok: false, error: `${key} is required` };
    }
    const n = parseNumber(raw);
    if (Number.isNaN(n)) return { ok: false, error: `${key} must be a number of 0 or more` };
    if (pct && n > 100) return { ok: false, error: `${key} cannot be more than 100` };
    value[key] = n;
  }
  value.failure_assessment_required = required;

  const order = ['current_issue', 'reference_dies', 'baseline_failure_pct', 'baseline_productivity_kgh',
    'baseline_recovery_pct', 'target_failure_pct', 'target_productivity_kgh', 'target_recovery_pct',
    'failure_assessment_required'];
  return { ok: true, value: Object.fromEntries(order.map((k) => [k, value[k]])) };
}

const has = (n) => typeof n === 'number' && Number.isFinite(n);

// Higher is better for productivity and recovery; lower is better for failure.
function suggestVerdict({ targets, actuals } = {}) {
  const t = targets || {};
  const a = actuals || {};
  let counted = 0;
  let met = 0;
  for (const [key, lowerIsBetter] of [['failure', true], ['productivity', false], ['recovery', false]]) {
    if (!has(t[key]) || !has(a[key])) continue;
    counted += 1;
    if (lowerIsBetter ? a[key] <= t[key] : a[key] >= t[key]) met += 1;
  }
  if (counted === 0) return null;
  if (met === counted) return 'Achieved';
  return met === 0 ? 'Not achieved' : 'Partly achieved';
}

const isCancelled = (order) => String((order && order.status) || '').toUpperCase() === 'CANCELLED';

// A life review is owed after a trial verdict when the failure assessment was
// asked for, the sample was not rejected, and no final verdict exists yet.
function needsLifeReview(row, order) {
  const r = row || {};
  if (isCancelled(order)) return false;
  return Boolean(r.trial_verdict && r.failure_assessment_required && !r.final_verdict
    && (order && order.sample_status) !== 'Rejected');
}

function projectState(row, order) {
  const r = row || {};
  if (isCancelled(order)) return 'Cancelled';
  if (r.final_verdict) return 'Completed';
  if (needsLifeReview(r, order)) return 'Awaiting life review';
  return 'Open';
}

// The trial whose numbers a verdict snapshots: highest trial_no with result OK.
function latestOkTrial(trials) {
  let best = null;
  for (const t of Array.isArray(trials) ? trials : []) {
    if (t && t.result === 'OK' && (!best || Number(t.trial_no) > Number(best.trial_no))) best = t;
  }
  return best;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real calendar day written YYYY-MM-DD ("2026-02-30" is not one).
function isIsoDate(raw) {
  const m = typeof raw === 'string' ? ISO_DAY.exec(raw) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

// Six calendar months after the sample was approved; a day that does not exist
// in the later month falls back to that month's last day (31 Aug -> 28 Feb).
function defaultReviewDate(sampleApprovalDate) {
  if (!isIsoDate(sampleApprovalDate)) return null;
  const [y, mo, d] = sampleApprovalDate.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1 + 6, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
  return out.toISOString().slice(0, 10);
}

module.exports = { parseNumber, isBlank, VERDICTS, validateBaseline, suggestVerdict, projectState, needsLifeReview,
  latestOkTrial, isIsoDate, defaultReviewDate };
