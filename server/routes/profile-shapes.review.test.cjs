'use strict';
process.env.JWT_SECRET = 'profile-review-test-secret-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const queries = [];
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  if (/^UPDATE profile_shapes/.test(sql)) {
    return params[0] === 4 ? { rows: [{ id: 4, plant: 'GEX 2', needs_review: params[1] }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  throw new Error(`unexpected query ${sql}`);
});

const profileSimilarity = require('../services/profileSimilarity.cjs');
const router = require('./profile-shapes.cjs');
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/profile-shapes', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); });
test.beforeEach(() => { currentUser = { id: 12, role: 'user', canReviewToolings: true }; queries.length = 0; });

test('a plain user gets 403 on the profile review', async () => {
  currentUser = { id: 13, role: 'user', canReviewToolings: false };
  const res = await request(base, '/api/profile-shapes/4/review', { body: { action: 'clear' } });
  assert.equal(res.status, 403);
  assert.deepEqual(queries, []);
});

test('clear and keep set needs_review, record the reviewer and invalidate the plant', async (t) => {
  const seen = [];
  const real = profileSimilarity.invalidate;
  profileSimilarity.invalidate = (plant) => seen.push(plant);
  t.after(() => { profileSimilarity.invalidate = real; });

  const clear = await request(base, '/api/profile-shapes/4/review', { body: { action: 'clear', note: 'fine' } });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.shape.needs_review, false);
  assert.deepEqual(queries[0].params, [4, false, 12, 'fine']);
  const keep = await request(base, '/api/profile-shapes/4/review', { body: { action: 'keep' } });
  assert.equal(keep.status, 200);
  assert.equal(keep.body.shape.needs_review, true);
  assert.deepEqual(seen, ['GEX 2', 'GEX 2']);
});

test('unknown ids are 404, a bad action is 400', async () => {
  assert.equal((await request(base, '/api/profile-shapes/77/review', { body: { action: 'clear' } })).status, 404);
  assert.equal((await request(base, '/api/profile-shapes/abc/review', { body: { action: 'clear' } })).status, 404);
  assert.equal((await request(base, '/api/profile-shapes/4/review', { body: { action: 'delete' } })).status, 400);
});
