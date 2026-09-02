'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./dieNumber.cjs');

// Mock client that answers each table with canned rows.
function makeClient({ dies = [], orders = [], requests = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('existing_die_details')) return { rows: dies, rowCount: dies.length };
      if (sql.includes('die_orders')) return { rows: orders, rowCount: orders.length };
      if (sql.includes('backup_die_requests')) return { rows: requests, rowCount: requests.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

test('parseSuffix reads a 3-digit suffix from either separator', () => {
  assert.equal(d.parseSuffix('29663-253'), 253);
  assert.equal(d.parseSuffix('29663_213'), 213);
  assert.equal(d.parseSuffix('013012-705'), 705);
});

// GEX 2's legacy numbers encode the P25/P35 press code, not a press number.
test('parseSuffix rejects legacy 4-digit and unparseable suffixes', () => {
  assert.equal(d.parseSuffix('001005-2502'), null);
  assert.equal(d.parseSuffix('120494-3503'), null);
  assert.equal(d.parseSuffix('30491-601 DP'), null);
  assert.equal(d.parseSuffix('INS-12297'), null);
  assert.equal(d.parseSuffix('29663'), null);
  assert.equal(d.parseSuffix(null), null);
});

// The real profile 29663 case: die list 213, orders 213, requests 252.
test('the highest suffix wins across all three sources', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01' }],
    orders: [{ die_no: '29663-213', plant: 'GEX 1' }],
    requests: [{ die_no: '29663-252', plant: 'GEX 01' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-253');
  assert.deepEqual(result.basis, { source: 'backup request', die_no: '29663-252' });
});

test('the die list can set the ceiling when it is highest', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01' }],
    orders: [{ die_no: '29663-204', plant: 'GEX 1' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-214');
  assert.deepEqual(result.basis, { source: 'die', die_no: '29663_213' });
});

// A profile that has never run on this press starts the sequence at 01.
test('no history gives <press>01 and a null basis', async () => {
  const client = makeClient({});
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '51150', press: 'PRESS 8' });
  assert.equal(result.dieNo, '51150-801');
  assert.equal(result.basis, null);
});

test('legacy 4-digit numbers do not raise the ceiling', async () => {
  const client = makeClient({
    orders: [{ die_no: '120494-3503', plant: 'GEX 2' }, { die_no: '120494-802', plant: 'GEX 2' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '120494', press: 'PRESS 8' });
  assert.equal(result.dieNo, '120494-803');
});

// Requests store 'GEX 01' and 'GEX 2'; the die list stores 'GEX 01'.
test('plant comparison ignores zero padding', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01' }],
    requests: [{ die_no: '29663-299', plant: 'GEX 02' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-300', 'only the GEX 2 row counts');
});

test('a leading-zero profile is stripped in both the query and the result', async () => {
  const client = makeClient({ requests: [{ die_no: '013012-705', plant: 'GEX 2' }] });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '013012', press: 'PRESS 7' });
  assert.equal(result.dieNo, '13012-706');
  assert.equal(client.calls[0].params[0], '13012');
});

test('an unusable press or empty profile returns null without querying', async () => {
  const client = makeClient({});
  assert.equal(await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: '' }), null);
  assert.equal(await d.nextDieNumber(client, { plant: 'GEX 01', profile: '', press: 'PRESS 2' }), null);
  assert.equal(client.calls.length, 0);
});

// Requests write '29663-213'; the die list stores '29663_213' and may pad the
// profile. Both have to be recognised as the same physical die.
test('dieNoExistsInDieList matches across separator and zero padding', async () => {
  const client = makeClient({ dies: [{ die_no: '29663_213' }] });
  assert.equal(await d.dieNoExistsInDieList(client, '29663-213'), true);
  assert.deepEqual(client.calls[0].params, ['29663', '213']);
});

test('dieNoExistsInDieList is false for an unknown die and for junk input', async () => {
  const client = makeClient({ dies: [] });
  assert.equal(await d.dieNoExistsInDieList(client, '29663-999'), false);
  assert.equal(await d.dieNoExistsInDieList(client, ''), false);
  assert.equal(await d.dieNoExistsInDieList(client, 'INS-12297'), false);
});
