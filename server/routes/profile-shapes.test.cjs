'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');
const { signatureOf } = require('../services/profileShape.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-shapes-'));
process.env.TOOLING_FILES_ROOT = path.join(tmp, 'tooling');
process.env.ORDER_FILES_ROOT = path.join(tmp, 'orders');
fs.mkdirSync(path.join(process.env.TOOLING_FILES_ROOT, 'profiles', 'ab'), { recursive: true });
fs.mkdirSync(path.join(process.env.ORDER_FILES_ROOT, 'D-1'), { recursive: true });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
fs.writeFileSync(path.join(process.env.TOOLING_FILES_ROOT, 'profiles', 'ab', 'abc.gif'), Buffer.from('GIF89a'));
fs.writeFileSync(path.join(process.env.ORDER_FILES_ROOT, 'D-1', 'profile.png'), PNG);
// A real file just outside the tooling root: refusing it proves the root check, not a missing file.
fs.writeFileSync(path.join(tmp, 'outside.png'), PNG);

const SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];
const SQ_SIG = signatureOf({ outer: SQUARE, holes: [] });
const OTHER_SIG = SQ_SIG.map((v, i) => (i === 0 ? v + 0.5 : v));

const shapeRow = (id, dieNo, signature, extra = {}) => ({
  id, die_no: dieNo, plant: 'GEX 1', profile_number: `P-${id}`, source: 'image-check-xlsx', source_ref: `GEX1!E${id}`,
  image_path: null, signature, hole_count: 0, cavities: 2, true_size: false, needs_review: false,
  updated_at: new Date(Date.UTC(2026, 10, id)), ...extra,
});

// D-1 has two rows: an old one shaped like OTHER, a newer (flagged) one shaped like the square.
const ROWS = [
  shapeRow(1, 'D-1', OTHER_SIG, { updated_at: new Date(Date.UTC(2026, 9, 1)) }),
  shapeRow(2, 'D-1', SQ_SIG, { needs_review: true, true_size: true, source: 'order-pdf', image_path: 'D-1/profile.png' }),
  shapeRow(3, 'D-SQ', SQ_SIG),
  shapeRow(4, 'D-OTHER', OTHER_SIG),
  shapeRow(5, 'D-GIF', OTHER_SIG, { image_path: 'profiles/ab/abc.gif' }),
  shapeRow(6, 'D-EVIL', OTHER_SIG, { image_path: '../../etc/passwd' }),
  shapeRow(7, 'D-EVIL', OTHER_SIG, { image_path: '../outside.png' }),
];

const queries = [];
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  if (/max\(updated_at\)/.test(sql)) return { rows: [{ max_updated: 'stamp', n: ROWS.length }] };
  if (/needs_review = false/.test(sql)) return { rows: ROWS.filter((r) => r.plant === params[0] && !r.needs_review) };
  if (/WHERE id = \$1 AND die_no = \$2/.test(sql)) {
    return { rows: ROWS.filter((r) => r.id === params[0] && r.die_no === params[1] && (params[2] == null || r.plant === params[2])) };
  }
  if (/WHERE die_no = \$1 AND plant = \$2/.test(sql)) {
    const rows = ROWS.filter((r) => r.die_no === params[0] && r.plant === params[1])
      .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id);
    return { rows: /LIMIT 1/.test(sql) ? rows.slice(0, 1) : rows };
  }
  throw new Error(`unexpected query ${sql}`);
});

const router = require('./profile-shapes.cjs');
const app = express();
app.use(express.json());
app.use('/api/profile-shapes', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('forDie strips the signature', async () => {
  const res = await request(base, '/api/profile-shapes/D-1?plant=GEX%2001');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.shapes.map((s) => s.id), [2, 1], 'newest first');
  assert.ok(res.body.shapes.every((s) => !('signature' in s)));
  assert.equal(res.body.shapes[0].profile_number, 'P-2');
  assert.equal(res.body.hasTrueSize, true);
  const q = queries.find((x) => /WHERE die_no = \$1 AND plant = \$2/.test(x.sql));
  assert.deepEqual(q.params, ['D-1', 'GEX 1'], 'plant normalised');
});

test('forDie answers 404 for an unknown die and 400 without a plant', async () => {
  assert.equal((await request(base, '/api/profile-shapes/NOPE?plant=GEX%201')).status, 404);
  const res = await request(base, '/api/profile-shapes/D-1');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'plant is required');
});

test('similar uses the newest row', async () => {
  const res = await request(base, '/api/profile-shapes/D-1/similar?plant=GEX%201&limit=5');
  assert.equal(res.status, 200);
  // The newest D-1 row is square-shaped, so D-SQ comes first; D-1 itself is excluded.
  assert.equal(res.body.items[0].die_no, 'D-SQ');
  assert.ok(res.body.items[0].distance < 1e-9);
  assert.equal(res.body.items[0].cavityMatch, true);
  assert.ok(!res.body.items.some((i) => i.die_no === 'D-1'));
  assert.equal((await request(base, '/api/profile-shapes/NOPE/similar?plant=GEX%201')).status, 404);
  assert.equal((await request(base, '/api/profile-shapes/D-1/similar')).status, 400);
  const one = await request(base, '/api/profile-shapes/D-1/similar?plant=GEX%201&limit=0');
  assert.equal(one.body.items.length, 1, 'limit clamps to at least 1');
});

test('POST similar normalises an arbitrary-frame polygon', async () => {
  const scaled = SQUARE.map(([x, y]) => [x * 10 + 250, y * 10 - 40]);
  const res = await request(base, '/api/profile-shapes/similar', { body: { plant: 'GEX 1', outer: scaled, cavities: 4 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.signature.length, SQ_SIG.length);
  res.body.signature.forEach((v, i) => assert.ok(Math.abs(v - SQ_SIG[i]) < 1e-9, `signature[${i}]`));
  assert.equal(res.body.items[0].die_no, 'D-SQ');
  assert.equal(res.body.items[0].cavityMatch, false);
});

test('POST /similar is reachable (not swallowed by /:dieNo)', async () => {
  const bad = await request(base, '/api/profile-shapes/similar', { body: { plant: 'GEX 1', outer: [[0, 0], [1, 1]] } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /outer/);
  const noPlant = await request(base, '/api/profile-shapes/similar', { body: { outer: SQUARE } });
  assert.equal(noPlant.status, 400);
  assert.equal(noPlant.body.error, 'plant is required');
  const holes = await request(base, '/api/profile-shapes/similar', { body: { plant: 'GEX 1', outer: SQUARE, holes: 'x' } });
  assert.equal(holes.status, 400);
});

test('image download serves the stored picture from the root its source uses', async () => {
  const png = await fetch(`${base}/api/profile-shapes/D-1/image/2?plant=GEX%201`);
  assert.equal(png.status, 200);
  assert.match(png.headers.get('content-type'), /image\/png/);
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), PNG);
  const gif = await fetch(`${base}/api/profile-shapes/D-GIF/image/5`);
  assert.equal(gif.status, 200);
  assert.match(gif.headers.get('content-type'), /image\/gif/);
  await gif.arrayBuffer();
});

test('image download refuses a path outside the root', async () => {
  const res = await request(base, '/api/profile-shapes/D-EVIL/image/6');
  assert.equal(res.status, 404);
  assert.equal((await request(base, '/api/profile-shapes/D-EVIL/image/7')).status, 404, 'existing file outside the root');
  assert.equal((await request(base, '/api/profile-shapes/D-SQ/image/3')).status, 404, 'no image_path');
  assert.equal((await request(base, '/api/profile-shapes/D-SQ/image/2')).status, 404, 'id belongs to another die');
  assert.equal((await request(base, '/api/profile-shapes/D-SQ/image/x')).status, 404);
});
