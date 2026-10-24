import test from 'node:test';
import assert from 'node:assert/strict';
import { isTooling, nextStatusAfter, designToEmsSince } from './oracleEntry.js';

test('a tooling is order type T, whatever its case or padding', () => {
  assert.equal(isTooling({ TYPE: 'T' }), true);
  assert.equal(isTooling({ TYPE: ' t ' }), true);
  assert.equal(isTooling({ TYPE: 'N' }), false);
  assert.equal(isTooling({ TYPE: null }), false);
  assert.equal(isTooling({}), false);
});

test('completing PR sends a tooling straight to Design to EMS, a die to Oracle Entry', () => {
  assert.equal(nextStatusAfter({ TYPE: 'T' }, 'PENDING FOR PR'), 'PENDING FOR DESIGN TO EMS');
  assert.equal(nextStatusAfter({ TYPE: 'B' }, 'PENDING FOR PR'), 'PENDING FOR ORACLE ENTRY');
  assert.equal(nextStatusAfter({ TYPE: 'T' }, 'PENDING FOR DESIGN APPROVAL'), 'PENDING FOR PR');
  assert.equal(nextStatusAfter({ TYPE: 'N' }, 'PENDING FOR ORACLE ENTRY'), 'PENDING FOR DESIGN TO EMS');
});

test('Design to EMS counts from Oracle entry, or from PR entry when Oracle was skipped', () => {
  assert.equal(designToEmsSince({ 'Oracle Entry': '2026-10-24', 'PR Entry': '2026-10-20' }), '2026-10-24');
  assert.equal(designToEmsSince({ 'Oracle Entry': null, 'PR Entry': '2026-10-20' }), '2026-10-20');
  assert.equal(designToEmsSince({ 'Oracle Entry': '', 'PR Entry': '' }), null);
});
