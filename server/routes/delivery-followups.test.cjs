'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let storedEta;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT eta FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) {
    return { rows: storedEta === undefined ? [] : [{ eta: storedEta }] };
  }
  if (/^UPDATE die_orders SET eta/.test(q)) return { rows: [], rowCount: 1 };
  if (/^INSERT INTO die_delivery_events/.test(q)) return { rows: [{ id: log.length, kind: /'contact'/.test(q) ? 'contact' : params[1] }] };
  if (/^SELECT o\.id, o\.eta/.test(q)) {
    return { rows: [{ id: 3, eta: '2026-10-15', first_revised_from: '2026-10-01', slips: 1, last_contact_date: null, last_contact_channel: null, last_chased_at: null }] };
  }
  if (/FROM die_delivery_events\s+WHERE order_id = \$1/.test(q)) return { rows: [{ id: 1, kind: 'contact' }] };
  throw new Error(`delivery test: unexpected query ${q}`);
});

const router = require('./delivery-followups.cjs');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 5, username: 'planner' }; next(); });
app.use('/api/delivery-followups', router);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => { log = []; storedEta = '2026-10-01'; });

const today = require('../services/dates.cjs').todayLocal();
const post = (body) => request(base, '/api/delivery-followups/3', { body });
const has = (prefix) => log.some(({ q }) => q.startsWith(prefix));

test('a reply alone logs one contact and leaves the ETA', async () => {
  const { status, body } = await post({ contactDate: today, channel: 'phone', note: 'Dispatch Friday' });
  assert.equal(status, 201);
  assert.equal(body.eta, '2026-10-01');
  assert.ok(!has('UPDATE die_orders'));
  assert.equal(log.filter(({ q }) => q.startsWith('INSERT INTO die_delivery_events')).length, 1);
  assert.ok(has('COMMIT'));
});

test('a new ETA without a cause is refused before anything is written', async () => {
  const { status, body } = await post({ contactDate: today, channel: 'email', newEta: '2026-10-20' });
  assert.equal(status, 400);
  assert.equal(body.code, 'ETA_CAUSE_REQUIRED');
  assert.ok(!has('INSERT'));
  assert.ok(has('ROLLBACK'));
});

test('a new ETA with a cause moves the ETA and logs the revision and the contact', async () => {
  const { status, body } = await post({ contactDate: today, channel: 'email', note: 'Mill delay', newEta: '2026-10-20', cause: 'supplier_delay' });
  assert.equal(status, 201);
  assert.equal(body.eta, '2026-10-20');
  assert.deepEqual(log.find(({ q }) => q.startsWith('UPDATE die_orders')).params, ['2026-10-20', 3]);
  assert.equal(body.events.length, 2);
});

test('bad input is a 400 with the reason', async () => {
  assert.equal((await post({ contactDate: '2999-01-01', channel: 'email', note: 'x' })).status, 400);
  assert.equal((await post({ contactDate: today, channel: 'fax', note: 'x' })).status, 400);
  assert.equal((await post({ contactDate: today, channel: 'email' })).status, 400);
  assert.equal((await request(base, '/api/delivery-followups/abc', { body: {} })).status, 400);
});

test('an unknown order is a 404', async () => {
  storedEta = undefined;
  assert.equal((await post({ contactDate: today, channel: 'email', note: 'x' })).status, 404);
});

test('summaries are keyed by order id', async () => {
  const { status, body } = await request(base, '/api/delivery-followups');
  assert.equal(status, 200);
  assert.deepEqual(body.summaries['3'], { originalEta: '2026-10-01', slips: 1, daysSlipped: 14, lastContact: null, lastChasedAt: null });
});

test('events come back for one order', async () => {
  const { status, body } = await request(base, '/api/delivery-followups/3/events');
  assert.equal(status, 200);
  assert.equal(body.events.length, 1);
});
