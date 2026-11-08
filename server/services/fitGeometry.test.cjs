'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resampleClosed, signedDistanceGrid, sampleGrid, exactClearance, bestPlacement,
} = require('./fitGeometry.cjs');

const circle = (r, n = 90, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
const rect = (w, h, cx = 0, cy = 0) => [[cx - w/2, cy - h/2], [cx + w/2, cy - h/2], [cx + w/2, cy + h/2], [cx - w/2, cy + h/2]];
const lShape = (s) => [[0,0],[s,0],[s,s*0.3],[s*0.3,s*0.3],[s*0.3,s],[0,s]].map(([x, y]) => [x - s*0.35, y - s*0.35]);

test('resampleClosed keeps vertices and caps the spacing', () => {
  const pts = resampleClosed(rect(100, 40), 2);
  assert.ok(pts.some(([x, y]) => x === 50 && y === 20));
  for (let i = 0; i < pts.length; i++) { const [a, b] = [pts[i], pts[(i + 1) % pts.length]]; assert.ok(Math.hypot(a[0]-b[0], a[1]-b[1]) <= 2 + 1e-9); }
});
test('signed distance grid is positive inside, negative outside, ~0 on the edge', () => {
  const g = signedDistanceGrid(circle(50), { cellMm: 2 });
  assert.ok(Math.abs(sampleGrid(g, 0, 0) - 50) < 1.5); assert.ok(sampleGrid(g, 60, 0) < -8); assert.ok(Math.abs(sampleGrid(g, 50, 0)) < 1.5);
});
test('exactClearance: inside gives the wall distance, outside is negative', () => {
  assert.ok(Math.abs(exactClearance(circle(40), circle(50)) - 10) < 0.1);
  assert.ok(exactClearance(circle(60), circle(50)) < 0);
});
test('a circle in a circle: clearance is the radius gap at any angle', () => {
  const r = bestPlacement(resampleClosed(circle(40)), circle(50));
  assert.ok(Math.abs(r.clearance - 10) < 0.2, String(r.clearance)); assert.ok(Math.hypot(r.placement.tx, r.placement.ty) < 0.5);
});
test('a square in a circle: clearance is (D − diagonal) / 2', () => {
  const r = bestPlacement(resampleClosed(rect(60, 60)), circle(50));
  assert.ok(Math.abs(r.clearance - (50 - 30 * Math.SQRT2)) < 0.3, String(r.clearance));
});
test('a bar that only fits rotated is placed at 90°', () => {
  const r = bestPlacement(resampleClosed(rect(120, 40)), rect(60, 140));
  assert.ok(r, 'must fit'); assert.ok(Math.abs(r.clearance - 10) < 0.3, String(r.clearance));
  const deg = ((r.placement.theta * 180 / Math.PI) % 180 + 180) % 180; assert.ok(Math.abs(deg - 90) < 3, String(deg));
});
test('a pocket away from the origin is found', () => {
  const r = bestPlacement(resampleClosed(circle(30)), circle(40, 90, 200, -50));
  assert.ok(r); assert.ok(Math.abs(r.placement.tx - 200) < 0.5 && Math.abs(r.placement.ty + 50) < 0.5); assert.ok(Math.abs(r.clearance - 10) < 0.2);
});
test('too big or too tight returns null', () => {
  assert.equal(bestPlacement(resampleClosed(circle(48)), circle(50)), null);   // 2 mm < 5 mm
  assert.equal(bestPlacement(resampleClosed(lShape(120)), circle(50)), null);
});
test('a tight non-convex fit: the L-shape in a slightly larger L-shaped pocket', () => {
  // The pocket's arms are 30 mm wide; at 0.6 the profile's arms are 18 mm, so the best clearance is 6 mm.
  const pocket = lShape(100); const profile = resampleClosed(lShape(100).map(([x, y]) => [x * 0.6, y * 0.6]));
  const r = bestPlacement(profile, pocket); assert.ok(r, 'fits'); assert.ok(r.clearance >= 5 && r.clearance < 8, String(r.clearance));
});
test('speed: 150-point profile against a 100-point pocket under 60 ms', () => {
  const profile = resampleClosed(lShape(60), 2); const pocket = circle(60, 100);
  const t0 = performance.now(); bestPlacement(profile, pocket); assert.ok(performance.now() - t0 < 60);
});
test('an unresampled profile cannot straddle a thin pocket spike', () => {
  // 80 x 30 pocket with a 2 mm wide spike rising 26 mm from the bottom wall,
  // right through a raw 4-vertex 60 x 10 bar centred on it: no vertex of either
  // outline is inside the other, and every bar vertex is 10 mm from a wall.
  const pocket = [[-40,-15],[-1,-15],[-1,11],[1,11],[1,-15],[40,-15],[40,15],[-40,15]];
  const raw = rect(60, 10);
  assert.ok(exactClearance(raw, pocket) >= 5, 'raw, the crossing goes unseen');
  assert.ok(exactClearance(resampleClosed(raw), pocket) < 0, 'resampled, the crossing is seen');
  assert.equal(bestPlacement(raw, pocket), null);
});
test('exact clearance measures a pocket tooth tip between two profile samples', () => {
  // Profile samples on the bottom edge sit at even x; the tooth tip (1, −15) is
  // 5 mm below the edge, midway between samples at (0, −10) and (2, −10).
  const pocket = [[-30,-20],[-3,-20],[1,-15],[5,-20],[30,-20],[30,20],[-30,20]];
  const c = exactClearance(resampleClosed(rect(40, 20)), pocket);
  assert.ok(Math.abs(c - 5) < 0.01, String(c));
});
