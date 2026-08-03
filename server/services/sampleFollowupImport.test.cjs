'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imp = require('./sampleFollowupImport.cjs');

test('normalizeDieNo strips case and every kind of whitespace', () => {
  assert.equal(imp.normalizeDieNo(' 027048-2502 '), '027048-2502');
  assert.equal(imp.normalizeDieNo('gex 1234'), 'GEX1234');
  assert.equal(imp.normalizeDieNo(null), '');
  assert.equal(imp.normalizeDieNo(undefined), '');
});

test('cleanText trims, collapses, and nulls out blanks', () => {
  assert.equal(imp.cleanText('Sujith '), 'Sujith');
  assert.equal(imp.cleanText('Van  der  Berg'), 'Van der Berg');
  assert.equal(imp.cleanText('   '), null);
  assert.equal(imp.cleanText(null), null);
});

test('parseSheetDate reads Excel serials', () => {
  // 45954 and 46085 are real values from the sheet.
  assert.equal(imp.parseSheetDate(45954), '2025-10-24');
  assert.equal(imp.parseSheetDate(46085), '2026-03-04');
  assert.equal(imp.parseSheetDate('45954'), '2025-10-24');
});

test('parseSheetDate reads typed text in both orders', () => {
  assert.equal(imp.parseSheetDate('2026-03-12'), '2026-03-12');
  assert.equal(imp.parseSheetDate('2026-03-12T00:00:00Z'), '2026-03-12');
  assert.equal(imp.parseSheetDate('12/03/2026'), '2026-03-12');
  assert.equal(imp.parseSheetDate('12-03-2026'), '2026-03-12');
  assert.equal(imp.parseSheetDate('5.3.2026'), '2026-03-05');
});

test('parseSheetDate rejects blanks, zero, and garbage', () => {
  // Die 007223-3501 carries a Submission Date of 0 — it must read as blank.
  assert.equal(imp.parseSheetDate(0), null);
  assert.equal(imp.parseSheetDate(''), null);
  assert.equal(imp.parseSheetDate('   '), null);
  assert.equal(imp.parseSheetDate(null), null);
  assert.equal(imp.parseSheetDate(undefined), null);
  assert.equal(imp.parseSheetDate(-5), null);
  assert.equal(imp.parseSheetDate('n/a'), null);
  assert.equal(imp.parseSheetDate('2026-13-45'), null);
  assert.equal(imp.parseSheetDate('32/01/2026'), null);
});

test('parseTrialCount accepts 0..1000 and rejects the rest', () => {
  assert.equal(imp.parseTrialCount(0), 0);
  assert.equal(imp.parseTrialCount(7), 7);
  assert.equal(imp.parseTrialCount('3'), 3);
  assert.equal(imp.parseTrialCount(2.4), 2);
  assert.equal(imp.parseTrialCount(''), null);
  assert.equal(imp.parseTrialCount(null), null);
  assert.equal(imp.parseTrialCount(-1), null);
  assert.equal(imp.parseTrialCount(1001), null);
  assert.equal(imp.parseTrialCount('many'), null);
});

test('readCell tolerates headers with stray trailing spaces', () => {
  assert.equal(imp.readCell({ 'Corrector ': 'Dinesh' }, 'Corrector'), 'Dinesh');
  assert.equal(imp.readCell({ Corrector: 'Dinesh' }, 'Corrector'), 'Dinesh');
  assert.equal(imp.readCell({}, 'Corrector'), '');
});
