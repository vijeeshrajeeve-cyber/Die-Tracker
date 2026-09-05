import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { todayLocal, localDay } from './today.js';

const require = createRequire(import.meta.url);
const server = require('../../server/services/dates.cjs');

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

// localDay formats an EXISTING Date by its local calendar day. It is the
// counterpart to todayLocal: same rule, but for a date you already hold.
//
// This matters for the last-resort branch of the order date parsers. Anything
// reaching it was parsed by Date.parse from a non-ISO string ("Sep 4 2026",
// "2026/09/04"), which the spec treats as LOCAL time — so toISOString() there
// reported the previous day for every such value, all day, not just at night.
test('localDay reads a Date by its local calendar day', () => {
  assert.equal(localDay(new Date(2026, 8, 4, 0, 0, 0)), '2026-09-04');
  assert.equal(localDay(new Date(2026, 8, 4, 23, 59, 59)), '2026-09-04');
});

test('localDay agrees with the backend', () => {
  const at = new Date(2026, 8, 4, 0, 0, 0);
  assert.equal(localDay(at), server.localDay(at));
});

test('a locally-parsed date string keeps its own day', () => {
  // Local midnight on the 4th is 20:00 on the 3rd in UTC+4, which is exactly
  // how these dates were losing a day.
  for (const s of ['Sep 4 2026', 'September 4, 2026', '2026/09/04', '4 Sep 2026']) {
    assert.equal(localDay(new Date(Date.parse(s))), '2026-09-04', s);
  }
});

test('todayLocal is localDay applied to now', () => {
  const at = new Date(2026, 8, 5, 1, 30, 0);
  assert.equal(todayLocal(at), localDay(at));
});
