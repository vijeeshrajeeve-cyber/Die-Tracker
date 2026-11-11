import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sheetToRows, chunk, drawingFilesOf, summarisePlan, rowDetail, fileDetail, reportCsv, drawingOutcome, isSent, TEMPLATE_CSV,
} from './toolingImport.js';

test('sheetToRows finds the header row, maps the known columns and skips blank lines', () => {
  const r = sheetToRows([
    ['Insert inventory 27.12.2024'],
    [],
    ['Sr', 'Insert No.', 'PLANT', 'Insert Size', 'Cav', 'Rack', 'Remarks', 'Weight'],
    [1, 'I-21599', 'GEX 1', '175X80', 1, 'A4', 'ok', 12],
    [2, '', '', '', '', '', '', ''],
    [3, ' 25IC2-090454 ', '', '300 x 100', '', '', '', ''],
  ]);
  assert.equal(r.error, null);
  assert.equal(r.headerRow, 2);
  assert.deepEqual(r.columns, { number: 'Insert No.', plant: 'PLANT', sizeClass: 'Insert Size', cavities: 'Cav', location: 'Rack', notes: 'Remarks' });
  assert.deepEqual(r.ignored, ['Sr', 'Weight']);
  assert.deepEqual(r.rows, [
    { line: 4, number: 'I-21599', plant: 'GEX 1', sizeClass: '175X80', cavities: '1', location: 'A4', notes: 'ok' },
    { line: 6, number: '25IC2-090454', plant: '', sizeClass: '300 x 100', cavities: '', location: '', notes: '' },
  ]);
});

test('sheetToRows: the first matching column wins; no number column or no rows is an error', () => {
  const two = sheetToRows([['Tooling No', 'Insert', 'Size'], ['BOL-1', 'I-00002', '175X80']]);
  assert.deepEqual(two.rows, [{ line: 2, number: 'BOL-1', sizeClass: '175X80' }]);
  assert.deepEqual(two.ignored, ['Insert']);
  assert.match(sheetToRows([['Name', 'Size'], ['x', 'y']]).error, /No column for the tooling number/);
  assert.match(sheetToRows([['Number', 'Size']]).error, /no rows/);
  assert.match(sheetToRows(null).error, /No column/);
});

test('the template reads back as three rows', () => {
  const aoa = TEMPLATE_CSV.split('\r\n').map((l) => l.split(','));
  const r = sheetToRows(aoa);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.ignored, []);
  assert.equal(r.rows[2].kind, 'bolster');
});

test('chunk and drawingFilesOf', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  const files = [{ name: 'a.DXF' }, { name: 'b.pdf' }, { name: 'c.dwg' }, { name: 'Thumbs.db' }, { name: '~$b.pdf' }, { name: 'list.xlsx' }];
  assert.deepEqual(drawingFilesOf(files).map((f) => f.name), ['a.DXF', 'b.pdf', 'c.dwg']);
});

const PLAN = {
  rows: [
    { number: 'I-1', kind: 'insert', plant: 'GEX 1', action: 'create', fills: [], kept: [] },
    { number: 'I-2', action: 'fill', fills: ['cavities', 'location'], kept: ['size class 175X80 (sheet: 220X80)'] },
    { number: 'I-3', action: 'same', fills: [], kept: [] },
    { number: null, action: 'error', message: '"x" is not an insert or bolster number' },
  ],
  files: [
    { name: 'a.dxf', state: 'attach', number: 'I-1' },
    { name: 'b.dxf', state: 'new', number: 'I-9', kind: 'insert', plant: 'GEX 1' },
    { name: 'c.dwg', state: 'convert', message: 'DWG: convert to DXF first' },
    { name: 'd.pdf', state: 'skipped', message: 'marked scrap in its name' },
    { name: 'e.pdf', state: 'lookup', message: 'no tooling number in the name — looked up in the drawing' },
  ],
};

test('summarisePlan counts what will be sent, with and without adding unknown toolings', () => {
  const off = summarisePlan(PLAN);
  assert.deepEqual({ c: off.rowsCreate, f: off.rowsFill, s: off.rowsSame, e: off.rowsError, k: off.rowsKept }, { c: 1, f: 1, s: 1, e: 1, k: 1 });
  assert.deepEqual({ a: off.filesAttach, n: off.filesNew, k: off.filesLookup, l: off.filesLeft, send: off.filesToSend, rows: off.rowsToSend }, { a: 1, n: 1, k: 1, l: 2, send: 2, rows: 2 });
  assert.equal(summarisePlan(PLAN, { createMissing: true }).filesToSend, 3);
  assert.deepEqual(PLAN.files.map((f) => isSent(f)), [true, false, false, false, true]);
  assert.deepEqual(PLAN.files.map((f) => isSent(f, { createMissing: true })), [true, true, false, false, true]);
  assert.equal(summarisePlan({ rows: [PLAN.rows[2]], files: [PLAN.files[2]] }).nothingToDo, true);
  assert.equal(summarisePlan(null).nothingToDo, true);
});

test('rowDetail and fileDetail say what will happen in plain words', () => {
  assert.equal(rowDetail(PLAN.rows[0]), 'insert · GEX 1');
  assert.equal(rowDetail(PLAN.rows[1]), 'fills cavities, location — keeps size class 175X80 (sheet: 220X80)');
  assert.equal(rowDetail(PLAN.rows[2]), 'already in the master with these values');
  assert.equal(rowDetail(PLAN.rows[3]), '"x" is not an insert or bolster number');
  assert.equal(fileDetail(PLAN.files[0]), 'to I-1');
  assert.equal(fileDetail(PLAN.files[1]), 'I-9 is not in the master — left out');
  assert.equal(fileDetail(PLAN.files[1], { createMissing: true }), 'adds I-9 (insert, GEX 1) and attaches');
  assert.equal(fileDetail(PLAN.files[2]), 'DWG: convert to DXF first');
});

test('drawingOutcome and reportCsv', () => {
  const o = drawingOutcome('a.dxf', { number: 'I-1', created: true, basis: 'drawing-text', extracted: 'likely', openingKept: false, filled: ['size class 175X80'] });
  assert.deepEqual(o, { name: 'a.dxf', number: 'I-1', ok: true, result: 'Added with drawing', detail: 'opening likely · number read from the drawing · filled size class 175X80', extracted: 'likely' });
  assert.equal(drawingOutcome('b.dxf', { number: 'I-2', extracted: 'none', openingKept: true }).detail, 'opening not found · reviewed opening kept');
  const csv = reportCsv({ rows: PLAN.rows.slice(0, 2), files: [o, { name: 'x, y.pdf', number: '', result: 'Failed', detail: 'said "no"' }] });
  assert.deepEqual(csv.split('\r\n'), [
    'Item,Tooling,Result,Details',
    'Sheet row,I-1,Add,insert · GEX 1',
    'Sheet row,I-2,Fill blanks,"fills cavities, location — keeps size class 175X80 (sheet: 220X80)"',
    'a.dxf,I-1,Added with drawing,opening likely · number read from the drawing · filled size class 175X80',
    '"x, y.pdf",,Failed,"said ""no"""',
  ]);
});
