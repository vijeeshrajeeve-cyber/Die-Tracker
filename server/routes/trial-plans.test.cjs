'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');
const { todayLocal } = require('../services/dates.cjs');
const { addDays } = require('../services/trialPlans.cjs');

const TODAY = todayLocal();
const TOMORROW = addDays(TODAY, 1);
const YESTERDAY = addDays(TODAY, -1);

let log = [];
let entryRow;
installFakeDb(async (sql, params = []) => {
  const q = sql.trim().replace(/\s+/g, ' ');
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT id, plan_date/.test(q)) return { rows: [{ id: 7, plan_date: params[0], status: 'draft', revision: 0 }] };
  if (/FROM trial_plan_entries WHERE plan_id = \$1 ORDER BY position/.test(q)) {
    return { rows: [{ id: 31, entry_type: 'Trial', die_no: '32140-401', press: 'Press 4', tooling: 'i-15781', corrector: 'erive', urgent: true, outcome: null }] };
  }
  if (/^INSERT INTO trial_plans/.test(q)) return { rows: [{ id: 7 }] };
  if (/^SELECT COALESCE\(MAX\(position\)/.test(q)) return { rows: [{ position: 0 }] };
  if (/^INSERT INTO trial_plan_entries/.test(q)) return { rows: [{ id: 31, die_no: params[6], press: params[8] }] };
  if (/^SELECT e\.id/.test(q)) return { rows: entryRow ? [entryRow] : [] };
  if (/^UPDATE trial_plan_entries/.test(q)) return { rows: [{ id: 31, outcome: params[0] }] };
  if (/^UPDATE trial_plans/.test(q)) return { rows: [{ id: 7, status: 'published', revision: 1 }] };
  throw new Error(`trial plan route test: unexpected query ${q}`);
});

const router = require('./trial-plans.cjs');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 5, username: 'supervisor', role: 'user' }; next(); });
app.use('/api/trial-plans', router);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => { log = []; entryRow = undefined; });

const call = (path, options) => request(base, `/api/trial-plans${path}`, options);
const has = (prefix) => log.some(({ q }) => q.startsWith(prefix));

test('meta opens the page on tomorrow and carries the fixed lists', async () => {
  const { status, body } = await call('/meta');
  assert.equal(status, 200);
  assert.equal(body.today, TODAY);
  assert.equal(body.defaultPlanDate, TOMORROW);
  assert.deepEqual(body.outcomes, ['OK', 'Not OK', 'Not run']);
  assert.equal(body.failReasons.length, 6);
  assert.equal(log.length, 0);
});

test('a day comes back with its entries, summary, checks and lock state', async () => {
  const { status, body } = await call(`/${TOMORROW}`);
  assert.equal(status, 200);
  assert.equal(body.date, TOMORROW);
  assert.equal(body.entries.length, 1);
  assert.equal(body.summary.trials.planned, 1);
  assert.deepEqual(body.checks, []);
  assert.deepEqual(body.state, { planEditable: true, resultsOpen: false, locked: false });
});

test('a past day reads as locked for a user', async () => {
  const { body } = await call(`/${addDays(TODAY, -5)}`);
  assert.deepEqual(body.state, { planEditable: false, resultsOpen: false, locked: true });
});

test('a date that is not a date is a 400 and never reaches the database', async () => {
  assert.equal((await call('/2026-02-31')).status, 400);
  assert.equal((await call('/tomorrow')).status, 400);
  assert.equal((await call('/entries/abc', { method: 'DELETE' })).status, 400);
  assert.equal(log.length, 0);
});

test('adding a die commits and answers 201', async () => {
  const { status, body } = await call(`/${TOMORROW}/entries`, { body: { die_no: '32140-401', press: 'Press 4' } });
  assert.equal(status, 201);
  assert.deepEqual(body.entry, { id: 31, die_no: '32140-401', press: 'Press 4' });
  assert.ok(has('COMMIT'));
});

test('a refused add rolls back the draft plan it may have created', async () => {
  const { status } = await call(`/${TOMORROW}/entries`, { body: { die_no: '' } });
  assert.equal(status, 400);
  assert.ok(has('ROLLBACK'));
  assert.ok(!has('COMMIT'));
});

test('adding to yesterday is a 409', async () => {
  const { status, body } = await call(`/${YESTERDAY}/entries`, { body: { die_no: '32140-401' } });
  assert.equal(status, 409);
  assert.match(body.error, /past plan/i);
  assert.ok(!has('INSERT'));
});

test('publishing answers with the plan at its new revision', async () => {
  const { status, body } = await call(`/${TOMORROW}/publish`, { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.plan.status, 'published');
  assert.equal(body.plan.revision, 1);
});

test('a result on an unlinked die is recorded in one transaction', async () => {
  entryRow = { id: 31, entry_type: 'Trial', die_no: '00001-201', die_order_id: null, sample_followup_id: null, sample_trial_id: null, plan_date: TODAY, plan_status: 'published' };
  const { status, body } = await call('/entries/31/outcome', { method: 'PUT', body: { outcome: 'Not OK', fail_reason: 'Shape' } });
  assert.equal(status, 200);
  assert.equal(body.entry.outcome, 'Not OK');
  assert.deepEqual(log.map(({ q }) => q.split(' ')[0]), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
});

test('a result without a reason is a 400 and nothing is written', async () => {
  entryRow = { id: 31, entry_type: 'Trial', die_no: '00001-201', plan_date: TODAY, plan_status: 'published' };
  const { status } = await call('/entries/31/outcome', { method: 'PUT', body: { outcome: 'Not OK' } });
  assert.equal(status, 400);
  assert.ok(!has('UPDATE'));
});

test('an entry that does not exist is a 404', async () => {
  assert.equal((await call('/entries/999/outcome', { method: 'PUT', body: { outcome: 'OK' } })).status, 404);
  assert.equal((await call('/entries/999', { method: 'DELETE' })).status, 404);
});

test('a summary needs a real range', async () => {
  assert.equal((await call('/summary?from=x&to=y')).status, 400);
});
