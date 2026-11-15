'use strict';
process.env.JWT_SECRET = 'plants-test-secret-that-is-at-least-32-characters-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let plants;        // rows in the plants table
let dieLifeRows;   // how many supplier_die_life rows carry the plant being deleted
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim().replace(/\s+/g, ' ');
  log.push({ q, params });
  if (/FROM users WHERE id = \$1/.test(q)) return { rows: [{ id: currentUser.id, username: currentUser.username, role: currentUser.role, password_must_change: false, page_access: null }] };
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT \* FROM plants WHERE id = \$1/.test(q)) return { rows: plants.filter((p) => p.id === Number(params[0])) };
  if (/^SELECT id FROM plants WHERE name = \$1/.test(q)) return { rows: plants.filter((p) => p.name === params[0] && p.id !== Number(params[1] || 0)) };
  if (/^SELECT 1 FROM supplier_die_life WHERE plant = \$1/.test(q)) return { rows: dieLifeRows ? [{ '?column?': 1 }] : [] };
  if (/^DELETE FROM plants/.test(q)) return { rows: [] };
  throw new Error(`plants test: unexpected query ${q}`);
});

let currentUser;
const app = express();
app.use(express.json());
app.use('/api/plants', require('./plants.cjs'));

const tokenFor = () => jwt.sign({ id: currentUser.id }, process.env.JWT_SECRET);
const call = (path, opts = {}) => request(base, `/api/plants${path}`, { token: tokenFor(), ...opts });

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  log = [];
  plants = [{ id: 1, name: 'GEX 01' }, { id: 2, name: 'GEX 02' }];
  dieLifeRows = false;
  currentUser = { id: 1, username: 'boss', role: 'admin' };
});

test('deleting a plant that has die life figures is refused with 409', async () => {
  dieLifeRows = true;
  const { status, body } = await call('/1', { method: 'DELETE' });
  assert.equal(status, 409);
  assert.equal(body.error, 'This plant has die life figures and cannot be deleted');
  assert.ok(!log.some((l) => /^DELETE FROM plants/.test(l.q)));
});

test('a plant with no die life figures is deleted', async () => {
  const { status } = await call('/1', { method: 'DELETE' });
  assert.equal(status, 200);
  assert.ok(log.some((l) => /^DELETE FROM plants/.test(l.q)));
  assert.deepEqual(log.find((l) => /FROM supplier_die_life WHERE plant/.test(l.q)).params, ['GEX 01']);
});

test('only an admin can delete a plant', async () => {
  currentUser = { id: 5, username: 'planner', role: 'user' };
  assert.equal((await call('/1', { method: 'DELETE' })).status, 403);
});

test('there is no plant rename route', () => {
  const methods = require('./plants.cjs').stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods));
  assert.ok(!methods.includes('put'));
});
