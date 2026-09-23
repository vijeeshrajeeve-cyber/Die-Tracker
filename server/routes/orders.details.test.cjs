'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// The order the next request finds; null means no such order.
let stored;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT \* FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: stored ? [stored] : [] };
  if (/^UPDATE die_orders SET/.test(q)) return { rows: [{ ...stored }], rowCount: 1 };
  if (/^INSERT INTO die_delivery_events/.test(q)) return { rows: [{ id: 1 }] };
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  if (/^UPDATE backup_die_requests/.test(q)) return { rows: [] };
  throw new Error(`order details test: unexpected query ${q}`);
});

const ordersRouter = require('./orders.cjs');

const EDITOR = { id: 5, username: 'planner', role: 'user', canEditOrderDetails: true };
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/orders', ordersRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  log = [];
  currentUser = EDITOR;
  stored = {
    id: 7, die_no: '30533_201', status: 'PENDING FOR DESIGN APPROVAL', supplier: 'ALPHA', cavity: 2,
    ordered_date: null, die_received_date: null, eta: '2026-10-01', simulation_enabled: 0,
    urgency: 'NORMAL', special_follow_up: false,
  };
});

const save = (body) => request(base, '/api/orders/7/details', { method: 'PATCH', body });
const queries = (prefix) => log.filter(({ q }) => q.startsWith(prefix));
// order_changes columns: order_id, user_id, changed_by_name, changed_at,
// field_name, old_value, new_value, reason, stage.
const logged = () => queries('INSERT INTO order_changes').map(({ params }) => ({
  field: params[4], old: params[5], new: params[6], reason: params[7], stage: params[8], by: params[2],
}));

test('someone without the switch is refused before anything is read', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status, body } = await save({ fields: { 'Die Received Date': '2026-09-21' } });
  assert.equal(status, 403);
  assert.equal(body.code, 'ORDER_EDIT_FORBIDDEN');
  assert.equal(log.length, 0);
});

test('an admin needs no switch', async () => {
  currentUser = { id: 1, username: 'admin', role: 'admin' };
  const { status } = await save({ fields: { 'Die Received Date': '2026-09-21' } });
  assert.equal(status, 200);
});

test('filling empty fields saves without a reason and logs each field', async () => {
  const { status, body } = await save({ fields: { 'Die Received Date': '2026-09-21', simulationEnabled: true } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.logged, 2);
  const [update] = queries('UPDATE die_orders');
  assert.match(update.q, /die_received_date = \$1, simulation_enabled = \$2, updated_at = CURRENT_TIMESTAMP WHERE id = \$3 RETURNING \*/);
  assert.deepEqual(update.params, ['2026-09-21', 1, '7']);
  assert.deepEqual(logged(), [
    { field: 'Die Received Date', old: null, new: '2026-09-21', reason: null, stage: 'PENDING FOR DESIGN APPROVAL', by: 'planner' },
    { field: 'simulationEnabled', old: 'No', new: 'Yes', reason: null, stage: 'PENDING FOR DESIGN APPROVAL', by: 'planner' },
  ]);
  assert.equal(log.at(-1).q, 'COMMIT');
});

test('changing an existing value without a reason is refused and nothing is written', async () => {
  const { status, body } = await save({ fields: { Supplier: 'BETA', 'Die Received Date': '2026-09-21' } });
  assert.equal(status, 400);
  assert.equal(body.code, 'REASON_REQUIRED');
  assert.deepEqual(body.fields, ['Supplier']);
  assert.equal(queries('UPDATE die_orders').length, 0);
  assert.equal(log.at(-1).q, 'ROLLBACK');
});

test('with a reason, every field is logged with the stored old value and that reason', async () => {
  const { status, body } = await save({
    fields: { Supplier: 'BETA', Cavity: '3', 'Die Received Date': '2026-09-21' },
    reason: '  Supplier revised the quotation ',
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(logged().map((e) => [e.field, e.old, e.new, e.reason]), [
    ['Supplier', 'ALPHA', 'BETA', 'Supplier revised the quotation'],
    ['Cavity', '2', '3', 'Supplier revised the quotation'],
    ['Die Received Date', null, '2026-09-21', 'Supplier revised the quotation'],
  ]);
  assert.equal(body.order['DIE NO'], '30533_201');
  assert.equal('changeCount' in body.order, false);
});

test('an ordinary status step needs no reason, but CANCELLED does', async () => {
  const step = await save({ fields: { 'Design Approved Date': '2026-09-22', STATUS: 'PENDING FOR PR' } });
  assert.equal(step.status, 200, JSON.stringify(step.body));
  const cancel = await save({ fields: { STATUS: 'CANCELLED' } });
  assert.equal(cancel.status, 400);
  assert.equal(cancel.body.code, 'REASON_REQUIRED');
  assert.deepEqual(cancel.body.fields, ['STATUS']);
});

test('re-sending stored values writes nothing', async () => {
  const { status, body } = await save({ fields: { Supplier: ' ALPHA ', Cavity: 2 } });
  assert.equal(status, 200);
  assert.equal(body.logged, 0);
  assert.equal(queries('UPDATE die_orders').length, 0);
  assert.equal(log.at(-1).q, 'ROLLBACK');
});

test('fields the drawer does not show are refused', async () => {
  const { status, body } = await save({ fields: { Remark: 'hello' } });
  assert.equal(status, 400);
  assert.match(body.error, /Remark cannot be changed from Order Details/);
  assert.equal(queries('UPDATE die_orders').length, 0);
});

test('an empty save and an over-long reason are refused before anything is read', async () => {
  assert.equal((await save({ fields: {} })).status, 400);
  assert.equal((await save({})).status, 400);
  assert.equal((await save({ fields: { Supplier: 'BETA' }, reason: 'x'.repeat(501) })).status, 400);
  assert.equal(log.length, 0);
});

test('an unknown order is a 404', async () => {
  stored = null;
  const { status } = await save({ fields: { Supplier: 'BETA' }, reason: 'Re-quoted' });
  assert.equal(status, 404);
});

test('moving the ETA still needs a delivery cause, and is logged on the timeline', async () => {
  const refused = await save({ fields: { ETA: '2026-10-15' }, reason: 'Supplier call' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'ETA_CAUSE_REQUIRED');
  assert.equal(queries('UPDATE die_orders').length, 0);
  log = [];
  const ok = await save({
    fields: { ETA: '2026-10-15' }, reason: 'Supplier call',
    etaChange: { cause: 'supplier_delay', note: 'Heat treatment' },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(queries('INSERT INTO die_delivery_events')[0].params,
    ['7', 'eta_revised', '2026-10-01', '2026-10-15', 'supplier_delay', 'Heat treatment', 5, 'planner']);
});

test('filling the ordered date completes pending backup requests for the die', async () => {
  const { status } = await save({ fields: { 'Ordered date': '2026-09-23' } });
  assert.equal(status, 200);
  assert.deepEqual(queries('UPDATE backup_die_requests')[0].params, ['2026-09-23', '30533_201']);
});
