'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./correctors.cjs');

// A fake pool that records every query and replies from a scripted list.
const makePool = (replies = []) => {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return replies[i++] || { rows: [] };
    },
  };
};

test('normalizeName trims but preserves capitalisation', () => {
  assert.equal(s.normalizeName('  Sujith '), 'Sujith');
  assert.equal(s.normalizeName('kailash'), 'kailash');
  assert.equal(s.normalizeName(null), '');
  assert.equal(s.normalizeName('   '), '');
});

test('listCorrectors returns only active rows by default', async () => {
  const pool = makePool([{ rows: [{ id: 1, name: 'Sujith' }] }]);
  await s.listCorrectors(pool, {});
  assert.match(pool.calls[0].sql, /is_active = TRUE/);
  assert.deepEqual(pool.calls[0].params, []);
});

test('listCorrectors includes inactive rows when asked', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.listCorrectors(pool, { includeInactive: true });
  assert.doesNotMatch(pool.calls[0].sql, /is_active = TRUE/);
});

test('listCorrectors filters by plant when given one', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.listCorrectors(pool, { plant: 'GEX 2' });
  assert.match(pool.calls[0].sql, /plant = \$1/);
  assert.deepEqual(pool.calls[0].params, ['GEX 2']);
});

test('createCorrector rejects a blank name with status 400', async () => {
  const pool = makePool();
  await assert.rejects(
    () => s.createCorrector(pool, { name: '   ', plant: 'GEX 2' }),
    (err) => err.status === 400
  );
  assert.equal(pool.calls.length, 0, 'must not hit the database');
});

test('createCorrector trims the name before inserting', async () => {
  const pool = makePool([
    { rows: [] },                                          // duplicate check
    { rows: [{ id: 7, name: 'Sujith', plant: 'GEX 2' }] }, // insert
  ]);
  const row = await s.createCorrector(pool, { name: ' Sujith ', plant: ' GEX 2 ' });
  const insert = pool.calls.find((c) => /INSERT INTO correctors/.test(c.sql));
  assert.deepEqual(insert.params, ['Sujith', 'GEX 2']);
  assert.equal(row.id, 7);
});

test('createCorrector rejects a duplicate name+plant with status 409', async () => {
  const pool = makePool([{ rows: [{ id: 3 }] }]); // duplicate check finds a row
  await assert.rejects(
    () => s.createCorrector(pool, { name: 'Sujith', plant: 'GEX 2' }),
    (err) => err.status === 409
  );
});

test('createCorrector stores a blank plant as NULL', async () => {
  const pool = makePool([{ rows: [] }, { rows: [{ id: 8 }] }]);
  await s.createCorrector(pool, { name: 'Anil', plant: '' });
  const insert = pool.calls.find((c) => /INSERT INTO correctors/.test(c.sql));
  assert.equal(insert.params[1], null);
});

test('updateCorrector returns null when the id does not exist', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.equal(await s.updateCorrector(pool, 99, { name: 'X' }), null);
});

test('updateCorrector leaves unsupplied fields at their current values', async () => {
  const pool = makePool([
    { rows: [{ id: 5, name: 'Raheem', plant: 'GEX 2', is_active: true }] },
    { rows: [{ id: 5, name: 'Raheem', plant: 'GEX 01', is_active: true }] },
  ]);
  await s.updateCorrector(pool, 5, { plant: 'GEX 01' });
  const upd = pool.calls.find((c) => /UPDATE correctors/.test(c.sql));
  assert.equal(upd.params[0], 'Raheem', 'name unchanged');
  assert.equal(upd.params[1], 'GEX 01', 'plant updated');
  assert.equal(upd.params[2], true, 'is_active unchanged');
});

test('deactivateCorrector sets is_active false and never deletes', async () => {
  const pool = makePool([
    { rows: [{ id: 5, name: 'Raheem' }] },
    { rows: [{ id: 5, name: 'Raheem', is_active: false }] },
  ]);
  const row = await s.deactivateCorrector(pool, 5);
  assert.equal(row.is_active, false);
  assert.ok(
    !pool.calls.some((c) => /DELETE FROM correctors/.test(c.sql)),
    'must not issue a DELETE'
  );
});

test('deactivateCorrector returns null when the id does not exist', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.equal(await s.deactivateCorrector(pool, 99), null);
});
