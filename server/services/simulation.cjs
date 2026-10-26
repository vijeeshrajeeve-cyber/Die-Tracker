'use strict';

// Database side of simulation step tracking. The rules live in
// simulationRounds.cjs; this module loads a die, asks those rules what the
// next step is, and writes it -- every step in one transaction with the order
// row locked, so two people on the same die cannot both record a step.

const rules = require('./simulationRounds.cjs');
const { planReceivedDate } = require('./stageCompletion.cjs');
const { createRevision } = require('./orderRevisions.cjs');
const { presentOrder } = require('./orderPresentation.cjs');

const ROUND_INSERT_COLS = 'order_id, round_no, started_from, revision_id, model_received_date, created_by, created_by_name';

// Working calendars by plant, '' for the global row. Weekdays and holidays
// only: the late rule counts days, it never needs the cutoff or timezone.
async function loadCalendars(client) {
  const { rows } = await client.query(
    'SELECT plant, weekdays, holidays::text[] AS holidays FROM work_queue_calendars'
  );
  const byPlant = new Map(rows.map(r => [r.plant || '', { weekdays: r.weekdays, holidays: r.holidays || [] }]));
  return (plant) => byPlant.get(plant || '') || byPlant.get('') || {};
}

async function loadRounds(client, orderId) {
  const { rows } = await client.query('SELECT * FROM simulation_rounds WHERE order_id = $1 ORDER BY round_no', [orderId]);
  return rows;
}

async function loadLatestRevision(client, orderId) {
  const { rows } = await client.query(
    `SELECT id, design_received_date, revision_date, created_at FROM order_revisions WHERE order_id = $1
     ORDER BY revision_number DESC, id DESC LIMIT 1`,
    [orderId]
  );
  return rows[0] || null;
}

async function describe(client, orderId, today) {
  const { rows } = await client.query('SELECT * FROM die_orders WHERE id = $1', [orderId]);
  const order = rows[0];
  const calendarFor = await loadCalendars(client);
  const die = rules.deriveDie({
    order, rows: await loadRounds(client, orderId), latestRevision: await loadLatestRevision(client, orderId),
    calendar: calendarFor(order.plant), today,
  });
  return { die, order: presentOrder(order) };
}

async function listSimulation(client, today) {
  const { rows: orders } = await client.query(
    "SELECT * FROM die_orders WHERE status = 'UNDER SIMULATION' ORDER BY id"
  );
  const calendarFor = await loadCalendars(client);
  const { rows: finished } = await client.query(
    `SELECT r.model_received_date, r.sim_completed_date, r.result, r.fail_reason, o.plant
       FROM simulation_rounds r JOIN die_orders o ON o.id = r.order_id
      WHERE r.sim_completed_date > $1::date - $2::int`,
    [today, rules.RECENT_DAYS]
  );
  const recent_rounds = rules.recentRounds(finished, calendarFor, today);
  if (!orders.length) return { dies: [], recent_rounds };
  const ids = orders.map(o => o.id);
  const { rows: rounds } = await client.query(
    'SELECT * FROM simulation_rounds WHERE order_id = ANY($1) ORDER BY order_id, round_no', [ids]
  );
  const { rows: revisions } = await client.query(
    `SELECT DISTINCT ON (order_id) order_id, id, design_received_date, revision_date, created_at
       FROM order_revisions WHERE order_id = ANY($1)
      ORDER BY order_id, revision_number DESC, id DESC`,
    [ids]
  );
  const latest = new Map(revisions.map(r => [r.order_id, r]));
  const dies = orders.map(order => rules.deriveDie({
    order, rows: rounds.filter(r => r.order_id === order.id), latestRevision: latest.get(order.id) || null,
    calendar: calendarFor(order.plant), today,
  }));
  return { dies, recent_rounds };
}

const refuse = (status, error) => ({ ok: false, status, error });

// Opens a transaction, locks the order, and hands `work` the loaded die. A
// refusal rolls back; a thrown error rolls back and propagates.
async function inTransaction(client, orderId, work) {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query('SELECT * FROM die_orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return refuse(404, 'Order not found'); }
    if (order.status !== 'UNDER SIMULATION') {
      await client.query('ROLLBACK');
      return refuse(409, 'This die is no longer in Simulation');
    }
    const roundRows = await loadRounds(client, orderId);
    const outcome = await work({ order, roundRows });
    if (outcome) { await client.query('ROLLBACK'); return outcome; }
    await client.query('COMMIT');
    return null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function updateRound(client, id, fields) {
  const cols = Object.keys(fields);
  await client.query(
    `UPDATE simulation_rounds SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${cols.length + 1}`,
    [...cols.map(c => fields[c]), id]
  );
}

async function insertRound(client, orderId, { round_no, started_from, revision_id = null, model_received_date = null }, user) {
  const { rows } = await client.query(
    `INSERT INTO simulation_rounds (${ROUND_INSERT_COLS}) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [orderId, round_no, started_from, revision_id, model_received_date, user?.id || null, user?.username || null]
  );
  return rows[0];
}

async function recordStep(client, orderId, input, user, today) {
  const refused = await inTransaction(client, orderId, async ({ order, roundRows }) => {
    const latestRevision = await loadLatestRevision(client, orderId);
    const rounds = rules.deriveRounds({ order, rows: roundRows, latestRevision });
    let round = rounds[rounds.length - 1];
    const check = rules.validateStep(round, input, today);
    if (!check.ok) return refuse(check.stageMismatch ? 409 : 400, check.error);
    const v = check.value;

    if (round.id === null) {
      const revision_id = ['supplier', 'reentry'].includes(round.started_from) ? latestRevision?.id || null : null;
      round = { ...round, ...(await insertRound(client, orderId, { ...round, revision_id }, user)) };
    }

    switch (v.step) {
      case 'model_received': {
        // The order keeps the first real receipt; a re-receipt after a supplier
        // revision is logged on that revision, as Design Received is.
        const plan = planReceivedDate({ field: '3D Model Received Date', existingValue: order.three_d_model_received_date });
        let target = null;
        if (plan.writeTo === 'order') {
          await client.query(
            'UPDATE die_orders SET three_d_model_received_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [v.date, orderId]
          );
          target = 'order';
        } else if (round.revision_id) {
          const res = await client.query(
            'UPDATE order_revisions SET model_received_date = $1 WHERE id = $2 AND model_received_date IS NULL',
            [v.date, round.revision_id]
          );
          if (res.rowCount) target = 'revision';
        }
        await updateRound(client, round.id, { model_received_date: v.date, model_date_target: target });
        break;
      }
      case 'prep_done':
        await updateRound(client, round.id, { prep_done_date: v.date });
        break;
      case 'sim_completed':
        await updateRound(client, round.id, {
          sim_completed_date: v.date, result: v.result, fail_reason: v.fail_reason,
          modification: v.modification, comments: v.comments,
        });
        if (v.result === 'OK') {
          await client.query(
            `UPDATE die_orders SET simulation_completed_date = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [v.date, 'PENDING FOR DESIGN APPROVAL', orderId]
          );
          await client.query(
            `INSERT INTO order_changes (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [orderId, user?.id || null, user?.username || null, new Date(), 'STATUS',
              order.status, 'PENDING FOR DESIGN APPROVAL', `Simulation round ${round.round_no} OK`, order.status]
          );
        } else if (v.modification === 'Supplier') {
          const rev = await createRevision(client, {
            orderId, targetStatus: 'AWAITING FOR DESIGN', notes: v.revision_notes, revisionDate: v.date, user,
          });
          await updateRound(client, round.id, { supplier_revision_id: rev.id });
        }
        break;
      case 'modification_done':
        await updateRound(client, round.id, { modification_done_date: v.date });
        // The in-house modified model goes straight to preparation.
        await insertRound(client, orderId, { round_no: round.round_no + 1, started_from: 'in_house', model_received_date: v.date }, user);
        break;
      default:
        return refuse(400, 'Unknown step');
    }
    return null;
  });
  if (refused) return refused;
  return { ok: true, ...(await describe(client, orderId, today)) };
}

// Reverses the newest entry on a die, to fix a mistake. A step that created a
// supplier revision, or an OK that moved the order on, is never undone here.
async function undoLastStep(client, orderId, user, today) {
  const refused = await inTransaction(client, orderId, async ({ order, roundRows }) => {
    const last = roundRows[roundRows.length - 1];
    if (!last) return refuse(409, 'There is no step to undo');
    // A round left open from before a later revision is history, not a step
    // to take back: the die is waiting for a new model.
    const derived = rules.deriveRounds({ order, rows: roundRows, latestRevision: await loadLatestRevision(client, orderId) });
    if (derived[derived.length - 1].id === null) return refuse(409, 'There is no step to undo');
    const prev = roundRows[roundRows.length - 2];

    if (last.started_from === 'in_house' && prev && !last.prep_done_date) {
      await client.query('DELETE FROM simulation_rounds WHERE id = $1', [last.id]);
      await updateRound(client, prev.id, { modification_done_date: null });
      return null;
    }

    switch (rules.stageOfRound(last)) {
      case 'in_house_mod':
        await updateRound(client, last.id, { sim_completed_date: null, result: null, fail_reason: null, modification: null, comments: null });
        return null;
      case 'prep_done':
        await updateRound(client, last.id, { prep_done_date: null });
        return null;
      case 'model_received': {
        const date = String(last.model_received_date).slice(0, 10);
        if (last.model_date_target === 'order' && String(order.three_d_model_received_date || '').slice(0, 10) === date) {
          await client.query(
            'UPDATE die_orders SET three_d_model_received_date = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [orderId]
          );
        } else if (last.model_date_target === 'revision' && last.revision_id) {
          await client.query('UPDATE order_revisions SET model_received_date = NULL WHERE id = $1', [last.revision_id]);
        }
        // A round holding nothing else goes back to being virtual.
        await client.query('DELETE FROM simulation_rounds WHERE id = $1', [last.id]);
        return null;
      }
      default:
        return refuse(409, 'The last step cannot be undone here');
    }
  });
  if (refused) return refused;
  return { ok: true, ...(await describe(client, orderId, today)) };
}

module.exports = { listSimulation, recordStep, undoLastStep };
