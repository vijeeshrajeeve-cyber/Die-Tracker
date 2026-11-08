'use strict';
// Pure shape geometry for the profile library: unit frame, resampling and the
// 24-number similarity signature. Polygons are Array<[x, y]>, no repeated closing point.
const { polygonArea, centroid } = require('./openingGeometry.cjs');

const SAMPLES = 128;
const FOURIER_TERMS = 20;
const ASPECT_CAP = 10;
const HOLE_CAP = 8;

function resampleByArcLength(points, n = SAMPLES) {
  const m = points.length;
  const cum = [0];
  for (let i = 0; i < m; i++) {
    const a = points[i];
    const b = points[(i + 1) % m];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[m];
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n;
    while (seg < m - 1 && cum[seg + 1] <= target) seg++;
    const a = points[seg];
    const b = points[(seg + 1) % m];
    const len = cum[seg + 1] - cum[seg];
    const t = len > 0 ? (target - cum[seg]) / len : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return build(pts).concat(build(pts.slice().reverse()));
}

// Welzl-style move-to-front over the hull points (recursive, expected linear).
function minEnclosingCircle(points) {
  const pts = convexHull(points);
  const circ2 = (a, b) => ({ cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 });
  const circ3 = (a, b, c) => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) {
      const cands = [circ2(a, b), circ2(a, c), circ2(b, c)];
      return cands.reduce((m, x) => (x.r > m.r ? x : m));
    }
    const a2 = a[0] ** 2 + a[1] ** 2;
    const b2 = b[0] ** 2 + b[1] ** 2;
    const c2 = c[0] ** 2 + c[1] ** 2;
    const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
    const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
  };
  const inside = (c, p) => Math.hypot(p[0] - c.cx, p[1] - c.cy) <= c.r + 1e-9;
  let c = { cx: pts[0][0], cy: pts[0][1], r: 0 };
  for (let i = 1; i < pts.length; i++) {
    if (inside(c, pts[i])) continue;
    c = { cx: pts[i][0], cy: pts[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(c, pts[j])) continue;
      c = circ2(pts[i], pts[j]);
      for (let k = 0; k < j; k++) {
        if (!inside(c, pts[k])) c = circ3(pts[i], pts[j], pts[k]);
      }
    }
  }
  return c;
}

function toUnitFrame({ outer, holes = [] }) {
  const c = centroid(outer);
  const rms = Math.sqrt(outer.reduce((s, p) => s + (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2, 0) / outer.length);
  const scale = rms > 0 ? rms : 1;
  const map = (poly) => poly.map((p) => [(p[0] - c[0]) / scale, (p[1] - c[1]) / scale]);
  return { outer: map(outer), holes: holes.map(map), centroid: [c[0], c[1]], scale };
}

function aspectOf(points) {
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const p of points) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let sxx = 0; let syy = 0; let sxy = 0;
  for (const p of points) {
    const dx = p[0] - mx; const dy = p[1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const half = (sxx + syy) / 2;
  const diff = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  const l1 = half + diff;
  const l2 = half - diff;
  return l2 > 1e-12 * Math.max(l1, 1e-300) ? Math.sqrt(l1 / l2) : Infinity;
}

function centroidDistances(outer) {
  const pts = resampleByArcLength(outer, SAMPLES);
  const c = centroid(outer);
  return { pts, r: pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])) };
}

function shapeStats({ outer, holes = [] }) {
  const area = polygonArea(outer);
  const holeArea = holes.reduce((s, h) => s + polygonArea(h), 0);
  const hullArea = polygonArea(convexHull(outer));
  const { pts } = centroidDistances(outer);
  return {
    area,
    holeArea,
    solidity: hullArea > 0 ? area / hullArea : 1,
    aspectRatio: aspectOf(pts),
    holeCount: holes.length,
    ccd: 2 * minEnclosingCircle(outer).r,
  };
}

function signatureOf({ outer, holes = [] }) {
  const u = toUnitFrame({ outer, holes });
  const { pts, r } = centroidDistances(u.outer);
  const n = r.length;
  const r0 = r.reduce((s, v) => s + v, 0);
  const sig = [];
  for (let k = 1; k <= FOURIER_TERMS; k++) {
    let re = 0; let im = 0;
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * k * i) / n;
      re += r[i] * Math.cos(ang);
      im -= r[i] * Math.sin(ang);
    }
    sig.push(Math.hypot(re, im) / r0);
  }
  const area = polygonArea(u.outer);
  const hullArea = polygonArea(convexHull(u.outer));
  const holeArea = u.holes.reduce((s, h) => s + polygonArea(h), 0);
  sig.push(Math.min(aspectOf(pts), ASPECT_CAP) / ASPECT_CAP);
  sig.push(hullArea > 0 ? area / hullArea : 1);
  sig.push(area > 0 ? holeArea / area : 0);
  sig.push(Math.min(holes.length, HOLE_CAP) / HOLE_CAP);
  return sig;
}

function signatureDistance(a, b) {
  if (a.length !== b.length) throw new Error(`signature length mismatch: ${a.length} vs ${b.length}`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

module.exports = {
  resampleByArcLength, convexHull, minEnclosingCircle, toUnitFrame,
  signatureOf, signatureDistance, shapeStats,
};
