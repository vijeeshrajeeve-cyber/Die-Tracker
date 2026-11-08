'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createCanvas } = require('@napi-rs/canvas');
const { decodePng } = require('./pngDecode.cjs');
const { decodeImage } = require('./profileRaster.cjs');

// A drawing with anti-aliased edges and a half-transparent patch, as the browser would encode it.
function drawingPng() {
  const canvas = createCanvas(120, 90);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(60, 45, 30, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = 'rgba(200, 30, 30, 0.5)';
  ctx.fillRect(5, 5, 20, 20);
  return canvas.toBuffer('image/png');
}

// A hand-built PNG: one IHDR, one IDAT holding the given filtered rows, IEND. CRCs are not checked.
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), body, Buffer.alloc(4)]);
}
function pngOf({ width, height, color, rows, plte }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = color;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), ...(plte ? [chunk('PLTE', Buffer.from(plte))] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.from(rows.flat()))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('decodes a canvas PNG to the same pixels as the canvas decoder', async () => {
  const png = drawingPng();
  const ours = decodePng(png);
  const theirs = await decodeImage(png);
  assert.equal(ours.width, theirs.width);
  assert.equal(ours.height, theirs.height);
  let worst = 0;
  for (let i = 0; i < ours.data.length; i++) worst = Math.max(worst, Math.abs(ours.data[i] - theirs.data[i]));
  assert.ok(worst <= 2, `largest channel difference ${worst}`);
});

test('every row filter, greyscale and palette pictures decode', () => {
  // 2x5 greyscale, one row per filter type 0..4, all decoding to [10, 20].
  const grey = decodePng(pngOf({
    width: 2, height: 5, color: 0,
    rows: [[0, 10, 20], [1, 10, 10], [2, 0, 0], [3, 5, 5], [4, 0, 0]],
  }));
  for (let y = 0; y < 5; y++) assert.deepEqual([grey.data[y * 8], grey.data[y * 8 + 4]], [10, 20], `row ${y}`);
  const pal = decodePng(pngOf({ width: 2, height: 1, color: 3, plte: [255, 0, 0, 0, 0, 255], rows: [[0, 1, 0]] }));
  assert.deepEqual([...pal.data], [0, 0, 255, 255, 255, 0, 0, 255]);
});

test('a corrupt PNG is a plain error, never a crash', () => {
  const good = drawingPng();
  const flipped = Buffer.from(good);
  for (let i = 60; i < flipped.length - 20; i += 7) flipped[i] ^= 0x55;
  const cases = {
    junk: Buffer.concat([good.subarray(0, 8), Buffer.from('rest of png')]),
    headerOnly: good.subarray(0, 33),
    truncated: good.subarray(0, Math.floor(good.length / 2)),
    flipped,
    notPng: Buffer.from('%PDF-1.4'),
  };
  for (const [name, bytes] of Object.entries(cases)) assert.throws(() => decodePng(bytes), Error, name);
});

test('unsupported formats are refused by name', () => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 16; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.throws(() => decodePng(png), /unsupported PNG format \(bit depth 16/);
});
