import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBolsterInsertNos, readDieType, readScales, readTitleBlockNumbers } from './pdfImportFields.js';

// Row text exactly as pdf.js reconstructs it from the Sept 2026 GEX order forms,
// whose labels read "No," with the dash separator after the comma.
test('reads the insert number when the label is "INSERT No, -"', () => {
  assert.deepEqual(
    extractBolsterInsertNos('BOLSTER No, - INSERT No, - 25IC2-030724 37.9'),
    { bolsterNo: null, insertNo: '25IC2-030724' },
  );
  assert.deepEqual(
    extractBolsterInsertNos('BOLSTER No, - INSERT No, - INS-30732  0.6  0.3'),
    { bolsterNo: null, insertNo: 'INS-30732' },
  );
  assert.deepEqual(
    extractBolsterInsertNos('13.5 BOLSTER No, - INSERT No, - I-10621'),
    { bolsterNo: null, insertNo: 'I-10621' },
  );
});

test('an insert number without a hyphen is kept whole', () => {
  assert.deepEqual(
    extractBolsterInsertNos('BOLSTER No, - INSERT No, - 25IC1A'),
    { bolsterNo: null, insertNo: '25IC1A' },
  );
});

test('a blank insert column yields no insert number', () => {
  assert.deepEqual(
    extractBolsterInsertNos('BOLSTER No, - INSERT No, -'),
    { bolsterNo: null, insertNo: null },
  );
});

test('older forms with "No." labels still read both numbers', () => {
  assert.deepEqual(
    extractBolsterInsertNos('BOLSTER No. - B-12345 INSERT No. - I-30602'),
    { bolsterNo: 'B-12345', insertNo: 'I-30602' },
  );
  assert.deepEqual(
    extractBolsterInsertNos('BOLSTER No, I-30602'),
    { bolsterNo: 'I-30602', insertNo: null },
  );
});

// The "SOLID - … HOLLOW - …" row of the GEX order form as pdf.js items
// ([text, x]), taken from the sample PDFs: the mark sits after one label.
const row = (...pairs) => pairs.map(([text, x]) => ({ text, x }));

test('reads the die type from the box that carries the mark', () => {
  assert.equal(readDieType(row(['SOLID', 119], ['-', 147], ['HOLLOW', 169], ['-', 193], ['OK', 202])), 'HOLLOW');
  assert.equal(readDieType(row(['SOLID', 126], ['-', 154], ['YES', 158], ['HOLLOW', 176], ['-', 200])), 'SOLID');
  assert.equal(readDieType(row(['SOLID', 126], ['-', 154], ['ok', 158], ['HOLLOW', 176], ['-', 200])), 'SOLID');
  assert.equal(readDieType(row(['SOLID', 119], ['-', 147], ['HOLLOW', 169], ['-', 193], ['OK', 202], ['30732-401,', 230])), 'HOLLOW');
});

test('a mark printed on its own line still counts by where it sits', () => {
  // 32130-401: "OK" lands a line below, under the SOLID box.
  assert.equal(readDieType(row(['B', 246], ['SOLID', 449], ['-', 476], ['HOLLOW', 498], ['-', 522], ['OK', 481])), 'SOLID');
});

test('leaves the die type blank when no box, or both boxes, are marked', () => {
  assert.equal(readDieType(row(['SOLID', 119], ['-', 147], ['HOLLOW', 169], ['-', 193])), null);
  assert.equal(readDieType(row(['SOLID', 119], ['OK', 140], ['HOLLOW', 169], ['OK', 202])), null);
  assert.equal(readDieType(row(['BOLSTER No,', 119], ['INSERT No,', 169], ['I-05138', 196])), null);
  // An "OK" far to the right belongs to something else on the drawing.
  assert.equal(readDieType(row(['SOLID', 119], ['-', 147], ['HOLLOW', 169], ['-', 193], ['OK', 600])), null);
});

// Lines as PDFImportModal builds them: y descending (top of the page first), items left to right.
const line = (y, ...texts) => ({
  y, text: texts.join(' '), items: texts.map((text, i) => ({ text, x: 40 + i * 60 })),
});

// The 030724 sheet: a detail view at 3:1 near the top, a section at 3:2 lower down and the
// title block's SCALE 1:1 at the foot of the page.
const SAMPLE_030724 = [
  line(780, 'DETAIL A', 'Scale 3:1'),
  line(520, 'SECTION B-B', 'SCALE 3:2'),
  line(300, 'CCD 183.2', 'No. of cavities 2'),
  line(60, 'DRAWN', 'SCALE 1:1', 'SHEET 1 OF 1'),
];

test('the main view scale wins over detail scales', () => {
  assert.deepEqual(readScales(SAMPLE_030724), [1, 1 / 3, 2 / 3]);
});

test('without a capital SCALE the first scale found leads', () => {
  assert.deepEqual(readScales([line(700, 'Scale 2:1'), line(100, 'Scale 1:2')]), [1 / 2, 2]);
});

test('a page without a scale gives no scales', () => {
  assert.deepEqual(readScales([line(100, 'DRAWN', 'CHECKED')]), []);
  assert.deepEqual(readScales([]), []);
});

test('reads the title block numbers that follow their labels', () => {
  assert.deepEqual(readTitleBlockNumbers([line(300, 'CCD 183.2', 'No. of cavities 2')]),
    { ccd: 183.2, externalPerimeter: null, internalPerimeter: null });
  assert.deepEqual(readTitleBlockNumbers([
    line(320, 'External Perimeter', '612.4'),
    line(300, 'Internal Perimeter: 288'),
  ]), { ccd: null, externalPerimeter: 612.4, internalPerimeter: 288 });
});

test('the blank form has no title block numbers', () => {
  assert.deepEqual(readTitleBlockNumbers([
    line(320, 'External Perimeter', 'Internal Perimeter'),
    line(300, 'CCD', 'No. of cavities'),
  ]), { ccd: null, externalPerimeter: null, internalPerimeter: null });
});
