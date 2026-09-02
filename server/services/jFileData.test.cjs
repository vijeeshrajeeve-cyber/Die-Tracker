'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./jFileData.cjs');

// The supplier lookups are the DISTINCT ones; the row lookups are not.
function makePool({ dies = [], orders = [], dieSuppliers = [], orderSuppliers = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const distinct = sql.includes('DISTINCT');
      if (sql.includes('existing_die_details')) {
        return distinct ? { rows: dieSuppliers.map((s) => ({ supplier: s })) } : { rows: dies };
      }
      if (sql.includes('die_orders')) {
        return distinct ? { rows: orderSuppliers.map((s) => ({ supplier: s })) } : { rows: orders };
      }
      return { rows: [] };
    },
  };
}

test('canonicalSupplierName maps die-list spellings onto the master name', () => {
  assert.equal(d.canonicalSupplierName('PHOEINIX'), 'PHOENIX');
  assert.equal(d.canonicalSupplierName('Phoenix Middle East'), 'PHME');
  assert.equal(d.canonicalSupplierName('Giansun'), 'JIANGSU');
});

// An unmapped name is still a real supplier — print it rather than dropping it.
test('canonicalSupplierName keeps a name it has no mapping for', () => {
  assert.equal(d.canonicalSupplierName('EKSTEK XP'), 'EKSTEK XP');
  assert.equal(d.canonicalSupplierName('PDTMC'), 'PDTMC');
  assert.equal(d.canonicalSupplierName('  '), null);
  assert.equal(d.canonicalSupplierName(null), null);
});

test('the die list query excludes scrapped and held dies', async () => {
  const pool = makePool({ dies: [{ die_no: '29663_210', tonnage: '91805', supplier: 'PDTMC' }] });
  await d.collectJFileData(pool, '29663-252');
  const dieQuery = pool.calls.find((c) => c.sql.includes('existing_die_details') && !c.sql.includes('DISTINCT'));
  assert.match(dieQuery.sql, /NOT IN \('SCRAPPED', 'HOLD'\)/);
});

test('active dies carry their tonnage and a canonical supplier', async () => {
  const pool = makePool({
    dies: [
      { die_no: '29663_210', tonnage: '91805', supplier: 'PDTMC' },
      { die_no: '29663_601', tonnage: '55504', supplier: 'PHOEINIX' },
    ],
  });
  const { activeDies } = await d.collectJFileData(pool, '29663-252');
  assert.deepEqual(activeDies, [
    { die_no: '29663_210', supplier: 'PDTMC', tonnage: 91805 },
    { die_no: '29663_601', supplier: 'PHOENIX', tonnage: 55504 },
  ]);
});

// The die list is a periodic export, so an order raised since it was taken is
// the only record that the die exists.
test('an order the die list has never heard of is added, with no tonnage', async () => {
  const pool = makePool({
    dies: [{ die_no: '29663_210', tonnage: '91805', supplier: 'PDTMC' }],
    orders: [{ die_no: '29663-701', supplier: 'WEFA', status: 'PENDING FOR ORDERING' }],
  });
  const { activeDies } = await d.collectJFileData(pool, '29663-252');
  assert.equal(activeDies.length, 2);
  assert.deepEqual(activeDies[1], { die_no: '29663-701', supplier: 'WEFA', tonnage: null });
});

test('the order query excludes held and cancelled orders', async () => {
  const pool = makePool({});
  await d.collectJFileData(pool, '29663-252');
  const orderQuery = pool.calls.find((c) => c.sql.includes('die_orders') && !c.sql.includes('DISTINCT'));
  assert.match(orderQuery.sql, /NOT IN \('HOLD', 'CANCELLED'\)/);
});

// The die list writes 29663_603, an order writes 29663-603, and a padded order
// writes 029663-603. All three are the same physical die.
test('a die in both sources is listed once, whatever the spelling', async () => {
  const pool = makePool({
    dies: [{ die_no: '29663_603', tonnage: '', supplier: 'PHOEINIX' }],
    orders: [
      { die_no: '29663-603', supplier: 'PHOEINIX', status: 'PENDING FOR PR' },
      { die_no: '029663-603', supplier: 'PHOEINIX', status: 'AWAITING FOR DESIGN' },
    ],
  });
  const { activeDies } = await d.collectJFileData(pool, '29663-252');
  assert.deepEqual(activeDies.map((a) => a.die_no), ['29663_603']);
});

test('a die with no recorded tonnage reports null rather than zero', async () => {
  const pool = makePool({ dies: [{ die_no: '29663_603', tonnage: '', supplier: 'PHOEINIX' }] });
  const { activeDies } = await d.collectJFileData(pool, '29663-252');
  assert.equal(activeDies[0].tonnage, null);
});

test('the list is capped at the ten rows the form has', async () => {
  const dies = Array.from({ length: 14 }, (_, i) => ({ die_no: `29663_2${10 + i}`, tonnage: '100', supplier: 'PDTMC' }));
  const pool = makePool({ dies });
  const { activeDies } = await d.collectJFileData(pool, '29663-252');
  assert.equal(activeDies.length, 10);
});

// "Purchased in the past" includes dies since scrapped, so the supplier lookup
// is deliberately not filtered by status.
test('previous suppliers merge both sources, canonicalised, deduped and sorted', async () => {
  const pool = makePool({
    dieSuppliers: ['Phoenix Middle East', 'PDTMC', 'EKSTEK XP', 'Giansun', 'PHOEINIX'],
    orderSuppliers: ['PDTMC', 'JIANGSU'],
  });
  const { prevSuppliers } = await d.collectJFileData(pool, '29663-252');
  assert.deepEqual(prevSuppliers, ['EKSTEK XP', 'JIANGSU', 'PDTMC', 'PHME', 'PHOENIX']);
});

test('a profile with no history returns empty lists', async () => {
  const pool = makePool({});
  assert.deepEqual(await d.collectJFileData(pool, '999999-401'), { activeDies: [], prevSuppliers: [] });
});

test('an unusable die number returns empty lists without querying', async () => {
  const pool = makePool({ dies: [{ die_no: 'x' }] });
  assert.deepEqual(await d.collectJFileData(pool, ''), { activeDies: [], prevSuppliers: [] });
  assert.equal(pool.calls.length, 0);
});

test('a zero-padded profile is stripped before matching', async () => {
  const pool = makePool({});
  await d.collectJFileData(pool, '013012-705');
  assert.equal(pool.calls[0].params[0], '13012');
});
