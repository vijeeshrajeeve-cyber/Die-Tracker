'use strict';

// Manual monthly die life capture. Nothing in this system records tonnage
// extruded or dies failing before rated life, so these numbers are typed in.
//
// Kept separate from supplierPerformanceData.cjs on purpose: that module runs
// read-only aggregation queries, this one owns validation, attribution and
// upserts. Different jobs, different failure modes.
//
// See docs/superpowers/specs/2026-08-05-die-life-failure-and-report-pdf-design.md.

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// A blank box is "not recorded" and must stay null. A typed 0 is a real zero.
// Collapsing the two would score an unrecorded die life as 0 MT and rate a
// supplier "At risk" on a 25% weight for data nobody collected.
function nullableNumber(raw, label) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw fail(400, `${label} must be a number`);
  if (n < 0) throw fail(400, `${label} cannot be negative`);
  return n;
}

// The six die counts are whole numbers; tonnage may carry decimals.
function nullableCount(raw, label) {
  const n = nullableNumber(raw, label);
  if (n !== null && !Number.isInteger(n)) throw fail(400, `${label} must be a whole number`);
  return n;
}

// Plant is validated in saveDieLife. See
// docs/superpowers/specs/2026-11-15-die-life-by-plant-design.md ("Rules").
function validateEntry(entry) {
  const supplier = String((entry && entry.supplier) || '').trim();
  if (!supplier) throw fail(400, 'A supplier is required');

  const tonnageMt = nullableNumber(entry.tonnageMt, `${supplier}: tonnage (MT)`);
  const diesScrapped = nullableCount(entry.diesScrapped, `${supplier}: dies scrapped`);
  const diesInService = nullableCount(entry.diesInService, `${supplier}: dies run`);
  const diesFailed = nullableCount(entry.diesFailed, `${supplier}: dies unloaded`);
  const newDiesReceived = nullableCount(entry.newDiesReceived, `${supplier}: new dies received`);
  const newDieTrials = nullableCount(entry.newDieTrials, `${supplier}: new die trials`);
  const backupDiesReceived = nullableCount(entry.backupDiesReceived, `${supplier}: backup dies received`);
  const backupDieTrials = nullableCount(entry.backupDieTrials, `${supplier}: backup die trials`);

  // A count with no denominator cannot become a ratio. Leaving both blank is
  // the way to say "not recorded this month".
  if (diesFailed !== null && (diesInService === null || diesInService === 0)) {
    throw fail(400, `${supplier}: dies unloaded needs a dies run count above zero — leave both blank if there is nothing to record`);
  }
  if (diesFailed !== null && diesFailed > diesInService) {
    throw fail(400, `${supplier}: more dies unloaded (${diesFailed}) than dies run (${diesInService})`);
  }
  if (newDieTrials !== null && (newDiesReceived === null || newDiesReceived === 0)) {
    throw fail(400, `${supplier}: new die trials needs a new dies received count above zero`);
  }
  if (backupDieTrials !== null && (backupDiesReceived === null || backupDiesReceived === 0)) {
    throw fail(400, `${supplier}: backup die trials needs a backup dies received count above zero`);
  }

  return {
    supplier, tonnageMt, diesScrapped, diesInService, diesFailed,
    newDiesReceived, newDieTrials, backupDiesReceived, backupDieTrials,
  };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const COUNT_FIELDS = [
  'tonnageMt', 'diesScrapped', 'diesInService', 'diesFailed',
  'newDiesReceived', 'newDieTrials', 'backupDiesReceived', 'backupDieTrials',
];

// Every figure comes from summed counts, never from averaging monthly or
// per-plant ratios. A null input is "not recorded" and is never summed as 0.
function aggregateDieLife(rows) {
  const totals = {};
  for (const f of COUNT_FIELDS) totals[f] = null;
  const add = (key, v) => { if (v !== null) totals[key] = (totals[key] || 0) + v; };

  let lifeT = 0, lifeS = 0, lifeRows = 0;
  let run = 0, unloaded = 0;
  let newR = 0, newT = 0, bkR = 0, bkT = 0;

  for (const r of rows || []) {
    const v = {};
    for (const f of COUNT_FIELDS) { v[f] = num(r[f]); add(f, v[f]); }

    if (v.tonnageMt !== null && v.diesScrapped !== null) {
      lifeT += v.tonnageMt; lifeS += v.diesScrapped; lifeRows += 1;
    }
    if (v.diesInService !== null) {
      run += v.diesInService;
      unloaded += v.diesFailed === null ? 0 : v.diesFailed;
    }
    if (v.newDiesReceived !== null && v.newDieTrials !== null) { newR += v.newDiesReceived; newT += v.newDieTrials; }
    if (v.backupDiesReceived !== null && v.backupDieTrials !== null) { bkR += v.backupDiesReceived; bkT += v.backupDieTrials; }
  }

  const noDiesScrapped = lifeRows > 0 && lifeS === 0;
  const dieLife = lifeRows > 0 && lifeS > 0 ? lifeT / lifeS : null;
  // 0 unloaded out of 0 run is unknown, not a flattering 0%.
  const dieFailure = run > 0 ? (unloaded / run) * 100 : null;
  const ratio = (t, d) => (d > 0 ? t / d : null);

  return {
    dieLife, noDiesScrapped, dieFailure,
    newTrialRatio: ratio(newT, newR),
    backupTrialRatio: ratio(bkT, bkR),
    trialRatio: ratio(newT + bkT, newR + bkR),
    totals,
  };
}

// Postgres returns NUMERIC as a string; null must survive as null.
const toRow = (r) => ({
  supplier: r.supplier,
  avgDieLifeMt: num(r.avg_die_life_mt),
  diesInService: num(r.dies_in_service),
  diesFailed: num(r.dies_failed),
  diesScrapped: num(r.dies_scrapped),
  updatedBy: r.updated_by_name || null,
  updatedAt: r.updated_at || null,
});

async function listDieLife(pool, { year, month }) {
  const { rows } = await pool.query(`
    SELECT d.supplier, d.avg_die_life_mt, d.dies_in_service, d.dies_failed, d.dies_scrapped,
           d.updated_at, u.username AS updated_by_name
      FROM supplier_die_life d
      LEFT JOIN users u ON u.id = d.updated_by
     WHERE d.year = $1 AND d.month = $2
     ORDER BY d.supplier`, [Number(year), Number(month)]);
  return rows.map(toRow);
}

// Validate every entry first. A grid save is one action to the person doing it,
// so a bad row in the middle must not leave the earlier rows written and the
// later ones not.
async function saveDieLife(pool, { year, month, entries }, userId) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw fail(400, 'A valid year and month are required');
  }
  const clean = (entries || []).map(validateEntry);

  for (const e of clean) {
    await pool.query(`
      INSERT INTO supplier_die_life
             (supplier, year, month, avg_die_life_mt, dies_in_service, dies_failed, dies_scrapped, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (supplier, year, month) DO UPDATE
         SET avg_die_life_mt = EXCLUDED.avg_die_life_mt,
             dies_in_service = EXCLUDED.dies_in_service,
             dies_failed     = EXCLUDED.dies_failed,
             dies_scrapped   = EXCLUDED.dies_scrapped,
             updated_by      = EXCLUDED.updated_by,
             updated_at      = CURRENT_TIMESTAMP`,
      [e.supplier, y, m, null, e.diesInService, e.diesFailed, e.diesScrapped, userId || null]);
  }
  return listDieLife(pool, { year: y, month: m });
}

// Legacy rows (no plant) are left out of every calculation.
async function getDieLifeRows(pool, { supplier, year, months }) {
  const { rows } = await pool.query(`
    SELECT month, plant, tonnage_mt, dies_scrapped, dies_in_service, dies_failed,
           new_dies_received, new_die_trials, backup_dies_received, backup_die_trials
      FROM supplier_die_life
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND plant IS NOT NULL
       AND year = $2 AND month = ANY($3)
     ORDER BY month`, [supplier, Number(year), months]);
  return rows.map((r) => ({
    month: Number(r.month),
    plant: r.plant,
    tonnageMt: num(r.tonnage_mt),
    diesScrapped: num(r.dies_scrapped),
    diesInService: num(r.dies_in_service),
    diesFailed: num(r.dies_failed),
    newDiesReceived: num(r.new_dies_received),
    newDieTrials: num(r.new_die_trials),
    backupDiesReceived: num(r.backup_dies_received),
    backupDieTrials: num(r.backup_die_trials),
  }));
}

async function getDieLifeForPeriod(pool, { supplier, year, months }) {
  return aggregateDieLife(await getDieLifeRows(pool, { supplier, year, months }));
}

module.exports = {
  validateEntry, aggregateDieLife, num,
  listDieLife, saveDieLife, getDieLifeRows, getDieLifeForPeriod,
};
