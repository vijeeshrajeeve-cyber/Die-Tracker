'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { initializeWorkQueue } = require('./workQueueSchema.cjs');
const { syncSource, projectSource, reconcileAll } = require('./workQueueSync.cjs');
const { STAGES } = require('./workQueueStages.cjs');
const { initializeWorkQueueExtraSchema } = require('./workQueueExtraSchema.cjs');

test('work queue stable stage vocabulary includes all configured adapters', () => {
  assert.equal(STAGES.length, 14);
  assert.equal(new Set(STAGES.map(s => s.key)).size, 14);
  assert.deepEqual(STAGES.filter(s => s.days === null).map(s => s.key), ['manufacturing', 'foc_receipt']);
});

test('source helper rejects invalid identity before querying', async () => {
  const db = { query: () => { throw new Error('Must not query'); } };
  await assert.rejects(syncSource(db, 'other', 1), TypeError);
  await assert.rejects(projectSource(db, 'order', -1), TypeError);
});

test('PostgreSQL queue synchronization and deadline invariants', {
  skip: !process.env.WORK_QUEUE_TEST_DATABASE_URL,
}, async t => {
  const db = new Client({ connectionString: process.env.WORK_QUEUE_TEST_DATABASE_URL });
  await db.connect();
  const plant = `QUEUE-TEST-${randomUUID()}`;
  const ids = { order: [], sample: [], qd: [], users: [] };
  let sequence = 0;
  const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
  async function order(fields = {}) {
    const data = { plant, die_no: `QUEUE-${++sequence}`, status: 'PENDING FOR ORDERING', die_requested_date: '2026-09-18', ...fields };
    const columns = Object.keys(data);
    const row = await one(`INSERT INTO die_orders(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(data));
    ids.order.push(row.id);
    return row.id;
  }
  async function sample(fields = {}) {
    const data = { plant, profile: `QUEUE-${++sequence}`, status: 'Pending', die_received_date: '2026-09-18', ...fields };
    const columns = Object.keys(data);
    const row = await one(`INSERT INTO sample_followups(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(data));
    ids.sample.push(row.id);
    return row.id;
  }
  async function qd(fields = {}) {
    const data = { plant, qd_no: `${plant}-${++sequence}`, die_no: `QUEUE-${sequence}`, supplier: 'QUEUE', raised_date: '2026-09-18',
      issue_summary: 'Queue test', approval_state: 'Approved', status: 'Open', ...fields };
    const columns = Object.keys(data);
    const row = await one(`INSERT INTO quality_discrepancies(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(data));
    ids.qd.push(row.id);
    return row.id;
  }
  const current = (kind, id) => one("SELECT * FROM work_queue_items WHERE source_kind=$1 AND source_id=$2 AND state IN ('active','paused')", [kind, id]);
  try {
    await t.test('initialization is repeatable and does not backfill', async () => {
      const first = await initializeWorkQueue(db);
      assert.equal(first.backfilled, false);
      await initializeWorkQueue(db);
      await initializeWorkQueueExtraSchema(db);
      await initializeWorkQueueExtraSchema(db);
      assert.equal(Number((await one('SELECT count(*) FROM work_queue_rules WHERE plant IS NULL')).count), STAGES.length);
    });
    await t.test('strict dates, working days, holidays, calendar days and DST cutoffs', async () => {
      const row = await one(`SELECT work_queue_strict_date('2026-02-30') AS bad,
        work_queue_strict_date('18/09/2026')::text AS good,
        work_queue_strict_date('unknown') AS unknown,
        work_queue_due('2026-09-19',1,'working','{"timezone":"Asia/Dubai","cutoff":"17:00","weekdays":[1,2,3,4,5,6],"holidays":[]}'::jsonb) AS working,
        work_queue_due('2026-09-19',1,'calendar','{"timezone":"Asia/Dubai","cutoff":"17:00","weekdays":[1,2,3,4,5,6],"holidays":[]}'::jsonb) AS calendar,
        work_queue_due('2026-09-19',1,'working','{"timezone":"Asia/Dubai","cutoff":"17:00","weekdays":[1,2,3,4,5,6],"holidays":["2026-09-21"]}'::jsonb) AS holiday,
        work_queue_local_cutoff('2026-03-08','02:30','America/New_York') AS gap,
        work_queue_local_cutoff('2026-11-01','01:30','America/New_York') AS repeated,
        work_queue_local_cutoff('2026-03-09','17:00','America/New_York') AS dst`);
      assert.equal(row.bad, null); assert.equal(row.good, '2026-09-18'); assert.equal(row.unknown, null);
      assert.equal(row.working.toISOString(), '2026-09-21T13:00:00.000Z');
      assert.equal(row.calendar.toISOString(), '2026-09-20T13:00:00.000Z');
      assert.equal(row.holiday.toISOString(), '2026-09-22T13:00:00.000Z');
      assert.equal(row.gap, null); assert.equal(row.repeated, null);
      assert.equal(row.dst.toISOString(), '2026-03-09T21:00:00.000Z');
    });
    await t.test('source inserts synchronize and notes/date corrections do not reset occurrence or SLA', async () => {
      const id = await order();
      const first = await current('order', id);
      assert.equal(first.stage_key, 'pending_order');
      assert.equal(first.due_at.toISOString(), '2026-09-19T13:00:00.000Z');
      await db.query("UPDATE die_orders SET remark='Ordinary edit',die_requested_date='2026-09-21' WHERE id=$1", [id]);
      await syncSource(db, 'order', id);
      const last = await current('order', id);
      assert.equal(last.id, first.id); assert.equal(last.occurrence, 1);
      assert.equal(last.due_at.toISOString(), first.due_at.toISOString());
      assert.equal(last.entered_date.toISOString(), first.entered_date.toISOString());
    });
    await t.test('source and queue roll back together', async () => {
      const id = await order();
      await db.query('BEGIN');
      await db.query("UPDATE die_orders SET status='AWAITING FOR DESIGN',ordered_date='2026-09-21' WHERE id=$1", [id]);
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      assert.equal((await current('order', id)).stage_key, 'awaiting_design');
      await db.query('ROLLBACK');
      assert.equal((await current('order', id)).stage_key, 'pending_order');
    });
    await t.test('multi-row imports are covered by source triggers', async () => {
      const { rows } = await db.query(`INSERT INTO sample_followups(plant,profile,status,die_received_date)
        VALUES($1,'BULK-A','Pending','2026-09-18'),($1,'BULK-B','Pending','2026-09-18') RETURNING id`, [plant]);
      ids.sample.push(...rows.map(r => r.id));
      for (const row of rows) assert.equal((await current('sample', row.id)).stage_key, 'sample_submission');
    });
    await t.test('revision mutation creates one new occurrence after the whole source transaction', async () => {
      const id = await order({ status: 'AWAITING FOR DESIGN', ordered_date: '2026-09-18' });
      const first = await current('order', id);
      await db.query('BEGIN');
      await db.query("INSERT INTO order_revisions(order_id,revision_number,to_status,revision_date) VALUES($1,1,'AWAITING FOR DESIGN','2026-09-21')", [id]);
      await db.query("UPDATE die_orders SET design_revision_count=1,status='AWAITING FOR DESIGN',last_revision_date='2026-09-21' WHERE id=$1", [id]);
      await db.query('COMMIT');
      const last = await current('order', id);
      assert.notEqual(last.id, first.id); assert.equal(last.occurrence, 2);
      assert.equal((await one('SELECT state FROM work_queue_items WHERE id=$1', [first.id])).state, 'superseded');
      assert.equal(Number((await one('SELECT count(*) FROM work_queue_items WHERE source_kind=$1 AND source_id=$2', ['order', id])).count), 2);
    });
    await t.test('manufacturing requires valid ETA and preserves baseline when promise changes', async () => {
      const id = await order({ status: 'DONE', eta: 'TBC' });
      assert.equal((await current('order', id)).due_at, null);
      assert.match((await current('order', id)).setup_reason, /ETA/);
      await db.query("UPDATE die_orders SET eta='2026-09-20' WHERE id=$1", [id]);
      const first = await current('order', id);
      assert.equal(first.deadline_basis, 'eta');
      assert.equal(first.due_at.toISOString(), '2026-09-20T13:00:00.000Z');
      await db.query("UPDATE die_orders SET eta='2026-09-24' WHERE id=$1", [id]);
      const last = await current('order', id);
      assert.equal(last.baseline_due_at.toISOString(), first.due_at.toISOString());
      assert.equal(last.due_at.toISOString(), '2026-09-24T13:00:00.000Z');
      assert.equal(last.id, first.id);
    });
    await t.test('sample approval state is authoritative, rejected samples stay actionable, explicit resubmission renews occurrence', async () => {
      const id = await sample({ status: 'Sample Submitted', submission_date: '2026-09-19' });
      const first = await current('sample', id);
      await db.query("UPDATE sample_followups SET status='Rejected' WHERE id=$1", [id]);
      assert.equal((await current('sample', id)).id, first.id);
      await db.query("UPDATE sample_followups SET status='Sample Submitted',submission_date='2026-09-21' WHERE id=$1", [id]);
      assert.equal((await current('sample', id)).occurrence, 2);
      await db.query("UPDATE sample_followups SET status='Approved',sample_approval_date='2026-09-22' WHERE id=$1", [id]);
      assert.equal(await current('sample', id), undefined);
      const skip = await order({ status: 'DIE RECEIVED', die_received_date: '2026-09-18', sample_status: 'Approved' });
      assert.equal(await current('order', skip), undefined);
    });
    await t.test('source hold preserves stage and baseline; resume credits only full interior working dates', async () => {
      const id = await order();
      const first = await current('order', id);
      await db.query("UPDATE die_orders SET status='HOLD' WHERE id=$1", [id]);
      const held = await current('order', id);
      assert.equal(held.id, first.id); assert.equal(held.state, 'paused'); assert.equal(held.source_held, true);
      assert.equal(held.stage_key, 'pending_order');
      await db.query("UPDATE work_queue_pauses SET start_at=clock_timestamp()-interval '7 days' WHERE item_id=$1 AND end_at IS NULL", [held.id]);
      await db.query("UPDATE die_orders SET status='PENDING FOR ORDERING' WHERE id=$1", [id]);
      const resumed = await current('order', id);
      assert.equal(resumed.id, first.id); assert.equal(resumed.state, 'active');
      assert.equal(resumed.source_held, false); assert.equal(resumed.baseline_due_at.toISOString(), first.baseline_due_at.toISOString());
      assert.ok(resumed.due_at > first.due_at);
      assert.ok(resumed.first_breached_at);
      const pause = await one('SELECT end_at,cardinality(credited_dates) AS credits FROM work_queue_pauses WHERE item_id=$1', [held.id]);
      assert.ok(pause.end_at); assert.ok(pause.credits >= 4);
    });
    await t.test('ETA source hold never shifts the promised deadline', async () => {
      const id = await order({ status: 'DONE', eta: '2026-09-25' });
      const first = await current('order', id);
      await db.query("UPDATE die_orders SET status='HOLD' WHERE id=$1", [id]);
      await db.query("UPDATE work_queue_pauses SET start_at=clock_timestamp()-interval '7 days' WHERE item_id=$1", [first.id]);
      await db.query("UPDATE die_orders SET status='DONE' WHERE id=$1", [id]);
      assert.equal((await current('order', id)).due_at.toISOString(), first.due_at.toISOString());
    });
    await t.test('QD source owner and FOC rounds are projected without transient tasks', async () => {
      const user = await one("INSERT INTO users(username,password_hash,role) VALUES($1,'test','admin') RETURNING id", [plant]);
      ids.users.push(user.id);
      const approval = await qd({ approval_state: 'Pending', assigned_approver: user.id, created_by: user.id, submitted_at: '2026-09-18 10:00:00' });
      const pending = await current('qd', approval);
      assert.equal(pending.stage_key, 'qd_approval'); assert.equal(pending.owner_id, user.id); assert.equal(pending.owner_mode, 'source');
      await db.query("UPDATE quality_discrepancies SET approval_state='SentBack',sent_back_at='2026-09-21 12:00:00' WHERE id=$1", [approval]);
      assert.equal((await current('qd', approval)).stage_key, 'qd_returned');
      const id = await qd();
      await db.query('BEGIN');
      await db.query("UPDATE quality_discrepancies SET status='FOC Accepted',eta_date='2026-09-25' WHERE id=$1", [id]);
      await db.query("INSERT INTO qd_foc_rounds(qd_id,round_no,accepted_at,promised_eta) VALUES($1,1,'2026-09-18','2026-09-25')", [id]);
      await db.query('COMMIT');
      const receipt = await current('qd', id);
      assert.equal(receipt.stage_key, 'foc_receipt'); assert.equal(receipt.setup_reason, null);
      assert.equal(receipt.occurrence, 1);
      await db.query('BEGIN');
      await db.query("UPDATE quality_discrepancies SET status='FOC Received' WHERE id=$1", [id]);
      await db.query("UPDATE qd_foc_rounds SET received_date='2026-09-21' WHERE qd_id=$1", [id]);
      await db.query('COMMIT');
      assert.equal((await current('qd', id)).stage_key, 'foc_trial');
      await db.query("UPDATE qd_foc_rounds SET trial_date='2026-09-22',trial_result='Fail' WHERE qd_id=$1", [id]);
      assert.equal(await current('qd', id), undefined);
    });
    await t.test('source deletion leaves a cancelled tombstone with event history', async () => {
      const id = await sample();
      const first = await current('sample', id);
      await db.query('DELETE FROM sample_followups WHERE id=$1', [id]);
      const tombstone = await one('SELECT * FROM work_queue_items WHERE id=$1', [first.id]);
      assert.equal(tombstone.sample_id, null); assert.equal(tombstone.state, 'cancelled'); assert.ok(tombstone.source_deleted_at);
      assert.equal((await one("SELECT count(*) FROM work_queue_events WHERE item_id=$1 AND kind='source_deleted'", [first.id])).count, '1');
    });
    await t.test('unknown source status is visible as setup work and typed identity cannot mismatch', async () => {
      const id = await qd({ status: 'Unexpected legacy value' });
      const item = await current('qd', id);
      assert.equal(item.stage_key, 'needs_setup'); assert.match(item.setup_reason, /Unknown QD status/);
      await assert.rejects(db.query("UPDATE work_queue_items SET source_kind='order' WHERE id=$1", [item.id]), error => error.code === '23514');
    });
    await t.test('invalid named QD approver remains named without becoming a shared approval', async () => {
      const user = await one("INSERT INTO users(username,password_hash,role,page_access) VALUES($1,'test','user','[\"orders\"]') RETURNING id", [`${plant}-restricted`]);
      ids.users.push(user.id);
      const id = await qd({ approval_state: 'Pending', assigned_approver: user.id, submitted_at: '2026-09-18 10:00:00' });
      const item = await current('qd', id);
      assert.equal(item.owner_id, user.id); assert.equal(item.owner_mode, 'source');
      assert.match(item.setup_reason, /owner is no longer eligible/);
    });
    await t.test('parallel reconciliation creates one occurrence and remains idempotent', async () => {
      const id = await order();
      const before = await current('order', id);
      const other = new Client({ connectionString: process.env.WORK_QUEUE_TEST_DATABASE_URL });
      await other.connect();
      try {
        await Promise.all([syncSource(db, 'order', id), syncSource(other, 'order', id)]);
      } finally { await other.end(); }
      const after = await current('order', id);
      assert.equal(after.id, before.id);
      assert.equal(Number((await one('SELECT count(*) FROM work_queue_items WHERE source_kind=$1 AND source_id=$2', ['order', id])).count), 1);
    });
    await t.test('assignment outbox is atomic and reconciliation suppression blocks backfill notifications', async () => {
      await db.query('BEGIN');
      try {
        await db.query("UPDATE work_queue_config SET notifications_enabled=TRUE,notifications_go_live_at=now()-interval '1 second' WHERE id=1");
        await db.query("INSERT INTO work_queue_rules(plant,stage_key,days,default_owner_id) VALUES($1,'pending_order',1,$2)", [plant, ids.users[0]]);
        const id = await order();
        await db.query('SET CONSTRAINTS ALL IMMEDIATE');
        const item = await current('order', id);
        assert.equal(Number((await one('SELECT count(*) FROM work_queue_notification_outbox WHERE item_id=$1', [item.id])).count), 1);
        await db.query("SELECT set_config('work_queue.suppress_notifications','true',true)");
        const silent = await order();
        const silentItem = await current('order', silent);
        assert.equal(Number((await one('SELECT count(*) FROM work_queue_notification_outbox WHERE item_id=$1', [silentItem.id])).count), 0);
      } finally { await db.query('ROLLBACK'); }
    });
    await t.test('reconciliation dry-run is read-only and repair is repeatable', async () => {
      const before = Number((await one('SELECT count(*) FROM work_queue_events e JOIN work_queue_items i ON i.id=e.item_id WHERE i.plant=$1', [plant])).count);
      const preview = await reconcileAll(db, { dryRun: true, plant });
      assert.ok(preview.examined > 0); assert.equal(preview.synced, 0);
      await reconcileAll(db, { dryRun: false, plant });
      await reconcileAll(db, { dryRun: false, plant });
      const after = Number((await one('SELECT count(*) FROM work_queue_events e JOIN work_queue_items i ON i.id=e.item_id WHERE i.plant=$1', [plant])).count);
      assert.equal(after, before);
    });
  } finally {
    await db.query('ROLLBACK');
    await db.query('DELETE FROM quality_discrepancies WHERE id=ANY($1::int[])', [ids.qd]);
    await db.query('DELETE FROM sample_followups WHERE id=ANY($1::int[])', [ids.sample]);
    await db.query('DELETE FROM die_orders WHERE id=ANY($1::int[])', [ids.order]);
    // Retain the isolated test database's audit rows; other suites can have
    // outbox references to them. All fixtures are distinguishable by plant.
    await db.query('DELETE FROM users WHERE id=ANY($1::int[])', [ids.users]);
    await db.end();
  }
});
