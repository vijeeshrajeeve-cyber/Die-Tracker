'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./toolingChart.cjs');

// Header and rows copied from the 2014 workbook, sheet "14 Inch".
const HEADER = ['Press ', 'Die size', 'Insert size', 'Bolster size', 'Sub bolster size', 'Die ring size', 'Total stack', 'Insert Holder', 'Baffle ring', 'Bol Holder'];
const ROWS = [
  HEADER,
  [1, '150X120', '175X80', 'NO', 'NO', '302.5X145', '302.5X305', '302.5X160', 'YES', ''],
  [6, '355X200', '460X150', '700X196', '700X254', '750X250', '700X700', '700X196', 'YES', ''],
  [6, '355X200', 'NO', '700X196', '700X254', '700X250', '700X700', 'NO', 'YES', ''],
  [6, '475X280', 'NO', '475X220', '700x200', 'RING SIZE DIE', '700X700', 'NO', 'YES', ''],
  [7, '', '', '', '', '', '', '', '', ''],
  [8, '280X160', '', '', '', '', '', '', '', ''],
  [9, '355X200', '460X150', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
];

test('parses rows into canonical press names and normalised sizes, skipping blanks and press 9', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: '2014/14 Inch', excludePresses: [9] });
  assert.equal(rows.length, 4, 'press 7 blank row, press 8 size-only row and press 9 are skipped');
  assert.deepEqual(rows[0], {
    press: 'PRESS 1', die_size: '150X120', insert_size: '175X80', bolster_size: null, sub_bolster_size: null,
    die_ring_size: '302.5X145', total_stack: '302.5X305', insert_holder: '302.5X160', baffle_ring: 'YES',
    bolster_holder: null, remark: null, source_sheet: '2014/14 Inch',
  });
  assert.equal(rows[3].sub_bolster_size, '700X200', 'lowercase x normalised');
});

test('a row with a die size but no insert and no bolster size is kept out', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: 's' });
  assert.ok(!rows.some((r) => r.press === 'PRESS 8'));
});

test('verdict is allowed when a row for press and die size carries the size class', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: 's', excludePresses: [9] });
  const r = m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355x200', kind: 'insert', sizeClass: '460x150' });
  assert.equal(r.verdict, 'allowed');
  assert.equal(r.rows.length, 1);
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355X200', kind: 'bolster', sizeClass: '700X196' }).verdict, 'allowed');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355X200', kind: 'insert', sizeClass: '300X100' }).verdict, 'not_allowed');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '999X999', kind: 'insert', sizeClass: '460X150' }).verdict, 'not_allowed');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355X200', kind: 'insert', sizeClass: null }).verdict, 'not_allowed');
});

test('answers no_chart for a press with no rows', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: 's', excludePresses: [9] });
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 7', dieSize: '250X140', kind: 'insert', sizeClass: '300X100' }).verdict, 'no_chart');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 8', dieSize: '280X160', kind: 'insert', sizeClass: '300X100' }).verdict, 'no_chart');
});

test('replace statements delete only the same source sheet, then insert', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: '2014/14 Inch', excludePresses: [9] });
  const { statements } = m.buildChartReplace(rows, '2014/14 Inch');
  assert.match(statements[0].sql, /DELETE FROM tooling_combinations WHERE source_sheet = \$1/);
  assert.deepEqual(statements[0].params, ['2014/14 Inch']);
  assert.equal(statements.length, 1 + rows.length);
  assert.match(statements[1].sql, /INSERT INTO tooling_combinations/);
});

test('HOLD in the Bol Holder column becomes a remark and the row is never allowed', () => {
  const rows = m.parseChartRows([
    HEADER,
    [5, '320X200', '300X100', 'NO', 'NO', '', '', '', 'YES', 'HOLD'],
    [5, '355X200', '300X100', 'NO', 'NO', '', '', '', 'YES', 'New'],
    [5, '280X160', '300X100', 'NO', 'NO', '', '', '', 'YES', '302.5X160'],
  ], { sourceSheet: 's' });
  assert.equal(rows[0].remark, 'HOLD');
  assert.equal(rows[0].bolster_holder, null);
  assert.equal(rows[1].remark, 'NEW', 'existing New rule still holds');
  assert.equal(rows[1].bolster_holder, null);
  assert.equal(rows[2].bolster_holder, '302.5X160', 'a size token stays a holder');
  assert.equal(rows[2].remark, null);
  const v = m.chartVerdict(rows, { press: 'PRESS 5', dieSize: '320X200', kind: 'insert', sizeClass: '300X100' });
  assert.equal(v.verdict, 'not_allowed');
  assert.deepEqual(v.rows, []);
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 5', dieSize: '355X200', kind: 'insert', sizeClass: '300X100' }).verdict, 'allowed');
});
