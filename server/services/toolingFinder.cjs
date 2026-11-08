'use strict';
// Tooling finder: which of a plant's toolings can take a given profile?
// Candidate index (cached per plant) -> narrowing by the cheap gates -> exact
// fit of every pocket -> ranking. Only loadCandidates touches the database.
//
// Unit: millimetres. Pockets are in the tooling frame, the profile in its own
// frame; see fitGeometry.cjs for the placement convention.

const { chartVerdict } = require('./toolingChart.cjs');
const { shapeStats } = require('./profileShape.cjs');
const { polygonArea, bbox } = require('./openingGeometry.cjs');
const { signedDistanceGrid, bestPlacement, DEFAULTS } = require('./fitGeometry.cjs');

const MIN_CLEARANCE_MM = 5;
const CLEARANCE_CAP_MM = 50;
const MAX_FITTED = 400;

const confidenceRank = Object.freeze({ confirmed: 0, likely: 1, uncertain: 2 });

// ---- shape statistics ------------------------------------------------------

function perimeterOf(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

function profileStats(outerMm) {
  const { area, ccd } = shapeStats({ outer: outerMm });
  return { area, perimeter: perimeterOf(outerMm), ccd, bbox: bbox(outerMm) };
}

function pocketStats(pocket) {
  const b = bbox(pocket);
  return { area: polygonArea(pocket), perimeter: perimeterOf(pocket), bbox: b, diag: Math.hypot(b.width, b.height) };
}

const totalPocketArea = (c) => c.pocketStats.reduce((s, p) => s + p.area, 0);

// ---- candidate index -------------------------------------------------------

const FILTER = `FROM toolings t JOIN tooling_openings o ON o.tooling_id = t.id
  WHERE t.plant = $1 AND t.status = 'active' AND o.confidence <> 'none' AND o.pockets IS NOT NULL`;

const CANDIDATE_SQL = `SELECT t.id, t.number, t.kind, t.plant, t.held_presses, t.size_class, t.size_class_confidence,
  t.cavities, t.location, t.status, o.pockets, o.confidence, o.pocket_gap_mm
  ${FILTER}`;

const STAMP_SQL = `SELECT max(GREATEST(t.updated_at, o.updated_at)) AS max_updated, count(*)::int AS n
  ${FILTER}`;

// plant -> { stamp, candidates }; grids built by fitCandidate live on the
// candidates, so they go when the entry is replaced.
const cache = new Map();

const stampKey = (r) => {
  const t = r && r.max_updated;
  return `${t instanceof Date ? t.toISOString() : String(t ?? '')}|${r ? r.n : 0}`;
};

const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function candidateFromRow(row) {
  const raw = typeof row.pockets === 'string' ? JSON.parse(row.pockets) : row.pockets;
  const pockets = Array.isArray(raw) ? raw : [];
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    plant: row.plant,
    held_presses: Array.isArray(row.held_presses) ? row.held_presses : [],
    size_class: row.size_class ?? null,
    size_class_confidence: row.size_class_confidence ?? null,
    cavities: numOrNull(row.cavities),
    location: row.location ?? null,
    status: row.status,
    confidence: row.confidence,
    pocket_gap_mm: numOrNull(row.pocket_gap_mm),
    pockets,
    pocketStats: pockets.map(pocketStats),
    grids: [],
  };
}

// The cheap stamp runs every call; the full load only when it moved.
// onWarn(message) is an optional hook for data oddities (a row with no pockets).
async function loadCandidates(client, { plant, onWarn } = {}) {
  const { rows: [stampRow] } = await client.query(STAMP_SQL, [plant]);
  const stamp = stampKey(stampRow);
  const cached = cache.get(plant);
  if (cached && cached.stamp === stamp) return cached.candidates;
  const { rows } = await client.query(CANDIDATE_SQL, [plant]);
  const candidates = [];
  for (const row of rows) {
    const c = candidateFromRow(row);
    if (!c.pockets.length) {
      if (onWarn) onWarn(`tooling ${c.number} (id ${c.id}) has an empty pockets array; skipped`);
      continue;
    }
    candidates.push(c);
  }
  cache.set(plant, { stamp, candidates });
  return candidates;
}

function invalidate(plant) {
  cache.delete(plant);
}

// ---- narrowing -------------------------------------------------------------

// Smallest pocket that could hold the profile with MIN_CLEARANCE_MM all round:
// the profile grown by the clearance (area + clearance × perimeter + π clearance²),
// and a bbox diagonal at least the profile's enclosing circle plus twice the clearance.
function passesSizePrefilter(stats, profile) {
  const minArea = profile.area + MIN_CLEARANCE_MM * profile.perimeter + Math.PI * MIN_CLEARANCE_MM ** 2;
  const minDiag = profile.ccd + 2 * MIN_CLEARANCE_MM;
  return stats.every((p) => p.area >= minArea && p.diag >= minDiag);
}

function needsTransferFor(heldPresses, press) {
  if (!heldPresses.length) return null;
  return !heldPresses.includes(press);
}

// Plant and status are already in CANDIDATE_SQL. Kept candidates are copies
// (the cached ones are shared between queries) that share the cached grids array.
function narrow(candidates, query, chartRows) {
  const { press, dieSize, cavities, profile } = query;
  const rejected = { cavities: 0, 'cavities-unknown': 0, 'no-size-class': 0, chart: 0, 'size-prefilter': 0 };
  const passed = [];
  for (const c of candidates) {
    if (c.cavities == null) { rejected['cavities-unknown']++; continue; }
    if (c.cavities !== Number(cavities)) { rejected.cavities++; continue; }
    // Gate two. A press with no chart rows decides nothing (no_chart), so the
    // size class is only required when there is a chart to check it against.
    const chart = chartVerdict(chartRows, { press, dieSize, kind: c.kind, sizeClass: c.size_class });
    if (chart.verdict !== 'no_chart') {
      if (c.size_class == null) { rejected['no-size-class']++; continue; }
      if (chart.verdict === 'not_allowed') { rejected.chart++; continue; }
    }
    if (!passesSizePrefilter(c.pocketStats, profile)) { rejected['size-prefilter']++; continue; }
    passed.push({ ...c, chart, needsTransfer: needsTransferFor(c.held_presses, press) });
  }
  passed.sort((a, b) => totalPocketArea(a) - totalPocketArea(b));
  const truncated = passed.length > MAX_FITTED;
  return { kept: truncated ? passed.slice(0, MAX_FITTED) : passed, rejected, truncated };
}

// ---- fit -------------------------------------------------------------------

// Every pocket must take the profile; each gets its own placement. The grid of
// each pocket is built on first use and kept on the (cached) candidate.
function fitCandidate(candidate, profilePts, { minClearance = MIN_CLEARANCE_MM } = {}) {
  const placements = [];
  let rawClearance = Infinity;
  for (let i = 0; i < candidate.pockets.length; i++) {
    const pocket = candidate.pockets[i];
    if (!candidate.grids[i]) candidate.grids[i] = signedDistanceGrid(pocket, { cellMm: DEFAULTS.cellMm });
    const fit = bestPlacement(profilePts, pocket, { minClearance, grid: candidate.grids[i] });
    if (!fit) return { reason: 'no-fit', pocketIndex: i };
    placements.push({ pocketIndex: i, ...fit.placement, clearance: fit.clearance });
    if (fit.clearance < rawClearance) rawClearance = fit.clearance;
  }
  if (!placements.length) return { reason: 'no-fit', pocketIndex: 0 };
  const clearanceCapped = rawClearance > CLEARANCE_CAP_MM;
  return {
    clearance: clearanceCapped ? CLEARANCE_CAP_MM : rawClearance,
    clearanceCapped,
    rawClearance,
    placements,
  };
}

// ---- ranking ---------------------------------------------------------------

const confOrder = (c) => (c in confidenceRank ? confidenceRank[c] : Object.keys(confidenceRank).length);

// Tightest fit first (least wasted metal); capped clearances last.
function rankCandidates(fitted) {
  return [...fitted].sort((a, b) => (
    (a.clearanceCapped ? 1 : 0) - (b.clearanceCapped ? 1 : 0)
    || a.clearance - b.clearance
    || totalPocketArea(a) - totalPocketArea(b)
    || confOrder(a.confidence) - confOrder(b.confidence)
    || String(a.number).localeCompare(String(b.number), 'en', { numeric: true })
  ));
}

// ---- findToolings (Task 3) -------------------------------------------------
// Task 3 adds findToolings here: load candidates + chart rows, narrow, fit, rank.

module.exports = {
  MIN_CLEARANCE_MM, CLEARANCE_CAP_MM, MAX_FITTED, confidenceRank,
  profileStats, pocketStats, CANDIDATE_SQL, STAMP_SQL, candidateFromRow, loadCandidates, invalidate,
  narrow, fitCandidate, rankCandidates,
};
