'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareOut } = require('./build-profile-bundle.cjs');

test('a live rebuild removes the stale manifest before any shape is written and keeps the pictures', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-bundle-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, 'manifest.json'), '{"version":2,"kind":"profile-shapes","counts":{"shapes":9}}');
  fs.writeFileSync(path.join(out, 'shapes.ndjson'), '{"old":1}\n');
  fs.mkdirSync(path.join(out, 'files'));
  fs.writeFileSync(path.join(out, 'files', 'keep.gif'), 'GIF');
  prepareOut(out);
  assert.equal(fs.existsSync(path.join(out, 'manifest.json')), false);
  assert.equal(fs.readFileSync(path.join(out, 'shapes.ndjson'), 'utf8'), '');
  assert.equal(fs.readFileSync(path.join(out, 'files', 'keep.gif'), 'utf8'), 'GIF');
});

test('a fresh folder is created with an empty shapes file', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-bundle-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const out = path.join(base, 'new');
  prepareOut(out);
  assert.deepEqual(fs.readdirSync(out), ['shapes.ndjson']);
});
