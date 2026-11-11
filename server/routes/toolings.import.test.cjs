'use strict';
process.env.JWT_SECRET = 'toolings-import-test-secret-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tooling-import-'));
process.env.TOOLING_FILES_ROOT = ROOT;
const FIXTURE = path.join(__dirname, '..', 'services', 'fixtures', 'tooling', 'dieshop-21599.dxf');

const table = new Map();
const queries = [];
const reset = () => {
  table.clear();
  table.set('I-21599', { id: 7, number: 'I-21599', kind: 'insert', plant: 'GEX 1', size_class: null, cavities: null, location: null, notes: null, status: 'active' });
  queries.length = 0;
};
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  if (/^SELECT id, number, kind, plant, size_class/.test(sql)) return { rows: params[0].filter((n) => table.has(n)).map((n) => ({ ...table.get(n) })) };
  if (/^SELECT \* FROM toolings WHERE number = \$1/.test(sql)) return { rows: table.has(params[0]) ? [{ ...table.get(params[0]) }] : [] };
  if (/^INSERT INTO toolings/.test(sql)) {
    if (table.has(params[0])) return { rows: [], rowCount: 0 };
    const row = { id: 50 + table.size, number: params[0], kind: params[1], plant: params[2], size_class: params[3], cavities: params[6], status: 'active' };
    table.set(row.number, row);
    return { rows: [row], rowCount: 1 };
  }
  if (/^UPDATE toolings SET/.test(sql)) return { rows: [], rowCount: 1 };
  if (/^INSERT INTO tooling_drawings/.test(sql)) return { rows: [{ id: 55, tooling_id: params[0], file_path: params[1] }], rowCount: 1 };
  if (/^INSERT INTO tooling_openings/.test(sql)) return { rows: [{ id: 3, confidence: params[5] }], rowCount: 1 };
  throw new Error(`unexpected query ${sql}`);
});

const router = require('./toolings.cjs');
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/toolings', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); fs.rmSync(ROOT, { recursive: true, force: true }); });
test.beforeEach(() => { currentUser = { id: 12, role: 'user', canReviewToolings: true }; reset(); });

const sendDrawing = async (name, fields = {}) => {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(FIXTURE)]), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const res = await fetch(`${base}/api/toolings/import/drawing`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
};

test('the import routes are for tooling reviewers only', async () => {
  currentUser = { id: 13, role: 'user', canReviewToolings: false };
  const calls = [
    request(base, '/api/toolings/import/plan', { body: { rows: [{ number: 'I-40000' }] } }),
    request(base, '/api/toolings/import/rows', { body: { rows: [{ number: 'I-40000' }] } }),
    sendDrawing('21599-Ins.dxf'),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.status, 403);
  assert.deepEqual(queries, []);
});

test('plan previews rows and drawing names together and writes nothing', async () => {
  const res = await request(base, '/api/toolings/import/plan', { body: {
    rows: [{ number: 'I-40000', sizeClass: '300x100' }, { number: 'I-21599', location: 'Rack 4' }, { number: '??' }],
    files: ['INS-40000.dxf', '21599.dxf', 'INS-41000.pdf', 'x.dwg'],
    bareNumbers: 'insert',
  } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows.map((r) => r.action), ['create', 'fill', 'error']);
  assert.deepEqual(res.body.files.map((f) => [f.state, f.number || null]),
    [['attach', 'I-40000'], ['attach', 'I-21599'], ['new', 'I-41000'], ['convert', null]]);
  assert.ok(queries.every((q) => /^SELECT/.test(q.sql)));
  const tooMany = await request(base, '/api/toolings/import/plan', { body: { rows: new Array(501).fill({ number: 'I-1' }) } });
  assert.equal(tooMany.status, 400);
});

test('rows are applied and answered one by one', async () => {
  const res = await request(base, '/api/toolings/import/rows', { body: { rows: [{ number: 'I-40000' }, { number: 'I-21599', location: 'Rack 4' }, { number: 'BOL-9' }] } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results.map((r) => r.action), ['create', 'fill', 'error']);
  assert.match(res.body.results[2].message, /plant is needed/);
  assert.ok(table.has('I-40000'));
});

test('a drawing is filed by its name; "import" is not taken for a tooling number', async () => {
  const ok = await sendDrawing('21599-Ins.dxf');
  assert.equal(ok.status, 200);
  assert.deepEqual({ number: ok.body.number, created: ok.body.created, basis: ok.body.basis, extracted: ok.body.extracted },
    { number: 'I-21599', created: false, basis: 'file-name', extracted: 'confirmed' });
  assert.deepEqual(ok.body.filled, ['size class 175X80', 'cavities 1']);

  const missing = await sendDrawing('INS-41000.dxf');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'I-41000 is not in the tooling master' });
  const added = await sendDrawing('INS-41000.dxf', { createMissing: 'true' });
  assert.equal(added.status, 200);
  assert.equal(added.body.created, true);

  const byText = await sendDrawing('scan0042.dxf');
  assert.equal(byText.body.basis, 'drawing-text');
  assert.equal(byText.body.number, 'I-21599');
  const wrongType = await sendDrawing('21599.tif');
  assert.equal(wrongType.status, 400);
});
