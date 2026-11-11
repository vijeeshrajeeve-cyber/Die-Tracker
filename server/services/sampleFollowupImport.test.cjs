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
      submission_date: '2025-10-24',
      sample_approval_date: '2025-10-24', corrector: 'Dinesh',
      sample_status: 'Approved',
    }),
  });
  assert.deepEqual(updates, {});
});

test('planRowUpdate never writes the die received date', () => {
  const { updates } = imp.planRowUpdate({
    row: sheetRow({ 'Die Received Date': 45954 }),
    order: order(),
  });
  assert.equal('die_received_date' in updates, false);
  assert.equal(imp.WRITABLE_COLUMNS.has('die_received_date'), false);
});

test('planRowUpdate keeps an existing value and reports the difference', () => {
  const { updates, conflicts } = imp.planRowUpdate({
    row: sheetRow({ 'Submission Date': 45954, 'Corrector': 'Dinesh', 'No. of Trial': 3 }),
    order: order({ submission_date: '2026-01-15', corrector: 'Kailash', no_of_trial: 2 }),
  });
  assert.equal('submission_date' in updates, false);
  assert.equal('corrector' in updates, false);
  assert.equal('no_of_trial' in updates, false);
  assert.deepEqual(conflicts, [
    { col: 'submission_date', current: '2026-01-15', sheet: '2025-10-24' },
    { col: 'no_of_trial', current: 2, sheet: 3 },
    { col: 'corrector', current: 'Kailash', sheet: 'Dinesh' },
  ]);
});

test('planRowUpdate treats the default trial count of 0 as blank', () => {
  const { updates, conflicts } = imp.planRowUpdate({
    row: sheetRow({ 'No. of Trial': 2 }),
    order: order({ no_of_trial: 0 }),
  });
  assert.equal(updates.no_of_trial, 2);
  assert.equal(conflicts.length, 0);
});

test('planRowUpdate does not call a capitalisation difference a conflict', () => {
  const { updates, conflicts } = imp.planRowUpdate({
    row: sheetRow({ 'Corrector': 'DINESH' }),
    order: order({ corrector: 'Dinesh' }),
  });
  assert.equal('corrector' in updates, false);
  assert.equal(conflicts.length, 0);
});

test('planRowUpdate leaves the trial count alone when trials are logged', () => {
  const { updates, trialsIgnored } = imp.planRowUpdate({
    row: sheetRow({ 'No. of Trial': 5 }),
    order: order(),
    loggedTrials: 2,
  });
  assert.equal('no_of_trial' in updates, false);
  assert.deepEqual(trialsIgnored, { logged: 2, sheet: 5 });
});

test('planRowUpdate raises nothing when the sheet agrees with logged trials', () => {
  const { trialsIgnored } = imp.planRowUpdate({
    row: sheetRow({ 'No. of Trial': 2 }),
    order: order(),
    loggedTrials: 2,
  });
  assert.equal(trialsIgnored, null);
});

test('planRowUpdate warns when an approval date lands on a Rejected sample', () => {
  const { updates, warnings } = imp.planRowUpdate({
    row: sheetRow(),
    order: order({ sample_status: 'Rejected' }),
  });
  assert.equal(updates.sample_approval_date, '2025-10-24');
  assert.equal('sample_status' in updates, false);
  assert.equal(warnings.some((w) => w.includes('Rejected')), true);
});

test('readColumn accepts the other spellings of each header', () => {
  const row = {
    'die no': '1', 'Sample Submission Date': 45954, 'SAMPLE APPROVAL': 46085,
    'Number of Trials ': 2, 'Corrector Name': 'Dinesh',
  };
  assert.equal(imp.readColumn(row, 'die'), '1');
  assert.equal(imp.readColumn(row, 'submission'), 45954);
  assert.equal(imp.readColumn(row, 'approval'), 46085);
  assert.equal(imp.readColumn(row, 'trials'), 2);
  assert.equal(imp.readColumn(row, 'corrector'), 'Dinesh');
});

test('checkColumns names the columns a sheet is missing', () => {
  assert.deepEqual(imp.checkColumns([sheetRow()]), { missing: [] });
  assert.deepEqual(
    imp.checkColumns([{ 'Die': '1', 'Submission Dt': 45954, 'Corrector': 'A' }]).missing,
    ['Submission Date', 'Sample Approval Date', 'No. of Trial'],
  );
});

test('correctorInDropdown follows the plant rule of the Corrector dropdown', () => {
  const list = [
    { name: 'Dinesh', plant: 'GEX 01', is_active: true },
    { name: 'Kailash', plant: 'GEX 02', is_active: true },
    { name: 'Old', plant: 'GEX 01', is_active: false },
  ];
  assert.equal(imp.correctorInDropdown(list, 'GEX 1', 'Dinesh'), true);   // loose plant match
  assert.equal(imp.correctorInDropdown(list, 'GEX 1', 'Kailash'), false); // other plant
  assert.equal(imp.correctorInDropdown(list, 'GEX 1', 'Old'), false);     // deactivated
  assert.equal(imp.correctorInDropdown(list, 'GEX 9', 'Kailash'), true);  // nobody assigned: all active
  assert.equal(imp.correctorInDropdown(list, 'GEX 1', 'dinesh'), false);  // saved as typed
});

test('ledgerRows marks newly written past submissions as already reported', () => {
  const plan = {
    updates: [
      { orderId: 1, before: { type: 'N' }, updates: { submission_date: '2026-03-01' } },
      { orderId: 2, before: { type: 'B' }, updates: { submission_date: '2026-03-02' } },
      { orderId: 3, before: { type: 'T' }, updates: { submission_date: '2026-03-03' } },
      { orderId: 4, before: { type: 'N' }, updates: { corrector: 'Dinesh' } },
      { orderId: 5, before: { type: 'N' }, updates: { submission_date: '2026-11-01' } },
    ],
  };
  assert.deepEqual(imp.ledgerRows(plan, '2026-11-01'), [
    { orderId: 1, stage: 'sample_new', stageDate: '2026-03-01' },
    { orderId: 2, stage: 'sample_backup', stageDate: '2026-03-02' },
    { orderId: 3, stage: 'sample_other', stageDate: '2026-03-03' },
  ]);
});

test('ledgerRows uses the stage keys the Daily Summary counts', () => {
  const { STAGES } = require('./dailySummaryData.cjs');
  const stageFor = (type) => STAGES.find((s) => s.column === 'submission_date' && s.match({ type })).key;
  for (const type of ['N', 'B', 'T', null]) {
    const plan = { updates: [{ orderId: 1, before: { type }, updates: { submission_date: '2026-03-01' } }] };
    assert.equal(imp.ledgerRows(plan, '2026-11-01')[0].stage, stageFor(type));
  }
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
    row: sheetRow({ 'Submission Date': 'sometime' }),
    order: order(),
  });
  assert.equal('submission_date' in updates, false);
  assert.equal(warnings.some((w) => w.includes('Submission Date')), true);
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

test('buildImportPlan collects every list the report needs to flag', () => {
  const plan = imp.buildImportPlan({
    rows: [
      sheetRow({ 'Die': 'A', 'Corrector': 'Stranger' }),
      sheetRow({ 'Die': 'B', 'Corrector': 'Stranger', 'No. of Trial': 4 }),
      sheetRow({ 'Die': 'C', 'Corrector': 'Dinesh' }),
      sheetRow({ 'Die': 'D' }),
    ],
    orders: [
      order({ id: 1, die_no: 'A', die_received_date: null }),
      order({ id: 2, die_no: 'B', die_received_date: '2025-01-01' }),
      order({ id: 3, die_no: 'C', die_received_date: '2025-01-01', corrector: 'Kailash' }),
    ],
    correctors: [{ name: 'Dinesh', plant: 'GEX 2', is_active: true }],
    loggedTrials: new Map([[2, 1]]),
    standaloneProfiles: new Set(['D']),
  });
  assert.deepEqual(plan.notReceived.map((e) => e.orderId), [1]);
  assert.deepEqual(plan.unknownCorrectors, [{ name: 'Stranger', dies: ['A', 'B'] }]);
  assert.deepEqual(plan.trialsIgnored.map((e) => e.orderId), [2]);
  assert.deepEqual(plan.conflicts.map((e) => e.die), ['C']);
  assert.deepEqual(plan.standalone.map((e) => e.die), ['D']);
  assert.equal(plan.notFound.length, 0);
});

test('buildImportPlan flags a blank die number and a repeated one', () => {
  const plan = imp.buildImportPlan({
    rows: [sheetRow({ 'Die': '  ' }), sheetRow(), sheetRow()],
    orders: [order({ id: 10 })],
  });
  assert.equal(plan.warnings.some((w) => w.includes('blank die number')), true);
  assert.equal(plan.warnings.some((w) => w.includes('later row wins')), true);
});
