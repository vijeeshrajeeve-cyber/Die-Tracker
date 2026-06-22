'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fd = require('./frozenDesigns.cjs');

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

const PRESSES = [
  { press_name: 'PRESS 2', press_code: 'B' },
  { press_name: 'PRESS 4', press_code: 'D' },
  { press_name: 'PRESS 5', press_code: 'E' },
  { press_name: 'PRESS 7', press_code: 'P25' },
  { press_name: 'PRESS 8', press_code: 'P35' },
];

test('normalizePlant strips zero-padding and uppercases', () => {
  assert.equal(fd.normalizePlant('GEX 01'), 'GEX 1');
  assert.equal(fd.normalizePlant('gex 1'), 'GEX 1');
  assert.equal(fd.normalizePlant('  GEX 02 '), 'GEX 2');
  assert.equal(fd.normalizePlant(''), '');
});

test('canonicalPress resolves all representations to press_name', () => {
  assert.equal(fd.canonicalPress('PRESS 8', PRESSES), 'PRESS 8'); // name
  assert.equal(fd.canonicalPress('P8', PRESSES), 'PRESS 8');      // P + number (PDF)
  assert.equal(fd.canonicalPress('8', PRESSES), 'PRESS 8');       // bare number
  assert.equal(fd.canonicalPress('P35', PRESSES), 'PRESS 8');     // master press_code
  assert.equal(fd.canonicalPress('E', PRESSES), 'PRESS 5');       // letter code
  assert.equal(fd.canonicalPress('press 5', PRESSES), 'PRESS 5'); // case/space
  assert.equal(fd.canonicalPress('P25', PRESSES), 'PRESS 7');     // code wins over P+number
});

test('canonicalPress falls back to cleaned token when unknown', () => {
  assert.equal(fd.canonicalPress('P99', PRESSES), 'P99');
  assert.equal(fd.canonicalPress('press 99', PRESSES), 'PRESS99');
  assert.equal(fd.canonicalPress('', PRESSES), '');
});

test('extractProfileFromDie strips prefix and leading zeros', () => {
  assert.equal(fd.extractProfileFromDie('014752-702'), '14752');
  assert.equal(fd.extractProfileFromDie('00900'), '900');
  assert.equal(fd.extractProfileFromDie(''), null);
  assert.equal(fd.extractProfileFromDie(null), null);
});

test('findActiveMatch returns null when key incomplete', async () => {
  const client = makeClient();
  const res = await fd.findActiveMatch(client, { profile: '14752', plant: 'GEX 01', press: '', cavity: 2 });
  assert.equal(res, null);
  assert.equal(client.calls.length, 0); // no query fired
});

test('findActiveMatch normalizes plant + press then queries active row', async () => {
  const client = makeClient([
    { match: (s) => s.includes('FROM presses'), result: () => ({ rows: PRESSES }) },
    { match: (s) => s.includes('FROM frozen_designs') && s.includes('is_active'),
      result: () => ({ rows: [{ id: 7, profile_number: '14752' }], rowCount: 1 }) },
  ]);
  // Incoming uses PDF/zero-padded forms; should normalize to canonical PRESS 8 / GEX 1.
  const res = await fd.findActiveMatch(client, { profile: '14752', plant: 'GEX 01', press: 'P8', cavity: 2 });
  assert.equal(res.id, 7);
  const matchCall = client.calls.find(c => c.sql.includes('FROM frozen_designs'));
  assert.deepEqual(matchCall.params, ['14752', 'GEX 1', 'PRESS 8', 2]);
});

test('freezeDesign supersedes existing active then inserts new', async () => {
  const client = makeClient([
    { match: (s) => s.startsWith('UPDATE frozen_designs SET is_active = false'),
      result: () => ({ rows: [], rowCount: 1 }) },
    { match: (s) => s.startsWith('INSERT INTO frozen_designs'),
      result: () => ({ rows: [{ id: 42 }], rowCount: 1 }) },
    { match: (s) => s.startsWith('UPDATE frozen_designs SET superseded_by'),
      result: () => ({ rows: [], rowCount: 1 }) },
  ]);
  const id = await fd.freezeDesign(client, {
    profile: '14752', plant: 'GEX 01', press: 'PRESS 4', cavity: 2,
    sourceOrderId: 5, frozenBy: 3, notes: 'final',
  });
  assert.equal(id, 42);
  const sqls = client.calls.map(c => c.sql);
  assert.ok(sqls.some(s => s.startsWith('UPDATE frozen_designs SET is_active = false')));
  assert.ok(sqls.some(s => s.startsWith('INSERT INTO frozen_designs')));
});

test('listFrozenDesigns selects released/bypassed counts and orders by frozen_at', async () => {
  const client = makeClient([
    { match: (s) => s.includes('FROM frozen_designs') && s.includes('released_count'),
      result: () => ({ rows: [{ id: 1, released_count: 3, bypassed_count: 1 }], rowCount: 1 }) },
    { match: (s) => s.includes('FROM frozen_design_files'),
      result: () => ({ rows: [{ id: 11, frozen_design_id: 1, original_name: 'd.pdf' }] }) },
  ]);
  const rows = await fd.listFrozenDesigns(client, {});
  assert.equal(rows[0].released_count, 3);
  assert.equal(rows[0].bypassed_count, 1);
  assert.equal(rows[0].files.length, 1);
});

test('matchBulk maps order ids to matching active frozen designs (with normalization)', async () => {
  const client = makeClient([
    { match: (s) => s.includes('FROM presses'), result: () => ({ rows: PRESSES }) },
    { match: (s) => s.includes('FROM frozen_designs fd WHERE fd.is_active'),
      result: () => ({ rows: [
        { id: 5, profile_number: '14752', plant: 'GEX 1', press: 'PRESS 8', cavity: 2, frozen_at: '2026-06-21', files_count: '1' },
      ] }) },
  ]);
  const res = await fd.matchBulk(client, [
    { id: 101, profile: '14752', plant: 'GEX 01', press: 'P8', cavity: 2 }, // normalizes -> matches id 5
    { id: 102, profile: '14752', plant: 'GEX 1', press: 'PRESS 7', cavity: 2 }, // different press -> no match
    { id: 103, profile: '99999', plant: 'GEX 1', press: '', cavity: 2 }, // incomplete key -> skipped
  ]);
  assert.equal(res[101].id, 5);
  assert.equal(res[101].files_count, 1);
  assert.equal(res[102], undefined);
  assert.equal(res[103], undefined);
});

test('manualRelease deactivates by id with reason manual', async () => {
  const client = makeClient([
    { match: (s) => s.startsWith('UPDATE frozen_designs SET is_active = false'),
      result: () => ({ rows: [{ id: 5 }], rowCount: 1 }) },
  ]);
  const ok = await fd.manualRelease(client, { id: 5, userId: 2 });
  assert.equal(ok, true);
  assert.deepEqual(client.calls[0].params, [2, 5]);
});
