'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

installFakeDb(async () => ({ rows: [] }));
const router = require('./enhancement-summary.cjs');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/enhancement-summary', router);
  const server = await listen(app);
  try { await fn(server.base); } finally { await server.close(); }
}

test('defaults to the current year: twelve months', async () => {
  await withServer(async (base) => {
    const r = await request(base, '/api/enhancement-summary');
    assert.equal(r.status, 200);
    assert.equal(r.body.months.length, 12);
    assert.equal(r.body.totals.successRate, null);
  });
});

test('honours from and to', async () => {
  await withServer(async (base) => {
    const r = await request(base, '/api/enhancement-summary?from=2026-03-01&to=2026-05-31');
    assert.deepEqual(r.body.months.map((m) => m.month), ['2026-03', '2026-04', '2026-05']);
  });
});

test('rejects bad or reversed dates', async () => {
  await withServer(async (base) => {
    assert.equal((await request(base, '/api/enhancement-summary?from=nope&to=2026-05-31')).status, 400);
    assert.equal((await request(base, '/api/enhancement-summary?from=2026-06-01&to=2026-05-31')).status, 400);
    assert.equal((await request(base, '/api/enhancement-summary?from=2000-01-01&to=2026-05-31')).status, 400);
  });
});

const post = (base, body) => fetch(`${base}/api/enhancement-summary/pdf`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('POST /pdf answers a PDF named for the period', async () => {
  await withServer(async (base) => {
    const r = await post(base, { from: '2026-03-01', to: '2026-05-31' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="Enhancement-Report-2026-03-01-to-2026-05-31.pdf"');
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  });
});

test('POST /pdf rejects bad or reversed dates like the summary does', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, { from: 'nope', to: '2026-05-31' })).status, 400);
    assert.equal((await post(base, { from: '2026-06-01', to: '2026-05-31' })).status, 400);
    assert.equal((await post(base, { from: '2000-01-01', to: '2026-05-31' })).status, 400);
  });
});
