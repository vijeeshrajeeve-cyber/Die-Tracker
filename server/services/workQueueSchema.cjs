'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const MIGRATION_ID = '20260921_work_queue_v1';

// Accept a connected client: source triggers are installed atomically. This
// function deliberately never backfills or sends mail; those are explicit jobs.
async function initializeWorkQueue(client) {
  const sql = await fs.readFile(path.join(__dirname, '../migrations/20260921_work_queue.sql'), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('initialize_work_queue'))");
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { migration: MIGRATION_ID, backfilled: false };
}

module.exports = { initializeWorkQueue, MIGRATION_ID };
