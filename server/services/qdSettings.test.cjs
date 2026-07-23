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
  assert.deepEqual(await s.getQdSettings(pool),
    { approverUserIds: [], purchaseEmailTo: '', purchaseEmailCc: '' });
});
