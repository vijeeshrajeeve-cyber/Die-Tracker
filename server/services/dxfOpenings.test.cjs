'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFromDxf, sizeFromTexts, numbersFromTexts } = require('./dxfOpenings.cjs');
const { circleFit, bbox } = require('./openingGeometry.cjs');
const { dxfOf, circleEntity, line, rectLines } = require('./fixtures/tooling/dxfBuilders.cjs');

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
  assert.equal(r.confidence, 'likely');
  assert.ok(r.numbersInDrawing.includes('BOL-14017'));
  assert.ok(r.notes.some((n) => /inventory dims agree/.test(n)));
});
test('a size hint is used when the drawing has no size text, and reported as hint', () => {
  const r = extractFromDxf(dxfOf({ entities: [...rectLines(250, 150), ...rectLines(2000, 1500)] }), { sizeClass: '475X220' });
  // no circle-like loop → the 475 circle is synthesised at the loops' joint centre; the 2000x1500 frame is 'outside-outer'
  assert.equal(r.sizeClass, '475X220'); assert.equal(r.sizeClassSource, 'hint'); assert.equal(r.outerSynthesised, true);
  assert.equal(r.pockets.length, 1); assert.equal(r.confidence, 'likely');
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
