import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBolsterInsertNos, readDieType } from './pdfImportFields.js';

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
