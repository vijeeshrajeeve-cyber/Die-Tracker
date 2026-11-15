'use strict';

// One row per trial of a die sample.
//
// Sample Followup used to carry a single hand-typed `no_of_trial` integer. That
// number could not say when a trial ran, whether it passed, or why it failed —
// so the reason a die needed five trials lived only in somebody's memory. Each
// trial is its own row here for the same reason FOC rounds are their own rows
// in qdFocRounds.cjs: the history is the evidence.
//
// This module owns the vocabulary and the rules. It never decides Sample
// Status — a failed trial does not reject a sample; a person does.


const { parseNumber, isBlank } = require('./designEnhancement.cjs');

const TRIAL_RESULTS = ['OK', 'Not OK'];

// Fixed, and stored verbatim in the fail_reason column. Changing a string here
// is a data migration, not an edit. `Other` exists so a novel failure is never
// mis-filed under a reason that does not fit; the explanation goes in comments.
const FAIL_REASONS = [
  'Shape',
  'Dimension Out of Spec',
  'Aesthetic Out of Spec',
  'Die Choked',
  'Manufacturing issue',
  'Other',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Accepts ISO, ISO-with-time, and DD/MM/YYYY — the three shapes that reach this
// app, since older followup dates were imported from spreadsheets.
function normaliseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (iso) return iso[1];
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

const trim = (v) => (v === null || v === undefined ? '' : String(v).trim());

// `today` is an ISO day string so the caller decides what "today" means and the
// rule stays testable. ISO dates compare correctly as strings.
// On an enhancement die the two measured numbers ride on the trial. A blank is
// null, never 0. A routine die ignores them entirely, so nothing a stale form
// sends can leak into a routine trial. Same number rules as the baseline.
function trialNumber(input, key, pct, required) {
  const raw = input[key];
  if (isBlank(raw)) {
    return required ? { error: `${key} is required for an OK trial on an enhancement die` } : { value: null };
  }
  const n = parseNumber(raw);
  if (Number.isNaN(n)) return { error: `${key} must be a number of 0 or more` };
  if (pct && n > 100) return { error: `${key} cannot be more than 100` };
  return { value: n };
}

function validateTrial(input = {}, today, { enhancement = false } = {}) {
  const trial_date = normaliseDate(input.trial_date);
  if (!trial_date) return { ok: false, error: 'A valid trial date is required' };
  if (today && trial_date > today) {
    return { ok: false, error: 'Trial date cannot be in the future' };
  }

  const result = trim(input.result);
  if (!TRIAL_RESULTS.includes(result)) {
    return { ok: false, error: `Result must be one of: ${TRIAL_RESULTS.join(', ')}` };
  }

  // A reason is required precisely when the trial failed, and meaningless when
  // it passed — so an OK trial silently drops any reason rather than erroring,
  // which is what happens when someone picks Not OK, chooses a reason, then
  // switches back to OK.
  let fail_reason = null;
  if (result === 'Not OK') {
    fail_reason = trim(input.fail_reason);
    if (!fail_reason) return { ok: false, error: 'A reason is required when the result is Not OK' };
    if (!FAIL_REASONS.includes(fail_reason)) {
      return { ok: false, error: `Reason must be one of: ${FAIL_REASONS.join(', ')}` };
    }
  }

  const comments = trim(input.comments).slice(0, 2000) || null;

  let productivity_kgh = null;
  let recovery_pct = null;
  if (enhancement) {
    const required = result === 'OK';
    const p = trialNumber(input, 'productivity_kgh', false, required);
    if (p.error) return { ok: false, error: p.error };
    const r = trialNumber(input, 'recovery_pct', true, required);
    if (r.error) return { ok: false, error: r.error };
    productivity_kgh = p.value;
    recovery_pct = r.value;
  }

  return { ok: true, value: { trial_date, result, fail_reason, comments, productivity_kgh, recovery_pct } };
}

function nextTrialNo(trials) {
  return (trials || []).reduce((max, t) => Math.max(max, Number(t.trial_no) || 0), 0) + 1;
}

const TRIAL_COLS = [
  'id', 'die_order_id', 'sample_followup_id', 'trial_no',
  'trial_date', 'result', 'fail_reason', 'comments', 'created_by', 'created_at',
  'productivity_kgh', 'recovery_pct',
].join(', ');

// Exactly one parent, matching the sample_trials_one_parent check constraint.
// Returning null rather than throwing keeps the route's error handling in one
// place.
function parentRef(input = {}) {
  const order = Number(input.die_order_id) || null;
  const followup = Number(input.sample_followup_id) || null;
  if (order && followup) return null;
  if (order) return { column: 'die_order_id', id: order };
  if (followup) return { column: 'sample_followup_id', id: followup };
  return null;
}

async function listTrials(client) {
  const { rows } = await client.query(
    `SELECT ${TRIAL_COLS} FROM sample_trials ORDER BY trial_no ASC, id ASC`
  );
  return rows;
}

async function trialsForParent(client, parent) {
  const { rows } = await client.query(
    `SELECT ${TRIAL_COLS} FROM sample_trials WHERE ${parent.column} = $1 ORDER BY trial_no ASC`,
    [parent.id]
  );
  return rows;
}

// Only a die order can be an enhancement; a standalone followup never is.
async function isEnhancementParent(client, parent) {
  if (parent.column !== 'die_order_id') return false;
  const { rows } = await client.query('SELECT design_enhancement FROM die_orders WHERE id = $1', [parent.id]);
  return rows.length > 0 && Number(rows[0].design_enhancement) === 1;
}

// A measured OK trial is the evidence an enhancement die needs before approval.
async function hasMeasuredOkTrial(client, orderId) {
  const { rows } = await client.query(
    `SELECT 1 FROM sample_trials
      WHERE die_order_id = $1 AND result = 'OK'
        AND productivity_kgh IS NOT NULL AND recovery_pct IS NOT NULL
      LIMIT 1`,
    [orderId]
  );
  return rows.length > 0;
}

async function createTrial(client, input, userId, today) {
  const parent = parentRef(input);
  if (!parent) {
    return { ok: false, status: 400, error: 'A trial must belong to exactly one die record' };
  }
  const check = validateTrial(input, today, { enhancement: await isEnhancementParent(client, parent) });
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  // trial_no is assigned here and never accepted from the client, so two people
  // adding a trial at once cannot both claim the same number. The partial
  // unique index is the backstop if they race.
  const existing = await trialsForParent(client, parent);
  const trial_no = nextTrialNo(existing);
  const { trial_date, result, fail_reason, comments, productivity_kgh, recovery_pct } = check.value;

  const { rows } = await client.query(
    `INSERT INTO sample_trials (${parent.column}, trial_no, trial_date, result, fail_reason, comments, created_by,
                                productivity_kgh, recovery_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${TRIAL_COLS}`,
    [parent.id, trial_no, trial_date, result, fail_reason, comments, userId, productivity_kgh, recovery_pct]
  );
  return { ok: true, row: rows[0] };
}

// The parent is never changed by an edit — a trial cannot move to another die.
async function updateTrial(client, id, input, today) {
  const found = await client.query('SELECT die_order_id FROM sample_trials WHERE id = $1', [id]);
  if (!found.rows.length) return { ok: false, status: 404, error: 'Trial not found' };
  const orderId = found.rows[0].die_order_id;
  const enhancement = orderId ? await isEnhancementParent(client, { column: 'die_order_id', id: orderId }) : false;

  const check = validateTrial(input, today, { enhancement });
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  const { trial_date, result, fail_reason, comments, productivity_kgh, recovery_pct } = check.value;

  const { rows, rowCount } = await client.query(
    `UPDATE sample_trials
        SET trial_date = $1, result = $2, fail_reason = $3, comments = $4,
            productivity_kgh = $5, recovery_pct = $6,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING ${TRIAL_COLS}`,
    [trial_date, result, fail_reason, comments, productivity_kgh, recovery_pct, id]
  );
  if (!rowCount) return { ok: false, status: 404, error: 'Trial not found' };
  return { ok: true, row: rows[0] };
}

async function deleteTrial(client, id) {
  const { rowCount } = await client.query('DELETE FROM sample_trials WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  TRIAL_RESULTS, FAIL_REASONS, ISO_DATE, TRIAL_COLS,
  normaliseDate, validateTrial, nextTrialNo,
  parentRef, hasMeasuredOkTrial, listTrials, trialsForParent, createTrial, updateTrial, deleteTrial,
};
