'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./qdSettings.cjs');

test('parseIds tolerates junk and coerces to numbers', () => {
  assert.deepEqual(s.parseIds('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(s.parseIds('["4","5"]'), [4, 5]);
  assert.deepEqual(s.parseIds(''), []);
  assert.deepEqual(s.parseIds('not json'), []);
  assert.deepEqual(s.parseIds(null), []);
});

test('isApprover: admins always, otherwise only listed users', () => {
  assert.equal(s.isApprover({ id: 9, role: 'admin' }, []), true);
  assert.equal(s.isApprover({ id: 3, role: 'user' }, [3, 7]), true);
  assert.equal(s.isApprover({ id: 4, role: 'user' }, [3, 7]), false);
  assert.equal(s.isApprover(null, [3]), false);
});

test('getQdSettings returns parsed defaults when no row exists', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await s.getQdSettings(pool), {
    approverUserIds: [], purchaseEmailTo: '', purchaseEmailCc: '',
    pressOptions: s.DEFAULT_PRESS_OPTIONS,
    dieTypeOptions: s.DEFAULT_DIE_TYPE_OPTIONS,
    alloyOptions: s.DEFAULT_ALLOY_OPTIONS,
  });
});

test('sanitizeList trims, drops blanks and de-dupes case-insensitively', () => {
  assert.deepEqual(s.sanitizeList([' P2 ', 'P2', 'p2', '', '  ', 'Hollow']), ['P2', 'Hollow']);
  assert.deepEqual(s.sanitizeList('not an array'), []);
  assert.deepEqual(s.sanitizeList([1, 2, 2]), ['1', '2']);
});

test('getQdSettings uses stored option lists, falling back to defaults when empty', async () => {
  const pool = { query: async () => ({ rows: [{
    approver_user_ids: '[3]', purchase_email_to: 'p@x.com', purchase_email_cc: '',
    press_options: '["1200T","1650T"]', die_type_options: '[]', alloy_options: 'junk',
  }] }) };
  const out = await s.getQdSettings(pool);
  assert.deepEqual(out.pressOptions, ['1200T', '1650T']);   // stored wins
  assert.deepEqual(out.dieTypeOptions, s.DEFAULT_DIE_TYPE_OPTIONS); // empty -> default
  assert.deepEqual(out.alloyOptions, s.DEFAULT_ALLOY_OPTIONS);      // junk  -> default
});

test('saveQdSettings sanitizes the option lists before persisting', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    return /SELECT id FROM qd_settings/.test(sql) ? { rows: [{ id: 1 }] } : { rows: [] };
  } };
  await s.saveQdSettings(pool, {
    approverUserIds: [3], purchaseEmailTo: 'p@x.com', purchaseEmailCc: '',
    pressOptions: [' P1 ', 'P1', 'P2'], dieTypeOptions: ['Hollow'], alloyOptions: ['6063', '', '6063'],
  });
  const upd = calls.find((c) => /UPDATE qd_settings/.test(c.sql));
  assert.equal(upd.params[3], JSON.stringify(['P1', 'P2']));
  assert.equal(upd.params[5], JSON.stringify(['6063']));
});
