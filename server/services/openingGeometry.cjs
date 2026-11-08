'use strict';

// Pure geometry over the Chain objects produced by dxfReader.cjs.
// Unit: millimetres. A polygon is Array<[x, y]> with no repeated closing point.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---- basic polygon maths ---------------------------------------------------

function polygonArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function centroid(points) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = points.length || 1;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function bbox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function pointInPolygon(p, points) {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonContains(outer, inner) {
  return inner.every((p) => pointInPolygon(p, outer));
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function distToBoundary(p, points) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    best = Math.min(best, distToSegment(p, points[i], points[(i + 1) % points.length]));
  }
  return best;
}

// ---- circle fitting --------------------------------------------------------

function circleFit(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const [px, py] of points) {
    const x = px - mx;
    const y = py - my;
    const z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const det = sxx * syy - sxy * sxy;
  if (!(Math.abs(det) > 1e-12 * (sxx + syy) * (sxx + syy))) {
    return { cx: mx, cy: my, r: Infinity, maxDeviation: Infinity };
  }
  const a = (0.5 * (sxz * syy - syz * sxy)) / det;
  const b = (0.5 * (syz * sxx - sxz * sxy)) / det;
  const r = Math.sqrt(a * a + b * b + sz / n);
  const cx = a + mx;
  const cy = b + my;
  let maxDeviation = 0;
  for (const p of points) maxDeviation = Math.max(maxDeviation, Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r));
  return { cx, cy, r, maxDeviation };
}

// A polygon with fewer than 8 vertices is never circle-like: any square fits a circle exactly.
function isCircleLike(points) {
  if (points.length < 8) return false;
  const { r, maxDeviation } = circleFit(points);
  return Number.isFinite(r) && maxDeviation <= Math.max(1, 0.01 * r);
}

// Circle fit that tolerates a key slot cut into the rim: refit on the points inside a tightening band until the
// fit is within 1 % of the radius. Accepted only when most points are on the circle and they go nearly all the way
// round, so a pocket outline never passes. Returns the fit or null.
function robustCircle(points) {
  if (points.length < 8) return null;
  let pts = points;
  // Start from the bounding box: a key slot cuts inwards, so the rim still defines it, whereas a least-squares
  // fit over every point is dragged off-centre by the slot.
  const bb = bbox(points);
  let fit = { cx: bb.cx, cy: bb.cy, r: (bb.width + bb.height) / 4, maxDeviation: Infinity };
  for (const band of [0.03, 0.015, 0.01]) {
    for (let again = 0; again < 5; again++) {
      if (!Number.isFinite(fit.r)) return null;
      const tol = Math.max(1, band * fit.r);
      const keep = pts.filter((q) => Math.abs(Math.hypot(q[0] - fit.cx, q[1] - fit.cy) - fit.r) <= tol);
      if (keep.length < 8) return null;
      const stable = keep.length === pts.length;
      pts = keep;
      fit = circleFit(pts);
      if (stable) break;
    }
  }
  if (pts.length < 0.6 * points.length || fit.maxDeviation > Math.max(1, 0.01 * fit.r)) return null;
  const angles = pts.map((q) => Math.atan2(q[1] - fit.cy, q[0] - fit.cx)).sort((a, b) => a - b);
  let widest = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) widest = Math.max(widest, angles[i] - angles[i - 1]);
  return widest <= Math.PI / 3 ? fit : null;
}

// A 4-vertex axis-aligned rectangle (collinear and repeated vertices are dropped first).
function isAxisRect(points) {
  const span = Math.max(bbox(points).width, bbox(points).height) || 1;
  const eps = 1e-6 * span;
  let pts = points.filter((p, i) => dist(p, points[(i + 1) % points.length]) > eps);
  pts = pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > eps * span;
  });
  if (pts.length !== 4) return false;
  const tol = 1e-3 * span;
  return pts.every((p, i) => {
    const q = pts[(i + 1) % 4];
    return Math.abs(p[0] - q[0]) <= tol || Math.abs(p[1] - q[1]) <= tol;
  });
}

// Drawing frames: axis-aligned rectangles that hold every other loop (larger frames aside), e.g. the sheet border
// and its inner border. They are never the outer and never a pocket.
function frameLoops(loops) {
  const rects = loops.filter((l) => isAxisRect(l.points)).sort((a, b) => polygonArea(b.points) - polygonArea(a.points));
  const frames = new Set();
  for (const r of rects) {
    const b = bbox(r.points);
    const others = loops.filter((l) => l !== r && !frames.has(l));
    if (!others.length) continue;
    const inside = (p) => p[0] >= b.minX - 0.5 && p[0] <= b.maxX + 0.5 && p[1] >= b.minY - 0.5 && p[1] <= b.maxY + 0.5;
    if (others.every((l) => l.points.every(inside))) frames.add(r);
  }
  return frames;
}

// Two long straight open chains crossing near their midpoints (the drawing's centre lines): their intersection.
function centreLineCrossing(openChains, minLength) {
  const lines = [];
  for (const c of openChains || []) {
    const pts = c.points;
    if (!pts || pts.length < 2) continue;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const chord = dist(a, b);
    if (chord <= minLength) continue;
    let path = 0;
    for (let i = 1; i < pts.length; i++) path += dist(pts[i - 1], pts[i]);
    if (chord < 0.99 * path) continue; // not straight
    lines.push({ a, b, len: chord });
  }
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = lines[i];
      const q = lines[j];
      const r = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
      const s = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
      const cross = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(cross) < Math.sin(Math.PI / 3) * p.len * q.len) continue; // not crossing at 60 degrees or more
      const w = [q.a[0] - p.a[0], q.a[1] - p.a[1]];
      const t = (w[0] * s[1] - w[1] * s[0]) / cross;
      const u = (w[0] * r[1] - w[1] * r[0]) / cross;
      if (Math.abs(t - 0.5) > 0.15 || Math.abs(u - 0.5) > 0.15) continue;
      const score = Math.min(p.len, q.len);
      if (!best || score > best.score) best = { score, point: [p.a[0] + t * r[0], p.a[1] + t * r[1]] };
    }
  }
  return best ? best.point : null;
}

// ---- chaining --------------------------------------------------------------

function chainLoops(chains, { joinTol = 0.5, bridgeTol = 3 } = {}) {
  const loops = [];
  let runs = [];
  const uniq = (xs) => [...new Set(xs)];

  for (const c of chains) {
    if (!c.points || c.points.length < 2) continue;
    if (c.closed) {
      const pts = dist(c.points[0], c.points[c.points.length - 1]) <= 1e-9 ? c.points.slice(0, -1) : c.points.slice();
      if (pts.length >= 3) loops.push({ points: pts, layer: c.layer, bridgedGaps: 0, sources: [c.source] });
    } else {
      runs.push({ points: c.points.slice(), layer: c.layer, sources: [c.source], source: c.source });
    }
  }

  // Attach runs end-to-end in a single pass: free endpoints are bucketed in a spatial hash
  // (cell size joinTol, 3x3 neighbourhood) and each run is extended at both ends until nothing is in reach.
  const cell = Math.max(joinTol, 1e-9);
  const cellOf = (p) => [Math.floor(p[0] / cell), Math.floor(p[1] / cell)];
  const grid = new Map();
  const addEnd = (ri, which, p) => {
    const [gx, gy] = cellOf(p);
    const key = gx + ',' + gy;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ ri, which });
  };
  runs.forEach((r, ri) => {
    addEnd(ri, 'start', r.points[0]);
    addEnd(ri, 'end', r.points[r.points.length - 1]);
  });
  const consumed = new Array(runs.length).fill(false);
  const nearest = (p, self) => {
    const [gx, gy] = cellOf(p);
    let best = null;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get((gx + dx) + ',' + (gy + dy));
        if (!list) continue;
        for (const e of list) {
          if (e.ri === self || consumed[e.ri]) continue;
          const q = e.which === 'start' ? runs[e.ri].points[0] : runs[e.ri].points[runs[e.ri].points.length - 1];
          const d = dist(p, q);
          if (d <= joinTol && d < bestD) { best = e; bestD = d; }
        }
      }
    }
    return best;
  };
  const merged = [];
  for (let i = 0; i < runs.length; i++) {
    if (consumed[i]) continue;
    consumed[i] = true;
    const run = runs[i];
    const body = run.points.slice();
    const head = []; // points added beyond the start, in outward order
    let sources = run.sources;
    // outward travel from an end: the neighbour's points in the direction away from the shared joint
    const outward = (cand) => {
      const pts = runs[cand.ri].points;
      consumed[cand.ri] = true;
      sources = uniq([...sources, ...runs[cand.ri].sources]);
      return cand.which === 'start' ? pts.slice(1) : pts.slice().reverse().slice(1);
    };
    for (;;) {
      const cand = nearest(body[body.length - 1], i);
      if (!cand) break;
      for (const p of outward(cand)) body.push(p);
    }
    for (;;) {
      const tip = head.length ? head[head.length - 1] : body[0];
      const cand = nearest(tip, i);
      if (!cand) break;
      for (const p of outward(cand)) head.push(p);
    }
    merged.push({ points: [...head.reverse(), ...body], layer: run.layer, sources, source: run.source });
  }
  runs = merged;

  const open = [];
  let bridged = 0;
  for (const run of runs) {
    const gap = dist(run.points[0], run.points[run.points.length - 1]);
    if (gap <= bridgeTol) {
      // Ends that coincide drop the repeated point; a wider gap is bridged by a straight closing edge.
      const pts = gap <= joinTol ? run.points.slice(0, -1) : run.points;
      if (pts.length >= 3) {
        const gapBridged = gap > joinTol ? 1 : 0;
        loops.push({ points: pts, layer: run.layer, bridgedGaps: gapBridged, sources: run.sources });
        bridged += gapBridged;
        continue;
      }
    }
    open.push({ layer: run.layer, points: run.points, closed: false, source: run.source });
  }
  return { loops, open, bridged };
}

// ---- classification --------------------------------------------------------

function synthesiseCircle(cx, cy, diameter, n = 64) {
  const r = diameter / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

const fmtMm = (n) => String(Math.round(n * 10) / 10);

// noOuterFallback: with no expected diameter and no circle, do not promote the largest loop to outer
// (an outline-only drawing, e.g. a scan, has pockets and no outer).
// openChains: the chains that did not close (centre lines live there); used only to centre a synthesised outer.
// Returns { outer, outerSynthesised, outerFit, outerBasis, pockets, ignored, notes } where outerBasis is
// 'drawn-circle' | 'promoted' | 'synthesised-rim' | 'synthesised-centre-lines' | 'synthesised-bbox' | null.
function classifyLoops(loops, { expectedOuterDiameter = null, noOuterFallback = false, openChains = [] } = {}) {
  const ignored = [];
  const notes = [];
  let outer = null;
  let outerSynthesised = false;
  let outerFit = null;
  let outerBasis = null;

  // Rule 0: drawing frames (sheet borders) are neither the outer nor a pocket.
  const frames = frameLoops(loops);
  for (const f of frames) ignored.push({ loop: f, reason: 'frame' });
  const live = loops.filter((l) => !frames.has(l));

  // Rule 1: the outer is a circle of at least 100 mm diameter; a rim drawn with its key slot still counts.
  const circles = live
    .map((l) => ({ l, fit: robustCircle(l.points) }))
    .filter((c) => c.fit && c.fit.r * 2 >= 100);
  circles.sort((a, b) => b.fit.r - a.fit.r);
  if (circles.length) {
    let pick = null;
    if (expectedOuterDiameter) {
      const off = (c) => Math.abs(c.fit.r * 2 - expectedOuterDiameter);
      const near = circles.filter((c) => off(c) <= 0.1 * expectedOuterDiameter).sort((a, b) => off(a) - off(b));
      pick = near[0] || null;
    } else {
      pick = circles[0];
    }
    if (pick) { outer = pick.l; outerFit = pick.fit; outerBasis = 'drawn-circle'; }
  }

  // Rule 2: no qualifying circle.
  if (!outer && live.length) {
    if (expectedOuterDiameter) {
      // Centre the synthesised outer on a drawn rim (whatever its size), else on the centre lines, else on the
      // joint bbox of the drawn loops (frames excluded) - the last is a guess and is graded so.
      const holds = (c) => live.some((l) => {
        if (l === c.l) return false;
        const [x, y] = centroid(l.points);
        return Math.hypot(x - c.fit.cx, y - c.fit.cy) < c.fit.r;
      });
      const rim = circles.find(holds);
      let centre = null;
      if (rim) {
        centre = [rim.fit.cx, rim.fit.cy];
        outerBasis = 'synthesised-rim';
        notes.push(`drawn rim Ø${fmtMm(rim.fit.r * 2)} disagrees with the stated Ø${fmtMm(expectedOuterDiameter)}; outer centred on the rim`);
      } else {
        centre = centreLineCrossing(openChains, 0.6 * expectedOuterDiameter);
        if (centre) {
          outerBasis = 'synthesised-centre-lines';
          notes.push('outer centred on the drawn centre lines');
        } else {
          const b = bbox(live.flatMap((l) => l.points));
          centre = [b.cx, b.cy];
          outerBasis = 'synthesised-bbox';
        }
      }
      outer = { points: synthesiseCircle(centre[0], centre[1], expectedOuterDiameter), layer: '', bridgedGaps: 0, sources: [] };
      outerSynthesised = true;
    } else if (!noOuterFallback) {
      const largest = live.reduce((m, l) => (polygonArea(l.points) > polygonArea(m.points) ? l : m));
      // A plain rectangle holding the rest is a sheet or title frame, never the outer.
      if (live.length >= 2 && !isAxisRect(largest.points)
        && live.every((l) => l === largest || polygonContains(largest.points, l.points))) {
        outer = largest;
        outerBasis = 'promoted';
        if (isCircleLike(largest.points)) outerFit = circleFit(largest.points);
      }
    }
  }

  let rest = live.filter((l) => l !== outer);
  let centre = null;
  let outerRadius = null;
  if (outer) {
    const b = bbox(outer.points);
    centre = [b.cx, b.cy];
    outerRadius = Math.max(b.width, b.height) / 2;
    // Rule 3: loops not inside the outer (a vertex within 0.5 mm of its boundary counts as inside).
    rest = rest.filter((l) => {
      const inside = l.points.every((p) => pointInPolygon(p, outer.points) || distToBoundary(p, outer.points) <= 0.5);
      if (!inside) ignored.push({ loop: l, reason: 'outside-outer' });
      return inside;
    });
  }

  // Rule 4: fastener holes.
  rest = rest.filter((l) => {
    if (isCircleLike(l.points) && circleFit(l.points).r * 2 <= 30) {
      ignored.push({ loop: l, reason: 'fastener-hole' });
      return false;
    }
    return true;
  });

  // Rule 5: notches touching the rim.
  if (outer) {
    rest = rest.filter((l) => {
      if (l.points.some((p) => dist(p, centre) > 0.9 * outerRadius)) {
        ignored.push({ loop: l, reason: 'rim-notch' });
        return false;
      }
      return true;
    });
  }

  // Rule 6: loops contained by a larger remaining loop.
  const areas = new Map(rest.map((l) => [l, polygonArea(l.points)]));
  const afterNested = rest.filter((l) => {
    const nested = rest.some((o) => o !== l && areas.get(o) > areas.get(l) && polygonContains(o.points, l.points));
    if (nested) ignored.push({ loop: l, reason: 'nested' });
    return !nested;
  });

  // Rule 7: tiny loops.
  const pockets = afterNested.filter((l) => {
    if (areas.get(l) < 50) {
      ignored.push({ loop: l, reason: 'tiny' });
      return false;
    }
    return true;
  });
  pockets.sort((a, b) => areas.get(b) - areas.get(a));

  return { outer, outerSynthesised, outerFit, outerBasis, pockets, ignored, notes };
}

function pocketGapMm(pockets) {
  if (pockets.length < 2) return null;
  const cs = pockets.map((p) => centroid(p.points));
  let best = Infinity;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) best = Math.min(best, dist(cs[i], cs[j]));
  }
  return best;
}

// offset: the [cx, cy] subtracted from every point (source mm), so a viewer can put the outline back on the drawing.
function normaliseFrame({ outer, pockets }) {
  const ref = outer ? outer.points : pockets.flatMap((p) => p.points);
  if (!ref.length) return { outer, pockets, offset: [0, 0] };
  const { cx, cy } = bbox(ref);
  const shift = (l) => ({ ...l, points: l.points.map(([x, y]) => [x - cx, y - cy]) });
  return { outer: outer ? shift(outer) : outer, pockets: pockets.map(shift), offset: [cx, cy] };
}

// ---- confidence ------------------------------------------------------------

// The drawing's own units (DXF): the geometry is measured, not scaled from a stated size.
const NATIVE_SCALES = new Set(['native-mm', 'native-inch', 'native-feet']);

// outerFit: the circle the outer is drawn on (a keyed rim's least-squares fit is dragged by the slot), when known.
// outerBasis: as returned by classifyLoops; 'synthesised-bbox' and a non-circular 'promoted' outer cap at uncertain.
function gradeConfidence({
  outer, outerSynthesised, outerFit = null, outerBasis = null, pockets, bridged, source, statedDiameter, knownCavities, scaleBasis,
}) {
  if (!scaleBasis) return { confidence: 'none', notes: ['no scale basis'] };
  if (!pockets || !pockets.length) return { confidence: 'none', notes: ['no pocket found'] };
  if (source === 'pdf-raster') return { confidence: 'uncertain', notes: ['raster PDF: geometry is only approximate'] };
  if (!outer && !outerSynthesised) return { confidence: 'uncertain', notes: ['no outer outline'] };
  if (knownCavities != null && knownCavities !== pockets.length) {
    return { confidence: 'uncertain', notes: [`pocket count ${pockets.length} disagrees with ${knownCavities} cavities`] };
  }
  if (outerBasis === 'synthesised-bbox') {
    return { confidence: 'uncertain', notes: ['outer synthesised from the stated size and centred on the drawn loops (no rim or centre lines)'] };
  }
  if (outerBasis === 'promoted' && !outerFit) {
    return { confidence: 'uncertain', notes: ['outer is the largest loop but not a circle'] };
  }
  if (statedDiameter != null && outer && !outerSynthesised && NATIVE_SCALES.has(scaleBasis)) {
    const fitted = (outerFit || circleFit(outer.points)).r * 2;
    if (Math.abs(fitted - statedDiameter) > 2) return { confidence: 'uncertain', notes: ['outer disagrees with stated size'] };
  }
  const notes = [];
  if (bridged > 0) notes.push(`${bridged} gap${bridged === 1 ? '' : 's'} bridged`);
  if (outerSynthesised) notes.push('outer outline synthesised from the stated size');
  if (statedDiameter == null) notes.push('no stated size to check the outer against');
  if (!NATIVE_SCALES.has(scaleBasis)) notes.push('scale derived from the stated size, not native units');
  return { confidence: notes.length ? 'likely' : 'confirmed', notes };
}

module.exports = {
  chainLoops, polygonArea, centroid, bbox, pointInPolygon, polygonContains,
  circleFit, isCircleLike, robustCircle, isAxisRect, frameLoops, centreLineCrossing,
  classifyLoops, pocketGapMm, normaliseFrame, gradeConfidence, NATIVE_SCALES,
};
