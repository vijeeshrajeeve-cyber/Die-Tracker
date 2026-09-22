'use strict';

const SOURCE_KINDS = new Set(['order', 'sample', 'qd']);
function validateSource(kind, id) {
  if (!SOURCE_KINDS.has(kind) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) {
    throw new TypeError('A valid queue source kind and positive source id are required');
  }
}
async function syncSource(client, kind, id) {
  validateSource(kind, id);
  const { rows } = await client.query('SELECT work_queue_sync($1, $2) AS item_id', [kind, Number(id)]);
  return rows[0]?.item_id ?? null;
}
async function projectSource(client, kind, id) {
  validateSource(kind, id);
  const { rows } = await client.query('SELECT work_queue_project($1, $2) AS projection', [kind, Number(id)]);
  return rows[0]?.projection ?? null;
}

// Call with a connected client, not a pool, so snapshot/backfill transactions
// and notification suppression apply to the same PostgreSQL connection.
async function reconcileAll(client, { dryRun = true, plant = null } = {}) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await client.query("SELECT set_config('work_queue.suppress_notifications', 'true', true)");
    const { rows: sources } = await client.query(`
      SELECT 'order' AS kind, id FROM die_orders WHERE ($1::text IS NULL OR plant = $1)
      UNION ALL SELECT 'sample', id FROM sample_followups WHERE ($1::text IS NULL OR plant = $1)
      UNION ALL SELECT 'qd', id FROM quality_discrepancies WHERE ($1::text IS NULL OR plant = $1)
      UNION SELECT source_kind, source_id FROM work_queue_items
       WHERE state IN ('active','paused') AND ($1::text IS NULL OR plant = $1)
      ORDER BY kind, id`, [plant]);
    const result = { dryRun, examined: sources.length, actionable: 0, needsSetup: 0, held: 0, synced: 0 };
    for (const source of sources) {
      const projection = await projectSource(client, source.kind, source.id);
      if (projection?.stage_key) result.actionable++;
      if (projection?.setup_reason) result.needsSetup++;
      if (projection?.source_held) result.held++;
      if (!dryRun) {
        await syncSource(client, source.kind, source.id);
        result.synced++;
      }
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function reconcileQueueMaintenance(db) {
  await db.query(`UPDATE work_queue_items SET first_breached_at=due_at
    WHERE state='active' AND setup_reason IS NULL AND due_at<now() AND first_breached_at IS NULL`);
  await db.query('DELETE FROM work_queue_previews WHERE expires_at<now()');
}
function scheduleWorkQueueMaintenance(db) {
  const timer=setInterval(()=>reconcileQueueMaintenance(db).catch(error=>console.error('Work queue maintenance:',error.message)),60000);
  timer.unref?.();
  return ()=>clearInterval(timer);
}

module.exports = { reconcileQueueMaintenance,scheduleWorkQueueMaintenance,SOURCE_KINDS, syncSource, syncOrder: (db, id) => syncSource(db, 'order', id),
  syncSample: (db, id) => syncSource(db, 'sample', id), syncQd: (db, id) => syncSource(db, 'qd', id),
  projectSource, reconcileAll };
