'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VERDICTS, validateBaseline, suggestVerdict, projectState, needsLifeReview,
  latestOkTrial, defaultReviewDate, isIsoDate } = require('./designEnhancement.cjs');

test('verdict vocabulary is fixed', () => {
  assert.deepEqual(VERDICTS, ['Achieved', 'Partly achieved', 'Not achieved']);
});

test('baseline requires issue, three current values and two targets', () => {
  assert.equal(validateBaseline({}).ok, false);
  const ok = validateBaseline({ current_issue: 'Die cracks at bridge', baseline_failure_pct: 19,
    baseline_productivity_kgh: 850, baseline_recovery_pct: 78.5,
    target_productivity_kgh: 950, target_recovery_pct: 82, failure_assessment_required: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.target_failure_pct, null);
  assert.equal(ok.value.reference_dies, null);
  assert.equal(ok.value.baseline_recovery_pct, 78.5);
  assert.equal(ok.value.failure_assessment_required, false);
});

test('failure target is required only when the assessment is required', () => {
  const base = { current_issue: 'x', baseline_failure_pct: 19, baseline_productivity_kgh: 850,
    baseline_recovery_pct: 78, target_productivity_kgh: 950, target_recovery_pct: 82 };
  assert.equal(validateBaseline({ ...base, failure_assessment_required: true }).ok, false);
  assert.equal(validateBaseline({ ...base, failure_assessment_required: true, target_failure_pct: 10 }).ok, true);
});

test('bad numbers are rejected, never stored as 0', () => {
  const base = { current_issue: 'x', baseline_failure_pct: 19, baseline_productivity_kgh: 850,
    baseline_recovery_pct: 78, target_productivity_kgh: 950, target_recovery_pct: 82 };
  for (const bad of ['abc', '12,5', -1, '']) {
    assert.equal(validateBaseline({ ...base, baseline_failure_pct: bad }).ok, false);
  }
  // percentages above 100 are rejected; kg/h is capped at 100000
  const pct = validateBaseline({ ...base, baseline_recovery_pct: 100.5 });
  assert.equal(pct.ok, false);
  assert.match(pct.error, /baseline_recovery_pct/);
  assert.equal(validateBaseline({ ...base, target_recovery_pct: 101 }).ok, false);
  assert.equal(validateBaseline({ ...base, baseline_recovery_pct: 100 }).ok, true);
  assert.equal(validateBaseline({ ...base, baseline_productivity_kgh: 250000 }).ok, false);
  assert.equal(validateBaseline({ ...base, baseline_productivity_kgh: '1250.5' }).ok, true);
});

test('suggested verdict counts only targets that exist', () => {
  const t = { failure: null, productivity: 950, recovery: 82 };
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: 950, recovery: 83 } }), 'Achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: 900, recovery: 83 } }), 'Partly achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: 900, recovery: 80 } }), 'Not achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: null, recovery: null } }), null);
});

test('failure % is met when the actual is lower or equal', () => {
  const t = { failure: 10, productivity: null, recovery: null };
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: 10 } }), 'Achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: 12 } }), 'Not achieved');
});

test('a missing actual is skipped, not counted as a miss', () => {
  const t = { failure: null, productivity: 950, recovery: 82 };
  assert.equal(suggestVerdict({ targets: t, actuals: { productivity: 960, recovery: null } }), 'Achieved');
});

test('project state', () => {
  const o = { status: 'DIE RECEIVED', sample_status: 'Approved' };
  assert.equal(projectState({}, o), 'Open');
  assert.equal(projectState({ trial_verdict: 'Achieved', failure_assessment_required: true }, o), 'Awaiting life review');
  assert.equal(projectState({ trial_verdict: 'Achieved', final_verdict: 'Achieved' }, o), 'Completed');
  assert.equal(projectState({}, { status: 'CANCELLED' }), 'Cancelled');
  assert.equal(needsLifeReview({ trial_verdict: 'Not achieved', failure_assessment_required: true },
    { status: 'DIE RECEIVED', sample_status: 'Rejected' }), false);
  assert.equal(needsLifeReview({ trial_verdict: 'Achieved', failure_assessment_required: true }, o), true);
  assert.equal(needsLifeReview({ trial_verdict: 'Achieved', failure_assessment_required: false }, o), false);
  assert.equal(needsLifeReview({ failure_assessment_required: true }, o), false);
  assert.equal(needsLifeReview({ trial_verdict: 'Achieved', failure_assessment_required: true, final_verdict: 'Achieved' }, o), false);
});

test('latestOkTrial picks the highest trial_no with result OK', () => {
  assert.equal(latestOkTrial([]), null);
  assert.equal(latestOkTrial(null), null);
  assert.equal(latestOkTrial([{ trial_no: 1, result: 'Not OK' }]), null);
  const trials = [{ id: 1, trial_no: 1, result: 'OK' }, { id: 3, trial_no: 3, result: 'Not OK' }, { id: 2, trial_no: 2, result: 'OK' }];
  assert.equal(latestOkTrial(trials).id, 2);
});

test('defaultReviewDate is six calendar months on, clamped to month end', () => {
  assert.equal(defaultReviewDate('2026-08-31'), '2027-02-28');
  assert.equal(defaultReviewDate('2026-01-15'), '2026-07-15');
  assert.equal(defaultReviewDate('2026-09-30'), '2027-03-30');
  assert.equal(defaultReviewDate('2023-08-31'), '2024-02-29');
  assert.equal(defaultReviewDate(null), null);
  assert.equal(defaultReviewDate('not a date'), null);
});

test('isIsoDate accepts only real calendar days', () => {
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('28/02/2026'), false);
  assert.equal(isIsoDate(null), false);
});
