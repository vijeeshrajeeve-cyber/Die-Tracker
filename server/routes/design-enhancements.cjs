'use strict';
const express = require('express');
const { pool } = require('../db.cjs');
const {
  VERDICTS, validateBaseline, suggestVerdict, needsLifeReview, latestOkTrial, defaultReviewDate, isIsoDate, parseNumber, isBlank,
} = require('../services/designEnhancement.cjs');
const { insertChangeLog } = require('../services/orderChangeLog.cjs');
const { marksSimulationOn, markAccess, removeAccess, verdictAccess } = require('../services/enhancementAccess.cjs');
const { trialsForParent, normaliseDate } = require('../services/sampleTrials.cjs');
const { todayLocal } = require('../services/dates.cjs');
const { pageAccessMiddleware } = require('./auth.cjs');
const { collectJFileData, dieKey } = require('../services/jFileData.cjs');

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

const lockOrder = async (client, orderId, lock = true) => {
  const { rows } = await client.query(
    `SELECT id, status, design_enhancement, simulation_enabled, sample_status, sample_approval_date, die_received_date, design_approved_date FROM die_orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [orderId]);
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
      const found = await client.query('SELECT * FROM design_enhancements WHERE die_order_id = $1', [orderId]);
      const before = found.rows[0];
      const trial = await client.query('SELECT 1 FROM sample_trials WHERE die_order_id = $1 LIMIT 1', [orderId]);
      const access = markAccess(req.user, order.status, reason, {
        receivedDate: order.die_received_date, hasTrial: trial.rows.length > 0, trialVerdict: before && before.trial_verdict,
      });
      if (!access.ok) return refusal(access);
      if (before && before.trial_verdict && Boolean(before.failure_assessment_required) !== Boolean(checked.value.failure_assessment_required)) {
        return refusal({ status: 400, error: 'The die failure assessment choice cannot be changed after the trial verdict; redo the trial verdict instead', code: 'ASSESSMENT_LOCKED' });
      }
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
        const switchOn = marksSimulationOn(order.status, order.design_approved_date);
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

// The whole record, as one readable line, for the removal log row. A blank
// value reads "not recorded", never 0. Verdict parts appear only when present.
function removedRecord(row) {
  const n = (v, unit) => (v === null || v === undefined || v === '' ? 'not recorded' : `${Number(v)} ${unit}`);
  const parts = [
    `Yes (issue: ${row.current_issue})`,
    `baseline productivity ${n(row.baseline_productivity_kgh, 'kg/h')}`,
    `baseline recovery ${n(row.baseline_recovery_pct, '%')}`,
    `baseline failure ${n(row.baseline_failure_pct, '%')}`,
    `target productivity ${n(row.target_productivity_kgh, 'kg/h')}`,
    `target recovery ${n(row.target_recovery_pct, '%')}`,
    `target failure ${n(row.target_failure_pct, '%')}`,
    `failure assessment required: ${row.failure_assessment_required ? 'Yes' : 'No'}`,
  ];
  if (row.reference_dies) parts.push(`dies referred: ${row.reference_dies}`);
  if (row.trial_verdict) {
    parts.push(`trial productivity ${n(row.trial_productivity_kgh, 'kg/h')}`, `trial recovery ${n(row.trial_recovery_pct, '%')}`,
      `trial verdict ${row.trial_verdict}`);
  }
  if (row.life_review_date != null || row.actual_failure_pct != null) parts.push(`actual failure ${n(row.actual_failure_pct, '%')}`);
  if (row.final_verdict) parts.push(`final verdict ${row.final_verdict}`);
  return parts.join('; ');
}

// Remove the flag and the enhancement record; the change log keeps the whole record.
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
      // Every removal needs a reason, not only the admin path.
      if (!reason) return refusal({ status: 400, error: 'Give a reason for removing the Design enhancement', code: 'REASON_REQUIRED' });

      await client.query('DELETE FROM design_enhancements WHERE die_order_id = $1', [orderId]);
      await client.query('UPDATE die_orders SET design_enhancement = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [orderId]);
      await insertChangeLog(client, orderId, [{
        field: 'Design enhancement',
        oldValue: removedRecord(found.rows[0]),
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

// ---- context for the form and the drawer -------------------------------------

// The die numbers the plant runs (or has on order) for a die's profile, minus
// the die itself. Informational only: the form lists them beside "Existing dies
// referred". Same lookup the J-file uses, so the two never disagree.
async function activeDiesFor(dieNo) {
  const { activeDies } = await collectJFileData(pool, dieNo);
  const own = dieKey(dieNo);
  return activeDies.map((d) => d.die_no).filter((n) => dieKey(n) !== own);
}

// For a new order, before it has an id.
router.get('/active-dies', async (req, res) => {
  const dieNo = typeof req.query.dieNo === 'string' ? req.query.dieNo.trim() : '';
  if (!dieNo) return res.json({ activeDies: [] });
  try {
    res.json({ activeDies: await activeDiesFor(dieNo) });
  } catch (error) {
    console.error('Design enhancement active dies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/order/:orderId/context', async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) return res.status(400).json({ error: 'Invalid order id' });
  try {
    const found = await pool.query('SELECT die_no FROM die_orders WHERE id = $1', [orderId]);
    if (!found.rows.length) return res.status(404).json({ error: 'Order not found' });
    const [activeDies, count] = await Promise.all([
      activeDiesFor(found.rows[0].die_no),
      pool.query('SELECT COUNT(*)::int AS n FROM sample_trials WHERE die_order_id = $1', [orderId]),
    ]);
    res.json({ activeDies, trialCount: count.rows[0].n });
  } catch (error) {
    console.error('Design enhancement context error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- verdicts and the life review -------------------------------------------

const num = (v) => (v === null || v === undefined ? null : Number(v));
const remarkOf = (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 1000) : null);
const parseOrderId = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; };
const notFound = (error) => ({ refused: { status: 404, json: { error } } });
const bad = (error) => ({ refused: { status: 400, json: { error } } });

// A failure %: strict number, 0 to 100.
function parseFailure(raw, key) {
  if (isBlank(raw)) return { error: `${key} is required` };
  const n = parseNumber(raw);
  if (Number.isNaN(n)) return { error: `${key} must be a number of 0 or more` };
  if (n > 100) return { error: `${key} cannot be more than 100` };
  return { value: n };
}

// The remark is required whenever the chosen verdict is not the suggestion.
// With no suggestion (no numbers to compare) every verdict is an override.
function remarkRule(verdict, suggested, rawRemark) {
  const remark = remarkOf(rawRemark);
  if (verdict !== suggested && !remark) return { error: 'A remark is required when the verdict differs from the suggestion' };
  return { remark };
}

const targetsOf = (row, withFailure) => ({
  failure: withFailure ? num(row.target_failure_pct) : null,
  productivity: num(row.target_productivity_kgh),
  recovery: num(row.target_recovery_pct),
});

// Trial-stage suggestion: the latest OK trial against the productivity and
// recovery targets. A Rejected sample is in rework and is never suggested
// anything, same as the client copy.
function trialSuggestion(order, row, latest) {
  const actuals = { failure: null, productivity: latest ? num(latest.productivity_kgh) : null, recovery: latest ? num(latest.recovery_pct) : null };
  if (order.sample_status === 'Rejected') return { suggested: null, actuals };
  return { suggested: suggestVerdict({ targets: targetsOf(row, false), actuals }), actuals };
}

const REJECTED_REFUSAL = 'A rejected sample keeps the project open; record the verdict after approval, or close the project as Not achieved with a remark';

async function updateColumns(client, orderId, columns) {
  const names = Object.keys(columns);
  const { rows } = await client.query(
    `UPDATE design_enhancements SET ${names.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() WHERE die_order_id = $${names.length + 1} RETURNING *`,
    [...names.map((c) => columns[c]), orderId]);
  return rows[0];
}

const LIFE_REVIEW_COLUMNS = ['actual_failure_pct', 'life_review_remark', 'life_review_by', 'life_review_date'];
const FINAL_COLUMNS = ['final_verdict', 'final_verdict_remark', 'final_verdict_by', 'final_verdict_date'];
const cleared = (names) => Object.fromEntries(names.map((c) => [c, null]));

// What the verdict form needs: the suggestion, the numbers behind it, and the
// default life-review date. Trial stage reads the live latest OK trial; final
// stage reads the stored snapshot. `?actual_failure_pct=` previews a final one.
router.get('/order/:orderId/suggestion', async (req, res) => {
  const orderId = parseOrderId(req.params.orderId);
  if (!orderId) return res.status(400).json({ error: 'Invalid order id' });
  let preview = null;
  if (!isBlank(req.query.actual_failure_pct)) {
    const checked = parseFailure(req.query.actual_failure_pct, 'actual_failure_pct');
    if (checked.error) return res.status(400).json({ error: checked.error });
    preview = checked.value;
  }
  try {
    const order = await lockOrder(pool, orderId, false);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const found = await pool.query('SELECT * FROM design_enhancements WHERE die_order_id = $1', [orderId]);
    const row = found.rows[0];
    if (!row) return res.status(404).json({ error: 'This order is not a Design enhancement' });

    const reviewing = Boolean(row.trial_verdict) && (row.life_review_date != null || needsLifeReview(row, order));
    let targets;
    let actuals;
    let suggested = null;
    const rework = !reviewing && !row.final_verdict && order.sample_status === 'Rejected';
    if (reviewing) {
      targets = targetsOf(row, true);
      actuals = { failure: preview !== null ? preview : num(row.actual_failure_pct),
        productivity: num(row.trial_productivity_kgh), recovery: num(row.trial_recovery_pct) };
    } else {
      const latest = latestOkTrial(await trialsForParent(pool, { column: 'die_order_id', id: orderId }));
      targets = targetsOf(row, false);
      ({ actuals, suggested } = trialSuggestion(order, row, latest));
    }
    res.json({
      stage: reviewing ? 'final' : rework ? 'rework' : 'trial',
      suggested: reviewing ? suggestVerdict({ targets, actuals }) : suggested,
      actuals,
      targets,
      defaultReviewDate: defaultReviewDate(normaliseDate(order.sample_approval_date)),
    });
  } catch (error) {
    console.error('Design enhancement suggestion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save the trial verdict. It snapshots the latest OK trial's numbers, so a
// later edit to that trial cannot change what the verdict was based on.
router.post('/order/:orderId/trial-verdict', pageAccessMiddleware('flow-sample-followup'), async (req, res) => {
  const orderId = parseOrderId(req.params.orderId);
  if (!orderId) return res.status(400).json({ error: 'Invalid order id' });
  const body = req.body || {};
  if (!VERDICTS.includes(body.verdict)) return res.status(400).json({ error: `verdict must be one of: ${VERDICTS.join(', ')}` });
  const verdict = body.verdict;
  const reason = reasonOf(body.reason);
  const today = todayLocal();

  try {
    const out = await withTransaction(async (client) => {
      const order = await lockOrder(client, orderId);
      if (!order) return notFound('Order not found');
      const found = await client.query('SELECT * FROM design_enhancements WHERE die_order_id = $1', [orderId]);
      const row = found.rows[0];
      if (!row) return notFound('This order is not a Design enhancement');
      if (String(order.status || '').toUpperCase() === 'CANCELLED') return bad('A cancelled order cannot get a verdict');
      // A Rejected sample keeps the project open through rework; the only
      // thing allowed is the explicit close as Not achieved, with a remark.
      const rejected = order.sample_status === 'Rejected';
      if (!rejected && order.sample_status !== 'Approved') {
        return bad('The trial verdict can be saved once the sample is Approved');
      }
      const closing = rejected && verdict === 'Not achieved' && body.abandon === true && remarkOf(body.remark) !== null;
      if (rejected && !closing) return bad(REJECTED_REFUSAL);
      const access = verdictAccess(req.user, Boolean(row.trial_verdict), reason);
      if (!access.ok) return refusal(access);

      const latest = latestOkTrial(await trialsForParent(client, { column: 'die_order_id', id: orderId }));
      const snapshot = {
        trial_productivity_kgh: latest ? num(latest.productivity_kgh) : null,
        trial_recovery_pct: latest ? num(latest.recovery_pct) : null,
        source_trial_id: latest ? latest.id : null,
      };
      const { suggested } = trialSuggestion(order, row, latest);
      const ruled = closing ? { remark: remarkOf(body.remark) } : remarkRule(verdict, suggested, body.remark);
      if (ruled.error) return bad(ruled.error);

      // Would a life review be owed once this verdict is saved?
      const owed = needsLifeReview(
        { trial_verdict: verdict, failure_assessment_required: row.failure_assessment_required, final_verdict: null }, order);
      let dueDate = null;
      if (owed) {
        dueDate = body.life_review_due_date;
        if (!isIsoDate(dueDate) || dueDate < today) return bad('life_review_due_date is required: a date of today or later');
      }

      const by = req.user.username || null;
      const columns = {
        ...snapshot,
        trial_verdict: verdict, trial_verdict_remark: ruled.remark, trial_verdict_by: by, trial_verdict_date: today,
        life_review_due_date: dueDate,
      };
      // A redo drops any earlier life review: it either is owed afresh or was never needed.
      Object.assign(columns, cleared(LIFE_REVIEW_COLUMNS));
      if (owed) {
        Object.assign(columns, cleared(FINAL_COLUMNS));
      } else {
        Object.assign(columns, { final_verdict: verdict, final_verdict_remark: ruled.remark, final_verdict_by: by, final_verdict_date: today });
      }
      const enhancement = await updateColumns(client, orderId, columns);

      const entries = [{ field: 'Design enhancement: trial verdict', oldValue: row.trial_verdict || null, newValue: verdict, reason, stage: order.status }];
      if (row.life_review_date != null) {
        entries.push({ field: 'Design enhancement: life review', oldValue: shown(row.actual_failure_pct), newValue: null, reason, stage: order.status });
      }
      if (!owed || row.final_verdict) {
        entries.push({ field: 'Design enhancement: final verdict', oldValue: row.final_verdict || null, newValue: owed ? null : verdict, reason, stage: order.status });
      }
      await insertChangeLog(client, orderId, entries, req.user);
      return { enhancement };
    });
    if (out.refused) return res.status(out.refused.status).json(out.refused.json);
    res.json({ enhancement: out.enhancement });
  } catch (error) {
    console.error('Save trial verdict error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// The die failure % life review: judged against all three targets, using the
// snapshot numbers plus the failure % now measured. Writes the final verdict.
router.post('/order/:orderId/life-review', pageAccessMiddleware('flow-sample-followup'), async (req, res) => {
  const orderId = parseOrderId(req.params.orderId);
  if (!orderId) return res.status(400).json({ error: 'Invalid order id' });
  const body = req.body || {};
  const failure = parseFailure(body.actual_failure_pct, 'actual_failure_pct');
  if (failure.error) return res.status(400).json({ error: failure.error });
  if (!VERDICTS.includes(body.verdict)) return res.status(400).json({ error: `verdict must be one of: ${VERDICTS.join(', ')}` });
  const verdict = body.verdict;
  const reason = reasonOf(body.reason);
  const today = todayLocal();

  try {
    const out = await withTransaction(async (client) => {
      const order = await lockOrder(client, orderId);
      if (!order) return notFound('Order not found');
      const found = await client.query('SELECT * FROM design_enhancements WHERE die_order_id = $1', [orderId]);
      const row = found.rows[0];
      if (!row) return notFound('This order is not a Design enhancement');
      if (!row.trial_verdict) return bad('Save the trial verdict before the life review');
      // A final verdict written by the trial verdict has no review behind it;
      // one written by a review (life_review_date set) may be redone.
      const reviewed = row.life_review_date != null;
      const owed = needsLifeReview({ ...row, final_verdict: null }, order);
      if (!owed || (row.final_verdict && !reviewed)) return bad('No life review is due for this order');
      const access = verdictAccess(req.user, reviewed, reason);
      if (!access.ok) return refusal(access);

      const suggested = suggestVerdict({
        targets: targetsOf(row, true),
        actuals: { failure: failure.value, productivity: num(row.trial_productivity_kgh), recovery: num(row.trial_recovery_pct) },
      });
      const ruled = remarkRule(verdict, suggested, body.remark);
      if (ruled.error) return bad(ruled.error);

      const by = req.user.username || null;
      const enhancement = await updateColumns(client, orderId, {
        actual_failure_pct: failure.value, life_review_remark: ruled.remark, life_review_by: by, life_review_date: today,
        final_verdict: verdict, final_verdict_remark: ruled.remark, final_verdict_by: by, final_verdict_date: today,
      });
      await insertChangeLog(client, orderId, [
        { field: 'Design enhancement: life review', oldValue: shown(row.actual_failure_pct), newValue: shown(failure.value), reason, stage: order.status },
        { field: 'Design enhancement: final verdict', oldValue: row.final_verdict || null, newValue: verdict, reason, stage: order.status },
      ], req.user);
      return { enhancement };
    });
    if (out.refused) return res.status(out.refused.status).json(out.refused.json);
    res.json({ enhancement: out.enhancement });
  } catch (error) {
    console.error('Save life review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
