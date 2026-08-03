'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imp = require('./sampleFollowupImport.cjs');

test('normalizeDieNo strips case and every kind of whitespace', () => {
  assert.equal(imp.normalizeDieNo(' 027048-2502 '), '027048-2502');
  assert.equal(imp.normalizeDieNo('gex 1234'), 'GEX1234');
  assert.equal(imp.normalizeDieNo(null), '');
  assert.equal(imp.normalizeDieNo(undefined), '');
});

test('cleanText trims, collapses, and nulls out blanks', () => {
  assert.equal(imp.cleanText('Sujith '), 'Sujith');
  assert.equal(imp.cleanText('Van  der  Berg'), 'Van der Berg');
  assert.equal(imp.cleanText('   '), null);
  assert.equal(imp.cleanText(null), null);
});

test('parseSheetDate reads Excel serials', () => {
  // 45954 and 46085 are real values from the sheet.
  assert.equal(imp.parseSheetDate(45954), '2025-10-24');
  assert.equal(imp.parseSheetDate(46085), '2026-03-04');
  assert.equal(imp.parseSheetDate('45954'), '2025-10-24');
});

test('parseSheetDate reads typed text in both orders', () => {
  assert.equal(imp.parseSheetDate('2026-03-12'), '2026-03-12');
  assert.equal(imp.parseSheetDate('2026-03-12T00:00:00Z'), '2026-03-12');
  assert.equal(imp.parseSheetDate('12/03/2026'), '2026-03-12');
  assert.equal(imp.parseSheetDate('12-03-2026'), '2026-03-12');
  assert.equal(imp.parseSheetDate('5.3.2026'), '2026-03-05');
});

test('parseSheetDate rejects blanks, zero, and garbage', () => {
  // Die 007223-3501 carries a Submission Date of 0 — it must read as blank.
  assert.equal(imp.parseSheetDate(0), null);
  assert.equal(imp.parseSheetDate(''), null);
  assert.equal(imp.parseSheetDate('   '), null);
  assert.equal(imp.parseSheetDate(null), null);
  assert.equal(imp.parseSheetDate(undefined), null);
  assert.equal(imp.parseSheetDate(-5), null);
  assert.equal(imp.parseSheetDate('n/a'), null);
  assert.equal(imp.parseSheetDate('2026-13-45'), null);
  assert.equal(imp.parseSheetDate('32/01/2026'), null);
});

test('parseTrialCount accepts 0..1000 and rejects the rest', () => {
  assert.equal(imp.parseTrialCount(0), 0);
  assert.equal(imp.parseTrialCount(7), 7);
  assert.equal(imp.parseTrialCount('3'), 3);
  assert.equal(imp.parseTrialCount(2.4), 2);
  assert.equal(imp.parseTrialCount(''), null);
  assert.equal(imp.parseTrialCount(null), null);
  assert.equal(imp.parseTrialCount(-1), null);
  assert.equal(imp.parseTrialCount(1001), null);
  assert.equal(imp.parseTrialCount('many'), null);
});

test('readCell tolerates headers with stray trailing spaces', () => {
  assert.equal(imp.readCell({ 'Corrector ': 'Dinesh' }, 'Corrector'), 'Dinesh');
  assert.equal(imp.readCell({ Corrector: 'Dinesh' }, 'Corrector'), 'Dinesh');
  assert.equal(imp.readCell({}, 'Corrector'), '');
});

const order = (over = {}) => ({
  id: 1, die_no: '027048-2502', plant: 'GEX 2', supplier: 'PHME', status: 'DONE',
  die_received_date: null, submission_date: null, sample_approval_date: null,
  no_of_trial: 0, corrector: null, sample_status: '', ...over,
});

test('selectOrder reports a die the app has never seen', () => {
  assert.equal(imp.selectOrder([]).reason, 'not-found');
  assert.equal(imp.selectOrder(undefined).reason, 'not-found');
});

test('selectOrder picks the only live order', () => {
  const o = order();
  const got = imp.selectOrder([o]);
  assert.equal(got.reason, 'matched');
  assert.equal(got.order, o);
});

test('selectOrder ignores cancelled re-orders', () => {
  // Every duplicate in the real sheet looks like this: a live DONE order and a
  // newer CANCELLED one. The sample data belongs to the DONE order.
  const done = order({ id: 326, status: 'DONE', supplier: 'PDTMC' });
  const cancelled = order({ id: 383, status: 'CANCELLED', supplier: 'JIANGSU' });
  const got = imp.selectOrder([done, cancelled]);
  assert.equal(got.reason, 'matched');
  assert.equal(got.order.id, 326);
});

test('selectOrder treats cancelled status case-insensitively', () => {
  const got = imp.selectOrder([order({ id: 9, status: ' cancelled ' })]);
  assert.equal(got.reason, 'all-cancelled');
  assert.equal(got.order, null);
});

test('selectOrder refuses to guess between several live orders', () => {
  const got = imp.selectOrder([order({ id: 1 }), order({ id: 2 })]);
  assert.equal(got.reason, 'ambiguous');
  assert.equal(got.order, null);
  assert.deepEqual(got.candidates.map((o) => o.id), [1, 2]);
});

test('deriveSampleStatus prefers approval over submission', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: '2026-03-01', currentStatus: '',
  }), 'Approved');
});

test('deriveSampleStatus falls back to submission', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: '2026-03-01', currentStatus: '',
  }), 'Sample Submitted');
});

test('deriveSampleStatus leaves status alone when there are no dates', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: null, currentStatus: 'Pending',
  }), null);
});

test('deriveSampleStatus never downgrades', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: '2026-03-01', currentStatus: 'Approved',
  }), null);
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: '2026-03-01', currentStatus: 'Sample Submitted',
  }), null);
});

test('deriveSampleStatus never overrides a hand-set judgement', () => {
  // Rejected and On hold are decisions a person made; no date implies them.
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: 'Rejected',
  }), null);
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: 'On hold',
  }), null);
});

test('deriveSampleStatus upgrades an empty or pending status', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: '',
  }), 'Approved');
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: 'Pending',
  }), 'Approved');
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: null,
  }), 'Approved');
});
