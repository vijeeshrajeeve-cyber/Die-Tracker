'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./supplierTrialRatio.cjs');

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

// ---------- combineTrialRatio ----------

test('combineTrialRatio with no corrections equals the average over every die', () => {
  // 10 dies at 1.0 and 30 dies at 2.0 -> (10 + 60) / 40
  const out = t.combineTrialRatio([
    { month: 1, ratio: 1, dies: 10 },
    { month: 2, ratio: 2, dies: 30 },
  ], []);
  assert.equal(out, 1.75);
});

test('combineTrialRatio swaps in a corrected month and keeps that month\'s weight', () => {
  const out = t.combineTrialRatio([
    { month: 1, ratio: 1, dies: 10 },
    { month: 2, ratio: 2, dies: 30 },
  ], [{ month: 2, value: 1 }]);
  assert.equal(out, 1);
});

test('combineTrialRatio counts a corrected month that has no dies of its own', () => {
  assert.equal(t.combineTrialRatio([], [{ month: 3, value: 1.4 }]), 1.4);
  assert.equal(t.combineTrialRatio([{ month: 3, ratio: null, dies: 0 }], [{ month: 3, value: 1.4 }]), 1.4);
});

test('combineTrialRatio returns null when there is nothing to go on', () => {
  assert.equal(t.combineTrialRatio([], []), null);
  assert.equal(t.combineTrialRatio([{ month: 1, ratio: null, dies: 0 }], []), null);
});

// ---------- listTrialRatios ----------

test('listTrialRatios shows the calculated figure, and the correction over it', async () => {
  const pool = makePool([
    [/FROM die_orders/, [
      { supplier_key: 'PHME', month: 11, ratio: '1.5', dies: '4' },
      { supplier_key: 'ALMAX', month: 11, ratio: '2', dies: '1' },
    ]],
    [/FROM supplier_trial_ratio_corrections/, [
      { supplier_key: 'PHME', month: 11, corrected_value: '1.2', reason: 'two trials double-counted',
        changed_by_name: 'admin', changed_at: '2026-11-11T08:00:00Z' },
    ]],
  ]);
  const rows = await t.listTrialRatios(pool, { year: 2026, month: 11 });
  const phme = rows.find((r) => r.supplierKey === 'PHME');
  assert.equal(phme.calculated, 1.5);
  assert.equal(phme.corrected, 1.2);
  assert.equal(phme.reason, 'two trials double-counted');
  assert.equal(phme.correctedBy, 'admin');
  const almax = rows.find((r) => r.supplierKey === 'ALMAX');
  assert.equal(almax.calculated, 2);
  assert.equal(almax.corrected, null);
});

test('a removed correction falls back to the calculated figure', async () => {
  const pool = makePool([
    [/FROM die_orders/, [{ supplier_key: 'PHME', month: 11, ratio: '1.5', dies: '4' }]],
    [/FROM supplier_trial_ratio_corrections/, [
      { supplier_key: 'PHME', month: 11, corrected_value: null, reason: 'orders fixed' },
    ]],
  ]);
  const rows = await t.listTrialRatios(pool, { year: 2026, month: 11 });
  assert.equal(rows[0].corrected, null);
  assert.equal(rows[0].calculated, 1.5);
});

// ---------- saveCorrection ----------

test('saveCorrection refuses a change with no reason', async () => {
  const pool = makePool([]);
  await assert.rejects(
    () => t.saveCorrection(pool, { supplier: 'PHME', year: 2026, month: 11, value: 1.2, reason: '  ' }, 1),
    (e) => e.status === 400 && /reason/i.test(e.message)
  );
  assert.equal(pool.calls.length, 0);
});

test('saveCorrection refuses a negative or non-numeric figure', async () => {
  const pool = makePool([]);
  const base = { supplier: 'PHME', year: 2026, month: 11, reason: 'fix' };
  await assert.rejects(() => t.saveCorrection(pool, { ...base, value: -1 }, 1), (e) => e.status === 400);
  await assert.rejects(() => t.saveCorrection(pool, { ...base, value: 'abc' }, 1), (e) => e.status === 400);
});

test('saveCorrection logs the calculated figure, the new figure, the reason and who', async () => {
  const pool = makePool([[/FROM die_orders/, [{ supplier_key: 'PHME', month: 11, ratio: '1.5', dies: '4' }]]]);
  await t.saveCorrection(pool, { supplier: ' PHME ', year: 2026, month: 11, value: '1.2', reason: ' recount ' }, 9);
  const ins = pool.calls.find((c) => /INSERT INTO supplier_trial_ratio_corrections/.test(c.sql));
  assert.deepEqual(ins.params, ['PHME', 2026, 11, 1.5, 1.2, 'recount', 9]);
});

test('saveCorrection with a blank figure logs the removal rather than deleting history', async () => {
  const pool = makePool([[/FROM die_orders/, [{ supplier_key: 'PHME', month: 11, ratio: '1.5', dies: '4' }]]]);
  await t.saveCorrection(pool, { supplier: 'PHME', year: 2026, month: 11, value: '', reason: 'orders fixed' }, 9);
  const ins = pool.calls.find((c) => /INSERT INTO supplier_trial_ratio_corrections/.test(c.sql));
  assert.equal(ins.params[4], null);
  assert.ok(!pool.calls.some((c) => /DELETE/i.test(c.sql)));
});
