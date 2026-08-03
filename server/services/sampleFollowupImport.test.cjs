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

const sheetRow = (over = {}) => ({
  'Die': '027048-2502', 'Plant': 'GEX 2', 'Supplier': 'PHME',
  'Die Received Date': 45954, 'Ascona Ref': 'Yes',
  'Submission Date': 45954, 'Sample Approval Date': 45954,
  'No. of Trial': 0, 'Corrector': 'Dinesh', ...over,
});

test('planRowUpdate fills an empty order from the sheet', () => {
  const { updates } = imp.planRowUpdate({ row: sheetRow(), order: order() });
  assert.deepEqual(updates, {
    die_received_date: '2025-10-24',
    submission_date: '2025-10-24',
    sample_approval_date: '2025-10-24',
    corrector: 'Dinesh',
    sample_status: 'Approved',
  });
  // no_of_trial is absent: the sheet says 0 and the order already holds 0.
  assert.equal('no_of_trial' in updates, false);
});

test('planRowUpdate omits blank cells entirely rather than clearing', () => {
  const { updates } = imp.planRowUpdate({
    row: sheetRow({ 'Sample Approval Date': '', 'Corrector': '   ' }),
    order: order({ sample_approval_date: '2026-01-01', corrector: 'Kailash' }),
  });
  assert.equal('sample_approval_date' in updates, false);
  assert.equal('corrector' in updates, false);
  // The surviving approval date still drives the status.
  assert.equal(updates.sample_status, 'Approved');
});

test('planRowUpdate skips fields the order already agrees with', () => {
  const { updates } = imp.planRowUpdate({
    row: sheetRow(),
    order: order({
      die_received_date: '2025-10-24', submission_date: '2025-10-24',
      sample_approval_date: '2025-10-24', corrector: 'Dinesh',
      sample_status: 'Approved',
    }),
  });
  assert.deepEqual(updates, {});
});

test('planRowUpdate compares trial counts numerically', () => {
  const { updates } = imp.planRowUpdate({
    row: sheetRow({ 'No. of Trial': 2 }),
    order: order({ no_of_trial: '2' }),
  });
  assert.equal('no_of_trial' in updates, false);
});

test('planRowUpdate warns about an unreadable date without changing it', () => {
  const { updates, warnings } = imp.planRowUpdate({
    row: sheetRow({ 'Die Received Date': 'sometime' }),
    order: order(),
  });
  assert.equal('die_received_date' in updates, false);
  assert.equal(warnings.some((w) => w.includes('Die Received Date')), true);
});

test('planRowUpdate reports a supplier disagreement but never writes it', () => {
  const { updates, warnings } = imp.planRowUpdate({
    row: sheetRow({ 'Supplier': 'COMPES' }),
    order: order({ supplier: 'PDTMC' }),
  });
  assert.equal('supplier' in updates, false);
  assert.equal(warnings.some((w) => w.includes('COMPES') && w.includes('PDTMC')), true);
});

test('planRowUpdate only ever emits writable columns', () => {
  const { updates } = imp.planRowUpdate({ row: sheetRow(), order: order() });
  for (const col of Object.keys(updates)) {
    assert.equal(imp.WRITABLE_COLUMNS.has(col), true, `${col} is not writable`);
  }
});

test('buildImportPlan sorts rows into matched, not-found and ambiguous', () => {
  const plan = imp.buildImportPlan({
    rows: [
      sheetRow({ 'Die': '027048-2502' }),
      sheetRow({ 'Die': '007122-703' }),
      sheetRow({ 'Die': '030552-3501' }),
    ],
    orders: [
      order({ id: 10, die_no: '027048-2502' }),
      order({ id: 20, die_no: '030552-3501' }),
      order({ id: 21, die_no: '030552-3501' }),
    ],
  });
  assert.deepEqual(plan.updates.map((u) => u.orderId), [10]);
  assert.deepEqual(plan.notFound.map((n) => n.die), ['007122-703']);
  assert.deepEqual(plan.ambiguous.map((a) => a.die), ['030552-3501']);
  assert.equal(plan.updates[0].sheetRow, 2);   // row 1 is the header
});

test('buildImportPlan matches regardless of spacing and case', () => {
  const plan = imp.buildImportPlan({
    rows: [sheetRow({ 'Die': ' 27048-2502 ' })],
    orders: [order({ id: 10, die_no: '27048-2502' })],
  });
  assert.equal(plan.updates.length, 1);
});

test('buildImportPlan separates rows that need no change', () => {
  const plan = imp.buildImportPlan({
    rows: [sheetRow()],
    orders: [order({
      id: 10, die_received_date: '2025-10-24', submission_date: '2025-10-24',
      sample_approval_date: '2025-10-24', corrector: 'Dinesh', sample_status: 'Approved',
    })],
  });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.noop.length, 1);
});

test('buildImportPlan flags a blank die number and a repeated one', () => {
  const plan = imp.buildImportPlan({
    rows: [sheetRow({ 'Die': '  ' }), sheetRow(), sheetRow()],
    orders: [order({ id: 10 })],
  });
  assert.equal(plan.warnings.some((w) => w.includes('blank die number')), true);
  assert.equal(plan.warnings.some((w) => w.includes('later row wins')), true);
});
