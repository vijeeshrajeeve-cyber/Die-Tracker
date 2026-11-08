'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeXlsx } = require('./fixtures/syntheticXlsx.cjs');
const { sha256Of, profileImagePath } = require('./toolingDrawings.cjs');
const { buildProfileBundle, readProfileBundle, trueSizeFromCcd, applyProfileBundle } = require('./profileBundle.cjs');

// RGBA test picture painted directly (copied from profileRaster.test.cjs): a filled annulus.
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
const ring = (width, height, R, r) => paint(width, height, (x, y) => {
  const d = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
  return d <= R && d >= r;
});

const GIF_A = Buffer.from('GIF89a-picture-A');
const GIF_B = Buffer.from('GIF89a-picture-B');
const PNG_C = Buffer.from('PNG-picture-C');
const HEADER1 = { r: 1, cells: { A: 'IDProfile', B: 'IDDie', C: 'IDDieType', F: 'Verdict', G: 'Image Check' } };
const HEADER2 = { r: 1, cells: { A: 'IDProfile', B: 'IDDie', C: 'IDDieType', D: 'IDStatus', E: 'Image' } };

const gex1 = (rows, pictures) => ({ name: 'GEX1', rows: [HEADER1, ...rows], pictures });
const gex2 = (rows, pictures) => ({ name: 'GEX2', rows: [HEADER2, ...rows], pictures });

async function run(sheets, opts = {}) {
  const zip = makeXlsx({ sheets, media: { 'image1.gif': GIF_A, 'image2.gif': GIF_B, 'image3.png': PNG_C } });
  const decoded = [];
  const copied = [];
  const written = {};
  const progress = [];
  const result = await buildProfileBundle({
    zip,
    sheets: opts.sheets || sheets.map((s) => s.name),
    io: { copyBytes: (rel, buf) => copied.push([rel, buf]), writeJson: (name, obj) => { written[name] = obj; } },
    decode: async (buf) => { decoded.push(buf.toString()); return ring(200, 200, 80, 40); },
    limit: opts.limit ?? null,
    onProgress: (p) => progress.push(p),
  });
  return { ...result, decoded, copied, written, progress };
}

const byRef = (shapes, ref) => shapes.find((s) => s.source_ref === ref);

test('a shared picture is decoded once and attached to every die', async () => {
  const r = await run([gex1([
    { r: 2, cells: { A: '12555', B: '12555_101', C: 'Hollow', F: 'Hollow' } },
    { r: 3, cells: { A: '12556', B: '12556_101', C: 'Hollow', F: 'Hollow' } },
    { r: 4, cells: { A: '12555', B: '12555_102', C: 'Hollow', F: 'Hollow' } },
  ], [{ row: 2, media: 'image1.gif' }, { row: 3, media: 'image2.gif' }, { row: 4, media: 'image1.gif' }])]);
  assert.deepEqual(r.decoded, ['GIF89a-picture-A', 'GIF89a-picture-B']);
  assert.equal(r.shapes.length, 3);
  const a = byRef(r.shapes, 'GEX1!E2');
  const b = byRef(r.shapes, 'GEX1!E4');
  assert.equal(a.image_sha, sha256Of(GIF_A));
  assert.equal(b.image_sha, a.image_sha);
  assert.deepEqual(b.signature, a.signature);
  assert.equal(a.image_file, `files/${profileImagePath(sha256Of(GIF_A), 'gif')}`);
  // Each distinct picture file is copied once.
  assert.deepEqual(r.copied.map(([rel]) => rel).sort(), [
    `files/${profileImagePath(sha256Of(GIF_A), 'gif')}`, `files/${profileImagePath(sha256Of(GIF_B), 'gif')}`,
  ].sort());
  assert.deepEqual(r.copied.find(([rel]) => rel.includes(a.image_sha))[1], GIF_A);
  assert.equal(r.report.picturesDecoded, 2);
  assert.equal(r.report.picturesShared, 1);
  assert.equal(r.report.shapesWritten, 3);
  assert.deepEqual(a, {
    die_no: '12555_101', plant: 'GEX 1', profile_number: '12555', source: 'image-check-xlsx', source_ref: 'GEX1!E2',
    image_sha: a.image_sha, image_file: a.image_file, style: 'silhouette', outer_unit: a.outer_unit, holes_unit: a.holes_unit,
    signature: a.signature, hole_count: 1, die_type: 'Hollow', aspect_ratio: a.aspect_ratio, solidity: a.solidity,
    needs_review: false, review_reason: null,
  });
  assert.equal(a.signature.length, 24);
  assert.equal(a.holes_unit.length, 1);
  assert.ok(a.outer_unit.length > 8);
  assert.ok(Math.abs(a.aspect_ratio - 1) < 0.05);
  assert.ok(a.solidity > 0.95);
  // The bundle files go through io.writeJson.
  assert.deepEqual(r.written['shapes.json'], r.shapes);
  assert.deepEqual(r.written['report.json'], r.report);
  assert.equal(r.written['manifest.json'].version, 1);
  assert.equal(r.written['manifest.json'].kind, 'profile-shapes');
  assert.equal(r.written['manifest.json'].counts.shapes, 3);
  assert.deepEqual(r.report.styles, { silhouette: 3, outline: 0 });
  assert.deepEqual(r.report.styleResolvedBy, { geometry: 3, verdict: 0, default: 0 });
  assert.deepEqual(r.progress.map((p) => p.done), [1, 2, 3]);
});

test('review notes set needs_review', async () => {
  const r = await run([gex1([
    { r: 2, cells: { A: '1', B: '1_101', C: 'Hollow', F: 'Hollow', G: 'Image unclear - cannot verify' } },
    { r: 3, cells: { A: '2', B: '2_101', C: 'Hollow', F: 'Hollow', G: 'Mismatch: image shows HOLLOW profile (closed cavity)' } },
    { r: 4, cells: { A: '3', B: '3_101', C: 'Hollow', F: 'Hollow', G: 'No image in Column E' } },
  ], [{ row: 2, media: 'image1.gif' }, { row: 3, media: 'image2.gif' }])]);
  const unclear = byRef(r.shapes, 'GEX1!E2');
  assert.equal(unclear.needs_review, true);
  assert.equal(unclear.review_reason, 'Image unclear - cannot verify');
  assert.equal(byRef(r.shapes, 'GEX1!E3').needs_review, true);
  assert.equal(r.shapes.length, 2);
  assert.deepEqual(r.report.needsReview, { verdictMismatch: 0, noteMismatch: 1, noImage: 1, blankOrUnclear: 1, nullShape: 0 });
});

test('rows without a picture are reported not written', async () => {
  const r = await run([gex1([
    { r: 2, cells: { A: '1', B: '1_101', C: 'Hollow', F: 'Hollow' } },
    { r: 3, cells: { A: '2', B: '2_101', C: 'Hollow', F: 'Hollow' } },
    { r: 4, cells: { A: '3', C: 'Hollow' } },
  ], [{ row: 2, media: 'image1.gif' }])]);
  assert.deepEqual(r.shapes.map((s) => s.source_ref), ['GEX1!E2']);
  assert.equal(r.report.rowsSeen, 3);
  assert.equal(r.report.rowsWithPicture, 1);
  assert.equal(r.report.rowsWithoutPicture, 1);
  assert.deepEqual(r.report.errors, [{ row: 'GEX1!4', error: 'blank IDDie' }]);
});

test('a row whose verdict disagrees with the traced shape is flagged', async () => {
  const r = await run([gex1([
    // The verdict (F) wins over the die type (C); the ring has a cavity.
    { r: 2, cells: { A: '1', B: '1_101', C: 'Hollow', F: 'solid' } },
    // A junk verdict falls back to the die type; the typo HOLOW still reads as hollow.
    { r: 3, cells: { A: '2', B: '2_101', C: 'HOLOW', F: ';+A2567;' } },
  ], [{ row: 2, media: 'image1.gif' }, { row: 3, media: 'image1.gif' }])]);
  const solid = byRef(r.shapes, 'GEX1!E2');
  assert.equal(solid.needs_review, true);
  assert.match(solid.review_reason, /hollow section but the sheet says solid/);
  assert.equal(byRef(r.shapes, 'GEX1!E3').needs_review, false);
  assert.equal(r.report.needsReview.verdictMismatch, 1);
  // One picture, decoded once, still reviewed per row.
  assert.equal(r.decoded.length, 1);
});

test('a row with two pictures writes two shapes; a two-row anchor belongs to its from row', async () => {
  const r = await run([gex1([
    { r: 2, cells: { A: '1', B: '1_101', C: 'Hollow', F: 'Hollow' } },
    { r: 3, cells: { A: '2', B: '2_101', C: 'Hollow', F: 'Hollow' } },
  ], [{ row: 2, media: 'image1.gif' }, { row: 2, media: 'image3.png' }, { row: 3, media: 'image2.gif', toRow: 4 }])]);
  assert.deepEqual(r.shapes.map((s) => s.source_ref), ['GEX1!E2', 'GEX1!E2#2', 'GEX1!E3']);
  assert.equal(byRef(r.shapes, 'GEX1!E2#2').image_file, `files/${profileImagePath(sha256Of(PNG_C), 'png')}`);
  assert.equal(r.report.rowsWithPicture, 2);
});

test('decode errors are caught per picture and reported', async () => {
  const zip = makeXlsx({
    sheets: [gex1([
      { r: 2, cells: { A: '1', B: '1_101', C: 'Hollow' } },
      { r: 3, cells: { A: '2', B: '2_101', C: 'Hollow' } },
    ], [{ row: 2, media: 'image1.gif' }, { row: 3, media: 'image2.gif' }])],
    media: { 'image1.gif': GIF_A, 'image2.gif': GIF_B },
  });
  const copied = [];
  const { shapes, report } = await buildProfileBundle({
    zip, sheets: ['GEX1'], io: { copyBytes: (rel) => copied.push(rel), writeJson: () => {} },
    decode: async (buf) => { if (buf.equals(GIF_A)) throw new Error('bad gif'); return ring(200, 200, 80, 40); },
  });
  assert.deepEqual(shapes.map((s) => s.source_ref), ['GEX1!E3']);
  assert.deepEqual(report.errors, [{ row: 'GEX1!E2', error: 'decode failed: bad gif' }]);
  assert.equal(report.picturesDecoded, 1);
  assert.equal(copied.length, 1);
});

test('a picture that traces to no shape is counted as nullShape and not written', async () => {
  const zip = makeXlsx({
    sheets: [gex1([{ r: 2, cells: { A: '1', B: '1_101', C: 'Hollow' } }], [{ row: 2, media: 'image1.gif' }])],
    media: { 'image1.gif': GIF_A },
  });
  const { shapes, report } = await buildProfileBundle({
    zip, sheets: ['GEX1'], io: { copyBytes: () => {}, writeJson: () => {} }, decode: async () => paint(50, 50, () => false),
  });
  assert.equal(shapes.length, 0);
  assert.equal(report.needsReview.nullShape, 1);
  assert.equal(report.shapesWritten, 0);
});

test('limit stops after N pictures', async () => {
  const r = await run([gex1([
    { r: 2, cells: { A: '1', B: '1_101', C: 'Hollow' } },
    { r: 3, cells: { A: '2', B: '2_101', C: 'Hollow' } },
    { r: 4, cells: { A: '3', B: '3_101', C: 'Hollow' } },
  ], [{ row: 2, media: 'image1.gif' }, { row: 3, media: 'image2.gif' }, { row: 4, media: 'image3.png' }])], { limit: 2 });
  assert.deepEqual(r.shapes.map((s) => s.source_ref), ['GEX1!E2', 'GEX1!E3']);
  assert.equal(r.decoded.length, 2);
  assert.equal(r.report.rowsSeen, 2);
});

test('GEX2 rows carry plant GEX 2 and no verdict', async () => {
  const r = await run([
    gex1([{ r: 2, cells: { A: '1', B: '1_101', C: 'Hollow', F: 'Hollow' } }], [{ row: 2, media: 'image1.gif' }]),
    gex2([
      { r: 2, cells: { A: '090019', B: '090019-2501', C: 'Hollow', D: '01' } },
      // No verdict column: the die type decides, and a solid type disagrees with the ring.
      { r: 3, cells: { A: '090036', B: '090036-2501', C: 'SOLD', D: '01' } },
      { r: 4, cells: { A: '090037', B: '090037-2501', C: 'Solid', D: '01', E: 'Image not found' } },
    ], [{ row: 2, media: 'image2.gif' }, { row: 3, media: 'image2.gif' }]),
  ], { sheets: ['GEX2'] });
  assert.deepEqual(r.shapes.map((s) => [s.plant, s.die_no, s.profile_number, s.source_ref]), [
    ['GEX 2', '090019-2501', '090019', 'GEX2!E2'], ['GEX 2', '090036-2501', '090036', 'GEX2!E3'],
  ]);
  assert.equal(r.shapes[0].needs_review, false);
  assert.equal(r.shapes[1].needs_review, true);
  assert.equal(r.report.rowsWithoutPicture, 1);
  assert.deepEqual(r.decoded, ['GIF89a-picture-B']);
});

// ---------------------------------------------------------------------------------------------
// Apply half (fake client: records every query, returns scripted rows)
// ---------------------------------------------------------------------------------------------

const unitRing = (r, n = 64) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
const SHAPE = (over = {}) => ({
  die_no: '090019-2501', plant: 'GEX 1', profile_number: '090019', source: 'image-check-xlsx', source_ref: 'GEX1!E2',
  image_sha: 'ab'.repeat(32), image_file: `files/profiles/ab/${'ab'.repeat(32)}.gif`, style: 'silhouette',
  outer_unit: unitRing(0.5), holes_unit: [unitRing(0.1, 16)], signature: [0.1, 0.2], hole_count: 1, die_type: 'Hollow',
  aspect_ratio: 1, solidity: 1, needs_review: false, review_reason: null, ...over,
});

function fakeClient({ dieRow = { cavity: 4, die_type: 'HOLLOW', profile_number: '090019', ccd: '123.4' }, existing = null, upsertCount = 1, inserted = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM existing_die_details/.test(sql)) return { rows: dieRow ? [dieRow] : [], rowCount: dieRow ? 1 : 0 };
      if (/FROM profile_shapes/.test(sql)) return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
      if (/INSERT INTO profile_shapes/.test(sql)) return { rows: upsertCount ? [{ inserted }] : [], rowCount: upsertCount };
      return { rows: [], rowCount: 0 };
    },
  };
}
function fakeIo(existing = []) {
  const io = { copied: [], made: [], exists: (p) => existing.some((e) => p.endsWith(e)), mkdirp: (d) => io.made.push(d), copyFile: (s, d) => io.copied.push([s, d]) };
  return io;
}
const applyOf = (client, shapes, io, extra = {}) => applyProfileBundle(client, { dir: '/b', shapes }, { root: '/root', io, ...extra });
const upsertOf = (client) => client.calls.find((c) => /INSERT INTO profile_shapes/.test(c.sql));

test('inserts a shape and fills true size from the die list CCD', async () => {
  const client = fakeClient();
  const io = fakeIo();
  const r = await applyOf(client, [SHAPE()], io);
  const call = upsertOf(client);
  assert.match(call.sql, /ON CONFLICT \(die_no, plant, source, source_ref\) DO UPDATE/);
  assert.match(call.sql, /WHERE profile_shapes\.reviewed_at IS NULL/);
  assert.deepEqual(client.calls.find((c) => /existing_die_details/.test(c.sql)).params, ['090019-2501', ['GEX 1', 'GEX 01']]);
  const p = call.params;
  assert.equal(p[6], `profiles/ab/${'ab'.repeat(32)}.gif`); // image_path, no files/ prefix
  assert.equal(p[12], 4); // cavities
  assert.equal(p[16], true); // true_size
  const xs = JSON.parse(p[17]).map((q) => q[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 123.4) < 0.01);
  assert.equal(p[19], 123.4);
  assert.equal(p[20], 'ccd-scaled');
  assert.equal(p[21], 'likely');
  assert.deepEqual([r.inserted, r.updated, r.trueSized, r.dieListMisses], [1, 0, 1, 0]);
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  assert.equal(r.filesCopied, 1);
  assert.ok(io.copied[0][1].replace(/\\/g, '/').endsWith(`/root/profiles/ab/${'ab'.repeat(32)}.gif`));
});

test('a GEX 2 shape without CCD stays not true size', async () => {
  const client = fakeClient({ dieRow: { cavity: 2, die_type: 'SOLID', profile_number: '090036', ccd: null } });
  const r = await applyOf(client, [SHAPE({ plant: 'GEX 2', die_no: '090036-2501' })], fakeIo());
  const p = upsertOf(client).params;
  assert.deepEqual([p[16], p[17], p[18], p[19], p[20], p[21]], [false, null, null, null, null, null]);
  assert.equal(r.trueSized, 0);
  assert.deepEqual(client.calls.find((c) => /existing_die_details/.test(c.sql)).params[1], ['GEX 2']);
});

test('a reviewed row keeps its cleared flag', async () => {
  const client = fakeClient({ upsertCount: 0 });
  const r = await applyOf(client, [SHAPE({ needs_review: true })], fakeIo());
  assert.deepEqual([r.inserted, r.updated, r.skippedReviewed], [0, 0, 1]);
  assert.match(upsertOf(client).sql, /WHERE profile_shapes\.reviewed_at IS NULL/);
});

test('dry run rolls back and copies nothing', async () => {
  const client = fakeClient();
  const io = fakeIo();
  const r = await applyOf(client, [SHAPE()], io, { dryRun: true });
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!client.calls.some((c) => c.sql === 'COMMIT'));
  assert.deepEqual([io.copied.length, io.made.length, r.filesCopied], [0, 0, 0]);
});

test('die list miss is counted and the row still inserted', async () => {
  const client = fakeClient({ dieRow: null });
  const r = await applyOf(client, [SHAPE()], fakeIo());
  const p = upsertOf(client).params;
  assert.deepEqual([r.dieListMisses, r.inserted, p[12], p[16], p[13]], [1, 1, null, false, 'Hollow']);
});

// What the database holds after applying SHAPE() against the default die list row.
const storedRow = (s) => ({
  signature: s.signature, holes_unit: s.holes_unit, hole_count: s.hole_count, style: s.style, profile_number: s.profile_number,
  cavities: 4, die_type: s.die_type, aspect_ratio: String(s.aspect_ratio), solidity: String(s.solidity),
  true_size: true, ccd_mm: '123.4', needs_review: false, review_reason: null, image_path: `profiles/ab/${'ab'.repeat(32)}.gif`,
});

test('a die list cavity change on an otherwise identical row is an update carrying the new cavities', async () => {
  const s = SHAPE();
  const client = fakeClient({ existing: storedRow(s), inserted: false, dieRow: { cavity: 6, die_type: 'HOLLOW', profile_number: '090019', ccd: '123.4' } });
  const r = await applyOf(client, [s], fakeIo([`${'ab'.repeat(32)}.gif`]));
  assert.deepEqual([r.unchanged, r.updated, r.inserted], [0, 1, 0]);
  assert.equal(upsertOf(client).params[12], 6);
});

test('a changed hole count or hole outline is an update', async () => {
  const s = SHAPE();
  for (const stored of [{ ...storedRow(s), hole_count: 2 }, { ...storedRow(s), holes_unit: [] }]) {
    const client = fakeClient({ existing: stored, inserted: false });
    const r = await applyOf(client, [s], fakeIo());
    assert.deepEqual([r.unchanged, r.updated], [0, 1]);
  }
});

test('an unchanged row is neither written nor re-copied when the file exists', async () => {
  const s = SHAPE();
  const existing = { ...storedRow(s), true_size: true, ccd_mm: '123.4', needs_review: false, review_reason: null, image_path: `profiles/ab/${'ab'.repeat(32)}.gif` };
  const client = fakeClient({ existing });
  const r = await applyOf(client, [s], fakeIo([`${'ab'.repeat(32)}.gif`]));
  assert.deepEqual([r.unchanged, r.inserted, r.filesCopied], [1, 0, 0]);
  assert.equal(upsertOf(client), undefined);
});

test('trueSizeFromCcd scales so the enclosing circle equals the CCD', () => {
  const t = trueSizeFromCcd({ outer_unit: unitRing(0.5), holes_unit: [] }, 200);
  assert.equal(t.ccd_mm, 200);
  assert.equal(t.source, 'ccd-scaled');
  const xs = t.outer_mm.map((q) => q[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 200) < 1e-6);
});

test('readProfileBundle rejects a bundle of the wrong kind', () => {
  const fsLike = { readFileSync: () => JSON.stringify({ version: 1, kind: 'tooling' }) };
  assert.throws(() => readProfileBundle('/b', fsLike), /profile-shapes/);
});
