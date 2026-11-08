'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chainLoops, polygonArea, bbox, isCircleLike, circleFit, classifyLoops,
  pocketGapMm, normaliseFrame, gradeConfidence, robustCircle, isAxisRect, centreLineCrossing,
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
test('bridges a 2.5 mm gap and counts it', () => {
  const { loops, bridged } = chainLoops([seg(0, 0, 10, 0), seg(10, 0, 10, 10), seg(10, 10, 0, 10), seg(0, 10, 0, 2.5)]);
  assert.equal(loops.length, 1); assert.equal(bridged, 1);
});
test('does not bridge a 3.5 mm gap', () => {
  const { loops, open } = chainLoops([seg(0, 0, 10, 0), seg(10, 0, 10, 10), seg(10, 10, 0, 10), seg(0, 10, 0, 3.5)]);
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
  assert.deepEqual(r.ignored.map((i) => i.reason).sort(), ['fastener-hole', 'frame', 'rim-notch']);
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
test('a single loop with no expected diameter is a pocket, not the outer', () => {
  const r = classifyLoops([loop(roundedRect(60, 100, 5))]);
  assert.equal(r.outer, null); assert.equal(r.pockets.length, 1); assert.equal(r.outerSynthesised, false);
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

test('chains 3000 shuffled, half-reversed segments into 300 loops quickly', () => {
  const segs = [];
  for (let k = 0; k < 300; k++) {
    const pts = circle((k % 20) * 100, Math.floor(k / 20) * 100, 20, 10);
    for (let i = 0; i < 10; i++) {
      const a = pts[i]; const b = pts[(i + 1) % 10];
      segs.push((i + k) % 2 ? seg(b[0], b[1], a[0], a[1]) : seg(a[0], a[1], b[0], b[1]));
    }
  }
  let state = 12345;
  const rnd = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  for (let i = segs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [segs[i], segs[j]] = [segs[j], segs[i]]; }
  const t0 = Date.now();
  const { loops, open } = chainLoops(segs);
  const elapsedMs = Date.now() - t0;
  assert.equal(loops.length, 300); assert.equal(open.length, 0);
  assert.ok(elapsedMs < 2000, `took ${elapsedMs} ms`);
});

test('noOuterFallback keeps the only loop as a pocket instead of promoting it to outer', () => {
  const only = loop(roundedRect(250, 150, 15));
  const r = classifyLoops([only], { noOuterFallback: true });
  assert.equal(r.outer, null);
  assert.deepEqual(r.pockets, [only]);
});

// A rim drawn with its key slot: a circle of radius r with a w x d slot cut inwards at the top, as one loop.
const keyedRim = (r, w, d, n = 96) => {
  const half = Math.asin(w / 2 / r);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + half + ((2 * Math.PI - 2 * half) * i) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const y = r * Math.cos(half);
  pts.push([w / 2, y], [w / 2, y - d], [-w / 2, y - d]);
  return pts;
};

test('robustCircle accepts a rim with its key slot; isCircleLike does not; a rounded rectangle passes neither', () => {
  const rim = keyedRim(150, 24, 14);
  assert.equal(isCircleLike(rim), false);
  const fit = robustCircle(rim);
  assert.ok(fit && Math.abs(fit.r - 150) < 0.5 && Math.hypot(fit.cx, fit.cy) < 0.5);
  assert.equal(robustCircle(roundedRect(250, 150, 15)), null);
});

test('a keyed rim is the outer (rule 1), so off-centre pockets stay pockets and the frame is ignored', () => {
  const loops = [loop(translate(keyedRim(150, 24, 14), 0, 0)), loop(translate(rect(88.9, 63.8), -61, 0)), loop(translate(rect(88.9, 63.8), 61, 0)),
    loop(translate(rect(572, 405), -117, -22))];
  const r = classifyLoops(loops, { expectedOuterDiameter: 300 });
  assert.equal(r.outer, loops[0]); assert.equal(r.outerSynthesised, false); assert.equal(r.outerBasis, 'drawn-circle');
  assert.ok(Math.abs(r.outerFit.r * 2 - 300) < 1);
  assert.equal(r.pockets.length, 2);
  assert.deepEqual(r.ignored.map((i) => i.reason), ['frame']);
});

test('isAxisRect: 4-vertex axis-aligned rectangles only (collinear vertices ignored)', () => {
  assert.equal(isAxisRect(rect(400, 268)), true);
  assert.equal(isAxisRect([[0, 0], [200, 0], [400, 0], [400, 268], [0, 268]]), true);
  assert.equal(isAxisRect([[0, 0], [400, 10], [390, 278], [-10, 268]]), false);
  assert.equal(isAxisRect(roundedRect(250, 150, 15)), false);
});

test('a sheet frame is never promoted to outer; the loops inside it stay pockets', () => {
  const pocket = loop(rect(95, 95));
  const r = classifyLoops([loop(translate(rect(400, 268), 0, -18)), pocket]);
  assert.equal(r.outer, null);
  assert.deepEqual(r.pockets, [pocket]);
  assert.deepEqual(r.ignored.map((i) => i.reason), ['frame']);
});

test('a promoted outer that is not a circle grades uncertain', () => {
  const blob = [[-100, -80], [100, -90], [120, 0], [90, 85], [-110, 70]]; // not a rectangle, not a circle
  const r = classifyLoops([loop(blob), loop(rect(40, 40))]);
  assert.equal(r.outerBasis, 'promoted');
  const g = gradeConfidence({ outer: r.outer, outerSynthesised: false, outerFit: r.outerFit, outerBasis: r.outerBasis, pockets: r.pockets.map((p) => p.points), bridged: 0, source: 'dxf', statedDiameter: null, knownCavities: null, scaleBasis: 'native-mm' });
  assert.equal(g.confidence, 'uncertain');
});

test('a synthesised outer is centred on a drawn rim even when its size disagrees, noting it', () => {
  const loops = [loop(circle(10, 20, 150)), loop(translate(rect(60, 40), 70, 20))];
  const r = classifyLoops(loops, { expectedOuterDiameter: 400 });
  assert.equal(r.outerSynthesised, true); assert.equal(r.outerBasis, 'synthesised-rim');
  const b = bbox(r.outer.points); assert.ok(Math.abs(b.cx - 10) < 0.01 && Math.abs(b.cy - 20) < 0.01 && Math.abs(b.width - 400) < 0.1);
  assert.ok(r.notes.some((n) => /drawn rim Ø300 disagrees with the stated Ø400/.test(n)));
});

test('without a rim the synthesised outer is centred on the crossing centre lines', () => {
  const lines = [seg(-150, 5, 150, 5), seg(-20, -145, -20, 155)];
  assert.deepEqual(centreLineCrossing(lines, 0.6 * 475).map((v) => Math.round(v)), [-20, 5]);
  const r = classifyLoops([loop(translate(rect(100, 50), 60, 5))], { expectedOuterDiameter: 475, openChains: lines });
  assert.equal(r.outerBasis, 'synthesised-centre-lines');
  const b = bbox(r.outer.points); assert.ok(Math.abs(b.cx + 20) < 0.01 && Math.abs(b.cy - 5) < 0.01);
  assert.equal(centreLineCrossing([seg(-100, 0, 100, 0), seg(0, -100, 0, 100)], 0.6 * 475), null, 'too short for a Ø475');
  assert.equal(centreLineCrossing([seg(-150, 0, 150, 0), seg(140, -150, 140, 150)], 0.6 * 475), null, 'not crossing near the midpoints');
});

test('with neither rim nor centre lines the outer is centred on the loops (frames excluded) and grades uncertain', () => {
  const r = classifyLoops([loop(translate(rect(100, 50), 60, 5)), loop(translate(rect(2000, 1500), 300, 300))], { expectedOuterDiameter: 475 });
  assert.equal(r.outerBasis, 'synthesised-bbox');
  const b = bbox(r.outer.points); assert.ok(Math.abs(b.cx - 60) < 0.01 && Math.abs(b.cy - 5) < 0.01, 'the frame is not part of the centring box');
  const g = gradeConfidence({ outer: r.outer, outerSynthesised: true, outerFit: null, outerBasis: r.outerBasis, pockets: r.pockets.map((p) => p.points), bridged: 0, source: 'dxf', statedDiameter: 475, knownCavities: null, scaleBasis: 'native-mm' });
  assert.equal(g.confidence, 'uncertain');
});

test('native inch and feet drawings are native: no scale-derived note', () => {
  const base = { outer: loop(circle(0, 0, 87.5)), outerSynthesised: false, pockets: [loop(rect(50, 50))], bridged: 0, source: 'dxf', statedDiameter: 175, knownCavities: 1 };
  assert.deepEqual(gradeConfidence({ ...base, scaleBasis: 'native-inch' }), { confidence: 'confirmed', notes: [] });
  assert.deepEqual(gradeConfidence({ ...base, scaleBasis: 'native-feet' }), { confidence: 'confirmed', notes: [] });
});

test('normaliseFrame reports the offset it subtracted', () => {
  const { offset } = normaliseFrame({ outer: loop(circle(1140.9, 8380.4, 87.5)), pockets: [] });
  assert.ok(Math.abs(offset[0] - 1140.9) < 1e-6 && Math.abs(offset[1] - 8380.4) < 1e-6);
});

test('the centring rim and its concentric step are never pockets; a clean 1:n ratio is reported as drawingScale', () => {
  // I-05091 (cfceda23): Ø110 rim, Ø103 step, a 51 x 36 profile, stated Ø175 (ratio 1.59: not a clean scale)
  const loops = [loop(circle(0, 0, 55)), loop(circle(0, 0, 51.5)), loop(rect(51, 36))];
  const r = classifyLoops(loops, { expectedOuterDiameter: 175 });
  assert.equal(r.outerBasis, 'synthesised-rim');
  assert.deepEqual(r.pockets, [loops[2]]);
  assert.deepEqual(r.ignored.map((i) => i.reason).sort(), ['centring-rim', 'centring-rim']);
  assert.equal(r.drawingScale, null);
  assert.ok(r.notes.some((n) => /drawn rim Ø110 disagrees with the stated Ø175/.test(n)));
  const scaled = classifyLoops([loop(circle(0, 0, 475 / 6)), loop(rect(90, 30))], { expectedOuterDiameter: 475 });
  assert.equal(scaled.drawingScale, 3);
  assert.equal(scaled.pockets.length, 1);
  assert.ok(scaled.notes.some((n) => /at 1:3; outer centred on the rim/.test(n)));
});

test('cleanScale: 2..5 within 1 %, nothing else', () => {
  const { cleanScale } = require('./openingGeometry.cjs');
  assert.equal(cleanScale(475, 158.3), 3); assert.equal(cleanScale(440, 146.7), 3); assert.equal(cleanScale(220, 110), 2);
  assert.equal(cleanScale(300, 155.8), null, '1.93 is not 1:2'); assert.equal(cleanScale(175, 110), null);
  assert.equal(cleanScale(560, 460), null); assert.equal(cleanScale(600, 100), null, '1:6 is outside 2..5');
});

test('a narrow, elongated loop out towards the rim is a key slot; a result of key slots alone has no pocket', () => {
  const lines = [seg(-150, 0, 150, 0), seg(0, -150, 0, 150)];
  const slot = loop(translate(rect(14, 48), 0, 105));
  const pocket = loop(rect(128, 64));
  const r = classifyLoops([pocket, slot], { expectedOuterDiameter: 300, openChains: lines });
  assert.deepEqual(r.pockets, [pocket]);
  assert.deepEqual(r.ignored.map((i) => i.reason), ['key-slot']);
  const only = classifyLoops([loop(translate(rect(16, 47), 0, 106))], { expectedOuterDiameter: 300, openChains: lines });
  assert.deepEqual(only.pockets, []);
  const g = gradeConfidence({ outer: only.outer, outerSynthesised: true, outerBasis: only.outerBasis, pockets: [], bridged: 0, source: 'dxf', statedDiameter: 300, knownCavities: null, scaleBasis: 'native-mm' });
  assert.equal(g.confidence, 'none');
  // not a key slot: near the centre, or squat (the 13 x 8 at r 125 stays), or wide
  for (const [w, h, y] of [[14, 48, 40], [13, 8, 125], [24, 48, 105]]) {
    const k = classifyLoops([loop(translate(rect(w, h), 0, y))], { expectedOuterDiameter: 300, openChains: lines });
    assert.equal(k.pockets.length, 1, `${w} x ${h} at ${y}`);
  }
});

test('a rectangular pocket holding a small feature is not a frame; a sheet border holding two drawings is', () => {
  const pocket = loop(rect(300, 200));
  const feature = loop(rect(40, 40));
  const r = classifyLoops([pocket, feature], { expectedOuterDiameter: 475, openChains: [seg(-200, 0, 200, 0), seg(0, -200, 0, 200)] });
  assert.ok(r.pockets.includes(pocket), 'the 300 x 200 is a pocket');
  assert.ok(r.ignored.some((i) => i.loop === feature && i.reason === 'nested'));
  assert.ok(!r.ignored.some((i) => i.reason === 'frame'));
  // an A4 inner border (273 x 196) round a profile and a title-block symbol beside it, stated Ø475: a frame
  const border = loop(rect(273, 196));
  const s = classifyLoops([border, loop(translate(rect(200, 140), -20, 10)), loop(translate(rect(16, 16), 120, -85))], { expectedOuterDiameter: 475 });
  assert.ok(s.ignored.some((i) => i.loop === border && i.reason === 'frame'));
  // a double border: the outer holds the inner, which is a frame, so both are
  const outerBorder = loop(rect(287, 200));
  const d = classifyLoops([outerBorder, border, loop(translate(rect(200, 140), -20, 10)), loop(translate(rect(16, 16), 120, -85))], { expectedOuterDiameter: 475 });
  assert.equal(d.ignored.filter((i) => i.reason === 'frame').length, 2);
  // no expected diameter: larger than 1.2 x the largest loop it holds
  const big = loop(rect(400, 268));
  const n = classifyLoops([big, loop(rect(95, 95))]);
  assert.ok(n.ignored.some((i) => i.loop === big && i.reason === 'frame'));
});
