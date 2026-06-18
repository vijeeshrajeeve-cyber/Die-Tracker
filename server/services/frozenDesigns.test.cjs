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

test('findActiveMatch queries active row by full key', async () => {
  const client = makeClient([
    { match: (s) => s.includes('FROM frozen_designs') && s.includes('is_active'),
      result: () => ({ rows: [{ id: 7, profile_number: '14752' }], rowCount: 1 }) },
  ]);
  const res = await fd.findActiveMatch(client, { profile: '14752', plant: 'GEX 01', press: 'PRESS 4', cavity: 2 });
  assert.equal(res.id, 7);
  assert.deepEqual(client.calls[0].params, ['14752', 'GEX 01', 'PRESS 4', 2]);
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
