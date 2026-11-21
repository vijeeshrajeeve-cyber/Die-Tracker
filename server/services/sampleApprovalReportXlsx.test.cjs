'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { buildSampleApproval } = require('./sampleApprovalReportData.cjs');
const { generateSampleApprovalXlsx } = require('./sampleApprovalReportXlsx.cjs');

const base = { source: 'order', plant: 'GEX 1', press: 'PRESS 4', corrector: 'erive', remark: '', legacyTrials: 0, receivedDate: '2026-03-01', orderStatus: 'IN PROGRESS' };
function fixtureReport() {
  const rows = [
    { ...base, id: 1, customer: 'ABC Ltd', die: '032064-2501', status: 'Sample Submitted', submissionDate: '2026-04-27', remark: 'Chased by phone' },
    { ...base, id: 2, customer: 'ABC Ltd', die: '032064-2502', status: 'Sample Submitted', submissionDate: '', legacyTrials: 3 },
    { ...base, id: 3, customer: 'XYZ Co', die: '99-1', status: 'Approved', submissionDate: '2026-10-01', sampleApprovalDate: '2026-10-11' },
    { ...base, id: 4, customer: 'No Avg Co', die: '99-2', status: 'Approved', submissionDate: '', sampleApprovalDate: '2026-10-12' },
  ];
  return buildSampleApproval({ rows, trials: [], rejections: [], reportDate: '2026-11-21', month: '2026-10', targetDays: 14 });
}
const gen = (r) => XLSX.read(generateSampleApprovalXlsx(r, { generatedAt: new Date(2026, 10, 21, 8, 0) }), { type: 'buffer', cellDates: true });
const sheetRows = (wb, n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });

test('three sheets in order', () => {
  assert.deepEqual(gen(fixtureReport()).SheetNames, ['Waiting', 'Last month', 'About']);
});

test('waiting rows carry real dates and numbers', () => {
  const report = fixtureReport();
  const rows = sheetRows(gen(report), 'Waiting');
  const r = rows.find((x) => x['Die #'] === '032064-2501');
  assert.ok(r['Submitted'] instanceof Date);
  assert.equal(r['Submitted'].toISOString().slice(0, 10), '2026-04-27');
  assert.equal(r['Days waiting'], 208);
  assert.equal(r['Overdue'], 'Yes');
  const u = rows.find((x) => x['Die #'] === '032064-2502');
  assert.equal(u['Days waiting'], null);
  assert.equal(u['Submitted'], null);
  assert.equal(u['Overdue'], 'No');
  assert.equal(u['Trials'], 3);
  assert.equal(rows.length, report.header.waiting);
});

test('last month has a total row and blank null averages', () => {
  const report = fixtureReport();
  const rows = sheetRows(gen(report), 'Last month');
  const last = rows[rows.length - 1];
  assert.equal(last['Customer'], 'Total');
  assert.equal(last['Approved'], report.lastMonth.total.approved);
  assert.equal(last['Rejected'], report.lastMonth.total.rejected);
  assert.equal(rows.find((x) => x['Customer'] === 'No Avg Co')['Avg days to approval'], null);
  assert.equal(rows.find((x) => x['Customer'] === 'XYZ Co')['Avg days to approval'], 10);
});

test('autofilter on both data sheets', () => {
  const wb = gen(fixtureReport());
  assert.ok(wb.Sheets['Waiting']['!autofilter']);
  assert.ok(wb.Sheets['Last month']['!autofilter']);
});

test('about sheet carries settings and footnotes', () => {
  const wb = gen(fixtureReport());
  const text = XLSX.utils.sheet_to_json(wb.Sheets['About'], { header: 1 }).map((r) => r.join('|')).join('\n');
  assert.match(text, /Report month\|October 2026/);
  assert.match(text, /Target days\|14/);
  assert.match(text, /Waiting now\|2/);
  assert.match(text, /Rejections are counted where the status change was recorded in the app\./);
  assert.match(text, /1 approval\(s\) had no usable submission date/);
});

test('returns a Buffer and handles empty report', () => {
  const empty = buildSampleApproval({ rows: [], trials: [], rejections: [], reportDate: '2026-11-21', month: '2026-10', targetDays: 14 });
  assert.ok(Buffer.isBuffer(generateSampleApprovalXlsx(empty, { generatedAt: new Date() })));
});
