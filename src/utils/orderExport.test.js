import test from 'node:test';
import assert from 'node:assert/strict';
import {
  orderExportColumns, defaultColumnIds, pickColumns, exportRows, describeFilters, daysInStage, parseDieSize,
} from './orderExport.js';
import { buildSheetData, toCsvRows } from './exportExcel.js';

test('the default columns are the 19 the Orders page exported before, in the same order', () => {
  const ids = defaultColumnIds(orderExportColumns());
  assert.deepEqual(ids, [
    'Die No', 'Order No', 'Plant', 'Item Type', 'Die Type', 'Diameter', 'Thickness', 'Cavity', 'Supplier',
    'Customer', 'PR Number', 'Mandrels per Cavity', 'Total Mandrels', 'Requested Date', 'Shipment', 'Status',
    'Delivery Lead Time (days)', 'Mfg Lead Time (days)', 'Days in Stage',
  ]);
});

test('column ids are unique', () => {
  const ids = orderExportColumns().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('pickColumns keeps catalogue order and drops unknown ids', () => {
  const cols = orderExportColumns();
  assert.deepEqual(pickColumns(cols, ['Supplier', 'Die No', 'Gone']).map((c) => c.id), ['Die No', 'Supplier']);
  assert.deepEqual(pickColumns(cols, undefined), []);
});

test('lead time reads the die received date from the map', () => {
  const cols = pickColumns(orderExportColumns({ dieReceivedDateMap: { 'D-1': '2026-03-11' } }), ['Delivery Lead Time (days)']);
  const [row] = buildSheetData({ rows: [{ 'DIE NO': 'D-1 ', 'Ordered date': '2026-03-01' }], columns: cols });
  assert.equal(row['Delivery Lead Time (days)'], 10);
});

test('extra columns format their values', () => {
  const cols = pickColumns(orderExportColumns(), ['Urgency', 'Special Follow-up', 'ETA', 'Design Received Date']);
  const [row] = buildSheetData({
    rows: [{ Urgency: 'TOP_URGENT', specialFollowUp: 1, ETA: 'end of month', 'Design Received Date': '2026-02-03' }],
    columns: cols,
  });
  assert.equal(row.Urgency, 'Top urgent');
  assert.equal(row['Special Follow-up'], 'Yes');
  assert.equal(row.ETA, 'end of month');
  assert.ok(row['Design Received Date'] instanceof Date);
});

test('exportRows uses filtered or all rows, then the inclusive date range', () => {
  const all = [{ d: '2026-01-01' }, { d: '2026-02-01' }, { d: '2026-03-01' }, { d: null }];
  const dateOf = (o) => o.d;
  assert.equal(exportRows({ allRows: all, filteredRows: all.slice(0, 1), applyFilters: true, dateOf }).length, 1);
  assert.equal(exportRows({ allRows: all, filteredRows: [], applyFilters: false, dateOf }).length, 4);
  const ranged = exportRows({ allRows: all, applyFilters: false, from: '2026-02-01', to: '2026-03-01', dateOf });
  assert.deepEqual(ranged.map((o) => o.d), ['2026-02-01', '2026-03-01']);
  assert.deepEqual(exportRows({ allRows: all, applyFilters: false, from: '2026-02-15', dateOf }).map((o) => o.d), ['2026-03-01']);
});

test('describeFilters lists only the filters that are on', () => {
  assert.deepEqual(describeFilters({ plant: 'all', status: 'all' }, ''), []);
  assert.deepEqual(
    describeFilters({ plant: 'GEX 1', status: 'pre-approval', specialFollowUp: 'yes', dateFrom: '2026-01-01', dateTo: '' }, ' 0516 '),
    ['Search "0516"', 'Plant: GEX 1', 'Status: Pre–design approval', 'Special follow-up: Flagged', 'Requested 2026-01-01 to …'],
  );
});

test('daysInStage counts from the stage entry date', () => {
  assert.equal(daysInStage({ STATUS: 'PENDING FOR PR', 'Design Approved Date': '2026-11-01' }, new Date(2026, 10, 11)), 10);
  assert.equal(daysInStage({ STATUS: 'CANCELLED' }), null);
});

test('parseDieSize splits diameter and thickness', () => {
  assert.deepEqual(parseDieSize('DIA 450X250'), { diameter: '450', thickness: '250' });
});

test('toCsvRows writes dates as YYYY-MM-DD and leaves the rest', () => {
  assert.deepEqual(toCsvRows([{ a: new Date(2026, 0, 5, 12), b: 3, c: '' }]), [{ a: '2026-01-05', b: 3, c: '' }]);
});
