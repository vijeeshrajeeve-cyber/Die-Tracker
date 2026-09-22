'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// The stored ETA the next request will find; undefined means no such order.
let storedEta;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT eta FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) {
    return { rows: storedEta === undefined ? [] : [{ eta: storedEta }] };
  }
  if (/^UPDATE die_orders SET/.test(q)) return { rows: [], rowCount: storedEta === undefined ? 0 : 1 };
  if (/^INSERT INTO die_delivery_events/.test(q)) return { rows: [{ id: 1 }] };
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  if (/^UPDATE backup_die_requests/.test(q)) return { rows: [] };
  throw new Error(`orders test: unexpected query ${q}`);
});

const ordersRouter = require('./orders.cjs');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 5, username: 'planner' }; next(); });
app.use('/api/orders', ordersRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => { log = []; storedEta = '2026-10-01'; });

const kinds = () => log.map(({ q }) => q.split(/\s+/).slice(0, 3).join(' '));
const events = () => log.filter(({ q }) => q.startsWith('INSERT INTO die_delivery_events'));
const patch = (body) => request(base, '/api/orders/7', { method: 'PATCH', body });

test('moving a set ETA without a cause is refused and nothing is written', async () => {
  const { status, body } = await patch({ ETA: '2026-10-15' });
  assert.equal(status, 400);
  assert.equal(body.code, 'ETA_CAUSE_REQUIRED');
  assert.ok(!log.some(({ q }) => q.startsWith('UPDATE die_orders')), 'no update issued');
  assert.ok(log.some(({ q }) => q === 'ROLLBACK'));
});

test('with a cause the update and the revision commit together', async () => {
  const { status } = await patch({ ETA: '2026-10-15', 'ETA Change': { cause: 'supplier_delay', note: 'Heat treatment queue' } });
  assert.equal(status, 200);
  // No 'DIE NO' in the body, so autoUpdateBackupRequests returns early.
  assert.deepEqual(kinds(), ['BEGIN', 'SELECT eta FROM', 'UPDATE die_orders SET', 'INSERT INTO die_delivery_events', 'COMMIT']);
  assert.deepEqual(events()[0].params, ['7', 'eta_revised', '2026-10-01', '2026-10-15', 'supplier_delay', 'Heat treatment queue', 5, 'planner']);
});

test('a first ETA is logged as set with no cause', async () => {
  storedEta = null;
  const { status } = await patch({ ETA: '2026-11-01' });
  assert.equal(status, 200);
  assert.equal(events()[0].params[1], 'eta_set');
});

test('re-sending the same ETA records nothing', async () => {
  const { status } = await patch({ ETA: '01/10/2026', Remark: 'checked' });
  assert.equal(status, 200);
  assert.equal(events().length, 0);
});

test('a patch that does not carry ETA never reads it', async () => {
  const { status } = await patch({ Remark: 'checked' });
  assert.equal(status, 200);
  assert.ok(!log.some(({ q }) => q.startsWith('SELECT eta')));
});

test('an unknown order is a 404', async () => {
  storedEta = undefined;
  const { status } = await patch({ ETA: '2026-10-15' });
  assert.equal(status, 404);
});

test('PUT enforces the same rule', async () => {
  const refused = await request(base, '/api/orders/7', { method: 'PUT', body: { ETA: '2026-10-20' } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'ETA_CAUSE_REQUIRED');
  log = [];
  const ok = await request(base, '/api/orders/7', { method: 'PUT', body: { ETA: '2026-10-20', 'ETA Change': { cause: 'our_change' } } });
  assert.equal(ok.status, 200);
  assert.equal(events()[0].params[1], 'eta_revised');
});
