'use strict';
process.env.JWT_SECRET = 'auth-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDb } = require('./testSupport.cjs');

// What the fake pool answers for the one flag lookup, and how often it was asked.
let flagInDb = false;
let lookups = [];
installFakeDb(async (sql, params) => {
  if (/^SELECT can_review_toolings FROM users WHERE id = \$1/.test(sql)) {
    lookups.push(params[0]);
    return { rows: [{ can_review_toolings: flagInDb }] };
  }
  throw new Error(`reviewer test: unexpected query ${sql}`);
});

const { reviewerMiddleware } = require('./auth.cjs');

// Run the middleware against fake req/res and report what it did.
async function run(user) {
  const out = { passed: false, status: null, body: null };
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  await reviewerMiddleware({ user }, res, () => { out.passed = true; });
  return out;
}

test.beforeEach(() => { flagInDb = false; lookups = []; });

test('reviewerMiddleware: admin passes, flagged user passes, plain user 403', async () => {
  assert.equal((await run({ id: 1, role: 'admin' })).passed, true);
  assert.equal((await run({ id: 2, role: 'user', canReviewToolings: true })).passed, true);
  const plain = await run({ id: 3, role: 'user', canReviewToolings: false });
  assert.equal(plain.passed, false);
  assert.equal(plain.status, 403);
  assert.deepEqual(plain.body, { error: 'Tooling review permission required' });
  assert.deepEqual(lookups, [], 'a payload that carries the flag never touches the database');
});

test('reviewerMiddleware: a token that predates the flag is checked once against the database', async () => {
  flagInDb = true;
  const yes = await run({ id: 4, role: 'user' });
  assert.equal(yes.passed, true);
  assert.deepEqual(lookups, [4]);
  flagInDb = false;
  const no = await run({ id: 4, role: 'user' });
  assert.equal(no.passed, false);
  assert.equal(no.status, 403);
});
