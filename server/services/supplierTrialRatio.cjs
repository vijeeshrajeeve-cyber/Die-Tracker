'use strict';

// The trial ratio is calculated from die_orders: the average number of trials
// over the dies ordered in a month that have a trial count. This module adds an
// admin correction on top of that figure, for months where the calculated
// number is known to be wrong.
//
// A correction never edits the orders and never replaces the calculation. It is
// one row in a log -- what the figure was, what it was changed to, who changed
// it and why -- and the latest row for a supplier and month is the one in force.
// Removing a correction is itself a logged row (corrected_value NULL), so the
// history is never overwritten.

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const keyOf = (supplier) => String(supplier || '').trim().toUpperCase();

// Per supplier and month: the calculated ratio and how many dies it rests on.
// The die count is what lets several months be combined without giving a month
// with one die the same say as a month with thirty.
async function calculatedByMonth(pool, { year, months, supplier }) {
  const params = [Number(year), months];
  let only = '';
  if (supplier) { params.push(supplier); only = 'AND upper(btrim(supplier)) = upper(btrim($3))'; }
  const { rows } = await pool.query(`
    SELECT upper(btrim(supplier))                 AS supplier_key,
           EXTRACT(MONTH FROM ordered_date)::int  AS month,
           avg(NULLIF(no_of_trial, 0))            AS ratio,
           count(NULLIF(no_of_trial, 0))          AS dies
      FROM die_orders
     WHERE EXTRACT(YEAR FROM ordered_date) = $1
       AND EXTRACT(MONTH FROM ordered_date) = ANY($2)
       AND supplier IS NOT NULL
       ${only}
     GROUP BY 1, 2`, params);
  return rows.map((r) => ({
    supplierKey: r.supplier_key, month: Number(r.month), ratio: num(r.ratio), dies: num(r.dies) || 0,
  }));
}

// The correction in force for each supplier and month. A latest row whose
// corrected_value is NULL means the correction was removed, so it is dropped.
async function activeCorrections(pool, { year, months, supplier }) {
  const params = [Number(year), months];
  let only = '';
  if (supplier) { params.push(supplier); only = 'AND upper(btrim(c.supplier)) = upper(btrim($3))'; }
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (upper(btrim(c.supplier)), c.month)
           upper(btrim(c.supplier)) AS supplier_key, c.month,
           c.corrected_value, c.calculated_value, c.reason, c.changed_at,
           u.username AS changed_by_name
      FROM supplier_trial_ratio_corrections c
      LEFT JOIN users u ON u.id = c.changed_by
     WHERE c.year = $1 AND c.month = ANY($2)
       ${only}
     ORDER BY upper(btrim(c.supplier)), c.month, c.id DESC`, params);
  return rows
    .filter((r) => num(r.corrected_value) !== null)
    .map((r) => ({
      supplierKey: r.supplier_key,
      month: Number(r.month),
      value: num(r.corrected_value),
      reason: r.reason || '',
      changedBy: r.changed_by_name || null,
      changedAt: r.changed_at || null,
    }));
}

// One period figure from monthly figures, with corrections applied. Weighted by
// the dies behind each month, which makes it equal to the plain average over
// every die when nothing is corrected. A corrected month with no dies of its
// own still counts, with the weight of a single die -- somebody typed it.
function combineTrialRatio(monthly, corrections) {
  const fixed = new Map((corrections || []).map((c) => [c.month, c.value]));
  const seen = new Set();
  let sum = 0;
  let weight = 0;
  for (const m of monthly || []) {
    seen.add(m.month);
    const value = fixed.has(m.month) ? fixed.get(m.month) : m.ratio;
    const w = m.dies > 0 ? m.dies : (fixed.has(m.month) ? 1 : 0);
    if (value === null || value === undefined || w === 0) continue;
    sum += value * w;
    weight += w;
  }
  for (const [month, value] of fixed) {
    if (seen.has(month)) continue;
    sum += value;
    weight += 1;
  }
  return weight > 0 ? sum / weight : null;
}

// The Die Life Data grid: every supplier with a calculated or corrected figure
// for the month.
async function listTrialRatios(pool, { year, month }) {
  const months = [Number(month)];
  const calc = await calculatedByMonth(pool, { year, months });
  const fixes = await activeCorrections(pool, { year, months });
  const out = new Map();
  for (const c of calc) {
    out.set(c.supplierKey, { supplierKey: c.supplierKey, calculated: c.ratio, dies: c.dies, corrected: null });
  }
  for (const f of fixes) {
    const row = out.get(f.supplierKey) || { supplierKey: f.supplierKey, calculated: null, dies: 0 };
    out.set(f.supplierKey, {
      ...row, corrected: f.value, reason: f.reason, correctedBy: f.changedBy, correctedAt: f.changedAt,
    });
  }
  return [...out.values()];
}

// value null (or blank) removes the correction and goes back to the calculated
// figure. Either way a reason is required: the point of the log is the why.
async function saveCorrection(pool, { supplier, year, month, value, reason }, userId) {
  const name = String(supplier || '').trim();
  const y = Number(year);
  const m = Number(month);
  const why = String(reason || '').trim();
  if (!name) throw fail(400, 'A supplier is required');
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw fail(400, 'A valid year and month are required');
  }
  if (!why) throw fail(400, 'A reason for the change is required');

  let corrected = null;
  if (value !== null && value !== undefined && value !== '') {
    corrected = Number(value);
    if (!Number.isFinite(corrected)) throw fail(400, 'Trial ratio must be a number');
    if (corrected < 0) throw fail(400, 'Trial ratio cannot be negative');
  }

  const calc = await calculatedByMonth(pool, { year: y, months: [m], supplier: name });
  const calculated = calc.length ? calc[0].ratio : null;

  await pool.query(`
    INSERT INTO supplier_trial_ratio_corrections
           (supplier, year, month, calculated_value, corrected_value, reason, changed_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [name, y, m, calculated, corrected, why, userId || null]);

  return listTrialRatios(pool, { year: y, month: m });
}

module.exports = {
  keyOf, calculatedByMonth, activeCorrections, combineTrialRatio,
  listTrialRatios, saveCorrection,
};
