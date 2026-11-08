'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { chooseScale, dieDiameterOf, shapeFromProfilePng, recordOrderProfileShape } = require('./orderProfileShape.cjs');

// The Task 2 ring, encoded as the PNG the PDF import posts: a black annulus on white, R 80 px, r 40 px.
function ringPng(size = 200, R = 80, r = 40) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, R, 0, 2 * Math.PI);
  ctx.arc(size / 2, size / 2, r, 0, 2 * Math.PI);
  ctx.fill('evenodd');
  return canvas.toBuffer('image/png');
}

// --- chooseScale --------------------------------------------------------------------------------
// pxCcd 1000 at 200 DPI: scale 1 -> 127 mm, scale 2/3 -> 84.67 mm.

test('no scale agrees with the die list CCD → not true size', () => {
  assert.equal(chooseScale({ pxCcd: 1000, renderDpi: 200, scales: [1, 2 / 3], dieListCcd: 90, dieSize: 'DIA320X160' }), null);
  const hit = chooseScale({ pxCcd: 1000, renderDpi: 200, scales: [1, 2 / 3], dieListCcd: 127, dieSize: null });
  assert.equal(hit.scale, 1);
  assert.equal(hit.confidence, 'confirmed');
  assert.equal(hit.source, 'pdf-scale');
  assert.ok(Math.abs(hit.mmPerPx - 0.127) < 1e-12);
});

test('a detail scale is taken when it, not the main scale, agrees with the die list CCD', () => {
  const hit = chooseScale({ pxCcd: 1000, renderDpi: 200, scales: [1, 2 / 3], dieListCcd: 85, dieSize: null });
  assert.equal(hit.scale, 2 / 3);
  assert.equal(hit.confidence, 'confirmed');
});

test('without a die-list CCD the main scale is likely when it fits the die', () => {
  const fits = chooseScale({ pxCcd: 1000, renderDpi: 200, scales: [1, 2 / 3], dieListCcd: null, dieSize: 'DIA320X160' });
  assert.equal(fits.scale, 1);
  assert.equal(fits.confidence, 'likely');
  assert.equal(fits.source, 'pdf-scale');
  assert.equal(chooseScale({ pxCcd: 1000, renderDpi: 200, scales: [1, 2 / 3], dieListCcd: null, dieSize: 'DIA150X160' }), null);
});

test('a reference CCD above MAX_CCD_MM (a die list typing error) is ignored, not compared', () => {
  const base = { pxCcd: 1000, renderDpi: 200, scales: [1, 2 / 3], dieSize: 'DIA320X160' };
  assert.deepEqual(chooseScale({ ...base, dieListCcd: 11785 }), chooseScale({ ...base, dieListCcd: null }));
});

test('no render DPI, no scales or no die size means no true size', () => {
  assert.equal(chooseScale({ pxCcd: 1000, renderDpi: null, scales: [1], dieListCcd: 127, dieSize: null }), null);
  assert.equal(chooseScale({ pxCcd: 1000, renderDpi: 200, scales: [], dieListCcd: 127, dieSize: null }), null);
  assert.equal(chooseScale({ pxCcd: 1000, renderDpi: 200, scales: [1], dieListCcd: null, dieSize: 'N/A' }), null);
});

test('the die diameter is the first size of the die size', () => {
  assert.equal(dieDiameterOf('DIA320X160'), 320);
  assert.equal(dieDiameterOf('320X160'), 320);
  assert.equal(dieDiameterOf('Dia 250 x 80'), 250);
  assert.equal(dieDiameterOf('N/A'), null);
  assert.equal(dieDiameterOf(null), null);
});

// --- shapeFromProfilePng ------------------------------------------------------------------------

const rmsRadius = (poly) => Math.sqrt(poly.reduce((s, [x, y]) => s + x * x + y * y, 0) / poly.length);

test('the posted ring PNG becomes a one-hole shape, true-sized from the main scale', async () => {
  const f = await shapeFromProfilePng(ringPng(), { renderDpi: 200, scales: [1], dieListCcd: null, dieSize: 'DIA320X160' });
  assert.equal(f.hole_count, 1);
  assert.equal(f.holes_unit.length, 1);
  assert.ok(Math.abs(rmsRadius(f.outer_unit) - 1) < 1e-6, `rms ${rmsRadius(f.outer_unit)}`);
  assert.equal(f.signature.length, 24);
  assert.equal(f.true_size, true);
  assert.equal(f.true_size_source, 'pdf-scale');
  assert.equal(f.true_size_confidence, 'likely');
  // 160 px across at 200 DPI and 1:1 is ~20.3 mm.
  assert.ok(Math.abs(f.ccd_mm - 160 * 0.127) < 1, `ccd_mm ${f.ccd_mm}`);
  // mm polygons are centred on the outer centroid: the outer stays ~80 px * 0.127 from the centre.
  const outerR = rmsRadius(f.outer_mm);
  assert.ok(Math.abs(outerR - 80 * 0.127) < 0.5, `outer mm radius ${outerR}`);
  assert.equal(f.holes_mm.length, 1);
  assert.ok(Math.abs(rmsRadius(f.holes_mm[0]) - 40 * 0.127) < 0.5);
});

test('the drawing\'s own CCD is checked before the die list CCD', async () => {
  // The stated CCD (20.3) agrees with scale 1; a die list CCD of 500 alone would refuse it.
  const f = await shapeFromProfilePng(ringPng(), { renderDpi: 200, scales: [1], ccdStated: 20.3, dieListCcd: 500, dieSize: null });
  assert.equal(f.true_size, true);
  assert.equal(f.true_size_confidence, 'confirmed');
});

test('without a defensible scale the shape keeps no millimetre columns', async () => {
  const f = await shapeFromProfilePng(ringPng(), { renderDpi: 200, scales: [1], dieListCcd: 90, dieSize: 'DIA320X160' });
  assert.equal(f.true_size, false);
  assert.equal(f.outer_mm, null);
  assert.equal(f.holes_mm, null);
  assert.equal(f.ccd_mm, null);
  assert.equal(f.true_size_source, null);
  assert.equal(f.true_size_confidence, null);
  assert.equal(f.hole_count, 1); // the shape itself is still recorded
});

test('a picture with no profile in it is refused', async () => {
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 100, 100);
  await assert.rejects(shapeFromProfilePng(canvas.toBuffer('image/png'), {}), /no profile/);
});

// --- recordOrderProfileShape --------------------------------------------------------------------

test('the shape is upserted as an order-pdf row keyed by the order id, never over a reviewed row', async () => {
  const fields = await shapeFromProfilePng(ringPng(), { renderDpi: 200, scales: [1], dieListCcd: null, dieSize: 'DIA320X160' });
  const seen = [];
  const client = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{ inserted: true }], rowCount: 1 }; } };
  await recordOrderProfileShape(client, {
    orderId: 666, dieNo: '120658-803', plant: 'GEX 01', profileNumber: null, imageSha: 'abc', imagePath: '120658-803/666/profile_image/1_p.png',
    dieType: 'HOLLOW', cavities: 2, fields,
  });
  assert.equal(seen.length, 1);
  const { sql, params } = seen[0];
  assert.match(sql, /^INSERT INTO profile_shapes/);
  assert.match(sql, /ON CONFLICT \(die_no, plant, source, source_ref\) DO UPDATE/);
  assert.match(sql, /WHERE profile_shapes\.reviewed_at IS NULL/);
  assert.deepEqual(params.slice(0, 7), ['120658-803', 'GEX 1', null, 'order-pdf', '666', 'abc', '120658-803/666/profile_image/1_p.png']);
  assert.equal(params[7], fields.style);
  assert.deepEqual(JSON.parse(params[8]), fields.outer_unit);
  assert.deepEqual(JSON.parse(params[10]), fields.signature);
  assert.equal(params[11], 1); // hole_count
  assert.equal(params[12], 2); // cavities
  assert.equal(params[13], 'HOLLOW');
  assert.equal(params[16], true); // true_size
  assert.deepEqual(JSON.parse(params[17]), fields.outer_mm);
  assert.equal(params[19], fields.ccd_mm);
  assert.equal(params[20], 'pdf-scale');
  assert.equal(params[21], 'likely');
});

test('a shape without true size stores NULL millimetre columns', async () => {
  const fields = await shapeFromProfilePng(ringPng(), { renderDpi: 200, scales: [], dieListCcd: null, dieSize: null });
  let params;
  const client = { query: async (_sql, p) => { params = p; return { rows: [], rowCount: 0 }; } };
  await recordOrderProfileShape(client, { orderId: 7, dieNo: 'D', plant: 'GEX 2', imageSha: null, imagePath: null, fields });
  assert.equal(params[16], false);
  assert.deepEqual(params.slice(17, 22), [null, null, null, null, null]);
  assert.equal(params[12], null); // no cavities given
});

test('an order with no plant is refused before the upsert', async () => {
  const fields = await shapeFromProfilePng(ringPng(), { renderDpi: 200, scales: [], dieListCcd: null, dieSize: null });
  const seen = [];
  const client = { query: async (sql) => { seen.push(sql); return { rows: [], rowCount: 0 }; } };
  for (const plant of [null, undefined, '', '  ']) {
    await assert.rejects(recordOrderProfileShape(client, { orderId: 7, dieNo: 'D', plant, fields }), { message: 'order has no plant' });
  }
  assert.equal(seen.length, 0);
});
