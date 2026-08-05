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

module.exports = { validateEntry, aggregateDieLife };
