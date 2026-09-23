import test from 'node:test';
import assert from 'node:assert/strict';

// api.js reads the token out of localStorage on every request, so it needs a
// stub before the module is imported.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { frozenDesignsAPI, existingDataAPI, backupRequestsAPI, qualityDiscrepanciesAPI, ordersAPI, usersAPI, authAPI } = await import('./api.js');

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

// Callers branch on the status, e.g. a 409 means "someone else changed this,
// reload" rather than a plain failure. The message alone cannot tell them that.
test('a failed request carries its HTTP status and parsed body', async () => {
  respondWith(JSON.stringify({ error: 'This item changed.', version: 4 }), 409);
  await assert.rejects(frozenDesignsAPI.match(KEY), (error) => {
    assert.equal(error.message, 'This item changed.');
    assert.equal(error.status, 409);
    assert.deepEqual(error.data, { error: 'This item changed.', version: 4 });
    return true;
  });
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

// The import posts the PDF and the admin's fields in one multipart request.
// Blank values are left out, so the server sees "not given", never "".
test('importExisting posts the PDF and the filled fields as multipart, skipping blanks', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ id: 9 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const file = new File(['%PDF-1.4'], 'old.pdf', { type: 'application/pdf' });
  const res = await qualityDiscrepanciesAPI.importExisting(file, {
    qdNo: '2026PH-04', plant: 'GEX 1', etaDate: '', preparedBy: null,
  });
  assert.equal(res.id, 9);
  assert.match(seen.url, /\/quality-discrepancies\/import$/);
  assert.equal(seen.options.method, 'POST');
  assert.ok(seen.options.body instanceof FormData);
  assert.equal(seen.options.body.get('qdNo'), '2026PH-04');
  assert.equal(seen.options.body.get('file').name, 'old.pdf');
  assert.equal(seen.options.body.has('etaDate'), false);
  assert.equal(seen.options.body.has('preparedBy'), false);
  // The browser must set the multipart boundary itself.
  assert.equal(seen.options.headers['Content-Type'], undefined);
});

test('qdNoExists and undoImport hit their endpoints', async () => {
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(`${options?.method || 'GET'} ${url}`);
    return new Response(JSON.stringify({ exists: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.deepEqual(await qualityDiscrepanciesAPI.qdNoExists('2026PH-04'), { exists: true });
  await qualityDiscrepanciesAPI.undoImport(61);
  assert.match(urls[0], /^GET .*\/quality-discrepancies\/exists\?qdNo=2026PH-04$/);
  assert.match(urls[1], /^DELETE .*\/quality-discrepancies\/61\/import$/);
});

test('patchDetails sends only the fields, the reason and any ETA cause', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ order: { id: 7 }, logged: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const res = await ordersAPI.patchDetails(7, { fields: { Supplier: 'BETA' }, reason: 'Re-quoted' });
  assert.equal(res.logged, 1);
  assert.match(seen.url, /\/orders\/7\/details$/);
  assert.equal(seen.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(seen.options.body), { fields: { Supplier: 'BETA' }, reason: 'Re-quoted' });
});

test('uploadFile posts the PDF and the reason to the slot as multipart', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ file: { id: 31 } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const file = new File(['%PDF-1.4'], 'rev B.pdf', { type: 'application/pdf' });
  const res = await ordersAPI.uploadFile(7, 'design_pdf', file, 'Supplier sent rev B');
  assert.equal(res.file.id, 31);
  assert.match(seen.url, /\/orders\/7\/files\/design_pdf$/);
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.body.get('file').name, 'rev B.pdf');
  assert.equal(seen.options.body.get('reason'), 'Supplier sent rev B');
  assert.equal(seen.options.headers['Content-Type'], undefined);

  await ordersAPI.uploadFile(7, 'die_order_form', file, '');
  assert.equal(seen.options.body.has('reason'), false);
});

test('listFiles and fileBlob read the order\'s attachments', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return url.endsWith('/files')
      ? new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('%PDF-1.4', { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  };
  assert.deepEqual(await ordersAPI.listFiles(7), { files: [] });
  const blob = await ordersAPI.fileBlob(7, 31);
  assert.equal(await blob.text(), '%PDF-1.4');
  assert.match(urls[0], /\/orders\/7\/files$/);
  assert.match(urls[1], /\/orders\/7\/files\/31$/);

  globalThis.fetch = async () => new Response('', { status: 404 });
  await assert.rejects(ordersAPI.fileBlob(7, 31), /HTTP 404/);
});

test('a refused order save carries the server code for the drawer to branch on', async () => {
  respondWith(JSON.stringify({ error: 'You do not have permission to edit order details', code: 'ORDER_EDIT_FORBIDDEN' }), 403);
  await assert.rejects(ordersAPI.patchDetails(7, { fields: { Supplier: 'BETA' } }), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.data.code, 'ORDER_EDIT_FORBIDDEN');
    return true;
  });
});

test('the users API sends the order details switch on create and update', async () => {
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ user: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await usersAPI.create('ravi', 'Start-pass-1', 'user', null, null, null, null, true);
  await usersAPI.update(7, { canEditOrderDetails: false });
  await usersAPI.update(7, { email: '' });
  assert.equal(bodies[0].can_edit_order_details, true);
  assert.deepEqual(bodies[1], { can_edit_order_details: false });
  assert.equal('can_edit_order_details' in bodies[2], false);
});

test('refreshUser stores the latest profile over the one sign-in saved', async () => {
  const saved = {};
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (key === 'user' ? JSON.stringify({ id: 3, username: 'ravi', canEditOrderDetails: false }) : null),
    setItem: (key, value) => { saved[key] = value; },
    removeItem: () => {},
  };
  try {
    respondWith(JSON.stringify({ user: { id: 3, username: 'ravi', role: 'user', canEditOrderDetails: true } }));
    const user = await authAPI.refreshUser();
    assert.equal(user.canEditOrderDetails, true);
    assert.equal(JSON.parse(saved.user).canEditOrderDetails, true);
  } finally {
    globalThis.localStorage = original;
  }
});
