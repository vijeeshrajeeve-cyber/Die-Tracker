'use strict';

const { todayLocal } = require('./dates.cjs');

// A design sent back for rework invalidates the simulation pass that let it
// through, so Design Approval timing and the drawer's status rule start fresh.
// The rounds keep the history.
const CLEARS_SIMULATION_PASS = ['AWAITING FOR DESIGN', 'UNDER SIMULATION'];

// Record a design revision: history row, counter and status on the order, and
// an audit entry. Runs inside the caller's transaction -- the revisions route
// and a Supplier modification on the Simulation page both call it.
async function createRevision(client, { orderId, targetStatus, notes, revisionDate, revisionPdf, user }) {
  const revDate = revisionDate || todayLocal();

  const orderRes = await client.query(
    'SELECT status, design_revision_count FROM die_orders WHERE id = $1 FOR UPDATE',
    [orderId]
  );
  if (orderRes.rowCount === 0) return null;

  const fromStatus = orderRes.rows[0].status;
  const newRevisionNumber = (orderRes.rows[0].design_revision_count || 0) + 1;

  const revInsert = await client.query(`
      INSERT INTO order_revisions
        (order_id, revision_number, from_status, to_status, notes, revision_date, revision_pdf, created_by, created_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, created_at
  `, [
    orderId, newRevisionNumber, fromStatus, targetStatus, notes, revDate,
    revisionPdf || null, user?.id || null, user?.username || null,
  ]);

  const clearPass = CLEARS_SIMULATION_PASS.includes(targetStatus) ? ', simulation_completed_date = NULL' : '';
  await client.query(`
      UPDATE die_orders
      SET status = $1, design_revision_count = $2, last_revision_date = $3${clearPass}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
  `, [targetStatus, newRevisionNumber, revDate, orderId]);

  await client.query(`
      INSERT INTO order_changes
        (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    orderId, user?.id || null, user?.username || null, new Date(), 'Revision',
    fromStatus, `${targetStatus} (Rev #${newRevisionNumber})`, notes, fromStatus,
  ]);

  return {
    id: revInsert.rows[0].id,
    revisionNumber: newRevisionNumber,
    status: targetStatus,
    lastRevisionDate: revDate,
    fromStatus,
  };
}

module.exports = { createRevision, CLEARS_SIMULATION_PASS };
