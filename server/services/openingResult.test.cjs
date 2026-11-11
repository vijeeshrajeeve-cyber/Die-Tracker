'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { statedScales, scaleFromTexts, reductionOf, buildExtractionResult } = require('./openingResult.cjs');
const { bbox } = require('./openingGeometry.cjs');

const circle = (cx, cy, r, n = 64) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
const rect = (w, h, cx = 0, cy = 0) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
// A rectangle with its corners cut off: a plain rectangle holding everything would be read as a sheet frame.
const chamfered = (w, h, c = 35) => [[-w / 2 + c, -h / 2], [w / 2 - c, -h / 2], [w / 2, -h / 2 + c], [w / 2, h / 2 - c],
  [w / 2 - c, h / 2], [-w / 2 + c, h / 2], [-w / 2, h / 2 - c], [-w / 2, -h / 2 + c]];
const loop = (points) => ({ points, layer: '0', bridgedGaps: 0, sources: [] });

test('scaleFromTexts: one stated reduction, label and ratio together or apart', () => {
  assert.equal(scaleFromTexts(['SCALE :', '1 : 2']), 2);
  assert.equal(scaleFromTexts(['SCALE :', 'DATE :', 'DRAWN BY :', '1:3', 'Ulhas']), 3, 'the ratio is not always the next text');
  assert.equal(scaleFromTexts(['SCALE : 1:3']), 3);
  assert.equal(scaleFromTexts(['Scale 1/2']), 2);
  assert.equal(scaleFromTexts(['SCALA', '1:1']), null);
  assert.equal(scaleFromTexts(['1 : 2']), null, 'no SCALE label');
  assert.equal(scaleFromTexts(['SCALA', '1:1', 'SCALA LOCALE 0.5']), null, 'two different scales');
  assert.equal(scaleFromTexts(['SCALE :', '2 : 1']), null, 'an enlargement');
  assert.equal(scaleFromTexts(['SCALE :', '11:30']), null, 'a time is not a scale');
  assert.deepEqual([...statedScales(['SCALA', '1:1', 'SCALA LOCALE 0.5'])].sort(), [1, 2]);
});

test('reductionOf: a rim at a clean 1:n counts only when the drawing states that scale', () => {
  const rim = [loop(circle(0, 0, 475 / 6)), loop(rect(90, 30))];
  assert.deepEqual(reductionOf(rim, { expectedDiameter: 475, texts: ['SCALE :', '1 : 3'] }), { n: 3, basis: 'rim' });
  assert.equal(reductionOf(rim, { expectedDiameter: 475, texts: [] }), null, 'a round pocket a third of the die is not a scale');
  assert.deepEqual(reductionOf([loop(circle(0, 0, 55)), loop(rect(40, 20))], { expectedDiameter: 220, texts: ['SCALA', '1:1', 'SCALA LOCALE 0.5'] }),
    { n: 2, basis: 'rim' }, 'a view scale among several stated scales');
  // a rim already at the expected size is 1:1 whatever the text says
  assert.equal(reductionOf([loop(circle(0, 0, 237.5))], { expectedDiameter: 475, texts: ['SCALE : 1:3'] }), null);
  // no expected size: the stated scale decides, when the result is a possible tooling diameter
  assert.deepEqual(reductionOf([loop(circle(0, 0, 55))], { expectedDiameter: null, texts: ['SCALE :', '1 : 2'] }), { n: 2, basis: 'text' });
  assert.equal(reductionOf([loop(circle(0, 0, 400))], { expectedDiameter: null, texts: ['SCALE :', '1 : 5'] }), null, 'Ø4000 is no tooling');
  assert.equal(reductionOf([loop(rect(40, 20))], { expectedDiameter: null, texts: ['SCALE :', '1 : 2'] }), null, 'no rim to check');
});

const build = (over) => buildExtractionResult({
  source: 'dxf', bridged: 0, scaleBasis: 'native-mm', texts: [], numbers: [], hints: {}, stated: null, canConfirm: true, notes: [], ...over,
});

test('a scaled PDF is never rescaled by a stated drawing scale', () => {
  const loops = [loop(circle(0, 0, 55)), loop(rect(40, 20))];
  const r = build({ source: 'pdf-vector', scaleBasis: 'text-diameter', loops, texts: ['SCALE :', '1 : 2'] });
  assert.ok(Math.abs(bbox(r.outer).width - 110) < 0.5);
  assert.equal(r.meta.mmPerUnit, 1);
});

test('pockets picked by the cavity count grade likely, never confirmed', () => {
  const loops = [loop(circle(0, 0, 150)), loop(chamfered(220, 200)), loop(rect(125, 75))];
  const stated = { sizeClass: '300X100', diameter: 300, thickness: 100, candidates: ['300X100'] };
  const plain = build({ loops, stated, hints: { cavities: 1 } });
  assert.equal(plain.confidence, 'confirmed');
  assert.ok(Math.abs(bbox(plain.pockets[0]).width - 220) < 0.5, 'without the pointer the recess is read as the pocket');
  const r = build({ loops, stated, hints: { cavities: 1, steppedPockets: 1 } });
  assert.equal(r.pockets.length, 1);
  assert.ok(Math.abs(bbox(r.pockets[0]).width - 125) < 0.5);
  assert.equal(r.confidence, 'likely');
  assert.equal(r.sizeClassConfidence, 'confirmed', 'the size text is still confirmed by the drawn outer');
});
