'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EDITABLE_FIELDS, OrderEditError, planChanges, needsReason, changeNeedsReason,
  displayValue, validateReason, canEditOrderDetails, fromRow, columnValue,
} = require('./orderDetailEdits.cjs');

const kinds = (before, fields) => planChanges(before, fields).map((c) => [c.field, c.kind]);

test('blank, null and whitespace are all empty, so re-saving them changes nothing', () => {
  assert.deepEqual(planChanges({ Supplier: null, 'PR Number': '' }, { Supplier: '  ', 'PR Number': null }), []);
});

test('dates compare as days, whatever format they are written in', () => {
  assert.deepEqual(planChanges({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '15/09/2026' }), []);
  assert.deepEqual(planChanges({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '2026-09-15T00:00:00.000Z' }), []);
  assert.deepEqual(kinds({ 'Ordered date': null }, { 'Ordered date': '2026-09-16' }), [['Ordered date', 'filled']]);
  assert.deepEqual(kinds({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '2026-09-16' }), [['Ordered date', 'changed']]);
  assert.deepEqual(kinds({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '' }), [['Ordered date', 'cleared']]);
});

test('a date that is not a date is refused rather than saved as a clear', () => {
  assert.throws(() => planChanges({ 'Ordered date': null }, { 'Ordered date': 'next week' }), /Ordered date is not a valid date/);
});

test('date-like text keeps values such as TBC and compares real dates as days', () => {
  assert.deepEqual(planChanges({ ETA: 'TBC' }, { ETA: 'TBC' }), []);
  assert.deepEqual(planChanges({ ETA: '01/10/2026' }, { ETA: '2026-10-01' }), []);
  assert.deepEqual(kinds({ ETA: 'TBC' }, { ETA: '2026-10-01' }), [['ETA', 'changed']]);
  assert.equal(planChanges({ 'PR Entry': null }, { 'PR Entry': '2026-09-01' })[0].after, '2026-09-01');
});

test('whole numbers treat 0 as not set yet', () => {
  assert.deepEqual(kinds({ Cavity: 0 }, { Cavity: '3' }), [['Cavity', 'filled']]);
  assert.deepEqual(kinds({ Cavity: null }, { Cavity: 3 }), [['Cavity', 'filled']]);
  assert.deepEqual(kinds({ Cavity: 2 }, { Cavity: '3' }), [['Cavity', 'changed']]);
  assert.deepEqual(kinds({ Cavity: 3 }, { Cavity: 0 }), [['Cavity', 'cleared']]);
  assert.deepEqual(planChanges({ Cavity: 3 }, { Cavity: '3' }), []);
});

test('whole numbers outside their range are refused', () => {
  assert.throws(() => planChanges({ Cavity: 2 }, { Cavity: -1 }), /Cavity must be a whole number from 0 to 10000/);
  assert.throws(() => planChanges({ Cavity: 2 }, { Cavity: 'two' }), OrderEditError);
  assert.throws(() => planChanges({ 'No of Trial': 0 }, { 'No of Trial': 1001 }), /No of Trial must be a whole number from 0 to 1000/);
});

test('yes/no fields treat off as not set yet', () => {
  assert.deepEqual(kinds({ simulationEnabled: 0 }, { simulationEnabled: true }), [['simulationEnabled', 'filled']]);
  assert.deepEqual(kinds({ specialFollowUp: true }, { specialFollowUp: false }), [['specialFollowUp', 'cleared']]);
  assert.deepEqual(planChanges({ simulationEnabled: 1 }, { simulationEnabled: true }), []);
});

test('every order has an urgency, so any urgency change is a change', () => {
  assert.deepEqual(kinds({ Urgency: 'NORMAL' }, { Urgency: 'URGENT' }), [['Urgency', 'changed']]);
  assert.deepEqual(planChanges({ Urgency: 'TOP_URGENT' }, { Urgency: 'top urgent' }), []);
  assert.deepEqual(planChanges({ Urgency: null }, { Urgency: 'NORMAL' }), []);
});

test('fields the drawer does not show, and values outside a list, are refused', () => {
  assert.throws(() => planChanges({}, { Remark: 'x' }), /Remark cannot be changed from Order Details/);
  assert.throws(() => planChanges({}, { toString: 'x' }), /toString cannot be changed from Order Details/);
  assert.throws(() => planChanges({ STATUS: 'DONE' }, { STATUS: 'SHIPPED' }), /STATUS cannot be SHIPPED/);
  assert.throws(() => planChanges({ TYPE: 'B' }, { TYPE: 'X' }), /TYPE cannot be X/);
  assert.deepEqual(kinds({ STATUS: 'DONE' }, { STATUS: 'DIE RECEIVED' }), [['STATUS', 'changed']]);
});

test('an odd stored value that is sent back untouched never blocks a save', () => {
  assert.deepEqual(kinds({ TYPE: 'b', Supplier: 'A' }, { TYPE: 'b', Supplier: 'B' }), [['Supplier', 'changed']]);
});

test('filling empty fields needs no reason; changing or clearing one does', () => {
  assert.equal(needsReason(planChanges({ Supplier: null }, { Supplier: 'BETA' })), false);
  assert.equal(needsReason(planChanges({ Supplier: 'ALPHA', Cavity: 0 }, { Supplier: 'BETA', Cavity: 2 })), true);
  assert.equal(needsReason(planChanges({ 'PR Number': 'PR-1' }, { 'PR Number': '' })), true);
});

test('an ordinary status step needs no reason; CANCELLED and HOLD always do', () => {
  assert.equal(needsReason(planChanges({ STATUS: 'AWAITING FOR DESIGN' }, { STATUS: 'PENDING FOR DESIGN APPROVAL' })), false);
  assert.equal(changeNeedsReason(planChanges({ STATUS: 'DONE' }, { STATUS: 'CANCELLED' })[0]), true);
  assert.equal(changeNeedsReason(planChanges({ STATUS: 'HOLD' }, { STATUS: 'PENDING FOR PR' })[0]), true);
});

test('log values read the way the drawer shows them', () => {
  assert.equal(displayValue('simulationEnabled', true), 'Yes');
  assert.equal(displayValue('specialFollowUp', false), 'No');
  assert.equal(displayValue('Cavity', 0), '0');
  assert.equal(displayValue('Supplier', null), null);
  assert.equal(displayValue('Ordered date', '2026-09-16'), '2026-09-16');
});

test('a reason is trimmed, optional, and at most 500 characters', () => {
  assert.equal(validateReason('  Supplier revised the quotation  '), 'Supplier revised the quotation');
  assert.equal(validateReason(''), null);
  assert.equal(validateReason(undefined), null);
  assert.equal(validateReason('x'.repeat(500)).length, 500);
  assert.throws(() => validateReason('x'.repeat(501)), /500 characters or fewer/);
});

test('admins can always edit; anyone else needs the switch', () => {
  assert.equal(canEditOrderDetails({ role: 'admin' }), true);
  assert.equal(canEditOrderDetails({ role: 'user', canEditOrderDetails: true }), true);
  assert.equal(canEditOrderDetails({ role: 'user', canEditOrderDetails: false }), false);
  assert.equal(canEditOrderDetails({ role: 'die_designer' }), false);
  assert.equal(canEditOrderDetails(null), false);
});

test('rows map onto drawer fields, and the yes/no integer column is written as 0 or 1', () => {
  const before = fromRow({ supplier: 'ALPHA', ordered_date: '2026-09-15', simulation_enabled: 1, eta: 'TBC' });
  assert.equal(before.Supplier, 'ALPHA');
  assert.equal(before['Ordered date'], '2026-09-15');
  assert.equal(before.simulationEnabled, 1);
  assert.equal(before.ETA, 'TBC');
  assert.equal(Object.keys(before).length, Object.keys(EDITABLE_FIELDS).length);
  assert.equal(columnValue('simulationEnabled', true), 1);
  assert.equal(columnValue('simulationEnabled', false), 0);
  assert.equal(columnValue('specialFollowUp', true), true);
});
