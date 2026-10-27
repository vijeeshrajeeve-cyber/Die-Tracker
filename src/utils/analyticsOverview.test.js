import test from 'node:test';
import assert from 'node:assert/strict';
import { median, daysBetween, leadTimesBy, supplierProgress, orderYear } from './analyticsOverview.js';

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
  const [row] = leadTimesBy(orders, (o) => o.Supplier, (o) => o.from, (o) => o.to);
  assert.equal(row.medianDays, 13);
  assert.equal(row.count, 4);
  assert.equal(row.label, '13d (4)');
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
