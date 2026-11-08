import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldsFromDrawing, valuesFromFields, pressOptionName, editToolingField, finderPayload, linesFromTextItems,
} from './newDieOrderPrefill.js';

// Lines as PDFImportModal builds them: y descending, items left to right, one item per text.
const line = (y, ...texts) => ({
  y, text: texts.join(' '), items: texts.map((text, i) => ({ text, x: 40 + i * 60 })),
});

// Page 1 of 030724_701_.pdf as pdf.js reads it (order-form rows, the scale line and the title block).
const SAMPLE_030724 = [
  line(639, 'Ra', 'Scale 3:1', 'SCALE 1:1'),
  line(300, 'SUPPLIER   - PHME DATE - 29.09.2026  1.6'),
  line(280, 'DIE SIZE - DIA320X160'),
  line(273, 'No OF CAV - 2 PRESS - 7'),
  // the SOLID/HOLLOW row with pdf.js's own x positions: the mark sits just after HOLLOW
  {
    y: 266,
    text: 'SOLID - HOLLOW - OK',
    items: [['SOLID', 158], ['-', 186], ['HOLLOW', 208], ['-', 232], ['OK', 235]].map(([text, x]) => ({ text, x })),
  },
  line(259, 'BOLSTER No, - INSERT No, - 25IC2-030724 37.9'),
  line(252, 'SIZE - SIZE - DIA300X100(NEW)  2'),
  line(151, '030724_701'),
  line(88, 'Customer :'),
  line(75, 'Main visible surf,: C/S Area  378.445 CCD 98 Description : -'),
];
const fullTextOf = (lines) => lines.map((l) => l.text).join(' ');

test('fieldsFromDrawing reads the 030724 order form', () => {
  const f = fieldsFromDrawing(SAMPLE_030724, fullTextOf(SAMPLE_030724), { fileName: '030724_701_.pdf' });
  assert.equal(f.dieSize, '320X160');
  assert.equal(f.cavities, 2);
  assert.equal(f.press, 'P7');
  assert.equal(f.dieType, 'HOLLOW');
  assert.equal(f.insertNo, '25IC2-030724');
  assert.equal(f.bolsterNo, null);
  assert.equal(f.dieNo, '030724-701');
  assert.equal(f.profileNo, '030724');
  assert.equal(f.customer, null); // the label is printed, the value is blank
  assert.deepEqual(f.sources, {
    dieSize: 'drawing', cavities: 'drawing', press: 'drawing', dieType: 'drawing',
    insertNo: 'drawing', dieNo: 'drawing', profileNo: 'drawing',
  });
});

test('fieldsFromDrawing takes the die number from the page text when the file name has none', () => {
  const lines = [line(300, 'DIE NO 30713-201'), line(88, 'Customer : AL GHURAIR')];
  const f = fieldsFromDrawing(lines, fullTextOf(lines), { fileName: 'drawing.pdf' });
  assert.equal(f.dieNo, '30713-201');
  assert.equal(f.profileNo, '30713');
  assert.equal(f.customer, 'AL GHURAIR');
  assert.equal(f.sources.customer, 'drawing');
});

test('fieldsFromDrawing on a blank form reads nothing and claims no source', () => {
  const lines = [
    line(280, 'DIE SIZE -'), line(273, 'No OF CAV - PRESS -'), line(266, 'SOLID', '-', 'HOLLOW', '-'),
    line(259, 'BOLSTER No, - INSERT No, -'),
  ];
  const f = fieldsFromDrawing(lines, fullTextOf(lines));
  assert.deepEqual(
    [f.dieSize, f.cavities, f.press, f.dieType, f.insertNo, f.bolsterNo, f.dieNo, f.profileNo, f.customer],
    [null, null, null, null, null, null, null, null, null],
  );
  assert.deepEqual(f.sources, {});
});

test('fieldsFromDrawing reads a cavity count printed on the next line', () => {
  const lines = [line(273, 'No OF CAV - PRESS - P25'), line(268, '1')];
  const f = fieldsFromDrawing(lines, fullTextOf(lines));
  assert.equal(f.cavities, 1);
  assert.equal(f.press, 'P25');
});

test('valuesFromFields fills every template key and the form identity', () => {
  const fields = fieldsFromDrawing(SAMPLE_030724, fullTextOf(SAMPLE_030724), { fileName: '030724_701_.pdf' });
  const { values, sources } = valuesFromFields(fields, { today: '2026-11-08' });
  assert.deepEqual(values, {
    SUPPLIER: '', DATE: '2026-11-08', DIE_SIZE: '320X160', NO_OF_CAV: '2', PRESS: 'P7',
    SOLID: false, HOLLOW: true, BOLSTER_NO: '', INSERT_NO: '25IC2-030724', BOLSTER_SIZE: '', INSERT_SIZE: '',
    DELIVERY_DATE: '', THREE_D_MODULE: false, SHIPMENT: '', PROFILE_WEIGHT_PCT: '',
    FINISH_MILL: false, FINISH_ANODIZING: false, FINISH_POWDER: false, PENDING_ORDER_KG: '0', REASON: '',
    PLANT: 'GEX 2', DIE_NO: '030724-701', PROFILE_NO: '030724', CUSTOMER: '',
  });
  assert.deepEqual(sources, {
    DIE_SIZE: 'drawing', NO_OF_CAV: 'drawing', PRESS: 'drawing', HOLLOW: 'drawing', INSERT_NO: 'drawing',
    PLANT: 'drawing', DIE_NO: 'drawing', PROFILE_NO: 'drawing',
  });
});

test('valuesFromFields on nothing read leaves a blank form dated today', () => {
  const { values, sources } = valuesFromFields({}, { today: '2026-11-08' });
  assert.equal(values.DATE, '2026-11-08');
  assert.equal(values.PLANT, '');
  assert.equal(values.SOLID, false);
  assert.equal(values.HOLLOW, false);
  assert.equal(values.PENDING_ORDER_KG, '0');
  assert.equal(Object.keys(values).length, 24);
  assert.deepEqual(sources, {});
});

test('valuesFromFields ticks SOLID for a solid die', () => {
  const { values, sources } = valuesFromFields({ dieType: 'SOLID', sources: { dieType: 'drawing' } }, { today: '2026-11-08' });
  assert.equal(values.SOLID, true);
  assert.equal(values.HOLLOW, false);
  assert.equal(sources.SOLID, 'drawing');
});

const PRESSES = [
  { press_name: 'PRESS 2', press_code: 'B', plant: 'GEX 01' },
  { press_name: 'PRESS 7', press_code: 'P25', plant: 'GEX 02' },
  { press_name: 'PRESS 8', press_code: 'P35', plant: 'GEX 02' },
];

test('pressOptionName maps a drawing press code onto the presses master', () => {
  assert.equal(pressOptionName('P7', PRESSES), 'PRESS 7');
  assert.equal(pressOptionName('P25', PRESSES), 'PRESS 7'); // a press code wins over a number
  assert.equal(pressOptionName('B', PRESSES), 'PRESS 2');
  assert.equal(pressOptionName('P9', PRESSES), 'P9'); // unknown: kept as read
  assert.equal(pressOptionName('', PRESSES), '');
});

test('editToolingField keeps the chosen number but marks it typed over', () => {
  const chosen = { tooling: 'I-30602', kind: 'insert', fromFinder: true };
  const values = { INSERT_NO: 'I-30602', INSERT_SIZE: '250X140', BOLSTER_NO: '' };
  const typed = editToolingField(values, chosen, 'INSERT_NO', 'I-30603');
  assert.equal(typed.values.INSERT_NO, 'I-30603');
  assert.deepEqual(typed.chosen, { tooling: 'I-30602', kind: 'insert', fromFinder: false });
  // the other pair does not touch the chosen insert
  const other = editToolingField(values, chosen, 'BOLSTER_NO', 'B-1');
  assert.equal(other.chosen, chosen);
  assert.equal(editToolingField(values, null, 'INSERT_NO', 'x').chosen, null);
});

test('finderPayload drops polygons from candidates and sends only the shape fields', () => {
  const chosen = { tooling: 'I-1', kind: 'insert', fromFinder: true };
  const result = { candidates: [{ number: 'I-1', kind: 'insert', clearance: 6.8, pockets: [[[0, 0]]], placements: [{ theta: 0 }] }] };
  const profile = {
    style: 'outline', outer_unit: [[0, 0], [1, 0], [0, 1]], holes_unit: [], true_size: true,
    outer_mm: [[0, 0], [10, 0], [0, 10]], holes_mm: [], ccd_mm: 98, true_size_source: 'scale',
    true_size_confidence: 'likely', needs_review: false, review_reason: null, hole_count: 0,
  };
  const p = finderPayload({ chosen, result, profile });
  assert.deepEqual(p.candidates, [{ number: 'I-1', kind: 'insert', clearance: 6.8 }]);
  assert.equal(p.chosen, chosen);
  assert.equal('hole_count' in p.profile, false);
  assert.deepEqual(p.profile.outer_mm, profile.outer_mm);
  assert.equal(p.profile.ccd_mm, 98);
  assert.deepEqual(finderPayload({ chosen: null, result: null, profile: null }), { chosen: null, candidates: null, profile: null });
});

test('linesFromTextItems groups pdf.js items into rows, top first, within 3 pt', () => {
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const lines = linesFromTextItems([
    item('PRESS', 208, 273), item('No OF CAV', 158, 273), item('- 2', 186, 272),
    item('DIE SIZE - DIA320X160', 158, 280), item('7', 234, 270),
  ]);
  assert.deepEqual(lines.map((l) => [l.y, l.text]), [[280, 'DIE SIZE - DIA320X160'], [273, 'No OF CAV - 2 PRESS 7']]);
  assert.deepEqual(lines[1].items.map((i) => i.x), [158, 186, 208, 234]);
});
