'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { knownFromExport, buildBundle, matchFiles } = require('./toolingBundle.cjs');

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
