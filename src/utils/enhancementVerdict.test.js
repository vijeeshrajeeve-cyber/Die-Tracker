import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPageAccess, canRecordVerdict, latestOkTrial, panelStage, validateAbandonForm, closeRejectedAccess, resultRows, formNeedsReason, validateVerdictForm, reviewOwedAfter, showNumber, validateTrialNumbers, trialSuggestion, prefillDueDate,
} from './enhancementVerdict.js';

const ROW = {
  baseline_productivity_kgh: '800', target_productivity_kgh: '900', baseline_recovery_pct: '70', target_recovery_pct: '75',
  baseline_failure_pct: '12', target_failure_pct: '8', failure_assessment_required: true,
  trial_verdict: null, final_verdict: null, life_review_date: null,
};
const approved = { STATUS: 'DIE RECEIVED', 'Sample Status': 'Approved' };
const rejected = { STATUS: 'DIE RECEIVED', 'Sample Status': 'Rejected' };
const TRIALS = [
  { trial_no: 1, result: 'Not OK', productivity_kgh: null, recovery_pct: null },
  { trial_no: 2, result: 'OK', productivity_kgh: '920', recovery_pct: '76' },
  { trial_no: 3, result: 'OK', productivity_kgh: '930', recovery_pct: '77' },
];

test('page access follows the app: admin, null = all, listed, process-flow', () => {
  assert.equal(hasPageAccess({ role: 'admin' }, 'flow-sample-followup'), true);
  assert.equal(hasPageAccess({ role: 'user', pageAccess: null }, 'flow-sample-followup'), true);
  assert.equal(hasPageAccess({ role: 'user', pageAccess: ['orders'] }, 'flow-sample-followup'), false);
  assert.equal(hasPageAccess({ role: 'user', pageAccess: ['flow-sample-followup'] }, 'flow-sample-followup'), true);
  assert.equal(hasPageAccess({ role: 'user', pageAccess: ['process-flow'] }, 'flow-sample-followup'), true);
  assert.equal(canRecordVerdict({ role: 'user', pageAccess: ['orders'] }), false);
  assert.equal(canRecordVerdict(null), false);
});

test('latestOkTrial is the highest OK trial number', () => {
  assert.equal(latestOkTrial(TRIALS).trial_no, 3);
  assert.equal(latestOkTrial([{ trial_no: 1, result: 'Not OK' }]), null);
  assert.equal(latestOkTrial(undefined), null);
});

test('stage: waiting until the sample is decided, then trial, review, done', () => {
  assert.equal(panelStage(ROW, { STATUS: 'DIE RECEIVED', 'Sample Status': 'Sample Submitted' }), 'waiting');
  assert.equal(panelStage(ROW, approved), 'trial');
  assert.equal(panelStage(ROW, rejected), 'rework');
  assert.equal(panelStage({ ...ROW, trial_verdict: 'Not achieved', final_verdict: 'Not achieved' }, rejected), 'done');
  assert.equal(panelStage(ROW, { STATUS: 'CANCELLED', 'Sample Status': 'Rejected' }), 'cancelled');
  // awaiting life review, then the sample is Rejected: the project is open again
  assert.equal(panelStage({ ...ROW, trial_verdict: 'Achieved' }, rejected), 'rework');
  assert.equal(panelStage({ ...ROW, trial_verdict: 'Achieved' }, approved), 'review');
  assert.equal(panelStage({ ...ROW, trial_verdict: 'Achieved', failure_assessment_required: false, final_verdict: 'Achieved' }, approved), 'done');
  assert.equal(panelStage(ROW, { STATUS: 'CANCELLED', 'Sample Status': 'Approved' }), 'cancelled');
});

test('result rows use the latest OK trial before a verdict and the snapshot after; blanks stay null', () => {
  const before = resultRows(ROW, TRIALS);
  assert.deepEqual(before.map((r) => r.actual), [930, 77, null]);
  assert.deepEqual(before.map((r) => r.target), [900, 75, 8]);
  const after = resultRows({ ...ROW, trial_verdict: 'Achieved', trial_productivity_kgh: '910', trial_recovery_pct: null }, TRIALS);
  assert.deepEqual(after.map((r) => r.actual), [910, null, null]);
  assert.equal(resultRows({ ...ROW, failure_assessment_required: false }, [])[2].target, undefined);
  assert.equal(resultRows(ROW, [])[0].actual, null);
});

test('a saved verdict needs a reason to change; a first one does not', () => {
  assert.equal(formNeedsReason('trial', ROW), false);
  assert.equal(formNeedsReason('trial', { ...ROW, trial_verdict: 'Achieved' }), true);
  assert.equal(formNeedsReason('review', { ...ROW, trial_verdict: 'Achieved' }), false);
  assert.equal(formNeedsReason('review', { ...ROW, life_review_date: '2027-01-01' }), true);
});

test('trial verdict: remark needed on override, due date needed when a review is owed', () => {
  const base = { form: 'trial', row: ROW, order: approved, today: '2026-11-15' };
  let r = validateVerdictForm({ ...base, suggested: 'Achieved', values: { verdict: 'Partly achieved', dueDate: '2027-05-01' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.remark);
  r = validateVerdictForm({ ...base, suggested: 'Achieved', values: { verdict: 'Achieved' } });
  assert.ok(r.errors.dueDate);
  r = validateVerdictForm({ ...base, suggested: 'Achieved', values: { verdict: 'Achieved', dueDate: '2026-11-01' } });
  assert.ok(r.errors.dueDate);
  r = validateVerdictForm({ ...base, suggested: 'Achieved', values: { verdict: 'Achieved', dueDate: '2027-05-01' } });
  assert.deepEqual(r.body, { verdict: 'Achieved', life_review_due_date: '2027-05-01' });
  // no suggestion: every verdict is an override
  r = validateVerdictForm({ ...base, suggested: null, values: { verdict: 'Achieved', dueDate: '2027-05-01' } });
  assert.ok(r.errors.remark);
  r = validateVerdictForm({ ...base, suggested: null, values: { verdict: 'Achieved', dueDate: '2027-05-01', remark: ' ok ' } });
  assert.equal(r.body.remark, 'ok');
});

test('no due date when no review is owed (not required, or Rejected)', () => {
  const noReview = { ...ROW, failure_assessment_required: false };
  const r = validateVerdictForm({ form: 'trial', row: noReview, order: approved, today: '2026-11-15', suggested: 'Achieved', values: { verdict: 'Achieved' } });
  assert.equal(r.ok, true);
  assert.equal(r.body.life_review_due_date, undefined);
  assert.equal(reviewOwedAfter('Achieved', ROW, { STATUS: 'DIE RECEIVED', 'Sample Status': 'Rejected' }), false);
  assert.equal(reviewOwedAfter('Achieved', ROW, approved), true);
});

test('life review: failure % is required, 0 to 100, and sent as a number', () => {
  const base = { form: 'review', row: { ...ROW, trial_verdict: 'Achieved' }, order: approved, suggested: 'Achieved' };
  assert.ok(validateVerdictForm({ ...base, values: { verdict: 'Achieved', failure: '' } }).errors.failure);
  assert.ok(validateVerdictForm({ ...base, values: { verdict: 'Achieved', failure: 'x' } }).errors.failure);
  assert.ok(validateVerdictForm({ ...base, values: { verdict: 'Achieved', failure: '101' } }).errors.failure);
  const ok = validateVerdictForm({ ...base, values: { verdict: 'Achieved', failure: '0' } });
  assert.deepEqual(ok.body, { verdict: 'Achieved', actual_failure_pct: 0 });
});

test('changing a saved verdict sends the reason', () => {
  const row = { ...ROW, trial_verdict: 'Achieved', failure_assessment_required: false, final_verdict: 'Achieved' };
  const base = { form: 'trial', row, order: approved, suggested: 'Achieved', today: '2026-11-15' };
  assert.ok(validateVerdictForm({ ...base, values: { verdict: 'Achieved' } }).errors.reason);
  assert.equal(validateVerdictForm({ ...base, values: { verdict: 'Achieved', reason: 'typo' } }).body.reason, 'typo');
});

test('blank numbers show as not recorded, never 0', () => {
  assert.equal(showNumber(null, 'kg/h'), 'not recorded');
  assert.equal(showNumber('', '%'), 'not recorded');
  assert.equal(showNumber(undefined), 'not recorded');
  assert.equal(showNumber('930', 'kg/h'), '930 kg/h');
  assert.equal(showNumber(0, '%'), '0 %');
});

test('trial numbers are required on an OK trial only, recovery capped at 100', () => {
  let r = validateTrialNumbers({ productivity: '', recovery: '', required: true });
  assert.deepEqual(Object.keys(r.errors), ['productivity_kgh', 'recovery_pct']);
  r = validateTrialNumbers({ productivity: '', recovery: '', required: false });
  assert.deepEqual(r.value, { productivity_kgh: null, recovery_pct: null });
  r = validateTrialNumbers({ productivity: '920.5', recovery: '101', required: true });
  assert.ok(r.errors.recovery_pct);
  assert.equal(r.errors.productivity_kgh, undefined);
  r = validateTrialNumbers({ productivity: 'abc', recovery: '76', required: true });
  assert.ok(r.errors.productivity_kgh);
  r = validateTrialNumbers({ productivity: '920.5', recovery: '76', required: true });
  assert.deepEqual(r.value, { productivity_kgh: 920.5, recovery_pct: 76 });
});

test('a Not OK trial sends no numbers even if some were typed', () => {
  const r = validateTrialNumbers({ productivity: '900', recovery: 'abc', required: false, result: 'Not OK' });
  assert.deepEqual(r, { ok: true, errors: {}, value: { productivity_kgh: null, recovery_pct: null } });
});

test('trial suggestion uses the latest OK trial against the two targets', () => {
  assert.equal(trialSuggestion(ROW, approved, TRIALS), 'Achieved'); // 930 >= 900, 77 >= 75
  assert.equal(trialSuggestion(ROW, approved, [{ trial_no: 1, result: 'OK', productivity_kgh: '850', recovery_pct: '76' }]), 'Partly achieved');
  assert.equal(trialSuggestion(ROW, approved, [{ trial_no: 1, result: 'OK', productivity_kgh: '850', recovery_pct: '70' }]), 'Not achieved');
  assert.equal(trialSuggestion(ROW, approved, []), null);
  // a Rejected sample keeps the project open: no suggestion, same as the server
  assert.equal(trialSuggestion(ROW, rejected, [{ trial_no: 1, result: 'Not OK' }]), null);
  assert.equal(trialSuggestion(ROW, rejected, TRIALS), null);
  // a blank number is skipped, not treated as 0
  assert.equal(trialSuggestion(ROW, approved, [{ trial_no: 1, result: 'OK', productivity_kgh: null, recovery_pct: '80' }]), 'Achieved');
});

test('the review due date pre-fills the stored one, and the suggested default only when none is stored', () => {
  const suggestion = { defaultReviewDate: '2027-02-28' };
  assert.equal(prefillDueDate({ life_review_due_date: '2027-05-10T00:00:00.000Z' }, suggestion), '2027-05-10');
  assert.equal(prefillDueDate({ life_review_due_date: '2027-05-10' }, suggestion), '2027-05-10');
  assert.equal(prefillDueDate({ life_review_due_date: null }, suggestion), '2027-02-28');
  assert.equal(prefillDueDate(null, suggestion), '2027-02-28');
  assert.equal(prefillDueDate({}, null), '');
});

test('closing a rejected project as Not achieved needs a remark and sends abandon', () => {
  let r = validateAbandonForm({ values: { remark: '   ' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.remark);
  r = validateAbandonForm({ values: {} });
  assert.ok(r.errors.remark);
  r = validateAbandonForm({ values: { remark: '  Die scrapped  ' } });
  assert.deepEqual(r, { ok: true, errors: {}, body: { verdict: 'Not achieved', remark: 'Die scrapped', abandon: true } });
});

test('who may close a Rejected project: anyone who can record, but only an admin once a trial verdict exists, and then with a reason', () => {
  const user = { role: 'user', pageAccess: null };
  const admin = { role: 'admin' };
  const none = { role: 'user', pageAccess: ['orders'] };
  assert.deepEqual(closeRejectedAccess(user, ROW), { allowed: true, needsReason: false });
  assert.deepEqual(closeRejectedAccess(none, ROW), { allowed: false, needsReason: false });
  assert.deepEqual(closeRejectedAccess(user, { ...ROW, trial_verdict: 'Achieved' }), { allowed: false, needsReason: true });
  assert.deepEqual(closeRejectedAccess(admin, { ...ROW, trial_verdict: 'Achieved' }), { allowed: true, needsReason: true });
  const r = validateAbandonForm({ row: { ...ROW, trial_verdict: 'Achieved' }, values: { remark: 'Scrapped' } });
  assert.ok(r.errors.reason);
  assert.deepEqual(validateAbandonForm({ row: { ...ROW, trial_verdict: 'Achieved' }, values: { remark: 'Scrapped', reason: ' Rejected later ' } }).body,
    { verdict: 'Not achieved', remark: 'Scrapped', abandon: true, reason: 'Rejected later' });
});
