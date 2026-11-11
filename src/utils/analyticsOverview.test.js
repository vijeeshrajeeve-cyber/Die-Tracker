import test from 'node:test';
import assert from 'node:assert/strict';
import { median, daysBetween, leadTimesBy, outOfOrderDates, supplierProgress, orderYear } from './analyticsOverview.js';

test('median of odd and even counts', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([]), null);
});

test('an outlier moves the mean but not the median', () => {
  const orders = [10, 12, 14, 243].map((d, i) => ({
    Supplier: 'PDTMC',
    from: '2026-01-01',
    to: new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10),
    i,
  }));
  const [row] = leadTimesBy(orders, (o) => o.Supplier, (o) => o.from, (o) => o.to, 'median');
  assert.equal(row.medianDays, 13);
  assert.equal(row.avgDays, 69.8);
  assert.equal(row.count, 4);
  assert.equal(row.days, 13);
  assert.equal(row.label, '13d (4)');
});

test('the average is what the bars show unless the median is asked for', () => {
  const orders = [
    { s: 'SLOW', f: '2026-01-01', t: '2026-01-11' },
    { s: 'SLOW', f: '2026-01-01', t: '2026-01-11' },
    { s: 'SLOW', f: '2026-01-01', t: '2026-04-11' },
    { s: 'STEADY', f: '2026-01-01', t: '2026-01-21' },
  ];
  const args = [orders, (o) => o.s, (o) => o.f, (o) => o.t];
  const byAverage = leadTimesBy(...args);
  assert.deepEqual(byAverage.map((r) => [r.name, r.days, r.label]), [
    ['STEADY', 20, '20d (1)'],
    ['SLOW', 40, '40d (3)'],
  ]);
  // The same orders rank the other way round by median.
  const byMedian = leadTimesBy(...args, 'median');
  assert.deepEqual(byMedian.map((r) => [r.name, r.days]), [['SLOW', 10], ['STEADY', 20]]);
});

test('an average keeps one decimal place', () => {
  const [row] = leadTimesBy(
    [{ s: 'A', f: '2026-01-01', t: '2026-01-02' }, { s: 'A', f: '2026-01-01', t: '2026-01-03' }, { s: 'A', f: '2026-01-01', t: '2026-01-03' }],
    (o) => o.s, (o) => o.f, (o) => o.t,
  );
  assert.equal(row.avgDays, 1.7);
  assert.equal(row.label, '1.7d (3)');
});

test('orders whose second date is before the first are listed, not lost', () => {
  const orders = [
    { 'DIE NO': '111', s: 'A', f: '2026-03-10', t: '2026-03-01' },
    { 'DIE NO': '222', s: 'A', f: '2026-03-01', t: '2026-03-10' },
    { 'DIE NO': '333', s: 'A', f: '2026-03-01', t: null },
    { 'DIE NO': '444', s: '', f: '2026-03-10', t: '2026-03-01' },
  ];
  const bad = outOfOrderDates(orders, (o) => o.s, (o) => o.f, (o) => o.t);
  assert.deepEqual(bad, [{ order: orders[0], from: '2026-03-10', to: '2026-03-01' }]);
});

test('dates out of order or missing are left out, not counted as zero', () => {
  assert.equal(daysBetween('2026-03-10', '2026-03-01'), null);
  assert.equal(daysBetween('', '2026-03-01'), null);
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  const rows = leadTimesBy(
    [{ s: 'A', f: '2026-03-10', t: '2026-03-01' }, { s: 'A', f: '2026-03-01', t: null }],
    (o) => o.s, (o) => o.f, (o) => o.t,
  );
  assert.deepEqual(rows, []);
});

test('supplier progress splits open orders by design approval and skips cancelled', () => {
  const row = supplierProgress([
    { STATUS: 'DONE', 'Design Approved Date': '2026-02-01', 'Die Received Date': '2026-03-01' },
    { STATUS: 'DONE', 'Design Approved Date': '2026-02-01' },
    { STATUS: 'PENDING FOR ORACLE ENTRY', design_approved_date: '2026-02-03' },
    { STATUS: 'PENDING FOR DESIGN APPROVAL' },
    { STATUS: 'CANCELLED', 'Design Approved Date': '2026-02-01' },
  ]);
  assert.deepEqual(row, { total: 4, received: 1, withSupplier: 2, beforeApproval: 1 });
});

test('order year comes from the die requested date', () => {
  assert.equal(orderYear({ 'Die Requested Date': '2027-01-01' }), '2027');
  assert.equal(orderYear({ 'Ordered date': '2026-05-01' }), null);
});
