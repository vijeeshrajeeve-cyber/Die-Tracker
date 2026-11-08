'use strict';
process.env.JWT_SECRET = 'toolings-test-secret-at-least-32-characters-long';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const TOOLING = { id: 1, number: '25IC2-110634', kind: 'insert', plant: 'GEX 2', held_presses: ['PRESS 7'], size_class: '460X150', cavities: 2, status: 'active' };
const queries = [];
let drawingRows = [];
let downloadRow = null;
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  if (/FROM tooling_drawings d\s+JOIN toolings t/.test(sql)) return { rows: downloadRow && params[0] === 7 && params[1] === downloadRow.number ? [downloadRow] : [] };
  if (/FROM tooling_drawings WHERE tooling_id/.test(sql)) return { rows: drawingRows };
  if (/'no-pockets'/.test(sql)) {
    if (/SELECT count\(\*\) FROM toolings/i.test(sql)) return { rows: [{ count: '2' }] };
    return { rows: [{ number: 'A-1', kind: 'insert', plant: 'GEX 2', size_class: null, status: 'unverified', opening_confidence: 'none', extraction_source: null, drawing_count: 0, reason: 'unverified' }, { number: 'B-2', kind: 'bolster', plant: 'GEX 2', size_class: '700X196', status: 'active', opening_confidence: 'uncertain', extraction_source: 'dxf', drawing_count: 2, reason: 'uncertain' }] };
  }
  if (/SELECT count\(\*\)/i.test(sql)) return { rows: [{ count: '1' }] };
  if (/FROM toolings t/.test(sql) && /WHERE t\.number = \$1/.test(sql)) {
    return params[0] === '25IC2-110634' ? { rows: [{ ...TOOLING, opening_confidence: 'none' }] } : { rows: [] };
  }
  if (/FROM toolings t/.test(sql)) return { rows: [{ ...TOOLING, opening_confidence: 'none', linked_dies: 2 }] };
  if (/FROM tooling_openings/.test(sql)) return { rows: [] };
  if (/FROM die_tooling_links/.test(sql)) return { rows: [{ die_no: '110634-2501', plant: 'GEX 2', source: 'die-list', seen_at: '2026-11-07', die_size: '250X140', press: 'PRESS 7', cavity: 2, die_status: 'AVAILABLE' }] };
  if (/FROM tooling_combinations/.test(sql)) return { rows: params[0] === 'PRESS 7' ? [] : [{ press: 'PRESS 6', die_size: '355X200', insert_size: '460X150', bolster_size: '700X196' }, { press: 'PRESS 6', die_size: '355X200', insert_size: '300X100', bolster_size: null }] };
  throw new Error(`unexpected query ${sql}`);
});

const router = require('./toolings.cjs');
const app = express();
app.use(express.json());
app.use('/api/toolings', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); });

test('list returns items with opening confidence and link counts', async () => {
  const res = await request(base, '/api/toolings?plant=GEX%202&kind=insert&press=PRESS%207');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].number, '25IC2-110634');
  assert.equal(res.body.items[0].opening_confidence, 'none');
  assert.equal(res.body.items[0].linked_dies, 2);
  const listQuery = queries.find((q) => /FROM toolings t/.test(q.sql) && !/t\.number = \$1/.test(q.sql) && !/count\(\*\)/i.test(q.sql));
  assert.ok(listQuery.params.includes('active'), 'status defaults to active');
  assert.ok(listQuery.params.includes('PRESS 7'));
});

test('list status=all drops the status clause; other statuses filter', async () => {
  queries.length = 0;
  const res = await request(base, '/api/toolings?status=all');
  assert.equal(res.status, 200);
  const listQuery = queries.find((q) => /FROM toolings t/.test(q.sql) && !/count\(\*\)/i.test(q.sql));
  assert.doesNotMatch(listQuery.sql, /t\.status = /);
  assert.ok(!listQuery.params.includes('all'));
  queries.length = 0;
  await request(base, '/api/toolings?status=unverified');
  assert.ok(queries[0].params.includes('unverified'));
});

test('detail joins the opening and the linked dies', async () => {
  const res = await request(base, '/api/toolings/25IC2-110634');
  assert.equal(res.status, 200);
  assert.equal(res.body.tooling.number, '25IC2-110634');
  assert.equal(res.body.opening, null);
  assert.equal(res.body.links[0].die.die_size, '250X140');
});

test('detail query prefers the same-plant die by comparing normalised plants', async () => {
  queries.length = 0;
  await request(base, '/api/toolings/25IC2-110634');
  const q = queries.find((x) => /FROM die_tooling_links/.test(x.sql));
  assert.match(q.sql, /regexp_replace\(upper\(trim\(e\.plant\)\), '\\m0\+\(\\d\+\)', '\\1', 'g'\) IS NOT DISTINCT FROM l\.plant/);
});

test('list normalises the plant filter (GEX 01 -> GEX 1)', async () => {
  queries.length = 0;
  const res = await request(base, '/api/toolings?plant=GEX%2001');
  assert.equal(res.status, 200);
  const q = queries.find((x) => /FROM toolings t/.test(x.sql) && !/count\(\*\)/i.test(x.sql));
  assert.ok(q.params.includes('GEX 1'));
  assert.ok(!q.params.includes('GEX 01'));
});

test('linked_dies counts distinct dies', async () => {
  queries.length = 0;
  await request(base, '/api/toolings');
  const q = queries.find((x) => /FROM toolings t/.test(x.sql) && !/count\(\*\)/i.test(x.sql));
  assert.match(q.sql, /count\(DISTINCT l\.die_no\)/);
});

test('detail is 404 for an unknown number', async () => {
  const res = await request(base, '/api/toolings/NOPE');
  assert.equal(res.status, 404);
});

test('combinations lists allowed sizes for a press and die size, and says when there is no chart', async () => {
  const ok = await request(base, '/api/toolings/combinations?press=PRESS%206&dieSize=355x200');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.insertSizes, ['300X100', '460X150']);
  assert.deepEqual(ok.body.bolsterSizes, ['700X196']);
  assert.equal(ok.body.verdictBasis, 'chart');
  const none = await request(base, '/api/toolings/combinations?press=PRESS%207&dieSize=250X140');
  assert.equal(none.body.verdictBasis, 'no_chart');
  assert.deepEqual(none.body.rows, []);
});

test('combinations requires press and dieSize', async () => {
  const res = await request(base, '/api/toolings/combinations?press=PRESS%206');
  assert.equal(res.status, 400);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('detail lists drawings primary first and never exposes stored paths', async () => {
  drawingRows = [
    { id: 2, original_name: 'a.dxf', format: 'dxf', match_basis: 'exact', is_primary: true, byte_size: 10, created_at: '2026-11-08' },
    { id: 3, original_name: 'b.pdf', format: 'pdf', match_basis: 'exact', is_primary: false, byte_size: 20, created_at: '2026-11-08' },
  ];
  queries.length = 0;
  const res = await request(base, '/api/toolings/25IC2-110634');
  assert.equal(res.status, 200);
  assert.equal(res.body.drawings.length, 2);
  assert.equal(res.body.drawings[0].is_primary, true);
  const q = queries.find((x) => /FROM tooling_drawings WHERE tooling_id/.test(x.sql));
  assert.match(q.sql, /ORDER BY is_primary DESC, original_name/);
  assert.doesNotMatch(q.sql, /file_path|archive_path/);
  drawingRows = [];
});

function withRoot(fileName, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tooling-root-'));
  if (fileName) {
    fs.mkdirSync(path.dirname(path.join(root, fileName)), { recursive: true });
    fs.writeFileSync(path.join(root, fileName), content);
  }
  const prev = process.env.TOOLING_FILES_ROOT;
  process.env.TOOLING_FILES_ROOT = root;
  return () => {
    if (prev === undefined) delete process.env.TOOLING_FILES_ROOT; else process.env.TOOLING_FILES_ROOT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  };
}

test('download streams the stored file for its own tooling only', async () => {
  const restore = withRoot('25IC2-110634/abc_x.dxf', '0\nSECTION\n');
  try {
    downloadRow = { number: '25IC2-110634', file_path: '25IC2-110634/abc_x.dxf', original_name: 'x.dxf' };
    const ok = await fetch(`${base}/api/toolings/25IC2-110634/drawings/7/file`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-disposition'), /attachment/);
    assert.equal(await ok.text(), '0\nSECTION\n');
    const other = await fetch(`${base}/api/toolings/OTHER-1/drawings/7/file`);
    assert.equal(other.status, 404);
    const badId = await fetch(`${base}/api/toolings/25IC2-110634/drawings/abc/file`);
    assert.equal(badId.status, 404);
  } finally { downloadRow = null; restore(); }
});

test('download refuses a stored path outside the root and a file missing on disk', async () => {
  const restore = withRoot(null);
  try {
    downloadRow = { number: '25IC2-110634', file_path: '../x', original_name: 'x.dxf' };
    const out = await fetch(`${base}/api/toolings/25IC2-110634/drawings/7/file`);
    assert.equal(out.status, 404);
    const body = await out.json();
    assert.equal(body.error, 'Drawing file not available');
    downloadRow = { number: '25IC2-110634', file_path: 'gone.dxf', original_name: 'x.dxf' };
    const gone = await fetch(`${base}/api/toolings/25IC2-110634/drawings/7/file`);
    assert.equal(gone.status, 404);
  } finally { downloadRow = null; restore(); }
});

test('review queue orders unverified, no-opening, none, uncertain, no-size-class', async () => {
  queries.length = 0;
  const res = await request(base, '/api/toolings/review-queue?plant=GEX%2001&kind=insert&limit=500');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.items.map((i) => i.reason), ['unverified', 'uncertain']);
  const q = queries.find((x) => /AS reason/.test(x.sql) && !/SELECT count\(\*\) FROM toolings/i.test(x.sql));
  const order = ['unverified', 'no-opening', 'no-pockets', 'uncertain', 'no-size-class'].map((r) => q.sql.indexOf(`'${r}'`));
  assert.ok(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'CASE lists reasons in priority order');
  assert.match(q.sql, /t\.status IN \('active', 'unverified'\)/);
  assert.ok(q.params.includes('GEX 1'));
  assert.ok(q.params.includes('insert'));
  assert.ok(q.params.includes(200), 'limit is capped');
});

test('review queue registers before the number route', async () => {
  const res = await request(base, '/api/toolings/review-queue');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
});
