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

function validateEntry(entry) {
  const supplier = String((entry && entry.supplier) || '').trim();
  if (!supplier) throw fail(400, 'A supplier is required');

  const avgDieLifeMt = nullableNumber(entry.avgDieLifeMt, `${supplier}: die life`);
  const diesInService = nullableNumber(entry.diesInService, `${supplier}: dies in service`);
  const diesFailed = nullableNumber(entry.diesFailed, `${supplier}: dies failed`);

  // A failure count with no denominator cannot become a percentage. Leaving
  // both blank is the way to say "not recorded this month".
  if (diesFailed !== null && (diesInService === null || diesInService === 0)) {
    throw fail(400, `${supplier}: dies failed needs a dies in service count above zero — leave both blank if there is nothing to record`);
  }
  if (diesFailed !== null && diesInService !== null && diesFailed > diesInService) {
    throw fail(400, `${supplier}: more dies failed (${diesFailed}) than were in service (${diesInService})`);
  }

  return { supplier, avgDieLifeMt, diesInService, diesFailed };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Weighted by dies in service, so a month with 40 dies counts ten times a month
// with 4. Failure pools the raw counts rather than averaging percentages, which
// would give a quiet month equal say.
function aggregateDieLife(rows) {
  let failed = 0;
  let inService = 0;
  let weightedSum = 0;
  let weight = 0;
  const unweighted = [];

  for (const r of rows || []) {
    const svc = num(r.diesInService);
    const bad = num(r.diesFailed);
    const life = num(r.avgDieLifeMt);

    if (svc !== null) {
      inService += svc;
      if (bad !== null) failed += bad;
    }
    if (life !== null) {
      unweighted.push(life);
      if (svc !== null && svc > 0) {
        weightedSum += life * svc;
        weight += svc;
      }
    }
  }

  // 0 dies failed out of 0 in service is unknown, not a flattering 0%. Same
  // reasoning the QD Rate already applies to 0 QDs out of 0 dies received.
  const dieFailure = inService > 0 ? (failed / inService) * 100 : null;

  // Validation permits a die life figure with no counts, so the weighted mean
  // must not be the only path — with no weights it would divide by zero and
  // throw away a number somebody typed.
  let dieLife = null;
  if (weight > 0) dieLife = weightedSum / weight;
  else if (unweighted.length) dieLife = unweighted.reduce((a, b) => a + b, 0) / unweighted.length;

  return { dieLife, dieFailure };
}

// Postgres returns NUMERIC as a string; null must survive as null.
const toRow = (r) => ({
  supplier: r.supplier,
  avgDieLifeMt: num(r.avg_die_life_mt),
  diesInService: num(r.dies_in_service),
  diesFailed: num(r.dies_failed),
  updatedBy: r.updated_by_name || null,
  updatedAt: r.updated_at || null,
});

async function listDieLife(pool, { year, month }) {
  const { rows } = await pool.query(`
    SELECT d.supplier, d.avg_die_life_mt, d.dies_in_service, d.dies_failed,
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
             (supplier, year, month, avg_die_life_mt, dies_in_service, dies_failed, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (supplier, year, month) DO UPDATE
         SET avg_die_life_mt = EXCLUDED.avg_die_life_mt,
             dies_in_service = EXCLUDED.dies_in_service,
             dies_failed     = EXCLUDED.dies_failed,
             updated_by      = EXCLUDED.updated_by,
             updated_at      = CURRENT_TIMESTAMP`,
      [e.supplier, y, m, e.avgDieLifeMt, e.diesInService, e.diesFailed, userId || null]);
  }
  return listDieLife(pool, { year: y, month: m });
}

async function getDieLifeRows(pool, { supplier, year, months }) {
  const { rows } = await pool.query(`
    SELECT month, avg_die_life_mt, dies_in_service, dies_failed
      FROM supplier_die_life
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND year = $2 AND month = ANY($3)
     ORDER BY month`, [supplier, Number(year), months]);
  return rows.map((r) => ({
    month: Number(r.month),
    avgDieLifeMt: num(r.avg_die_life_mt),
    diesInService: num(r.dies_in_service),
    diesFailed: num(r.dies_failed),
  }));
}

async function getDieLifeForPeriod(pool, { supplier, year, months }) {
  return aggregateDieLife(await getDieLifeRows(pool, { supplier, year, months }));
}

module.exports = {
  validateEntry, aggregateDieLife,
  listDieLife, saveDieLife, getDieLifeRows, getDieLifeForPeriod,
};
