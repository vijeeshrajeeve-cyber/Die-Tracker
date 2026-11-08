'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildZip, zipFromBuffer, makeXlsx } = require('./fixtures/syntheticXlsx.cjs');
const {
  readSheetIndex, readSharedStrings, readRows, readPictureAnchors, parseGex1Row, parseGex2Row, reviewFromNote,
} = require('./imageCheckWorkbook.cjs');

const GIF_A = Buffer.from('GIF89a-picture-A');
const GIF_B = Buffer.from('GIF89a-picture-B');

const workbook = () => makeXlsx({
  sheets: [
    {
      name: 'GEX1',
      rows: [
        { r: 1, cells: { A: 'IDProfile', B: 'IDDie', C: 'IDDieType', F: 'Verdict', G: 'Image Check' } },
        { r: 2, cells: { A: '12555', B: '12555_101', C: 'Hollow', F: 'Hollow' } },
        { r: 3, cells: { A: 12556, B: { inline: '12556_102 & co' }, C: 'SOLID', F: 'Solid' } },
        { r: 4, cells: { A: '12555', B: '12555_103', C: 'Hollow', F: 'Hollow', G: 'Image unclear - cannot verify' } },
      ],
      pictures: [{ row: 2, media: 'image1.gif' }, { row: 3, media: 'image2.gif', toRow: 4 }, { row: 4, media: 'image1.gif' }],
    },
    { name: 'Summary', rows: [{ r: 1, cells: { A: 'total' } }] },
    { name: 'GEX2', rows: [{ r: 1, cells: { A: 'IDProfile' } }], pictures: [{ row: 2, media: 'image2.gif' }] },
  ],
  media: { 'image1.gif': GIF_A, 'image2.gif': GIF_B },
});

test('readSheetIndex maps sheet names to sheet and drawing paths through the rels parts', () => {
  const index = readSheetIndex(workbook());
  assert.deepEqual([...index.keys()], ['GEX1', 'Summary', 'GEX2']);
  assert.deepEqual(index.get('GEX1'), { sheetPath: 'xl/worksheets/sheet1.xml', drawingPath: 'xl/drawings/drawing1.xml' });
  assert.deepEqual(index.get('Summary'), { sheetPath: 'xl/worksheets/sheet2.xml', drawingPath: null });
  assert.deepEqual(index.get('GEX2'), { sheetPath: 'xl/worksheets/sheet3.xml', drawingPath: 'xl/drawings/drawing2.xml' });
});

test('readRows yields every row with shared strings, inline strings and numbers resolved', () => {
  const zip = workbook();
  const rows = [...readRows(zip, 'xl/worksheets/sheet1.xml', readSharedStrings(zip))];
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.row), [1, 2, 3, 4]);
  assert.deepEqual(rows[1].cells, { A: '12555', B: '12555_101', C: 'Hollow', F: 'Hollow' });
  assert.equal(rows[2].cells.A, '12556');
  assert.equal(rows[2].cells.B, '12556_102 & co');
  assert.equal(rows[3].cells.G, 'Image unclear - cannot verify');
});

test('readSharedStrings joins rich-text runs, drops phonetic runs and decodes entities', () => {
  const sst = '<sst><si><t>plain &amp; &lt;b&gt;</t></si><si><r><rPr><b/></rPr><t>Mis</t></r><r><t xml:space="preserve">match </t></r>'
    + '<rPh sb="0" eb="1"><t>x</t></rPh></si><si><t/></si><si><t>&#65;&#x42;</t></si></sst>';
  const zip = zipFromBuffer(buildZip([{ name: 'xl/sharedStrings.xml', data: Buffer.from(sst) }]));
  assert.deepEqual(readSharedStrings(zip), ['plain & <b>', 'Mismatch ', '', 'AB']);
  assert.deepEqual(readSharedStrings(zipFromBuffer(buildZip([{ name: 'other', data: Buffer.from('x') }]))), []);
});

test('readPictureAnchors returns the 1-based from-row and media path of every picture', () => {
  const anchors = readPictureAnchors(workbook(), 'xl/drawings/drawing1.xml');
  assert.deepEqual(anchors.map((a) => [a.row, a.mediaPath]), [
    [2, 'xl/media/image1.gif'], [3, 'xl/media/image2.gif'], [4, 'xl/media/image1.gif'],
  ]);
  assert.equal(anchors[0].name, 'Pic_1');
});

test('parseGex1Row and parseGex2Row name the columns; blanks are null', () => {
  assert.deepEqual(parseGex1Row({ A: '12555', B: '12555_101', C: 'Hollow', F: 'Hollow', G: '' }), {
    profileNumber: '12555', dieNo: '12555_101', dieType: 'Hollow', verdict: 'Hollow', note: null,
  });
  assert.deepEqual(parseGex1Row({ B: ' 12555_101 ', H: 'Imran' }), {
    profileNumber: null, dieNo: '12555_101', dieType: null, verdict: null, note: null,
  });
  assert.deepEqual(parseGex2Row({ A: '090019', B: '090019-2501', C: 'Solid', D: '01', E: 'Image not found', F: 'X' }), {
    profileNumber: '090019', dieNo: '090019-2501', dieType: 'Solid', status: '01',
  });
});

test('reviewFromNote flags mismatch, missing, blank and unclear notes', () => {
  const mismatch = 'Mismatch: image shows SOLID profile (no closed cavity)';
  assert.deepEqual(reviewFromNote(mismatch), { needsReview: true, reason: mismatch });
  assert.deepEqual(reviewFromNote('No image in Column E'), { needsReview: true, reason: 'No image in Column E' });
  assert.deepEqual(reviewFromNote('Image blank - cannot verify'), { needsReview: true, reason: 'Image blank - cannot verify' });
  assert.deepEqual(reviewFromNote('Image unclear - cannot verify'), { needsReview: true, reason: 'Image unclear - cannot verify' });
  assert.deepEqual(reviewFromNote(''), { needsReview: false, reason: null });
  assert.deepEqual(reviewFromNote(null), { needsReview: false, reason: null });
});
