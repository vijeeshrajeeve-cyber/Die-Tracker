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

// --- backfillOrderProfileShapes -------------------------------------------------------------------
const path = require('node:path');
const { backfillOrderProfileShapes } = require('./orderProfileShape.cjs');

const ROOT = path.resolve('/srv/orderfiles');
const pictureRow = (over = {}) => ({
  id: 1, order_id: 666, stored_path: '120658-803/666/profile_image/1_p.png', die_no: '120658-803', plant: 'GEX 1',
  die_size: 'DIA320X160', die_type: 'HOLLOW', ...over,
});

// A fake client: the picture list, the skipped-count and the die-list facts are canned; the rest is recorded.
function backfillClient(rows, { existing = 0, facts = { ccd: null, cavity: 2 } } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM die_order_files f JOIN die_orders/.test(sql)) return { rows };
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: existing }] };
      if (/FROM existing_die_details/.test(sql)) return { rows: [{ ccd: facts.ccd, cavity: facts.cavity }] };
      return { rows: [{ inserted: true }], rowCount: 1 };
    },
  };
}
const ioWith = (files) => ({
  exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
  readFile: async (p) => { if (!(p in files)) throw new Error(`ENOENT ${p}`); return files[p]; },
});
const abs = (row) => path.join(ROOT, row.stored_path);
const verbs = (client) => client.seen.map((s) => s.sql.trim()).filter((v) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(v));

test('backfill traces pictures without a shape row and records them', async () => {
  const row = pictureRow();
  const client = backfillClient([row], { existing: 2 });
  const res = await backfillOrderProfileShapes(client, { root: ROOT, io: ioWith({ [abs(row)]: ringPng() }) });
  assert.deepEqual(res, { scanned: 1, traced: 1, trueSized: 1, skippedExisting: 2, failed: [] });
  assert.deepEqual(verbs(client), ['BEGIN', 'COMMIT']);
  const list = client.seen.find((s) => /FROM die_order_files f JOIN die_orders/.test(s.sql));
  assert.deepEqual(list.params, []);
  assert.match(list.sql, /f\.slot = 'profile_image' AND f\.replaced_at IS NULL/);
  assert.match(list.sql, /NOT EXISTS \(SELECT 1 FROM profile_shapes p WHERE p\.source = 'order-pdf' AND p\.source_ref = f\.order_id::text\)/);
  assert.match(list.sql, /ORDER BY f\.id/);
  const up = client.seen.find((s) => /^\s*INSERT INTO profile_shapes/.test(s.sql));
  assert.equal(up.params[0], '120658-803');
  assert.equal(up.params[4], '666');
  assert.equal(up.params[5].length, 64); // sha256
  assert.equal(up.params[6], row.stored_path);
  assert.equal(up.params[12], 2); // cavities from the die list
  assert.equal(up.params[13], 'HOLLOW');
  assert.equal(up.params[16], true);
  assert.equal(up.params[21], 'likely');
});

test('backfill: orders that already have an order-pdf row are skipped', async () => {
  const client = backfillClient([], { existing: 3 });
  const res = await backfillOrderProfileShapes(client, { root: ROOT, io: ioWith({}), limit: 5 });
  assert.deepEqual(res, { scanned: 0, traced: 0, trueSized: 0, skippedExisting: 3, failed: [] });
  const list = client.seen.find((s) => /FROM die_order_files f JOIN die_orders/.test(s.sql));
  assert.match(list.sql, /LIMIT \$1/);
  assert.deepEqual(list.params, [5]);
  assert.ok(!client.seen.some((s) => /^\s*INSERT INTO profile_shapes/.test(s.sql)));
});

test('backfill: an unreadable picture is reported, not fatal', async () => {
  const bad = pictureRow({ id: 1, order_id: 1, die_no: 'A-1' });
  const gone = pictureRow({ id: 2, order_id: 2, die_no: 'A-2', stored_path: 'A-2/2/profile_image/x.png' });
  const outside = pictureRow({ id: 3, order_id: 3, die_no: 'A-3', stored_path: '../../etc/passwd' });
  const good = pictureRow({ id: 4, order_id: 4, die_no: 'A-4', stored_path: 'A-4/4/profile_image/ok.png' });
  const client = backfillClient([bad, gone, outside, good]);
  const res = await backfillOrderProfileShapes(client, {
    root: ROOT, io: ioWith({ [abs(bad)]: Buffer.from('not a png'), [abs(good)]: ringPng() }),
  });
  assert.equal(res.scanned, 4);
  assert.equal(res.traced, 1);
  assert.deepEqual(res.failed.map((f) => [f.orderId, f.dieNo]), [[1, 'A-1'], [2, 'A-2'], [3, 'A-3']]);
  assert.equal(res.failed[2].error, 'picture path outside the storage root');
  assert.ok(res.failed.every((f) => typeof f.error === 'string' && f.error));
  assert.deepEqual(verbs(client), ['BEGIN', 'COMMIT']);
});

test('backfill: dry run rolls back', async () => {
  const row = pictureRow();
  const client = backfillClient([row]);
  const res = await backfillOrderProfileShapes(client, { root: ROOT, io: ioWith({ [abs(row)]: ringPng() }), dryRun: true });
  assert.equal(res.traced, 1);
  assert.deepEqual(verbs(client), ['BEGIN', 'ROLLBACK']);
  assert.ok(client.seen.some((s) => /^\s*INSERT INTO profile_shapes/.test(s.sql)));
});

test('backfill: a database error on one row is rolled back to its savepoint and the run still commits', async () => {
  const a = pictureRow({ id: 1, order_id: 1, die_no: 'A-1', stored_path: 'A-1/1/profile_image/a.png' });
  const b = pictureRow({ id: 2, order_id: 2, die_no: 'A-2', stored_path: 'A-2/2/profile_image/b.png' });
  const client = backfillClient([a, b]);
  const inner = client.query;
  client.query = async (sql, params) => {
    if (/^\s*INSERT INTO profile_shapes/.test(sql) && params[4] === '1') {
      client.seen.push({ sql, params });
      throw new Error('constraint violation');
    }
    return inner(sql, params);
  };
  const res = await backfillOrderProfileShapes(client, { root: ROOT, io: ioWith({ [abs(a)]: ringPng(), [abs(b)]: ringPng() }) });
  assert.equal(res.traced, 1);
  assert.deepEqual(res.failed, [{ orderId: 1, dieNo: 'A-1', error: 'constraint violation' }]);
  const stmts = client.seen.map((s) => s.sql.trim());
  const at = (re) => stmts.findIndex((x) => re.test(x));
  assert.ok(at(/^SAVEPOINT row_1$/) < at(/^INSERT INTO profile_shapes/));
  assert.ok(at(/^ROLLBACK TO SAVEPOINT row_1$/) > at(/^INSERT INTO profile_shapes/));
  assert.ok(stmts.includes('RELEASE SAVEPOINT row_1') && stmts.includes('RELEASE SAVEPOINT row_2'));
  assert.equal(stmts.filter((x) => /^INSERT INTO profile_shapes/.test(x)).length, 2);
  assert.deepEqual(verbs(client), ['BEGIN', 'COMMIT']);
});
