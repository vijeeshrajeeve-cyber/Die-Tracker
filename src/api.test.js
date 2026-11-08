import test from 'node:test';
import assert from 'node:assert/strict';

// api.js reads the token out of localStorage on every request, so it needs a
// stub before the module is imported.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { toolingsAPI, profileShapesAPI, newDieOrderFormsAPI, frozenDesignsAPI, existingDataAPI, backupRequestsAPI, qualityDiscrepanciesAPI, searchAPI, ordersAPI, usersAPI, authAPI } = await import('./api.js');

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

test('searchAPI.query encodes the query and passes the abort signal through', async () => {
  let seen;
  globalThis.fetch = async (url, options) => { seen = { url, options }; return new Response('{"orders":{"items":[],"total":0}}', { status: 200 }); };
  const controller = new AbortController();
  const body = await searchAPI.query('QD-25/031 & 50%', { signal: controller.signal });
  assert.equal(seen.url, '/api/search?q=QD-25%2F031%20%26%2050%25');
  assert.equal(seen.options.signal, controller.signal);
  assert.deepEqual(body, { orders: { items: [], total: 0 } });
});

test('searchAPI.qd fetches one QD by id', async () => {
  let seenUrl;
  globalThis.fetch = async (url) => { seenUrl = url; return new Response('{"id":5}', { status: 200 }); };
  assert.equal((await searchAPI.qd(5)).id, 5);
  assert.equal(seenUrl, '/api/search/qd/5');
});

test('toolingsAPI.get encodes the tooling number and list drops empty params', async () => {
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('{"items":[],"total":0}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  await toolingsAPI.get('BOL-4-6-A');
  await toolingsAPI.list({ plant: 'GEX 2', kind: '', press: undefined });
  assert.ok(urls[0].endsWith('/toolings/BOL-4-6-A'));
  assert.ok(urls[1].endsWith('/toolings?plant=GEX+2'));
});

test('toolingsAPI.reviewQueue and downloadDrawing hit the right paths', async () => {
  const calls = [];
  const blob = new Blob(['0\nSECTION']);
  const realFetch = globalThis.fetch;
  const realStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k === 'token' ? 'tok123' : null), setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), auth: opts.headers && opts.headers.Authorization });
    if (String(url).includes('/drawings/9/')) return new Response('nope', { status: 404 });
    if (String(url).includes('/drawings/')) return new Response(blob, { status: 200 });
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await toolingsAPI.reviewQueue({ plant: 'GEX 2', kind: '', limit: 5 });
    assert.ok(calls[0].url.endsWith('/toolings/review-queue?plant=GEX+2&limit=5'));
    const out = await toolingsAPI.downloadDrawing('BOL-4/6', 7);
    assert.ok(calls[1].url.endsWith('/toolings/BOL-4%2F6/drawings/7/file'));
    assert.equal(calls[1].auth, 'Bearer tok123');
    assert.equal(await out.text(), '0\nSECTION');
    await assert.rejects(() => toolingsAPI.downloadDrawing('BOL-1', 9), /404/);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realStorage;
  }
});

// The PDF import sends the drawing's scale and title-block numbers beside the profile PNG,
// so the server can size the traced shape. Blank values are left out.
test('uploadProfileImage sends the drawing meta as form fields beside the PNG', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ file: { id: 3 } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
  await ordersAPI.uploadProfileImage(7, blob, '30533_201_profile.png', {
    renderDpi: 200, scales: [1, 1 / 3], ccdStated: 183.2, externalPerimeter: null, internalPerimeter: '', cavities: 2, dieSize: 'DIA320X160',
  });
  assert.match(seen.url, /\/orders\/7\/profile-image$/);
  const form = seen.options.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('file').name, '30533_201_profile.png');
  assert.equal(form.get('renderDpi'), '200');
  assert.deepEqual(JSON.parse(form.get('scales')), [1, 1 / 3]);
  assert.equal(form.get('ccdStated'), '183.2');
  assert.equal(form.get('cavities'), '2');
  assert.equal(form.get('dieSize'), 'DIA320X160');
  assert.equal(form.has('externalPerimeter'), false);
  assert.equal(form.has('internalPerimeter'), false);
});

test('uploadProfileImage without meta sends only the PNG', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ kept: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
  assert.deepEqual(await ordersAPI.uploadProfileImage(7, blob, 'p.png'), { kept: true });
  assert.deepEqual([...seen.options.body.keys()], ['file']);
});

test('profileShapesAPI encodes die numbers and plants, and posts the polygon', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await profileShapesAPI.forDie('110634_25-01', 'GEX 1');
  assert.ok(calls[0].url.endsWith('/profile-shapes/110634_25-01?plant=GEX+1'));
  assert.equal(calls[0].method, 'GET');
  await profileShapesAPI.similar('A/B 1', { plant: 'GEX 2', limit: 5 });
  assert.ok(calls[1].url.endsWith('/profile-shapes/A%2FB%201/similar?plant=GEX+2&limit=5'));
  await profileShapesAPI.similar('D1', { plant: 'GEX 1' });
  assert.ok(calls[2].url.endsWith('/profile-shapes/D1/similar?plant=GEX+1'), 'no limit when none is given');
  const outer = [[0, 0], [10, 0], [10, 10]];
  await profileShapesAPI.similarTo({ plant: 'GEX 1', outer, holes: [], cavities: 2, limit: 10 });
  assert.ok(calls[3].url.endsWith('/profile-shapes/similar'));
  assert.equal(calls[3].method, 'POST');
  assert.deepEqual(JSON.parse(calls[3].body), { plant: 'GEX 1', outer, holes: [], cavities: 2, limit: 10 });
});

test('toolingsAPI.find posts the query as JSON to /toolings/find', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify({ candidates: [], similar: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const body = { plant: 'GEX 1', press: 'P25', dieSize: '250X200', cavities: 2, profile: { outer: [[0, 0], [10, 0], [0, 10]] } };
    const out = await toolingsAPI.find(body);
    assert.deepEqual(out, { candidates: [], similar: [] });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/toolings/find'));
    assert.equal(calls[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].opts.body), body);
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('toolingsAPI write calls and profileShapesAPI.review hit the right paths with the right bodies', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body, headers: options.headers || {} });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await toolingsAPI.update('BOL-4/6', { location: 'RACK 2' });
  assert.ok(calls[0].url.endsWith('/toolings/BOL-4%2F6'));
  assert.equal(calls[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].body), { location: 'RACK 2' });

  await toolingsAPI.reviewOpening('I-21599', { action: 'confirm', note: 'ok' });
  assert.ok(calls[1].url.endsWith('/toolings/I-21599/opening/review'));
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body), { action: 'confirm', note: 'ok' });

  await toolingsAPI.create({ number: 'I-30000', plant: 'GEX 1' });
  assert.ok(calls[2].url.endsWith('/toolings'));
  assert.equal(calls[2].method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].body), { number: 'I-30000', plant: 'GEX 1' });

  const file = new File(['0\nSECTION'], 'I-21599.dxf');
  await toolingsAPI.uploadDrawing('I-21599', file);
  assert.ok(calls[3].url.endsWith('/toolings/I-21599/drawing'));
  assert.equal(calls[3].method, 'POST');
  assert.ok(calls[3].body instanceof FormData);
  assert.equal(calls[3].body.get('file').name, 'I-21599.dxf');
  assert.equal(calls[3].headers['Content-Type'], undefined, 'the browser sets the multipart boundary');

  await toolingsAPI.forDie('110634_25-01', 'GEX 2');
  assert.ok(calls[4].url.endsWith('/toolings/for-die/110634_25-01?plant=GEX+2'));
  await toolingsAPI.forDie('A/1');
  assert.ok(calls[5].url.endsWith('/toolings/for-die/A%2F1'), 'no plant when none is given');

  await profileShapesAPI.review(4, { action: 'clear', note: 'fine' });
  assert.ok(calls[6].url.endsWith('/profile-shapes/4/review'));
  assert.equal(calls[6].method, 'POST');
  assert.deepEqual(JSON.parse(calls[6].body), { action: 'clear', note: 'fine' });
});

test('profileShapesAPI.trace posts the PNG and each meta field, scales as JSON', async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url: String(url), options };
    return new Response(JSON.stringify({ true_size: false, outer_mm: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    const out = await profileShapesAPI.trace(blob, { plant: 'GEX 1', dieNo: 'D-1', renderDpi: 200, scales: [1, 0.5], ccdStated: null, dieType: '' });
    assert.deepEqual(out, { true_size: false, outer_mm: null });
    assert.ok(seen.url.endsWith('/profile-shapes/trace'));
    assert.equal(seen.options.method, 'POST');
    const form = seen.options.body;
    assert.ok(form instanceof FormData);
    assert.ok(form.get('file') instanceof Blob);
    assert.equal(form.get('plant'), 'GEX 1');
    assert.equal(form.get('dieNo'), 'D-1');
    assert.equal(form.get('renderDpi'), '200');
    assert.deepEqual(JSON.parse(form.get('scales')), [1, 0.5]);
    assert.equal(form.has('ccdStated'), false);
    assert.equal(form.has('dieType'), false);
    assert.equal(seen.options.headers['Content-Type'], undefined, 'the browser sets the multipart boundary');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('newDieOrderFormsAPI.generate posts the drawing, values and finder and reads the headers', async () => {
  const realFetch = globalThis.fetch;
  const realStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k === 'token' ? 'tok123' : null), setItem: () => {}, removeItem: () => {} };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 2) return new Response(JSON.stringify({ error: 'PLANT and DIE_NO are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    return new Response(new Blob(['%PDF-stamped']), { status: 200, headers: { 'Content-Type': 'application/pdf', 'X-Form-Id': '41', 'X-Chosen-Tooling': 'BOL-4%2F6' } });
  };
  try {
    const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const values = { PLANT: 'GEX 1', DIE_NO: 'D-1' };
    const finder = { chosen: { tooling: 'BOL-4/6', kind: 'bolster', fromFinder: true }, candidates: [], profile: null };
    const out = await newDieOrderFormsAPI.generate(pdf, values, finder);
    assert.equal(out.formId, 41);
    assert.equal(out.chosenTooling, 'BOL-4/6');
    assert.equal(await out.blob.text(), '%PDF-stamped');
    assert.ok(calls[0].url.endsWith('/new-die-order-forms/generate'));
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer tok123');
    const form = calls[0].options.body;
    assert.deepEqual(JSON.parse(form.get('values')), values);
    assert.deepEqual(JSON.parse(form.get('finder')), finder);
    assert.ok(form.get('file') instanceof Blob);
    await assert.rejects(() => newDieOrderFormsAPI.generate(pdf, {}, null), /PLANT and DIE_NO are required/);
    assert.equal(calls[1].options.body.has('finder'), false);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realStorage;
  }
});

test('newDieOrderFormsAPI.list drops empty params and pdfBlob fetches with the Bearer header', async () => {
  const realFetch = globalThis.fetch;
  const realStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k === 'token' ? 'tok123' : null), setItem: () => {}, removeItem: () => {} };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), auth: options.headers && options.headers.Authorization });
    if (String(url).includes('/9/pdf')) return new Response('nope', { status: 404 });
    if (String(url).includes('/pdf')) return new Response(new Blob(['%PDF-form']), { status: 200 });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await newDieOrderFormsAPI.list({ dieNo: 'D 1', plant: 'GEX 1', limit: '' }), { items: [] });
    assert.ok(calls[0].url.endsWith('/new-die-order-forms?dieNo=D+1&plant=GEX+1'));
    await newDieOrderFormsAPI.list();
    assert.ok(calls[1].url.endsWith('/new-die-order-forms'));
    const blob = await newDieOrderFormsAPI.pdfBlob(7);
    assert.ok(calls[2].url.endsWith('/new-die-order-forms/7/pdf'));
    assert.equal(calls[2].auth, 'Bearer tok123');
    assert.equal(await blob.text(), '%PDF-form');
    await assert.rejects(() => newDieOrderFormsAPI.pdfBlob(9), /404/);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realStorage;
  }
});

test('profileShapesAPI.reviewQueue and image hit the right paths with the Bearer header', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  const realStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k === 'token' ? 'tok123' : null), setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), auth: opts.headers && opts.headers.Authorization });
    if (String(url).includes('/image/8')) return new Response('nope', { status: 404 });
    if (String(url).includes('/image/')) return new Response(new Blob(['PNG']), { status: 200 });
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await profileShapesAPI.reviewQueue({ plant: 'GEX 1', limit: 50, offset: 0, kind: '' });
    assert.ok(calls[0].url.endsWith('/profile-shapes/review-queue?plant=GEX+1&limit=50&offset=0'));
    const blob = await profileShapesAPI.image('A/B', 7, 'GEX 2');
    assert.ok(calls[1].url.endsWith('/profile-shapes/A%2FB/image/7?plant=GEX+2'));
    assert.equal(calls[1].auth, 'Bearer tok123');
    assert.equal(await blob.text(), 'PNG');
    await profileShapesAPI.image('D', 7);
    assert.ok(calls[2].url.endsWith('/profile-shapes/D/image/7'), 'no plant, no query');
    await assert.rejects(() => profileShapesAPI.image('D', 8), /404/);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realStorage;
  }
});
