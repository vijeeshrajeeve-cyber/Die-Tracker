'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./supplierDieLife.cjs');

// ---------- validateEntry / aggregateDieLife ----------

const { aggregateDieLife, validateEntry } = s;
const row = (o) => ({ tonnageMt: null, diesScrapped: null, diesInService: null, diesFailed: null,
  newDiesReceived: null, newDieTrials: null, backupDiesReceived: null, backupDieTrials: null, ...o });

test('die life is total tonnage over total dies scrapped', () => {
  const a = aggregateDieLife([row({ tonnageMt: 420, diesScrapped: 6 }), row({ tonnageMt: 150, diesScrapped: 0 })]);
  assert.equal(a.dieLife, 95); assert.equal(a.noDiesScrapped, false);
});
test('tonnage with no die scrapped has no die life', () => {
  const a = aggregateDieLife([row({ tonnageMt: 150, diesScrapped: 0 })]);
  assert.equal(a.dieLife, null); assert.equal(a.noDiesScrapped, true);
});
test('a row missing tonnage or scrapped is left out of die life', () => {
  const a = aggregateDieLife([row({ tonnageMt: 420, diesScrapped: 6 }), row({ diesScrapped: 4 }), row({ tonnageMt: 99 })]);
  assert.equal(a.dieLife, 70);
});
test('failure pools counts; blank unloaded counts as none', () => {
  const a = aggregateDieLife([row({ diesInService: 40, diesFailed: 5 }), row({ diesInService: 10 })]);
  assert.equal(a.dieFailure, 10);
  assert.equal(aggregateDieLife([row({})]).dieFailure, null);
});
test('trial ratios pool each pair on its own', () => {
  const a = aggregateDieLife([row({ newDiesReceived: 3, newDieTrials: 5 }), row({ backupDiesReceived: 2, backupDieTrials: 2, newDiesReceived: 4 })]);
  assert.equal(a.newTrialRatio, 5 / 3); assert.equal(a.backupTrialRatio, 1); assert.equal(a.trialRatio, 7 / 5);
  assert.equal(aggregateDieLife([row({ newDiesReceived: 0, newDieTrials: 0 })]).trialRatio, null);
});
test('totals sum each count and stay null when nothing was recorded', () => {
  const a = aggregateDieLife([row({ tonnageMt: 100, diesScrapped: 2 }), row({ tonnageMt: 50 })]);
  assert.equal(a.totals.tonnageMt, 150); assert.equal(a.totals.diesScrapped, 2);
  assert.equal(a.totals.diesInService, null);
  assert.deepEqual(Object.keys(a.totals).length, 8);
});
test('an empty period has no values', () => {
  const a = aggregateDieLife([]);
  assert.equal(a.dieLife, null); assert.equal(a.dieFailure, null); assert.equal(a.trialRatio, null);
  assert.equal(a.noDiesScrapped, false);
});
test('validation', () => {
  assert.throws(() => validateEntry({ supplier: 'WEFA', diesFailed: 2 }), (e) => e.status === 400 && /dies run/i.test(e.message));
  assert.throws(() => validateEntry({ supplier: 'WEFA', diesInService: 3, diesFailed: 4 }), (e) => e.status === 400 && /dies unloaded/i.test(e.message));
  assert.throws(() => validateEntry({ supplier: 'WEFA', newDieTrials: 2 }));
  assert.throws(() => validateEntry({ supplier: 'WEFA', backupDiesReceived: 0, backupDieTrials: 1 }));
  assert.throws(() => validateEntry({ supplier: 'WEFA', diesScrapped: 1.5 }));
  assert.throws(() => validateEntry({ supplier: 'WEFA', tonnageMt: -1 }), (e) => e.status === 400 && /negative/i.test(e.message));
  assert.throws(() => validateEntry({ supplier: '  ' }), (e) => e.status === 400);
  const ok = validateEntry({ supplier: ' WEFA ', tonnageMt: '420.5', diesScrapped: 6, newDiesReceived: 3, newDieTrials: 2 });
  assert.equal(ok.supplier, 'WEFA'); assert.equal(ok.tonnageMt, 420.5); assert.equal(ok.newDieTrials, 2); assert.equal(ok.diesFailed, null);
});
test('validateEntry keeps a typed zero and turns blanks into null', () => {
  const out = validateEntry({ supplier: 'PHME', diesInService: 12, diesFailed: 0, diesScrapped: '' });
  assert.equal(out.diesFailed, 0); assert.equal(out.diesScrapped, null);
});

// ---------- persistence ----------

// Every service test in this repo mocks the pool rather than touching a
// database. Replies are returned in call order.
const makePool = (replies = []) => {
  const calls = [];
  let i = 0;
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return replies[i++] || { rows: [] }; } };
};

const listDieLifeOf = (pool) => s.listDieLife(pool, { year: 2026, month: 8 });

test('listDieLife maps snake_case columns to the API shape', async () => {
  const pool = makePool([{ rows: [{
    supplier: 'PDTMC', avg_die_life_mt: '72.5', dies_in_service: 40, dies_failed: 6, dies_scrapped: 3,
    updated_by_name: 'admin', updated_at: '2026-08-05T10:00:00Z',
  }] }]);
  const rows = await listDieLifeOf(pool);
  assert.deepEqual(rows[0], {
    supplier: 'PDTMC', avgDieLifeMt: 72.5, diesInService: 40, diesFailed: 6, diesScrapped: 3,
    updatedBy: 'admin', updatedAt: '2026-08-05T10:00:00Z',
  });
});

test('listDieLife keeps a null column null rather than turning it into 0', async () => {
  const pool = makePool([{ rows: [{
    supplier: 'ALMAX', avg_die_life_mt: null, dies_in_service: null, dies_failed: null,
    updated_by_name: null, updated_at: null,
  }] }]);
  const rows = await listDieLifeOf(pool);
  assert.equal(rows[0].avgDieLifeMt, null);
  assert.equal(rows[0].diesInService, null);
});

test('saveDieLife validates every entry before writing anything', async () => {
  const pool = makePool([]);
  await assert.rejects(
    () => s.saveDieLife(pool, { year: 2026, month: 8, entries: [
      { supplier: 'PHME', avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
      { supplier: 'ALMAX', diesInService: 4, diesFailed: 9 },
    ] }, 3),
    (e) => e.status === 400
  );
  assert.equal(pool.calls.length, 0, 'a bad row must not leave a good row half-written');
});

test('saveDieLife upserts on supplier, year and month', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveDieLife(pool, { year: 2026, month: 8, entries: [
    { supplier: 'PHME', avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
  ] }, 3);
  const ins = pool.calls.find(c => /INSERT INTO supplier_die_life/.test(c.sql));
  assert.ok(/ON CONFLICT/.test(ins.sql), 'saving the same month twice must update, not duplicate');
  assert.deepEqual(ins.params, ['PHME', 2026, 8, null, 10, 1, null, 3]);
});

test('saveDieLife records who saved it', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveDieLife(pool, { year: 2026, month: 8, entries: [
    { supplier: 'PHME', avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
  ] }, 7);
  const ins = pool.calls.find(c => /INSERT INTO supplier_die_life/.test(c.sql));
  assert.equal(ins.params[7], 7);
});

test('getDieLifeForPeriod aggregates the rows it reads', async () => {
  const pool = makePool([{ rows: [
    { month: 7, tonnage_mt: '420', dies_scrapped: 6, dies_in_service: 40, dies_failed: 4 },
    { month: 8, tonnage_mt: null, dies_scrapped: null, dies_in_service: 4, dies_failed: 0 },
  ] }]);
  const out = await s.getDieLifeForPeriod(pool, { supplier: 'PHME', year: 2026, months: [7, 8] });
  assert.equal(out.dieLife, 70);
  assert.equal(Math.round(out.dieFailure * 100) / 100, 9.09);
});

test('getDieLifeForPeriod returns nulls when the supplier has no rows', async () => {
  const pool = makePool([{ rows: [] }]);
  const out = await s.getDieLifeForPeriod(pool, { supplier: 'NEWCO', year: 2026, months: [8] });
  assert.equal(out.dieLife, null);
  assert.equal(out.dieFailure, null);
});

test('getDieLifeRows leaves legacy rows (no plant) out', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.getDieLifeRows(pool, { supplier: 'PHME', year: 2026, months: [8] });
  assert.ok(/plant IS NOT NULL/.test(pool.calls[0].sql));
});

test('getDieLifeRows matches the supplier case-insensitively', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.getDieLifeRows(pool, { supplier: ' phme ', year: 2026, months: [8] });
  assert.ok(/upper\(btrim\(supplier\)\) = upper\(btrim\(\$1\)\)/.test(pool.calls[0].sql));
});
