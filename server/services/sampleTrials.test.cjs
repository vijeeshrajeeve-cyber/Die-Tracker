'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const trials = require('./sampleTrials.cjs');

const TODAY = '2026-09-04';
const ok = (over = {}) => ({ trial_date: '2026-09-01', result: 'OK', fail_reason: null, comments: '', ...over });

test('a Not OK trial without a reason is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: null }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /reason/i);
});

test('an OK trial carrying a reason has it dropped, not stored', () => {
  const r = trials.validateTrial(ok({ result: 'OK', fail_reason: 'Shape' }), TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.value.fail_reason, null);
});

test('a reason outside the fixed list is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: 'Gremlins' }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /reason/i);
});

test('every listed reason is accepted on a Not OK trial', () => {
  for (const reason of trials.FAIL_REASONS) {
    const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: reason }), TODAY);
    assert.equal(r.ok, true, `${reason} should be accepted`);
    assert.equal(r.value.fail_reason, reason);
  }
});

test('the reason list is exactly the agreed vocabulary, in order', () => {
  assert.deepEqual(trials.FAIL_REASONS, [
    'Shape', 'Dimension Out of Spec', 'Aesthetic Out of Spec',
    'Die Choked', 'Manufacturing issue', 'Other',
  ]);
});

test('a result outside OK / Not OK is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Maybe' }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /result/i);
});

test('a future trial date is rejected but today is accepted', () => {
  assert.equal(trials.validateTrial(ok({ trial_date: '2026-09-05' }), TODAY).ok, false);
  assert.equal(trials.validateTrial(ok({ trial_date: TODAY }), TODAY).ok, true);
});

test('a missing or unparseable trial date is rejected', () => {
  assert.equal(trials.validateTrial(ok({ trial_date: '' }), TODAY).ok, false);
  assert.equal(trials.validateTrial(ok({ trial_date: 'last tuesday' }), TODAY).ok, false);
});

test('DD/MM/YYYY dates are normalised to ISO', () => {
  assert.equal(trials.normaliseDate('01/09/2026'), '2026-09-01');
  assert.equal(trials.normaliseDate('2026-09-01T10:30:00Z'), '2026-09-01');
  assert.equal(trials.normaliseDate(''), null);
});

test('blank comments are stored as null, real ones are trimmed', () => {
  assert.equal(trials.validateTrial(ok({ comments: '   ' }), TODAY).value.comments, null);
  assert.equal(trials.validateTrial(ok({ comments: '  ran short  ' }), TODAY).value.comments, 'ran short');
});

test('next trial number is max + 1, and 1 for a die with no trials', () => {
  assert.equal(trials.nextTrialNo([]), 1);
  assert.equal(trials.nextTrialNo([{ trial_no: 1 }, { trial_no: 3 }]), 4);
});
