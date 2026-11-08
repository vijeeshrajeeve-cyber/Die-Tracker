const test = require('node:test');
const assert = require('node:assert/strict');
const { centroid } = require('./openingGeometry.cjs');
const {
  resampleByArcLength, minEnclosingCircle, toUnitFrame, signatureOf, signatureDistance, shapeStats,
} = require('./profileShape.cjs');

const sq = (s, cx = 0, cy = 0) => [[cx - s/2, cy - s/2], [cx + s/2, cy - s/2], [cx + s/2, cy + s/2], [cx - s/2, cy + s/2]];
const rot = (pts, deg) => { const a = deg * Math.PI / 180; return pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]); };
const circle = (r, n = 96) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]);
const lShape = (s) => [[0,0],[s,0],[s,s*0.3],[s*0.3,s*0.3],[s*0.3,s],[0,s]];

test('resampling keeps the perimeter and spaces points evenly', () => {
  const pts = resampleByArcLength(sq(10), 40);
  assert.equal(pts.length, 40);
  const d = pts.map((p, i) => Math.hypot(p[0] - pts[(i + 1) % 40][0], p[1] - pts[(i + 1) % 40][1]));
  assert.ok(Math.max(...d) - Math.min(...d) < 1e-9);
});
test('minimal enclosing circle of a square is its circumcircle', () => {
  const c = minEnclosingCircle(sq(10)); assert.ok(Math.abs(c.r - Math.SQRT2 * 5) < 1e-6 && Math.abs(c.cx) < 1e-9);
});
test('unit frame centres on the centroid and normalises RMS radius to 1', () => {
  const u = toUnitFrame({ outer: sq(10, 100, -40), holes: [] });
  const c = centroid(u.outer); assert.ok(Math.abs(c[0]) < 1e-9 && Math.abs(c[1]) < 1e-9);
  const rms = Math.sqrt(u.outer.reduce((s, [x, y]) => s + x * x + y * y, 0) / u.outer.length); assert.ok(Math.abs(rms - 1) < 1e-9);
  assert.deepEqual(u.centroid.map(Math.round), [100, -40]);
});
test('signature is invariant to rotation, scale, translation and start point', () => {
  const a = signatureOf({ outer: lShape(10), holes: [] });
  const moved = rot(lShape(30), 37).map(([x, y]) => [x + 500, y - 200]);
  const rolled = [...moved.slice(2), ...moved.slice(0, 2)];
  const b = signatureOf({ outer: rolled, holes: [] });
  assert.equal(a.length, 24); assert.ok(signatureDistance(a, b) < 0.02, `distance ${signatureDistance(a, b)}`);
});
test('mirror images are equal by design', () => {
  const a = signatureOf({ outer: lShape(10), holes: [] }); const b = signatureOf({ outer: lShape(10).map(([x, y]) => [-x, y]), holes: [] });
  assert.ok(signatureDistance(a, b) < 0.02);
});
test('different shapes are far apart', () => {
  const d1 = signatureDistance(signatureOf({ outer: sq(10), holes: [] }), signatureOf({ outer: circle(5), holes: [] }));
  const d2 = signatureDistance(signatureOf({ outer: lShape(10), holes: [] }), signatureOf({ outer: sq(10), holes: [] }));
  assert.ok(d1 > 0.05 && d2 > 0.1, `${d1} ${d2}`);
});
test('holes change the last three signature terms only', () => {
  const a = signatureOf({ outer: sq(10), holes: [] }); const b = signatureOf({ outer: sq(10), holes: [sq(4)] });
  assert.deepEqual(a.slice(0, 21), b.slice(0, 21)); assert.ok(b[22] > a[22] && b[23] > a[23]);
});
test('shapeStats: area, solidity, aspect ratio, hole count, ccd', () => {
  const s = shapeStats({ outer: lShape(10), holes: [sq(1, 1, 1)] });
  assert.ok(Math.abs(s.area - 51) < 1e-9); assert.equal(s.holeCount, 1); assert.ok(s.solidity < 1 && s.solidity > 0.5);
  assert.ok(Math.abs(s.ccd - Math.hypot(10, 10)) < 1e-6); assert.ok(s.aspectRatio >= 1);
});
