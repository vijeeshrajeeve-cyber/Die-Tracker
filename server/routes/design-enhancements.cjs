'use strict';
const express = require('express');
const { pool } = require('../db.cjs');
const { validateBaseline } = require('../services/designEnhancement.cjs');
const { insertChangeLog } = require('../services/orderChangeLog.cjs');
const { SIMULATION_STATUSES, markAccess, removeAccess } = require('../services/enhancementAccess.cjs');

const router = express.Router();

const BASELINE_KEYS = ['current_issue', 'reference_dies', 'baseline_failure_pct', 'baseline_productivity_kgh',
  'baseline_recovery_pct', 'target_failure_pct', 'target_productivity_kgh', 'target_recovery_pct',
  'failure_assessment_required'];

const shown = (v) => (v === null || v === undefined ? null : String(v));
const reasonOf = (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 500) : null);
const refusal = (access) => ({ refused: { status: access.status, json: { error: access.error, code: access.code } } });

// Runs work(client) in one transaction. A result with `refused` rolls back.
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(result.refused ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const lockOrder = async (client, orderId) => {
  const { rows } = await client.query(
    'SELECT id, status, design_enhancement, simulation_enabled FROM die_orders WHERE id = $1 FOR UPDATE', [orderId]);
  return rows[0] || null;
};

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM design_enhancements ORDER BY die_order_id');
    res.json({ enhancements: rows });
  } catch (error) {
    console.error('List design enhancements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create on the first call, update after. The baseline fields are the body;
// `reason` is required only on the admin path (after DIE RECEIVED).
router.put('/order/:orderId', async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) return res.status(400).json({ error: 'Invalid order id' });
  const body = req.body || {};
  const checked = validateBaseline(body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const reason = reasonOf(body.reason);

  try {
    const out = await withTransaction(async (client) => {
      const order = await lockOrder(client, orderId);
      if (!order) return { refused: { status: 404, json: { error: 'Order not found' } } };
      const access = markAccess(req.user, order.status, reason);
      if (!access.ok) return refusal(access);

      const found = await client.query('SELECT * FROM design_enhancements WHERE die_order_id = $1', [orderId]);
      const before = found.rows[0];
      const value = checked.value;
      const entries = [];
      let enhancement;
      if (before) {
        const sets = BASELINE_KEYS.map((k, i) => `${k} = $${i + 1}`);
        const updated = await client.query(
          `UPDATE design_enhancements SET ${sets.join(', ')}, updated_at = now() WHERE die_order_id = $${BASELINE_KEYS.length + 1} RETURNING *`,
          [...BASELINE_KEYS.map((k) => value[k]), orderId]);
        enhancement = updated.rows[0];
        for (const k of BASELINE_KEYS) {
          if (shown(before[k]) !== shown(value[k])) {
            entries.push({ field: `Design enhancement: ${k}`, oldValue: shown(before[k]), newValue: shown(value[k]), reason, stage: order.status });
          }
        }
        if (!entries.length) entries.push({ field: 'Design enhancement', oldValue: 'Yes', newValue: 'Yes (saved unchanged)', reason, stage: order.status });
      } else {
        const inserted = await client.query(
          `INSERT INTO design_enhancements (die_order_id, ${BASELINE_KEYS.join(', ')}, created_by)
           VALUES ($1, ${BASELINE_KEYS.map((_, i) => `$${i + 2}`).join(', ')}, $${BASELINE_KEYS.length + 2}) RETURNING *`,
          [orderId, ...BASELINE_KEYS.map((k) => value[k]), req.user.username || null]);
        enhancement = inserted.rows[0];
        const switchOn = SIMULATION_STATUSES.includes(String(order.status || '').toUpperCase());
        await client.query(
          `UPDATE die_orders SET design_enhancement = 1${switchOn ? ', simulation_enabled = 1' : ''}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [orderId]);
        entries.push({ field: 'Design enhancement', oldValue: 'No', newValue: 'Yes', reason, stage: order.status });
        if (switchOn && !order.simulation_enabled) {
          entries.push({ field: 'simulationEnabled', oldValue: 'No', newValue: 'Yes', reason: 'Design enhancement', stage: order.status });
        }
      }
      await insertChangeLog(client, orderId, entries, req.user);
      return { enhancement };
    });
    if (out.refused) return res.status(out.refused.status).json(out.refused.json);
    res.json({ enhancement: out.enhancement });
  } catch (error) {
    console.error('Save design enhancement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove the flag and the enhancement record; the change log keeps the baseline.
router.delete('/order/:orderId', async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) return res.status(400).json({ error: 'Invalid order id' });
  const reason = reasonOf((req.body || {}).reason);

  try {
    const out = await withTransaction(async (client) => {
      const order = await lockOrder(client, orderId);
      if (!order) return { refused: { status: 404, json: { error: 'Order not found' } } };
      const found = await client.query('SELECT * FROM design_enhancements WHERE die_order_id = $1', [orderId]);
      if (!found.rows.length) return { refused: { status: 404, json: { error: 'This order is not a Design enhancement' } } };
      const trial = await client.query('SELECT 1 FROM sample_trials WHERE die_order_id = $1 LIMIT 1', [orderId]);
      const access = removeAccess(req.user, trial.rows.length > 0, reason);
      if (!access.ok) return refusal(access);

      await client.query('DELETE FROM design_enhancements WHERE die_order_id = $1', [orderId]);
      await client.query('UPDATE die_orders SET design_enhancement = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [orderId]);
      const old = found.rows[0];
      await insertChangeLog(client, orderId, [{
        field: 'Design enhancement',
        oldValue: `Yes (issue: ${old.current_issue})`,
        newValue: 'No',
        reason,
        stage: order.status,
      }], req.user);
      return { removed: true };
    });
    if (out.refused) return res.status(out.refused.status).json(out.refused.json);
    res.json({ removed: true });
  } catch (error) {
    console.error('Remove design enhancement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
