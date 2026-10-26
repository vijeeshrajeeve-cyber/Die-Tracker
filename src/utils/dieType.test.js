import test from 'node:test';
import assert from 'node:assert/strict';
import { typeLabel, dieTypeLabel, erpDieTypeCode, qdDieTypeFor } from './dieType.js';

test('item type codes read as words', () => {
  assert.equal(typeLabel('N'), 'New');
  assert.equal(typeLabel('B'), 'Backup');
  assert.equal(typeLabel(' t '), 'Tooling');
  assert.equal(typeLabel('X'), 'X');
  assert.equal(typeLabel(null), '');
});

test('die type reads as Solid / Hollow', () => {
  assert.equal(dieTypeLabel('SOLID'), 'Solid');
  assert.equal(dieTypeLabel('hollow'), 'Hollow');
  assert.equal(dieTypeLabel('Semi-hollow'), 'Semi-hollow');
  assert.equal(dieTypeLabel(undefined), '');
});

test('Copy ERP takes SF/PH from the die type, not the item type', () => {
  assert.equal(erpDieTypeCode({ TYPE: 'B', 'Die Type': 'SOLID' }), 'SF');
  assert.equal(erpDieTypeCode({ TYPE: 'T', 'Die Type': 'HOLLOW' }), 'PH');
  assert.equal(erpDieTypeCode({ TYPE: 'T', 'Die Type': null }), 'SF');
  assert.equal(erpDieTypeCode({ TYPE: 'N' }), 'PH');
});

test('the QD die type is the matching Settings option', () => {
  assert.equal(qdDieTypeFor('HOLLOW', ['Solid', 'Hollow', 'Semi-hollow']), 'Hollow');
  assert.equal(qdDieTypeFor('SOLID', ['SOLID']), 'SOLID');
  assert.equal(qdDieTypeFor('SOLID', []), 'Solid');
  assert.equal(qdDieTypeFor('', ['Solid']), '');
});
