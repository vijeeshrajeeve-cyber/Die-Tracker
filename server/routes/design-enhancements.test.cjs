'use strict';
process.env.JWT_SECRET = 'enhancement-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let order;        // the die_orders row the next request finds; null = none
let enhancement;  // the design_enhancements row; null = none
let hasTrial;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim().replace(/\s+/g, ' ');
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT id, status, design_enhancement, simulation_enabled FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) {
    return { rows: order ? [order] : [] };
  }
  if (/^SELECT \* FROM design_enhancements WHERE die_order_id/.test(q)) return { rows: enhancement ? [enhancement] : [] };
  if (/^SELECT \* FROM design_enhancements ORDER BY/.test(q)) return { rows: enhancement ? [enhancement] : [] };
  if (/^SELECT 1 FROM sample_trials/.test(q)) return { rows: hasTrial ? [{ '?column?': 1 }] : [] };
  if (/^INSERT INTO design_enhancements/.test(q)) return { rows: [{ id: 1, die_order_id: params[0], current_issue: params[1] }] };
  if (/^UPDATE design_enhancements/.test(q)) return { rows: [{ id: 1, die_order_id: params[params.length - 1] }] };
  if (/^DELETE FROM design_enhancements/.test(q)) return { rows: [] };
  if (/^UPDATE die_orders SET/.test(q)) return { rows: [], rowCount: 1 };
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  throw new Error(`enhancement test: unexpected query ${q}`);
});

const router = require('./design-enhancements.cjs');
const { createRevision } = require('../services/orderRevisions.cjs');

const EDITOR = { id: 5, username: 'planner', role: 'user', canEditOrderDetails: true };
const ADMIN = { id: 1, username: 'boss', role: 'admin' };
const VIEWER = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/design-enhancements', router);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  log = [];
  currentUser = EDITOR;
  hasTrial = false;
  enhancement = null;
  order = { id: 7, status: 'AWAITING FOR DESIGN', design_enhancement: 0, simulation_enabled: 0 };
});

const BASELINE = {
  current_issue: 'Die breaks early at the bearing', reference_dies: '30533_101',
  baseline_failure_pct: 12, baseline_productivity_kgh: 800, baseline_recovery_pct: 70,
  target_productivity_kgh: 900, target_recovery_pct: 75,
};
const put = (body) => request(base, '/api/design-enhancements/order/7', { method: 'PUT', body });
const del = (body) => request(base, '/api/design-enhancements/order/7', { method: 'DELETE', body: body || {} });
const queries = (prefix) => log.filter(({ q }) => q.startsWith(prefix));
const orderUpdate = () => queries('UPDATE die_orders')[0];
const changes = () => queries('INSERT INTO order_changes').map(({ params }) => ({
  field: params[4], old: params[5], new: params[6], reason: params[7], stage: params[8], by: params[2],
}));

test('an editor marks an AWAITING FOR DESIGN order: both flags set, change logged', async () => {
  const { status, body } = await put(BASELINE);
  assert.equal(status, 200);
  assert.equal(body.enhancement.die_order_id, 7);
  assert.match(orderUpdate().q, /design_enhancement = 1, simulation_enabled = 1/);
  assert.equal(queries('INSERT INTO design_enhancements')[0].params.at(-1), 'planner');
  assert.deepEqual(changes()[0], { field: 'Design enhancement', old: 'No', new: 'Yes', reason: null, stage: 'AWAITING FOR DESIGN', by: 'planner' });
  assert.ok(log.some(({ q }) => q === 'COMMIT'));
});

test('marking a PENDING FOR PR order leaves simulation_enabled and the status alone', async () => {
  order.status = 'PENDING FOR PR';
  const { status } = await put(BASELINE);
  assert.equal(status, 200);
  assert.match(orderUpdate().q, /design_enhancement = 1/);
  assert.doesNotMatch(orderUpdate().q, /simulation_enabled|status/);
});

test('marking an UNDER SIMULATION or PENDING FOR ORDERING order switches simulation on', async () => {
  for (const s of ['UNDER SIMULATION', 'PENDING FOR ORDERING']) {
    log = [];
    order.status = s;
    assert.equal((await put(BASELINE)).status, 200);
    assert.match(orderUpdate().q, /simulation_enabled = 1/);
  }
});

test('someone without the edit switch gets 403 and nothing is written', async () => {
  currentUser = VIEWER;
  const { status } = await put(BASELINE);
  assert.equal(status, 403);
  assert.equal(orderUpdate(), undefined);
  assert.equal(queries('INSERT').length, 0);
});

test('an editor marking a DIE RECEIVED order gets 403; an admin with a reason succeeds', async () => {
  order.status = 'DIE RECEIVED';
  assert.equal((await put(BASELINE)).status, 403);
  currentUser = ADMIN;
  assert.equal((await put({ ...BASELINE, reason: 'Found at first trial' })).status, 200);
  assert.deepEqual(changes()[0].reason, 'Found at first trial');
  assert.doesNotMatch(orderUpdate().q, /simulation_enabled/);
});

test('an admin marking after receipt without a reason gets 400', async () => {
  order.status = 'DIE RECEIVED';
  currentUser = ADMIN;
  const { status } = await put(BASELINE);
  assert.equal(status, 400);
  assert.equal(queries('INSERT INTO design_enhancements').length, 0);
  assert.ok(log.some(({ q }) => q === 'ROLLBACK'));
});

test('a cancelled order cannot be marked, even by an admin', async () => {
  order.status = 'CANCELLED';
  currentUser = ADMIN;
  assert.equal((await put({ ...BASELINE, reason: 'x' })).status, 400);
});

test('an invalid baseline is 400 with the rule message', async () => {
  const { status, body } = await put({ ...BASELINE, baseline_recovery_pct: 120 });
  assert.equal(status, 400);
  assert.equal(body.error, 'baseline_recovery_pct cannot be more than 100');
  const none = await put({ ...BASELINE, current_issue: ' ' });
  assert.equal(none.body.error, 'current_issue is required');
  assert.equal(log.length, 0, 'nothing touched the database');
});

test('an unknown order is 404', async () => {
  order = null;
  assert.equal((await put(BASELINE)).status, 404);
});

test('an editor edits the baseline before receipt; only the changed values are logged', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE, failure_assessment_required: false, target_failure_pct: null };
  const { status } = await put({ ...BASELINE, baseline_productivity_kgh: 850 });
  assert.equal(status, 200);
  assert.equal(queries('INSERT INTO design_enhancements').length, 0);
  assert.equal(orderUpdate(), undefined, 'the order row is not touched by a baseline edit');
  assert.deepEqual(changes().map((c) => [c.field, c.old, c.new]),
    [['Design enhancement: baseline_productivity_kgh', '800', '850']]);
});

test('an admin baseline edit after receipt without a reason is 400, with one it is logged', async () => {
  order.status = 'DIE RECEIVED';
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  currentUser = ADMIN;
  assert.equal((await put({ ...BASELINE, target_recovery_pct: 80 })).status, 400);
  assert.equal(queries('UPDATE design_enhancements').length, 0);
  assert.equal((await put({ ...BASELINE, target_recovery_pct: 80, reason: 'Customer changed the target' })).status, 200);
  assert.equal(changes()[0].reason, 'Customer changed the target');
});

test('an editor removes the flag while no trial exists; the order row and a log row follow', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  const { status } = await del({ reason: 'Marked the wrong die' });
  assert.equal(status, 200);
  assert.equal(queries('DELETE FROM design_enhancements').length, 1);
  assert.equal(changes()[0].reason, 'Marked the wrong die');
  assert.match(orderUpdate().q, /design_enhancement = 0/);
  assert.doesNotMatch(orderUpdate().q, /simulation_enabled/);
  assert.equal(changes()[0].new, 'No');
});

test('removing the flag without a reason is 400 for an editor, and nothing is deleted', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  for (const body of [{}, { reason: '   ' }]) {
    const { status } = await del(body);
    assert.equal(status, 400);
  }
  assert.equal(queries('DELETE FROM design_enhancements').length, 0);
  assert.ok(log.some(({ q }) => q === 'ROLLBACK'));
});

test('removing with an existing trial is 403 for an editor and needs a reason from an admin', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  hasTrial = true;
  assert.equal((await del()).status, 403);
  assert.equal(queries('DELETE FROM design_enhancements').length, 0);
  currentUser = ADMIN;
  assert.equal((await del()).status, 400);
  assert.equal((await del({ reason: 'Marked by mistake' })).status, 200);
  assert.equal(changes()[0].reason, 'Marked by mistake');
});

test('removing from an order that is not an enhancement is 404', async () => {
  assert.equal((await del()).status, 404);
});

test('GET lists every enhancement row', async () => {
  enhancement = { die_order_id: 7, ...BASELINE };
  const { status, body } = await request(base, '/api/design-enhancements');
  assert.equal(status, 200);
  assert.equal(body.enhancements[0].die_order_id, 7);
});

test('a design revision leaves design_enhancement and the enhancement row untouched', async () => {
  const seen = [];
  const client = {
    query: async (sql) => {
      seen.push(sql);
      if (/FROM die_orders WHERE id/.test(sql)) return { rowCount: 1, rows: [{ status: 'PENDING FOR PR', design_revision_count: 0 }] };
      if (/INSERT INTO order_revisions/.test(sql)) return { rows: [{ id: 1, created_at: new Date() }] };
      return { rows: [] };
    },
  };
  await createRevision(client, { orderId: 7, targetStatus: 'AWAITING FOR DESIGN', notes: 'rework', user: EDITOR });
  assert.ok(seen.length > 0);
  assert.ok(!seen.some((sql) => /design_enhancement/i.test(sql)));
});
