'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('./simulation.cjs');

const TODAY = '2026-10-21';
const user = { id: 2, username: 'eng', role: 'user' };

// A small in-memory stand-in for the four tables the service touches. It
// understands only the statement shapes simulation.cjs and orderRevisions.cjs
// write: SELECT by id/order_id, INSERT ... RETURNING, UPDATE ... SET col = $n
// / NULL ... WHERE id = $n [AND col IS NULL], DELETE by id.
function fakeDb({ order, rounds = [], revisions = [], failOn = null }) {
  const db = { order: { ...order }, rounds: rounds.map(r => ({ ...r })), revisions: revisions.map(r => ({ ...r })), changes: [], log: [] };
  let nextRound = 100; let nextRev = 500;
  const table = (name) => ({ die_orders: [db.order], simulation_rounds: db.rounds, order_revisions: db.revisions }[name]);
  const applySet = (row, setClause, params) => {
    for (const [, col, val] of setClause.matchAll(/(\w+) = (\$\d+|NULL|CURRENT_TIMESTAMP|'[^']*')/g)) {
      if (val === 'CURRENT_TIMESTAMP') continue;
      row[col] = val === 'NULL' ? null : val.startsWith('$') ? params[Number(val.slice(1)) - 1] : val.slice(1, -1);
    }
  };
  db.client = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      db.log.push(s);
      if (failOn && failOn.test(s)) throw new Error('boom');
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rowCount: 0, rows: [] };
      if (/^SELECT .* FROM die_orders WHERE id = \$1/.test(s)) {
        return db.order.id === Number(params[0]) ? { rowCount: 1, rows: [{ ...db.order }] } : { rowCount: 0, rows: [] };
      }
      if (/^SELECT \* FROM simulation_rounds WHERE order_id = \$1/.test(s)) {
        const rows = db.rounds.filter(r => r.order_id === Number(params[0])).sort((a, b) => a.round_no - b.round_no);
        return { rowCount: rows.length, rows: rows.map(r => ({ ...r })) };
      }
      if (/^SELECT .* FROM order_revisions WHERE order_id = \$1/.test(s)) {
        const rows = db.revisions.filter(r => r.order_id === Number(params[0])).sort((a, b) => b.revision_number - a.revision_number);
        // Only the columns the statement names, so a missing column shows up here.
        const cols = s.match(/^SELECT (.+?) FROM/)[1].split(',').map(c => c.trim());
        const pick = (r) => Object.fromEntries(cols.map(c => [c, r[c] ?? null]));
        return { rowCount: rows.length ? 1 : 0, rows: rows.slice(0, 1).map(pick) };
      }
      if (/FROM work_queue_calendars/.test(s)) return { rowCount: 0, rows: [] };
      if (/^INSERT INTO simulation_rounds/.test(s)) {
        const cols = s.match(/\(([^)]+)\) VALUES/)[1].split(',').map(c => c.trim());
        const row = { id: nextRound++, prep_done_date: null, sim_completed_date: null, result: null, fail_reason: null, modification: null,
          supplier_revision_id: null, modification_done_date: null, comments: null, model_date_target: null };
        cols.forEach((c, i) => { row[c] = params[i]; });
        db.rounds.push(row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (/^INSERT INTO order_revisions/.test(s)) {
        const [order_id, revision_number, from_status, to_status, notes, revision_date] = params;
        const row = { id: nextRev++, order_id: Number(order_id), revision_number, from_status, to_status, notes, revision_date, model_received_date: null, design_received_date: null };
        db.revisions.push(row);
        return { rowCount: 1, rows: [{ id: row.id, created_at: new Date() }] };
      }
      if (/^INSERT INTO order_changes/.test(s)) { db.changes.push(params); return { rowCount: 1, rows: [] }; }
      let m = s.match(/^UPDATE (\w+) SET (.+) WHERE id = \$(\d+)( AND (\w+) IS NULL)?/);
      if (m) {
        const [, name, setClause, idx, , nullCol] = m;
        const row = table(name).find(r => r.id === Number(params[Number(idx) - 1]));
        if (!row || (nullCol && row[nullCol] != null)) return { rowCount: 0, rows: [] };
        applySet(row, setClause, params);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      m = s.match(/^DELETE FROM simulation_rounds WHERE id = \$1/);
      if (m) { db.rounds = db.rounds.filter(r => r.id !== Number(params[0])); return { rowCount: 1, rows: [] }; }
      throw new Error(`fake db does not understand: ${s}`);
    },
  };
  return db;
}

const order = (over = {}) => ({ id: 7, die_no: 'D-1', plant: 'P1', status: 'UNDER SIMULATION', design_revision_count: 0,
  design_received_date: '2026-10-10', three_d_model_received_date: null, simulation_completed_date: null, ...over });
const round = (over = {}) => ({ id: 1, order_id: 7, round_no: 1, started_from: 'initial', revision_id: null,
  model_received_date: null, model_date_target: null, prep_done_date: null, sim_completed_date: null, result: null,
  fail_reason: null, modification: null, supplier_revision_id: null, modification_done_date: null, comments: null, ...over });
const committed = (db) => db.log.includes('COMMIT');

test('model received on a first receipt writes the order column', async () => {
  const db = fakeDb({ order: order() });
  const out = await svc.recordStep(db.client, 7, { step: 'model_received', date: '2026-10-20' }, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.order.three_d_model_received_date, '2026-10-20');
  assert.equal(db.rounds.length, 1);
  assert.equal(db.rounds[0].model_received_date, '2026-10-20');
  assert.equal(db.rounds[0].model_date_target, 'order');
  assert.equal(out.die.stage, 'model_received');
  assert.equal(out.order['3D Model Received Date'], '2026-10-20');
  assert.ok(committed(db));
});

test('model received in a supplier round writes the revision row, not the order', async () => {
  const closed = round({ model_received_date: '2026-10-01', prep_done_date: '2026-10-01', sim_completed_date: '2026-10-02',
    result: 'Not OK', fail_reason: 'Other', modification: 'Supplier' });
  const db = fakeDb({ order: order({ three_d_model_received_date: '2026-10-01', design_revision_count: 1 }), rounds: [closed],
    revisions: [{ id: 40, order_id: 7, revision_number: 1, design_received_date: '2026-10-15', model_received_date: null }] });
  await svc.recordStep(db.client, 7, { step: 'model_received', date: '2026-10-20' }, user, TODAY);
  assert.equal(db.order.three_d_model_received_date, '2026-10-01');
  assert.equal(db.revisions[0].model_received_date, '2026-10-20');
  const r2 = db.rounds.find(r => r.round_no === 2);
  assert.equal(r2.started_from, 'supplier');
  assert.equal(r2.revision_id, 40);
  assert.equal(r2.model_date_target, 'revision');
});

test('OK sets simulation_completed_date and moves to Design Approval', async () => {
  const db = fakeDb({ order: order(), rounds: [round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-20' })] });
  const out = await svc.recordStep(db.client, 7, { step: 'sim_completed', date: '2026-10-21', result: 'OK' }, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.order.status, 'PENDING FOR DESIGN APPROVAL');
  assert.equal(db.order.simulation_completed_date, '2026-10-21');
  assert.equal(db.rounds[0].result, 'OK');
  assert.equal(db.changes.length, 1);
  assert.equal(out.order.STATUS, 'PENDING FOR DESIGN APPROVAL');
});

test('Not OK Supplier creates a revision to AWAITING FOR DESIGN in the same transaction', async () => {
  const db = fakeDb({ order: order(), rounds: [round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-20' })] });
  const out = await svc.recordStep(db.client, 7, { step: 'sim_completed', date: '2026-10-21', result: 'Not OK',
    fail_reason: 'Weld seam quality', modification: 'Supplier', revision_notes: 'Weld seam quality: move bridge' }, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.order.status, 'AWAITING FOR DESIGN');
  assert.equal(db.order.design_revision_count, 1);
  assert.equal(db.revisions.length, 1);
  assert.equal(db.revisions[0].notes, 'Weld seam quality: move bridge');
  assert.equal(db.rounds[0].supplier_revision_id, db.revisions[0].id);
  assert.equal(db.log.filter(s => s === 'BEGIN').length, 1);
  assert.ok(committed(db));
});

test('if the revision insert throws, the step rolls back and nothing commits', async () => {
  const db = fakeDb({ order: order(), rounds: [round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-20' })],
    failOn: /^INSERT INTO order_revisions/ });
  await assert.rejects(svc.recordStep(db.client, 7, { step: 'sim_completed', date: '2026-10-21', result: 'Not OK',
    fail_reason: 'Other', modification: 'Supplier', revision_notes: 'x' }, user, TODAY));
  assert.ok(db.log.includes('ROLLBACK'));
  assert.ok(!committed(db));
});

test('modification done opens the next round at 3D model received', async () => {
  const db = fakeDb({ order: order(), rounds: [round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-19',
    sim_completed_date: '2026-10-20', result: 'Not OK', fail_reason: 'Other', modification: 'In-house' })] });
  const out = await svc.recordStep(db.client, 7, { step: 'modification_done', date: '2026-10-21' }, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.rounds[0].modification_done_date, '2026-10-21');
  const r2 = db.rounds.find(r => r.round_no === 2);
  assert.equal(r2.started_from, 'in_house');
  assert.equal(r2.model_received_date, '2026-10-21');
  assert.equal(out.die.stage, 'model_received');
  assert.equal(out.die.round_no, 2);
});

test('a step on an order no longer in Simulation is refused with 409', async () => {
  const db = fakeDb({ order: order({ status: 'PENDING FOR DESIGN APPROVAL' }) });
  const out = await svc.recordStep(db.client, 7, { step: 'model_received', date: '2026-10-20' }, user, TODAY);
  assert.deepEqual([out.ok, out.status], [false, 409]);
  assert.ok(!committed(db));
  assert.equal(db.rounds.length, 0);
});

test('a step that does not match the current stage is refused with 409', async () => {
  const db = fakeDb({ order: order() });
  const out = await svc.recordStep(db.client, 7, { step: 'prep_done', date: '2026-10-20' }, user, TODAY);
  assert.deepEqual([out.ok, out.status], [false, 409]);
});

test('an invalid date is refused with 400', async () => {
  const db = fakeDb({ order: order() });
  const out = await svc.recordStep(db.client, 7, { step: 'model_received', date: '2026-10-30' }, user, TODAY);
  assert.deepEqual([out.ok, out.status], [false, 400]);
});

test('a missing order is 404', async () => {
  const db = fakeDb({ order: order() });
  assert.equal((await svc.recordStep(db.client, 99, { step: 'model_received', date: '2026-10-20' }, user, TODAY)).status, 404);
});

test('undo clears the latest step of the open round', async () => {
  const db = fakeDb({ order: order(), rounds: [round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-20' })] });
  const out = await svc.undoLastStep(db.client, 7, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.rounds[0].prep_done_date, null);
  assert.equal(out.die.stage, 'model_received');
});

test('undoing a first receipt also clears it from the order and removes the empty round', async () => {
  const db = fakeDb({ order: order({ three_d_model_received_date: '2026-10-19' }),
    rounds: [round({ model_received_date: '2026-10-19', model_date_target: 'order' })] });
  const out = await svc.undoLastStep(db.client, 7, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.order.three_d_model_received_date, null);
  assert.equal(db.rounds.length, 0);
  assert.equal(out.die.stage, 'awaiting_model');
});

test('undoing a modification done removes the fresh round and reopens the modification', async () => {
  const db = fakeDb({ order: order(), rounds: [
    round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-19', sim_completed_date: '2026-10-20',
      result: 'Not OK', fail_reason: 'Other', modification: 'In-house', modification_done_date: '2026-10-21' }),
    round({ id: 2, round_no: 2, started_from: 'in_house', model_received_date: '2026-10-21' }),
  ] });
  const out = await svc.undoLastStep(db.client, 7, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.rounds.length, 1);
  assert.equal(db.rounds[0].modification_done_date, null);
  assert.equal(out.die.stage, 'in_house_mod');
});

test('undo is refused for an OK or Supplier result, and when there is nothing to undo', async () => {
  const supplier = round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-19', sim_completed_date: '2026-10-20',
    result: 'Not OK', fail_reason: 'Other', modification: 'Supplier' });
  assert.equal((await svc.undoLastStep(fakeDb({ order: order(), rounds: [supplier] }).client, 7, user, TODAY)).status, 409);
  assert.equal((await svc.undoLastStep(fakeDb({ order: order() }).client, 7, user, TODAY)).status, 409);
});

test('a stale open round from before a newer revision is skipped: the new model opens a fresh round', async () => {
  const stale = round({ model_received_date: '2026-09-01', created_at: '2026-09-01T08:00:00Z' });
  const db = fakeDb({ order: order({ three_d_model_received_date: '2026-09-01', design_revision_count: 1 }), rounds: [stale],
    revisions: [{ id: 41, order_id: 7, revision_number: 1, created_at: '2026-10-05T08:00:00Z', design_received_date: '2026-10-15', model_received_date: null }] });
  const out = await svc.recordStep(db.client, 7, { step: 'model_received', date: '2026-10-20' }, user, TODAY);
  assert.equal(out.ok, true);
  const r2 = db.rounds.find(r => r.round_no === 2);
  assert.equal(r2.started_from, 'reentry');
  assert.equal(r2.revision_id, 41);
  assert.equal(db.revisions[0].model_received_date, '2026-10-20');
  assert.equal(out.die.stage, 'model_received');
  assert.equal(out.die.round_no, 2);
});

test('undo does not touch a stale round left over from before a revision', async () => {
  const stale = round({ model_received_date: '2026-09-01', prep_done_date: '2026-09-02', created_at: '2026-09-01T08:00:00Z' });
  const db = fakeDb({ order: order({ design_revision_count: 1 }), rounds: [stale],
    revisions: [{ id: 41, order_id: 7, revision_number: 1, created_at: '2026-10-05T08:00:00Z' }] });
  const out = await svc.undoLastStep(db.client, 7, user, TODAY);
  assert.equal(out.status, 409);
  assert.equal(db.rounds[0].prep_done_date, '2026-09-02');
});
