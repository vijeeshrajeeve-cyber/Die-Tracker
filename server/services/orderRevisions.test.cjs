'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRevision } = require('./orderRevisions.cjs');

// Records every query; answers the order lookup and the revision insert.
function fakeClient(order) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM die_orders WHERE id = \$1 FOR UPDATE/.test(sql)) return { rowCount: order ? 1 : 0, rows: order ? [order] : [] };
      if (/INSERT INTO order_revisions/.test(sql)) return { rowCount: 1, rows: [{ id: 55, created_at: new Date() }] };
      return { rowCount: 1, rows: [] };
    },
  };
}
const user = { id: 2, username: 'eng' };

test('a revision to Awaiting Design increments the counter, logs it, and clears the simulation pass', async () => {
  const client = fakeClient({ status: 'UNDER SIMULATION', design_revision_count: 1 });
  const out = await createRevision(client, { orderId: 7, targetStatus: 'AWAITING FOR DESIGN', notes: 'Weld seam quality', revisionDate: '2026-10-20', user });
  assert.deepEqual(out, { id: 55, revisionNumber: 2, status: 'AWAITING FOR DESIGN', lastRevisionDate: '2026-10-20', fromStatus: 'UNDER SIMULATION' });
  const insert = client.calls.find(c => /INSERT INTO order_revisions/.test(c.sql));
  assert.deepEqual(insert.params.slice(0, 6), [7, 2, 'UNDER SIMULATION', 'AWAITING FOR DESIGN', 'Weld seam quality', '2026-10-20']);
  const update = client.calls.find(c => /UPDATE die_orders/.test(c.sql));
  assert.match(update.sql, /simulation_completed_date = NULL/);
  assert.ok(client.calls.some(c => /INSERT INTO order_changes/.test(c.sql)));
  assert.ok(!client.calls.some(c => /BEGIN|COMMIT|ROLLBACK/.test(c.sql)), 'runs inside the caller transaction');
});

test('a revision to Simulation also clears the simulation pass', async () => {
  const client = fakeClient({ status: 'PENDING FOR DESIGN APPROVAL', design_revision_count: 0 });
  await createRevision(client, { orderId: 7, targetStatus: 'UNDER SIMULATION', notes: 'x', revisionDate: '2026-10-20', user });
  assert.match(client.calls.find(c => /UPDATE die_orders/.test(c.sql)).sql, /simulation_completed_date = NULL/);
});

test('a revision to Pending PR leaves the simulation pass alone', async () => {
  const client = fakeClient({ status: 'PENDING FOR ORACLE ENTRY', design_revision_count: 0 });
  await createRevision(client, { orderId: 7, targetStatus: 'PENDING FOR PR', notes: 'x', revisionDate: '2026-10-20', user });
  assert.doesNotMatch(client.calls.find(c => /UPDATE die_orders/.test(c.sql)).sql, /simulation_completed_date/);
});

test('a missing order returns null and writes nothing', async () => {
  const client = fakeClient(null);
  assert.equal(await createRevision(client, { orderId: 9, targetStatus: 'PENDING FOR PR', notes: 'x', user }), null);
  assert.equal(client.calls.length, 1);
});
