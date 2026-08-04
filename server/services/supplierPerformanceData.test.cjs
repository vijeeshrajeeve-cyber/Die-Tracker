'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./supplierPerformanceData.cjs');

const makePool = (rowsFor) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [pattern, rows] of rowsFor) if (pattern.test(sql)) return { rows };
      return { rows: [] };
    },
  };
};

test('periodRange Monthly covers just that month', () => {
  assert.deepEqual(d.periodRange({ year: 2026, month: 'Feb', frequency: 'Monthly' }),
    { from: '2026-02-01', to: '2026-02-28' });
});

test('periodRange Monthly handles a leap February and a 31-day month', () => {
  assert.equal(d.periodRange({ year: 2024, month: 'Feb', frequency: 'Monthly' }).to, '2024-02-29');
  assert.equal(d.periodRange({ year: 2026, month: 'Jul', frequency: 'Monthly' }).to, '2026-07-31');
});

test('periodRange Quarterly runs from the quarter start to the selected month', () => {
  assert.deepEqual(d.periodRange({ year: 2026, month: 'May', frequency: 'Quarterly' }),
    { from: '2026-04-01', to: '2026-05-31' });
});

test('periodRange YTD runs from January', () => {
  assert.deepEqual(d.periodRange({ year: 2026, month: 'Mar', frequency: 'YTD' }),
    { from: '2026-01-01', to: '2026-03-31' });
});

test('getSnapshot returns nulls rather than zeros when nothing matches', async () => {
  const pool = makePool([[/./, [{}]]]);
  const snap = await d.getSnapshot(pool, { supplier: 'NOBODY', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(snap.designLeadTime, null);
  assert.equal(snap.trialRatio, null);
  assert.equal(snap.qdRate, null);
  assert.equal(snap.ordersPlaced, 0, 'a count of nothing is genuinely zero, not unknown');
});

test('getSnapshot computes QD rate as a percentage of dies received', async () => {
  const pool = makePool([
    [/FROM die_orders[\s\S]*ordered_date BETWEEN/, [{ orders_placed: '10', design_lead_time: '2.5', trial_ratio: '1.5', design_revisions: '0.5' }]],
    [/FROM die_orders[\s\S]*die_received_date BETWEEN/, [{ delivery_lead_time: '25', dies_received: '8' }]],
    [/FROM quality_discrepancies/, [{ qd_count: '2' }]],
  ]);
  const snap = await d.getSnapshot(pool, { supplier: 'PHME', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(snap.qdRate, 25); // 2 of 8
  assert.equal(snap.deliveryLeadTime, 25);
  assert.equal(snap.ordersPlaced, 10);
});

test('getSnapshot leaves QD rate null when no dies were received', async () => {
  const pool = makePool([
    [/FROM die_orders[\s\S]*ordered_date BETWEEN/, [{ orders_placed: '3' }]],
    [/FROM die_orders[\s\S]*die_received_date BETWEEN/, [{ dies_received: '0' }]],
    [/FROM quality_discrepancies/, [{ qd_count: '0' }]],
  ]);
  const snap = await d.getSnapshot(pool, { supplier: 'X', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(snap.qdRate, null, '0 of 0 is unknown, not 0%');
});

test('getSnapshot matches supplier case-insensitively', async () => {
  const pool = makePool([[/./, [{}]]]);
  await d.getSnapshot(pool, { supplier: 'phme', from: '2026-01-01', to: '2026-01-31' });
  assert.ok(pool.calls.every(c => /upper\(btrim/i.test(c.sql)), 'supplier match must be case and space insensitive');
});

test('getMonthlyTrend returns one row per month through the selected one', async () => {
  const pool = makePool([[/./, [{}]]]);
  const trend = await d.getMonthlyTrend(pool, { supplier: 'PHME', year: 2026, throughMonth: 'Mar' });
  assert.deepEqual(trend.map(r => r.month), ['Jan', 'Feb', 'Mar']);
});
