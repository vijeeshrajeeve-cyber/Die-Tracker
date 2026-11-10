'use strict';
process.env.JWT_SECRET = 'toolings-find-test-secret-at-least-32-characters-long';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const circle = (r, n = 90, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);

const TOOLING = (number, r) => ({
  id: number.length, number, kind: 'insert', plant: 'GEX 1', held_presses: ['PRESS 25'], size_class: '300X100',
  size_class_confidence: 'confirmed', cavities: 1, location: null, status: 'active', pockets: [circle(r)],
  confidence: 'confirmed', pocket_gap_mm: null,
});
const TOOLINGS = [TOOLING('SNUG', 45), TOOLING('WIDE', 50)];
const { signatureOf } = require('../services/profileShape.cjs');
const rect = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
// GEX 7 has a similarity index: the die SELF and one neighbour.
const INDEX_GEX7 = [
  { id: 1, die_no: 'SELF', plant: 'GEX 7', profile_number: null, signature: signatureOf({ outer: circle(1) }), hole_count: 0, cavities: 1, true_size: true },
  { id: 2, die_no: 'N-1', plant: 'GEX 7', profile_number: null, signature: signatureOf({ outer: rect(2, 1) }), hole_count: 0, cavities: 1, true_size: true },
];
const queries = [];
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  if (/FROM presses/.test(sql)) return { rows: [{ press_name: 'PRESS 25', press_code: 'P25' }] };
  if (/max\(GREATEST/.test(sql)) {
    if (params[0] === 'BOOM') throw new Error('database went away');
    return { rows: [{ max_updated: 'v1', n: TOOLINGS.length }] };
  }
  if (/FROM toolings t JOIN tooling_openings o/.test(sql)) return { rows: TOOLINGS };
  if (/FROM tooling_combinations/.test(sql)) {
    return { rows: params[0] === 'PRESS 25' ? [{ press: 'PRESS 25', die_size: '250X200', insert_size: '300X100', bolster_size: '600X150', remark: null }] : [] };
  }
  if (/FROM profile_shapes\s+WHERE translate\(die_no/.test(sql)) {
    return { rows: params[0] === 'DIE-1' ? [{ outer_mm: circle(35, 90, 40, 40), holes_mm: [], cavities: 1, hole_count: 0 }] : [] };
  }
  if (/max\(updated_at\)/.test(sql)) return { rows: [{ max_updated: 'v1', n: params[0] === 'GEX 7' ? INDEX_GEX7.length : 0 }] };
  if (/FROM profile_shapes WHERE plant/.test(sql)) return { rows: params[0] === 'GEX 7' ? INDEX_GEX7 : [] };
  if (/FROM profile_shapes WHERE id = ANY/.test(sql)) return { rows: [] };
  if (/FROM die_tooling_links/.test(sql)) return { rows: [] };
  if (/FROM existing_die_details/.test(sql)) return { rows: [] };
  if (/FROM toolings t/.test(sql) && /WHERE t\.number = \$1/.test(sql)) return { rows: [] };
  throw new Error(`unexpected query ${sql}`);
});

const router = require('./toolings.cjs');
const app = express();
app.use(express.json({ limit: '10mb' })); // as server/index.cjs
app.use('/api/toolings', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); });

const BODY = { plant: 'gex 01', press: 'P25', dieSize: '250x200', cavities: 1, profile: { outer: circle(35) } };
const find = (body) => request(base, '/api/toolings/find', { body, method: 'POST' });

test('POST /find validates its body and names the field', async () => {
  const cases = [
    [{ ...BODY, plant: '' }, /plant/],
    [{ ...BODY, press: undefined }, /press/],
    [{ ...BODY, dieSize: ' ' }, /dieSize/],
    [{ ...BODY, cavities: undefined }, /cavities/],
    [{ ...BODY, cavities: 0 }, /cavities/],
    [{ ...BODY, cavities: 1.5 }, /cavities/],
    [{ ...BODY, cavities: 'two' }, /cavities/],
    [{ ...BODY, profile: { outer: [[0, 0], [1, 0]] } }, /profile/],
    [{ ...BODY, profile: { outer: [[0, 0], [1, 'x'], [1, 1]] } }, /profile/],
    [{ ...BODY, profile: { outer: circle(35), holes: [[[0, 0]]] } }, /profile/],
    [{ ...BODY, profile: undefined }, /profile or dieNo/],
  ];
  for (const [body, message] of cases) {
    const res = await find(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.match(res.body.error, message);
  }
});

test('POST /find is 404 for a die with no true-size profile', async () => {
  const res = await find({ ...BODY, profile: undefined, dieNo: 'NOPE' });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'no true-size profile for die NOPE' });
});

test('POST /find answers the finder result with the press, plant and die size canonical', async () => {
  const res = await find(BODY);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['candidates', 'chart', 'fitted', 'query', 'rejected', 'similar', 'timings', 'truncated']);
  assert.equal(res.body.query.press, 'PRESS 25');
  assert.equal(res.body.query.plant, 'GEX 1');
  assert.equal(res.body.query.dieSize, '250X200');
  assert.equal(res.body.query.cavities, 1);
  assert.equal(res.body.chart.basis, 'chart');
  assert.deepEqual(res.body.candidates.map((c) => c.number), ['SNUG', 'WIDE']);
  assert.equal(res.body.candidates[0].chart.verdict, 'allowed');
  assert.equal(res.body.fitted, 2);

  const one = await find({ ...BODY, limit: 0, cavities: '1' });
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.candidates.map((c) => c.number), ['SNUG'], 'limit is clamped to at least 1');
});

test('POST /find takes the profile from a die when no polygon is given', async () => {
  queries.length = 0;
  const res = await find({ ...BODY, profile: undefined, dieNo: 'DIE-1' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.candidates.map((c) => c.number), ['SNUG', 'WIDE']);
  const q = queries.find((x) => /FROM profile_shapes\s+WHERE translate\(die_no/.test(x.sql));
  assert.deepEqual(q.params, ['DIE-1', 'GEX 1']);
});

test('POST /find is not swallowed by /:number', async () => {
  queries.length = 0;
  const res = await find({ ...BODY, plant: '' });
  assert.equal(res.status, 400);
  assert.ok(!queries.some((q) => /WHERE t\.number = \$1/.test(q.sql)), 'the detail route never ran');
});

test('POST /find is 400 for a press the presses master cannot resolve', async () => {
  const res = await find({ ...BODY, press: 'nonsense' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'press is not recognised' });
});

test('POST /find answers 500 JSON when the finder fails', async () => {
  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args); };
  try {
    const res = await find({ ...BODY, plant: 'BOOM' });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Finder failed' });
  } finally {
    console.error = realError;
  }
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][1] && logged[0][1].message), /database went away/);
});

test('POST /find caps the posted polygon at 5000 points, for the outer and for each hole', async () => {
  const many = circle(30, 5001);
  const outer = await find({ ...BODY, profile: { outer: many } });
  assert.equal(outer.status, 400);
  assert.deepEqual(outer.body, { error: 'profile has too many points (max 5000)' });
  const hole = await find({ ...BODY, profile: { outer: circle(35), holes: [circle(5), circle(10, 5001)] } });
  assert.equal(hole.status, 400);
  assert.deepEqual(hole.body, { error: 'profile has too many points (max 5000)' });
});

test('POST /find is 400 for a non-finite coordinate', async () => {
  // JSON.parse reads 1e999 as Infinity.
  const raw = JSON.stringify({ ...BODY, profile: { outer: [[0, 0], [10, 0], [5, 'INF']] } }).replace('"INF"', '1e999');
  const response = await fetch(`${base}/api/toolings/find`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /profile\.outer/);
});

test('POST /find takes minClearance from 0 to 10 and echoes it; 400 otherwise', async () => {
  for (const minClearance of [11, -1, 'abc', true, '']) {
    const res = await find({ ...BODY, minClearance });
    assert.equal(res.status, 400, JSON.stringify(minClearance));
    assert.deepEqual(res.body, { error: 'minClearance must be a number from 0 to 10' });
  }
  const dflt = await find(BODY);
  assert.equal(dflt.body.query.minClearance, 5);
  const ten = await find({ ...BODY, minClearance: 10 });
  assert.equal(ten.status, 200);
  assert.equal(ten.body.query.minClearance, 10);
  // SNUG's 90-gon gives just under 10 mm, so the gate drops it; WIDE has 15.
  assert.deepEqual(ten.body.candidates.map((c) => c.number), ['WIDE']);
  const tight = await find({ ...BODY, minClearance: '10.5' });
  assert.equal(tight.status, 400);
  const three = await find({ ...BODY, minClearance: '3' });
  assert.equal(three.status, 200);
  assert.equal(three.body.query.minClearance, 3);
});

test('POST /find with a polygon and a dieNo keeps that die out of similar', async () => {
  queries.length = 0;
  const res = await find({ ...BODY, plant: 'GEX 7', dieNo: 'SELF' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.similar.map((x) => x.dieNo), ['N-1']);
  assert.ok(!queries.some((q) => /FROM profile_shapes\s+WHERE translate\(die_no/.test(q.sql)), 'the polygon is the profile');
  const without = await find({ ...BODY, plant: 'GEX 7' });
  assert.deepEqual(without.body.similar.map((x) => x.dieNo), ['SELF', 'N-1'], 'without dieNo it would be listed');
});
