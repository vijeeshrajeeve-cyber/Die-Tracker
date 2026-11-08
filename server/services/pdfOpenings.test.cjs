'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { classifyPdf, extractFromVectorPdf, extractFromScannedPdf } = require('./pdfOpenings.cjs');
const { bbox, circleFit } = require('./openingGeometry.cjs');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'tooling', name));

async function syntheticVectorPdf({ withText = true, pocket = true } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawCircle({ x: 300, y: 250, size: 150, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  if (pocket) page.drawRectangle({ x: 250, y: 225, width: 100, height: 50, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  // Orange loop beside the pocket (inside the circle, not nested in it): only the ink rule can exclude it.
  page.drawRectangle({ x: 365, y: 235, width: 40, height: 30, borderColor: rgb(1, 0.5, 0), borderWidth: 1 });
  // pdf-lib's standard fonts are WinAnsi, which has no U+00D8 problem (Ø is 0xD8 in Latin-1).
  if (withText) page.drawText('\u00d8300x100 INSERT', { x: 20, y: 20, size: 12, font });
  return Buffer.from(await doc.save());
}

// A letter-size scan: white page with a blue-ink rectangle (4 px pen, 2 px gap in the top edge), as a PNG in a PDF.
async function syntheticScanPdf({ x, y, w, h, border = false }) {
  const W = 1275;
  const H = 1760;
  const raw = Buffer.alloc((W * 3 + 1) * H, 255);
  for (let r = 0; r < H; r++) raw[r * (W * 3 + 1)] = 0;
  const dot = (px, py) => { const o = py * (W * 3 + 1) + 1 + px * 3; raw[o] = 30; raw[o + 1] = 30; raw[o + 2] = 200; };
  for (let px = x; px < x + w; px++) {
    for (let t = 0; t < 4; t++) { if (px < x + 150 || px > x + 151) dot(px, y + t); dot(px, y + h - 1 - t); }
  }
  for (let py = y; py < y + h; py++) for (let t = 0; t < 4; t++) { dot(x + t, py); dot(x + w - 1 - t, py); }
  if (border) { // a sheet border 20 px in from the edge
    for (let px = 20; px < W - 20; px++) for (let t = 0; t < 4; t++) { dot(px, 20 + t); dot(px, H - 21 - t); }
    for (let py = 20; py < H - 20; py++) for (let t = 0; t < 4; t++) { dot(20 + t, py); dot(W - 21 - t, py); }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = ~0; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 845]);
  page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 612, height: 845 });
  return Buffer.from(await doc.save());
}

test('classifies the vector bolster drawing and the scan', async () => {
  assert.equal((await classifyPdf(fixture('bolster-BOL-27080.pdf'))).kind, 'vector');
  assert.equal((await classifyPdf(fixture('bolster-15109-scan.pdf'))).kind, 'scan');
});

// Measured on the real drawing (checked against its own dimension lines 282.4 and 187.4): the V-shaped pocket is ONE
// closed outline wrapping the rounded tip, not two separate L-shapes, so one pocket and cavities 1 (the brief said two).
test('BOL-27080: scale from the Ø475x220 text, outer Ø475 ± 2, one V-shaped pocket, coloured overlay and key slot ignored', async () => {
  const r = await extractFromVectorPdf(fixture('bolster-BOL-27080.pdf'), { cavities: 1 });
  assert.equal(r.source, 'pdf-vector'); assert.equal(r.scaleBasis, 'text-diameter');
  assert.equal(r.sizeClass, '475X220'); assert.equal(r.sizeClassSource, 'drawing-text');
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 475) < 2);
  assert.equal(r.pockets.length, 1);
  const joint = bbox(r.pockets.flat()); assert.ok(Math.abs(joint.width - 282.4) < 4, `joint width ${joint.width}`);
  assert.ok(Math.abs(joint.height - 187.4) < 4, `joint height ${joint.height}`);
  assert.equal(r.pocketGapMm, null);
  assert.ok(r.numbersInDrawing.includes('BOL-27080'));
  assert.equal(r.confidence, 'likely'); // scaled from its own size text, so never 'confirmed'; the side section's loops are outside the outer and ignored
  // what a viewer needs to lay the outline back on the sheet
  assert.equal(r.meta.scaleBasis, 'text-diameter'); assert.equal(r.meta.outerSynthesised, false);
  assert.ok(r.meta.mmPerUnit > 0 && r.meta.offset.length === 2 && r.meta.offset.every(Number.isFinite));
});

test('coloured strokes are not geometry', async () => {
  const r = await extractFromVectorPdf(await syntheticVectorPdf(), { sizeClass: '300X100' });
  assert.equal(r.pockets.length, 1);
});

test('a vector PDF without size text or hint has no scale → none', async () => {
  const r = await extractFromVectorPdf(await syntheticVectorPdf({ withText: false }), {});
  assert.equal(r.confidence, 'none'); assert.equal(r.scaleBasis, null); assert.ok(r.notes.some((n) => /scale/.test(n)));
});

test('a closed hand-drawn pocket is traced, scaled from inventory dims, uncertain', async () => {
  // 330 x 1000 px pen outline; the pen has a 2 px gap that closing must seal.
  const r = await extractFromScannedPdf(await syntheticScanPdf({ x: 300, y: 300, w: 330, h: 1000 }), { sizeClass: '475X220', inventoryDims: { a_len: 350, b_wid: 115 } });
  assert.equal(r.source, 'pdf-raster'); assert.equal(r.scaleBasis, 'inventory-dims');
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); const long = Math.max(b.width, b.height), short = Math.min(b.width, b.height);
  assert.ok(Math.abs(long - 350) < 1, `long ${long}`); assert.ok(short > 100 && short < 125, `short ${short}`);
  assert.equal(r.outerSynthesised, true); assert.equal(r.confidence, 'uncertain');
});

// 15109-Bol1.pdf: the pocket runs off the top of the scan (the sheet is cropped), so nothing is enclosed.
// The brief expected one traced pocket of 350 x 100-125; the real scan cannot give that without inventing geometry.
test('15109 scan: a pocket cut off by the scan edge is not an enclosed outline → none', async () => {
  const r = await extractFromScannedPdf(fixture('bolster-15109-scan.pdf'), { sizeClass: '475X220', inventoryDims: { a_len: 350, b_wid: 110 } });
  assert.equal(r.source, 'pdf-raster'); assert.equal(r.confidence, 'none');
  assert.ok(r.notes.some((n) => /enclosed/.test(n)));
});

test('a scan with no size hint and no drawn outer is none', async () => {
  const r = await extractFromScannedPdf(await syntheticScanPdf({ x: 300, y: 300, w: 330, h: 1000 }), {});
  assert.equal(r.confidence, 'none'); assert.equal(r.scaleBasis, null);
});

test('the scale circle must contain the drawing', async () => {
  const r = await extractFromVectorPdf(await syntheticVectorPdf({ pocket: false }), { sizeClass: '300X100', cavities: 1 });
  // the orange rectangle is not geometry, so the circle is the only loop and holds nothing
  assert.equal(r.confidence, 'none'); assert.ok(r.notes.includes('scale circle does not contain the drawing'));
});

test('inventory dims only: the pocket is never promoted to outer', async () => {
  const r = await extractFromScannedPdf(await syntheticScanPdf({ x: 300, y: 300, w: 330, h: 1000 }), { inventoryDims: { a_len: 350, b_wid: 115 } });
  assert.equal(r.outer, null); assert.equal(r.pockets.length, 1);
  assert.equal(r.scaleBasis, 'inventory-dims'); assert.equal(r.confidence, 'uncertain');
});

test('inventory dims: a sheet border is not scaled to the pocket length', async () => {
  const r = await extractFromScannedPdf(await syntheticScanPdf({ x: 300, y: 300, w: 330, h: 1000, border: true }), { inventoryDims: { a_len: 350, b_wid: 115 } });
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]);
  assert.ok(Math.abs(Math.max(b.width, b.height) - 350) < 1);
});

test('inventory dims: a short side that disagrees with b_wid is none, not uncertain', async () => {
  const r = await extractFromScannedPdf(await syntheticScanPdf({ x: 300, y: 300, w: 330, h: 1000 }), { inventoryDims: { a_len: 350, b_wid: 60 } });
  assert.equal(r.confidence, 'none'); assert.ok(r.notes.some((n) => /disagrees with inventory dims/.test(n)));
});
