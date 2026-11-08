'use strict';
// Corpus check of the finder's geometry against the die list's own links: for
// every (die, linked tooling) pair where the die has a true-size profile and the
// tooling an opening, does the profile fit the tooling's pockets?
//   node server/scripts/check-finder-fit.cjs --plant "GEX 1" [--confidence confirmed,likely] [--limit N] [--out report.json]
// Geometry only: no cavity, chart or size gate is applied. Each pair records
// whether the size pre-filter (at MIN_CLEARANCE_MM) and the pocket-count gate
// would have passed it, so the summary shows what those gates cost. Read-only (one SELECT).

const fs = require('node:fs');
const {
  candidateFromRow, fitCandidate, profileStats, passesSizePrefilter, MIN_CLEARANCE_MM,
} = require('../services/toolingFinder.cjs');
const { resampleClosed, bestPlacement, signedDistanceGrid, DEFAULTS } = require('../services/fitGeometry.cjs');
const { centroid } = require('../services/openingGeometry.cjs');

const PAIRS_SQL = `SELECT DISTINCT ON (l.die_no, t.number)
    l.die_no, t.id, t.number, t.kind, t.plant, t.held_presses, t.size_class, t.size_class_confidence,
    t.cavities, t.location, t.status, o.pockets, o.confidence, o.pocket_gap_mm,
    p.outer_mm, p.cavities AS die_cavities
  FROM die_tooling_links l
  JOIN toolings t ON t.number = l.tooling_number
  JOIN tooling_openings o ON o.tooling_id = t.id
  JOIN LATERAL (
    SELECT ps.outer_mm, ps.cavities FROM profile_shapes ps
    WHERE ps.die_no = l.die_no AND ps.plant = t.plant AND ps.true_size
    ORDER BY ps.updated_at DESC LIMIT 1
  ) p ON true
  WHERE t.plant = $1 AND t.status = 'active' AND o.confidence = ANY($2) AND o.pockets IS NOT NULL
  ORDER BY l.die_no, t.number
  LIMIT $3`;

// ---- pure helpers (tested) -------------------------------------------------

// Linear interpolation between closest ranks (as percentile_cont); null when empty.
function percentile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

// A failed pair's worst-pocket exact clearance: outside the pocket, or inside but too tight.
function bucketOf(exact, min = MIN_CLEARANCE_MM) {
  if (exact == null || !Number.isFinite(exact)) return 'unmeasured';
  if (exact < 0) return 'outside (<0)';
  if (exact < min) return `too tight (0-${min})`;
  return `measured >= ${min}`; // the gated search found none, the diagnostic search did
}

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const rate = (pass, n) => (n ? round((100 * pass) / n, 1) : null);

function group(records, keyOf) {
  const out = {};
  for (const r of records) {
    const k = keyOf(r);
    if (!out[k]) out[k] = { pairs: 0, passes: 0 };
    out[k].pairs++;
    if (r.clearance != null) out[k].passes++;
  }
  for (const k of Object.keys(out)) out[k].passRate = rate(out[k].passes, out[k].pairs);
  return out;
}

const pct3 = (vals) => ({ p10: round(percentile(vals, 0.1)), p50: round(percentile(vals, 0.5)), p90: round(percentile(vals, 0.9)) });
const worstFirst = (a, b) => (a.exactClearance ?? -Infinity) - (b.exactClearance ?? -Infinity);
const brief = (r) => ({
  dieNo: r.dieNo, tooling: r.tooling, kind: r.kind, dieCavities: r.dieCavities, toolingCavities: r.toolingCavities,
  pockets: r.pockets, exactClearance: round(r.exactClearance), worstPocket: r.worstPocket,
});

// What a gate (a record field that is false when the gate would reject) would
// take out: fitting pairs it would lose, non-fitting pairs it would pre-reject.
function gateCost(records, field) {
  const rejects = records.filter((r) => r[field] === false);
  return {
    rejectsFits: rejects.filter((r) => r.clearance != null).length,
    rejectsNonFits: rejects.filter((r) => r.clearance == null).length,
    unknown: records.filter((r) => r[field] == null).length,
  };
}

function buildSummary(records, { plant = null, confidences = [], min = MIN_CLEARANCE_MM } = {}) {
  const passes = records.filter((r) => r.clearance != null);
  const fails = records.filter((r) => r.clearance == null);
  const known = records.filter((r) => r.dieCavities != null && r.toolingCavities != null);
  const agree = known.filter((r) => r.dieCavities === r.toolingCavities);
  const confAgree = agree.filter((r) => r.confidence === 'confirmed');
  const failures = {};
  for (const r of fails) {
    const k = r.reason || 'unknown';
    if (!failures[k]) failures[k] = { count: 0, buckets: {} };
    failures[k].count++;
    const b = bucketOf(r.exactClearance, min);
    failures[k].buckets[b] = (failures[k].buckets[b] || 0) + 1;
  }
  const ms = records.map((r) => r.ms).filter(Number.isFinite);
  const confirmedFails = fails.filter((r) => r.confidence === 'confirmed').sort(worstFirst);
  const size = gateCost(records, 'passesSizePrefilter');
  const count = gateCost(records, 'pocketCountMatches');
  return {
    plant,
    confidences,
    pairs: records.length,
    passes: passes.length,
    passRate: rate(passes.length, records.length),
    byConfidence: group(records, (r) => r.confidence),
    byKind: group(records, (r) => r.kind),
    clearanceOfPasses: { ...pct3(passes.map((r) => r.clearance)), capped: passes.filter((r) => r.clearanceCapped).length },
    rawClearanceOfPasses: pct3(passes.map((r) => r.rawClearance)),
    cavities: {
      bothKnown: known.length,
      agree: agree.length,
      disagree: known.length - agree.length,
      unknown: records.length - known.length,
      passRateAgreeing: rate(agree.filter((r) => r.clearance != null).length, agree.length),
      passRateDisagreeing: rate(known.filter((r) => r.dieCavities !== r.toolingCavities && r.clearance != null).length, known.length - agree.length),
      confirmedAgreeing: confAgree.length,
      passRateConfirmedAgreeing: rate(confAgree.filter((r) => r.clearance != null).length, confAgree.length),
    },
    failures,
    gates: {
      sizePrefilterRejectsFits: size.rejectsFits,
      sizePrefilterRejectsNonFits: size.rejectsNonFits,
      sizePrefilterUnknown: size.unknown,
      pocketCountRejectsFits: count.rejectsFits,
      pocketCountRejectsNonFits: count.rejectsNonFits,
      pocketCountUnknown: count.unknown,
    },
    msPerFit: { mean: ms.length ? round(ms.reduce((s, x) => s + x, 0) / ms.length) : null, max: ms.length ? round(Math.max(...ms)) : null },
    worstConfirmedFailures: confirmedFails.slice(0, 20).map(brief),
    worstConfirmedAgreeingFailures: confirmedFails.filter((r) => r.dieCavities != null && r.dieCavities === r.toolingCavities).slice(0, 20).map(brief),
  };
}

// ---- per pair ----------------------------------------------------------------

const jsonOf = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// findToolings' recentre (not exported there): the outer centroid goes to the origin.
function recentreOuter(outer) {
  const [cx, cy] = centroid(outer);
  return outer.map(([x, y]) => [x - cx, y - cy]);
}

// fitCandidate stops at the first failing pocket and returns no clearance, so the
// diagnostic measures every pocket with the gate off and keeps the worst. Grids
// go on the candidate as fitCandidate's do, so later pairs reuse them.
function worstPocket(candidate, profilePts) {
  let worst = null;
  candidate.pockets.forEach((pocket, i) => {
    if (!candidate.grids[i]) candidate.grids[i] = signedDistanceGrid(pocket, { cellMm: DEFAULTS.cellMm });
    const fit = bestPlacement(profilePts, pocket, { minClearance: -Infinity, grid: candidate.grids[i] });
    if (fit && (!worst || fit.clearance < worst.clearance)) worst = { clearance: fit.clearance, index: i };
  });
  return worst;
}

function checkPair(row, candidate) {
  const base = {
    dieNo: row.die_no, tooling: row.number, kind: row.kind, confidence: row.confidence,
    dieCavities: row.die_cavities == null ? null : Number(row.die_cavities),
    toolingCavities: candidate.cavities, pockets: candidate.pockets.length,
    // null when the tooling's cavities are unknown (narrow rejects those earlier, as cavities-unknown)
    pocketCountMatches: candidate.cavities == null ? null : candidate.pockets.length === candidate.cavities,
  };
  const outer = jsonOf(row.outer_mm);
  if (!Array.isArray(outer) || outer.length < 3) {
    return {
      ...base, passesSizePrefilter: null, clearance: null, rawClearance: null, reason: 'bad-profile', ms: null, exactClearance: null, worstPocket: null,
    };
  }
  const centred = recentreOuter(outer);
  base.passesSizePrefilter = candidate.pockets.length ? passesSizePrefilter(candidate.pocketStats, profileStats(centred)) : null;
  const profilePts = resampleClosed(centred, 2);
  const t = performance.now();
  const fit = fitCandidate(candidate, profilePts);
  const ms = performance.now() - t;
  if (!fit.reason) {
    return {
      ...base, clearance: round(fit.clearance, 3), clearanceCapped: fit.clearanceCapped, rawClearance: round(fit.rawClearance, 3),
      reason: null, ms: round(ms, 3),
    };
  }
  const worst = candidate.pockets.length ? worstPocket(candidate, profilePts) : null;
  return {
    ...base, clearance: null, rawClearance: null, reason: candidate.pockets.length ? fit.reason : 'no-pockets',
    ms: round(ms, 3), failedPocket: fit.pocketIndex,
    exactClearance: worst ? round(worst.clearance, 3) : null, worstPocket: worst ? worst.index : null,
  };
}

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const plant = get('--plant');
  const confidences = String(get('--confidence') || 'confirmed,likely').split(',').map((s) => s.trim()).filter(Boolean);
  const limitRaw = get('--limit');
  const limit = limitRaw == null ? null : Number(limitRaw);
  const out = get('--out') || null;
  if (!plant || (limitRaw != null && !(Number.isInteger(limit) && limit > 0))) return null;
  return { plant, confidences, limit, out };
}

function printSummary(s) {
  console.log(`\nPlant ${s.plant}, confidences ${s.confidences.join(',')}`);
  console.log(`Pairs checked: ${s.pairs}; passes ${s.passes} (${s.passRate} %)`);
  for (const [k, v] of Object.entries(s.byConfidence)) console.log(`  ${k}: ${v.passes}/${v.pairs} (${v.passRate} %)`);
  for (const [k, v] of Object.entries(s.byKind)) console.log(`  kind ${k}: ${v.passes}/${v.pairs} (${v.passRate} %)`);
  const c = s.clearanceOfPasses;
  console.log(`Clearance of passes: p10 ${c.p10}, p50 ${c.p50}, p90 ${c.p90} mm (capped at 50: ${c.capped}); raw p90 ${s.rawClearanceOfPasses.p90}`);
  const k = s.cavities;
  console.log(`Cavities: both known ${k.bothKnown}, agree ${k.agree}, disagree ${k.disagree}, unknown ${k.unknown}`);
  console.log(`  pass rate agreeing ${k.passRateAgreeing} %, disagreeing ${k.passRateDisagreeing} %; confirmed+agreeing ${k.confirmedAgreeing} pairs, ${k.passRateConfirmedAgreeing} %`);
  for (const [r, v] of Object.entries(s.failures)) console.log(`Failures ${r}: ${v.count} ${JSON.stringify(v.buckets)}`);
  const g = s.gates;
  console.log(`Size pre-filter would remove ${g.sizePrefilterRejectsFits} fitting pairs and pre-reject ${g.sizePrefilterRejectsNonFits} non-fitting (unknown ${g.sizePrefilterUnknown})`);
  console.log(`Pocket-count gate would remove ${g.pocketCountRejectsFits} fitting pairs and pre-reject ${g.pocketCountRejectsNonFits} non-fitting (unknown ${g.pocketCountUnknown})`);
  console.log(`ms per fit: mean ${s.msPerFit.mean}, max ${s.msPerFit.max}`);
  console.log('Worst confirmed failures:');
  for (const w of s.worstConfirmedFailures) {
    console.log(`  ${w.dieNo} / ${w.tooling} (${w.kind}, cav ${w.dieCavities}/${w.toolingCavities}, ${w.pockets} pockets): ${w.exactClearance} mm at pocket ${w.worstPocket}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('Usage: node server/scripts/check-finder-fit.cjs --plant "GEX 1" [--confidence confirmed,likely] [--limit N] [--out report.json]');
    process.exit(1);
  }
  console.log(`Finder fit check: plant ${args.plant}, confidences ${args.confidences.join(',')}, limit ${args.limit ?? 'none'}; read-only`);
  const { pool } = require('../db.cjs');
  try {
    const { rows } = await pool.query(PAIRS_SQL, [args.plant, args.confidences, args.limit]);
    console.log(`${rows.length} pairs`);
    const candidates = new Map(); // one candidate per tooling, so its grids are built once (as the finder's cache does)
    const unreadable = new Set();
    const records = [];
    const t0 = performance.now();
    for (const row of rows) {
      if (unreadable.has(row.id)) continue;
      if (!candidates.has(row.id)) {
        try {
          candidates.set(row.id, candidateFromRow(row));
        } catch (err) {
          unreadable.add(row.id);
          console.warn(`  tooling ${row.number} (id ${row.id}): unreadable pockets (${err.message}); its pairs are skipped`);
          continue;
        }
      }
      records.push(checkPair(row, candidates.get(row.id)));
      if (records.length % 500 === 0) {
        const passed = records.filter((r) => r.clearance != null).length;
        console.log(`  ${records.length}/${rows.length} checked, ${passed} pass, ${Math.round((performance.now() - t0) / 1000)} s`);
      }
    }
    const summary = buildSummary(records, { plant: args.plant, confidences: args.confidences });
    summary.wallSeconds = round((performance.now() - t0) / 1000, 1);
    summary.unreadableToolings = unreadable.size;
    printSummary(summary);
    if (args.out) {
      fs.writeFileSync(args.out, JSON.stringify({ summary, records }, null, 1));
      console.log(`Report written to ${args.out}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { PAIRS_SQL, percentile, bucketOf, buildSummary, parseArgs, recentreOuter, checkPair };
