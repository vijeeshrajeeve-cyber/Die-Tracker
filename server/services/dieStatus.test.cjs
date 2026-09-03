'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./dieStatus.cjs');

// The two plants word the same thing differently: GEX-01 says SENT TO TALEX,
// GEX-2 says TRANSFERRED. Both mean the die is at another plant.
test('the inactive list covers both plants wording for a transferred die', () => {
  assert.deepEqual(s.INACTIVE_DIE_STATUSES, ['SCRAPPED', 'HOLD', 'TRANSFERRED', 'SENT TO TALEX']);
});

test('activeDieClause binds at the position it is given', () => {
  assert.match(s.activeDieClause(2), /\$2::text\[\]/);
  assert.match(s.activeDieClause(11), /\$11::text\[\]/);
  assert.doesNotMatch(s.activeDieClause(2), /%d/);
});

// A die with no recorded status is unknown, not known-active — otherwise a
// plant imported before the status column existed reports every scrapped die.
test('activeDieClause requires a recorded status', () => {
  assert.match(s.activeDieClause(1), /NULLIF\(die_status, ''\) IS NOT NULL/);
});
