import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetData } from './exportExcel.js';

test('buildSheetData maps rows through the column labels', () => {
  const out = buildSheetData({
    rows: [{ a: 1, b: 'x' }],
    columns: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }],
  });
  assert.deepEqual(out, [{ Alpha: 1, Beta: 'x' }]);
});

test('buildSheetData applies a format function and blanks missing values', () => {
  const out = buildSheetData({
    rows: [{ a: null }],
    columns: [
      { key: 'a', label: 'Alpha' },
      { key: 'b', label: 'Beta', format: (_, row) => (row.a === null ? 'none' : 'some') },
    ],
  });
  assert.deepEqual(out, [{ Alpha: '', Beta: 'none' }]);
});

test('buildSheetData on no rows returns an empty array, not a header row', () => {
  assert.deepEqual(buildSheetData({ rows: [], columns: [{ key: 'a', label: 'Alpha' }] }), []);
});
