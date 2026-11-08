'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { knownFromExport, buildBundle, matchFiles, readBundle, applyBundle } = require('./toolingBundle.cjs');

const mk = (relPath, plant, kindHint) => {
  const base = relPath.split('/').pop();
  const dot = base.lastIndexOf('.');
  return { absPath: `/arc/${relPath}`, relPath, stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase(), plant, kindHint };
};

const DWG = mk('Toolings/Dieshop - Insert Drawings/AutoCad/I-21599.dwg', 'GEX 1', 'insert');
const SCRAP = mk('Toolings/Dieshop - Insert Drawings/AutoCad/I-30000 SCRAP.dwg', 'GEX 1', 'insert');
const BOL = mk('Toolings/Bolsters/BOL-14017 475X220.dxf', 'GEX 1', 'bolster');
const ROOT_PDF = mk('25IC1-027847.pdf', 'GEX 1', null);
const DIE_PDF = mk('Toolings/Dieshop - Insert Drawings/PDF & Tiff/21599.pdf', 'GEX 1', 'insert');
const ALL = [DWG, SCRAP, BOL, ROOT_PDF, DIE_PDF];

const known = () => knownFromExport({ toolings: [
  { number: 'I-21599', kind: 'insert', plant: 'GEX 1', size_class: '175X80', cavities: null, inventory_dims: null, status: 'active' },
  { number: 'BOL-14017', kind: 'bolster', plant: 'GEX 1', size_class: '475X220', cavities: null, inventory_dims: { a_len: 250, b_wid: 150 }, status: 'active' },
] });

function fakeIo({ dxfs = { [DWG.relPath]: '/dxf/I-21599.dxf' } } = {}) {
  const io = {
    copied: [],
    readFile: (p) => Buffer.from(`content of ${p}`),
    copyFile: (abs, rel) => io.copied.push(rel),
    dxfFor: (f) => dxfs[f.relPath] || null,
  };
  return io;
}
const result = (over = {}) => ({
  source: 'dxf', confidence: 'confirmed', sizeClass: '175X80', sizeClassConfidence: 'confirmed', cavities: 2,
  numbersInDrawing: [], outer: null, pockets: [], ...over,
});
const pdfResult = (over = {}) => result({
  source: 'pdf-vector', confidence: 'likely', sizeClass: '225X90', sizeClassConfidence: 'likely', cavities: 3, ...over,
});

test('matches, groups, copies and extracts; known toolings are hinted, unknown ones become retired toolings', async () => {
  const io = fakeIo();
  const extractors = { dxf: async () => result(), pdf: async () => pdfResult() };
  const r = await buildBundle({ files: ALL, known: known(), io, extractors });
  assert.deepEqual(r.toolings.map((t) => [t.number, t.status, t.source]), [['25IC1-027847', 'retired', 'drawing-archive']]);
  assert.equal(r.drawings.filter((d) => d.toolingNumber === 'I-21599').length, 2);
  assert.equal(r.drawings.find((d) => d.toolingNumber === 'I-21599' && d.isPrimary).format, 'dxf');
  assert.deepEqual(r.hints.find((h) => h.toolingNumber === 'BOL-14017').hints, { sizeClass: '475X220', cavities: null, inventoryDims: { a_len: 250, b_wid: 150 } });
  assert.equal(r.openings.length, 3);
  assert.deepEqual(r.report.skipped.map((s) => s.reason).sort(), ['scrap']);
  assert.ok(io.copied.length > 0 && io.copied.every((p) => p.startsWith('files/')));
  assert.ok(r.drawings.filter((d) => d.bundleFile).every((d) => d.bundleFile.startsWith('files/')));
  assert.equal(r.report.byConfidence.confirmed, 2);
  assert.equal(r.report.byConfidence.likely, 1);
  assert.equal(r.report.limited, false);
});

test('the Dieshop PDF is attached but the DXF is extracted when both exist', async () => {
  const used = [];
  const extractors = {
    dxf: async () => { used.push('dxf'); return result({ source: 'dxf' }); },
    pdf: async () => { used.push('pdf'); return pdfResult(); },
  };
  const r = await buildBundle({ files: [DWG, DIE_PDF], known: known(), io: fakeIo(), extractors });
  const openings = r.openings.filter((o) => o.toolingNumber === 'I-21599');
  assert.equal(openings.length, 1);
  assert.equal(openings[0].extraction.source, 'dxf');
  assert.deepEqual(used, ['dxf']);
  const dxfRow = r.drawings.find((d) => d.format === 'dxf');
  assert.equal(openings[0].drawingSha256, dxfRow.sha256);
  assert.equal(dxfRow.originalName, 'I-21599.dxf');
  assert.equal(dxfRow.archivePath, DWG.relPath);
});

test('a DWG with no converted DXF is attached as dwg and reported, not extracted', async () => {
  const io = fakeIo({ dxfs: {} });
  const extractors = { dxf: async () => { throw new Error('must not run'); }, pdf: async () => pdfResult() };
  const r = await buildBundle({ files: [DWG], known: known(), io, extractors });
  assert.equal(r.drawings.length, 1);
  assert.equal(r.drawings[0].format, 'dwg');
  assert.equal(r.drawings[0].bundleFile, null);
  assert.equal(r.openings.length, 0);
  assert.equal(r.report.extractionFailures.length, 1);
  assert.match(r.report.extractionFailures[0].error, /no DXF/);
  assert.deepEqual(io.copied, []);
  // with a PDF beside it, the PDF becomes the extraction source
  const r2 = await buildBundle({ files: [DWG, DIE_PDF], known: known(), io: fakeIo({ dxfs: {} }), extractors });
  assert.equal(r2.openings.length, 1);
  assert.equal(r2.openings[0].extraction.source, 'pdf-vector');
});

test('a new tooling takes its size class and cavities from the extraction, with the drawing confidence', async () => {
  const extractors = { dxf: async () => result(), pdf: async () => pdfResult() };
  const r = await buildBundle({ files: [ROOT_PDF], known: known(), io: fakeIo(), extractors });
  const t = r.toolings[0];
  assert.equal(t.size_class, '225X90');
  assert.equal(t.size_class_source, 'drawing');
  assert.equal(t.size_class_confidence, 'likely');
  assert.equal(t.cavities, 3);
  assert.equal(t.notes, 'from drawing archive: 25IC1-027847.pdf');
  assert.equal(t.kind, 'insert');
  assert.equal(t.plant, 'GEX 2');
  // no extracted size: the file-name size is used with likely confidence
  const named = mk('Toolings/Dieshop - Insert Drawings/PDF & Tiff/22222 300X70.pdf', 'GEX 1', 'insert');
  const blank = { dxf: extractors.dxf, pdf: async () => pdfResult({ sizeClass: null, sizeClassConfidence: null, cavities: null }) };
  const r2 = await buildBundle({ files: [named], known: known(), io: fakeIo(), extractors: blank });
  assert.equal(r2.toolings[0].size_class, '300X70');
  assert.equal(r2.toolings[0].size_class_confidence, 'likely');
});

test('limit stops after N toolings and the report says so', async () => {
  const extractors = { dxf: async () => result(), pdf: async () => pdfResult() };
  const r = await buildBundle({ files: ALL, known: known(), io: fakeIo(), extractors, limit: 1 });
  assert.equal(new Set(r.drawings.map((d) => d.toolingNumber)).size, 1);
  assert.equal(r.report.limited, true);
});

test('hints never leak between toolings', async () => {
  const seen = [];
  const extractors = {
    dxf: async (t, h) => { seen.push(h); h.sizeClass = 'MUTATED'; return result(); },
    pdf: async (b, h) => { seen.push(h); h.sizeClass = 'MUTATED'; return pdfResult(); },
  };
  const r = await buildBundle({ files: ALL, known: known(), io: fakeIo(), extractors });
  assert.deepEqual(r.hints.find((h) => h.toolingNumber === '25IC1-027847').hints, { sizeClass: null, cavities: 1, inventoryDims: null });
  assert.deepEqual(r.hints.find((h) => h.toolingNumber === 'BOL-14017').hints.inventoryDims, { a_len: 250, b_wid: 150 });
  assert.equal(r.hints.find((h) => h.toolingNumber === 'I-21599').hints.sizeClass, '175X80');
  assert.equal(seen.length, 3);
});

test('a drawing whose own numbers do not include the tooling number is flagged; size-bearing numbers are ignored', async () => {
  const ex = (numbers) => ({ dxf: async () => result({ numbersInDrawing: numbers }), pdf: async () => pdfResult({ numbersInDrawing: numbers }) });
  const bad = await buildBundle({ files: [DIE_PDF], known: known(), io: fakeIo(), extractors: ex(['I-99999']) });
  assert.equal(bad.report.warnings.length, 1);
  assert.match(bad.report.warnings[0].warning, /number mismatch/);
  const ok = await buildBundle({ files: [DIE_PDF], known: known(), io: fakeIo(), extractors: ex(['I-21599', 'I-11111']) });
  assert.equal(ok.report.warnings.length, 0);
  const sized = await buildBundle({ files: [DIE_PDF], known: known(), io: fakeIo(), extractors: ex(['BOL-475X220']) });
  assert.equal(sized.report.warnings.length, 0);
});

test('extractor errors are reported per tooling, not fatal', async () => {
  const extractors = { dxf: async () => { throw new Error('boom'); }, pdf: async () => pdfResult() };
  const r = await buildBundle({ files: ALL, known: known(), io: fakeIo(), extractors });
  assert.equal(r.report.extractionFailures.length, 2); // I-21599 and BOL-14017 both extract from a DXF
  assert.ok(r.report.extractionFailures.every((f) => f.error === 'boom'));
  assert.equal(r.openings.length, 1);
});

test('matchFiles lists skips and unrecognised stems', () => {
  const odd = mk('Toolings/Bolsters/WHATEVER.pdf', 'GEX 1', 'bolster');
  const m = matchFiles([...ALL, odd]);
  assert.equal(m.groups.size, 3);
  assert.deepEqual(m.unmatched, ['WHATEVER']);
  assert.deepEqual(m.skipped.map((s) => s.reason).sort(), ['scrap', 'unrecognised']);
});

test('an unreadable file is reported and skipped; the run completes and other toolings are intact', async () => {
  const io = fakeIo();
  const realRead = io.readFile;
  io.readFile = (p) => { if (p === BOL.absPath) throw new Error('EBUSY'); return realRead(p); };
  const extractors = { dxf: async () => result(), pdf: async () => pdfResult() };
  const r = await buildBundle({ files: ALL, known: known(), io, extractors });
  assert.equal(r.report.readFailures.length, 1);
  assert.equal(r.report.readFailures[0].toolingNumber, 'BOL-14017');
  assert.equal(r.report.readFailures[0].error, 'EBUSY');
  assert.equal(r.drawings.filter((d) => d.toolingNumber === 'BOL-14017').length, 0);
  assert.equal(r.openings.length, 2);
  assert.equal(r.drawings.filter((d) => d.toolingNumber === 'I-21599').length, 2);
});

test('identical bytes under two names leave one stored row, and it is primary', async () => {
  const a = mk('Toolings/Dieshop - Insert Drawings/PDF & Tiff/21599.pdf', 'GEX 1', 'insert');
  const b = mk('Toolings/Dieshop - Insert Drawings/PDF & Tiff/21599 FIN.pdf', 'GEX 1', 'insert');
  const io = fakeIo(); io.readFile = () => Buffer.from('same');
  const extractors = { dxf: async () => result(), pdf: async () => pdfResult() };
  const r = await buildBundle({ files: [b, a], known: known(), io, extractors });
  const rows = r.drawings.filter((d) => d.toolingNumber === 'I-21599');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isPrimary, true);
  assert.equal(r.openings[0].drawingSha256, rows[0].sha256);
});

test('a DWG without a DXF is never primary; the PDF beside it is', async () => {
  const extractors = { dxf: async () => result(), pdf: async () => pdfResult() };
  const r = await buildBundle({ files: [DWG, DIE_PDF], known: known(), io: fakeIo({ dxfs: {} }), extractors });
  assert.equal(r.drawings.find((d) => d.format === 'dwg').isPrimary, false);
  assert.equal(r.drawings.find((d) => d.format === 'pdf').isPrimary, true);
});

test('a null extraction result is a reported failure, not a null opening', async () => {
  const r = await buildBundle({ files: [DIE_PDF], known: known(), io: fakeIo(), extractors: { dxf: async () => null, pdf: async () => null } });
  assert.equal(r.openings.length, 0);
  assert.equal(r.report.extractionFailures.length, 1);
});

// ---- apply half: fake client records SQL and answers by pattern ----------------------------------
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function fakeClient({ ids = { 'I-21599': 7, 'BOL-1': 8 }, tooling = { size_class: null, cavities: null },
  openingRowCount = 1, drawingRowCount = 1 } = {}) {
  const calls = [];
  const client = { calls, query: async (sql, params) => {
    calls.push({ sql, params });
    if (/INSERT INTO toolings/.test(sql)) return { rows: [{ inserted: true }], rowCount: 1 };
    if (/SELECT id, number FROM toolings/.test(sql)) {
      return { rows: params[0].filter((n) => ids[n]).map((n) => ({ id: ids[n], number: n })), rowCount: 0 };
    }
    if (/INSERT INTO tooling_drawings/.test(sql)) return { rows: [], rowCount: drawingRowCount };
    if (/SELECT id, file_path FROM tooling_drawings/.test(sql)) return { rows: [{ id: 55, file_path: 'I-21599/aaaaaaaa_x.dxf' }], rowCount: 1 };
    if (/INSERT INTO tooling_openings/.test(sql)) return { rows: [], rowCount: openingRowCount };
    if (/SELECT size_class, cavities FROM toolings/.test(sql)) return { rows: [tooling], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  return client;
}

const extraction = (over = {}) => ({
  source: 'dxf', outer: [[0, 0], [1, 0], [1, 1]], pockets: [[[0, 0], [1, 0], [1, 1]]], pocketGapMm: 2.5,
  cavities: 1, sizeClass: '175X80', sizeClassSource: 'drawing', sizeClassConfidence: 'confirmed',
  confidence: 'likely', notes: ['a', 'b'], ...over,
});
const drawingRow = (over = {}) => ({
  toolingNumber: 'I-21599', bundleFile: 'files/I-21599/aaaaaaaa_x.dxf', originalName: 'x.dxf', archivePath: 'x.dxf',
  format: 'dxf', matchBasis: 'filename-code', sha256: SHA_A, byteSize: 10, isPrimary: true, ...over,
});
const bundleOf = (over = {}) => ({
  dir: '/b', manifest: { version: 1 }, report: null,
  toolings: [], drawings: [drawingRow()],
  openings: [{ toolingNumber: 'I-21599', drawingSha256: SHA_A, extraction: extraction() }], ...over,
});
function fakeApplyIo({ existing = [] } = {}) {
  const copied = []; const dirs = [];
  return { copied, dirs, io: {
    copyFile: (src, dest) => copied.push([src, dest]),
    mkdirp: (d) => dirs.push(d),
    exists: (p) => existing.some((e) => p.endsWith(e)),
  } };
}
const apply = (client, bundle, io, extra = {}) => applyBundle(client, bundle, { root: '/root', io, ...extra });

test('inserts new toolings as retired without touching status on conflict', async () => {
  const client = fakeClient();
  const t = { number: 'BOL-1', kind: 'bolster', plant: 'GEX 1', size_class: '300X100', size_class_source: 'drawing',
    size_class_confidence: 'likely', cavities: null, source: 'drawing-archive', status: 'retired', notes: 'n' };
  const { io } = fakeApplyIo();
  const r = await apply(client, bundleOf({ toolings: [t], drawings: [], openings: [] }), io);
  const call = client.calls.find((c) => /INSERT INTO toolings/.test(c.sql));
  assert.match(call.sql, /ON CONFLICT \(number\) DO UPDATE/);
  const set = call.sql.split('DO UPDATE')[1];
  assert.doesNotMatch(set, /status\s*=/);
  assert.doesNotMatch(set, /(^|[\s,])(kind|plant|source|held_presses)\s*=/);
  assert.ok(call.params.includes('retired'));
  assert.equal(r.toolingsInserted, 1);
});

test('a known tooling with no size class receives the drawing-derived one via COALESCE', async () => {
  const client = fakeClient();
  const { io } = fakeApplyIo();
  const r = await apply(client, bundleOf(), io);
  const up = client.calls.find((c) => /UPDATE toolings/.test(c.sql));
  assert.match(up.sql, /COALESCE\(size_class, \$2\)/);
  assert.match(up.sql, /WHERE number = \$1/);
  assert.doesNotMatch(up.sql, /status/);
  assert.deepEqual(up.params, ['I-21599', '175X80', 'confirmed', 1]);
  assert.equal(r.toolingsUpdated, 1);
});

test('a known tooling that already has its size class and cavities is not updated or counted', async () => {
  const client = fakeClient({ tooling: { size_class: '175X80', cavities: 1 } });
  const { io } = fakeApplyIo();
  const r = await apply(client, bundleOf(), io);
  assert.equal(r.toolingsUpdated, 0);
  assert.equal(client.calls.filter((c) => /UPDATE toolings/.test(c.sql)).length, 0);
});

test('drawings are keyed by tooling and sha; files are copied once', async () => {
  const client = fakeClient();
  client.query = ((orig) => async (sql, params) => {
    const res = await orig(sql, params);
    if (/INSERT INTO tooling_drawings/.test(sql) && params.includes(SHA_B)) return { rows: [], rowCount: 0 };
    return res;
  })(client.query);
  const second = drawingRow({ bundleFile: 'files/I-21599/bbbbbbbb_y.pdf', originalName: 'y.pdf', format: 'pdf', sha256: SHA_B, isPrimary: false });
  const { io, copied } = fakeApplyIo({ existing: ['bbbbbbbb_y.pdf'] });
  const r = await apply(client, bundleOf({ drawings: [drawingRow(), second] }), io);
  const ins = client.calls.filter((c) => /INSERT INTO tooling_drawings/.test(c.sql));
  assert.equal(ins.length, 2);
  assert.match(ins[0].sql, /ON CONFLICT \(tooling_id, sha256\) DO NOTHING/);
  assert.equal(ins[0].params[0], 7);
  assert.ok(ins[0].params.includes('I-21599/aaaaaaaa_x.dxf'), 'file_path has no files/ prefix');
  assert.equal(r.drawingsInserted, 1);
  assert.equal(r.drawingsSkipped, 1);
  assert.equal(r.filesCopied, 1);
  assert.equal(copied.length, 1);
  assert.match(copied[0][1].replace(/\\/g, '/'), /\/root\/I-21599\/aaaaaaaa_x\.dxf$/);
  const prim = client.calls.filter((c) => /UPDATE tooling_drawings SET is_primary/.test(c.sql));
  assert.equal(prim.length, 1);
  assert.deepEqual(prim[0].params, [7, SHA_A]);
});

test('an unstored DWG row is counted, not inserted', async () => {
  const client = fakeClient();
  const { io } = fakeApplyIo();
  const dwg = drawingRow({ bundleFile: null, sha256: null, byteSize: null, format: 'dwg', isPrimary: false });
  const r = await apply(client, bundleOf({ drawings: [drawingRow(), dwg] }), io);
  assert.equal(r.drawingsUnstored, 1);
  assert.equal(client.calls.filter((c) => /INSERT INTO tooling_drawings/.test(c.sql)).length, 1);
});

test('an opening is written with joined notes, JSON geometry and the drawing link', async () => {
  const client = fakeClient();
  const { io } = fakeApplyIo();
  await apply(client, bundleOf(), io);
  const op = client.calls.find((c) => /INSERT INTO tooling_openings/.test(c.sql));
  assert.equal(op.params[0], 7);
  assert.equal(op.params[1], JSON.stringify(extraction().outer));
  assert.equal(op.params[2], JSON.stringify(extraction().pockets));
  assert.ok(op.params.includes('a; b'));
  assert.ok(op.params.includes(55));
  assert.ok(op.params.includes('I-21599/aaaaaaaa_x.dxf'));
});

test('a reviewed opening is never overwritten', async () => {
  const client = fakeClient({ openingRowCount: 0 });
  const { io } = fakeApplyIo();
  const r = await apply(client, bundleOf(), io);
  const op = client.calls.find((c) => /INSERT INTO tooling_openings/.test(c.sql));
  assert.match(op.sql, /ON CONFLICT \(tooling_id\) DO UPDATE/);
  assert.match(op.sql, /WHERE tooling_openings\.reviewed_at IS NULL/);
  assert.equal(r.openingsWritten, 0);
  assert.equal(r.openingsSkippedReviewed, 1);
});

test('an opening for a number the master does not have is skipped and counted', async () => {
  const client = fakeClient({ ids: {} });
  const { io } = fakeApplyIo();
  const r = await apply(client, bundleOf(), io);
  assert.equal(r.openingsSkippedUnknownTooling, 1);
  assert.equal(r.openingsWritten, 0);
  assert.equal(r.drawingsInserted, 0);
  assert.equal(client.calls.filter((c) => /INSERT INTO tooling_openings|INSERT INTO tooling_drawings/.test(c.sql)).length, 0);
});

test('dry run rolls back and copies nothing', async () => {
  const client = fakeClient();
  const { io, copied } = fakeApplyIo();
  const r = await apply(client, bundleOf(), io, { dryRun: true });
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls[client.calls.length - 1].sql, 'ROLLBACK');
  assert.equal(client.calls.some((c) => c.sql === 'COMMIT'), false);
  assert.equal(r.filesCopied, 0);
  assert.equal(copied.length, 0);
  assert.equal(r.drawingsInserted, 1);
});

test('a live run commits; an error rolls back and rethrows', async () => {
  const ok = fakeClient();
  await apply(ok, bundleOf(), fakeApplyIo().io);
  assert.equal(ok.calls[ok.calls.length - 1].sql, 'COMMIT');
  const bad = fakeClient();
  bad.query = ((orig) => async (sql, p) => { if (/INSERT INTO tooling_openings/.test(sql)) throw new Error('boom'); return orig(sql, p); })(bad.query);
  await assert.rejects(apply(bad, bundleOf(), fakeApplyIo().io), /boom/);
  assert.equal(bad.calls[bad.calls.length - 1].sql, 'ROLLBACK');
});

const fsWith = (files) => ({ readFileSync: (p) => {
  const name = String(p).replace(/\\/g, '/').split('/').pop();
  if (!(name in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
  return files[name];
} });

test('readBundle rejects another version', () => {
  assert.throws(() => readBundle('/b', fsWith({ 'manifest.json': '{"version":2}' })), /version/);
});

test('readBundle returns the parts and tolerates a missing report', () => {
  const b = readBundle('/b', fsWith({
    'manifest.json': '{"version":1}', 'toolings.json': '[]', 'drawings.json': '[]', 'openings.json': '[]',
  }));
  assert.equal(b.report, null);
  assert.deepEqual(b.openings, []);
  assert.throws(() => readBundle('/b', fsWith({
    'manifest.json': '{"version":1}', 'toolings.json': '{}', 'drawings.json': '[]', 'openings.json': '[]',
  })), /toolings/);
});
