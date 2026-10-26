'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let log = [];
installFakeDb(async (sql) => {
  const q = sql.replace(/\s+/g, ' ').trim();
  log.push(q);
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/FROM die_orders WHERE status = 'UNDER SIMULATION'/.test(q)) return { rows: [] };
  if (/FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: [] };
  throw new Error(`simulation route test: unexpected query ${q}`);
});

let role = 'user';
const router = require('./simulation.cjs');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 5, username: 'eng', role }; next(); });
app.use('/api/simulation', router);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => { log = []; role = 'user'; });

test('GET lists the dies in Simulation', async () => {
  const { status, body } = await request(base, '/api/simulation');
  assert.equal(status, 200);
  assert.deepEqual(body, { dies: [] });
});

test('DELETE last-step is admin only and touches nothing for others', async () => {
  const { status } = await request(base, '/api/simulation/7/last-step', { method: 'DELETE' });
  assert.equal(status, 403);
  assert.equal(log.length, 0);
});

test('an admin undo on a missing order is 404', async () => {
  role = 'admin';
  const { status } = await request(base, '/api/simulation/7/last-step', { method: 'DELETE' });
  assert.equal(status, 404);
});

test('a step on a missing order is 404', async () => {
  const { status } = await request(base, '/api/simulation/7/steps', { body: { step: 'model_received', date: '2026-10-20' } });
  assert.equal(status, 404);
});

test('a non-numeric order id is rejected before any query', async () => {
  const { status } = await request(base, '/api/simulation/abc/steps', { body: { step: 'model_received', date: '2026-10-20' } });
  assert.equal(status, 400);
  assert.equal(log.length, 0);
});
