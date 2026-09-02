'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./dieListImport.cjs');

// Verbatim column spelling from the GEX-01 die-management export.
const GEX1_ROW = {
  IDDie: '29663_401', IDProfile: '29663', IDCustomer1: 'Gulf Extrusions Co .(L.L.C)',
  DiesDIAM: 250, Thickness: 160, PressPrimary: 'M_PRESS.4', DieType: 'Hollow',
  DieStatus: 'AVAILABLE', NumHoles: 2, NameSupplier: 'PDTMC', Tonnage: 91805,
  IDBolster: 'BOL-2-2-A',
};

// GEX-2 exports from a different system, with its own names throughout. Note
// DieType is present but empty — DescrDieType is the one that carries a value.
const GEX2_ROW = {
  IDDie: '090001-2502', DieSuffix: '2502', IDProfile: '090001',
  'Profiles::DescrCustomer': 'Gulf Extrusions Co .(L.L.C)',
  DieDiam: 250, DieHeight: 140, IDPressPrimary: 'P25', DescrDieType: 'SOLID',
  DieType: '', DescrStatus: 'SCRAPPED', NumCavities: 8, DescrSupplier: 'ME PHOENIX',
  QtyKgGross: 3197.09,
};

const PRESSES = [
  { press_name: 'PRESS 4', press_code: 'D', plant: 'GEX 01' },
  { press_name: 'PRESS 7', press_code: 'P25', plant: 'GEX 02' },
  { press_name: 'PRESS 8', press_code: 'P35', plant: 'GEX 02' },
];

test('normalizeKey collapses case and punctuation', () => {
  assert.equal(m.normalizeKey('Die No'), 'dieno');
  assert.equal(m.normalizeKey('DiesDIAM'), 'diesdiam');
  assert.equal(m.normalizeKey('Profiles::DescrCustomer'), 'profilesdescrcustomer');
  assert.equal(m.normalizeKey(null), '');
});

test('getField finds a value by any alias and skips blanks', () => {
  assert.equal(m.getField(GEX1_ROW, m.DIE_NO_ALIASES), '29663_401');
  assert.equal(m.getField(GEX2_ROW, m.DIE_NO_ALIASES), '090001-2502');
  assert.equal(m.getField({ IDDie: '   ' }, m.DIE_NO_ALIASES), null);
});

test('composeDieSize joins diameter and thickness for both plants', () => {
  assert.equal(m.composeDieSize(GEX1_ROW), '250X160');
  assert.equal(m.composeDieSize(GEX2_ROW), '250X140');
});

test('composeDieSize falls back to the diameter alone when height is missing', () => {
  assert.equal(m.composeDieSize({ DieDiam: 600 }), '600');
});

test('extractProfile takes the part before the dash and strips leading zeros', () => {
  assert.equal(m.extractProfile('01001-401'), '1001');
  assert.equal(m.extractProfile(null), null);
});

// ── mapRow: the whole normalisation, both vocabularies ────────────────────

test('mapRow reads the GEX-01 vocabulary', () => {
  const r = m.mapRow(GEX1_ROW, PRESSES);
  assert.equal(r.dieNo, '29663_401');
  assert.equal(r.profile, '29663');
  assert.equal(r.customer, 'Gulf Extrusions Co .(L.L.C)');
  assert.equal(r.dieSize, '250X160');
  assert.equal(r.press, 'PRESS 4');
  assert.equal(r.dieStatus, 'AVAILABLE');
  assert.equal(r.cavity, 2);
  assert.equal(r.dieType, 'Hollow');
  assert.equal(r.supplier, 'PDTMC');
  assert.equal(r.tonnage, 91805);
  assert.equal(r.bolsterNo, 'BOL-2-2-A');
});

test('mapRow reads the GEX-2 vocabulary', () => {
  const r = m.mapRow(GEX2_ROW, PRESSES);
  assert.equal(r.dieNo, '090001-2502');
  assert.equal(r.profile, '090001');
  assert.equal(r.customer, 'Gulf Extrusions Co .(L.L.C)');
  assert.equal(r.dieSize, '250X140');
  assert.equal(r.dieStatus, 'SCRAPPED');
  assert.equal(r.cavity, 8);
  assert.equal(r.dieType, 'SOLID');
  assert.equal(r.supplier, 'ME PHOENIX');
  assert.equal(r.tonnage, 3197);
  assert.equal(r.bolsterNo, null, 'the GEX-2 export has no bolster column');
});

// Storing the canonical press name is what lets every downstream query compare
// with plain equality instead of re-deriving 'P35' means press 8.
test('mapRow resolves the press against the presses master', () => {
  assert.equal(m.mapRow(GEX2_ROW, PRESSES).press, 'PRESS 7');
  assert.equal(m.mapRow({ ...GEX2_ROW, IDPressPrimary: 'P35' }, PRESSES).press, 'PRESS 8');
  assert.equal(m.mapRow(GEX1_ROW, PRESSES).press, 'PRESS 4');
});

// GEX-01 runs M_PRESS.1 and M_PRESS.3, which have no row in the presses master.
test('mapRow keeps an unknown press as-is rather than inventing one', () => {
  assert.equal(m.mapRow({ ...GEX1_ROW, PressPrimary: 'M_PRESS.1' }, PRESSES).press, 'M_PRESS.1');
});

test('mapRow returns nulls for a row with nothing in it', () => {
  const r = m.mapRow({}, PRESSES);
  assert.deepEqual(
    [r.dieNo, r.profile, r.customer, r.dieSize, r.press, r.dieStatus, r.cavity, r.dieType, r.supplier, r.tonnage, r.bolsterNo],
    [null, null, null, null, null, null, null, null, null, null, null],
  );
});

test('mapRow falls back to the die number when no profile column is present', () => {
  const r = m.mapRow({ IDDie: '01001-401' }, PRESSES);
  assert.equal(r.profile, '1001');
});

test('mapRow rounds a fractional tonnage and rejects a non-numeric one', () => {
  assert.equal(m.mapRow({ QtyKgGross: 3197.09 }, PRESSES).tonnage, 3197);
  assert.equal(m.mapRow({ Tonnage: 'n/a' }, PRESSES).tonnage, null);
  assert.equal(m.mapRow({ Tonnage: '' }, PRESSES).tonnage, null);
});

test('mapRow parses a cavity written as text and rejects nonsense', () => {
  assert.equal(m.mapRow({ NumCavities: '12' }, PRESSES).cavity, 12);
  assert.equal(m.mapRow({ NumHoles: 'many' }, PRESSES).cavity, null);
});

test('isEmptyRow is true only when every mapped field is empty', () => {
  assert.equal(m.isEmptyRow(m.mapRow({}, PRESSES)), true);
  assert.equal(m.isEmptyRow(m.mapRow({ DescrStatus: 'SCRAPPED' }, PRESSES)), false);
  assert.equal(m.isEmptyRow(m.mapRow(GEX2_ROW, PRESSES)), false);
});
