import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldsFromDrawing, valuesFromFields, pressOptionName, editToolingField, finderPayload, linesFromTextItems,
  stampValuesFromItems, customerFromOrderDetails, fieldsFromPages,
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

// Page 1 of request drawings whose order form is a stamped picture: only the typed values are
// text. [text, x, y, height] as pdf.js gives them (30604_401, 30587_201, 30594_601, 30607_601).
const item = ([str, x, y, h]) => ({ str, transform: [h, 0, 0, h, x, y], height: h });
const STAMP_30604 = [
  ['25.02.2026', 432, 440, 6], ['DIA 250X160', 392, 421, 6], ['1', 394, 414, 6], ['4', 446, 415, 6], ['OK', 441, 406, 6],
  ['I-05043', 441, 399, 6], ['OLD', 444, 392, 6], ['12.03.2026', 434, 386, 6], ['NO', 443, 377, 6], ['BY ROAD', 411, 371, 6],
  ['-6.5', 451, 364, 6], ['PDTMC', 390, 443, 6], ['30604-401', 492, 155, 14],
].map(item);
const STAMP_30587 = [
  ['24.02.2026', 210, 307, 4], ['DIA 475X280', 164, 287, 4], ['1', 162, 280, 4], ['2', 211, 279, 4], ['OK', 213, 272, 4],
  ['BOL-30587', 158, 265, 4], ['475X220', 163, 258, 4], ['REQUIRED', 215, 243, 4], ['30587-201', 513, 144, 12],
  ['12.03.2026', 214, 250, 4], ['-5', 222, 229, 6], ['Phoenix', 160, 305, 4], ['BY AIR', 183, 236, 4],
].map(item);
const STAMP_30594 = [
  ['25.02.2026', 506, 641, 6], ['1', 464, 615, 6], ['6', 516, 616, 6], ['OK', 517, 608, 6], ['I-30594', 513, 600, 6],
  ['DIA 560X150', 513, 595, 4], ['18.03.2026', 513, 587, 4], ['Required', 516, 579, 4], ['-6.5', 525, 566, 4],
  ['30594-601', 499, 150, 14], ['DIA 550X300', 466, 623, 6], ['Phoenix', 459, 641, 6], ['By air', 487, 573, 6],
].map(item);
const STAMP_30607 = [
  ['25.02.2026', 244, 778, 6], ['DIA 550x250', 204, 760, 6], ['1', 204, 752, 6], ['6', 250, 752, 6], ['ok', 249, 743, 6],
  ['bol-22772', 193, 737, 6], ['OLD', 202, 730, 6], ['18.03.2026', 252, 724, 4], ['NO', 252, 715, 4], ['-7', 261, 702, 4],
  ['30607-601', 505, 148, 12], ['By air', 222, 708, 8], ['Compes', 196, 777, 6],
].map(item);

test('stampValuesFromItems reads the typed form values by where they sit', () => {
  assert.deepEqual(stampValuesFromItems(STAMP_30604), {
    supplier: 'PDTMC', orderDate: '2026-02-25', dieSize: '250X160', cavities: 1, press: '4', dieType: 'HOLLOW',
    bolsterNo: null, insertNo: 'I-05043', bolsterSize: null, insertSize: 'OLD',
    deliveryDate: '2026-03-12', threeD: false, shipment: 'BY ROAD', weightPct: '-6.5',
  });
  assert.deepEqual(stampValuesFromItems(STAMP_30587), {
    supplier: 'Phoenix', orderDate: '2026-02-24', dieSize: '475X280', cavities: 1, press: '2', dieType: 'HOLLOW',
    bolsterNo: 'BOL-30587', insertNo: null, bolsterSize: '475X220', insertSize: null,
    deliveryDate: '2026-03-12', threeD: true, shipment: 'BY AIR', weightPct: '-5',
  }, 'left column: a bolster and its size');
  const s94 = stampValuesFromItems(STAMP_30594);
  assert.deepEqual([s94.dieSize, s94.insertNo, s94.insertSize, s94.press, s94.threeD], ['550X300', 'I-30594', '560X150', '6', true],
    'the die size is the size above the cavity row, whatever order the items come in');
  const s07 = stampValuesFromItems(STAMP_30607);
  assert.deepEqual([s07.supplier, s07.bolsterNo, s07.bolsterSize, s07.insertNo, s07.dieType], ['Compes', 'BOL-22772', 'OLD', null, 'HOLLOW']);
});

test('stampValuesFromItems answers null without a supplier-and-date row', () => {
  assert.equal(stampValuesFromItems([]), null);
  assert.equal(stampValuesFromItems(null), null);
  assert.equal(stampValuesFromItems([item(['30604-401', 492, 155, 14]), item(['DIA 250X160', 392, 421, 6])]), null);
  assert.equal(stampValuesFromItems([item(['25.02.2026', 432, 440, 6]), item(['1', 394, 414, 6])]), null, 'a date alone is not the form');
});

test('customerFromOrderDetails takes the name on the profile number line', () => {
  const page2 = [
    ['Sales to fill in all the information below for facilitation of die procurement.', 31, 615, 8],
    ['Nazri', 327, 139, 8], ['Schuco Middle East Windows & Facade Systems L.L.C.', 389, 687, 8], ['30604', 124, 686, 8],
  ].map(item);
  assert.equal(customerFromOrderDetails(page2, '30604'), 'Schuco Middle East Windows & Facade Systems L.L.C.');
  assert.equal(customerFromOrderDetails(page2, '99999'), null);
  assert.equal(customerFromOrderDetails(page2, ''), null);
  assert.equal(customerFromOrderDetails(null, '30604'), null);
});

test('fieldsFromPages fills the form from a drawing whose labels are not text', () => {
  const page2 = [['Schuco Middle East', 389, 687, 8], ['30604', 124, 686, 8]].map(item);
  const fields = fieldsFromPages(STAMP_30604, { fileName: '30604_401.pdf', page2Items: page2 });
  const { values, sources } = valuesFromFields(fields, { today: '2026-11-10' });
  assert.deepEqual(
    [values.DIE_NO, values.PROFILE_NO, values.DIE_SIZE, values.NO_OF_CAV, values.PRESS, values.PLANT, values.HOLLOW, values.SOLID],
    ['30604-401', '30604', '250X160', '1', 'P4', 'GEX 1', true, false],
  );
  assert.deepEqual(
    [values.INSERT_NO, values.INSERT_SIZE, values.BOLSTER_NO, values.DELIVERY_DATE, values.THREE_D_MODULE, values.PROFILE_WEIGHT_PCT, values.CUSTOMER],
    ['I-05043', 'OLD', '', '2026-03-12', false, '-6.5', 'Schuco Middle East'],
  );
  assert.equal(values.DATE, '2026-11-10', 'the form is dated the day it is prepared, not the drawing');
  assert.equal(values.SUPPLIER, '', 'the supplier is matched against the master by the form, not here');
  assert.equal(fields.supplier, 'PDTMC');
  for (const key of ['DIE_SIZE', 'NO_OF_CAV', 'PRESS', 'HOLLOW', 'INSERT_NO', 'INSERT_SIZE', 'DELIVERY_DATE', 'PROFILE_WEIGHT_PCT', 'CUSTOMER']) {
    assert.equal(sources[key], 'drawing', key);
  }
});

test('fieldsFromPages reads a form printed as text by its labels alone', () => {
  const labelled = [
    ['DIE SIZE 320X160', 60, 781, 8], ['No OF CAV 2 PRESS P7', 60, 770, 8],
    ...[['25.02.2026', 432, 440, 6], ['DIA 250X160', 392, 421, 6], ['1', 394, 414, 6], ['4', 446, 415, 6],
      ['I-05043', 441, 399, 6], ['PDTMC', 390, 443, 6]],
  ].map(item);
  const fields = fieldsFromPages(labelled, { fileName: '30604_401.pdf' });
  assert.deepEqual([fields.dieSize, fields.cavities, fields.press, fields.insertNo, fields.supplier], ['320X160', 2, 'P7', null, null],
    'values typed elsewhere on the page are not mixed into a labelled form');
});
