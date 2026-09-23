'use strict';
// frozen-designs.cjs loads auth.cjs for adminMiddleware, and auth.cjs warns
// when this is unset.
process.env.JWT_SECRET = 'frozen-designs-test-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { installFakeDb, listen } = require('./testSupport.cjs');

// frozenDesignStorage reads FROZEN_DESIGNS_ROOT at call time; point it at a
// scratch dir. The sibling's path starts with the root's but is not inside it.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-files-'));
const sibling = `${root}-evil`;
process.env.FROZEN_DESIGNS_ROOT = root;
fs.mkdirSync(path.join(root, '14752'), { recursive: true });
fs.writeFileSync(path.join(root, '14752', 'd.pdf'), 'inside');
fs.mkdirSync(sibling, { recursive: true });
fs.writeFileSync(path.join(sibling, 'd.pdf'), 'outside');

const FILES = {
  1: { id: 1, original_name: 'd.pdf', stored_path: path.join('14752', 'd.pdf') },
  2: { id: 2, original_name: 'd.pdf', stored_path: path.join('..', path.basename(sibling), 'd.pdf') },
};
installFakeDb(async (sql, params = []) => {
  if (/^SELECT \* FROM frozen_design_files WHERE id = \$1/.test(sql.trim())) {
    const f = FILES[params[0]];
    return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
  }
  throw new Error(`frozen designs files test: unexpected query ${sql}`);
});

const frozenDesignsRouter = require('./frozen-designs.cjs');

const app = express();
app.use('/api/frozen-designs', frozenDesignsRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => {
  await close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(sibling, { recursive: true, force: true });
});

test('a stored file inside the root downloads', async () => {
  const r = await fetch(`${base}/api/frozen-designs/files/1`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'inside');
});

test('a stored path into a sibling that shares the root prefix is refused', async () => {
  const r = await fetch(`${base}/api/frozen-designs/files/2`);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Invalid path' });
});
