import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimulationEnabled, simulationSkipped, simulationPassDate, wasSimulated } from './simulationState.js';

test('a skipped simulation order is not a simulated one', () => {
  const skipped = { simulationEnabled: true, 'Simulation Skipped Date': '2026-11-13' };
  assert.equal(simulationSkipped(skipped), true);
  assert.equal(wasSimulated(skipped), false);
  assert.equal(simulationPassDate(skipped), '2026-11-13');
});

test('a passed simulation order is simulated and ages from the pass', () => {
  const passed = { simulationEnabled: 1, 'Simulation Completed Date': '2026-11-10', 'Simulation Skipped Date': null };
  assert.equal(simulationSkipped(passed), false);
  assert.equal(wasSimulated(passed), true);
  assert.equal(simulationPassDate(passed), '2026-11-10');
});

test('an order without simulation is neither', () => {
  assert.equal(wasSimulated({ simulationEnabled: false }), false);
  assert.equal(simulationPassDate({ simulationEnabled: false }), null);
  assert.equal(simulationSkipped({ 'Simulation Skipped Date': '  ' }), false);
  assert.equal(simulationSkipped(null), false);
});

test('simulation required is read from the flag in any of its stored forms', () => {
  for (const yes of [true, 1, 'true', 'Yes', ' required ']) assert.equal(isSimulationEnabled(yes), true);
  for (const no of [false, 0, null, undefined, '', 'no']) assert.equal(isSimulationEnabled(no), false);
});
