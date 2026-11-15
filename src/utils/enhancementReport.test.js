import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnhancementSheets, enhancementReportFilename } from './enhancementReport.js';
import { buildSheetData } from './exportExcel.js';

const trio = (baseline, target, actual) => ({ baseline, target, actual });
const project = (o = {}) => ({
  die_order_id: 1, die_no: '29663-253', profile: '29663', supplier: 'Alpha', current_issue: 'Weld lines',
  productivity: trio(100, 120, 130), recovery: trio(70, 75, null), failure: trio(10, null, 5),
  trial_verdict: 'Achieved', final_verdict: 'Achieved', final_verdict_date: '2026-03-15', state: 'Completed', ...o,
});
const average = (baseline, actual) => ({ baseline, actual, change: actual - baseline, count: 1 });
const summary = (o = {}) => ({
  totals: { started: 2, completed: 1, achieved: 1, partly: 0, notAchieved: 0, successRate: 1, awaitingLifeReview: 0, open: 1 },
  months: [{ month: '2026-03', started: 2, achieved: 1, partly: 0, notAchieved: 0 }],
  averages: { productivity: average(100, 130), recovery: { baseline: null, actual: null, change: null, count: 0 }, failure: average(10, 5) },
  completed: [project()], started: [project(), project({ die_order_id: 2, die_no: 'D-1', profile: 'D' })], open: [project({ die_order_id: 2, final_verdict: null, final_verdict_date: null })],
  ...o,
});
const labels = (sheet) => sheet.columns.map((c) => c.label);

test('four sheets: Summary, Completed, Started, Open', () => {
  assert.deepEqual(buildEnhancementSheets(summary()).map((s) => s.name), ['Summary', 'Completed', 'Started', 'Open']);
});

test('Completed has one row per project with profile, baseline, target, actual and verdict columns', () => {
  const sheet = buildEnhancementSheets(summary()).find((s) => s.name === 'Completed');
  assert.equal(sheet.rows.length, 1);
  const l = labels(sheet);
  assert.equal(l[0], 'Die no');
  assert.equal(l[1], 'Profile');
  for (const need of ['Productivity baseline (kg/h)', 'Productivity target (kg/h)', 'Productivity actual (kg/h)',
    'Recovery actual (%)', 'Failure target (%)', 'Trial verdict', 'Final verdict']) {
    assert.ok(l.includes(need), need);
  }
  const [row] = buildSheetData({ rows: sheet.rows, columns: sheet.columns });
  assert.equal(row['Die no'], '29663-253');
  assert.equal(row.Profile, '29663');
  assert.equal(row['Productivity actual (kg/h)'], 130);
  assert.equal(row['Final verdict'], 'Achieved');
});

test('a blank number is an empty cell, never 0', () => {
  const sheet = buildEnhancementSheets(summary()).find((s) => s.name === 'Completed');
  const [row] = buildSheetData({ rows: sheet.rows, columns: sheet.columns });
  assert.equal(row['Recovery actual (%)'], '');
  assert.equal(row['Failure target (%)'], '');
  assert.equal(row['Recovery baseline (%)'], 70);
});

test('the Summary sheet holds the totals, the success rate as a number and the monthly counts', () => {
  const sheet = buildEnhancementSheets(summary()).find((s) => s.name === 'Summary');
  const find = (m) => sheet.rows.find((r) => r.measure === m);
  assert.equal(find('Projects started').value, 2);
  assert.equal(find('Success rate').value, 100);
  assert.equal(find('Success rate').unit, '%');
  assert.equal(find('Average recovery change').value, '');
  assert.equal(find('Average productivity change').value, 30);
  assert.ok(sheet.rows.some((r) => r.section === 'By month' && r.measure === 'Mar 26 started' && r.value === 2));
});

test('an empty period still gives four sheets, the project ones with no rows', () => {
  const empty = summary({
    totals: { started: 0, completed: 0, achieved: 0, partly: 0, notAchieved: 0, successRate: null, awaitingLifeReview: 0, open: 0 },
    completed: [], started: [], open: [],
  });
  const sheets = buildEnhancementSheets(empty);
  assert.equal(sheets.length, 4);
  assert.equal(sheets[1].rows.length, 0);
  assert.equal(sheets[0].rows.find((r) => r.measure === 'Success rate').value, '');
});

test('the filename names the period', () => {
  assert.equal(enhancementReportFilename('2026-01-01', '2026-12-31', 'xlsx'), 'Enhancement-Report-2026-01-01-to-2026-12-31.xlsx');
});
