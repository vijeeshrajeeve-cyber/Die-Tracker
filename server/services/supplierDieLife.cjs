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
  let run = 0, unloaded = 0, anyRun = false;
  let newR = 0, newT = 0, bkR = 0, bkT = 0;
  let newRows = 0, bkRows = 0;

  for (const r of rows || []) {
    const v = {};
    for (const f of COUNT_FIELDS) { v[f] = num(r[f]); add(f, v[f]); }

    if (v.tonnageMt !== null && v.diesScrapped !== null) {
      lifeT += v.tonnageMt; lifeS += v.diesScrapped; lifeRows += 1;
    }
    if (v.diesInService !== null) {
      run += v.diesInService; anyRun = true;
      unloaded += v.diesFailed === null ? 0 : v.diesFailed;
    }
    if (v.newDiesReceived !== null && v.newDieTrials !== null) { newR += v.newDiesReceived; newT += v.newDieTrials; newRows += 1; }
    if (v.backupDiesReceived !== null && v.backupDieTrials !== null) { bkR += v.backupDiesReceived; bkT += v.backupDieTrials; bkRows += 1; }
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
    // The sums the figures above were actually calculated from: only rows that
    // had both halves of a pair. Printing these beside a figure means the
    // counts always divide to it. Null when no row qualified.
    paired: {
      tonnageMt: lifeRows > 0 ? lifeT : null,
      diesScrapped: lifeRows > 0 ? lifeS : null,
      diesInService: anyRun ? run : null,
      diesFailed: anyRun ? unloaded : null,
      newDiesReceived: newRows > 0 ? newR : null,
      newDieTrials: newRows > 0 ? newT : null,
      backupDiesReceived: bkRows > 0 ? bkR : null,
      backupDieTrials: bkRows > 0 ? bkT : null,
    },
  };
}

// Postgres returns NUMERIC as a string; null must survive as null.
const countsOf = (r) => ({
  tonnageMt: num(r.tonnage_mt),
  diesScrapped: num(r.dies_scrapped),
  diesInService: num(r.dies_in_service),
  diesFailed: num(r.dies_failed),
  newDiesReceived: num(r.new_dies_received),
  newDieTrials: num(r.new_die_trials),
  backupDiesReceived: num(r.backup_dies_received),
  backupDieTrials: num(r.backup_die_trials),
});

const PLANT_COLUMNS = `d.supplier, d.plant, d.tonnage_mt, d.dies_scrapped, d.dies_in_service, d.dies_failed,
           d.new_dies_received, d.new_die_trials, d.backup_dies_received, d.backup_die_trials,
           d.updated_at, u.username AS updated_by_name`;

// 'all' sums every plant's row for a supplier into one row. Sums, never
// averages of per-plant ratios.
function sumBySupplier(dbRows) {
  const groups = new Map();
  for (const r of dbRows) {
    const key = String(r.supplier || '').trim().toUpperCase();
    if (!groups.has(key)) groups.set(key, { supplier: String(r.supplier).trim(), rows: [] });
    groups.get(key).rows.push(countsOf(r));
  }
  return [...groups.values()]
    .sort((a, b) => a.supplier.localeCompare(b.supplier))
    .map(({ supplier, rows }) => {
      const calculated = aggregateDieLife(rows);
      return { supplier, ...calculated.totals, calculated };
    });
}

// `rows` are the figures for the chosen plant (or summed across plants for
// 'all'); `legacy` are the old plant-less rows for that month, always returned
// and never part of any sum.
async function listDieLife(pool, { year, month, plant }) {
  const y = Number(year);
  const m = Number(month);
  const legacyRes = await pool.query(`
    SELECT d.id, d.supplier, d.avg_die_life_mt, d.dies_in_service, d.dies_failed, d.dies_scrapped
      FROM supplier_die_life d
     WHERE d.year = $1 AND d.month = $2 AND d.plant IS NULL
     ORDER BY d.supplier`, [y, m]);
  const legacy = legacyRes.rows.map((r) => ({
    id: r.id,
    supplier: r.supplier,
    avgDieLifeMt: num(r.avg_die_life_mt),
    diesInService: num(r.dies_in_service),
    diesFailed: num(r.dies_failed),
    diesScrapped: num(r.dies_scrapped),
  }));

  if (plant === 'all') {
    const { rows } = await pool.query(`
      SELECT d.supplier, d.plant, d.tonnage_mt, d.dies_scrapped, d.dies_in_service, d.dies_failed,
             d.new_dies_received, d.new_die_trials, d.backup_dies_received, d.backup_die_trials
        FROM supplier_die_life d
       WHERE d.year = $1 AND d.month = $2 AND d.plant IS NOT NULL
       ORDER BY d.supplier`, [y, m]);
    return { rows: sumBySupplier(rows), legacy };
  }

  const { rows } = await pool.query(`
    SELECT ${PLANT_COLUMNS}
      FROM supplier_die_life d
      LEFT JOIN users u ON u.id = d.updated_by
     WHERE d.year = $1 AND d.month = $2 AND d.plant = $3
     ORDER BY d.supplier`, [y, m, plant]);
  return {
    rows: rows.map((r) => {
      const counts = countsOf(r);
      return {
        supplier: r.supplier, plant: r.plant, ...counts,
        calculated: aggregateDieLife([counts]),
        updatedBy: r.updated_by_name || null,
        updatedAt: r.updated_at || null,
      };
    }),
    legacy,
  };
}

const ENTRY_COUNTS = [
  'tonnageMt', 'diesScrapped', 'diesInService', 'diesFailed',
  'newDiesReceived', 'newDieTrials', 'backupDiesReceived', 'backupDieTrials',
];

// Validate the plant and every entry first. A grid save is one action to the
// person doing it, so a bad row in the middle must not leave the earlier rows
// written and the later ones not; the writes then share one transaction.
async function saveDieLife(pool, { year, month, plant, entries }, userId) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw fail(400, 'A valid year and month are required');
  }
  const plantName = typeof plant === 'string' ? plant : '';
  if (!plantName.trim() || plantName === 'all') throw fail(400, 'Choose a plant to save figures for');
  const known = await pool.query('SELECT 1 FROM plants WHERE name = $1', [plantName]);
  if (!known.rows.length) throw fail(400, 'Choose a plant to save figures for');

  // The grid shows one plant at a time, but the message may be read away from
  // it, so it names the plant as well as the supplier.
  const clean = (entries || []).map((e) => {
    try {
      return validateEntry(e);
    } catch (err) {
      if (err && err.status === 400) err.message = `${plantName} - ${err.message}`;
      throw err;
    }
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of clean) {
      // Clearing every box is how a row is taken back out.
      if (ENTRY_COUNTS.every((f) => e[f] === null)) {
        await client.query(`
          DELETE FROM supplier_die_life
           WHERE upper(btrim(supplier)) = upper(btrim($1)) AND plant = $2 AND year = $3 AND month = $4`,
        [e.supplier, plantName, y, m]);
        continue;
      }
      await client.query(`
        INSERT INTO supplier_die_life
               (supplier, plant, year, month, tonnage_mt, dies_scrapped, dies_in_service, dies_failed,
                new_dies_received, new_die_trials, backup_dies_received, backup_die_trials, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (upper(btrim(supplier)), plant, year, month) WHERE plant IS NOT NULL DO UPDATE
           SET tonnage_mt           = EXCLUDED.tonnage_mt,
               dies_scrapped        = EXCLUDED.dies_scrapped,
               dies_in_service      = EXCLUDED.dies_in_service,
               dies_failed          = EXCLUDED.dies_failed,
               new_dies_received    = EXCLUDED.new_dies_received,
               new_die_trials       = EXCLUDED.new_die_trials,
               backup_dies_received = EXCLUDED.backup_dies_received,
               backup_die_trials    = EXCLUDED.backup_die_trials,
               updated_by           = EXCLUDED.updated_by,
               updated_at           = CURRENT_TIMESTAMP`,
      [e.supplier, plantName, y, m, e.tonnageMt, e.diesScrapped, e.diesInService, e.diesFailed,
        e.newDiesReceived, e.newDieTrials, e.backupDiesReceived, e.backupDieTrials, userId || null]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return listDieLife(pool, { year: y, month: m, plant: plantName });
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The label for the matrix's total row: the span it sums, from the first month
// with a row to the report month ("Jan-Nov"). A single month reads "Nov total".
function periodLabel(rows, throughMonth) {
  const months = (rows || []).map((r) => Number(r.month)).filter((m) => m >= 1 && m <= 12);
  if (!months.length) return 'Total';
  const first = Math.min(...months);
  const last = Number(throughMonth) >= first ? Number(throughMonth) : Math.max(...months);
  if (first === last) return `${SHORT_MONTHS[first - 1]} total`;
  return `${SHORT_MONTHS[first - 1]}-${SHORT_MONTHS[last - 1]}`;
}

// Only an old plant-less row can be removed this way; a figure that belongs to
// a plant is cleared from the grid.
async function deleteLegacyRow(pool, id) {
  const { rows } = await pool.query(
    'DELETE FROM supplier_die_life WHERE id = $1 AND plant IS NULL RETURNING id', [Number(id)]);
  return rows.length > 0;
}

// Legacy rows (no plant) are left out of every calculation.
const PERIOD_SQL = `
    SELECT month, plant, tonnage_mt, dies_scrapped, dies_in_service, dies_failed,
           new_dies_received, new_die_trials, backup_dies_received, backup_die_trials
      FROM supplier_die_life
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND plant IS NOT NULL
       AND year = $2 AND month = ANY($3)
     ORDER BY month`;

// One entry per month that has any row, the plants of that month summed
// together.
async function getDieLifeRows(pool, { supplier, year, months }) {
  const { rows } = await pool.query(PERIOD_SQL, [supplier, Number(year), months]);
  const byMonth = new Map();
  for (const r of rows) {
    const key = Number(r.month);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(countsOf(r));
  }
  return [...byMonth.entries()].sort((x, y) => x[0] - y[0])
    .map(([month, monthRows]) => ({ month, ...aggregateDieLife(monthRows) }));
}

// The whole period at once: summed counts, not a mean of the monthly figures.
async function getDieLifeForPeriod(pool, { supplier, year, months }) {
  const { rows } = await pool.query(PERIOD_SQL, [supplier, Number(year), months]);
  return aggregateDieLife(rows.map(countsOf));
}

module.exports = {
  validateEntry, aggregateDieLife, num,
  listDieLife, saveDieLife, deleteLegacyRow, periodLabel, getDieLifeRows, getDieLifeForPeriod,
};
