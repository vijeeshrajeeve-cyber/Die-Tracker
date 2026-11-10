import test from 'node:test';
import assert from 'node:assert/strict';
import { stopReason, remarkFallback } from './stopReason.js';

test('remarkFallback gives the order remark only when no logged reason exists', () => {
  assert.equal(remarkFallback(null, ' common insert for 30594 '), 'common insert for 30594');
  assert.equal(remarkFallback({ reason: null }, 'r'), 'r');
  assert.equal(remarkFallback({ reason: 'logged' }, 'r'), null);
  assert.equal(remarkFallback(null, '  '), null);
  assert.equal(remarkFallback(null, undefined), null);
});

const entry = (new_value, changed_at, reason, extra = {}) => ({
  field_name: 'STATUS', old_value: 'PENDING FOR PR', new_value, changed_at, reason, changed_by: 'anil', ...extra,
});

test('returns null for an order that is not cancelled or on hold', () => {
  assert.equal(stopReason('PENDING FOR PR', [entry('CANCELLED', '2026-10-01T10:00:00Z', 'x')]), null);
  assert.equal(stopReason('', []), null);
});

test('finds the reason on the entry that moved the order into its status', () => {
  const r = stopReason('CANCELLED', [
    { field_name: 'Supplier', new_value: 'CANCELLED', changed_at: '2026-10-05T00:00:00Z', reason: 'not this' },
    entry('CANCELLED', '2026-10-01T10:00:00Z', 'Customer dropped the profile'),
  ]);
  assert.deepEqual(r, { reason: 'Customer dropped the profile', changedAt: '2026-10-01T10:00:00Z', changedBy: 'anil' });
});

test('uses the latest matching entry when the status was set more than once', () => {
  const r = stopReason('HOLD', [
    entry('HOLD', '2026-09-01T00:00:00Z', 'old hold'),
    entry('PENDING FOR PR', '2026-09-10T00:00:00Z', 'resumed'),
    entry('HOLD', '2026-10-20T00:00:00Z', 'Waiting for customer drawing'),
  ]);
  assert.equal(r.reason, 'Waiting for customer drawing');
});

test('ignores entries for the other stopped status', () => {
  assert.equal(stopReason('HOLD', [entry('CANCELLED', '2026-10-01T00:00:00Z', 'x')]), null);
});

test('a matching entry with no reason reports reason as null', () => {
  const r = stopReason('CANCELLED', [entry('CANCELLED', '2026-10-01T00:00:00Z', '  ')]);
  assert.equal(r.reason, null);
  assert.equal(r.changedBy, 'anil');
});

test('copes with a missing or malformed change list', () => {
  assert.equal(stopReason('CANCELLED', undefined), null);
  assert.equal(stopReason('CANCELLED', [null, {}]), null);
});
