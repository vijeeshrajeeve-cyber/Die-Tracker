'use strict';
process.env.JWT_SECRET = 'new-die-order-forms-test-secret-at-least-32-chars';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PDFDocument } = require('pdf-lib');
const { installFakeDb, listen } = require('./testSupport.cjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'new-die-order-forms-'));
const ROOT = path.join(TMP, 'tooling');
process.env.TOOLING_FILES_ROOT = ROOT;
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(TMP, 'outside.pdf'), '%PDF-1.4 outside');

// Users the mount's authMiddleware reads: an admin, a user without either page, a backup-requests user.
const USERS = {
  1: { id: 1, username: 'admin', role: 'admin', password_must_change: false, page_access: null },
  2: { id: 2, username: 'viewer', role: 'user', password_must_change: false, page_access: '["dashboard"]' },
  3: { id: 3, username: 'backup', role: 'user', password_must_change: false, page_access: '["backup-requests"]' },
};
const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

const STORED = [
  { id: 8, die_no: 'D-8', plant: 'GEX 1', form_pdf_path: 'new-die-orders/gex-1/D-8-1-form.pdf' },
  { id: 9, die_no: 'D-9', plant: 'GEX 1', form_pdf_path: '../outside.pdf' },
];
fs.mkdirSync(path.join(ROOT, 'new-die-orders', 'gex-1'), { recursive: true });
fs.writeFileSync(path.join(ROOT, STORED[0].form_pdf_path), '%PDF-1.4 stored form');

let failLinks = false;
const queries = [];
installFakeDb(async (sql, params = []) => {
  if (/FROM users WHERE id = \$1/.test(sql)) return { rows: USERS[params[0]] ? [USERS[params[0]]] : [] };
  queries.push({ sql, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  if (/^INSERT INTO new_die_order_forms/.test(sql)) return { rows: [{ id: 41, die_no: params[1] }], rowCount: 1 };
  if (/^INSERT INTO profile_shapes/.test(sql)) return { rows: [{ id: 77 }], rowCount: 1 };
  if (/^UPDATE new_die_order_forms/.test(sql)) return { rows: [{ id: 41, profile_shape_id: 77 }], rowCount: 1 };
  if (/^SELECT number FROM toolings WHERE number = ANY/.test(sql)) return { rows: [] };
  if (/^SELECT number, kind FROM toolings/.test(sql)) return { rows: [] };
  if (/^INSERT INTO toolings/.test(sql)) return { rows: [], rowCount: 1 };
  if (/^DELETE FROM die_tooling_links/.test(sql)) return { rows: [], rowCount: 0 };
  if (/^INSERT INTO die_tooling_links/.test(sql)) {
    if (failLinks) throw new Error('links failed');
    return { rows: [], rowCount: 1 };
  }
  if (/FROM new_die_order_forms WHERE id = \$1/.test(sql)) return { rows: STORED.filter((r) => r.id === params[0]) };
  if (/FROM new_die_order_forms/.test(sql)) return { rows: [{ id: 41, die_no: 'D-1', plant: 'GEX 1' }] };
  throw new Error(`unexpected query ${sql}`);
});

const { authMiddleware, pageAccessMiddleware } = require('./auth.cjs');
const router = require('./new-die-order-forms.cjs');
// As index.cjs mounts it.
const app = express();
app.use(express.json());
app.use('/api/new-die-order-forms', authMiddleware, pageAccessMiddleware(['orders', 'backup-requests']), router);
let base; let close;
let DRAWING;
test.before(async () => {
  ({ base, close } = await listen(app));
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  DRAWING = Buffer.from(await doc.save());
});
test.after(async () => { await close(); fs.rmSync(TMP, { recursive: true, force: true }); });
test.beforeEach(() => { queries.length = 0; failLinks = false; });

const VALUES = {
  PLANT: 'GEX 01', DIE_NO: '31234_001', PROFILE_NO: '31234', CUSTOMER: 'ACME', DIE_SIZE: '250X160', NO_OF_CAV: '2',
  PRESS: 'PRESS 5', INSERT_NO: 'I-99999', SUPPLIER: 'TEST', HOLLOW: true, SOLID: 'no', NOT_A_KEY: 'dropped',
};
const RING = Array.from({ length: 24 }, (_, i) => [Math.cos((i * Math.PI) / 12), Math.sin((i * Math.PI) / 12)]);
const FINDER = {
  chosen: { tooling: 'I-21599', kind: 'insert', fromFinder: true },
  candidates: Array.from({ length: 60 }, (_, i) => ({ number: `I-${i}`, score: i, pockets: [[1]], placements: [[2]] })),
  profile: {
    style: 'silhouette', outer_unit: RING, holes_unit: [], hole_count: 0, true_size: false, outer_mm: null, holes_mm: null,
    ccd_mm: null, true_size_source: null, true_size_confidence: null, needs_review: false, review_reason: null, signature: [9],
  },
};

const generate = async ({ token = tokenFor(1), values = VALUES, finder, file = DRAWING, raw } = {}) => {
  const form = new FormData();
  form.append('values', raw ?? JSON.stringify(values));
  if (finder !== undefined) form.append('finder', typeof finder === 'string' ? finder : JSON.stringify(finder));
  if (file) form.append('file', new Blob([file]), 'drawing.pdf');
  return fetch(`${base}/api/new-die-order-forms/generate`, {
    method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
};

const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const GEX1 = path.join(ROOT, 'new-die-orders', 'gex-1');
const newFiles = () => filesUnder(GEX1).filter((f) => f.startsWith('31234_001-'));

test('401 without a token, 403 without the orders or backup-requests page', async () => {
  const none = await generate({ token: null });
  assert.equal(none.status, 401);
  const viewer = await generate({ token: tokenFor(2) });
  assert.equal(viewer.status, 403);
  assert.deepEqual(await viewer.json(), { error: 'Page access required' });
  const list = await fetch(`${base}/api/new-die-order-forms`, { headers: { Authorization: `Bearer ${tokenFor(2)}` } });
  assert.equal(list.status, 403);
  assert.deepEqual(queries, []);
  assert.deepEqual(newFiles(), []);
});

test('400 without plant or die number, for a non-PDF, and for bad JSON', async () => {
  const noDie = await generate({ values: { ...VALUES, DIE_NO: ' ' } });
  assert.equal(noDie.status, 400);
  assert.match((await noDie.json()).error, /PLANT and DIE_NO/);
  const noPlant = await generate({ values: { ...VALUES, PLANT: '' } });
  assert.equal(noPlant.status, 400);
  const notPdf = await generate({ file: Buffer.from('GIF89a') });
  assert.equal(notPdf.status, 400);
  assert.match((await notPdf.json()).error, /PDF/);
  assert.equal((await generate({ file: null })).status, 400);
  assert.equal((await generate({ raw: '{nope' })).status, 400);
  assert.equal((await generate({ finder: '{nope' })).status, 400);
  const badShape = await generate({ finder: { ...FINDER, profile: { ...FINDER.profile, outer_unit: [[0, 0]] } } });
  assert.equal(badShape.status, 400);
  assert.deepEqual(queries, []);
  assert.deepEqual(newFiles(), []);
});

test('the stamped PDF comes back with X-Form-Id; both files land under the root; the form is recorded', async () => {
  const res = await generate({ token: tokenFor(3), finder: FINDER });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('x-form-id'), '41');
  assert.equal(res.headers.get('x-chosen-tooling'), 'I-21599');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="31234_001-die-order.pdf"');
  const pdf = Buffer.from(await res.arrayBuffer());
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > DRAWING.length, 'stamped, not the bare drawing');
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);

  const files = newFiles();
  assert.equal(files.length, 2);
  const drawingFile = files.find((f) => f.endsWith('-drawing.pdf'));
  const formFile = files.find((f) => f.endsWith('-form.pdf'));
  assert.deepEqual(fs.readFileSync(path.join(GEX1, drawingFile)), DRAWING);
  assert.deepEqual(fs.readFileSync(path.join(GEX1, formFile)), pdf);

  const form = queries.find((q) => /^INSERT INTO new_die_order_forms/.test(q.sql));
  assert.deepEqual(form.params.slice(0, 7), ['GEX 1', '31234_001', '31234', 'ACME', 'PRESS 5', '250X160', 2]);
  const values = JSON.parse(form.params[7]);
  assert.equal(values.NOT_A_KEY, undefined);
  assert.equal(values.HOLLOW, true);
  assert.equal(values.SOLID, false);
  assert.deepEqual(form.params.slice(8, 11), ['I-21599', 'insert', true]);
  const candidates = JSON.parse(form.params[11]);
  assert.equal(candidates.length, 50);
  assert.ok(candidates.every((c) => !('pockets' in c) && !('placements' in c)));
  assert.deepEqual(form.params.slice(12), [`new-die-orders/gex-1/${drawingFile}`, `new-die-orders/gex-1/${formFile}`, 3]);

  const shape = queries.find((q) => /^INSERT INTO profile_shapes/.test(q.sql));
  assert.deepEqual(shape.params.slice(3, 7), [
    'profile-drawing', '41', crypto.createHash('sha256').update(DRAWING).digest('hex'), `new-die-orders/gex-1/${drawingFile}`,
  ]);
  assert.notDeepEqual(JSON.parse(shape.params[10]), [9], 'the client signature is not trusted');
  assert.equal(shape.params[13], 'Hollow');
  const tooling = queries.find((q) => /^INSERT INTO toolings/.test(q.sql));
  assert.deepEqual(tooling.params, ['I-99999', 'insert', 'GEX 1']);
  assert.ok(queries.some((q) => q.sql === 'COMMIT'));
});

test('without a finder the form records no choice and no shape', async () => {
  const res = await generate({ values: { PLANT: 'GEX 2', DIE_NO: 'NEW 1' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-chosen-tooling'), '');
  await res.arrayBuffer();
  const form = queries.find((q) => /^INSERT INTO new_die_order_forms/.test(q.sql));
  assert.deepEqual(form.params.slice(8, 12), [null, null, false, null]);
  assert.ok(!queries.some((q) => /profile_shapes/.test(q.sql)));
  assert.equal(filesUnder(path.join(ROOT, 'new-die-orders', 'gex-2')).length, 2);
});

test('a record failure removes both files', async () => {
  failLinks = true;
  const before = newFiles();
  const realError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  let res;
  try { res = await generate(); } finally { console.error = realError; }
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Failed to record the die order form' });
  assert.equal(logged.length, 1);
  assert.ok(queries.some((q) => q.sql === 'ROLLBACK'));
  assert.deepEqual(newFiles(), before, 'no orphan files');
});

test('list leaves out the values and candidates unless full=1', async () => {
  const auth = { headers: { Authorization: `Bearer ${tokenFor(1)}` } };
  const res = await fetch(`${base}/api/new-die-order-forms?dieNo=D-1&plant=GEX%2001&limit=500`, auth);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items: [{ id: 41, die_no: 'D-1', plant: 'GEX 1' }] });
  const q = queries.find((x) => /FROM new_die_order_forms/.test(x.sql));
  assert.doesNotMatch(q.sql, /form_values|candidates/);
  assert.deepEqual(q.params, ['D-1', 'GEX 1', 200]);
  queries.length = 0;
  await (await fetch(`${base}/api/new-die-order-forms?full=1`, auth)).json();
  const full = queries.find((x) => /FROM new_die_order_forms/.test(x.sql));
  assert.match(full.sql, /form_values/);
  assert.match(full.sql, /candidates/);
  assert.deepEqual(full.params, [null, null, 50]);
});

test('pdf downloads the stored form, root-bounded', async () => {
  const auth = { headers: { Authorization: `Bearer ${tokenFor(1)}` } };
  const ok = await fetch(`${base}/api/new-die-order-forms/8/pdf`, auth);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-disposition'), /D-8-die-order\.pdf/);
  assert.equal(await ok.text(), '%PDF-1.4 stored form');
  assert.equal((await fetch(`${base}/api/new-die-order-forms/9/pdf`, auth)).status, 404, 'outside the root');
  assert.equal((await fetch(`${base}/api/new-die-order-forms/5/pdf`, auth)).status, 404);
  assert.equal((await fetch(`${base}/api/new-die-order-forms/x/pdf`, auth)).status, 404);
});
