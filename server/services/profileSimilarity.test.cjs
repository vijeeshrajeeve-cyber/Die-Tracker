'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIndex, nearest, invalidate } = require('./profileSimilarity.cjs');

const sig = (v) => Array.from({ length: 24 }, (_, i) => (i === 0 ? v : 0));
const row = (id, dieNo, v, extra = {}) => ({
  id, die_no: dieNo, plant: 'GEX 1', profile_number: `P${id}`, signature: sig(v),
  hole_count: 0, cavities: 2, true_size: false, updated_at: '2026-11-01T00:00:00Z', ...extra,
});

// A client that answers the stamp and the full load, counting each.
function fakeClient(state) {
  const calls = { stamp: 0, load: 0, sql: [] };
  return {
    calls,
    async query(sql, params) {
      calls.sql.push({ sql, params });
      if (/max\(updated_at\)/.test(sql)) {
        calls.stamp++;
        return { rows: [{ max_updated: state.stamp, n: state.rows.length }] };
      }
      calls.load++;
      return { rows: state.rows };
    },
  };
}

test('nearest returns same-hole-count shapes by ascending distance, one per die', async () => {
  invalidate('GEX 1');
  const rows = [
    row(1, 'D-A', 0.5),
    row(2, 'D-A', 0.1), // the better of D-A's two rows
    row(3, 'D-B', 0.3),
    row(4, 'D-C', 0.2),
    row(5, 'D-H', 0.0, { hole_count: 1 }), // different hole count: excluded
    row(6, 'D-SELF', 0.0),
  ];
  const index = await loadIndex(fakeClient({ stamp: 's1', rows }), { plant: 'GEX 1' });
  const items = nearest(index, { signature: sig(0), holeCount: 0, excludeDieNo: 'D-SELF' });
  assert.deepEqual(items.map((i) => i.die_no), ['D-A', 'D-C', 'D-B']);
  assert.equal(items[0].shapeId, 2);
  assert.equal(items[0].profile_number, 'P2');
  assert.ok(Math.abs(items[0].distance - 0.1) < 1e-12);
  assert.deepEqual(Object.keys(items[0]).sort(), ['cavityMatch', 'die_no', 'distance', 'profile_number', 'shapeId', 'trueSize']);
  assert.equal(items[0].trueSize, false);
  assert.equal(nearest(index, { signature: sig(0), holeCount: 0, limit: 2 }).length, 2);
  assert.ok(!nearest(index, { signature: sig(0), holeCount: 0, excludeDieNo: 'D_SELF' }).some((i) => i.die_no === 'D-SELF'),
    '_ and - are the same die-number separator');
});

test('needs_review rows are never returned', async () => {
  invalidate('GEX 1');
  const client = fakeClient({ stamp: 's1', rows: [row(1, 'D-A', 0.1), row(2, 'D-FLAG', 0.0, { needs_review: true })] });
  const index = await loadIndex(client, { plant: 'GEX 1' });
  const load = client.calls.sql.find((q) => /FROM profile_shapes/.test(q.sql) && !/max\(updated_at\)/.test(q.sql));
  assert.match(load.sql, /needs_review = false/);
  assert.deepEqual(load.params, ['GEX 1']);
  const items = nearest(index, { signature: sig(0), holeCount: 0 });
  assert.deepEqual(items.map((i) => i.die_no), ['D-A']);
});

test('cavityMatch is reported, not filtered', async () => {
  invalidate('GEX 1');
  const rows = [row(1, 'D-2', 0.1), row(2, 'D-4', 0.2, { cavities: 4 }), row(3, 'D-NULL', 0.3, { cavities: null })];
  const index = await loadIndex(fakeClient({ stamp: 's1', rows }), { plant: 'GEX 1' });
  const items = nearest(index, { signature: sig(0), holeCount: 0, cavities: 2 });
  assert.deepEqual(items.map((i) => [i.die_no, i.cavityMatch]), [['D-2', true], ['D-4', false], ['D-NULL', null]]);
  const unknown = nearest(index, { signature: sig(0), holeCount: 0 });
  assert.deepEqual(unknown.map((i) => i.cavityMatch), [null, null, null]);
});

test('the cache refreshes when the stamp changes', async () => {
  invalidate('GEX 1');
  const state = { stamp: 's1', rows: [row(1, 'D-A', 0.1)] };
  const client = fakeClient(state);
  const first = await loadIndex(client, { plant: 'GEX 1' });
  const again = await loadIndex(client, { plant: 'GEX 1' });
  assert.equal(client.calls.stamp, 2, 'the stamp is checked on every call');
  assert.equal(client.calls.load, 1, 'an unchanged stamp reuses the cache');
  assert.equal(again, first);
  state.stamp = 's2';
  state.rows = [row(1, 'D-A', 0.1), row(2, 'D-B', 0.2)];
  const fresh = await loadIndex(client, { plant: 'GEX 1' });
  assert.equal(client.calls.load, 2);
  assert.equal(nearest(fresh, { signature: sig(0), holeCount: 0 }).length, 2);
  invalidate('GEX 1');
  await loadIndex(client, { plant: 'GEX 1' });
  assert.equal(client.calls.load, 3, 'invalidate forces a reload');
});
