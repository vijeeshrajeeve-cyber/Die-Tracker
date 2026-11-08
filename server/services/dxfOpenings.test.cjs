'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFromDxf, sizeFromTexts, numbersFromTexts } = require('./dxfOpenings.cjs');
const { circleFit, bbox } = require('./openingGeometry.cjs');
const { dxfOf, circleEntity, line, rectLines, text, insert } = require('./fixtures/tooling/dxfBuilders.cjs');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'tooling', name), 'utf8');

test('Dieshop 21599: Ø175 outer, one pocket, bolt hole ignored, size 175X80 confirmed', () => {
  const r = extractFromDxf(fixture('dieshop-21599.dxf'));
  assert.equal(r.source, 'dxf'); assert.equal(r.scaleBasis, 'native-mm');
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 175) < 0.1);
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 51.5) < 0.5 && Math.abs(b.height - 52.0) < 0.5);
  assert.equal(r.cavities, 1); assert.equal(r.pocketGapMm, null);
  assert.equal(r.sizeClass, '175X80'); assert.equal(r.sizeClassSource, 'drawing-text'); assert.equal(r.sizeClassConfidence, 'confirmed');
  assert.equal(r.confidence, 'confirmed');
  assert.ok(r.numbersInDrawing.includes('I-21599'));
  const ob = bbox(r.outer); assert.ok(Math.abs(ob.cx) < 1e-6 && Math.abs(ob.cy) < 1e-6);
});
test('Dieshop 09658: Ø220, the rim keyway is not a pocket', () => {
  const r = extractFromDxf(fixture('dieshop-09658.dxf'));
  assert.equal(r.pockets.length, 1);
  // The brief said 62.5 x 105.9 (a vertex-only survey); the pocket is a bulged LWPOLYLINE whose true
  // bbox is 68.1 x 107.8, stable from 0.1 down to 0.01 mm chord tolerance.
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 68.1) < 0.5 && Math.abs(b.height - 107.8) < 0.5);
  assert.equal(r.sizeClass, '220X80'); assert.equal(r.confidence, 'confirmed');
});
test('bolster 14017: no outer drawn, size from MTEXT, outer synthesised, pocket 250x150', () => {
  const r = extractFromDxf(fixture('bolster-14017.dxf'), { inventoryDims: { a_len: 250, b_wid: 150 } });
  assert.equal(r.outerSynthesised, true);
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 475) < 0.01);
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 250) < 0.1 && Math.abs(b.height - 150) < 0.1);
  assert.equal(r.sizeClass, '475X220'); assert.equal(r.sizeClassSource, 'drawing-text');
  // No rim is drawn and its centre lines (222 and 287 mm) are not both longer than 60 % of Ø475, so the outer is
  // centred on the pocket's own bbox: that is a guess about where the die centre is, graded uncertain.
  assert.equal(r.confidence, 'uncertain');
  assert.ok(r.notes.some((n) => /centred on the drawn loops/.test(n)));
  assert.ok(r.numbersInDrawing.includes('BOL-14017'));
  assert.ok(r.notes.some((n) => /inventory dims agree/.test(n)));
});
test('a size hint is used when the drawing has no size text, and reported as hint', () => {
  const r = extractFromDxf(dxfOf({ entities: [...rectLines(250, 150), ...rectLines(2000, 1500)] }), { sizeClass: '475X220' });
  // no circle → the 475 circle is synthesised; the 2000x1500 rectangle holding everything is a frame, and with no
  // centre lines the outer is centred on the pocket's bbox, which grades uncertain
  assert.equal(r.sizeClass, '475X220'); assert.equal(r.sizeClassSource, 'hint'); assert.equal(r.outerSynthesised, true);
  assert.equal(r.pockets.length, 1); assert.equal(r.confidence, 'uncertain');
  const centred = extractFromDxf(dxfOf({ entities: [...rectLines(250, 150, 30, 0), ...rectLines(2000, 1500), line(-200, 0, 200, 0), line(0, -200, 0, 200)] }), { sizeClass: '475X220' });
  assert.equal(centred.confidence, 'likely');
  assert.ok(Math.abs(bbox(centred.pockets[0]).cx - 30) < 0.01, 'the pocket keeps its offset from the centre lines');
});
test('an inch drawing is scaled to millimetres', () => {
  const r = extractFromDxf(dxfOf({ insunits: 1, entities: [circleEntity(0, 0, 3.4449), ...rectLines(1, 1)] })); // Ø6.89" = 175 mm
  assert.equal(r.scaleBasis, 'native-inch');
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 175) < 0.1);
  assert.ok(Math.abs(bbox(r.pockets[0]).width - 25.4) < 0.01);
});
test('outline-only size class: outer diameter known, thickness unknown → no size class, note', () => {
  const r = extractFromDxf(dxfOf({ entities: [circleEntity(0, 0, 87.5), ...rectLines(50, 50)] }));
  assert.equal(r.sizeClass, null); assert.equal(r.sizeClassSource, null);
  assert.equal(r.confidence, 'likely');
  assert.ok(r.notes.some((n) => /thickness/.test(n)));
});
test('pocket count disagreeing with the known cavities is uncertain', () => {
  const r = extractFromDxf(fixture('dieshop-21599.dxf'), { cavities: 2 });
  assert.equal(r.confidence, 'uncertain');
});
test('no closed pocket → none', () => {
  const r = extractFromDxf(dxfOf({ entities: [circleEntity(0, 0, 87.5), line(0, 0, 10, 10)] }));
  assert.equal(r.confidence, 'none'); assert.deepEqual(r.pockets, []);
});
test('a malformed size hint is ignored with a note', () => {
  const withText = extractFromDxf(fixture('dieshop-21599.dxf'), { sizeClass: 'garbage' });
  assert.equal(withText.sizeClass, '175X80');
  assert.ok(withText.notes.some((n) => /malformed size hint/.test(n)));
  const noText = extractFromDxf(dxfOf({ entities: [circleEntity(0, 0, 87.5), ...rectLines(50, 50)] }), { sizeClass: 'garbage' });
  assert.equal(noText.sizeClass, null);
  assert.ok(noText.notes.some((n) => /malformed size hint/.test(n)));
});
test('numbersFromTexts parses tokens only', () => {
  assert.deepEqual(numbersFromTexts(['BOL-14017 475X220', 'Insert No.', '21599', 'Ø175 x 80']), ['BOL-14017', 'I-21599']);
});

// ---- regression fixtures from the full-archive review ----------------------------------------------------------------

test('I-10163: the rim drawn with its key slot is the outer; two pockets at ±61 mm, size 300X100', () => {
  const r = extractFromDxf(fixture('insert-10163-keyed-rim.dxf'));
  assert.equal(r.outerSynthesised, false);
  const ob = bbox(r.outer); assert.ok(Math.abs(Math.max(ob.width, ob.height) - 300) < 2, `outer ${ob.width} x ${ob.height}`);
  assert.equal(r.pockets.length, 2);
  const boxes = r.pockets.map(bbox).sort((a, b) => a.cx - b.cx);
  for (const [b, x] of [[boxes[0], -61], [boxes[1], 61]]) {
    assert.ok(Math.abs(b.width - 88.9) < 2 && Math.abs(b.height - 63.8) < 2, `pocket ${b.width} x ${b.height}`);
    assert.ok(Math.abs(b.cx - x) < 2 && Math.abs(b.cy) < 2, `pocket at ${b.cx}, ${b.cy}`);
  }
  assert.equal(r.sizeClass, '300X100');
  assert.ok(['confirmed', 'likely'].includes(r.confidence), r.confidence);
  assert.deepEqual(r.numbersInDrawing, ['I-10163'], 'INS-10163 is read; BOL:(ALV-14)45-48 and BOL. are not numbers');
});

test('BOL-25B1C1A: keyed Ø474 rim inside a double sheet frame; one 324.8 x 245 pocket, no title-block cells', () => {
  const r = extractFromDxf(fixture('bolster-25B1C1A-frame.dxf'), { sizeClass: '475X335' });
  assert.equal(r.outerSynthesised, false);
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 324.8) < 2 && Math.abs(b.height - 245) < 2, `pocket ${b.width} x ${b.height}`);
  assert.ok(Math.hypot(b.cx, b.cy) < 2);
  assert.equal(r.sizeClass, '475X335');
});

test('I-15296: a frame-only drawing has no outer; the real pocket is kept and the result is uncertain', () => {
  const r = extractFromDxf(fixture('insert-15296-frame-only.dxf'));
  assert.equal(r.outer, null);
  assert.ok(r.pockets.some((p) => { const b = bbox(p); return Math.abs(b.width - 95) < 1 && Math.abs(b.height - 95) < 1; }));
  assert.equal(r.confidence, 'uncertain');
  assert.ok(!r.pockets.some((p) => Math.max(bbox(p).width, bbox(p).height) > 300), 'the 400 x 268 frame is not a pocket');
});

test('a pocket under a tenth of the largest one caps the result at uncertain when the cavity count is unknown', () => {
  const entities = [circleEntity(0, 0, 150), ...rectLines(120, 80, -20, 0), ...rectLines(12, 15, 100, 0), text('Ø300x100', 400, 0)];
  const r = extractFromDxf(dxfOf({ entities }));
  assert.equal(r.pockets.length, 2); assert.equal(r.confidence, 'uncertain');
  assert.ok(r.notes.some((n) => /under a tenth/.test(n)));
  const big = extractFromDxf(dxfOf({ entities: [circleEntity(0, 0, 150), ...rectLines(80, 60, -50, 0), ...rectLines(70, 50, 50, 0), text('Ø300x100', 400, 0)] }));
  assert.equal(big.confidence, 'confirmed', 'two real cavities are not junk');
});

test('sizeFromTexts: boundary, plausibility, sheet sizes, and every distinct candidate', () => {
  assert.equal(sizeFromTexts(['8023.700X200']), null);
  assert.equal(sizeFromTexts(['A3 420x297']), null);
  assert.equal(sizeFromTexts(['SHEET A2 594X420']), null);
  assert.equal(sizeFromTexts(['Ø2000x300']), null, 'diameter above 1500');
  assert.equal(sizeFromTexts(['Ø300x5']), null, 'thickness below 10');
  assert.equal(sizeFromTexts(['250X300']), null, 'thickness not below the diameter');
  const one = sizeFromTexts(['Ø175 x 80', 'INSERT Ø175X80']);
  assert.equal(one.sizeClass, '175X80'); assert.deepEqual(one.candidates, ['175X80']);
  const two = sizeFromTexts(['BOL-14017 475X220', 'POCKET 250 x 150']);
  assert.equal(two.sizeClass, '475X220'); assert.deepEqual(two.candidates, ['475X220', '250X150']);
});

test('two different plausible size texts cap the result at uncertain with a note naming them', () => {
  const r = extractFromDxf(dxfOf({ entities: [circleEntity(0, 0, 87.5), ...rectLines(50, 50), text('Ø175x80', 300, 0), text('Ø220x80', 300, 20)] }));
  assert.equal(r.sizeClass, '175X80'); assert.equal(r.confidence, 'uncertain');
  assert.ok(r.notes.includes('several size texts: 175X80, 220X80'));
});

test('a reader warning is noted and caps the result at uncertain', () => {
  const blocks = { MARK: [line(0, 0, 1, 0)] };
  const r = extractFromDxf(dxfOf({ blocks, entities: [circleEntity(0, 0, 87.5), ...rectLines(50, 50), text('Ø175x80', 300, 0), insert('MARK', 500, 0, 1, 0, { normal: -1 })] }));
  assert.equal(r.confidence, 'uncertain');
  assert.ok(r.notes.includes('block reference on a mirrored or tilted OCS left untransformed'));
});

test('an inch drawing is native: no scale-derived note, and meta records the unit scale and offset', () => {
  const r = extractFromDxf(dxfOf({ insunits: 1, entities: [circleEntity(10, 0, 3.4449), ...rectLines(1, 1, 10, 0), text('Ø175x80', 0, 10)] }));
  assert.ok(!r.notes.some((n) => /scale derived/.test(n)));
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.meta.scaleBasis, 'native-inch'); assert.equal(r.meta.mmPerUnit, 25.4); assert.equal(r.meta.outerSynthesised, false);
  assert.ok(Math.abs(r.meta.offset[0] - 254) < 0.01 && Math.abs(r.meta.offset[1]) < 0.01);
});

test('numbersFromTexts reads INS-nnnnn and ignores BOL words without digits', () => {
  assert.deepEqual(numbersFromTexts(['INS-10163', 'BOL. No:', 'BOLSTER', 'BOL:(ALV-14)45-48 HRC']), ['I-10163']);
});

// ---- regression fixtures from the final re-review (v2 bundle) --------------------------------------------------------

test('BOL-2-1-H: a 1:3 drawing - the Ø158.3 centring rim is not a pocket, the 90 x 30 profile is; capped uncertain', () => {
  const r = extractFromDxf(fixture('bolster-BOL-2-1-H-1to3.dxf'), { sizeClass: '475X220' });
  assert.equal(r.outerSynthesised, true);
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 475) < 0.01, 'the outer is the stated size, not rescaled');
  assert.equal(r.pockets.length, 1);
  assert.ok(!r.pockets.some((p) => { const b = bbox(p); return Math.abs(b.width - 158.3) < 2 && Math.abs(b.height - 158.3) < 2; }),
    'the Ø158.3 rim is not a pocket');
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 90) < 0.5 && Math.abs(b.height - 30) < 0.5, `pocket ${b.width} x ${b.height}`);
  assert.equal(r.confidence, 'uncertain');
  assert.ok(r.notes.includes('drawing appears to be at 1:3 scale; geometry not rescaled'));
});

test('I-05091: the drawn Ø175 is the outer and its 110 x 68.4 pocket is kept (a drawn outer is never a centring rim)', () => {
  const r = extractFromDxf(fixture('insert-05091-drawn-outer.dxf'), { sizeClass: '175X80' });
  assert.equal(r.outerSynthesised, false);
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 175) < 0.5);
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 110) < 0.5 && Math.abs(b.height - 68.4) < 0.5, `pocket ${b.width} x ${b.height}`);
  assert.equal(r.confidence, 'confirmed');
  assert.ok(!r.notes.some((n) => /rim|scale/.test(n)));
});

test('I-13608: the 14 x 48 key slot at r 105 is not a cavity; one pocket', () => {
  const r = extractFromDxf(fixture('insert-13608-key-slot.dxf'));
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 128.2) < 0.5 && Math.abs(b.height - 63.7) < 0.5, `pocket ${b.width} x ${b.height}`);
  assert.equal(r.cavities, 1);
});

test('I-16215: a drawing whose only pocket candidate is the key slot has no pocket', () => {
  const r = extractFromDxf(fixture('insert-16215-key-slot-only.dxf'), { sizeClass: '300X100' });
  assert.equal(r.pockets.length, 0);
  assert.equal(r.confidence, 'none');
});
