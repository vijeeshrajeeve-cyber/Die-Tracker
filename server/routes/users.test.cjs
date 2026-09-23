'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// What the routes wrote, so a test can check the stored hash itself.
const stored = new Map();
let lastInsert;
let lastUpdate;
let targetRole = 'user';

// Answer with only the columns the query names, as Postgres would.
const pick = (sql, row) => {
  const cols = sql.match(/^SELECT (.+?) FROM users/s)[1].trim();
  return Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, row[c]]));
};

installFakeDb(async (sql, params) => {
  if (/^SELECT id FROM users WHERE LOWER\(username\)/.test(sql)) return { rows: [] };
  if (/^INSERT INTO users/.test(sql)) {
    stored.set(params[0], params[1]);
    lastInsert = { sql, params };
    return { rows: [{ id: 41 }] };
  }
  if (/^SELECT id FROM users WHERE id = \$1/.test(sql)) return { rows: [{ id: params[0] }] };
  if (/^SELECT id, username, role FROM users WHERE id = \$1/.test(sql)) {
    return { rows: [{ id: params[0], username: 'ravi', role: targetRole }] };
  }
  if (/FROM users ORDER BY created_at DESC/.test(sql)) {
    return { rows: [pick(sql, {
      id: 7, username: 'ravi', full_name: null, email: null, phone: null, role: 'user',
      page_access: null, can_edit_order_details: true, created_at: null,
    })] };
  }
  if (/^UPDATE users SET\s+password_hash = \$1,\s+password_must_change = true/.test(sql)) {
    stored.set(`reset:${params[1]}`, params[0]);
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE users SET .* RETURNING/s.test(sql)) {
    lastUpdate = { sql, params };
    return { rows: [{ id: 7, username: 'ravi', role: targetRole, page_access: null, can_edit_order_details: false }] };
  }
  throw new Error(`users test: unexpected query ${sql}`);
});

// The value an UPDATE set for a column, or undefined when it left it alone.
const setValue = ({ sql, params }, col) => {
  const m = sql.match(new RegExp(`${col} = \\$(\\d+)`));
  return m ? params[Number(m[1]) - 1] : undefined;
};

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

test('a new user can be given the order details switch', async () => {
  const { status, body } = await request(base, '/api/users', {
    body: { username: 'editor1', password: 'Start-pass-1', role: 'user', can_edit_order_details: true },
  });
  assert.equal(status, 201);
  assert.equal(body.user.can_edit_order_details, true);
  assert.match(lastInsert.sql, /can_edit_order_details/);
  assert.equal(lastInsert.params[8], true);
});

test('a new user starts without the switch, and an admin never stores it', async () => {
  await request(base, '/api/users', { body: { username: 'plain1', password: 'Start-pass-1', role: 'user' } });
  assert.equal(lastInsert.params[8], false);
  await request(base, '/api/users', {
    body: { username: 'boss1', password: 'Start-pass-1', role: 'admin', can_edit_order_details: true },
  });
  assert.equal(lastInsert.params[8], false);
});

test('the switch can be turned on and off for an existing user', async () => {
  targetRole = 'user';
  const on = await request(base, '/api/users/7', { method: 'PATCH', body: { can_edit_order_details: true } });
  assert.equal(on.status, 200);
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), true);
  await request(base, '/api/users/7', { method: 'PATCH', body: { can_edit_order_details: false } });
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), false);
});

test('an update that leaves the switch out does not touch it', async () => {
  targetRole = 'user';
  await request(base, '/api/users/7', { method: 'PATCH', body: { email: 'ravi@example.com' } });
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), undefined);
});

test('making someone an admin clears the switch, since the role already allows editing', async () => {
  targetRole = 'user';
  await request(base, '/api/users/7', { method: 'PATCH', body: { role: 'admin', can_edit_order_details: true } });
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), false);
});

test('the switch must be true or false', async () => {
  const { status } = await request(base, '/api/users/7', { method: 'PATCH', body: { can_edit_order_details: 'maybe' } });
  assert.equal(status, 400);
});

test('the user list says who can edit order details', async () => {
  const { status, body } = await request(base, '/api/users');
  assert.equal(status, 200);
  assert.equal(body.users[0].can_edit_order_details, true);
});
