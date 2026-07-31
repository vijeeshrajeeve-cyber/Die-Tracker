'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sig = require('./userSignatures.cjs');

test('only formats the PDF can embed are accepted', () => {
  assert.ok(sig.isAllowed({ mimetype: 'image/png', originalname: 'sign.png' }));
  assert.ok(sig.isAllowed({ mimetype: 'image/jpeg', originalname: 'sign.jpg' }));
  // pdf-lib cannot embed these, so they must not get as far as the database.
  assert.ok(!sig.isAllowed({ mimetype: 'image/webp', originalname: 'sign.webp' }));
  assert.ok(!sig.isAllowed({ mimetype: 'application/pdf', originalname: 'sign.pdf' }));
  assert.ok(!sig.isAllowed({}));
});

test('a browser that mislabels the mime is rescued by the extension', () => {
  assert.ok(sig.isAllowed({ mimetype: 'application/octet-stream', originalname: 'sign.PNG' }));
  assert.equal(sig.mimeFor({ mimetype: 'application/octet-stream', originalname: 'sign.PNG' }), 'image/png');
  assert.equal(sig.mimeFor({ mimetype: 'application/octet-stream', originalname: 'sign.jpeg' }), 'image/jpeg');
  assert.equal(sig.mimeFor({ mimetype: 'image/png', originalname: 'whatever' }), 'image/png');
});

test('toDataUrl produces something an <img> can show, and null for no signature', () => {
  assert.equal(sig.toDataUrl(null), null);
  assert.equal(
    sig.toDataUrl({ mimeType: 'image/png', bytes: Buffer.from('hi') }),
    `data:image/png;base64,${Buffer.from('hi').toString('base64')}`
  );
});

test('getSignature does not query for a missing user id', async () => {
  let queried = false;
  const pool = { query: async () => { queried = true; return { rowCount: 0, rows: [] }; } };
  assert.equal(await sig.getSignature(pool, null), null);
  assert.equal(queried, false);
});

test('getSignature maps the row onto the shape the PDF renderer expects', async () => {
  const pool = {
    query: async () => ({ rowCount: 1, rows: [{ mime_type: 'image/png', image: Buffer.from('x'), updated_at: '2026-07-27' }] }),
  };
  assert.deepEqual(await sig.getSignature(pool, 7), {
    mimeType: 'image/png', bytes: Buffer.from('x'), updatedAt: '2026-07-27',
  });
});
