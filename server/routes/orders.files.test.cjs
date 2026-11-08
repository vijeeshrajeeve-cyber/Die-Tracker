'use strict';
// orders.cjs loads auth.cjs for adminMiddleware, and auth.cjs warns when this
// is unset.
process.env.JWT_SECRET = 'orders-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createCanvas } = require('@napi-rs/canvas');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'order-files-'));
process.env.ORDER_FILES_ROOT = root;

// The order the next request finds (null: no such order), the slot's current
// file (null: none yet), and the stored file rows the read routes see.
let stored;
let current;
let rows;
let log = [];
let dieListCcd; // the die list's ProfileCCD for the order's die (undefined: no die list row)
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT id, die_no, status(, plant, die_type, die_size, cavity)? FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: stored ? [stored] : [] };
  if (/^SELECT raw_data->>'ProfileCCD' AS ccd FROM existing_die_details WHERE die_no = \$1 AND plant = ANY\(\$2\)/.test(q)) {
    return { rows: dieListCcd === undefined ? [] : [{ ccd: dieListCcd }] };
  }
  if (/^INSERT INTO profile_shapes/.test(q)) return { rows: [{ inserted: true }], rowCount: 1 };
  if (/^SELECT created_by FROM die_orders WHERE id = \$1/.test(q)) return { rows: stored ? [stored] : [] };
  if (/^SELECT id, original_name FROM die_order_files WHERE order_id = \$1 AND slot = \$2 AND replaced_at IS NULL FOR UPDATE/.test(q)) {
    return { rows: current ? [current] : [] };
  }
  if (/^UPDATE die_order_files SET replaced_at = CURRENT_TIMESTAMP WHERE id = \$1/.test(q)) return { rows: [], rowCount: 1 };
  if (/^INSERT INTO die_order_files/.test(q)) {
    return { rows: [{ id: 31, slot: params[1], original_name: params[2], size_bytes: params[5], uploaded_at: '2026-09-23T10:00:00.000Z' }] };
  }
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  if (/^SELECT f\.id, f\.slot/.test(q)) return { rows };
  if (/^SELECT stored_path, original_name FROM die_order_files WHERE id = \$1 AND order_id = \$2/.test(q)) {
    return { rows: rows.filter((r) => String(r.id) === params[0] && String(r.order_id) === params[1]) };
  }
  if (/^SELECT stored_path FROM die_order_files WHERE order_id = \$1/.test(q)) {
    return { rows: rows.filter((r) => String(r.order_id) === params[0]) };
  }
  if (/^DELETE FROM die_orders WHERE id = \$1/.test(q)) return { rows: [], rowCount: stored ? 1 : 0 };
  throw new Error(`order files test: unexpected query ${q}`);
});

const ordersRouter = require('./orders.cjs');

const EDITOR = { id: 5, username: 'planner', role: 'user', canEditOrderDetails: true };
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/orders', ordersRouter);

let base;
let close;
// The profile-image route warns when it cannot trace the picture; collect instead of printing.
let warnings = [];
const realWarn = console.warn;
test.before(() => { console.warn = (...args) => warnings.push(args.join(' ')); });
test.after(() => { console.warn = realWarn; });
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => {
  await close();
  fs.rmSync(root, { recursive: true, force: true });
});
test.beforeEach(() => {
  log = [];
  currentUser = EDITOR;
  stored = { id: 7, die_no: '30533_201', status: 'PENDING FOR DESIGN APPROVAL' };
  current = null;
  rows = [];
  dieListCcd = undefined;
  warnings = [];
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
});

const PDF = '%PDF-1.4 test';

async function upload(slot, { name = 'form.pdf', content = PDF, reason, file = true } = {}) {
  const form = new FormData();
  if (file) form.append('file', new Blob([content], { type: 'application/pdf' }), name);
  if (reason !== undefined) form.append('reason', reason);
  const response = await fetch(`${base}/api/orders/7/files/${slot}`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() };
}

const queries = (prefix) => log.filter(({ q }) => q.startsWith(prefix));
// order_changes columns: order_id, user_id, changed_by_name, changed_at,
// field_name, old_value, new_value, reason, stage.
const logged = () => queries('INSERT INTO order_changes').map(({ params }) => ({
  field: params[4], old: params[5], new: params[6], reason: params[7], stage: params[8], by: params[2],
}));

// Every file under the storage root, as root-relative paths with / separators.
function filesOnDisk() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

test('someone without the switch is refused before anything is read or written', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status, body } = await upload('die_order_form');
  assert.equal(status, 403);
  assert.equal(body.code, 'ORDER_EDIT_FORBIDDEN');
  assert.equal(log.length, 0);
  assert.deepEqual(filesOnDisk(), []);
});

test('an unknown slot is refused before anything is read or written', async () => {
  const { status } = await upload('signature');
  assert.equal(status, 404);
  assert.equal(log.length, 0);
  assert.deepEqual(filesOnDisk(), []);
});

test('only a PDF is accepted', async () => {
  const { status, body } = await upload('design_pdf', { name: 'design.dwg' });
  assert.equal(status, 400);
  assert.match(body.error, /PDF/);
  assert.equal(log.length, 0);
  assert.deepEqual(filesOnDisk(), []);
});

test('an upload without a file is refused', async () => {
  const { status, body } = await upload('design_pdf', { file: false });
  assert.equal(status, 400);
  assert.match(body.error, /Choose a PDF/);
  assert.equal(log.length, 0);
});

test('the first file for a slot is stored, recorded and logged without a reason', async () => {
  const { status, body } = await upload('die_order_form', { name: 'Order form.pdf' });
  assert.equal(status, 201, JSON.stringify(body));

  const onDisk = filesOnDisk();
  assert.equal(onDisk.length, 1);
  assert.match(onDisk[0], /^30533_201\/7\/die_order_form\/\d+_Order_form\.pdf$/);
  assert.equal(fs.readFileSync(path.join(root, onDisk[0]), 'utf8'), PDF);

  const [insert] = queries('INSERT INTO die_order_files');
  assert.deepEqual(insert.params, ['7', 'die_order_form', 'Order form.pdf', path.join(...onDisk[0].split('/')), 'application/pdf', PDF.length, 5]);
  assert.equal(queries('UPDATE die_order_files').length, 0);
  assert.deepEqual(logged(), [
    { field: 'Die Order Form', old: null, new: 'Order form.pdf', reason: null, stage: 'PENDING FOR DESIGN APPROVAL', by: 'planner' },
  ]);
  assert.equal(log.at(-1).q, 'COMMIT');
  assert.deepEqual(body.file, {
    id: 31, slot: 'die_order_form', original_name: 'Order form.pdf', size_bytes: PDF.length,
    uploaded_at: '2026-09-23T10:00:00.000Z', uploaded_by: 'planner',
  });
});

test('replacing a file without a reason is refused and leaves nothing behind', async () => {
  current = { id: 12, original_name: 'old.pdf' };
  const { status, body } = await upload('design_pdf', { name: 'new.pdf' });
  assert.equal(status, 400);
  assert.equal(body.code, 'REASON_REQUIRED');
  assert.deepEqual(body.fields, ['Die Design PDF']);
  assert.equal(queries('INSERT INTO die_order_files').length, 0);
  assert.equal(log.at(-1).q, 'ROLLBACK');
  assert.deepEqual(filesOnDisk(), []);
});

test('replacing a file with a reason supersedes the old row and logs both names', async () => {
  current = { id: 12, original_name: 'old.pdf' };
  const { status, body } = await upload('design_pdf', { name: 'new.pdf', reason: '  Supplier sent rev B ' });
  assert.equal(status, 201, JSON.stringify(body));
  assert.deepEqual(queries('UPDATE die_order_files')[0].params, [12]);
  assert.deepEqual(logged().map((e) => [e.field, e.old, e.new, e.reason]), [
    ['Die Design PDF', 'old.pdf', 'new.pdf', 'Supplier sent rev B'],
  ]);
});

test('an unknown order is a 404 and leaves nothing behind', async () => {
  stored = null;
  const { status } = await upload('die_order_form');
  assert.equal(status, 404);
  assert.deepEqual(filesOnDisk(), []);
});

test('an over-long reason is refused before anything is read', async () => {
  const { status } = await upload('die_order_form', { reason: 'x'.repeat(501) });
  assert.equal(status, 400);
  assert.equal(log.length, 0);
  assert.deepEqual(filesOnDisk(), []);
});

test('anyone who can open the order sees its current files', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  rows = [{ id: 31, slot: 'design_pdf', original_name: 'd.pdf', size_bytes: 10, uploaded_at: 'x', uploaded_by: 'planner' }];
  const { status, body } = await request(base, '/api/orders/7/files');
  assert.equal(status, 200);
  assert.deepEqual(body, { files: rows });
  assert.deepEqual(queries('SELECT f.id, f.slot')[0].params, ['7']);
  assert.match(queries('SELECT f.id, f.slot')[0].q, /replaced_at IS NULL/);
});

test('a stored file downloads as a PDF, but only through its own order', async () => {
  fs.mkdirSync(path.join(root, 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', '1_d.pdf'), PDF);
  rows = [{ id: 31, order_id: 7, stored_path: path.join('a', '1_d.pdf'), original_name: 'd.pdf' }];

  const ok = await fetch(`${base}/api/orders/7/files/31`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /application\/pdf/);
  assert.equal(await ok.text(), PDF);

  const other = await fetch(`${base}/api/orders/8/files/31`);
  assert.equal(other.status, 404);
});

test('a stored path outside the storage root is never served', async () => {
  rows = [{ id: 31, order_id: 7, stored_path: path.join('..', 'escape.pdf'), original_name: 'x.pdf' }];
  const { status } = await request(base, '/api/orders/7/files/31');
  assert.equal(status, 400);
});

test('deleting an order removes its stored files from disk', async () => {
  fs.mkdirSync(path.join(root, 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', '1_d.pdf'), PDF);
  fs.writeFileSync(path.join(root, 'a', '2_keep.pdf'), PDF);
  rows = [
    { order_id: 7, stored_path: path.join('a', '1_d.pdf') },
    { order_id: 8, stored_path: path.join('a', '2_keep.pdf') },
  ];
  currentUser = { ...EDITOR, role: 'admin' }; // deleting an order is admin-only
  const { status } = await request(base, '/api/orders/7', { method: 'DELETE' });
  assert.equal(status, 200);
  assert.deepEqual(filesOnDisk(), ['a/2_keep.pdf']);
});

// --- Profile image (from the PDF import) ------------------------------------

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of png')]);

async function uploadProfile({ content = PNG, name = '30533_201_profile.png', fields = {} } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([content], { type: 'image/png' }), name);
  const response = await fetch(`${base}/api/orders/7/profile-image`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() };
}

test('the first profile image is stored, recorded as a PNG and logged', async () => {
  const { status, body } = await uploadProfile();
  assert.equal(status, 201);
  assert.equal(body.file.slot, 'profile_image');
  const onDisk = filesOnDisk();
  assert.equal(onDisk.length, 1);
  assert.match(onDisk[0], /^30533_201\/7\/profile_image\/\d+_30533_201_profile\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(root, onDisk[0])), PNG);
  const insert = queries('INSERT INTO die_order_files')[0];
  assert.equal(insert.params[4], 'image/png');
  assert.deepEqual(logged(), [{ field: 'Profile Image', old: null, new: '30533_201_profile.png', reason: 'From the die drawing PDF', stage: 'PENDING FOR DESIGN APPROVAL', by: 'planner' }]);
});

test('an order that already has a profile image keeps it', async () => {
  current = { id: 3, original_name: 'old_profile.png' };
  const { status, body } = await uploadProfile();
  assert.equal(status, 200);
  assert.deepEqual(body, { kept: true });
  assert.equal(queries('INSERT').length, 0);
  assert.equal(queries('UPDATE').length, 0);
  assert.deepEqual(filesOnDisk(), []);
});

test('only a real PNG is accepted as a profile image', async () => {
  const { status } = await uploadProfile({ content: PDF, name: 'x.png' });
  assert.equal(status, 400);
  assert.deepEqual(filesOnDisk(), []);
});

test('whoever created the order may attach its profile image without the switch', async () => {
  currentUser = { id: 9, username: 'importer', role: 'user', canEditOrderDetails: false };
  stored.created_by = 9;
  const { status } = await uploadProfile();
  assert.equal(status, 201);
});

test('anyone else without the switch is refused before the upload is read', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  stored.created_by = 4;
  const { status, body } = await uploadProfile();
  assert.equal(status, 403);
  assert.equal(body.code, 'ORDER_EDIT_FORBIDDEN');
  assert.equal(queries('BEGIN').length, 0);
  assert.deepEqual(filesOnDisk(), []);
});

test('the drawer slot route does not take a profile image', async () => {
  const { status } = await upload('profile_image', { name: 'p.png', content: PNG });
  assert.equal(status, 404);
});

// A real profile picture: a black ring on white (R 80 px, r 40 px), as the PDF import cuts it.
function ringPng() {
  const canvas = createCanvas(200, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(100, 100, 80, 0, 2 * Math.PI);
  ctx.arc(100, 100, 40, 0, 2 * Math.PI);
  ctx.fill('evenodd');
  return canvas.toBuffer('image/png');
}

test('posting a profile PNG also records its traced shape, true-sized from the stated scale', async () => {
  Object.assign(stored, { plant: 'GEX 01', die_type: 'HOLLOW', die_size: '320X160', cavity: 2 });
  const { status, body } = await uploadProfile({
    content: ringPng(), fields: { renderDpi: '200', scales: '[1]', dieSize: 'DIA320X160', ccdStated: '' },
  });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.file.slot, 'profile_image');
  assert.deepEqual(body.shape, { ok: true, trueSize: true, holeCount: 1 });

  const [dieList] = queries("SELECT raw_data->>'ProfileCCD'");
  assert.deepEqual(dieList.params, ['30533_201', ['GEX 1', 'GEX 01']]);
  const [shape] = queries('INSERT INTO profile_shapes');
  const onDisk = filesOnDisk();
  assert.deepEqual(shape.params.slice(0, 5), ['30533_201', 'GEX 1', null, 'order-pdf', '7']);
  assert.equal(shape.params[6], path.join(...onDisk[0].split('/'))); // the stored_path written to die_order_files
  assert.equal(shape.params[6], queries('INSERT INTO die_order_files')[0].params[3]);
  assert.equal(shape.params[12], 2); // the order's cavity count
  assert.equal(shape.params[13], 'HOLLOW');
  assert.equal(shape.params[20], 'pdf-scale');
  assert.deepEqual(warnings, []);
});

test('a profile PNG without the drawing meta is recorded without a true size', async () => {
  Object.assign(stored, { plant: 'GEX 2', die_type: null, die_size: null, cavity: 0 });
  const { status, body } = await uploadProfile({ content: ringPng() });
  assert.equal(status, 201);
  assert.deepEqual(body.shape, { ok: true, trueSize: false, holeCount: 1 });
  const [shape] = queries('INSERT INTO profile_shapes');
  assert.equal(shape.params[12], null); // cavity 0 is "not known"
  assert.equal(shape.params[16], false);
});

test('a shape that cannot be traced never fails the upload', async () => {
  const { status, body } = await uploadProfile(); // PNG magic, but no decodable picture
  assert.equal(status, 201);
  assert.equal(body.file.slot, 'profile_image');
  assert.equal(body.shape.ok, false);
  assert.equal(typeof body.shape.error, 'string');
  assert.equal(queries('INSERT INTO profile_shapes').length, 0);
  assert.equal(queries('COMMIT').length, 1);
  assert.equal(filesOnDisk().length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Profile shape for order 7 not recorded/);
});
