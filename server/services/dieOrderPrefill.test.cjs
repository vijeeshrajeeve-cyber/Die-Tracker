'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('./dieOrderPrefill.cjs');

// Mock client that records queries and returns canned rows by matcher.
function makeClient(handlers = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const h of handlers) {
        if (h.match(sql)) return h.result(params);
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const dieListRows = (rows) => ({
  match: (sql) => sql.includes('existing_die_details'),
  result: () => ({ rows, rowCount: rows.length }),
});
const orderRows = (rows) => ({
  match: (sql) => sql.includes('die_orders'),
  result: () => ({ rows, rowCount: rows.length }),
});

// The die list writes 'M_PRESS.2'; requests and the presses master say 'PRESS 2'.
test('pressNumber reads the trailing integer from either spelling', () => {
  assert.equal(p.pressNumber('M_PRESS.2'), 2);
  assert.equal(p.pressNumber('PRESS 2'), 2);
  assert.equal(p.pressNumber('press 10'), 10);
  assert.equal(p.pressNumber(''), null);
  assert.equal(p.pressNumber(null), null);
});

// extractProfileFromDie strips leading zeros ('1001'), but the die list stores
// IDProfile verbatim ('01001') for 6,280 of 44,669 dies.
test('stripProfile removes leading zeros from both spellings', () => {
  assert.equal(p.stripProfile('01001'), '1001');
  assert.equal(p.stripProfile('1001'), '1001');
  assert.equal(p.stripProfile('29663'), '29663');
  assert.equal(p.stripProfile(null), '');
});

test('findDieListMatch returns the first row and passes the stripped profile', async () => {
  const client = makeClient([dieListRows([
    { die_no: '29663_213', plant: 'GEX 01', die_size: '355X200', die_type: 'Hollow', bolster_no: 'BOL-2-2-A', supplier: 'PDTMC' },
  ])]);
  const match = await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.equal(match.die_no, '29663_213');
  assert.equal(match.die_size, '355X200');
  assert.deepEqual(client.calls[0].params, ['29663', 2, '2']);
});

test('findDieListMatch keeps only rows whose plant matches after normalisation', async () => {
  const client = makeClient([dieListRows([
    { die_no: '29663_299', plant: 'GEX 02', die_size: '999X999', die_type: 'Solid', bolster_no: null, supplier: null },
    { die_no: '29663_213', plant: 'GEX 1', die_size: '355X200', die_type: 'Hollow', bolster_no: 'BOL-2-2-A', supplier: 'PDTMC' },
  ])]);
  const match = await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.equal(match.die_no, '29663_213');
});

test('findDieListMatch returns null when the key is incomplete', async () => {
  const client = makeClient([dieListRows([{ die_no: 'x' }])]);
  assert.equal(await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: '' }), null);
  assert.equal(await p.findDieListMatch(client, { plant: 'GEX 01', profile: '', press: 'PRESS 2', cavity: 2 }), null);
  assert.equal(client.calls.length, 0, 'must not query on an incomplete key');
});

test('findDieListMatch returns null when nothing matches', async () => {
  const client = makeClient([dieListRows([])]);
  assert.equal(await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 1 }), null);
});

// die_orders.press is set on 6 of 659 rows, so press comes from the die_no suffix.
test('findRecentOrderMatch queries by stripped profile and derived press', async () => {
  const client = makeClient([orderRows([
    { die_no: '18114-407', plant: 'GEX 1', die_size: '450x250', supplier: 'COMPES', ordered_date: '2026-05-26' },
  ])]);
  const match = await p.findRecentOrderMatch(client, { plant: 'GEX 01', profile: '018114', press: 'PRESS 4' });
  assert.equal(match.die_no, '18114-407');
  assert.equal(match.supplier, 'COMPES');
  assert.deepEqual(client.calls[0].params, ['18114', 4]);
});

test('findRecentOrderMatch skips orders from another plant', async () => {
  const client = makeClient([orderRows([
    { die_no: '18114-407', plant: 'GEX 2', die_size: '999x999', supplier: 'WEFA', ordered_date: '2026-05-26' },
    { die_no: '18114-408', plant: 'GEX 1', die_size: '450x250', supplier: 'COMPES', ordered_date: '2026-01-02' },
  ])]);
  const match = await p.findRecentOrderMatch(client, { plant: 'GEX 01', profile: '18114', press: 'PRESS 4' });
  assert.equal(match.die_no, '18114-408');
});

test('findRecentOrderMatch returns null without a usable press', async () => {
  const client = makeClient([orderRows([{ die_no: 'x' }])]);
  assert.equal(await p.findRecentOrderMatch(client, { plant: 'GEX 01', profile: '18114', press: '' }), null);
  assert.equal(client.calls.length, 0);
});
