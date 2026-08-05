'use strict';

// Aggregation for the supplier scorecard. Separate from the scoring model so
// the arithmetic stays testable without a database and the SQL stays in one
// place.

const { getDieLifeForPeriod } = require('./supplierDieLife.cjs');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (year, monthIdx) => new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

function periodRange({ year, month, frequency }) {
  const y = Number(year);
  const idx = MONTHS.indexOf(month);
  if (idx < 0) throw Object.assign(new Error(`Unknown month "${month}"`), { status: 400 });
  let startIdx;
  if (frequency === 'Monthly') startIdx = idx;
  else if (frequency === 'Quarterly') startIdx = idx - (idx % 3);
  else startIdx = 0; // YTD
  return {
    from: `${y}-${pad(startIdx + 1)}-01`,
    to: `${y}-${pad(idx + 1)}-${pad(lastDay(y, idx))}`,
  };
}

// Postgres returns numerics as strings; null must survive as null.
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// The die life table is keyed by (year, month), not by date. Deriving the month
// list from the range getSnapshot already has keeps its signature — and every
// caller, including getMonthlyTrend — untouched.
function monthsOfRange(from, to) {
  const year = Number(String(from).slice(0, 4));
  const first = Number(String(from).slice(5, 7));
  const last = Number(String(to).slice(5, 7));
  const months = [];
  for (let m = first; m <= last; m += 1) months.push(m);
  return { year, months };
}

async function getSnapshot(pool, { supplier, from, to }) {
  const args = [supplier, from, to];

  // Ordered-date metrics.
  const ordered = await pool.query(`
    SELECT count(*)                                             AS orders_placed,
           avg(design_received_date - ordered_date)
             FILTER (WHERE design_received_date >= ordered_date) AS design_lead_time,
           avg(NULLIF(no_of_trial, 0))                          AS trial_ratio,
           avg(design_revision_count)                           AS design_revisions
      FROM die_orders
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND ordered_date BETWEEN $2 AND $3`, args);

  // Received-date metrics: a die ordered in March and received in May is May's
  // delivery, so these key off the receipt date rather than the order date.
  const received = await pool.query(`
    SELECT avg(die_received_date - ordered_date)
             FILTER (WHERE die_received_date >= ordered_date)   AS delivery_lead_time,
           count(*)                                             AS dies_received
      FROM die_orders
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND die_received_date BETWEEN $2 AND $3`, args);

  const qd = await pool.query(`
    SELECT count(*) AS qd_count
      FROM quality_discrepancies
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND qd_requested_date BETWEEN $2 AND $3`, args);

  // Manually entered die life for the same months. Keyed by (year, month)
  // rather than by date, so the range is translated first.
  const { year, months } = monthsOfRange(from, to);
  const die = await getDieLifeForPeriod(pool, { supplier, year, months });

  const o = ordered.rows[0] || {};
  const r = received.rows[0] || {};
  const diesReceived = num(r.dies_received) || 0;
  const qdCount = num(qd.rows[0] && qd.rows[0].qd_count) || 0;

  return {
    dieLife: die.dieLife,
    dieFailure: die.dieFailure,
    ordersPlaced: num(o.orders_placed) || 0,
    designLeadTime: num(o.design_lead_time),
    trialRatio: num(o.trial_ratio),
    designRevisions: num(o.design_revisions),
    deliveryLeadTime: num(r.delivery_lead_time),
    // 0 QDs out of 0 dies is unknown, not a perfect 0%.
    qdRate: diesReceived > 0 ? (qdCount / diesReceived) * 100 : null,
  };
}

// One query set per month. Twelve small queries beat one clever grouped query
// that has to be re-read every time the metric list changes.
async function getMonthlyTrend(pool, { supplier, year, throughMonth }) {
  const last = MONTHS.indexOf(throughMonth);
  const out = [];
  for (let i = 0; i <= last; i += 1) {
    const { from, to } = periodRange({ year, month: MONTHS[i], frequency: 'Monthly' });
    // Sequential on purpose: these are cheap, and firing twelve concurrent
    // queries would just contend for the same small pool.
    out.push({ month: MONTHS[i], ...(await getSnapshot(pool, { supplier, from, to })) });
  }
  return out;
}

async function listSuppliers(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT btrim(supplier) AS name
      FROM die_orders
     WHERE supplier IS NOT NULL AND btrim(supplier) <> ''
     ORDER BY 1`);
  return rows.map(r => r.name);
}

module.exports = { MONTHS, periodRange, monthsOfRange, getSnapshot, getMonthlyTrend, listSuppliers };
