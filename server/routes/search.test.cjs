'use strict';
process.env.JWT_SECRET = 'search-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let orderRows = [];
let qdRows = [];
let qdById = null;
let totals = { orders: 0, qds: 0 };
let failQueries = false;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim().replace(/\s+/g, ' ');
  log.push({ q, params });
  if (failQueries) throw new Error('database unavailable');
  if (/^SELECT \* FROM quality_discrepancies WHERE \(\$1::integer IS NULL OR id=\$1\)/.test(q)) return { rows: qdById ? [qdById] : [] };
  if (q.startsWith('SELECT * FROM qd_settings')) return { rows: [{ approver_user_ids: JSON.stringify([1]) }] };
  if (q.startsWith('SELECT username FROM users WHERE id=$1')) return { rows: [{ username: 'approver' }] };
  // listQDs' child tables (files, activity, billets, FOC rounds): none here.
  if (/FROM (quality_discrepancy_files|quality_discrepancy_activity|qd_billet_parameters|qd_foc_rounds)/.test(q)) return { rows: [] };
  if (q.startsWith("SELECT o.*, (SELECT COUNT(*) FROM order_changes c WHERE c.order_id = o.id)::int AS change_count, (SELECT f.id FROM die_order_files f WHERE f.order_id = o.id AND f.slot = 'profile_image' AND f.replaced_at IS NULL) AS profile_image_id FROM die_orders o WHERE")) return { rows: orderRows };
  if (q.startsWith('SELECT COUNT(*)::int AS total FROM die_orders')) return { rows: [{ total: totals.orders }] };
  if (q.startsWith('SELECT * FROM quality_discrepancies WHERE (')) return { rows: qdRows };
  if (q.startsWith('SELECT COUNT(*)::int AS total FROM quality_discrepancies')) return { rows: [{ total: totals.qds }] };
  throw new Error(`search test: unexpected query ${q}`);
});

const searchRouter = require('./search.cjs');

const ADMIN = { id: 1, username: 'admin', role: 'admin' };
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/search', searchRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  log = [];
  currentUser = ADMIN;
  orderRows = [];
  qdRows = [];
  qdById = null;
  totals = { orders: 0, qds: 0 };
  failQueries = false;
});

const find = (q) => request(base, `/api/search?q=${encodeURIComponent(q)}`);

test('a query over the length cap is refused without touching the database', async () => {
  const { status, body } = await find('x'.repeat(101));
  assert.equal(status, 400);
  assert.equal(body.error, 'Type between 2 and 100 characters');
  assert.equal(log.length, 0);
});

test('a query under two characters is refused without touching the database', async () => {
  for (const q of ['', 'a', '   ', ' b ']) {
    const { status } = await find(q);
    assert.equal(status, 400);
  }
  assert.equal(log.length, 0);
});

test('input reaches SQL only as escaped bound parameters', async () => {
  await find("30533_201' OR 1=1 --");
  const select = log.find(({ q }) => q.startsWith('SELECT o.*'));
  assert.ok(!select.q.includes('30533'), 'query text must not contain user input');
  assert.equal(select.params[0], "%30533\\_201' OR 1=1 --%");
  assert.equal(select.params[1], "30533_201' or 1=1 --");
  assert.equal(select.params[2], "30533\\_201' OR 1=1 --%");
});

test('candidates are ordered exact-then-prefix in SQL so an old exact code is not cut off', async () => {
  await find('30');
  const select = log.find(({ q }) => q.startsWith('SELECT o.*'));
  assert.match(select.q, /ORDER BY CASE WHEN lower\(die_no\) = \$2 OR lower\(order_no\) = \$2 THEN 0 .* END, o.created_at DESC LIMIT 200$/);
});

test('orders come back presented, ranked, capped, with the true total', async () => {
  orderRows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, die_no: `D-${i}`, order_no: `O-${i}`, supplier: 'ALPHA', created_at: `2026-01-${String(i + 1).padStart(2, '0')}` }));
  totals.orders = 37;
  const { status, body } = await find('D-');
  assert.equal(status, 200);
  assert.equal(body.orders.total, 37);
  assert.equal(body.orders.items.length, 8);
  assert.equal(body.orders.items[0]['DIE NO'], 'D-9');
  assert.equal(body.orders.items[0].matchedField, 'die_no');
});

test("an order's change-log count survives into the presented row", async () => {
  orderRows = [{ id: 1, die_no: 'D-1', order_no: 'O-1', supplier: 'ALPHA', created_at: '2026-01-01', change_count: 3 }];
  const { body } = await find('D-1');
  assert.equal(body.orders.items[0].changeCount, 3);
});

test("an order's profile image id rides along for the palette thumbnail, null when it has none", async () => {
  orderRows = [
    { id: 1, die_no: 'D-1', order_no: 'O-1', supplier: 'ALPHA', created_at: '2026-01-02', profile_image_id: 31 },
    { id: 2, die_no: 'D-12', order_no: 'O-2', supplier: 'ALPHA', created_at: '2026-01-01', profile_image_id: null },
  ];
  const { body } = await find('D-1');
  assert.deepEqual(body.orders.items.map((o) => o.profileImageId), [31, null]);
});

test('QD rows are trimmed to the list shape and drafts are scoped to the creator in SQL', async () => {
  currentUser = { id: 42, username: 'raiser', role: 'user', pageAccess: ['qd-tracker'] };
  qdRows = [{ id: 5, qd_no: 'QD-25-031', die_no: 'D-1', supplier: 'ALPHA', plant: 'GEX 1', status: 'Open', approval_state: 'Approved', raised_date: '2025-03-01', issue_detail: 'long text', created_by: 7 }];
  totals.qds = 1;
  const { body } = await find('QD-25');
  assert.deepEqual(body.qds.items[0], {
    id: 5, qd_no: 'QD-25-031', die_no: 'D-1', supplier: 'ALPHA', plant: 'GEX 1',
    status: 'Open', approval_state: 'Approved', raised_date: '2025-03-01', matchedField: 'qd_no',
  });
  const select = log.find(({ q }) => q.startsWith('SELECT * FROM quality_discrepancies'));
  assert.match(select.q, /AND \(approval_state <> 'Draft' OR created_by = \$4\)/);
  assert.equal(select.params[3], 42);
  const count = log.find(({ q }) => q.startsWith('SELECT COUNT(*)::int AS total FROM quality_discrepancies'));
  assert.match(count.q, /created_by = \$2/);
  assert.equal(count.params[1], 42);
});

test('a group the user cannot open is omitted, not returned empty', async () => {
  currentUser = { id: 3, username: 'qd-only', role: 'user', pageAccess: ['qd-tracker'] };
  const qdOnly = await find('D-1');
  assert.equal('orders' in qdOnly.body, false);
  assert.ok(qdOnly.body.qds);
  assert.ok(!log.some(({ q }) => q.includes('FROM die_orders')));

  log = [];
  currentUser = { id: 4, username: 'orders-only', role: 'user', pageAccess: ['orders'] };
  const ordersOnly = await find('D-1');
  assert.equal('qds' in ordersOnly.body, false);
  assert.ok(ordersOnly.body.orders);
  assert.ok(!log.some(({ q }) => q.includes('FROM quality_discrepancies')));
});

test('process-flow access alone still unlocks the orders group', async () => {
  currentUser = { id: 6, username: 'flow', role: 'user', pageAccess: ['process-flow'] };
  const { body } = await find('D-1');
  assert.ok(body.orders);
  assert.equal('qds' in body, false);
});

test('a database failure is a 500, not a crash', async () => {
  failQueries = true;
  const { status, body } = await find('D-1');
  assert.equal(status, 500);
  assert.equal(body.error, 'Internal server error');
});

const openQd = (id) => request(base, `/api/search/qd/${id}`);

test('the QD record endpoint returns the decorated record', async () => {
  qdById = { id: 5, qd_no: 'QD-25-031', approval_state: 'Approved', created_by: 7, assigned_approver: 1, raised_date: '2025-03-01' };
  const { status, body } = await openQd(5);
  assert.equal(status, 200);
  assert.equal(body.id, 5);
  assert.equal(body.assigned_approver_name, 'approver');
  assert.equal(typeof body.can_approve, 'boolean');
});

test("someone else's draft is a 404; your own draft opens", async () => {
  qdById = { id: 9, qd_no: null, approval_state: 'Draft', created_by: 7, assigned_approver: null };
  currentUser = { id: 42, username: 'other', role: 'user', pageAccess: ['qd-tracker'] };
  assert.equal((await openQd(9)).status, 404);
  currentUser = { id: 7, username: 'raiser', role: 'user', pageAccess: ['qd-tracker'] };
  const mine = await openQd(9);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.assigned_approver_name, null);
});

test('the QD record endpoint refuses users without QD access and bad ids', async () => {
  currentUser = { id: 4, username: 'orders-only', role: 'user', pageAccess: ['orders'] };
  assert.equal((await openQd(5)).status, 403);
  currentUser = ADMIN;
  assert.equal((await openQd('abc')).status, 400);
  assert.equal((await openQd(0)).status, 400);
  assert.equal((await openQd(123)).status, 404);
});

test('a multi-word query binds each word after the fixed parameters', async () => {
  currentUser = { id: 42, username: 'raiser', role: 'user', pageAccess: ['orders', 'qd-tracker'] };
  await find('hydro 30533');
  const orders = log.find(({ q }) => q.startsWith('SELECT o.*'));
  assert.deepEqual(orders.params.slice(3), ['%hydro%', '%30533%']);
  assert.match(orders.q, /supplier ILIKE \$4 .* AND .*supplier ILIKE \$5/);
  const qds = log.find(({ q }) => q.startsWith('SELECT * FROM quality_discrepancies'));
  assert.equal(qds.params[3], 42, 'the user id keeps $4');
  assert.deepEqual(qds.params.slice(4), ['%hydro%', '%30533%']);
  const count = log.find(({ q }) => q.startsWith('SELECT COUNT(*)::int AS total FROM quality_discrepancies'));
  assert.deepEqual(count.params, ['%hydro 30533%', 42, '%hydro%', '%30533%']);
  assert.match(count.q, /ILIKE \$3 .* AND .*ILIKE \$4/);
});

test('a one-word query sends no token parameters', async () => {
  await find('D-1');
  const orders = log.find(({ q }) => q.startsWith('SELECT o.*'));
  assert.equal(orders.params.length, 3);
});

const openOrder = (id) => request(base, `/api/search/order/${id}`);

test('the order record endpoint returns a presented order with its thumbnail id', async () => {
  orderRows = [{ id: 7, die_no: 'D-7', order_no: 'O-7', supplier: 'ALPHA', created_at: '2026-01-01', profile_image_id: 12 }];
  const { status, body } = await openOrder(7);
  assert.equal(status, 200);
  assert.equal(body['DIE NO'], 'D-7');
  assert.equal(body.profileImageId, 12);
  const select = log.find(({ q }) => q.startsWith('SELECT o.*'));
  assert.match(select.q, /WHERE o\.id = \$1$/);
  assert.deepEqual(select.params, [7]);
});

test('the order record endpoint refuses users without order access, bad ids, and missing orders', async () => {
  currentUser = { id: 3, username: 'qd-only', role: 'user', pageAccess: ['qd-tracker'] };
  assert.equal((await openOrder(7)).status, 403);
  currentUser = ADMIN;
  assert.equal((await openOrder('abc')).status, 400);
  assert.equal((await openOrder(0)).status, 400);
  assert.equal((await openOrder(123)).status, 404);
});
