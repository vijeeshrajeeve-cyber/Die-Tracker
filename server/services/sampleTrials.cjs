'use strict';

// One row per trial of a die sample.
//
// Sample Followup used to carry a single hand-typed `no_of_trial` integer. That
// number could not say when a trial ran, whether it passed, or why it failed —
// so the reason a die needed five trials lived only in somebody's memory. Each
// trial is its own row here for the same reason FOC rounds are their own rows
// in qdFocRounds.cjs: the history is the evidence.
//
// This module owns the vocabulary and the rules. It never decides Sample
// Status — a failed trial does not reject a sample; a person does.

const TRIAL_RESULTS = ['OK', 'Not OK'];

// Fixed, and stored verbatim in the fail_reason column. Changing a string here
// is a data migration, not an edit. `Other` exists so a novel failure is never
// mis-filed under a reason that does not fit; the explanation goes in comments.
const FAIL_REASONS = [
  'Shape',
  'Dimension Out of Spec',
  'Aesthetic Out of Spec',
  'Die Choked',
  'Manufacturing issue',
  'Other',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Accepts ISO, ISO-with-time, and DD/MM/YYYY — the three shapes that reach this
// app, since older followup dates were imported from spreadsheets.
function normaliseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (iso) return iso[1];
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

const trim = (v) => (v === null || v === undefined ? '' : String(v).trim());

// `today` is an ISO day string so the caller decides what "today" means and the
// rule stays testable. ISO dates compare correctly as strings.
function validateTrial(input = {}, today) {
  const trial_date = normaliseDate(input.trial_date);
  if (!trial_date) return { ok: false, error: 'A valid trial date is required' };
  if (today && trial_date > today) {
    return { ok: false, error: 'Trial date cannot be in the future' };
  }

  const result = trim(input.result);
  if (!TRIAL_RESULTS.includes(result)) {
    return { ok: false, error: `Result must be one of: ${TRIAL_RESULTS.join(', ')}` };
  }

  // A reason is required precisely when the trial failed, and meaningless when
  // it passed — so an OK trial silently drops any reason rather than erroring,
  // which is what happens when someone picks Not OK, chooses a reason, then
  // switches back to OK.
  let fail_reason = null;
  if (result === 'Not OK') {
    fail_reason = trim(input.fail_reason);
    if (!fail_reason) return { ok: false, error: 'A reason is required when the result is Not OK' };
    if (!FAIL_REASONS.includes(fail_reason)) {
      return { ok: false, error: `Reason must be one of: ${FAIL_REASONS.join(', ')}` };
    }
  }

  const comments = trim(input.comments).slice(0, 2000) || null;

  return { ok: true, value: { trial_date, result, fail_reason, comments } };
}

function nextTrialNo(trials) {
  return (trials || []).reduce((max, t) => Math.max(max, Number(t.trial_no) || 0), 0) + 1;
}

module.exports = {
  TRIAL_RESULTS, FAIL_REASONS, ISO_DATE,
  normaliseDate, validateTrial, nextTrialNo,
};
