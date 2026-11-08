'use strict';
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { SCOPED_FOLDERS, listArchiveDrawings, interpretStem, groupByTooling } = require('./archiveMatcher.cjs');

const G1I = { plant: 'GEX 1', kindHint: 'insert' }, G1B = { plant: 'GEX 1', kindHint: 'bolster' }, G2 = { plant: 'GEX 2', kindHint: null }, ROOT = { plant: 'GEX 1', kindHint: null };
const CASES = [
  ['21599', G1I, { toolingNumber: 'I-21599', kind: 'insert', basis: 'filename-die' }],
  ['13126(OK)', G1I, { toolingNumber: 'I-13126' }], ['13137-OK', G1I, { toolingNumber: 'I-13137' }],
  ['13126A(SCRAP)', G1I, { skip: 'scrap' }], ['13477-SCRAP', G1I, { skip: 'scrap' }], ['15027(SCRAP)', G1I, { skip: 'scrap' }],
  ['01049B', G1I, { skip: 'unrecognised' }], ['2C', G1I, { skip: 'unrecognised' }],
  ['05043-INS', G1I, { toolingNumber: 'I-05043' }], ['Ins-12495', G1I, { toolingNumber: 'I-12495' }], ['INS-14172', G1I, { toolingNumber: 'I-14172' }],
  ['11377-8-Ins', G1I, { toolingNumber: 'I-11377' }], ['13126_4-Ins', G1I, { toolingNumber: 'I-13126' }], ['P4 (INS-05006)', G1I, { toolingNumber: 'I-05006', press: 'PRESS 4' }],
  ['13072-Bol', G1I, { toolingNumber: 'BOL-13072', kind: 'bolster', basis: 'filename-code' }],
  ['14017 Bol(475x220)', G1B, { toolingNumber: 'BOL-14017', sizeClass: '475X220' }], ['16021-Bol', G1B, { toolingNumber: 'BOL-16021' }],
  ['6-1-C Bol(700x196)', G1B, { toolingNumber: 'BOL-6-1-C', sizeClass: '700X196' }], ['Bol.7-2-B', G1B, { toolingNumber: 'BOL-7-2-B' }],
  ['OP-PR4 (4-6-B)', G1B, { toolingNumber: 'BOL-4-6-B', press: 'PRESS 4' }], ['pr-5-005 (5-1-b) rev01', G1B, { toolingNumber: 'BOL-5-1-B', press: 'PRESS 5' }],
  ['(2-1-H) Bol(475x220)', G1B, { toolingNumber: 'BOL-2-1-H' }], ['12047-220 -Ins Bol', G1B, { toolingNumber: 'BOL-12047' }],
  ['bol101', G1B, { toolingNumber: 'BOL-101' }], ['301-A- Bol', G1B, { toolingNumber: 'BOL-301-A' }],
  ['i-15160', G1B, { toolingNumber: 'I-15160', kind: 'insert' }],
  ['BO_17928', G1B, { toolingNumber: 'BOL-17928' }], ['BOLS_27363_FIN', ROOT, { toolingNumber: 'BOL-27363', variant: 'FIN' }],
  ['BO-700x196_PR-6-006', G1B, { skip: 'press-part' }], ['700x200- Sub- Bol for P-2 dies (PR-6-013).', G1B, { skip: 'press-part' }],
  ['15109-Bol1', G1B, { toolingNumber: 'BOL-15109' }], ['21471-1', G1B, { toolingNumber: 'BOL-21471' }],
  ['I-05038', ROOT, { toolingNumber: 'I-05038' }], ['INS_26882', ROOT, { toolingNumber: 'I-26882' }], ['B_27297', ROOT, { toolingNumber: 'BOL-27297' }],
  ['GEX-INS-32117.1.460x150', ROOT, { toolingNumber: 'I-32117', sizeClass: '460X150' }], ['INS-30610.1.460x150.P6', ROOT, { toolingNumber: 'I-30610', sizeClass: '460X150', press: 'PRESS 6' }],
  ['35IC1-120021', G2, { toolingNumber: '35IC1-120021', kind: 'insert', plant: 'GEX 2' }], ['35IC1_026904 (1)', G2, { toolingNumber: '35IC1-026904' }],
  ['INS-35IC1-013010', G2, { toolingNumber: '35IC1-013010' }], ['35IC1A', G2, { toolingNumber: '35IC1A' }],
  ['25B2C1A', G2, { toolingNumber: 'BOL-25B2C1A', kind: 'bolster' }], ['TLX-35B2C1A-051033.1.600x370.P2', G2, { toolingNumber: 'BOL-35B2C1A', sizeClass: '600X370' }],
  ['25IC1-027847', ROOT, { toolingNumber: '25IC1-027847', plant: 'GEX 2' }],
  ['Die Rings Inventory-P4', ROOT, { skip: 'press-part' }], ['EYEBOLTM16.', ROOT, { skip: 'press-part' }], ['Nitrex Testing Coins', ROOT, { skip: 'unrecognised' }],
];
for (const [stem, ctx, expected] of CASES) test(`interprets "${stem}"`, () => {
  const got = interpretStem(stem, ctx);
  for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, k);
});

// Fake fs: tree is { dirName: { fileName: null, subDir: {...} } }
function fakeFs(tree) {
  const at = (dir) => {
    let node = tree;
    for (const part of path.relative('ROOT', dir).split(path.sep).filter(Boolean)) {
      if (!node || typeof node !== 'object' || !(part in node)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      node = node[part];
    }
    return node;
  };
  return {
    readdirSync(dir) {
      const node = at(dir);
      return Object.entries(node).map(([name, v]) => ({ name, isDirectory: () => v !== null, isFile: () => v === null }));
    },
  };
}

test('walks only the scoped folders and skips backups, tiffs and lock files', () => {
  const tree = {
    Toolings: { 'Dieshop - Insert Drawings': {
      AutoCad: { 'PRESS 3': { '21599.dwg': null }, 'x.bak': null },
      'PDF & Tiff': { '21599.tif': null },
    } },
    '9. Press-9': { 'x.dwg': null },
    'I-05038.dxf': null, '~$x.xlsx': null,
    '0.Gulfex': { 'x.dwg': null },
  };
  const files = listArchiveDrawings('ROOT', fakeFs(tree));
  assert.deepEqual(files.map((f) => f.relPath).sort(), ['I-05038.dxf', 'Toolings/Dieshop - Insert Drawings/AutoCad/PRESS 3/21599.dwg']);
  const dwg = files.find((f) => f.ext === 'dwg');
  assert.equal(dwg.stem, '21599');
  assert.equal(dwg.plant, 'GEX 1');
  assert.equal(dwg.kindHint, 'insert');
  assert.equal(files.find((f) => f.ext === 'dxf').kindHint, null);
  assert.ok(SCOPED_FOLDERS.some((f) => f.prefix === '10.TALEX tooling/35 MN/Bolsters  35MN'));
});

test('groups files per tooling and picks the DXF without FIN as primary', () => {
  const mk = (stem, ext, extra) => ({ absPath: `/a/${stem}.${ext}`, relPath: `${stem}.${ext}`, stem, ext, plant: 'GEX 1', kindHint: null, toolingNumber: 'BOL-27363', kind: 'bolster', basis: 'filename-code', sizeClass: null, press: null, variant: null, ...extra });
  const groups = groupByTooling([
    mk('BOLS_27363_FIN', 'dxf', { variant: 'FIN' }), mk('BOLS_27712', 'pdf', { sizeClass: '700X196' }), mk('BOLS_27363', 'dxf'), mk('BOLS_27363', 'dwg'),
  ]);
  assert.equal(groups.size, 1);
  const g = groups.get('BOL-27363');
  assert.equal(g.files.length, 4);
  assert.equal(g.primary.stem, 'BOLS_27363');
  assert.equal(g.primary.ext, 'dxf');
  assert.equal(g.match.sizeClass, '700X196');
});
