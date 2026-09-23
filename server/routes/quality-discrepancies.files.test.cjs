'use strict';
// quality-discrepancies.cjs loads auth.cjs for adminMiddleware, and auth.cjs
// warns when this is unset.
process.env.JWT_SECRET = 'qd-files-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// qdStorage reads QD_FILES_ROOT at call time; point it at a scratch dir. The
// sibling's path starts with the root's but is not inside it.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-files-'));
const sibling = `${root}-evil`;
process.env.QD_FILES_ROOT = root;

// Writes a file and returns its stored_path, relative to the root as the
// upload routes store it.
function place(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
  return path.relative(root, path.join(dir, name));
}

// The quality_discrepancy_files rows the next request finds, by id.
let files = {};
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT \* FROM quality_discrepancy_files WHERE id = \$1/.test(q)) {
    const f = files[params[0]];
    return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
  }
  if (/^SELECT approval_state FROM quality_discrepancies WHERE id = \$1/.test(q)) {
    return { rows: [{ approval_state: 'Draft' }], rowCount: 1 };
  }
  if (/^SELECT stored_path, original_name FROM quality_discrepancy_files WHERE id = \$1 AND qd_id = \$2/.test(q)) {
    const f = files[params[0]];
    return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
  }
  if (/^SELECT imported FROM quality_discrepancies WHERE id = \$1 FOR UPDATE/.test(q)) {
    return { rows: [{ imported: true }], rowCount: 1 };
  }
  if (/^SELECT stored_path FROM quality_discrepancy_files WHERE qd_id = \$1/.test(q)) {
    return { rows: Object.values(files) };
  }
  if (/^DELETE FROM quality_discrepanc(y_files|ies) WHERE id = \$1/.test(q)) return { rows: [], rowCount: 1 };
  if (/^INSERT INTO quality_discrepancy_activity/.test(q)) return { rows: [] };
  throw new Error(`QD files test: unexpected query ${q}`);
});

const qdRouter = require('./quality-discrepancies.cjs');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1, username: 'admin', role: 'admin' }; next(); });
app.use('/api/quality-discrepancies', qdRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => {
  await close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(sibling, { recursive: true, force: true });
});

test('a stored file inside the root downloads', async () => {
  files = { 1: { id: 1, qd_id: 7, original_name: 'a.pdf', stored_path: place(path.join(root, 'QD-1', '7'), 'a.pdf', 'inside') } };
  const r = await fetch(`${base}/api/quality-discrepancies/files/1`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'inside');
});

test('a download into a sibling that shares the root prefix is refused', async () => {
  files = { 2: { id: 2, qd_id: 7, original_name: 'a.pdf', stored_path: place(sibling, 'a.pdf', 'outside') } };
  const r = await fetch(`${base}/api/quality-discrepancies/files/2`);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Invalid path' });
});

test('removing an image unlinks a file inside the root', async () => {
  files = { 3: { id: 3, qd_id: 7, original_name: 'p.jpg', stored_path: place(path.join(root, 'QD-1', '7'), 'p.jpg', 'inside') } };
  const res = await request(base, '/api/quality-discrepancies/7/files/3', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(root, 'QD-1', '7', 'p.jpg')), false);
});

test('removing an image never unlinks a file in a sibling of the root', async () => {
  files = { 4: { id: 4, qd_id: 7, original_name: 'p.jpg', stored_path: place(sibling, 'p.jpg', 'outside') } };
  const res = await request(base, '/api/quality-discrepancies/7/files/4', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(sibling, 'p.jpg')), true);
});

test('undoing an import unlinks its files inside the root, never in a sibling', async () => {
  files = {
    5: { id: 5, qd_id: 7, stored_path: place(path.join(root, 'QD-1', '7'), 'old.pdf', 'inside') },
    6: { id: 6, qd_id: 7, stored_path: place(sibling, 'old.pdf', 'outside') },
  };
  const res = await request(base, '/api/quality-discrepancies/7/import', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(root, 'QD-1', '7', 'old.pdf')), false);
  assert.equal(fs.existsSync(path.join(sibling, 'old.pdf')), true);
});
