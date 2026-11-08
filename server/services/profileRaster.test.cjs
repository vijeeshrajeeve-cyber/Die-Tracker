const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bbox } = require('./openingGeometry.cjs');
const { decodeImage, shapeFromImage } = require('./profileRaster.cjs');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'profiles', n));

// RGBA test pictures painted directly: white background, black ink where `ink(x, y)` holds.
const paint = (width, height, ink) => {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink(x, y)) continue;
      const p = (y * width + x) * 4;
      data[p] = 0; data[p + 1] = 0; data[p + 2] = 0;
    }
  }
  return { data, width, height };
};
const white = (width, height) => paint(width, height, () => false);
// Filled annulus centred in the picture, outer radius R, inner radius r.
const ring = (width, height, R, r) => paint(width, height, (x, y) => {
  const d = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
  return d <= R && d >= r;
});
// Two concentric square outlines of side `outer` and `inner`, each stroke `stroke` px wide.
const strokedSquares = (width, height, outer, inner, stroke) => {
  const inSquareStroke = (x, y, side) => {
    const x0 = Math.floor((width - side) / 2);
    const y0 = Math.floor((height - side) / 2);
    const lx = x - x0;
    const ly = y - y0;
    if (lx < 0 || ly < 0 || lx >= side || ly >= side) return false;
    return lx < stroke || ly < stroke || lx >= side - stroke || ly >= side - stroke;
  };
  return paint(width, height, (x, y) => inSquareStroke(x, y, outer) || inSquareStroke(x, y, inner));
};

test('silhouette multi-cavity section keeps every closed cavity (5)', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row16262-hollow.gif')), { expectHollow: true });
  assert.equal(r.style, 'silhouette'); assert.equal(r.holeCount, 5); assert.equal(r.needsReview, false);
  const b = bbox(r.outer); assert.ok(b.height > b.width && b.height > 300, `${b.width}x${b.height}`); // 902x501 picture, the section stands upright
});
test('thin-walled silhouette with one cavity: the verdict resolves the ambiguous style', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row18681-hollow.gif')), { expectHollow: true });
  assert.equal(r.style, 'silhouette'); assert.equal(r.holeCount, 1); assert.equal(r.styleResolvedBy, 'verdict');
  assert.equal(r.needsReview, false);
});
test('outline-style solid section has no holes', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row2069-solid-outline.gif')), { expectHollow: false });
  assert.equal(r.style, 'outline'); assert.equal(r.holeCount, 0); assert.equal(r.styleResolvedBy, 'verdict');
  assert.equal(r.needsReview, false);
});
test('without a verdict a lone thin closed stroke defaults to an outline drawing', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row2069-solid-outline.gif')));
  assert.equal(r.style, 'outline'); assert.equal(r.holeCount, 0); assert.equal(r.styleResolvedBy, 'default');
});
test('verdict disagreement sets needsReview with a reason', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row16262-hollow.gif')), { expectHollow: false });
  assert.equal(r.needsReview, true); assert.match(r.reviewReason, /hollow|cavity/i);
});
test('synthetic silhouette ring: outer is the outside boundary, one hole, y grows upward', () => {
  const img = ring(200, 200, 80, 40); // helper paints a filled annulus
  const r = shapeFromImage(img);
  assert.equal(r.styleResolvedBy, 'geometry');
  assert.equal(r.holeCount, 1); assert.ok(Math.abs(bbox(r.outer).width - 160) <= 3); assert.ok(Math.abs(bbox(r.holes[0]).width - 80) <= 3);
  assert.ok(r.outer.some(([, y]) => y < 0) && r.outer.every(([, y]) => y <= 0)); // pixel rows negated
});
test('synthetic outline square with an inner outline square is a hollow drawn in outline style', () => {
  const img = strokedSquares(300, 300, 200, 120, 3); // two concentric 3 px strokes
  const r = shapeFromImage(img, { expectHollow: true });
  assert.equal(r.style, 'outline'); assert.equal(r.holeCount, 1); assert.equal(r.needsReview, false);
  assert.equal(r.styleResolvedBy, 'geometry');
});
test('blank or near-blank image returns null', () => { assert.equal(shapeFromImage(white(100, 60)), null); });
