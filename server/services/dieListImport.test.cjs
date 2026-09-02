'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./dieListImport.cjs');

// Verbatim column spelling from the GEX-01 die-management export.
const GEX_ROW = {
  IDDie: '29663_401', IDProfile: '29663', IDCustomer1: 'Gulf Extrusions Co .(L.L.C)',
  DiesDIAM: 250, Thickness: 160, PressPrimary: 'M_PRESS.4', DieType: 'Hollow',
};

test('normalizeKey collapses case and punctuation', () => {
  assert.equal(m.normalizeKey('Die No'), 'dieno');
  assert.equal(m.normalizeKey('die_no'), 'dieno');
  assert.equal(m.normalizeKey('DiesDIAM'), 'diesdiam');
  assert.equal(m.normalizeKey(null), '');
});

test('getField finds a value by any alias and skips blanks', () => {
  assert.equal(m.getField(GEX_ROW, m.DIE_NO_ALIASES), '29663_401');
  assert.equal(m.getField(GEX_ROW, m.PRESS_ALIASES), 'M_PRESS.4');
  assert.equal(m.getField({ IDDie: '   ' }, m.DIE_NO_ALIASES), null);
  assert.equal(m.getField({}, m.DIE_NO_ALIASES), null);
});

// Orders and frozen designs record die size as "250X160". Storing the bare
// diameter puts a "250" in front of the supplier on the generated PDF.
test('composeDieSize joins diameter and thickness', () => {
  assert.equal(m.composeDieSize(GEX_ROW), '250X160');
});

test('composeDieSize falls back to the diameter alone when thickness is missing', () => {
  assert.equal(m.composeDieSize({ DiesDIAM: 250 }), '250');
  assert.equal(m.composeDieSize({ DiesDIAM: 250, Thickness: '' }), '250');
});

test('composeDieSize prefers an explicit die size column when there is no diameter', () => {
  assert.equal(m.composeDieSize({ 'Die Size': '355x200' }), '355x200');
});

test('composeDieSize returns null when the row carries no size at all', () => {
  assert.equal(m.composeDieSize({ IDDie: '29663_401' }), null);
});

test('extractProfile takes the part before the dash and strips leading zeros', () => {
  assert.equal(m.extractProfile('01001-401'), '1001');
  assert.equal(m.extractProfile(null), null);
});
