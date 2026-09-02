import test from 'node:test';
import assert from 'node:assert/strict';

// api.js reads the token out of localStorage on every request, so it needs a
// stub before the module is imported.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { frozenDesignsAPI, existingDataAPI, backupRequestsAPI } = await import('./api.js');

const respondWith = (body, status = 200) => {
  globalThis.fetch = async () => new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const KEY = { profile: '19480', plant: 'GEX 2', press: 'PRESS 8', cavity: 2 };

// GET /frozen-designs/match answers `null` when nothing is frozen for the key.
// Coercing that to {} makes every caller's `if (!match)` guard fail, which is
// how the Frozen Design banner ended up on every new request.
test('a JSON null body is passed through as null', async () => {
  respondWith('null');
  assert.equal(await frozenDesignsAPI.match(KEY), null);
});

test('a JSON object body comes back intact', async () => {
  respondWith(JSON.stringify({ id: 7, frozen_at: '2026-06-18T00:00:00.000Z' }));
  const match = await frozenDesignsAPI.match(KEY);
  assert.equal(match.id, 7);
  assert.equal(match.frozen_at, '2026-06-18T00:00:00.000Z');
});

// A genuinely empty body (no JSON at all) still has to be safe to read from —
// that is what the {} fallback is for, and it must stay.
test('an empty body still yields a readable object', async () => {
  respondWith('');
  assert.deepEqual(await frozenDesignsAPI.match(KEY), {});
});

// A plant's full die list is ~45,000 rows — one JSON body would be ~36MB and
// nginx answers with a bare 413 ("Those files are too large to upload in one
// go"). The import has to go up in batches, and only the first may clear the
// plant's existing rows.
const recordImportRequests = () => {
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    sent.push(body);
    return new Response(
      JSON.stringify({ imported: body.rows.length, skipped: 0, meta: { dieDetails: [], productionData: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  return sent;
};

const dieRows = (n) => Array.from({ length: n }, (_, i) => ({ IDDie: `0100${i}_401`, IDProfile: `0100${i}` }));

test('a large die list is split into batches, only the first replacing', async () => {
  const sent = recordImportRequests();
  const result = await existingDataAPI.importDieDetails({
    plant: 'GEX-01', rows: dieRows(4500), sourceFile: 'gex1.xlsx',
  });

  assert.equal(sent.length, 3);
  assert.deepEqual(sent.map((r) => r.rows.length), [2000, 2000, 500]);
  assert.deepEqual(sent.map((r) => r.replace), [true, false, false]);
  assert.equal(result.imported, 4500);
  assert.equal(result.total, 4500);
  assert.ok(result.meta, 'the last batch\'s meta is returned');
});

test('every batch stays well under the 10MB body cap', async () => {
  const sent = recordImportRequests();
  await existingDataAPI.importDieDetails({ plant: 'GEX-01', rows: dieRows(45000), sourceFile: 'gex1.xlsx' });

  const biggest = Math.max(...sent.map((r) => JSON.stringify(r).length));
  assert.ok(biggest < 10 * 1024 * 1024, `largest batch was ${biggest} bytes`);
  assert.equal(sent.reduce((n, r) => n + r.rows.length, 0), 45000);
});

test('progress is reported cumulatively', async () => {
  recordImportRequests();
  const seen = [];
  await existingDataAPI.importProduction({
    plant: 'GEX-01', rows: dieRows(4500), sourceFile: 'gex1.xlsx',
    onProgress: (done, total) => seen.push([done, total]),
  });

  assert.deepEqual(seen, [[2000, 4500], [4000, 4500], [4500, 4500]]);
});

test('an empty sheet is rejected before any request goes out', async () => {
  const sent = recordImportRequests();
  await assert.rejects(
    () => existingDataAPI.importDieDetails({ plant: 'GEX-01', rows: [], sourceFile: 'gex1.xlsx' }),
    /no rows/,
  );
  assert.equal(sent.length, 0);
});

test('matchDie sends the whole key as query parameters', async () => {
  let seenUrl = null;
  globalThis.fetch = async (url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ order: null, dieList: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  await existingDataAPI.matchDie({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.match(seenUrl, /\/existing-data\/die-match\?/);
  assert.match(seenUrl, /plant=GEX\+01/);
  assert.match(seenUrl, /profile=29663/);
  assert.match(seenUrl, /press=PRESS\+2/);
  assert.match(seenUrl, /cavity=2/);
});

test('matchDie passes both null sources through unchanged', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ order: null, dieList: null }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  const result = await existingDataAPI.matchDie({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.equal(result.order, null);
  assert.equal(result.dieList, null);
});

test('nextDieNumber sends plant, profile and press as query parameters', async () => {
  let seenUrl = null;
  globalThis.fetch = async (url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ dieNo: '29663-253', basis: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  await backupRequestsAPI.nextDieNumber({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.match(seenUrl, /\/backup-requests\/next-die-number\?/);
  assert.match(seenUrl, /plant=GEX\+01/);
  assert.match(seenUrl, /profile=29663/);
  assert.match(seenUrl, /press=PRESS\+2/);
});

test('nextDieNumber returns the proposal and its basis', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ dieNo: '29663-253', basis: { source: 'backup request', die_no: '29663-252' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  const result = await backupRequestsAPI.nextDieNumber({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-253');
  assert.equal(result.basis.die_no, '29663-252');
});
