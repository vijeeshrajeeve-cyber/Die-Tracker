'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { presentOrder } = require('./orderPresentation.cjs');

test('an order carries its die type under "Die Type"', () => {
  assert.equal(presentOrder({ die_type: 'HOLLOW' })['Die Type'], 'HOLLOW');
  assert.equal(presentOrder({ die_type: null })['Die Type'], null);
});

test('an order carries the simulation finish under "Simulation Completed Date"', () => {
  assert.equal(presentOrder({ simulation_completed_date: '2026-10-20' })['Simulation Completed Date'], '2026-10-20');
  assert.equal(presentOrder({ simulation_completed_date: null })['Simulation Completed Date'], null);
});

test('an order carries its finished simulations under "Simulation Count" only when queried', () => {
  assert.equal(presentOrder({ simulation_count: 2 })['Simulation Count'], 2);
  assert.equal(presentOrder({ simulation_count: null })['Simulation Count'], 0);
  // A row read without the count (a saved row) must not overwrite the client's copy with 0.
  assert.equal('Simulation Count' in presentOrder({ id: 1 }), false);
});

test('a skipped simulation is presented with its date, reason and who', () => {
  const out = presentOrder({ simulation_skipped_date: '2026-11-13', simulation_skipped_reason: 'Repeat die', simulation_skipped_by: 'eng' });
  assert.equal(out['Simulation Skipped Date'], '2026-11-13');
  assert.equal(out['Simulation Skipped Reason'], 'Repeat die');
  assert.equal(out['Simulation Skipped By'], 'eng');
  assert.equal(presentOrder({})['Simulation Skipped Date'], null);
});
