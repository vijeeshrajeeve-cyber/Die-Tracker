'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const ROW = {
  id: 9, die_no: 'D-9', plant: 'GEX 1', profile_number: 'P9', source: 'order-pdf', source_ref: '12',
  review_reason: 'ccd mismatch', style: 'outline', hole_count: 1, has_image: true, updated_at: '2026-11-05T10:00:00.000Z',
};
const queries = [];
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  if (/count\(\*\)/.test(sql)) return { rows: [{ count: '3' }] };
  if (/FROM profile_shapes/.test(sql)) return { rows: [ROW] };
  throw new Error(`unexpected query ${sql}`);
});

const router = require('./profile-shapes.cjs');
const app = express();
app.use(express.json());
app.use('/api/profile-shapes', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); });
test.beforeEach(() => { queries.length = 0; });

test('review-queue lists flagged shapes newest first with a total, not read as a die number', async () => {
  const res = await request(base, '/api/profile-shapes/review-queue?plant=GEX%2001&limit=5&offset=10');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { items: [ROW], total: 3 });
  const [list, count] = queries;
  assert.match(list.sql, /needs_review = true/);
  assert.match(list.sql, /image_path IS NOT NULL AS has_image/);
  assert.match(list.sql, /ORDER BY updated_at DESC/);
  assert.doesNotMatch(list.sql, /signature|outer_unit/, 'no geometry in the queue');
  assert.deepEqual(list.params, ['GEX 1', 5, 10], 'plant normalised, limit and offset passed');
  assert.match(count.sql, /needs_review = true/);
  assert.deepEqual(count.params, ['GEX 1']);
});

test('review-queue without a plant lists every plant and clamps the limit', async () => {
  const res = await request(base, '/api/profile-shapes/review-queue?limit=9999&offset=-4');
  assert.equal(res.status, 200);
  assert.deepEqual(queries[0].params, [200, 0]);
  assert.doesNotMatch(queries[0].sql, /plant = \$/);
  const dflt = await request(base, '/api/profile-shapes/review-queue');
  assert.equal(dflt.status, 200);
  assert.deepEqual(queries[2].params, [50, 0]);
});
