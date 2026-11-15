'use strict';
// orders.cjs loads auth.cjs for adminMiddleware, and auth.cjs warns when this
// is unset.
process.env.JWT_SECRET = 'orders-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// The stored ETA the next request will find; undefined means no such order.
let storedEta;
let log = [];
// While a create test runs, the follow-on queries of POST / get an empty answer.
let createDefaults = false;
let storedEnhancement = 0;
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT eta FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) {
    return { rows: storedEta === undefined ? [] : [{ eta: storedEta }] };
  }
  if (/^SELECT design_enhancement FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: [{ design_enhancement: storedEnhancement }] };
  if (/^INSERT INTO design_enhancements/.test(q)) return { rows: [{ id: 1 }] };
  if (/^UPDATE die_orders SET/.test(q)) return { rows: [], rowCount: storedEta === undefined ? 0 : 1 };
  if (/^INSERT INTO die_delivery_events/.test(q)) return { rows: [{ id: 1 }] };
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  if (/^UPDATE backup_die_requests/.test(q)) return { rows: [] };
  if (/^SELECT stored_path FROM die_order_files WHERE order_id = \$1/.test(q)) return { rows: [] };
  if (/^DELETE FROM die_orders WHERE id = \$1/.test(q)) return { rows: [], rowCount: storedEta === undefined ? 0 : 1 };
  if (/^INSERT INTO die_orders/.test(q)) return { rows: [{ id: 501 }] };
  if (/^SELECT number, kind FROM toolings/.test(q)) return { rows: [] };
  if (/^(INSERT INTO|DELETE FROM) die_tooling_links/.test(q)) return { rowCount: 1, rows: [] };
  if (createDefaults) return { rows: [], rowCount: 0 };
  throw new Error(`orders test: unexpected query ${q}`);
});

const ordersRouter = require('./orders.cjs');
const app = express();
app.use(express.json());
const EDITOR = { id: 5, username: 'planner', role: 'user', canEditOrderDetails: true };
let currentUser = EDITOR;
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/orders', ordersRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => { storedEnhancement = 0; createDefaults = false; log = []; storedEta = '2026-10-01'; currentUser = EDITOR; });

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

test('PUT is refused for someone without the order details switch', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status, body } = await request(base, '/api/orders/7', { method: 'PUT', body: { ETA: '2026-10-20' } });
  assert.equal(status, 403);
  assert.equal(body.code, 'ORDER_EDIT_FORBIDDEN');
  assert.equal(log.length, 0);
});

test('the generic PATCH stays open to the step-by-step pages', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status } = await request(base, '/api/orders/7', { method: 'PATCH', body: { Remark: 'checked' } });
  assert.equal(status, 200);
});

const ADMIN = { id: 1, username: 'admin', role: 'admin', canEditOrderDetails: true };
const remove = () => request(base, '/api/orders/7', { method: 'DELETE' });

test('DELETE is refused for a non-admin, even one who can edit order details', async () => {
  const { status, body } = await remove();
  assert.equal(status, 403);
  assert.equal(body.error, 'Admin access required');
  assert.equal(log.length, 0, 'no query issued');
});

test('an admin can still delete an order', async () => {
  currentUser = ADMIN;
  const { status } = await remove();
  assert.equal(status, 200);
  assert.deepEqual(log.map(({ q, params }) => [q, params]), [
    ['SELECT stored_path FROM die_order_files WHERE order_id = $1', ['7']],
    ['DELETE FROM die_orders WHERE id = $1', ['7']],
  ]);
});

test('an admin deleting an unknown order gets a 404', async () => {
  currentUser = ADMIN;
  storedEta = undefined;
  const { status } = await remove();
  assert.equal(status, 404);
});

test('an unrecognised insert number still creates the order and records an unknown link', async () => {
  createDefaults = true;
  const res = await request(base, '/api/orders', { body: { Plant: 'GEX 2', 'DIE NO': '30725-201', 'Insert No': 'old', 'Bolster No': 'B-12345', STATUS: 'PENDING FOR ORDERING' } });
  assert.equal(res.status, 201);
  const linkInsert = log.find(({ q }) => /INSERT INTO die_tooling_links/.test(q));
  assert.ok(linkInsert, 'links were written');
  assert.ok(linkInsert.params.includes('BOL-12345'));
  assert.ok(linkInsert.params.includes('old'));
  assert.ok(log.some(({ q, params }) => /^DELETE FROM die_tooling_links WHERE source = 'order-pdf' AND die_no = \$1/.test(q) && params[0] === '30725-201'));
});

const put = (body) => request(base, '/api/orders/7', { method: 'PUT', body });
const create = (body) => request(base, '/api/orders', { method: 'POST', body });
const NO_SIM = 'Simulation is required on a Design enhancement order';

test('PATCH refuses to switch simulation off on a Design enhancement order', async () => {
  storedEnhancement = 1;
  const { status, body } = await patch({ simulationEnabled: false });
  assert.equal(status, 400);
  assert.equal(body.error, NO_SIM);
  assert.ok(!log.some(({ q }) => q.startsWith('UPDATE die_orders')));
  assert.ok(log.some(({ q }) => q === 'ROLLBACK'));
});

test('PATCH switches simulation on, or off for an ordinary order', async () => {
  storedEnhancement = 1;
  assert.equal((await patch({ simulationEnabled: true })).status, 200);
  storedEnhancement = 0;
  assert.equal((await patch({ simulationEnabled: false })).status, 200);
});

test('PUT refuses to switch simulation off on a Design enhancement order', async () => {
  storedEnhancement = 1;
  const { status, body } = await put({ 'DIE NO': 'X1', simulationEnabled: false });
  assert.equal(status, 400);
  assert.equal(body.error, NO_SIM);
});

const ENHANCEMENT = {
  current_issue: 'Early wear', baseline_failure_pct: 10, baseline_productivity_kgh: 800,
  baseline_recovery_pct: 70, target_productivity_kgh: 900, target_recovery_pct: 75,
};

test('creating an order with an enhancement inserts both in one transaction', async () => {
  const { status } = await create({ 'DIE NO': 'X1', STATUS: 'AWAITING FOR DESIGN', enhancement: ENHANCEMENT });
  assert.equal(status, 201);
  const insertOrder = log.find(({ q }) => q.startsWith('INSERT INTO die_orders'));
  assert.match(insertOrder.q, /design_enhancement/);
  const enh = log.find(({ q }) => q.startsWith('INSERT INTO design_enhancements'));
  assert.equal(enh.params[0], 501);
  assert.equal(enh.params[1], 'Early wear');
  const order = kinds();
  assert.equal(order[0], 'BEGIN');
  assert.ok(order.indexOf('COMMIT') > order.indexOf('INSERT INTO design_enhancements'));
  // AWAITING FOR DESIGN: simulation is switched on.
  assert.equal(insertOrder.params[12], 1);
  assert.ok(log.some(({ q }) => q.startsWith('INSERT INTO order_changes')));
});

test('an enhancement on a new order is validated before anything is written', async () => {
  const { status, body } = await create({ 'DIE NO': 'X1', enhancement: { ...ENHANCEMENT, current_issue: '' } });
  assert.equal(status, 400);
  assert.equal(body.error, 'current_issue is required');
  assert.equal(log.length, 0);
});

test('someone without the edit switch cannot create an order as an enhancement', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status } = await create({ 'DIE NO': 'X1', enhancement: ENHANCEMENT });
  assert.equal(status, 403);
  assert.equal(log.length, 0);
});

test('an order created without an enhancement is unchanged', async () => {
  const { status } = await create({ 'DIE NO': 'X1', STATUS: 'AWAITING FOR DESIGN' });
  assert.equal(status, 201);
  assert.ok(!log.some(({ q }) => q.startsWith('INSERT INTO design_enhancements')));
});
