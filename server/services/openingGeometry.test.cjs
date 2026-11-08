'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chainLoops, polygonArea, bbox, isCircleLike, circleFit, classifyLoops,
  pocketGapMm, normaliseFrame, gradeConfidence,
} = require('./openingGeometry.cjs');

const seg = (x1, y1, x2, y2) => ({ layer: '0', points: [[x1, y1], [x2, y2]], closed: false, source: 'LINE' });
const circle = (cx, cy, r, n = 64) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
const rect = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
const roundedRect = (w, h, r) => {
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = ((start + (90 * i) / 8) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
};
const translate = (points, dx, dy) => points.map(([x, y]) => [x + dx, y + dy]);
const loop = (points) => ({ points, layer: '0', bridgedGaps: 0, sources: [] });

test('joins segments whose ends are within 0.5 mm into one closed loop', () => {
  const sq = [seg(0, 0, 10, 0), seg(10.3, 0, 10, 10), seg(10, 10.2, 0, 10), seg(0, 10, 0, 0.4)];
  const { loops, open, bridged } = chainLoops(sq);
  assert.equal(loops.length, 1); assert.equal(open.length, 0); assert.equal(bridged, 0);
  assert.ok(Math.abs(polygonArea(loops[0].points) - 100) < 5);
});
test('bridges a 1.5 mm gap and counts it', () => {
  const { loops, bridged } = chainLoops([seg(0, 0, 10, 0), seg(10, 0, 10, 10), seg(10, 10, 0, 10), seg(0, 10, 0, 1.5)]);
  assert.equal(loops.length, 1); assert.equal(bridged, 1); assert.equal(loops[0].bridgedGaps, 1);
});
test('does not bridge a 15 mm gap', () => {
  const { loops, open } = chainLoops([seg(0, 0, 100, 0), seg(100, 0, 100, 100), seg(100, 100, 0, 100), seg(0, 100, 0, 15)]);
  assert.equal(loops.length, 0); assert.equal(open.length, 1);
});
test('a circle is circle-like, a rounded rectangle is not', () => {
  assert.equal(isCircleLike(circle(0, 0, 87.5, 64)), true);
  assert.equal(isCircleLike(roundedRect(250, 150, 15)), false);
});
test('classifies outer, pocket, fastener hole and rim notch; the larger drawing frame is not the outer', () => {
  const loops = [loop(circle(0, 0, 110)), loop(circle(0, 75, 5)), loop(roundedRect(60, 100, 5)), loop(translate(rect(24, 14), 98, 0)), loop(translate(rect(390, 280), 40, 30))];
  const r = classifyLoops(loops, { expectedOuterDiameter: 220 });
  assert.equal(r.outer, loops[0]); assert.equal(r.outerSynthesised, false);
  assert.deepEqual(r.pockets, [loops[2]]);
  assert.deepEqual(r.ignored.map((i) => i.reason).sort(), ['fastener-hole', 'outside-outer', 'rim-notch']);
  assert.equal(classifyLoops(loops).outer, loops[0], 'without an expected diameter the circle still wins over the frame');
});
test('a single open chain whose own ends meet closes on itself (the Dieshop pocket polyline)', () => {
  const pts = circle(0, 0, 25, 40); // open chain, first and last points 0.0 apart once repeated
  const { loops } = chainLoops([{ layer: 'Layer3', points: [...pts, pts[0]], closed: false, source: 'LWPOLYLINE' }]);
  assert.equal(loops.length, 1); assert.equal(loops[0].points.length, 40);
});
test('synthesises the outer from the expected diameter when none is drawn', () => {
  const r = classifyLoops([loop(roundedRect(250, 150, 15))], { expectedOuterDiameter: 475 });
  assert.equal(r.outerSynthesised, true);
  assert.ok(Math.abs(circleFit(r.outer.points).r - 237.5) < 0.01);
  assert.equal(r.pockets.length, 1);
});
test('a loop inside a pocket is nested, not a second pocket', () => {
  const r = classifyLoops([loop(circle(0, 0, 110)), loop(rect(80, 80)), loop(rect(20, 20))]);
  assert.equal(r.pockets.length, 1); assert.equal(r.ignored[0].reason, 'nested');
});
test('pocket gap is the nearest centroid distance; null for one pocket', () => {
  assert.equal(pocketGapMm([loop(rect(10, 10))]), null);
  assert.ok(Math.abs(pocketGapMm([loop(translate(rect(10, 10), -28, 0)), loop(translate(rect(10, 10), 28, 0))]) - 56) < 1e-9);
});
test('normaliseFrame centres the outer bbox at the origin', () => {
  const { outer } = normaliseFrame({ outer: loop(circle(1140.9, 8380.4, 87.5)), pockets: [] });
  const b = bbox(outer.points); assert.ok(Math.abs(b.cx) < 1e-6 && Math.abs(b.cy) < 1e-6);
});
test('grades confidence', () => {
  const base = { outer: loop(circle(0, 0, 87.5)), outerSynthesised: false, pockets: [loop(rect(50, 50))], bridged: 0, source: 'dxf', statedDiameter: 175, knownCavities: 1, scaleBasis: 'native-mm' };
  assert.equal(gradeConfidence(base).confidence, 'confirmed');
  assert.equal(gradeConfidence({ ...base, statedDiameter: null }).confidence, 'likely');
  assert.equal(gradeConfidence({ ...base, bridged: 1 }).confidence, 'likely');
  assert.equal(gradeConfidence({ ...base, outerSynthesised: true }).confidence, 'likely');
  assert.equal(gradeConfidence({ ...base, knownCavities: 2 }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, statedDiameter: 190 }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, outer: null, outerSynthesised: false }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, source: 'pdf-raster', scaleBasis: 'inventory-dims' }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, source: 'pdf-vector', scaleBasis: 'text-diameter' }).confidence, 'likely', 'a drawing scaled from its own size text cannot confirm that size');
  assert.equal(gradeConfidence({ ...base, pockets: [] }).confidence, 'none');
  assert.equal(gradeConfidence({ ...base, scaleBasis: null }).confidence, 'none');
});
