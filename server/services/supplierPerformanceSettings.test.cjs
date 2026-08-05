'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./supplierPerformanceSettings.cjs');

const makePool = (replies = []) => {
  const calls = [];
  let i = 0;
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return replies[i++] || { rows: [] }; } };
};

test('METRIC_DEFAULTS weights total exactly 1', () => {
  const total = s.METRIC_DEFAULTS.filter(m => m.scored).reduce((a, m) => a + m.weight, 0);
  assert.equal(Math.round(total * 1000) / 1000, 1);
});

test('METRIC_DEFAULTS omits die life and die failure', () => {
  const keys = s.METRIC_DEFAULTS.map(m => m.key);
  assert.ok(!keys.includes('dieLife'), 'die life is not tracked and must not appear');
  assert.ok(!keys.includes('dieFailure'), 'die failure is not tracked and must not appear');
});

test('getSettings returns the code defaults when no row exists', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.deepEqual(await s.getSettings(pool, 2026), s.METRIC_DEFAULTS);
});

test('getSettings merges stored tunables over the defaults', async () => {
  const pool = makePool([{ rows: [{ metrics: JSON.stringify([{ key: 'designLeadTime', target: 2, ten: 2, zero: 8, weight: 0.15 }]) }] }]);
  const out = await s.getSettings(pool, 2026);
  const dlt = out.find(m => m.key === 'designLeadTime');
  assert.equal(dlt.target, 2);
  assert.equal(dlt.zero, 8);
  assert.equal(dlt.label, 'Avg Design Lead Time', 'label comes from code, not the database');
});

test('getSettings falls back to defaults when the stored JSON is junk', async () => {
  const pool = makePool([{ rows: [{ metrics: 'not json' }] }]);
  assert.deepEqual(await s.getSettings(pool, 2026), s.METRIC_DEFAULTS);
});

test('getSettings asks only for years at or before the one requested', async () => {
  // The whole point of year scoping: setting 2027's targets must not rescore a
  // 2026 report that was already sent to a supplier.
  const pool = makePool([{ rows: [] }]);
  await s.getSettings(pool, 2026);
  assert.ok(/year <= \$1/.test(pool.calls[0].sql), 'must not resolve forward');
  assert.ok(/ORDER BY year DESC/.test(pool.calls[0].sql), 'nearest earlier year wins');
  assert.deepEqual(pool.calls[0].params, [2026]);
});

test('getSettings defaults to the current year when none is given', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.getSettings(pool);
  assert.equal(pool.calls[0].params[0], new Date().getFullYear());
});

test('saveSettings upserts against the given year', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveSettings(pool, 2027, s.METRIC_DEFAULTS);
  const ins = pool.calls.find(c => /INSERT INTO supplier_performance_settings/.test(c.sql));
  assert.ok(/ON CONFLICT \(year\)/.test(ins.sql));
  assert.equal(ins.params[0], 2027);
});

test('saveSettings rejects a missing year', async () => {
  const pool = makePool([]);
  await assert.rejects(() => s.saveSettings(pool, null, s.METRIC_DEFAULTS), (e) => e.status === 400);
});

test('validateMetrics rejects weights that do not total 1', () => {
  const bad = s.METRIC_DEFAULTS.map(m => (m.key === 'qdRate' ? { ...m, weight: 0.5 } : m));
  assert.throws(() => s.validateMetrics(bad), (e) => e.status === 400 && /total/i.test(e.message));
});

test('validateMetrics rejects ten equal to zero', () => {
  const bad = s.METRIC_DEFAULTS.map(m => (m.key === 'trialRatio' ? { ...m, ten: 2, zero: 2 } : m));
  assert.throws(() => s.validateMetrics(bad), (e) => e.status === 400);
});

test('validateMetrics accepts the defaults unchanged', () => {
  assert.doesNotThrow(() => s.validateMetrics(s.METRIC_DEFAULTS));
});

test('saveSettings persists only the tunable fields', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveSettings(pool, 2026, s.METRIC_DEFAULTS);
  const ins = pool.calls.find(c => /INSERT INTO supplier_performance_settings/.test(c.sql));
  const stored = JSON.parse(ins.params[1]);
  assert.deepEqual(Object.keys(stored[0]).sort(), ['key', 'target', 'ten', 'weight', 'zero']);
});
