'use strict';
process.env.JWT_SECRET = 'search-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let orderRows = [];
let qdRows = [];
let totals = { orders: 0, qds: 0 };
let failQueries = false;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim().replace(/\s+/g, ' ');
  log.push({ q, params });
  if (failQueries) throw new Error('database unavailable');
  if (q.startsWith('SELECT * FROM die_orders WHERE')) return { rows: orderRows };
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
  totals = { orders: 0, qds: 0 };
  failQueries = false;
});

const find = (q) => request(base, `/api/search?q=${encodeURIComponent(q)}`);

test('a query under two characters is refused without touching the database', async () => {
  for (const q of ['', 'a', '   ', ' b ']) {
    const { status } = await find(q);
    assert.equal(status, 400);
  }
  assert.equal(log.length, 0);
});

test('input reaches SQL only as escaped bound parameters', async () => {
  await find("30533_201' OR 1=1 --");
  const select = log.find(({ q }) => q.startsWith('SELECT * FROM die_orders'));
  assert.ok(!select.q.includes('30533'), 'query text must not contain user input');
  assert.equal(select.params[0], "%30533\\_201' OR 1=1 --%");
  assert.equal(select.params[1], "30533_201' or 1=1 --");
  assert.equal(select.params[2], "30533\\_201' OR 1=1 --%");
});

test('candidates are ordered exact-then-prefix in SQL so an old exact code is not cut off', async () => {
  await find('30');
  const select = log.find(({ q }) => q.startsWith('SELECT * FROM die_orders'));
  assert.match(select.q, /ORDER BY CASE WHEN lower\(die_no\) = \$2 OR lower\(order_no\) = \$2 THEN 0 .* END, created_at DESC LIMIT 200$/);
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
