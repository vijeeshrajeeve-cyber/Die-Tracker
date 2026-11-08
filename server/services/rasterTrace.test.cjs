'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toGray, otsuThreshold, inkMask, traceLoops } = require('./rasterTrace.cjs');
const { bbox } = require('./openingGeometry.cjs');

function canvasRgb(width, height) {
  return { width, height, kind: 2, data: new Uint8ClampedArray(width * height * 3).fill(255) };
}
function dot(img, x, y, rgb) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set(rgb, (y * img.width + x) * 3);
}
function fillBox(img, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) dot(img, x, y, rgb);
}
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
function strokeRect(img, x, y, w, h, pen, rgb = BLACK) {
  fillBox(img, x, y, w, pen, rgb);
  fillBox(img, x, y + h - pen, w, pen, rgb);
  fillBox(img, x, y, pen, h, rgb);
  fillBox(img, x + w - pen, y, pen, h, rgb);
}
function strokeCircle(img, cx, cy, r, pen, rgb = BLACK) {
  for (let y = Math.floor(cy - r - pen); y <= cy + r + pen; y++) {
    for (let x = Math.floor(cx - r - pen); x <= cx + r + pen; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && d > r - pen) dot(img, x, y, rgb);
    }
  }
}

test('traces a drawn rectangle as one enclosed loop with the right size', () => {
  const img = canvasRgb(400, 300);
  strokeRect(img, 100, 75, 200, 150, 2);
  const { loops } = traceLoops(img);
  assert.equal(loops.length, 1);
  const b = bbox(loops[0]);
  assert.ok(Math.abs(b.width - 198) <= 3 && Math.abs(b.height - 148) <= 3, `${b.width} x ${b.height}`);
});

test('a 1 px pen gap is sealed by closing; a 10 px gap is not an enclosed region', () => {
  const small = canvasRgb(400, 300);
  strokeRect(small, 100, 75, 200, 150, 2);
  fillBox(small, 200, 75, 1, 2, WHITE);
  assert.equal(traceLoops(small).loops.length, 1);
  const big = canvasRgb(400, 300);
  strokeRect(big, 100, 75, 200, 150, 2);
  fillBox(big, 200, 75, 10, 2, WHITE);
  assert.equal(traceLoops(big).loops.length, 0);
});

test('nested loops come back largest first', () => {
  const img = canvasRgb(400, 400);
  strokeCircle(img, 200, 200, 100, 2);
  strokeRect(img, 170, 180, 60, 40, 2);
  const { loops } = traceLoops(img);
  assert.equal(loops.length, 2);
  const b0 = bbox(loops[0]);
  const b1 = bbox(loops[1]);
  assert.ok(b0.width > 150 && b1.width < 80, `${b0.width} ${b1.width}`);
});

test('otsu separates blue ink from paper', () => {
  const img = canvasRgb(200, 200);
  fillBox(img, 20, 20, 160, 3, [60, 60, 200]);
  fillBox(img, 20, 100, 160, 3, [60, 60, 200]);
  for (let i = 0; i < img.data.length; i++) if (img.data[i] === 255) img.data[i] = 250;
  const gray = toGray(img);
  const t = otsuThreshold(gray);
  const inkGrey = Math.round(0.299 * 60 + 0.587 * 60 + 0.114 * 200);
  assert.ok(t >= inkGrey && t < 250, `threshold ${t}`);
  const mask = inkMask(gray, t);
  assert.equal(mask[21 * 200 + 50], 1);
  assert.equal(mask[50 * 200 + 50], 0);
});
