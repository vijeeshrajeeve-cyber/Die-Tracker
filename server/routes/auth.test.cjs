'use strict';
// auth.cjs reads JWT_SECRET once, when it is first required.
process.env.JWT_SECRET = 'auth-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Stand in for db.cjs, so nothing in this file can reach a real database and
// the pg pool is never created. Only the queries these tests need are answered.
const users = new Map();
const fakePool = {
  async query(sql, params) {
    if (/FROM users WHERE id = \$1/.test(sql)) {
      return { rows: users.has(params[0]) ? [users.get(params[0])] : [] };
    }
    if (/^UPDATE users SET password_hash = \$1, password_must_change = false/.test(sql)) {
      Object.assign(users.get(params[1]), { password_hash: params[0], password_must_change: false });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`auth test: unexpected query ${sql}`);
  },
};
const dbPath = require.resolve('../db.cjs');
const dbModule = new Module(dbPath);
dbModule.filename = dbPath;
dbModule.loaded = true;
dbModule.exports = { pool: fakePool };
require.cache[dbPath] = dbModule;

const { router: authRouter, authMiddleware } = require('./auth.cjs');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.get('/api/orders', authMiddleware, (req, res) => res.json({ orders: [], user: req.user.username }));

let base;
const server = app.listen(0);
test.before(() => new Promise((resolve) => server.once('listening', () => {
  base = `http://127.0.0.1:${server.address().port}`;
  resolve();
})));
test.after(() => new Promise((resolve) => server.close(resolve)));

let nextId = 1;
const addUser = ({ mustChange, password = 'Temp-pass-1' }) => {
  const id = nextId++;
  users.set(id, {
    id, username: `user${id}`, role: 'user', page_access: null,
    password_hash: bcrypt.hashSync(password, 4), password_must_change: mustChange,
  });
  // The token deliberately says nothing about the pending change: the server
  // has to read it from the database, not trust what the client holds.
  return jwt.sign({ id, username: `user${id}`, role: 'user' }, process.env.JWT_SECRET);
};

const call = async (path, token, body) => {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

test('a user holding a temporary password is refused by protected routes', async () => {
  const token = addUser({ mustChange: true });
  const { status, body } = await call('/api/orders', token);
  assert.equal(status, 403);
  assert.equal(body.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('that user can still change the password, and is let through afterwards', async () => {
  const token = addUser({ mustChange: true, password: 'Temp-pass-1' });
  const changed = await call('/api/auth/change-password', token, {
    currentPassword: 'Temp-pass-1', newPassword: 'New-pass-22',
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const after = await call('/api/orders', changed.body.token);
  assert.equal(after.status, 200);
});

test('that user can still read their own profile', async () => {
  const token = addUser({ mustChange: true });
  const { status, body } = await call('/api/auth/me', token);
  assert.equal(status, 200);
  assert.equal(body.user.passwordMustChange, true);
});

test('a user with no pending change is let through', async () => {
  const token = addUser({ mustChange: false });
  const { status, body } = await call('/api/orders', token);
  assert.equal(status, 200);
  assert.match(body.user, /^user\d+$/);
});
