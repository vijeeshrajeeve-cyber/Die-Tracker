'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  previousMonth, isMonth, monthLabel, buildSampleApproval, loadSampleApproval,
} = require('./sampleApprovalReportData.cjs');

const REPORT_DATE = '2026-12-01';
const MONTH = '2026-11';
const row = (over = {}) => ({
  source: 'order', id: 1, die: '10001-1', plant: 'GEX 1', press: 'Press 1', customer: 'ACME', dieType: 'SF',
  supplier: 'S', receivedDate: '2026-10-01', submissionDate: '2026-11-10', status: 'Sample Submitted',
  sampleApprovalDate: null, orderStatus: 'Active', corrector: 'Singh', legacyTrials: 0, remark: '', ...over,
});
const build = (rows, extra = {}) => buildSampleApproval({
  rows, trials: [], rejections: [], reportDate: REPORT_DATE, month: MONTH, targetDays: 14, ...extra,
});
const waitingRows = (report) => report.waiting.flatMap(g => g.rows);

test('waiting lists only Sample Submitted', () => {
  const report = build([
    row({ id: 1, die: 'sub' }),
    row({ id: 2, die: 'rej', status: 'Rejected' }),
    row({ id: 3, die: 'app', status: 'Approved' }),
    row({ id: 4, die: 'pend', status: 'Pending' }),
  ]);
  assert.deepEqual(waitingRows(report).map(r => r.die), ['sub']);
  assert.equal(report.header.waiting, 1);
});

test('days waiting and overdue', () => {
  const report = build([
    row({ id: 1, die: 'old', submissionDate: '2026-11-10' }),
    row({ id: 2, die: 'recent', submissionDate: '2026-11-20' }),
    row({ id: 3, die: 'blank', submissionDate: '' }),
    row({ id: 4, die: 'future', submissionDate: '2026-12-05' }),
  ]);
  const by = Object.fromEntries(waitingRows(report).map(r => [r.die, r]));
  assert.equal(by.old.daysWaiting, 21); assert.equal(by.old.overdue, true);
  assert.equal(by.recent.daysWaiting, 11); assert.equal(by.recent.overdue, false);
  assert.equal(by.blank.daysWaiting, null); assert.equal(by.blank.overdue, false);
  assert.equal(by.future.daysWaiting, null); assert.equal(by.future.overdue, false);
  assert.equal(report.header.overdue, 1);
});

test('the target changes overdue', () => {
  const rows = [row({ submissionDate: '2026-11-10' })];
  assert.equal(waitingRows(build(rows))[0].overdue, true);
  assert.equal(waitingRows(build(rows, { targetDays: 30 }))[0].overdue, false);
  assert.equal(build(rows, { targetDays: 30 }).targetDays, 30);
});

test('customers group by normalised name', () => {
  const report = build([
    row({ id: 1, die: 'a', customer: 'ABC Ltd' }),
    row({ id: 2, die: 'b', customer: 'abc ltd ' }),
    row({ id: 3, die: 'c', customer: 'ABC  Ltd' }),
    row({ id: 4, die: 'd', customer: '  ', submissionDate: '2026-10-01' }),
  ]);
  assert.deepEqual(report.waiting.map(g => g.customer), ['ABC Ltd', 'No customer']);
  assert.equal(report.waiting[0].count, 3);
});

test('groups sort by oldest wait', () => {
  const report = build([
    row({ id: 1, customer: 'Mid', submissionDate: '2026-11-01' }),
    row({ id: 2, customer: 'Unknown', submissionDate: '' }),
    row({ id: 3, customer: 'Oldest', submissionDate: '2026-05-06' }),
  ]);
  assert.deepEqual(report.waiting.map(g => g.customer), ['Oldest', 'Mid', 'Unknown']);
  assert.equal(report.waiting[0].oldestDays, 209);
  assert.equal(report.waiting[2].oldestDays, null);
});

test('rows within a group sort by days waiting, null last, then die', () => {
  const report = build([
    row({ id: 1, die: 'z', submissionDate: '2026-11-01' }),
    row({ id: 2, die: 'a', submissionDate: '' }),
    row({ id: 3, die: 'b', submissionDate: '2026-11-01' }),
    row({ id: 4, die: 'c', submissionDate: '2026-10-01' }),
  ]);
  assert.deepEqual(waitingRows(report).map(r => r.die), ['c', 'b', 'z', 'a']);
});

test('approved last month and average', () => {
  const report = build([
    row({ id: 1, status: 'Approved', submissionDate: '2026-11-01', sampleApprovalDate: '2026-11-05' }),
    row({ id: 2, status: 'Approved', submissionDate: '2026-11-01', sampleApprovalDate: '2026-11-10' }),
    row({ id: 3, status: 'Approved', submissionDate: '2026-10-01', sampleApprovalDate: '2026-10-20' }),
  ]);
  assert.equal(report.lastMonth.total.approved, 2);
  assert.equal(report.lastMonth.total.avgDays, 6.5);
  assert.equal(report.header.approved, 2);
  assert.equal(report.header.avgDays, 6.5);
  assert.deepEqual(report.lastMonth.rows, [{ customer: 'ACME', approved: 2, rejected: 0, avgDays: 6.5 }]);
  assert.equal(report.footnotes.excludedFromAverage, 0);

  const odd = build([
    row({ id: 1, status: 'Approved', submissionDate: '2026-11-01', sampleApprovalDate: '2026-11-05' }),
    row({ id: 2, status: 'Approved', submissionDate: '2026-11-20', sampleApprovalDate: '2026-11-10' }),
    row({ id: 3, status: 'Approved', submissionDate: '', sampleApprovalDate: '2026-11-11' }),
  ]);
  assert.equal(odd.lastMonth.total.approved, 3);
  assert.equal(odd.lastMonth.total.avgDays, 4);
  assert.equal(odd.footnotes.excludedFromAverage, 2);
});

test('a month with no approvals has a null average', () => {
  const report = build([row()]);
  assert.equal(report.lastMonth.total.avgDays, null);
  assert.equal(report.header.avgDays, null);
  assert.deepEqual(report.lastMonth.rows, []);
});

test('rejected counts dies once', () => {
  const report = build([row({ id: 5, status: 'Rejected' })], {
    rejections: [{ orderId: 5, date: '2026-11-03' }, { orderId: 5, date: '2026-11-04' }],
  });
  assert.equal(report.lastMonth.total.rejected, 1);

  const both = build([row({ id: 6, status: 'Approved', submissionDate: '2026-11-01', sampleApprovalDate: '2026-11-08' })], {
    rejections: [{ orderId: 6, date: '2026-11-03' }],
  });
  assert.deepEqual(both.lastMonth.rows, [{ customer: 'ACME', approved: 1, rejected: 1, avgDays: 7 }]);
  assert.deepEqual(both.lastMonth.total, { approved: 1, rejected: 1, avgDays: 7 });
  assert.equal(both.footnotes.rejectionsNote, 'Rejections are counted where the status change was recorded in the app.');
});

test('cancelled orders count nowhere', () => {
  const report = build([
    row({ id: 9, status: 'Sample Submitted', orderStatus: 'CANCELLED' }),
    row({ id: 10, status: 'Approved', orderStatus: 'CANCELLED', sampleApprovalDate: '2026-11-05' }),
  ], { rejections: [{ orderId: 9, date: '2026-11-05' }, { orderId: 10, date: '2026-11-06' }] });
  assert.deepEqual(report.waiting, []);
  assert.deepEqual(report.lastMonth.rows, []);
  assert.deepEqual(report.header, { waiting: 0, overdue: 0, approved: 0, avgDays: null });
});

test('last month rows sort alphabetically with No customer last', () => {
  const approved = { status: 'Approved', submissionDate: '2026-11-01', sampleApprovalDate: '2026-11-03' };
  const report = build([
    row({ id: 1, customer: '', ...approved }),
    row({ id: 2, customer: 'Zed', ...approved }),
    row({ id: 3, customer: 'Alpha', ...approved }),
  ]);
  assert.deepEqual(report.lastMonth.rows.map(r => r.customer), ['Alpha', 'Zed', 'No customer']);
});

test('trial counts come from trials, else the legacy count', () => {
  const report = build([
    row({ id: 1, die: 'a', legacyTrials: 3 }),
    row({ id: 2, die: 'b', legacyTrials: 3 }),
  ], { trials: [{ source: 'order', parentId: 2, trialNo: 1 }, { source: 'order', parentId: 2, trialNo: 2 }] });
  const by = Object.fromEntries(waitingRows(report).map(r => [r.die, r]));
  assert.equal(by.a.trialCount, 0); assert.equal(by.a.legacyTrialCount, 3);
  assert.equal(by.b.trialCount, 2); assert.equal(by.b.legacyTrialCount, null);
});

test('previousMonth and isMonth', () => {
  assert.equal(previousMonth('2026-01-15'), '2025-12');
  assert.equal(previousMonth('2026-12-01'), '2026-11');
  assert.equal(isMonth('2026-13'), false);
  assert.equal(isMonth('2026-11'), true);
  assert.equal(isMonth('2026-1'), false);
  assert.equal(monthLabel('2026-11'), 'November 2026');
});

test('report carries its dates and labels', () => {
  const report = build([]);
  assert.equal(report.reportDate, REPORT_DATE);
  assert.equal(report.month, MONTH);
  assert.equal(report.monthLabel, 'November 2026');
});

test('load maps approval dates and queries rejections for the month', async () => {
  const rejectionParams = [];
  const db = {
    async query(sql, params) {
      if (/FROM\s+order_changes/i.test(sql)) {
        rejectionParams.push(params);
        return { rows: [{ order_id: 1, date: '2026-11-04' }, { order_id: 2, date: '2026-11-05' }] };
      }
      if (/FROM\s+die_orders/i.test(sql)) return { rows: [
        { id: 1, die_no: 'D-1', plant: 'GEX 1', press: 'P1', customer_name: 'ACME', die_type: 'SF', supplier: 'S',
          die_received_date: '2026-10-01', submission_date: '2026-11-01', sample_status: 'Approved',
          sample_approval_date: '2026-11-05', order_status: 'Active', corrector: null, no_of_trial: 0, sample_remark: null },
        { id: 2, die_no: 'D-2', plant: 'GEX 1', press: 'P1', customer_name: 'ACME', die_type: 'SF', supplier: 'S',
          die_received_date: '2026-10-01', submission_date: '2026-11-01', sample_status: 'Rejected',
          sample_approval_date: null, order_status: 'CANCELLED', corrector: null, no_of_trial: 0, sample_remark: null },
      ] };
      if (/FROM\s+sample_followups/i.test(sql)) return { rows: [
        { id: 7, profile: 'S-9', plant: 'GEX 2', press: 'P2', customer: 'Solo', supplier: 'S', die_received_date: '2026-10-02',
          submission_date: '2026-11-01', sample_status: 'Approved', sample_approval_date: '2026-11-11', no_of_trial: 0, remark: '', corrector: null },
      ] };
      if (/FROM\s+sample_trials/i.test(sql)) return { rows: [] };
      throw new Error('unexpected sql ' + sql);
    },
  };
  const report = await loadSampleApproval(db, { reportDate: REPORT_DATE });
  assert.deepEqual(rejectionParams, [['2026-11-01', '2026-11-30']]);
  assert.equal(report.month, '2026-11');
  assert.equal(report.targetDays, 14);
  // die 1 was rejected then approved (counts in both); die 2 is cancelled so its rejection is not counted.
  assert.deepEqual(report.lastMonth.rows, [
    { customer: 'ACME', approved: 1, rejected: 1, avgDays: 4 },
    { customer: 'Solo', approved: 1, rejected: 0, avgDays: 10 },
  ]);
  assert.deepEqual(report.lastMonth.total, { approved: 2, rejected: 1, avgDays: 7 });
});

test('load uses the given month for the rejection range', async () => {
  const params = [];
  const db = {
    async query(sql, p) {
      if (/order_changes/i.test(sql)) { params.push(p); return { rows: [] }; }
      return { rows: [] };
    },
  };
  await loadSampleApproval(db, { reportDate: '2026-03-02', month: '2026-02', targetDays: 30 });
  assert.deepEqual(params, [['2026-02-01', '2026-02-28']]);
});
