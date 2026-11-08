'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const toolingFinder = require('./toolingFinder.cjs');
const profileSimilarity = require('./profileSimilarity.cjs');
const review = require('./toolingReview.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'tooling', 'dieshop-21599.dxf');
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];
const SQUARE_B = [[30, 0], [40, 0], [40, 10], [30, 10]];

// Records every query; `answer(sql, params)` returns a result or undefined for the default.
function fakeClient(answer = () => undefined) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return (await answer(sql, params)) || { rows: [], rowCount: 0 };
    },
  };
}

// Swap a module's invalidate for a spy for the length of one test.
function spyOn(mod, t) {
  const seen = [];
  const real = mod.invalidate;
  mod.invalidate = (plant) => { seen.push(plant); };
  t.after(() => { mod.invalidate = real; });
  return seen;
}

const toolingRow = { id: 7, plant: 'GEX 1' };
const lookup = (sql) => (/^SELECT id, plant FROM toolings WHERE id = \$1/.test(sql) ? { rows: [toolingRow], rowCount: 1 } : undefined);

test('openingRowFromExtraction maps an extraction result to tooling_openings columns', () => {
  const row = review.openingRowFromExtraction({
    source: 'dxf', outer: SQUARE, pockets: [SQUARE], pocketGapMm: null, confidence: 'likely', notes: ['a', 'b'], meta: { mmPerUnit: 1 },
  }, { drawingId: 55, drawingFile: 'I-21599/aaaaaaaa_x.dxf' });
  assert.deepEqual(row, {
    outer_outline: JSON.stringify(SQUARE), pockets: JSON.stringify([SQUARE]), pocket_gap_mm: null, extraction_source: 'dxf',
    confidence: 'likely', drawing_file: 'I-21599/aaaaaaaa_x.dxf', drawing_id: 55, extraction_note: 'a; b',
    extraction_meta: JSON.stringify({ mmPerUnit: 1 }),
  });
  const bare = review.openingRowFromExtraction({ outer: null, pockets: null });
  assert.equal(bare.outer_outline, null);
  assert.equal(bare.pockets, null);
  assert.equal(bare.confidence, 'none');
  assert.equal(bare.extraction_note, '');
  assert.equal(bare.drawing_id, null);
});

test('confirm sets confidence and reviewer', async (t) => {
  const seen = spyOn(toolingFinder, t);
  const client = fakeClient((sql) => lookup(sql)
    || (/^UPDATE tooling_openings/.test(sql) ? { rows: [{ id: 3, tooling_id: 7, confidence: 'confirmed' }], rowCount: 1 } : undefined));
  const opening = await review.reviewOpening(client, 7, { action: 'confirm', note: 'checked on the drawing', userId: 12 });
  assert.equal(opening.confidence, 'confirmed');
  const up = client.calls.find((c) => /^UPDATE tooling_openings/.test(c.sql));
  assert.match(up.sql, /confidence = 'confirmed'/);
  assert.match(up.sql, /reviewed_by = \$2, reviewed_at = CURRENT_TIMESTAMP, review_note = \$3, updated_at = CURRENT_TIMESTAMP/);
  assert.match(up.sql, /WHERE tooling_id = \$1/);
  assert.doesNotMatch(up.sql, /pockets/);
  assert.deepEqual(up.params, [7, 12, 'checked on the drawing']);
  assert.ok(!client.calls.some((c) => /UPDATE toolings|INSERT INTO toolings/.test(c.sql)), 'never touches toolings');
  assert.deepEqual(seen, ['GEX 1']);
});

test('confirm or none without an opening is a 404; an unknown tooling is a 404', async () => {
  const noOpening = fakeClient(lookup);
  await assert.rejects(review.reviewOpening(noOpening, 7, { action: 'confirm', userId: 1 }), { status: 404, message: 'No opening to review' });
  await assert.rejects(review.reviewOpening(noOpening, 7, { action: 'none', userId: 1 }), { status: 404, message: 'No opening to review' });
  await assert.rejects(review.reviewOpening(fakeClient(), 99, { action: 'confirm', userId: 1 }), { status: 404, message: 'Tooling not found' });
  await assert.rejects(review.reviewOpening(noOpening, 7, { action: 'approve', userId: 1 }), { status: 400 });
});

test('correct validates and stores manual pockets', async (t) => {
  const seen = spyOn(toolingFinder, t);
  const bad = [
    { pockets: undefined }, { pockets: [] }, { pockets: [[[0, 0], [1, 1]]] }, { pockets: [[[0, 0], [1, 'x'], [2, 2]]] },
    { pockets: [[[0, 0], [1, Infinity], [2, 2]]] }, { pockets: [SQUARE], outer: [[0, 0]] },
  ];
  for (const body of bad) {
    await assert.rejects(review.reviewOpening(fakeClient(lookup), 7, { action: 'correct', userId: 1, ...body }), { status: 400 }, JSON.stringify(body));
  }
  const client = fakeClient((sql, params) => lookup(sql)
    || (/^INSERT INTO tooling_openings/.test(sql) ? { rows: [{ id: 3, tooling_id: 7, confidence: 'confirmed', pockets: JSON.parse(params[2]) }], rowCount: 1 } : undefined));
  const opening = await review.reviewOpening(client, 7, { action: 'correct', pockets: [SQUARE, SQUARE_B], note: 'redrawn', userId: 12 });
  assert.equal(opening.confidence, 'confirmed');
  const ins = client.calls.find((c) => /^INSERT INTO tooling_openings/.test(c.sql));
  assert.match(ins.sql, /ON CONFLICT \(tooling_id\) DO UPDATE SET/);
  assert.match(ins.sql, /outer_outline = COALESCE\(EXCLUDED\.outer_outline, tooling_openings\.outer_outline\)/);
  assert.match(ins.sql, /'manual', 'confirmed'/);
  assert.match(ins.sql, /reviewed_at = CURRENT_TIMESTAMP/);
  assert.deepEqual(ins.params, [7, null, JSON.stringify([SQUARE, SQUARE_B]), 30, 12, 'redrawn']);
  assert.deepEqual(seen, ['GEX 1']);

  const withOuter = fakeClient((sql) => lookup(sql) || (/^INSERT/.test(sql) ? { rows: [{}], rowCount: 1 } : undefined));
  await review.reviewOpening(withOuter, 7, { action: 'correct', pockets: [SQUARE], outer: SQUARE_B, userId: 12 });
  const p = withOuter.calls.find((c) => /^INSERT/.test(c.sql)).params;
  assert.equal(p[1], JSON.stringify(SQUARE_B));
  assert.equal(p[3], null, 'one pocket has no gap');
  assert.equal(p[5], null, 'no note is NULL');
});

test('mark none clears pockets, keeps the tooling and drawing, invalidates', async (t) => {
  const seen = spyOn(toolingFinder, t);
  const client = fakeClient((sql) => lookup(sql)
    || (/^UPDATE tooling_openings/.test(sql) ? { rows: [{ id: 3, confidence: 'none', pockets: null, drawing_id: 55 }], rowCount: 1 } : undefined));
  const opening = await review.reviewOpening(client, 7, { action: 'none', note: 'no pocket on this drawing', userId: 12 });
  assert.equal(opening.pockets, null);
  const up = client.calls.find((c) => /^UPDATE tooling_openings/.test(c.sql));
  assert.match(up.sql, /pockets = NULL/);
  assert.match(up.sql, /confidence = 'none'/);
  assert.doesNotMatch(up.sql, /outer_outline|drawing_id|drawing_file|extraction_note/);
  assert.deepEqual(up.params, [7, 12, 'no pocket on this drawing']);
  assert.ok(!client.calls.some((c) => /toolings (SET|\()|DELETE/.test(c.sql)), 'the tooling row is never written');
  assert.deepEqual(seen, ['GEX 1']);
});

test('updateTooling normalises the size class and refuses unknown fields', async (t) => {
  const seen = spyOn(toolingFinder, t);
  await assert.rejects(review.updateTooling(fakeClient(), 'I-21599', { kind: 'bolster', plant: 'GEX 2', userId: 1 }),
    { status: 400, message: 'Unknown fields: kind, plant' });
  await assert.rejects(review.updateTooling(fakeClient(), 'I-21599', { status: 'unverified', userId: 1 }), { status: 400 });
  await assert.rejects(review.updateTooling(fakeClient(), 'I-21599', { sizeClass: 'big', userId: 1 }), { status: 400 });
  await assert.rejects(review.updateTooling(fakeClient(), 'I-21599', { cavities: 0, userId: 1 }), { status: 400 });
  await assert.rejects(review.updateTooling(fakeClient(), 'I-21599', { userId: 1 }), { status: 400 });
  await assert.rejects(review.updateTooling(fakeClient(), 'NOPE', { notes: 'x', userId: 1 }), { status: 404 });

  const client = fakeClient((sql) => (/^UPDATE toolings/.test(sql) ? { rows: [{ id: 7, number: 'I-21599', plant: 'GEX 1', size_class: '175X80' }], rowCount: 1 } : undefined));
  const tooling = await review.updateTooling(client, 'I-21599', {
    sizeClass: 'Ø175 x 80', status: 'active', cavities: 2, location: ' RACK 4 ', notes: '', userId: 1,
  });
  assert.equal(tooling.size_class, '175X80');
  const up = client.calls[0];
  assert.match(up.sql, /^UPDATE toolings SET /);
  assert.match(up.sql, /size_class = \$\d+, size_class_source = 'manual', size_class_confidence = 'confirmed'/);
  assert.match(up.sql, /updated_at = CURRENT_TIMESTAMP WHERE number = \$1 RETURNING \*/);
  assert.deepEqual(up.params, ['I-21599', 'RACK 4', 'active', '175X80', 2, null]);
  assert.deepEqual(seen, ['GEX 1']);

  const nulls = fakeClient(() => ({ rows: [{ plant: 'GEX 1' }], rowCount: 1 }));
  await review.updateTooling(nulls, 'I-21599', { cavities: null, userId: 1 });
  assert.match(nulls.calls[0].sql, /SET cavities = \$2, updated_at/);
  assert.deepEqual(nulls.calls[0].params, ['I-21599', null]);
});

test('createTooling infers kind from the number and refuses duplicates', async (t) => {
  const seen = spyOn(toolingFinder, t);
  await assert.rejects(review.createTooling(fakeClient(), { number: 'hello', plant: 'GEX 1', userId: 1 }), { status: 400 });
  await assert.rejects(review.createTooling(fakeClient(), { number: 'BOL-14017', userId: 1 }), { status: 400, message: 'plant must be GEX 1 or GEX 2' });
  await assert.rejects(review.createTooling(fakeClient(), { number: 'I-21599', kind: 'ring', userId: 1 }), { status: 400 });

  const client = fakeClient((sql, params) => (/^INSERT INTO toolings/.test(sql)
    ? { rows: [{ id: 9, number: params[0], kind: params[1], plant: params[2] }], rowCount: 1 } : undefined));
  const tooling = await review.createTooling(client, { number: 'i 21599', plant: 'gex 01', sizeClass: '175x80', location: 'RACK 1', userId: 1 });
  assert.equal(tooling.number, 'I-21599');
  assert.equal(tooling.kind, 'insert');
  const ins = client.calls[0];
  assert.match(ins.sql, /'manual', 'active', '\{\}'/);
  assert.match(ins.sql, /ON CONFLICT \(number\) DO NOTHING RETURNING \*/);
  assert.deepEqual(ins.params, ['I-21599', 'insert', 'GEX 1', '175X80', 'manual', 'confirmed', null, 'RACK 1', '21599', null]);
  assert.deepEqual(seen, ['GEX 1']);

  // A GEX 2 insert number carries its plant and cavity count.
  const gex2 = fakeClient(() => ({ rows: [{ id: 10 }], rowCount: 1 }));
  await review.createTooling(gex2, { number: '25ic2-110634', userId: 1 });
  assert.deepEqual(gex2.calls[0].params.slice(0, 7), ['25IC2-110634', 'insert', 'GEX 2', null, null, null, 2]);

  const dup = fakeClient(() => ({ rows: [], rowCount: 0 }));
  await assert.rejects(review.createTooling(dup, { number: 'I-21599', plant: 'GEX 1', userId: 1 }), { status: 409 });
});

// Fake disk: records writes, says a path exists once written.
function fakeIo() {
  const written = new Map();
  const dirs = [];
  return {
    written, dirs,
    io: { exists: (p) => written.has(p), mkdirp: (d) => { dirs.push(d); }, writeFile: (p, b) => { written.set(p, b); } },
  };
}

test('attachDrawing runs the extractor and keeps a confirmed opening', async (t) => {
  const seen = spyOn(toolingFinder, t);
  const buffer = fs.readFileSync(FIXTURE);
  const tooling = { id: 7, number: 'I-21599', plant: 'GEX 1', size_class: '175X80', cavities: 1 };
  const sha = require('./toolingDrawings.cjs').sha256Of(buffer);
  const drawing = { id: 55, tooling_id: 7, file_path: `I-21599/${sha.slice(0, 8)}_I-21599.dxf`, is_primary: true };

  const handler = (openingRowCount, existing) => (sql) => {
    if (/^INSERT INTO tooling_drawings/.test(sql)) return { rows: [drawing], rowCount: 1 };
    if (/^INSERT INTO tooling_openings/.test(sql)) return openingRowCount ? { rows: [{ id: 3, confidence: 'confirmed', extraction_source: 'dxf' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/^SELECT \* FROM tooling_openings/.test(sql)) return { rows: [existing], rowCount: 1 };
    return undefined;
  };

  // A fresh tooling: drawing stored and inserted, opening written from the real extraction.
  const fresh = fakeClient(handler(1));
  const { io, written, dirs } = fakeIo();
  const out = await review.attachDrawing(fresh, tooling, { buffer, originalName: 'I-21599.dxf', root: '/store', io });
  assert.equal(out.openingKept, false);
  assert.equal(out.drawing.id, 55);
  const abs = path.resolve('/store', drawing.file_path);
  assert.equal(written.get(abs), buffer);
  assert.deepEqual(dirs, [path.dirname(abs)]);
  const dIns = fresh.calls.find((c) => /^INSERT INTO tooling_drawings/.test(c.sql));
  assert.match(dIns.sql, /'manual'/);
  assert.match(dIns.sql, /NOT EXISTS \(SELECT 1 FROM tooling_drawings p WHERE p\.tooling_id = \$1 AND p\.is_primary\)/);
  assert.deepEqual(dIns.params, [7, drawing.file_path, 'I-21599.dxf', 'dxf', sha, buffer.length]);
  const oIns = fresh.calls.find((c) => /^INSERT INTO tooling_openings/.test(c.sql));
  assert.match(oIns.sql, /WHERE tooling_openings\.reviewed_at IS NULL AND tooling_openings\.confidence <> 'confirmed'/);
  assert.equal(oIns.params[0], 7);
  assert.equal(JSON.parse(oIns.params[2]).length, 1, 'one pocket from the real DXF');
  assert.equal(oIns.params[4], 'dxf');
  assert.equal(oIns.params[5], 'confirmed');
  assert.equal(oIns.params[6], drawing.file_path);
  assert.equal(oIns.params[7], 55);
  assert.deepEqual(fresh.calls.map((c) => c.sql).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(s)), ['BEGIN', 'COMMIT']);
  assert.deepEqual(seen, ['GEX 1']);

  // A confirmed opening: the upsert writes nothing and the existing row comes back.
  const kept = fakeClient(handler(0, { id: 3, confidence: 'confirmed', extraction_source: 'manual' }));
  const second = fakeIo();
  second.io.exists = () => true; // same sha already on disk: not rewritten
  const out2 = await review.attachDrawing(kept, tooling, { buffer, originalName: 'I-21599.dxf', root: '/store', io: second.io });
  assert.equal(out2.openingKept, true);
  assert.equal(out2.opening.extraction_source, 'manual');
  assert.equal(second.written.size, 0);

  await assert.rejects(review.attachDrawing(fakeClient(), tooling, { buffer, originalName: 'x.dwg', root: '/store', io }), { status: 400 });
});

test('attachDrawing rolls back and keeps the opening when the drawing insert fails', async () => {
  const client = fakeClient((sql) => { if (/^INSERT INTO tooling_drawings/.test(sql)) throw new Error('boom'); });
  const { io } = fakeIo();
  const tooling = { id: 7, number: 'I-21599', plant: 'GEX 1', size_class: null, cavities: null };
  await assert.rejects(review.attachDrawing(client, tooling, { buffer: fs.readFileSync(FIXTURE), originalName: 'a.dxf', root: '/store', io }), /boom/);
  assert.ok(client.calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!client.calls.some((c) => /tooling_openings/.test(c.sql)));
});

test('extractForUpload passes the hints to the DXF extractor', async () => {
  const r = await review.extractForUpload({ buffer: fs.readFileSync(FIXTURE), format: 'dxf', hints: { sizeClass: '175X80', cavities: 1 } });
  assert.equal(r.source, 'dxf');
  assert.equal(r.pockets.length, 1);
});

test('reviewProfileShape clears or keeps the flag and appends the note', async (t) => {
  const seen = spyOn(profileSimilarity, t);
  const client = fakeClient((sql) => (/^UPDATE profile_shapes/.test(sql) ? { rows: [{ id: 4, plant: 'GEX 2', needs_review: false }], rowCount: 1 } : undefined));
  const row = await review.reviewProfileShape(client, 4, { action: 'clear', note: 'shape is right', userId: 12 });
  assert.equal(row.needs_review, false);
  const up = client.calls[0];
  assert.match(up.sql, /needs_review = \$2/);
  assert.match(up.sql, /review_reason = CASE WHEN \$4::text IS NULL THEN review_reason ELSE concat_ws\('; ', review_reason, 'reviewer: ' \|\| \$4\) END/);
  assert.match(up.sql, /reviewed_by = \$3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP/);
  assert.deepEqual(up.params, [4, false, 12, 'shape is right']);
  assert.deepEqual(seen, ['GEX 2']);

  const keep = fakeClient(() => ({ rows: [{ id: 4, plant: 'GEX 2' }], rowCount: 1 }));
  await review.reviewProfileShape(keep, 4, { action: 'keep', userId: 12 });
  assert.deepEqual(keep.calls[0].params, [4, true, 12, null]);

  await assert.rejects(review.reviewProfileShape(fakeClient(), 4, { action: 'drop', userId: 1 }), { status: 400 });
  await assert.rejects(review.reviewProfileShape(fakeClient(), 404, { action: 'clear', userId: 1 }), { status: 404 });
});

test('attachDrawing refuses an unreadable drawing with 422 and stores nothing', async () => {
  const client = fakeClient();
  const { io, written } = fakeIo();
  const tooling = { id: 7, number: 'I-21599', plant: 'GEX 1', size_class: null, cavities: null };
  await assert.rejects(review.attachDrawing(client, tooling, { buffer: Buffer.from('not a pdf'), originalName: 'a.pdf', root: '/store', io }),
    { status: 422, message: /^Could not read the drawing: / });
  assert.equal(written.size, 0);
  assert.deepEqual(client.calls, []);
});
