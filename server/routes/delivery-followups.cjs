'use strict';
// Die delivery follow-up for the In Manufacturing page: per-die summaries,
// the delivery timeline, and logging a follow-up (optionally with a new ETA).
const express = require('express');
const { pool } = require('../db.cjs');
const { todayLocal } = require('../services/dates.cjs');
const delivery = require('../services/deliveryFollowup.cjs');

const router = express.Router();

// DATEs are cast to text so a Date object can never reach normalizeEta.
const SUMMARY_SQL = `
  SELECT o.id, o.eta,
         (SELECT e.eta_before::text FROM die_delivery_events e
           WHERE e.order_id = o.id AND e.kind = 'eta_revised'
           ORDER BY e.created_at, e.id LIMIT 1) AS first_revised_from,
         (SELECT COUNT(*) FROM die_delivery_events e
           WHERE e.order_id = o.id AND e.kind = 'eta_revised')::int AS slips,
         lc.contact_date AS last_contact_date, lc.channel AS last_contact_channel,
         (SELECT MAX(e.created_at) FROM die_delivery_events e
           WHERE e.order_id = o.id AND e.kind = 'chaser_sent') AS last_chased_at
    FROM die_orders o
    LEFT JOIN LATERAL (
      SELECT e.contact_date::text AS contact_date, e.channel FROM die_delivery_events e
       WHERE e.order_id = o.id AND e.kind = 'contact'
       ORDER BY e.contact_date DESC, e.id DESC LIMIT 1
    ) lc ON true
   WHERE o.status = 'DONE' AND o.die_received_date IS NULL`;

function orderIdFrom(req, res) {
  const id = Number(req.params.orderId);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid order ID' });
    return null;
  }
  return id;
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(SUMMARY_SQL);
    const summaries = {};
    for (const row of rows) summaries[row.id] = delivery.summarize(row);
    res.json({ summaries });
  } catch (error) {
    console.error('Delivery summaries error:', error);
    res.status(500).json({ error: 'Failed to load delivery follow-ups' });
  }
});

router.get('/:orderId/events', async (req, res) => {
  const id = orderIdFrom(req, res);
  if (!id) return;
  try {
    const { rows } = await pool.query(
      `SELECT ${delivery.EVENT_COLUMNS} FROM die_delivery_events
        WHERE order_id = $1 ORDER BY created_at DESC, id DESC`, [id]);
    res.json({ events: rows });
  } catch (error) {
    console.error('Delivery events error:', error);
    res.status(500).json({ error: 'Failed to load the delivery timeline' });
  }
});

// One follow-up = one contact, plus an ETA change when the supplier gave a
// new date. Both land in one transaction with the order row locked.
router.post('/:orderId', async (req, res) => {
  const id = orderIdFrom(req, res);
  if (!id) return;
  let input;
  try {
    input = delivery.validateFollowUp(req.body, todayLocal());
  } catch (error) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT eta FROM die_orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const plan = input.newEta ? delivery.planEtaChange(rows[0].eta, input.newEta, input.change) : null;
    const events = [];
    if (plan) {
      await client.query('UPDATE die_orders SET eta = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [plan.after, id]);
      events.push(await delivery.insertEtaEvent(client, id, plan, req.user));
    }
    events.push(await delivery.insertContactEvent(client, id, input, req.user));
    await client.query('COMMIT');
    res.status(201).json({ events, eta: plan ? plan.after : rows[0].eta });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof delivery.DeliveryRuleError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('Log delivery follow-up error:', error);
    res.status(500).json({ error: 'Failed to save the follow-up' });
  } finally {
    client?.release();
  }
});

module.exports = router;
