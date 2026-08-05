'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./supplierDieLife.cjs');

// ---------- validateEntry ----------

test('validateEntry normalises blanks to null, not zero', () => {
  const out = s.validateEntry({ supplier: ' PDTMC ', avgDieLifeMt: '', diesInService: null, diesFailed: undefined });
  assert.equal(out.supplier, 'PDTMC');
  assert.equal(out.avgDieLifeMt, null);
  assert.equal(out.diesInService, null);
  assert.equal(out.diesFailed, null);
});

test('validateEntry keeps a typed zero as zero', () => {
  const out = s.validateEntry({ supplier: 'PHME', diesInService: 12, diesFailed: 0 });
  assert.equal(out.diesFailed, 0, 'a typed 0 means zero failures and must survive');
});

test('validateEntry rejects more failures than dies in service', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesInService: 5, diesFailed: 9 }),
    (e) => e.status === 400 && /more dies failed/i.test(e.message)
  );
});

test('validateEntry rejects negative numbers', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', avgDieLifeMt: -3 }),
    (e) => e.status === 400 && /negative/i.test(e.message)
  );
});

test('validateEntry rejects a failure count with no denominator', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesFailed: 2 }),
    (e) => e.status === 400 && /dies in service/i.test(e.message)
  );
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesInService: 0, diesFailed: 0 }),
    (e) => e.status === 400
  );
});

test('validateEntry allows die life alone — it scores on its own', () => {
  const out = s.validateEntry({ supplier: 'ALMAX', avgDieLifeMt: 64 });
  assert.equal(out.avgDieLifeMt, 64);
  assert.equal(out.diesInService, null);
});

test('validateEntry requires a supplier', () => {
  assert.throws(() => s.validateEntry({ supplier: '  ' }), (e) => e.status === 400);
});

// ---------- aggregateDieLife ----------

test('aggregateDieLife weights die life by dies in service', () => {
  // 40 dies at 80 MT and 4 dies at 20 MT. A simple mean would say 50 MT;
  // the busy month must dominate.
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 40, diesFailed: 4 },
    { avgDieLifeMt: 20, diesInService: 4, diesFailed: 0 },
  ]);
  assert.equal(Math.round(out.dieLife * 100) / 100, 74.55);
});

test('aggregateDieLife pools failure counts rather than averaging percentages', () => {
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 40, diesFailed: 4 },
    { avgDieLifeMt: 20, diesInService: 4, diesFailed: 0 },
  ]);
  assert.equal(Math.round(out.dieFailure * 100) / 100, 9.09); // 4/44
});

test('aggregateDieLife returns null failure when no dies were in service', () => {
  const out = s.aggregateDieLife([{ avgDieLifeMt: 55, diesInService: null, diesFailed: null }]);
  assert.equal(out.dieFailure, null, '0 of 0 is unknown, not a perfect 0%');
});

test('aggregateDieLife falls back to a simple mean when no month has counts', () => {
  // Otherwise a weighted mean with no weights divides by zero and silently
  // discards a figure somebody typed.
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 60, diesInService: null, diesFailed: null },
    { avgDieLifeMt: 80, diesInService: null, diesFailed: null },
  ]);
  assert.equal(out.dieLife, 70);
});

test('aggregateDieLife ignores unweighted months when others carry weight', () => {
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
    { avgDieLifeMt: 20, diesInService: null, diesFailed: null },
  ]);
  assert.equal(out.dieLife, 80);
});

test('aggregateDieLife returns nulls for an empty period', () => {
  assert.deepEqual(s.aggregateDieLife([]), { dieLife: null, dieFailure: null });
});

test('aggregateDieLife treats zero failures as a real zero', () => {
  const out = s.aggregateDieLife([{ avgDieLifeMt: 90, diesInService: 20, diesFailed: 0 }]);
  assert.equal(out.dieFailure, 0);
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
    supplier: 'PDTMC', avg_die_life_mt: '72.5', dies_in_service: 40, dies_failed: 6,
    updated_by_name: 'admin', updated_at: '2026-08-05T10:00:00Z',
  }] }]);
  const rows = await listDieLifeOf(pool);
  assert.deepEqual(rows[0], {
    supplier: 'PDTMC', avgDieLifeMt: 72.5, diesInService: 40, diesFailed: 6,
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
  assert.deepEqual(ins.params, ['PHME', 2026, 8, 80, 10, 1, 3]);
});

test('saveDieLife records who saved it', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveDieLife(pool, { year: 2026, month: 8, entries: [
    { supplier: 'PHME', avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
  ] }, 7);
  const ins = pool.calls.find(c => /INSERT INTO supplier_die_life/.test(c.sql));
  assert.equal(ins.params[6], 7);
});

test('getDieLifeForPeriod aggregates the rows it reads', async () => {
  const pool = makePool([{ rows: [
    { month: 7, avg_die_life_mt: '80', dies_in_service: 40, dies_failed: 4 },
    { month: 8, avg_die_life_mt: '20', dies_in_service: 4, dies_failed: 0 },
  ] }]);
  const out = await s.getDieLifeForPeriod(pool, { supplier: 'PHME', year: 2026, months: [7, 8] });
  assert.equal(Math.round(out.dieLife * 100) / 100, 74.55);
  assert.equal(Math.round(out.dieFailure * 100) / 100, 9.09);
});

test('getDieLifeForPeriod returns nulls when the supplier has no rows', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.deepEqual(
    await s.getDieLifeForPeriod(pool, { supplier: 'NEWCO', year: 2026, months: [8] }),
    { dieLife: null, dieFailure: null }
  );
});

test('getDieLifeRows matches the supplier case-insensitively', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.getDieLifeRows(pool, { supplier: ' phme ', year: 2026, months: [8] });
  assert.ok(/upper\(btrim\(supplier\)\) = upper\(btrim\(\$1\)\)/.test(pool.calls[0].sql));
});
