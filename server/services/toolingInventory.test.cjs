'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./toolingInventory.cjs');

// Trimmed copies of the real sheets.
const GEX2_35 = [
  ['35MN PRESS INSERT  ( SINGLE CAVITY ) ', '', '', '', '', '35MN PRESS INSERT  ( TWO CAVITY ) ', '', '', '', '', '35MN PRESS INSERT  HOLDER ', '', '', '', '', '35MN PRESS BOLSTER  HOLDER ', '', '', '', '', '35MN PRESS RING ', '', '', '', ''],
  ['Sr.No', 'Insert No', 'Size', 'Location', '', 'Sr.No', 'Insert No', 'Size', 'Location', '', 'Sr.No', 'Insert No', 'Size', 'Location', '', 'Sr.No', 'Bolster No', 'Size', 'Location', '', 'Sr.No', 'Ring No', 'Size', 'Qty', 'Location'],
  [1, '35IC1-120021', '300X100', 'P35', '', 1, '35IC2-200025', '300X100', 'P35', '', 1, '35IH-001', '600X420', 'P35', '', 1, '35B-101', '600X420', 'P35', '', 1, '35R1', '280X185', 1, 'P35'],
  [2, '35IC1-025576', '460x150', 'P35', '', 2, '35IC2E', '300X100', 'P35', '', '', '', '', '', '', 2, '35B-102', '', 'P35', '', '', '', '', '', ''],
];

test('GEX-2 sheet yields inserts and bolsters with press from the location, holders and rings skipped', () => {
  const rows = m.parseGex2InventorySheet(GEX2_35, { sheetName: '35MN PRESS ' });
  const numbers = rows.map((r) => r.number).sort();
  assert.deepEqual(numbers, ['35B-101', '35B-102', '35IC1-025576', '35IC1-120021', '35IC2-200025', '35IC2E'].map((n) => n.startsWith('35B') ? `BOL-${n}` : n).sort());
  const one = rows.find((r) => r.number === '35IC1-025576');
  assert.equal(one.kind, 'insert');
  assert.equal(one.plant, 'GEX 2');
  assert.deepEqual(one.held_presses, ['PRESS 8']);
  assert.equal(one.size_class, '460X150');
  assert.equal(one.size_class_source, 'inventory');
  assert.equal(one.size_class_confidence, 'confirmed');
  assert.equal(one.cavities, 1);
  assert.equal(one.category, 'INSERT (SINGLE CAVITY)');
  assert.equal(one.made_for_die, '025576');
  assert.equal(one.source, 'inventory-2025');
  const two = rows.find((r) => r.number === '35IC2-200025');
  assert.equal(two.cavities, 2);
  const bol = rows.find((r) => r.number === 'BOL-35B-102');
  assert.equal(bol.kind, 'bolster');
  assert.equal(bol.size_class, null);
  assert.equal(bol.category, 'BOLSTER HOLDER');
});

const GEX1_INSERTS = [
  ['SN', 'Insert number', 'Press -2', '', 'SN', 'Insert number', 'Press -4', '', 'SN', 'Insert number', 'Press -5', '', 'SN', 'Insert number', 'Press -6'],
  [1, 13212, 'Press-2', '', 1, 12540, 'Press-4', '', 1, 13212, 'Press-5', '', 1, 18573, 'Press-6'],
  [2, '05043', 'Press-2', '', '', '', '', '', 2, '05043', 'Press-5', '', '', '', ''],
];

test('merges one insert listed under two presses', () => {
  const rows = m.parseGex1InsertSheet(GEX1_INSERTS);
  assert.equal(rows.length, 4);
  const a = rows.find((r) => r.number === 'I-13212');
  assert.deepEqual(a.held_presses, ['PRESS 2', 'PRESS 5']);
  assert.equal(a.plant, 'GEX 1');
  assert.equal(a.kind, 'insert');
  assert.equal(a.size_class, null, 'the 2024 inventory has no size column');
  assert.equal(a.size_class_source, null);
  assert.equal(a.source, 'inventory-2024-12');
  assert.deepEqual(rows.find((r) => r.number === 'I-05043').held_presses, ['PRESS 2', 'PRESS 5']);
  assert.equal(rows.find((r) => r.number === 'I-18573').held_presses[0], 'PRESS 6');
});

const GEX1_BOLSTERS = [
  ['BOLSTER FOR  P2 AND P6', '', '', '', '', '', '', '', '', '', ''],
  ['PRESS', 'BOL NO.', 'BOL SIZE', 'A(LEN)', 'B(WED)', '', 'PRESS', 'BOL NO.', 'BOL SIZE', 'A(LEN)', 'B(WED)'],
  [6, 15109, '475X220', 350, 110, '', 2, 506, '475X220', 188, 88],
  [6, '2-1-C', '475X220', 150, 150, '', '', '', '', '', ''],
];

test('GEX-1 bolster sheet yields bolsters with inventory dimensions', () => {
  const rows = m.parseGex1BolsterSheet(GEX1_BOLSTERS);
  assert.deepEqual(rows.map((r) => r.number).sort(), ['BOL-15109', 'BOL-2-1-C', 'BOL-506']);
  const b = rows.find((r) => r.number === 'BOL-15109');
  assert.equal(b.kind, 'bolster');
  assert.deepEqual(b.held_presses, ['PRESS 6']);
  assert.equal(b.size_class, '475X220');
  assert.deepEqual(b.inventory_dims, { a_len: 350, b_wid: 110 });
  assert.equal(b.source, 'bolster-inventory-p2-p6');
});

test('upsert never writes status and keeps an existing size class', () => {
  const [row] = m.parseGex1BolsterSheet(GEX1_BOLSTERS);
  const { sql, params } = m.buildToolingUpsert(row);
  assert.match(sql, /INSERT INTO toolings/);
  assert.match(sql, /ON CONFLICT \(number\) DO UPDATE SET/);
  const updateClause = sql.split('DO UPDATE SET')[1];
  assert.ok(!/\bstatus\b/.test(updateClause), 'status is not touched on update');
  assert.match(updateClause, /size_class = COALESCE\(toolings\.size_class, EXCLUDED\.size_class\)/);
  assert.match(updateClause, /held_presses = \(SELECT ARRAY\(SELECT DISTINCT unnest\(toolings\.held_presses \|\| EXCLUDED\.held_presses\)\)\)/);
  assert.equal(params[0], 'BOL-15109');
});
