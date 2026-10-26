import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineStatus } from './determineStatus.js';

const base = { 'Ordered date': '2026-10-01', 'Design Received Date': '2026-10-10', simulationEnabled: true };

test('a die awaiting its 3D model stays in Simulation on a drawer edit', () => {
  assert.equal(determineStatus({ ...base, STATUS: 'UNDER SIMULATION' }), 'UNDER SIMULATION');
});

test('entering a 3D model date on a simulation order puts it in Simulation', () => {
  assert.equal(determineStatus({ ...base, STATUS: 'PENDING FOR DESIGN APPROVAL', '3D Model Received Date': '2026-10-12' }), 'UNDER SIMULATION');
});

test('a simulation order with a completed date goes to Design Approval', () => {
  assert.equal(determineStatus({ ...base, STATUS: 'UNDER SIMULATION', '3D Model Received Date': '2026-10-12',
    'Simulation Completed Date': '2026-10-13' }), 'PENDING FOR DESIGN APPROVAL');
});

test('a historic Design Approval order with neither date stays in Design Approval', () => {
  assert.equal(determineStatus({ ...base, STATUS: 'PENDING FOR DESIGN APPROVAL' }), 'PENDING FOR DESIGN APPROVAL');
});

test('orders without simulation keep the old ladder', () => {
  assert.equal(determineStatus({ 'Ordered date': '2026-10-01' }), 'AWAITING FOR DESIGN');
  assert.equal(determineStatus({ 'Ordered date': '2026-10-01', 'Design Received Date': '2026-10-10' }), 'PENDING FOR DESIGN APPROVAL');
  assert.equal(determineStatus({ STATUS: 'HOLD', 'Ordered date': '2026-10-01' }), 'HOLD');
  assert.equal(determineStatus({}), 'PENDING FOR ORDERING');
});
