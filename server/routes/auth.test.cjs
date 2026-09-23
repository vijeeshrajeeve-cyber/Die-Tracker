'use strict';
// auth.cjs reads these once, when it is first required. The rate limit is
// raised so the deliberate wrong passwords below cannot trip it.
process.env.JWT_SECRET = 'auth-test-secret-that-is-at-least-32-characters';
process.env.AUTH_RATE_LIMIT_MAX = '100';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// Only the queries these tests need are answered.
const users = new Map();
const byName = (name) => [...users.values()].find((u) => u.username === name);
// Answer with only the columns the query names, as Postgres would, so a
// column left out of a SELECT is missing here too.
const pick = (sql, row) => {
  const cols = sql.match(/^SELECT (.+?) FROM users/s)[1].trim();
  if (cols === '*') return row;
  return Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, row[c]]));
};
installFakeDb(async (sql, params) => {
  if (/FROM users WHERE id = \$1/.test(sql)) {
    return { rows: users.has(params[0]) ? [pick(sql, users.get(params[0]))] : [] };
  }
  if (/FROM users WHERE username = \$1/.test(sql)) {
    return { rows: byName(params[0]) ? [pick(sql, byName(params[0]))] : [] };
  }
  if (/^UPDATE users SET password_hash = \$1, password_must_change = false/.test(sql)) {
    Object.assign(users.get(params[1]), { password_hash: params[0], password_must_change: false });
    return { rows: [], rowCount: 1 };
  }
  if (/failed_login_attempts = failed_login_attempts \+ 1/.test(sql)) {
    const user = users.get(params[1]);
    user.failed_login_attempts += 1;
    return { rows: [{ failed_login_attempts: user.failed_login_attempts }] };
  }
  if (/SET failed_login_attempts = 0/.test(sql)) {
    users.get(params[0]).failed_login_attempts = 0;
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`auth test: unexpected query ${sql}`);
});

const { router: authRouter, authMiddleware } = require('./auth.cjs');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.get('/api/orders', authMiddleware, (req, res) => res.json({ orders: [], user: req.user.username }));
app.get('/api/whoami', authMiddleware, (req, res) => res.json(req.user));

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());

let nextId = 1;
const addUser = ({ mustChange, password = 'Temp-pass-1', canEdit = false }) => {
  const id = nextId++;
  users.set(id, {
    id, username: `user${id}`, role: 'user', page_access: null,
    password_hash: bcrypt.hashSync(password, 4), password_must_change: mustChange,
    failed_login_attempts: 0, locked_until: null, can_edit_order_details: canEdit,
  });
  // The token deliberately says nothing about the pending change: the server
  // has to read it from the database, not trust what the client holds.
  return { username: `user${id}`, token: jwt.sign({ id, username: `user${id}`, role: 'user' }, process.env.JWT_SECRET) };
};
const signIn = (username, password) => request(base, '/api/auth/login', { body: { username, password } });

test('a user holding a temporary password is refused by protected routes', async () => {
  const { token } = addUser({ mustChange: true });
  const { status, body } = await request(base, '/api/orders', { token });
  assert.equal(status, 403);
  assert.equal(body.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('that user can still change the password, and is let through afterwards', async () => {
  const { token } = addUser({ mustChange: true, password: 'Temp-pass-1' });
  const changed = await request(base, '/api/auth/change-password', {
    token, body: { currentPassword: 'Temp-pass-1', newPassword: 'New-pass-22' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const after = await request(base, '/api/orders', { token: changed.body.token });
  assert.equal(after.status, 200);
});

test('that user can still read their own profile', async () => {
  const { token } = addUser({ mustChange: true });
  const { status, body } = await request(base, '/api/auth/me', { token });
  assert.equal(status, 200);
  assert.equal(body.user.passwordMustChange, true);
});

test('a user with no pending change is let through', async () => {
  const { token } = addUser({ mustChange: false });
  const { status, body } = await request(base, '/api/orders', { token });
  assert.equal(status, 200);
  assert.match(body.user, /^user\d+$/);
});

test('the right password signs in', async () => {
  const { username } = addUser({ mustChange: false, password: 'Right-pass-1' });
  const { status, body } = await signIn(username, 'Right-pass-1');
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.token);
});

// An un-awaited compare is a Promise, and a Promise is truthy: this is the
// test that fails if a password check ever loses its await.
test('a wrong password is refused and counted towards the lockout', async () => {
  const { username } = addUser({ mustChange: false, password: 'Right-pass-1' });
  const { status, body } = await signIn(username, 'Wrong-pass-1');
  assert.equal(status, 401);
  assert.match(body.error, /^Invalid credentials\. 4 attempt\(s\) remaining$/);
  assert.equal(byName(username).failed_login_attempts, 1);
});

test('a wrong current password cannot change the password', async () => {
  const { token } = addUser({ mustChange: true, password: 'Temp-pass-1' });
  const { status, body } = await request(base, '/api/auth/change-password', {
    token, body: { currentPassword: 'Wrong-pass-1', newPassword: 'New-pass-22' },
  });
  assert.equal(status, 401);
  assert.equal(body.error, 'Current password is incorrect');
});

test('the new password is refused if it matches the current one', async () => {
  const { token } = addUser({ mustChange: true, password: 'Temp-pass-1' });
  const { status } = await request(base, '/api/auth/change-password', {
    token, body: { currentPassword: 'Temp-pass-1', newPassword: 'Temp-pass-1' },
  });
  assert.equal(status, 400);
});

test('after a change the new password signs in and the old one does not', async () => {
  const { username, token } = addUser({ mustChange: true, password: 'Temp-pass-1' });
  const changed = await request(base, '/api/auth/change-password', {
    token, body: { currentPassword: 'Temp-pass-1', newPassword: 'New-pass-22' },
  });
  assert.equal(changed.status, 200);

  assert.equal((await signIn(username, 'New-pass-22')).status, 200);
  assert.equal((await signIn(username, 'Temp-pass-1')).status, 401);
});

test('sign-in and the profile say whether the user may edit order details', async () => {
  const { username, token } = addUser({ mustChange: false, password: 'Right-pass-1', canEdit: true });
  const signedIn = await signIn(username, 'Right-pass-1');
  assert.equal(signedIn.body.user.canEditOrderDetails, true);
  const me = await request(base, '/api/auth/me', { token });
  assert.equal(me.body.user.canEditOrderDetails, true);
});

test('the permission is read from the database on every request', async () => {
  const { token } = addUser({ mustChange: false });
  const { id } = jwt.decode(token);
  assert.equal((await request(base, '/api/whoami', { token })).body.canEditOrderDetails, false);
  users.get(id).can_edit_order_details = true;
  assert.equal((await request(base, '/api/whoami', { token })).body.canEditOrderDetails, true);
});

test('a password change keeps the permission in the user it returns', async () => {
  const { token } = addUser({ mustChange: true, password: 'Temp-pass-1', canEdit: true });
  const changed = await request(base, '/api/auth/change-password', {
    token, body: { currentPassword: 'Temp-pass-1', newPassword: 'New-pass-22' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.canEditOrderDetails, true);
});
