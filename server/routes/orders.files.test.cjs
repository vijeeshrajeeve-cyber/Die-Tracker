'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'order-files-'));
process.env.ORDER_FILES_ROOT = root;

// The order the next request finds (null: no such order), the slot's current
// file (null: none yet), and the stored file rows the read routes see.
let stored;
let current;
let rows;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT id, die_no, status FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: stored ? [stored] : [] };
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
  const { status } = await request(base, '/api/orders/7', { method: 'DELETE' });
  assert.equal(status, 200);
  assert.deepEqual(filesOnDisk(), ['a/2_keep.pdf']);
});
