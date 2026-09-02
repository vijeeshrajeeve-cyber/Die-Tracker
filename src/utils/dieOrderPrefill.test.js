import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrefill, canonicalSupplier } from './dieOrderPrefill.js';

const SUPPLIERS = ['ADEX', 'ALMAX', 'COMES', 'COMPES', 'EKSTEK', 'JIANGSU', 'PDTMC', 'PHME', 'PHOENIX', 'WEFA'];

const BLANK = {
  SUPPLIER: '', DIE_SIZE: '', SOLID: false, HOLLOW: false, BOLSTER_NO: '',
};
const ORDER = { die_no: '18114-407', die_size: '450x250', supplier: 'COMPES', ordered_date: '2026-05-26' };
const DIE_LIST = { die_no: '29663_213', die_size: '355X200', die_type: 'Hollow', bolster_no: 'BOL-2-2-A', supplier: 'PDTMC' };

test('a recent order supplies die size and supplier ahead of the die list', () => {
  const { values, sources } = applyPrefill(BLANK, { order: ORDER, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.DIE_SIZE, '450x250');
  assert.equal(values.SUPPLIER, 'COMPES');
  assert.equal(sources.DIE_SIZE, 'order 18114-407');
  assert.equal(sources.SUPPLIER, 'order 18114-407');
});

test('the die list supplies solid/hollow and bolster, which no order records', () => {
  const { values, sources } = applyPrefill(BLANK, { order: ORDER, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.HOLLOW, true);
  assert.equal(values.SOLID, false);
  assert.equal(values.BOLSTER_NO, 'BOL-2-2-A');
  assert.equal(sources.BOLSTER_NO, 'die list 29663_213');
});

test('the die list fills die size and supplier when there is no order', () => {
  const { values } = applyPrefill(BLANK, { order: null, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.DIE_SIZE, '355X200');
  assert.equal(values.SUPPLIER, 'PDTMC');
});

// The frozen design has already written into values by the time this runs.
test('a field that already holds a value is never overwritten', () => {
  const filled = { ...BLANK, DIE_SIZE: '320X160', SUPPLIER: 'WEFA' };
  const { values, sources } = applyPrefill(filled, { order: ORDER, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.DIE_SIZE, '320X160');
  assert.equal(values.SUPPLIER, 'WEFA');
  assert.equal(sources.DIE_SIZE, undefined);
  assert.equal(sources.SUPPLIER, undefined);
});

// The list holds 'Hollow' (27,113), 'SOLID' (10,527) and 'Solid' (7,027).
test('die type is read case-insensitively', () => {
  assert.equal(applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, die_type: 'SOLID' } }, { supplierNames: SUPPLIERS }).values.SOLID, true);
  assert.equal(applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, die_type: 'Solid' } }, { supplierNames: SUPPLIERS }).values.SOLID, true);
  assert.equal(applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, die_type: 'Hollow' } }, { supplierNames: SUPPLIERS }).values.HOLLOW, true);
});

test('neither checkbox is touched when one is already ticked', () => {
  const ticked = { ...BLANK, SOLID: true };
  const { values } = applyPrefill(ticked, { order: null, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.SOLID, true);
  assert.equal(values.HOLLOW, false);
});

test('an empty bolster leaves the field blank rather than writing an empty string', () => {
  const { values, sources } = applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, bolster_no: '' } }, { supplierNames: SUPPLIERS });
  assert.equal(values.BOLSTER_NO, '');
  assert.equal(sources.BOLSTER_NO, undefined);
});

test('supplier aliases resolve the two Phoenix spellings', () => {
  assert.equal(canonicalSupplier('PHOEINIX', SUPPLIERS), 'PHOENIX');
  assert.equal(canonicalSupplier('Phoenix Middle East', SUPPLIERS), 'PHME');
  assert.equal(canonicalSupplier('pdtmc', SUPPLIERS), 'PDTMC');
});

// MODE OF SHIPMENT is derived from the matched supplier record, so a name that
// is not in the master would strand it blank.
test('a supplier absent from the master is not filled at all', () => {
  assert.equal(canonicalSupplier('EROGA', SUPPLIERS), null);
  const { values, sources } = applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, supplier: 'EROGA' } }, { supplierNames: SUPPLIERS });
  assert.equal(values.SUPPLIER, '');
  assert.equal(sources.SUPPLIER, undefined);
});

test('no sources at all leaves every value untouched', () => {
  const { values, sources } = applyPrefill(BLANK, { order: null, dieList: null }, { supplierNames: SUPPLIERS });
  assert.deepEqual(values, BLANK);
  assert.deepEqual(sources, {});
});
