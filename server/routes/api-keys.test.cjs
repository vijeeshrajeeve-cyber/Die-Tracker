'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let storedHash;
installFakeDb(async (sql, params) => {
  if (/^INSERT INTO api_keys/.test(sql)) {
    storedHash = params[0];
    return { rows: [{ id: 3, name: params[1], created_at: '2026-09-22T00:00:00.000Z' }] };
  }
  throw new Error(`api-keys test: unexpected query ${sql}`);
});

const apiKeysRouter = require('./api-keys.cjs');

// index.cjs puts authMiddleware and adminMiddleware in front of this router.
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
app.use('/api/api-keys', apiKeysRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());

// The raw key is shown once. If the stored hash does not match it, the key
// can never be used by /api/export, and there is no way to get it back.
test('a new API key is stored as a hash of the raw key it returns', async () => {
  const { status, body } = await request(base, '/api/api-keys', { body: { name: 'Power BI' } });
  assert.equal(status, 201);
  assert.match(body.rawKey, /^doa_[0-9a-f]{64}$/);
  assert.equal(await bcrypt.compare(body.rawKey, storedHash), true);
});
