'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planReceivedDate, RECEIVED_FIELDS } = require('./stageCompletion.cjs');

test('first design receipt (empty existing) writes to the order column', () => {
  const plan = planReceivedDate({ field: 'Design Received Date', existingValue: null });
  assert.equal(plan.writeTo, 'order');
  assert.equal(plan.orderCol, 'design_received_date');
  assert.equal(plan.revisionCol, 'design_received_date');
});

test('re-received design (existing set) writes to the revision column', () => {
  const plan = planReceivedDate({ field: 'Design Received Date', existingValue: '2026-07-01' });
  assert.equal(plan.writeTo, 'revision');
  assert.equal(plan.revisionCol, 'design_received_date');
});

test('first 3D model receipt writes to the order column', () => {
  const plan = planReceivedDate({ field: '3D Model Received Date', existingValue: '' });
  assert.equal(plan.writeTo, 'order');
  assert.equal(plan.orderCol, 'three_d_model_received_date');
  assert.equal(plan.revisionCol, 'model_received_date');
});

test('re-received 3D model writes to the model revision column', () => {
  const plan = planReceivedDate({ field: '3D Model Received Date', existingValue: '2026-07-02' });
  assert.equal(plan.writeTo, 'revision');
  assert.equal(plan.revisionCol, 'model_received_date');
});

test('whitespace-only existing value counts as empty (first receipt)', () => {
  const plan = planReceivedDate({ field: 'Design Received Date', existingValue: '   ' });
  assert.equal(plan.writeTo, 'order');
});

test('unknown field falls back to order with null column', () => {
  const plan = planReceivedDate({ field: 'PR Entry', existingValue: 'anything' });
  assert.equal(plan.writeTo, 'order');
  assert.equal(plan.orderCol, null);
});

test('RECEIVED_FIELDS maps both received fields', () => {
  assert.deepEqual(Object.keys(RECEIVED_FIELDS).sort(), ['3D Model Received Date', 'Design Received Date']);
});
