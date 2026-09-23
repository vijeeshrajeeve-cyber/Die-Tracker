import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  EDITABLE_FIELDS, STATUSES, planChanges, needsReason, changeNeedsReason, displayValue,
  canEditOrderDetails, pickEditable, fieldLabel, fieldType,
} from './orderDetailEdits.js';

const server = createRequire(import.meta.url)('../../server/services/orderDetailEdits.cjs');

const shape = (fields) => Object.fromEntries(Object.entries(fields)
  .map(([field, { type, max, oneOf }]) => [field, { type, max, oneOf: oneOf && [...oneOf] }]));

// Pairs of (stored order, drawer edits). Both copies must plan them the same.
const CASES = [
  [{ Supplier: null }, { Supplier: 'BETA' }],
  [{ Supplier: 'ALPHA' }, { Supplier: '  ' }],
  [{ 'Ordered date': '2026-09-15' }, { 'Ordered date': '15/09/2026' }],
  [{ 'Ordered date': '2026-09-15' }, { 'Ordered date': '2026-09-20' }],
  [{ ETA: 'TBC' }, { ETA: '2026-10-01' }],
  [{ ETA: '01/10/2026' }, { ETA: '2026-10-01' }],
  [{ Cavity: 0 }, { Cavity: '3' }],
  [{ Cavity: 3 }, { Cavity: 0 }],
  [{ simulationEnabled: 0 }, { simulationEnabled: true }],
  [{ specialFollowUp: true }, { specialFollowUp: false }],
  [{ Urgency: 'NORMAL' }, { Urgency: 'TOP URGENT' }],
  [{ STATUS: 'AWAITING FOR DESIGN' }, { STATUS: 'PENDING FOR DESIGN APPROVAL' }],
  [{ STATUS: 'DONE' }, { STATUS: 'HOLD' }],
  [{ TYPE: 'b', Supplier: 'A' }, { TYPE: 'b', Supplier: 'B' }],
];

// Two copies of the rules, one ESM for Vite and one CommonJS for the server.
// These checks are what stop them drifting.
test('the client and server copies agree on fields, plans and reasons', () => {
  assert.deepEqual(shape(EDITABLE_FIELDS), shape(server.EDITABLE_FIELDS));
  assert.deepEqual([...STATUSES], [...server.STATUSES]);
  for (const [before, fields] of CASES) {
    const ours = planChanges(before, fields);
    assert.deepEqual(ours, server.planChanges(before, fields), JSON.stringify(fields));
    assert.equal(needsReason(ours), server.needsReason(ours), JSON.stringify(fields));
    for (const change of ours) {
      assert.equal(changeNeedsReason(change), server.changeNeedsReason(change));
      assert.equal(displayValue(change.field, change.after), server.displayValue(change.field, change.after));
    }
  }
  for (const user of [{ role: 'admin' }, { role: 'user', canEditOrderDetails: true }, { role: 'user' }, null]) {
    assert.equal(canEditOrderDetails(user), server.canEditOrderDetails(user));
  }
});

test('both copies refuse the same bad input', () => {
  const bad = [
    [{}, { Remark: 'x' }],
    [{ Cavity: 2 }, { Cavity: -1 }],
    [{ 'Ordered date': null }, { 'Ordered date': 'soon' }],
    [{ STATUS: 'DONE' }, { STATUS: 'SHIPPED' }],
  ];
  for (const [before, fields] of bad) {
    assert.throws(() => planChanges(before, fields), Error, JSON.stringify(fields));
    assert.throws(() => server.planChanges(before, fields), Error, JSON.stringify(fields));
  }
});

test('the drawer sends only the fields it may edit', () => {
  const edited = { id: 7, 'DIE NO': '30533_201', 'Order No': 'A-1', Supplier: 'BETA', changeCount: 2, Delay: 4 };
  assert.deepEqual(pickEditable(edited), { Supplier: 'BETA' });
});

test('fields read the way the drawer labels them', () => {
  assert.equal(fieldLabel('simulationEnabled'), 'Simulation');
  assert.equal(fieldLabel('specialFollowUp'), 'Special follow-up');
  assert.equal(fieldLabel('STATUS'), 'Status');
  assert.equal(fieldLabel('Supplier'), 'Supplier');
  assert.equal(fieldType('ETA'), 'datetext');
  assert.equal(fieldType('Remark'), undefined);
});
