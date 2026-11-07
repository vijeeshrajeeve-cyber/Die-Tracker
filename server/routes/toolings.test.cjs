'use strict';
process.env.JWT_SECRET = 'toolings-test-secret-at-least-32-characters-long';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const TOOLING = { id: 1, number: '25IC2-110634', kind: 'insert', plant: 'GEX 2', held_presses: ['PRESS 7'], size_class: '460X150', cavities: 2, status: 'active' };
const queries = [];
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
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
