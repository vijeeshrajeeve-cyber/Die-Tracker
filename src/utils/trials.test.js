import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { trialCountFor } from './trials.js';

// The dropdown and the validator hold separate copies of this vocabulary — one
// is ESM for Vite, one is CommonJS for the server, and neither can import the
// other. This test is what stops them drifting: a reason added to one and not
// the other would let the UI offer a value the API rejects.
const require = createRequire(import.meta.url);
const server = require('../../server/services/sampleTrials.cjs');
const { TRIAL_FAIL_REASONS, TRIAL_RESULTS } = await import('./constants.js');

test('the frontend reason list matches the backend, exactly and in order', () => {
  assert.deepEqual(TRIAL_FAIL_REASONS, server.FAIL_REASONS);
});

test('the frontend result list matches the backend, exactly and in order', () => {
  assert.deepEqual(TRIAL_RESULTS, server.TRIAL_RESULTS);
});

test('the count prefers logged trials and falls back to the legacy number', () => {
  assert.deepEqual(trialCountFor([{ trial_no: 1 }, { trial_no: 2 }], 7), { count: 2, isLegacy: false });
  assert.deepEqual(trialCountFor([], 7), { count: 7, isLegacy: true });
});

test('a die with neither trials nor a legacy number shows a plain zero', () => {
  assert.deepEqual(trialCountFor([], 0), { count: 0, isLegacy: false });
  assert.deepEqual(trialCountFor([], null), { count: 0, isLegacy: false });
});

test('one logged trial beats a larger legacy number', () => {
  assert.deepEqual(trialCountFor([{ trial_no: 1 }], 9), { count: 1, isLegacy: false });
});
