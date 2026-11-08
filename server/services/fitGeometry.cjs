'use strict';

// Polygon-in-polygon placement: does a profile outline fit inside a pocket
// with a minimum clearance all round, at any rotation (never mirrored), and
// how much clearance does the best placement achieve?
//
// Unit: millimetres, y up. A polygon is Array<[x, y]> with no repeated
// closing point. The profile is rotated about its own origin, then translated
// into the pocket frame: p' = R(theta)·p + (tx, ty), theta in radians.
//
// The search runs on a signed-distance grid of the pocket (cheap bilinear
// look-ups); the returned clearance is always the exact segment distance at
// the returned placement, because the grid is only good to about half a cell.

const { bbox, centroid } = require('./openingGeometry.cjs');

const DEFAULTS = Object.freeze({
  minClearance: 5,
  angleStepDeg: 10,
  cellMm: 2,
  marginMm: 6,
  resampleStepMm: 2,
  maxEvaluations: 4000,
  seeds: 3,
  startStep: Object.freeze({ mm: 4, deg: 4 }),
  endStep: Object.freeze({ mm: 0.25, deg: 0.25 }),
  improveEps: 1e-6,
});

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

// ---- resampling ------------------------------------------------------------

// Every original vertex is kept (corners touch a wall first); each edge longer
// than stepMm is split into equal pieces no longer than stepMm.
function resampleClosed(points, stepMm = 2) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const pieces = Math.ceil(len / stepMm);
    for (let k = 1; k < pieces; k++) {
      const t = k / pieces;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

// ---- exact distances -------------------------------------------------------

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function boundaryDistance(p, polygon) {
  let best = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const d = segmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

// Signed distance from (x, y) to the closed polygon (xs, ys): positive inside,
// negative outside. One pass over the edges: squared segment distance plus the
// even-odd crossing test (same rule as openingGeometry.pointInPolygon).
function signedDistance(x, y, xs, ys) {
  const n = xs.length;
  let best2 = Infinity;
  let inside = false;
  for (let a = 0, b = n - 1; a < n; b = a++) {
    const xa = xs[a]; const ya = ys[a]; const xb = xs[b]; const yb = ys[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    const dx = xb - xa; const dy = yb - ya;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((x - xa) * dx + (y - ya) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const ex = x - (xa + t * dx); const ey = y - (ya + t * dy);
    const d2 = ex * ex + ey * ey;
    if (d2 < best2) best2 = d2;
  }
  const d = Math.sqrt(best2);
  return inside ? d : -d;
}

/**
 * Exact clearance of the closed polygon `points` (already placed in the pocket
 * frame) inside `polygon`, measured both ways:
 * - each of `points` against the pocket's edges, and
 * - each pocket vertex against the edges of `points`,
 * so a pocket corner reaching towards a profile edge between two points is
 * measured at its true distance.
 * Returns minus the worst overlap distance when any point lies outside the
 * pocket or any pocket vertex lies inside `points` (negative), else the smallest
 * distance found in either direction (positive).
 *
 * It measures the points it is given: an edge of `points` that crosses a thin
 * pocket spike without either side having a vertex in the other is not seen,
 * so pass a resampled outline (bestPlacement resamples for you).
 */
function exactClearance(points, polygon) {
  const px = Float64Array.from(points, (p) => p[0]);
  const py = Float64Array.from(points, (p) => p[1]);
  const qx = Float64Array.from(polygon, (p) => p[0]);
  const qy = Float64Array.from(polygon, (p) => p[1]);
  let worstOverlap = -1;
  let minGap = Infinity;
  const take = (sd) => {
    if (sd >= 0) { if (sd < minGap) minGap = sd; } else if (-sd > worstOverlap) worstOverlap = -sd;
  };
  for (let k = 0; k < px.length; k++) take(signedDistance(px[k], py[k], qx, qy));
  // Reverse direction: a pocket vertex inside the profile is an overlap; one
  // outside may be the nearest approach. Vertices outside the profile's
  // bounding box and at least the gap found away from it cannot matter.
  const b = bbox(points);
  for (let k = 0; k < qx.length; k++) {
    const ex = Math.max(b.minX - qx[k], 0, qx[k] - b.maxX);
    const ey = Math.max(b.minY - qy[k], 0, qy[k] - b.maxY);
    const away = Math.hypot(ex, ey);
    if (away > 0 && away >= minGap) continue;
    take(-signedDistance(qx[k], qy[k], px, py));
  }
  return worstOverlap >= 0 ? -worstOverlap : minGap;
}

// ---- signed-distance grid --------------------------------------------------

function signedDistanceGrid(polygon, { cellMm = DEFAULTS.cellMm, marginMm = DEFAULTS.marginMm } = {}) {
  const b = bbox(polygon);
  const x0 = b.minX - marginMm;
  const y0 = b.minY - marginMm;
  const nx = Math.ceil((b.width + 2 * marginMm) / cellMm) + 1;
  const ny = Math.ceil((b.height + 2 * marginMm) / cellMm) + 1;
  const data = new Float32Array(nx * ny);
  const ax = Float64Array.from(polygon, (p) => p[0]);
  const ay = Float64Array.from(polygon, (p) => p[1]);
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * cellMm;
    for (let i = 0; i < nx; i++) {
      data[j * nx + i] = signedDistance(x0 + i * cellMm, y, ax, ay);
    }
  }
  return { x0, y0, cell: cellMm, nx, ny, data };
}

// Bilinear interpolation at fractional cell coordinates already within range.
function bilinear(grid, fx, fy) {
  const { nx, ny, data } = grid;
  let i = Math.floor(fx);
  let j = Math.floor(fy);
  if (i >= nx - 1) i = nx - 2;
  if (j >= ny - 1) j = ny - 2;
  const u = fx - i;
  const v = fy - j;
  const k = j * nx + i;
  return (data[k] * (1 - u) + data[k + 1] * u) * (1 - v)
    + (data[k + nx] * (1 - u) + data[k + nx + 1] * u) * v;
}

function sampleGrid(grid, x, y) {
  const fx = (x - grid.x0) / grid.cell;
  const fy = (y - grid.y0) / grid.cell;
  if (!(fx >= 0 && fy >= 0 && fx <= grid.nx - 1 && fy <= grid.ny - 1)) return -Infinity;
  return bilinear(grid, fx, fy);
}

// Search-only variant: off the grid, the edge value minus the distance to the
// grid, so a profile that starts partly outside still has a slope to climb.
// Equal to sampleGrid wherever that is finite.
function sampleGridExtended(grid, x, y) {
  const fx = (x - grid.x0) / grid.cell;
  const fy = (y - grid.y0) / grid.cell;
  const cx = fx < 0 ? 0 : fx > grid.nx - 1 ? grid.nx - 1 : fx;
  const cy = fy < 0 ? 0 : fy > grid.ny - 1 ? grid.ny - 1 : fy;
  const v = bilinear(grid, cx, cy);
  if (cx === fx && cy === fy) return v;
  return v - Math.hypot(fx - cx, fy - cy) * grid.cell;
}

// ---- placement -------------------------------------------------------------

function transformPoints(points, { theta, tx, ty }) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return points.map(([x, y]) => [c * x - s * y + tx, s * x + c * y + ty]);
}

function gridClearance(points, grid) {
  let best = Infinity;
  for (const [x, y] of points) {
    const v = sampleGrid(grid, x, y);
    if (v < best) best = v;
  }
  return best;
}

// gridClearance of the transformed profile without allocating, using the
// extended sampler; stops early once at or below the value to beat.
function placementScore(xs, ys, grid, theta, tx, ty, floor = -Infinity) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  let best = Infinity;
  for (let k = 0; k < xs.length; k++) {
    const v = sampleGridExtended(grid, c * xs[k] - s * ys[k] + tx, s * xs[k] + c * ys[k] + ty);
    if (v < best) {
      best = v;
      if (best <= floor) return best;
    }
  }
  return best;
}

function deepestCell(grid) {
  let k = 0;
  for (let m = 1; m < grid.data.length; m++) if (grid.data[m] > grid.data[k]) k = m;
  const i = k % grid.nx;
  const j = (k - i) / grid.nx;
  return [grid.x0 + i * grid.cell, grid.y0 + j * grid.cell];
}

// Pattern search over (tx, ty, theta): try plus/minus each axis and the four
// translation diagonals (the min-over-points score has ridges an axis move
// cannot climb); take the best improving move, halve the steps when none does.
function refine(seed, score, budget, opts) {
  let { theta, tx, ty, value } = seed;
  let mm = opts.startStep.mm;
  let rad = opts.startStep.deg * DEG;
  const endMm = opts.endStep.mm - 1e-12;
  while (mm >= endMm && budget.left > 0) {
    const d = mm / Math.SQRT2;
    const moves = [
      [mm, 0, 0], [-mm, 0, 0], [0, mm, 0], [0, -mm, 0],
      [d, d, 0], [d, -d, 0], [-d, d, 0], [-d, -d, 0],
      [0, 0, rad], [0, 0, -rad],
    ];
    let bestMove = null;
    let bestValue = value + opts.improveEps;
    for (const [dx, dy, dt] of moves) {
      if (budget.left <= 0) break;
      budget.left--;
      const v = score(theta + dt, tx + dx, ty + dy, bestValue);
      if (v > bestValue) { bestValue = v; bestMove = [dx, dy, dt]; }
    }
    if (bestMove) {
      tx += bestMove[0]; ty += bestMove[1]; theta += bestMove[2]; value = bestValue;
    } else {
      mm /= 2; rad /= 2;
    }
  }
  return { theta, tx, ty, value };
}

function normaliseAngle(theta) {
  const t = theta % TWO_PI;
  return t < 0 ? t + TWO_PI : t;
}

function bestPlacement(profilePts, pocket, {
  minClearance = DEFAULTS.minClearance,
  angleStepDeg = DEFAULTS.angleStepDeg,
  cellMm = DEFAULTS.cellMm,
  maxEvaluations = DEFAULTS.maxEvaluations,
  grid = null,
} = {}) {
  if (profilePts.length < 3 || pocket.length < 3) return null;
  const g = grid || signedDistanceGrid(pocket, { cellMm });
  // Resample so no stretch of the outline goes unmeasured (a long raw edge can
  // straddle a thin pocket spike); a no-op on input already at this spacing.
  const pts = resampleClosed(profilePts, DEFAULTS.resampleStepMm);
  const xs = Float64Array.from(pts, (p) => p[0]);
  const ys = Float64Array.from(pts, (p) => p[1]);
  const budget = { left: maxEvaluations };
  const score = (theta, tx, ty, floor) => placementScore(xs, ys, g, theta, tx, ty, floor);

  // Angle sweep at both starts; keep the best few (angle, start) seeds.
  const starts = [deepestCell(g), centroid(pocket)];
  const candidates = [];
  const angles = Math.max(1, Math.round(360 / angleStepDeg));
  for (let a = 0; a < angles && budget.left > 0; a++) {
    const theta = a * angleStepDeg * DEG;
    for (const [tx, ty] of starts) {
      if (budget.left <= 0) break;
      budget.left--;
      candidates.push({ theta, tx, ty, value: score(theta, tx, ty) });
    }
  }
  candidates.sort((p, q) => q.value - p.value);

  // Refine every seed, then let the exact measure pick among them: the grid is
  // only good to about half a cell, so its ranking is not trusted at the end.
  const refined = candidates.slice(0, DEFAULTS.seeds).map((seed) => refine(seed, score, budget, DEFAULTS));
  let best = null;
  for (const r of refined) {
    const placement = { theta: normaliseAngle(r.theta), tx: r.tx, ty: r.ty };
    const clearance = exactClearance(transformPoints(pts, placement), pocket);
    if (!best || clearance > best.clearance) best = { clearance, placement };
  }
  if (!best || !(best.clearance >= minClearance)) return null;
  return { clearance: best.clearance, placement: best.placement, evaluations: maxEvaluations - budget.left };
}

module.exports = {
  resampleClosed, boundaryDistance, signedDistanceGrid, sampleGrid, transformPoints,
  gridClearance, exactClearance, bestPlacement, DEFAULTS,
};
