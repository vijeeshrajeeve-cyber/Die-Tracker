import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { todayLocal } from './today.js';

const require = createRequire(import.meta.url);
const server = require('../../server/services/sampleTrials.cjs');

// 01:30 on 5 September, Dubai (UTC+4) — which is still 21:30 on the 4th in UTC.
// This is the window where toISOString() silently reports the wrong day.
const EARLY_HOURS = new Date(2026, 8, 5, 1, 30, 0);

test('the local day is used, not the UTC day', () => {
  assert.equal(todayLocal(EARLY_HOURS), '2026-09-05');
  assert.equal(server.todayLocal(EARLY_HOURS), '2026-09-05');
});

test('months and days are zero-padded', () => {
  assert.equal(todayLocal(new Date(2026, 0, 3, 12, 0, 0)), '2026-01-03');
  assert.equal(server.todayLocal(new Date(2026, 0, 3, 12, 0, 0)), '2026-01-03');
});

test('the last moment of a day still reports that day', () => {
  assert.equal(todayLocal(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});

test('the frontend and backend agree', () => {
  const at = new Date(2026, 5, 15, 3, 0, 0);
  assert.equal(todayLocal(at), server.todayLocal(at));
});
