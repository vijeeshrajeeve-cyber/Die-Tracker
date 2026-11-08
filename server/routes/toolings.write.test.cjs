'use strict';
process.env.JWT_SECRET = 'toolings-write-test-secret-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tooling-write-'));
process.env.TOOLING_FILES_ROOT = ROOT;
const FIXTURE = path.join(__dirname, '..', 'services', 'fixtures', 'tooling', 'dieshop-21599.dxf');

const TOOLING = { id: 7, number: 'I-21599', kind: 'insert', plant: 'GEX 1', held_presses: [], size_class: '175X80', cavities: 1, status: 'active' };
const queries = [];
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  const known = params[0] === TOOLING.number || params[0] === TOOLING.id;
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM toolings WHERE number = \$1/.test(sql)) return { rows: known ? [TOOLING] : [] };
  if (/^SELECT id, plant FROM toolings WHERE (number|id) = \$1/.test(sql)) return { rows: known ? [{ id: 7, plant: 'GEX 1' }] : [] };
  if (/^UPDATE toolings SET/.test(sql)) return { rows: known ? [{ ...TOOLING, location: params[1] }] : [], rowCount: known ? 1 : 0 };
  if (/^INSERT INTO toolings/.test(sql)) {
    return params[0] === TOOLING.number ? { rows: [], rowCount: 0 } : { rows: [{ id: 9, number: params[0], kind: params[1], plant: params[2] }], rowCount: 1 };
  }
  if (/^UPDATE tooling_openings/.test(sql)) return { rows: [{ id: 3, tooling_id: 7, confidence: 'confirmed', reviewed_by: params[1] }], rowCount: 1 };
  if (/^INSERT INTO tooling_drawings/.test(sql)) return { rows: [{ id: 55, tooling_id: 7, file_path: params[1], original_name: params[2], is_primary: true }], rowCount: 1 };
  if (/^INSERT INTO tooling_openings/.test(sql)) return { rows: [{ id: 3, tooling_id: 7, confidence: params[5], extraction_source: params[4] }], rowCount: 1 };
  // detail payload
  if (/FROM toolings t/.test(sql) && /WHERE t\.number = \$1/.test(sql)) return { rows: known ? [{ ...TOOLING, opening_confidence: 'confirmed' }] : [] };
  if (/FROM tooling_openings o WHERE o\.tooling_id/.test(sql)) return { rows: [{ id: 3, confidence: 'confirmed' }] };
  if (/FROM tooling_drawings WHERE tooling_id/.test(sql)) return { rows: [{ id: 55, original_name: 'I-21599.dxf', format: 'dxf' }] };
  if (/FROM die_tooling_links l\s+LEFT JOIN toolings/.test(sql)) {
    return { rows: [
      { tooling_number: 'I-21599', kind: 'insert', source: 'die-list', seen_at: '2026-11-01', t_number: 'I-21599', t_kind: 'insert', size_class: '175X80', status: 'active', location: 'RACK 1', opening_confidence: 'likely' },
      { tooling_number: 'BOL-9', kind: 'bolster', source: 'order-pdf', seen_at: '2026-11-02', t_number: null, t_kind: null, size_class: null, status: null, location: null, opening_confidence: null },
    ] };
  }
  if (/FROM die_tooling_links/.test(sql)) return { rows: [] };
  throw new Error(`unexpected query ${sql}`);
});

const router = require('./toolings.cjs');
let currentUser = { id: 12, role: 'user', canReviewToolings: true };
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/toolings', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); fs.rmSync(ROOT, { recursive: true, force: true }); });
test.beforeEach(() => { currentUser = { id: 12, role: 'user', canReviewToolings: true }; queries.length = 0; });

const upload = async (number, name, bytes) => {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const res = await fetch(`${base}/api/toolings/${encodeURIComponent(number)}/drawing`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
};

test('a plain user gets 403 on every write route and nothing is written', async () => {
  currentUser = { id: 13, role: 'user', canReviewToolings: false };
  const forbidden = { error: 'Tooling review permission required' };
  const calls = [
    request(base, '/api/toolings/I-21599', { method: 'PATCH', body: { location: 'X' } }),
    request(base, '/api/toolings/I-21599/opening/review', { body: { action: 'confirm' } }),
    request(base, '/api/toolings', { body: { number: 'I-30000', plant: 'GEX 1' } }),
    upload('I-21599', 'I-21599.dxf', fs.readFileSync(FIXTURE)),
  ];
  for (const res of await Promise.all(calls)) {
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, forbidden);
  }
  assert.deepEqual(queries, []);
});

test('PATCH edits the tooling; unknown fields and unknown numbers are refused', async () => {
  const ok = await request(base, '/api/toolings/I-21599', { method: 'PATCH', body: { location: 'RACK 9', sizeClass: '175 x 80' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tooling.location, 'RACK 9');
  const up = queries.find((q) => /^UPDATE toolings/.test(q.sql));
  assert.deepEqual(up.params, ['I-21599', 'RACK 9', '175X80']);

  const unknown = await request(base, '/api/toolings/I-21599', { method: 'PATCH', body: { plant: 'GEX 2' } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'Unknown fields: plant');
  const missing = await request(base, '/api/toolings/I-99999', { method: 'PATCH', body: { notes: 'x' } });
  assert.equal(missing.status, 404);
});

test('an admin passes the reviewer gate', async () => {
  currentUser = { id: 1, role: 'admin' };
  const ok = await request(base, '/api/toolings/I-21599', { method: 'PATCH', body: { status: 'retired' } });
  assert.equal(ok.status, 200);
});

test('POST opening/review confirms with the reviewer id; 404 for an unknown tooling', async () => {
  const ok = await request(base, '/api/toolings/I-21599/opening/review', { body: { action: 'confirm', note: 'ok' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.opening.confidence, 'confirmed');
  const up = queries.find((q) => /^UPDATE tooling_openings/.test(q.sql));
  assert.deepEqual(up.params, [7, 12, 'ok']);

  const bad = await request(base, '/api/toolings/I-21599/opening/review', { body: { action: 'correct', pockets: [] } });
  assert.equal(bad.status, 400);
  const missing = await request(base, '/api/toolings/I-99999/opening/review', { body: { action: 'confirm' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Tooling not found');
});

test('POST /api/toolings creates a manual tooling; a duplicate is 409', async () => {
  const ok = await request(base, '/api/toolings', { body: { number: 'i-30000', plant: 'GEX 1' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.tooling.number, 'I-30000');
  assert.equal(ok.body.tooling.kind, 'insert');
  const dup = await request(base, '/api/toolings', { body: { number: 'I-21599', plant: 'GEX 1' } });
  assert.equal(dup.status, 409);
  const bad = await request(base, '/api/toolings', { body: { number: 'nonsense', plant: 'GEX 1' } });
  assert.equal(bad.status, 400);
});

test('POST drawing stores the DXF, extracts the opening and answers with the detail payload', async () => {
  const bytes = fs.readFileSync(FIXTURE);
  const res = await upload('I-21599', 'I-21599.dxf', bytes);
  assert.equal(res.status, 200);
  assert.equal(res.body.tooling.number, 'I-21599');
  assert.equal(res.body.opening.confidence, 'confirmed');
  assert.equal(res.body.drawings[0].id, 55);
  assert.ok(Array.isArray(res.body.links));
  assert.equal(res.body.openingKept, false);
  const dIns = queries.find((q) => /^INSERT INTO tooling_drawings/.test(q.sql));
  const stored = path.join(ROOT, dIns.params[1]);
  assert.ok(fs.existsSync(stored), 'the file is on disk under the tooling root');
  assert.equal(fs.readFileSync(stored).length, bytes.length);
  const oIns = queries.find((q) => /^INSERT INTO tooling_openings/.test(q.sql));
  assert.equal(oIns.params[4], 'dxf');
  assert.equal(JSON.parse(oIns.params[2]).length, 1);
});

test('POST drawing refuses other file types, a missing file and an unknown tooling', async () => {
  const txt = await upload('I-21599', 'notes.txt', Buffer.from('hello'));
  assert.equal(txt.status, 400);
  assert.match(txt.body.error, /\.dxf|\.pdf/);
  const none = await fetch(`${base}/api/toolings/I-21599/drawing`, { method: 'POST', body: new FormData() });
  assert.equal(none.status, 400);
  const unknown = await upload('I-99999', 'a.dxf', fs.readFileSync(FIXTURE));
  assert.equal(unknown.status, 404);
});

test('GET for-die lists the links with their tooling, null when the master lacks it', async () => {
  const res = await request(base, '/api/toolings/for-die/21599-01?plant=GEX%2001');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.links, [
    { tooling_number: 'I-21599', kind: 'insert', source: 'die-list', seen_at: '2026-11-01',
      tooling: { number: 'I-21599', kind: 'insert', size_class: '175X80', status: 'active', location: 'RACK 1', opening_confidence: 'likely' } },
    { tooling_number: 'BOL-9', kind: 'bolster', source: 'order-pdf', seen_at: '2026-11-02', tooling: null },
  ]);
  const q = queries.find((x) => /FROM die_tooling_links l\s+LEFT JOIN toolings/.test(x.sql));
  assert.deepEqual(q.params, ['21599-01', 'GEX 1']);
  assert.match(q.sql, /translate\(l\.die_no, '_', '-'\) = translate\(\$1, '_', '-'\)/, '_ and - are the same separator');
  const all = await request(base, '/api/toolings/for-die/21599-01');
  assert.equal(all.status, 200);
  assert.deepEqual(queries.filter((x) => /LEFT JOIN toolings/.test(x.sql)).at(-1).params, ['21599-01', null]);
});
