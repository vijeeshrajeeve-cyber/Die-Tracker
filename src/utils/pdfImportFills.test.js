import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPdfFills, fillSummary, FILL_NEEDS_PERMISSION, mergeExistingForPreview, planPdfFills } from './pdfImportFills.js';

// An order as the app holds it (server presentOrder shape) with some fields set.
const EXISTING = {
  id: 7, 'DIE NO': '030724-701', 'Die Size': '320X160', Supplier: 'PHME', Press: null, Plant: 'GEX 2',
  Cavity: 0, 'Die Requested Date': null, simulationEnabled: false, 'Type of shipment': 'LAND',
  TYPE: 'N', 'Mandrels per Cavity': 0, 'Total Mandrels': 0,
  'Ordered date': '2026-09-20', ETA: '2026-11-01', 'Design Received Date': '2026-09-25T00:00:00.000Z',
};
// The row the parser built from the PDF for the same die.
const PARSED = {
  id: 7, isExisting: true, 'DIE NO': '030724-701', 'Die Size': '330X160', Supplier: 'PDTMC', Press: 'P7',
  Plant: 'GEX 1', Cavity: 2, 'Die Requested Date': '2026-10-11', simulationEnabled: true,
  'Type of shipment': 'AIR', TYPE: 'N', 'Mandrels per Cavity': 0, 'Total Mandrels': 0,
  'Ordered date': null, ETA: null, 'Design Received Date': null,
};
const FROM_PDF = { plantFromPdf: true, shipmentFromTable: true };

test('set values keep the order value; blanks take the PDF value', () => {
  const row = mergeExistingForPreview(EXISTING, PARSED, FROM_PDF);
  assert.equal(row['Die Size'], '320X160');
  assert.equal(row.Supplier, 'PHME');
  assert.equal(row.Plant, 'GEX 2');
  assert.equal(row['Type of shipment'], 'LAND');
  assert.equal(row.Press, 'P7');
  assert.equal(row.Cavity, 2);
  assert.equal(row['Die Requested Date'], '2026-10-11');
  assert.equal(row.simulationEnabled, true);
});

test('a re-import plans only the blanks, never the dates, ETA or set values', () => {
  const row = mergeExistingForPreview(EXISTING, PARSED, FROM_PDF);
  const { fields, labels } = planPdfFills(EXISTING, row);
  assert.deepEqual(fields, { Press: 'P7', Cavity: 2, 'Die Requested Date': '2026-10-11', simulationEnabled: true });
  assert.deepEqual(labels, ['Press', 'Cavity', 'Die Requested Date', 'Simulation']);
});

test('parser placeholders never fill a blank', () => {
  const blank = { ...EXISTING, 'Die Size': null, Supplier: '', Plant: null, 'Type of shipment': null };
  const parsed = { ...PARSED, 'Die Size': 'N/A', Supplier: 'UNKNOWN', Plant: 'GEX 1', 'Type of shipment': 'LAND' };
  const row = mergeExistingForPreview(blank, parsed, { plantFromPdf: false, shipmentFromTable: false });
  assert.equal(row['Die Size'], null);
  assert.equal(row.Supplier, null);
  assert.equal(row.Plant, null);
  assert.equal(row['Type of shipment'], null);
  const { fields } = planPdfFills(blank, row);
  for (const field of ['Die Size', 'Supplier', 'Plant', 'Type of shipment']) {
    assert.equal(field in fields, false, field);
  }
});

test('a plant picked in the preview fills a blank plant', () => {
  const blank = { ...EXISTING, Plant: null };
  const row = { ...mergeExistingForPreview(blank, PARSED, { ...FROM_PDF, plantFromPdf: false }), Plant: 'GEX 2' };
  assert.equal(planPdfFills(blank, row).fields.Plant, 'GEX 2');
});

test('a complete order plans nothing', () => {
  const complete = {
    ...EXISTING, Press: 'P7', Cavity: 2, 'Die Requested Date': '2026-10-11T00:00:00.000Z', simulationEnabled: true,
  };
  const row = mergeExistingForPreview(complete, PARSED, FROM_PDF);
  assert.deepEqual(planPdfFills(complete, row), { fields: {}, labels: [] });
});

test('a value the drawer would refuse is left out rather than failing the plan', () => {
  const noShipment = { ...EXISTING, 'Type of shipment': null };
  const row = { ...mergeExistingForPreview(noShipment, PARSED, FROM_PDF), 'Type of shipment': 'SEA' };
  const { fields } = planPdfFills(noShipment, row);
  assert.equal('Type of shipment' in fields, false);
  assert.equal(fields.Press, 'P7');
});

const httpError = (status, message, code) => Object.assign(new Error(message), { status, data: { error: message, code } });

test('fills each die in turn and keeps going after a refusal or an error', async () => {
  const calls = [];
  const patchDetails = async (id, body) => {
    calls.push([id, body]);
    if (id === 2) throw httpError(400, 'Give a reason for changing existing values', 'REASON_REQUIRED');
    if (id === 3) throw httpError(403, 'You do not have permission to edit order details', 'ORDER_EDIT_FORBIDDEN');
    if (id === 4) throw new Error('Network down');
    return { logged: 1 };
  };
  const result = await applyPdfFills([
    { id: 1, dieNo: 'A-1', fields: { Press: 'P7' } },
    { id: 2, dieNo: 'B-2', fields: { Cavity: 2 } },
    { id: 3, dieNo: 'C-3', fields: { Cavity: 1 } },
    { id: 4, dieNo: 'D-4', fields: { Cavity: 1 } },
    { id: 5, dieNo: 'E-5', fields: { Press: 'P4' } },
  ], patchDetails);
  assert.deepEqual(calls.map(([id]) => id), [1, 2, 3, 4, 5]);
  assert.deepEqual(calls[0][1], { fields: { Press: 'P7' } });
  assert.equal(result.filled, 2);
  assert.deepEqual(result.failed, [
    { dieNo: 'B-2', cause: 'changed since preview' },
    { dieNo: 'C-3', cause: FILL_NEEDS_PERMISSION },
    { dieNo: 'D-4', cause: 'Network down' },
  ]);
});

test('the summary counts each outcome and names the dies not filled', () => {
  assert.equal(
    fillSummary({ created: 4, filled: 2, complete: 10, failed: [{ dieNo: '30725-201', cause: 'changed since preview' }] }),
    'PDF import: 4 new orders created, 2 existing orders filled, 10 already complete, 1 not filled (30725-201: changed since preview)',
  );
  assert.equal(fillSummary({ created: 1, filled: 1, complete: 0, failed: [] }), 'PDF import: 1 new order created, 1 existing order filled');
  assert.equal(fillSummary({ created: 0, filled: 0, complete: 3, failed: [] }), 'PDF import: 3 already complete');
});
