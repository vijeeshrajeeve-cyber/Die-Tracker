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

const putEta = (body, id = 3) => request(base, `/api/delivery-followups/${id}/eta`, { body, method: 'PUT' });
const inserts = () => log.filter(({ q }) => q.startsWith('INSERT INTO die_delivery_events'));

test('setting a first ETA needs no cause and logs no contact', async () => {
  storedEta = 'TBC';
  const { status, body } = await putEta({ eta: '2026-11-05' });
  assert.equal(status, 200);
  assert.equal(body.eta, '2026-11-05');
  assert.deepEqual(log.find(({ q }) => q.startsWith('UPDATE die_orders')).params, ['2026-11-05', 3]);
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].params[1], 'eta_set');
  assert.ok(!inserts().some(({ q }) => /'contact'/.test(q)));
});

test('moving a set ETA without a cause is refused before anything is written', async () => {
  const { status, body } = await putEta({ eta: '2026-10-20' });
  assert.equal(status, 400);
  assert.equal(body.code, 'ETA_CAUSE_REQUIRED');
  assert.ok(!has('UPDATE') && !has('INSERT'));
  assert.ok(has('ROLLBACK'));
});

test('moving a set ETA with a cause logs one revision', async () => {
  const { status, body } = await putEta({ eta: '2026-10-20', cause: 'logistics', causeNote: 'Port strike' });
  assert.equal(status, 200);
  assert.equal(body.eta, '2026-10-20');
  assert.equal(inserts().length, 1);
  assert.deepEqual(inserts()[0].params.slice(1, 6), ['eta_revised', '2026-10-01', '2026-10-20', 'logistics', 'Port strike']);
});

test('the same ETA again writes nothing', async () => {
  const { status, body } = await putEta({ eta: '01/10/2026' });
  assert.equal(status, 200);
  assert.equal(body.eta, '2026-10-01');
  assert.ok(!has('UPDATE') && !has('INSERT'));
});

test('a missing or invalid ETA is a 400, an unknown order a 404', async () => {
  assert.equal((await putEta({})).status, 400);
  assert.equal((await putEta({ eta: 'TBC' })).status, 400);
  assert.equal((await putEta({ eta: '2026-11-05' }, 'abc')).status, 400);
  assert.ok(!has('BEGIN'));
  storedEta = undefined;
  assert.equal((await putEta({ eta: '2026-11-05' })).status, 404);
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
