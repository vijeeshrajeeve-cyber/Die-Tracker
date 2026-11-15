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
// database. Replies are chosen by pattern, in the order given; connect() hands
// back a client that logs to the same call list.
const makePool = (rules = []) => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    for (const [pattern, rows] of rules) if (pattern.test(sql)) return { rows, rowCount: rows.length };
    return { rows: [], rowCount: 0 };
  };
  return { calls, query, connect: async () => ({ query, release() { calls.push({ sql: 'RELEASE' }); } }) };
};
const PLANTS = [/FROM plants/, [{ id: 1 }]];
const writes = (pool) => pool.calls.filter((c) => /INSERT INTO supplier_die_life|DELETE FROM supplier_die_life/.test(c.sql));

const dbRow = (o) => ({ supplier: 'PHME', plant: 'GEX 01', tonnage_mt: null, dies_scrapped: null, dies_in_service: null,
  dies_failed: null, new_dies_received: null, new_die_trials: null, backup_dies_received: null, backup_die_trials: null, ...o });

test('listDieLife for one plant maps columns and carries the calculated figures', async () => {
  const pool = makePool([[/plant = \$3/, [dbRow({ tonnage_mt: '420', dies_scrapped: 6, dies_in_service: 40, dies_failed: 4,
    updated_by_name: 'admin', updated_at: '2026-08-05T10:00:00Z' })]]]);
  const { rows, legacy } = await s.listDieLife(pool, { year: 2026, month: 8, plant: 'GEX 01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].supplier, 'PHME'); assert.equal(rows[0].tonnageMt, 420); assert.equal(rows[0].diesInService, 40);
  assert.equal(rows[0].newDiesReceived, null, 'a null column stays null');
  assert.equal(rows[0].updatedBy, 'admin');
  assert.equal(rows[0].calculated.dieLife, 70); assert.equal(rows[0].calculated.dieFailure, 10);
  assert.deepEqual(legacy, []);
  assert.deepEqual(pool.calls.find((c) => /plant = \$3/.test(c.sql)).params, [2026, 8, 'GEX 01']);
});

test('listDieLife with plant "all" sums two plants per supplier', async () => {
  const pool = makePool([[/plant IS NOT NULL/, [
    dbRow({ plant: 'GEX 01', tonnage_mt: '300', dies_scrapped: 3, dies_in_service: 10, dies_failed: 1, new_dies_received: 2, new_die_trials: 3 }),
    dbRow({ plant: 'GEX 02', tonnage_mt: '300', dies_scrapped: 1, dies_in_service: 30, dies_failed: 5, new_dies_received: 2, new_die_trials: 2 }),
    dbRow({ supplier: 'ALMAX', plant: 'GEX 01', dies_in_service: 4, dies_failed: 0 }),
  ]]]);
  const { rows } = await s.listDieLife(pool, { year: 2026, month: 8, plant: 'all' });
  assert.equal(rows.length, 2);
  const p = rows.find((r) => r.supplier === 'PHME');
  assert.equal(p.tonnageMt, 600); assert.equal(p.diesScrapped, 4); assert.equal(p.diesInService, 40);
  assert.equal(p.calculated.dieLife, 150);
  assert.equal(p.calculated.dieFailure, 15, 'pooled 6/40, not the mean of 10% and 16.7%');
  assert.equal(p.calculated.newTrialRatio, 5 / 4);
  assert.equal(rows.find((r) => r.supplier === 'ALMAX').tonnageMt, null);
});

test('listDieLife returns legacy rows separately and keeps them out of the sums', async () => {
  const pool = makePool([
    [/plant IS NULL/, [{ id: 9, supplier: 'OLD', avg_die_life_mt: '72.5', dies_in_service: 40, dies_failed: 6, dies_scrapped: 3 }]],
    [/plant IS NOT NULL/, [dbRow({ tonnage_mt: '100', dies_scrapped: 1 })]],
  ]);
  const { rows, legacy } = await s.listDieLife(pool, { year: 2026, month: 8, plant: 'all' });
  assert.deepEqual(legacy, [{ id: 9, supplier: 'OLD', avgDieLifeMt: 72.5, diesInService: 40, diesFailed: 6, diesScrapped: 3 }]);
  assert.deepEqual(rows.map((r) => r.supplier), ['PHME']);
  assert.equal(rows[0].tonnageMt, 100);
});

const save = (pool, over = {}) => s.saveDieLife(pool, { year: 2026, month: 8, plant: 'GEX 01', entries: [
  { supplier: 'PHME', tonnageMt: 420, diesScrapped: 6, diesInService: 10, diesFailed: 1 },
], ...over }, 3);

test('saveDieLife refuses a blank plant, "all" and an unlisted plant with no write', async () => {
  for (const plant of ['', '  ', undefined, 'all', 'NOWHERE']) {
    const pool = makePool(plant === 'NOWHERE' ? [[/FROM plants/, []]] : [PLANTS]);
    await assert.rejects(() => save(pool, { plant }), (e) => e.status === 400 && e.message === 'Choose a plant to save figures for');
    assert.equal(writes(pool).length, 0);
    assert.ok(!pool.calls.some((c) => c.sql === 'BEGIN'));
  }
});

test('saveDieLife validates every entry before writing anything', async () => {
  const pool = makePool([PLANTS]);
  await assert.rejects(() => save(pool, { entries: [
    { supplier: 'PHME', diesInService: 10, diesFailed: 1 },
    { supplier: 'ALMAX', diesInService: 4, diesFailed: 9 },
  ] }), (e) => e.status === 400);
  assert.equal(writes(pool).length, 0, 'a bad row must not leave a good row half-written');
});

test('saveDieLife upserts on the plant-month unique index inside a transaction', async () => {
  const pool = makePool([PLANTS]);
  await save(pool);
  const ins = pool.calls.find((c) => /INSERT INTO supplier_die_life/.test(c.sql));
  assert.ok(/ON CONFLICT \(upper\(btrim\(supplier\)\), plant, year, month\) WHERE plant IS NOT NULL DO UPDATE/.test(ins.sql));
  assert.deepEqual(ins.params, ['PHME', 'GEX 01', 2026, 8, 420, 6, 10, 1, null, null, null, null, 3]);
  const order = pool.calls.map((c) => c.sql.trim().split(/\s+/)[0]);
  assert.ok(order.indexOf('BEGIN') < order.indexOf('INSERT') && order.indexOf('INSERT') < order.indexOf('COMMIT'));
  assert.ok(pool.calls.some((c) => c.sql === 'RELEASE'));
});

test('saveDieLife stores the supplier trimmed and records who saved it', async () => {
  const pool = makePool([PLANTS]);
  await save(pool, { entries: [{ supplier: '  PHME ', diesInService: 3 }] });
  const ins = pool.calls.find((c) => /INSERT INTO supplier_die_life/.test(c.sql));
  assert.equal(ins.params[0], 'PHME'); assert.equal(ins.params.at(-1), 3);
});

test('saveDieLife deletes the row when every count is blank, and writes nothing otherwise', async () => {
  const pool = makePool([PLANTS]);
  await save(pool, { entries: [{ supplier: 'PHME' }, { supplier: 'ALMAX', tonnageMt: '' }] });
  assert.ok(!pool.calls.some((c) => /INSERT INTO supplier_die_life/.test(c.sql)));
  const dels = pool.calls.filter((c) => /DELETE FROM supplier_die_life/.test(c.sql));
  assert.equal(dels.length, 2);
  assert.ok(/plant = \$2/.test(dels[0].sql));
  assert.deepEqual(dels[0].params, ['PHME', 'GEX 01', 2026, 8]);
});

test('saveDieLife rolls back and releases when a write fails', async () => {
  const pool = makePool([PLANTS]);
  const inner = pool.connect;
  pool.connect = async () => {
    const c = await inner();
    const q = c.query;
    c.query = async (sql, params) => { if (/INSERT INTO supplier_die_life/.test(sql)) throw new Error('boom'); return q(sql, params); };
    return c;
  };
  await assert.rejects(() => save(pool), /boom/);
  assert.ok(pool.calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(pool.calls.some((c) => c.sql === 'RELEASE'));
  assert.ok(!pool.calls.some((c) => c.sql === 'COMMIT'));
});

test('deleteLegacyRow only removes a row with no plant', async () => {
  const pool = makePool([[/DELETE FROM supplier_die_life/, [{ id: 9 }]]]);
  assert.equal(await s.deleteLegacyRow(pool, 9), true);
  assert.ok(/plant IS NULL/.test(pool.calls[0].sql));
  assert.equal(await s.deleteLegacyRow(makePool(), 10), false);
});

test('getDieLifeRows returns one aggregated entry per month across plants', async () => {
  const pool = makePool([[/FROM supplier_die_life/, [
    { month: 7, plant: 'GEX 01', tonnage_mt: '300', dies_scrapped: 3, dies_in_service: 10, dies_failed: 1 },
    { month: 7, plant: 'GEX 02', tonnage_mt: '300', dies_scrapped: 1, dies_in_service: 30, dies_failed: 5 },
    { month: 8, plant: 'GEX 01', dies_in_service: 4, dies_failed: 0 },
  ]]]);
  const out = await s.getDieLifeRows(pool, { supplier: 'PHME', year: 2026, months: [7, 8] });
  assert.deepEqual(out.map((r) => r.month), [7, 8]);
  assert.equal(out[0].dieLife, 150); assert.equal(out[0].dieFailure, 15); assert.equal(out[0].totals.diesInService, 40);
  assert.equal(out[1].dieLife, null);
});

test('getDieLifeForPeriod aggregates the rows it reads', async () => {
  const pool = makePool([[/FROM supplier_die_life/, [
    { month: 7, tonnage_mt: '420', dies_scrapped: 6, dies_in_service: 40, dies_failed: 4 },
    { month: 8, tonnage_mt: null, dies_scrapped: null, dies_in_service: 4, dies_failed: 0 },
  ]]]);
  const out = await s.getDieLifeForPeriod(pool, { supplier: 'PHME', year: 2026, months: [7, 8] });
  assert.equal(out.dieLife, 70);
  assert.equal(Math.round(out.dieFailure * 100) / 100, 9.09);
});

test('getDieLifeForPeriod returns nulls when the supplier has no rows', async () => {
  const pool = makePool();
  const out = await s.getDieLifeForPeriod(pool, { supplier: 'NEWCO', year: 2026, months: [8] });
  assert.equal(out.dieLife, null);
  assert.equal(out.dieFailure, null);
});

test('getDieLifeRows leaves legacy rows (no plant) out', async () => {
  const pool = makePool();
  await s.getDieLifeRows(pool, { supplier: 'PHME', year: 2026, months: [8] });
  assert.ok(/plant IS NOT NULL/.test(pool.calls[0].sql));
});

test('getDieLifeRows matches the supplier case-insensitively', async () => {
  const pool = makePool();
  await s.getDieLifeRows(pool, { supplier: ' phme ', year: 2026, months: [8] });
  assert.ok(/upper\(btrim\(supplier\)\) = upper\(btrim\(\$1\)\)/.test(pool.calls[0].sql));
});

test('aggregateDieLife returns the paired sums the ratios actually used', () => {
  const N = { tonnageMt: null, diesScrapped: null, diesInService: null, diesFailed: null,
    newDiesReceived: null, newDieTrials: null, backupDiesReceived: null, backupDieTrials: null };
  const out = s.aggregateDieLife([
    { ...N, tonnageMt: 500, newDiesReceived: 4 },
    { ...N, tonnageMt: 300, diesScrapped: 5, diesInService: 10, newDiesReceived: 2, newDieTrials: 3 },
  ]);
  assert.equal(out.dieLife, 60);
  assert.equal(out.totals.tonnageMt, 800);
  assert.deepEqual(out.paired, {
    tonnageMt: 300, diesScrapped: 5, diesInService: 10, diesFailed: 0,
    newDiesReceived: 2, newDieTrials: 3, backupDiesReceived: null, backupDieTrials: null,
  });
});

test('aggregateDieLife paired sums are null when no row qualified', () => {
  const out = s.aggregateDieLife([]);
  for (const v of Object.values(out.paired)) assert.equal(v, null);
});

test('periodLabel names the span from the first month with a row to the report month', () => {
  assert.equal(s.periodLabel([{ month: 1 }, { month: 5 }, { month: 11 }], 11), 'Jan-Nov');
  assert.equal(s.periodLabel([{ month: 3 }, { month: 6 }], 8), 'Mar-Aug');
  assert.equal(s.periodLabel([{ month: 11 }], 11), 'Nov total');
  assert.equal(s.periodLabel([], 11), 'Total');
});
