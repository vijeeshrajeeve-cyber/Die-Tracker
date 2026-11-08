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

// noOuterFallback: with no expected diameter and no circle, do not promote the largest loop to outer
// (an outline-only drawing, e.g. a scan, has pockets and no outer).
function classifyLoops(loops, { expectedOuterDiameter = null, noOuterFallback = false } = {}) {
  const ignored = [];
  let outer = null;
  let outerSynthesised = false;

  // Rule 1: the outer is a circle-like loop of at least 100 mm diameter.
  const circles = loops
    .map((l) => ({ l, fit: isCircleLike(l.points) ? circleFit(l.points) : null }))
    .filter((c) => c.fit && c.fit.r * 2 >= 100);
  if (circles.length) {
    if (expectedOuterDiameter) {
      const off = (c) => Math.abs(c.fit.r * 2 - expectedOuterDiameter);
      circles.sort((a, b) => off(a) - off(b));
      if (off(circles[0]) <= 0.1 * expectedOuterDiameter) outer = circles[0].l;
    } else {
      circles.sort((a, b) => b.fit.r - a.fit.r);
      outer = circles[0].l;
    }
  }

  // Rule 2: no qualifying circle.
  if (!outer && loops.length) {
    if (expectedOuterDiameter) {
      const b = bbox(loops.flatMap((l) => l.points));
      outer = { points: synthesiseCircle(b.cx, b.cy, expectedOuterDiameter), layer: '', bridgedGaps: 0, sources: [] };
      outerSynthesised = true;
    } else if (!noOuterFallback) {
      const largest = loops.reduce((m, l) => (polygonArea(l.points) > polygonArea(m.points) ? l : m));
      if (loops.length >= 2 && loops.every((l) => l === largest || polygonContains(largest.points, l.points))) outer = largest;
    }
  }

  let rest = loops.filter((l) => l !== outer);
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

  return { outer, outerSynthesised, pockets, ignored };
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

function normaliseFrame({ outer, pockets }) {
  const ref = outer ? outer.points : pockets.flatMap((p) => p.points);
  if (!ref.length) return { outer, pockets };
  const { cx, cy } = bbox(ref);
  const shift = (l) => ({ ...l, points: l.points.map(([x, y]) => [x - cx, y - cy]) });
  return { outer: outer ? shift(outer) : outer, pockets: pockets.map(shift) };
}

// ---- confidence ------------------------------------------------------------

const NATIVE_SCALE = 'native-mm';

function gradeConfidence({ outer, outerSynthesised, pockets, bridged, source, statedDiameter, knownCavities, scaleBasis }) {
  if (!scaleBasis) return { confidence: 'none', notes: ['no scale basis'] };
  if (!pockets || !pockets.length) return { confidence: 'none', notes: ['no pocket found'] };
  if (source === 'pdf-raster') return { confidence: 'uncertain', notes: ['raster PDF: geometry is only approximate'] };
  if (!outer && !outerSynthesised) return { confidence: 'uncertain', notes: ['no outer outline'] };
  if (knownCavities != null && knownCavities !== pockets.length) {
    return { confidence: 'uncertain', notes: [`pocket count ${pockets.length} disagrees with ${knownCavities} cavities`] };
  }
  if (statedDiameter != null && outer && !outerSynthesised && scaleBasis === NATIVE_SCALE) {
    const fitted = circleFit(outer.points).r * 2;
    if (Math.abs(fitted - statedDiameter) > 2) return { confidence: 'uncertain', notes: ['outer disagrees with stated size'] };
  }
  const notes = [];
  if (bridged > 0) notes.push(`${bridged} gap${bridged === 1 ? '' : 's'} bridged`);
  if (outerSynthesised) notes.push('outer outline synthesised from the stated size');
  if (statedDiameter == null) notes.push('no stated size to check the outer against');
  if (scaleBasis !== NATIVE_SCALE) notes.push('scale derived from the stated size, not native units');
  return { confidence: notes.length ? 'likely' : 'confirmed', notes };
}

module.exports = {
  chainLoops, polygonArea, centroid, bbox, pointInPolygon, polygonContains,
  circleFit, isCircleLike, classifyLoops, pocketGapMm, normaliseFrame, gradeConfidence,
};
