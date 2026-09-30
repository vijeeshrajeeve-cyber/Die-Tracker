import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBolsterInsertNos } from './pdfImportFields.js';

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
