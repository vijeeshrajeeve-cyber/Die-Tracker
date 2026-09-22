'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// What the routes wrote, so a test can check the stored hash itself.
const stored = new Map();
installFakeDb(async (sql, params) => {
  if (/^SELECT id FROM users WHERE LOWER\(username\)/.test(sql)) return { rows: [] };
  if (/^INSERT INTO users/.test(sql)) {
    stored.set(params[0], params[1]);
    return { rows: [{ id: 41 }] };
  }
  if (/^SELECT id FROM users WHERE id = \$1/.test(sql)) return { rows: [{ id: params[0] }] };
  if (/^UPDATE users SET\s+password_hash = \$1,\s+password_must_change = true/.test(sql)) {
    stored.set(`reset:${params[1]}`, params[0]);
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`users test: unexpected query ${sql}`);
});

const usersRouter = require('./users.cjs');

// index.cjs puts authMiddleware and adminMiddleware in front of this router.
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
app.use('/api/users', usersRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());

// A hash that is not awaited is stored as "[object Promise]", and nobody can
// ever sign in with it. These fail if that happens.
test('a new user is stored with a hash of the password they were given', async () => {
  const { status } = await request(base, '/api/users', {
    body: { username: 'newstarter', password: 'Start-pass-1', role: 'user' },
  });
  assert.equal(status, 201);
  const hash = stored.get('newstarter');
  assert.equal(await bcrypt.compare('Start-pass-1', hash), true);
  assert.equal(bcrypt.getRounds(hash), 12);
});

test('a reset password is stored as a hash of the new password', async () => {
  const { status } = await request(base, '/api/users/7/reset-password', {
    body: { password: 'Reset-pass-1' },
  });
  assert.equal(status, 200);
  const hash = stored.get('reset:7');
  assert.equal(await bcrypt.compare('Reset-pass-1', hash), true);
  assert.equal(bcrypt.getRounds(hash), 12);
});
