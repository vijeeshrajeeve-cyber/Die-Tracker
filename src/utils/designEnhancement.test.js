import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  VERDICTS, isEnhancement, validateBaselineForm, suggestVerdict, projectState, needsLifeReview, formFromRow,
  emptyBaselineForm, canMarkEnhancement, canEditBaseline, canRemoveEnhancement, markNeedsReason,
} from './designEnhancement.js';

const require = createRequire(import.meta.url);
const server = require('../../server/services/designEnhancement.cjs');

const GOOD = {
  current_issue: 'Die cracks at bridge', reference_dies: '', baseline_failure_pct: '19',
  baseline_productivity_kgh: '850', baseline_recovery_pct: '78.5',
  target_productivity_kgh: '950', target_recovery_pct: '82', target_failure_pct: '',
  failure_assessment_required: false,
};

test('verdict vocabulary matches the server', () => {
  assert.deepEqual([...VERDICTS], server.VERDICTS);
});

test('isEnhancement reads the order flag', () => {
  assert.equal(isEnhancement({ designEnhancement: true }), true);
  assert.equal(isEnhancement({ designEnhancement: false }), false);
  assert.equal(isEnhancement({}), false);
  assert.equal(isEnhancement(null), false);
});

test('a complete form is valid and blanks are null, not 0', () => {
  const r = validateBaselineForm(GOOD);
  assert.equal(r.ok, true);
  assert.equal(r.value.target_failure_pct, null);
  assert.equal(r.value.reference_dies, null);
  assert.equal(r.value.baseline_recovery_pct, 78.5);
  assert.equal(r.value.failure_assessment_required, false);
});

test('errors are reported per field', () => {
  const r = validateBaselineForm(emptyBaselineForm());
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), [
    'baseline_failure_pct', 'baseline_productivity_kgh', 'baseline_recovery_pct', 'current_issue',
    'target_productivity_kgh', 'target_recovery_pct',
  ]);
});

test('failure target is required only when the assessment is ticked', () => {
  const ticked = { ...GOOD, failure_assessment_required: true };
  const r = validateBaselineForm(ticked);
  assert.equal(r.ok, false);
  assert.ok(r.errors.target_failure_pct);
  assert.equal(validateBaselineForm({ ...ticked, target_failure_pct: '10' }).ok, true);
});

test('bad numbers are rejected, percentages cap at 100', () => {
  for (const bad of ['abc', '12,5', '-1']) {
    assert.ok(validateBaselineForm({ ...GOOD, baseline_failure_pct: bad }).errors.baseline_failure_pct, bad);
  }
  assert.ok(validateBaselineForm({ ...GOOD, baseline_recovery_pct: '100.5' }).errors.baseline_recovery_pct);
  assert.ok(validateBaselineForm({ ...GOOD, target_recovery_pct: '101' }).errors.target_recovery_pct);
  assert.equal(validateBaselineForm({ ...GOOD, baseline_recovery_pct: '100' }).ok, true);
  assert.equal(validateBaselineForm({ ...GOOD, baseline_productivity_kgh: '250000' }).ok, true);
});

test('the form agrees with the server validator on the same inputs', () => {
  const inputs = [
    GOOD,
    { ...GOOD, current_issue: '   ' },
    { ...GOOD, baseline_failure_pct: 'abc' },
    { ...GOOD, baseline_failure_pct: '' },
    { ...GOOD, baseline_recovery_pct: '100.5' },
    { ...GOOD, baseline_recovery_pct: '100' },
    { ...GOOD, failure_assessment_required: true },
    { ...GOOD, failure_assessment_required: true, target_failure_pct: '10' },
    { ...GOOD, baseline_productivity_kgh: '1250.5', reference_dies: ' 1234-201 ' },
  ];
  for (const input of inputs) {
    const mine = validateBaselineForm(input);
    const theirs = server.validateBaseline(input);
    assert.equal(mine.ok, theirs.ok, JSON.stringify(input));
    if (mine.ok) assert.deepEqual(mine.value, theirs.value);
  }
});

test('formFromRow turns a stored row into form text', () => {
  const f = formFromRow({ current_issue: 'x', reference_dies: null, baseline_failure_pct: '19.00', target_failure_pct: null,
    failure_assessment_required: true });
  assert.equal(f.current_issue, 'x');
  assert.equal(f.reference_dies, '');
  assert.equal(f.baseline_failure_pct, '19.00');
  assert.equal(f.target_failure_pct, '');
  assert.equal(f.failure_assessment_required, true);
  assert.deepEqual(formFromRow(null), emptyBaselineForm());
});

test('suggested verdict counts only targets that exist, like the server', () => {
  const t = { failure: null, productivity: 950, recovery: 82 };
  const cases = [
    [t, { failure: null, productivity: 950, recovery: 83 }, 'Achieved'],
    [t, { failure: null, productivity: 900, recovery: 83 }, 'Partly achieved'],
    [t, { failure: null, productivity: 900, recovery: 80 }, 'Not achieved'],
    [t, { failure: null, productivity: null, recovery: null }, null],
    [t, { productivity: 960, recovery: null }, 'Achieved'],
    [{ failure: 10 }, { failure: 10 }, 'Achieved'],
    [{ failure: 10 }, { failure: 12 }, 'Not achieved'],
  ];
  for (const [targets, actuals, want] of cases) {
    assert.equal(suggestVerdict({ targets, actuals }), want);
    assert.equal(server.suggestVerdict({ targets, actuals }), want);
  }
  assert.equal(suggestVerdict(), null);
});

test('project state matches the server', () => {
  const o = { status: 'DIE RECEIVED', sample_status: 'Approved' };
  const rows = [
    [{}, o], [{ trial_verdict: 'Achieved', failure_assessment_required: true }, o],
    [{ trial_verdict: 'Achieved', final_verdict: 'Achieved' }, o], [{}, { status: 'CANCELLED' }],
    [{ trial_verdict: 'Not achieved', failure_assessment_required: true }, { status: 'DIE RECEIVED', sample_status: 'Rejected' }],
  ];
  for (const [row, order] of rows) {
    assert.equal(projectState(row, order), server.projectState(row, order));
    assert.equal(needsLifeReview(row, order), server.needsLifeReview(row, order));
  }
  assert.equal(projectState({}, o), 'Open');
  assert.equal(projectState({ trial_verdict: 'Achieved', failure_assessment_required: true }, o), 'Awaiting life review');
});

const editor = { role: 'user', canEditOrderDetails: true };
const admin = { role: 'admin' };
const viewer = { role: 'user', canEditOrderDetails: false };

test('an order editor may mark before the die is received, an admin after', () => {
  const early = { STATUS: 'UNDER SIMULATION' };
  const received = { STATUS: 'DIE RECEIVED' };
  assert.equal(canMarkEnhancement(early, editor), true);
  assert.equal(canMarkEnhancement(received, editor), false);
  assert.equal(canMarkEnhancement(received, admin), true);
  assert.equal(canEditBaseline(received, editor), false);
  assert.equal(canEditBaseline(received, admin), true);
  assert.equal(canMarkEnhancement(early, viewer), false);
  assert.equal(canMarkEnhancement(early, null), false);
  assert.equal(markNeedsReason(received), true);
  assert.equal(markNeedsReason(early), false);
});

test('a cancelled order cannot be marked, even by an admin', () => {
  assert.equal(canMarkEnhancement({ STATUS: 'CANCELLED' }, admin), false);
});

test('removal is blocked for non-admins once a trial exists', () => {
  assert.equal(canRemoveEnhancement({}, editor, 0), true);
  assert.equal(canRemoveEnhancement({}, editor, 1), false);
  assert.equal(canRemoveEnhancement({}, admin, 3), true);
  assert.equal(canRemoveEnhancement({}, viewer, 0), false);
});

test('access helpers agree with the server rules', () => {
  const access = require('../../server/services/enhancementAccess.cjs');
  for (const status of ['UNDER SIMULATION', 'DIE RECEIVED', 'CANCELLED']) {
    for (const [user, name] of [[editor, 'editor'], [admin, 'admin'], [viewer, 'viewer']]) {
      const serverOk = access.markAccess(user, status, 'because').ok;
      assert.equal(canMarkEnhancement({ STATUS: status }, user), serverOk, `${name} ${status}`);
    }
  }
  for (const user of [editor, admin, viewer]) {
    for (const trials of [0, 2]) {
      assert.equal(canRemoveEnhancement({}, user, trials), access.removeAccess(user, trials > 0, 'because').ok);
    }
  }
});
