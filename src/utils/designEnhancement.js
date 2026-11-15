import { canEditOrderDetails } from './orderDetailEdits.js';

/**
 * Design enhancement rules, client copy. server/services/designEnhancement.cjs
 * and enhancementAccess.cjs are the authority; designEnhancement.test.js fails
 * if the two ever disagree. A blank number is null ("not recorded"), never 0.
 */

export const VERDICTS = Object.freeze(['Achieved', 'Partly achieved', 'Not achieved']);

export const isEnhancement = (order) => order?.designEnhancement === true || order?.designEnhancement === 1;

// Plain number or plain decimal string with a dot. Anything else is invalid.
export function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : NaN;
  if (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
  return NaN;
}

export const isBlank = (raw) => raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

// The number fields. `pct` caps the value at 100.
export const BASELINE_NUMBERS = Object.freeze([
  { key: 'baseline_productivity_kgh', pct: false },
  { key: 'target_productivity_kgh', pct: false },
  { key: 'baseline_recovery_pct', pct: true },
  { key: 'target_recovery_pct', pct: true },
  { key: 'baseline_failure_pct', pct: true },
  { key: 'target_failure_pct', pct: true },
]);

export const emptyBaselineForm = () => ({
  current_issue: '', reference_dies: '',
  baseline_failure_pct: '', baseline_productivity_kgh: '', baseline_recovery_pct: '',
  target_failure_pct: '', target_productivity_kgh: '', target_recovery_pct: '',
  failure_assessment_required: false,
});

// A stored design_enhancements row as form text; null becomes an empty box.
export function formFromRow(row) {
  const out = emptyBaselineForm();
  if (!row) return out;
  for (const key of Object.keys(out)) {
    const v = row[key];
    if (key === 'failure_assessment_required') out[key] = v === true;
    else out[key] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

// Same rules as the server's validateBaseline, but reports every bad field.
// On success `value` is what the API expects (numbers as numbers, blanks null).
export function validateBaselineForm(form) {
  const src = form || {};
  const errors = {};
  const issue = typeof src.current_issue === 'string' ? src.current_issue.trim() : '';
  if (!issue) errors.current_issue = 'Describe the current issue';

  const required = src.failure_assessment_required === true;
  const value = {
    current_issue: issue,
    reference_dies: typeof src.reference_dies === 'string' && src.reference_dies.trim() ? src.reference_dies.trim() : null,
  };
  for (const { key, pct } of BASELINE_NUMBERS) {
    const optional = key === 'target_failure_pct' && !required;
    const raw = src[key];
    if (isBlank(raw)) {
      if (optional) value[key] = null;
      else errors[key] = 'Required';
      continue;
    }
    const n = parseNumber(raw);
    if (Number.isNaN(n)) errors[key] = 'Enter a number of 0 or more';
    else if (pct && n > 100) errors[key] = 'Cannot be more than 100';
    else value[key] = n;
  }
  value.failure_assessment_required = required;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, errors: {}, value };
}

const has = (n) => typeof n === 'number' && Number.isFinite(n);

// Higher is better for productivity and recovery; lower is better for failure.
export function suggestVerdict({ targets, actuals } = {}) {
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

export function needsLifeReview(row, order) {
  const r = row || {};
  if (isCancelled(order)) return false;
  return Boolean(r.trial_verdict && r.failure_assessment_required && !r.final_verdict
    && (order && order.sample_status) !== 'Rejected');
}

// `order` uses the server's snake_case shape (status, sample_status).
export function projectState(row, order) {
  const r = row || {};
  if (isCancelled(order)) return 'Cancelled';
  if (r.final_verdict) return 'Completed';
  if (needsLifeReview(r, order)) return 'Awaiting life review';
  return 'Open';
}

// ── Who may mark, edit or remove (server/services/enhancementAccess.cjs) ──

const isAdmin = (user) => !!user && user.role === 'admin';
const statusOf = (order) => String(order?.STATUS ?? order?.status ?? '').toUpperCase();

// Mark an order or edit its baseline: editors before DIE RECEIVED, admins after.
export function canMarkEnhancement(order, user) {
  if (!canEditOrderDetails(user)) return false;
  const status = statusOf(order);
  if (status === 'CANCELLED') return false;
  return status !== 'DIE RECEIVED' || isAdmin(user);
}
export const canEditBaseline = canMarkEnhancement;

// The admin path asks for a reason; true when this order is past receipt.
export const markNeedsReason = (order) => statusOf(order) === 'DIE RECEIVED';

// Remove the flag: editors while the order has no trial, admins after.
export function canRemoveEnhancement(order, user, trialCount) {
  if (!canEditOrderDetails(user)) return false;
  return !(Number(trialCount) > 0) || isAdmin(user);
}
