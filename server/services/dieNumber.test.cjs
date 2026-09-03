'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./dieNumber.cjs');

// Mock client that answers each table with canned rows.
function makeClient({ dies = [], orders = [], requests = [], available = [{ count: 0 }] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('COUNT(')) return { rows: available, rowCount: available.length };
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

// Matching strips the padding, but the proposal must read back the way the
// plant writes it: GEX-2 profiles are padded (090001-2502), so proposing
// 90001-801 would not look like one of its die numbers.
test('a leading-zero profile is stripped for matching but kept in the result', async () => {
  const client = makeClient({ requests: [{ die_no: '013012-705', plant: 'GEX 2' }] });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '013012', press: 'PRESS 7' });
  assert.equal(result.dieNo, '013012-706');
  assert.equal(client.calls[0].params[0], '13012');
});

test('an unpadded profile is returned unpadded', async () => {
  const client = makeClient({ dies: [{ die_no: '29663_213', plant: 'GEX 01', cavity: 2 }] });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: ' 29663 ', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-214');
});

test('an unusable press or empty profile returns null without querying', async () => {
  const client = makeClient({});
  assert.equal(await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: '' }), null);
  assert.equal(await d.nextDieNumber(client, { plant: 'GEX 01', profile: '', press: 'PRESS 2' }), null);
  assert.equal(client.calls.length, 0);
});

// Cavity comes from the newest DIE, which is not always the newest of the three
// sources — here a backup request sets the die-number ceiling but carries no
// authority over cavity.
test('cavity comes from the newest die list row, not the newest source', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01', cavity: '2' }],
    requests: [{ die_no: '29663-252', plant: 'GEX 01' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-253');
  assert.deepEqual(result.cavity, { value: '2', die_no: '29663_213' });
});

// Cavity climbs as a design is revised: 10018 on press 2 runs 2 -> 3 -> 4, and
// only the newest die reflects the current design.
test('cavity takes the newest die when the group disagrees', async () => {
  const client = makeClient({
    dies: [
      { die_no: '10018_201', plant: 'GEX 01', cavity: '2' },
      { die_no: '10018_203', plant: 'GEX 01', cavity: '4' },
      { die_no: '10018_202', plant: 'GEX 01', cavity: '3' },
    ],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: '10018', press: 'PRESS 2' });
  assert.deepEqual(result.cavity, { value: '4', die_no: '10018_203' });
});

// die_orders.cavity is set on 7 of 659 rows, so orders and requests never speak
// for cavity even when they are the only rows present.
test('cavity is null when no die list row carries one', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01', cavity: '' }],
    orders: [{ die_no: '29663-204', plant: 'GEX 1' }],
    requests: [{ die_no: '29663-252', plant: 'GEX 01' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.cavity, null);
});

test('a profile with no history has no cavity either', async () => {
  const client = makeClient({});
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '51150', press: 'PRESS 8' });
  assert.equal(result.dieNo, '51150-801');
  assert.equal(result.cavity, null);
});

// ── Die Available ─────────────────────────────────────────────────────────

// Counted on the press column, not on the sequence candidates: those are
// filtered to 3-digit suffixes and would miss a die like 051150-3501.
test('nextDieNumber reports how many dies are still usable on this press', async () => {
  const client = makeClient({ available: [{ count: 7 }] });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '051150', press: 'PRESS 8' });
  assert.equal(result.available, 7);
});

test('the availability query excludes the four inactive statuses on the chosen press', async () => {
  const client = makeClient({ available: [{ count: 0 }] });
  await d.nextDieNumber(client, { plant: 'GEX 2', profile: '051150', press: 'PRESS 8' });
  const q = client.calls.find((c) => c.sql.includes('COUNT('));
  assert.deepEqual(q.params[2], ['SCRAPPED', 'HOLD', 'TRANSFERRED', 'SENT TO TALEX']);
  assert.deepEqual(q.params.slice(0, 2), ['51150', 'PRESS 8']);
  assert.match(q.sql, /upper\(trim\(press\)\) = upper\(trim\(\$2\)\)/);
});

// GEX-01's rows predate the status column, so every die_status there is NULL.
test('a die with no recorded status is not counted as available', async () => {
  const client = makeClient({ available: [{ count: 0 }] });
  await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  const q = client.calls.find((c) => c.sql.includes('COUNT('));
  assert.match(q.sql, /NULLIF\(die_status, ''\) IS NOT NULL/);
});

test('available is null when the key is unusable', async () => {
  const client = makeClient({});
  assert.equal(await d.nextDieNumber(client, { plant: 'GEX 2', profile: '', press: 'PRESS 8' }), null);
});

// Requests write '29663-213'; the die list stores '29663_213' and may pad the
// profile. Both have to be recognised as the same physical die.
test('dieNoExistsInDieList matches across separator and zero padding', async () => {
  const client = makeClient({ dies: [{ die_no: '29663_213' }] });
  assert.equal(await d.dieNoExistsInDieList(client, '29663-213'), true);
  assert.deepEqual(client.calls[0].params, ['29663', '213']);
});

// GEX-2 stores 090001-801 with a hyphen; matching only on '_' would let a
// duplicate through for that plant without any sign it had failed.
test('dieNoExistsInDieList reads the suffix past either separator', async () => {
  const client = makeClient({ dies: [{ die_no: '090001-801' }] });
  assert.equal(await d.dieNoExistsInDieList(client, '090001-801'), true);
  assert.match(client.calls[0].sql, /substring\(die_no from '\[-_\]\(\[0-9\]\+\)\$'\)/);
  assert.deepEqual(client.calls[0].params, ['90001', '801']);
});

test('dieNoExistsInDieList is false for an unknown die and for junk input', async () => {
  const client = makeClient({ dies: [] });
  assert.equal(await d.dieNoExistsInDieList(client, '29663-999'), false);
  assert.equal(await d.dieNoExistsInDieList(client, ''), false);
  assert.equal(await d.dieNoExistsInDieList(client, 'INS-12297'), false);
});
