'use strict';
// Tooling finder: which of a plant's toolings can take a given profile?
// Candidate index (cached per plant) -> narrowing by the cheap gates -> exact
// fit of every pocket -> ranking. Only loadCandidates touches the database.
//
// Unit: millimetres. Pockets are in the tooling frame, the profile in its own
// frame; see fitGeometry.cjs for the placement convention.

const { chartVerdict } = require('./toolingChart.cjs');
const { shapeStats, signatureOf } = require('./profileShape.cjs');
const { polygonArea, bbox, centroid } = require('./openingGeometry.cjs');
const { resampleClosed, signedDistanceGrid, bestPlacement, DEFAULTS } = require('./fitGeometry.cjs');
const { loadIndex, nearest } = require('./profileSimilarity.cjs');
const { normalizePlant } = require('./frozenDesigns.cjs');
const { normalizeSizeClass } = require('./toolingNumbers.cjs');

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

// ---- findToolings ----------------------------------------------------------
// The caller canonicalises the press (PRESS n); plant and die size are
// normalised again here because it is cheap.

const PROFILE_SQL = `SELECT outer_mm, holes_mm, cavities, hole_count FROM profile_shapes
  WHERE die_no = $1 AND plant = $2 AND true_size ORDER BY updated_at DESC LIMIT 1`;
const CHART_SQL = 'SELECT * FROM tooling_combinations WHERE press = $1';
const LINKED_DIES_SQL = `SELECT tooling_number, die_no, plant, source FROM die_tooling_links
  WHERE tooling_number = ANY($1) ORDER BY die_no`;
const NEIGHBOUR_TOOLINGS_SQL = `SELECT l.die_no, l.tooling_number, l.kind, t.number, t.kind AS t_kind, t.size_class,
  t.status, t.plant, t.cavities, COALESCE(o.confidence, 'none') AS confidence
  FROM die_tooling_links l
  LEFT JOIN toolings t ON t.number = l.tooling_number
  LEFT JOIN tooling_openings o ON o.tooling_id = t.id
  WHERE l.die_no = ANY($1) AND l.kind <> 'unknown'`;

const jsonOf = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const elapsed = (from) => Math.round(performance.now() - from);

// A polygon given directly wins over a die's stored true-size shape.
async function resolveProfile(client, { profile, dieNo, plant }) {
  if (profile) return { outer: profile.outer, holes: profile.holes || [] };
  if (dieNo == null || dieNo === '') throw new Error('findToolings needs a profile or a dieNo');
  const { rows: [r] } = await client.query(PROFILE_SQL, [dieNo, plant]);
  const outer = r ? jsonOf(r.outer_mm) : null;
  if (!Array.isArray(outer) || outer.length < 3) {
    throw Object.assign(new Error(`no true-size profile for die ${dieNo}`), { code: 'NO_PROFILE' });
  }
  const holes = jsonOf(r.holes_mm);
  return { outer, holes: Array.isArray(holes) ? holes : [] };
}

// The fit rotates about the origin, so the outer centroid goes there.
function recentre({ outer, holes }) {
  const [cx, cy] = centroid(outer);
  const shift = (poly) => poly.map(([x, y]) => [x - cx, y - cy]);
  return { outer: shift(outer), holes: holes.map(shift) };
}

async function linkedDiesFor(client, numbers) {
  const byTooling = new Map();
  if (!numbers.length) return byTooling;
  const { rows } = await client.query(LINKED_DIES_SQL, [numbers]);
  for (const r of rows) {
    if (!byTooling.has(r.tooling_number)) byTooling.set(r.tooling_number, []);
    byTooling.get(r.tooling_number).push({ dieNo: r.die_no, source: r.source });
  }
  return byTooling;
}

const toCandidate = (c, linkedDies) => ({
  number: c.number,
  kind: c.kind,
  sizeClass: c.size_class,
  sizeClassConfidence: c.size_class_confidence,
  cavities: c.cavities,
  heldPresses: c.held_presses,
  needsTransfer: c.needsTransfer,
  location: c.location,
  confidence: c.confidence,
  clearance: c.clearance,
  clearanceCapped: c.clearanceCapped,
  placements: c.placements,
  chart: { verdict: c.chart.verdict, rows: c.chart.rows },
  linkedDies: linkedDies.get(c.number) || [],
  pockets: c.pockets,
});

// Why a neighbour die's tooling is not among the candidates: the first that applies.
function annotateNeighbourTooling(r, { plant, press, dieSize, cavities, chartRows }) {
  const known = r.number != null;
  const kind = r.t_kind ?? r.kind;
  const sizeClass = r.size_class ?? null;
  const inScope = known && r.status === 'active' && normalizePlant(r.plant) === plant;
  const hasGeometry = known && r.confidence !== 'none';
  const { verdict } = chartVerdict(chartRows, { press, dieSize, kind, sizeClass });
  const toolingCavities = numOrNull(r.cavities);
  let reason = null;
  if (!inScope) reason = 'not-in-scope';
  else if (!hasGeometry) reason = 'no-geometry';
  else if (toolingCavities != null && toolingCavities !== Number(cavities)) reason = 'cavities';
  else if (verdict === 'not_allowed') reason = 'chart';
  return { number: known ? r.number : r.tooling_number, kind, sizeClass, inScope, hasGeometry, chartVerdict: verdict, reason };
}

async function similarProfiles(client, { outer, holes, limit, ...scope }) {
  const index = await loadIndex(client, { plant: scope.plant });
  const near = nearest(index, { signature: signatureOf({ outer, holes }), holeCount: holes.length, cavities: scope.cavities, limit });
  if (!near.length) return [];
  const { rows } = await client.query(NEIGHBOUR_TOOLINGS_SQL, [near.map((n) => n.die_no)]);
  const byDie = new Map();
  for (const r of rows) {
    const list = byDie.get(r.die_no) || [];
    const t = annotateNeighbourTooling(r, scope);
    if (!list.some((x) => x.number === t.number)) list.push(t); // one die may list a tooling from several sources
    byDie.set(r.die_no, list);
  }
  return near.map((n) => ({
    dieNo: n.die_no,
    profileNumber: n.profile_number,
    distance: n.distance,
    cavityMatch: n.cavityMatch,
    trueSize: n.trueSize,
    shapeId: n.shapeId,
    toolings: byDie.get(n.die_no) || [],
  }));
}

async function findToolings(client, { plant, press, dieSize, cavities, profile, dieNo, limit = 20, similarLimit = 20 }) {
  const t0 = performance.now();
  const query = { plant: normalizePlant(plant), press, dieSize: normalizeSizeClass(dieSize), cavities: Number(cavities) };
  const { outer, holes } = recentre(await resolveProfile(client, { profile, dieNo, plant: query.plant }));
  const profilePts = resampleClosed(outer, 2);
  const stats = profileStats(outer);

  const { rows: chartRows } = await client.query(CHART_SQL, [query.press]);
  const candidates = await loadCandidates(client, { plant: query.plant });

  const tNarrow = performance.now();
  const { kept, rejected, truncated } = narrow(candidates, { ...query, profile: stats }, chartRows);
  const narrowMs = elapsed(tNarrow);

  const tFit = performance.now();
  const fitted = [];
  rejected['no-fit'] = 0;
  for (const c of kept) {
    const fit = fitCandidate(c, profilePts);
    if (fit.reason) rejected['no-fit']++;
    else fitted.push({ ...c, ...fit });
  }
  const fitMs = elapsed(tFit);

  const top = rankCandidates(fitted).slice(0, limit);
  const linkedDies = await linkedDiesFor(client, top.map((c) => c.number));
  const similar = await similarProfiles(client, { ...query, chartRows, outer, holes, limit: similarLimit });

  return {
    query: {
      ...query,
      profile: { points: outer, area: stats.area, perimeter: stats.perimeter, ccd: stats.ccd, holeCount: holes.length },
    },
    chart: {
      basis: chartRows.length ? 'chart' : 'no_chart',
      rowsForDieSize: chartRows.filter((r) => r.die_size === query.dieSize),
    },
    candidates: top.map((c) => toCandidate(c, linkedDies)),
    rejected,
    fitted: kept.length,
    truncated,
    similar,
    timings: { narrowMs, fitMs, totalMs: elapsed(t0) },
  };
}

module.exports = {
  MIN_CLEARANCE_MM, CLEARANCE_CAP_MM, MAX_FITTED, confidenceRank,
  profileStats, pocketStats, CANDIDATE_SQL, STAMP_SQL, candidateFromRow, loadCandidates, invalidate,
  narrow, fitCandidate, rankCandidates, findToolings,
};
