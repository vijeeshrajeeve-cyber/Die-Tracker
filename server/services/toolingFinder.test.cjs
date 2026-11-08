'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const f = require('./toolingFinder.cjs');

const circle = (r, n = 90, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
const rect = (w, h, cx = 0, cy = 0) => [[cx - w/2, cy - h/2], [cx + w/2, cy - h/2], [cx + w/2, cy + h/2], [cx - w/2, cy + h/2]];

const PRESS = 'PRESS 25';
const DIE = '250X200';
const CHART = [
  { press: PRESS, die_size: DIE, insert_size: '300X100', bolster_size: '600X150', remark: null },
];

let nextId = 1;
const row = (over = {}) => ({
  id: nextId++, number: `I-${String(nextId).padStart(5, '0')}`, kind: 'insert', plant: 'GEX 1',
  held_presses: [PRESS], size_class: '300X100', size_class_confidence: 'confirmed', cavities: 1,
  location: 'RACK 1', status: 'active', pockets: [circle(60)], confidence: 'confirmed', pocket_gap_mm: null,
  ...over,
});
const cand = (over) => f.candidateFromRow(row(over));
const query = (profileOuter, over = {}) => ({
  plant: 'GEX 1', press: PRESS, dieSize: DIE, cavities: 1, profile: f.profileStats(profileOuter), ...over,
});

function fakeClient(state) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/max\(GREATEST/.test(sql)) return { rows: [{ max_updated: state.stamp, n: state.rows.length }] };
      return { rows: state.rows };
    },
  };
}

test('loadCandidates parses pockets, computes pocketStats and caches by stamp', async () => {
  const state = {
    stamp: new Date('2026-11-01T10:00:00Z'),
    rows: [
      row({ plant: 'CACHE', pockets: JSON.stringify([rect(100, 50)]), held_presses: null }),
      row({ plant: 'CACHE', pockets: [rect(80, 40), rect(60, 30)], cavities: 2, pocket_gap_mm: '120.5' }),
      row({ plant: 'CACHE', pockets: '[]' }),
    ],
  };
  const client = fakeClient(state);
  const warnings = [];
  const first = await f.loadCandidates(client, { plant: 'CACHE', onWarn: (m) => warnings.push(m) });
  assert.equal(client.queries.length, 2);
  assert.match(client.queries[1].sql, /FROM toolings t JOIN tooling_openings o/);
  assert.deepEqual(client.queries[0].params, ['CACHE']);
  assert.deepEqual(client.queries[1].params, ['CACHE']);
  assert.equal(first.length, 2, 'the empty-pockets row is dropped');
  assert.equal(warnings.length, 1);
  assert.deepEqual(first[0].pockets, [rect(100, 50)]);
  assert.deepEqual(first[0].held_presses, []);
  assert.deepEqual(first[0].grids, []);
  assert.ok(Math.abs(first[0].pocketStats[0].area - 5000) < 1e-9);
  assert.ok(Math.abs(first[0].pocketStats[0].perimeter - 300) < 1e-9);
  assert.ok(Math.abs(first[0].pocketStats[0].diag - Math.hypot(100, 50)) < 1e-9);
  assert.equal(first[0].pocketStats[0].bbox.width, 100);
  assert.equal(first[1].pocketStats.length, 2);
  assert.equal(first[1].pocket_gap_mm, 120.5);

  first[0].grids[0] = 'built';
  const second = await f.loadCandidates(client, { plant: 'CACHE' });
  assert.equal(client.queries.length, 3, 'same stamp: only the stamp query runs');
  assert.equal(second, first);
  assert.equal(second[0].grids[0], 'built', 'grids are kept with the cache');

  state.stamp = new Date('2026-11-02T10:00:00Z');
  const third = await f.loadCandidates(client, { plant: 'CACHE' });
  assert.equal(client.queries.length, 5, 'stamp moved: full reload');
  assert.deepEqual(third[0].grids, [], 'grids are dropped with the old entry');

  f.invalidate('CACHE');
  await f.loadCandidates(client, { plant: 'CACHE' });
  assert.equal(client.queries.length, 7, 'invalidate forces a reload');
});

test('loadCandidates skips malformed and oversize pockets with a warning and keeps the other rows', async () => {
  const state = {
    stamp: 'v1',
    rows: [
      row({ number: 'GOOD-1', plant: 'BAD ROWS' }),
      row({ number: 'NULL-POCKET', plant: 'BAD ROWS', pockets: [null] }),
      row({ number: 'EMPTY-POCKET', plant: 'BAD ROWS', pockets: '[[]]' }),
      row({ number: 'TWO-POINTS', plant: 'BAD ROWS', pockets: [[[0, 0], [10, 0]]] }),
      row({ number: 'NAN', plant: 'BAD ROWS', pockets: [[[0, 0], [10, 0], ['x', 5]]] }),
      row({ number: 'BAD-JSON', plant: 'BAD ROWS', pockets: '[[' }),
      row({ number: 'INCH', plant: 'BAD ROWS', pockets: [rect(7620, 3000)] }),
      row({ number: 'GOOD-2', plant: 'BAD ROWS', pockets: [rect(999, 400)] }),
    ],
  };
  const warnings = [];
  const got = await f.loadCandidates(fakeClient(state), { plant: 'BAD ROWS', onWarn: (m) => warnings.push(m) });
  assert.deepEqual(got.map((c) => c.number), ['GOOD-1', 'GOOD-2']);
  assert.equal(warnings.length, 6);
  for (const n of ['NULL-POCKET', 'EMPTY-POCKET', 'TWO-POINTS', 'NAN', 'BAD-JSON']) {
    assert.ok(warnings.some((w) => w.includes(n) && /unreadable pockets/.test(w)), n);
  }
  assert.ok(warnings.some((w) => w.includes('INCH') && /over 1000 mm/.test(w)));
  assert.equal(f.MAX_POCKET_MM, 1000);
  assert.throws(() => f.candidateFromRow(row({ pockets: [null] })), /pocket 0 is not a polygon/);
  f.invalidate('BAD ROWS');
  assert.equal((await f.loadCandidates(fakeClient(state), { plant: 'BAD ROWS' })).length, 2, 'no onWarn: still skipped, never thrown');
});

test('narrow rejects by cavities, unknown cavities, NULL size class, chart, size pre-filter — and counts each', () => {
  const kept = cand({ number: 'KEEP' });
  const candidates = [
    kept,
    cand({ number: 'TWO', cavities: 2 }),
    cand({ number: 'UNK', cavities: null }),
    cand({ number: 'NOSIZE', size_class: null }),
    cand({ number: 'CHART', size_class: '460X150' }),
    cand({ number: 'SMALL', pockets: [circle(36)] }),
  ];
  const r = f.narrow(candidates, query(circle(35)), CHART);
  assert.deepEqual(r.kept.map((c) => c.number), ['KEEP']);
  assert.deepEqual(r.rejected, { cavities: 1, 'cavities-unknown': 1, 'pocket-count': 0, 'no-size-class': 1, chart: 1, 'size-prefilter': 1 });
  assert.equal(r.truncated, false);
  assert.equal(r.kept[0].chart.verdict, 'allowed');
  assert.equal(r.kept[0].chart.rows.length, 1);
  assert.equal(kept.chart, undefined, 'the cached candidate is not mutated');
});

test('NULL size class fails gate two with reason no-size-class', () => {
  const r = f.narrow([cand({ size_class: null })], query(circle(35)), CHART);
  assert.equal(r.kept.length, 0);
  assert.equal(r.rejected['no-size-class'], 1);
  assert.equal(r.rejected.chart, 0);
});

// 100 x 50 bar: a 10 mm base with 20 fins 2 mm wide, 40 mm tall, on a 5 mm pitch.
// Area 2,600 mm², outline perimeter 1,820 mm.
function heatSink() {
  const pts = [[-50, -25], [50, -25], [50, -15]];
  for (let i = 19; i >= 0; i--) {
    const x0 = -50 + i * 5 + 3; // fin i spans [x0, x0 + 2]; the last one is flush with x = 50
    if (i < 19) pts.push([x0 + 2, -15]);
    pts.push([x0 + 2, 25], [x0, 25], [x0, -15]);
  }
  pts.push([-50, -15]);
  return pts;
}

test('a non-convex profile is sized by its hull: the 20-fin heat sink is kept for a 120 x 70 pocket', () => {
  const { resampleClosed } = require('./fitGeometry.cjs');
  const sink = heatSink();
  const stats = f.profileStats(sink);
  assert.ok(Math.abs(stats.area - 2600) < 1e-6, String(stats.area));
  assert.ok(Math.abs(stats.perimeter - 1820) < 1e-6, String(stats.perimeter));
  assert.ok(stats.hullPerimeter > 280 && stats.hullPerimeter < 300, String(stats.hullPerimeter));
  // The outline-perimeter bound (2,600 + 5 x 1,820 + 25 pi = 11,779 mm²) would reject this 8,400 mm² pocket.
  assert.ok(stats.area + 5 * stats.perimeter + 25 * Math.PI > 120 * 70);
  const keep = f.narrow([cand({ number: 'POCKET', pockets: [rect(120, 70)] })], query(sink), CHART);
  assert.deepEqual(keep.kept.map((c) => c.number), ['POCKET']);
  assert.ok(!f.fitCandidate(keep.kept[0], resampleClosed(sink, 2)).reason, 'and the fit agrees');
  // 4,000 mm² with a 201 mm diagonal: too small for the hull grown by 5 mm (about 2,600 + 5 x 297 + 25 pi = 4,164 mm²).
  const small = f.narrow([cand({ number: 'TIGHT', pockets: [rect(200, 20)] })], query(sink), CHART);
  assert.equal(small.kept.length, 0);
  assert.equal(small.rejected['size-prefilter'], 1);
});

test('pocket-count: a tooling whose stored pockets differ from its cavities is rejected', () => {
  const candidates = [
    cand({ number: 'ONE-OF-TWO', cavities: 2, pockets: [circle(60)] }),
    cand({ number: 'TWO-OF-TWO', cavities: 2, pockets: [circle(60, 90, -130, 0), circle(60, 90, 130, 0)] }),
  ];
  const r = f.narrow(candidates, query(circle(35), { cavities: 2 }), CHART);
  assert.deepEqual(r.kept.map((c) => c.number), ['TWO-OF-TWO']);
  assert.equal(r.rejected['pocket-count'], 1);
  assert.equal(r.rejected.cavities, 0);
});

test('minClearance drives the pre-filter: a pocket too small at 5 mm passes at 3 mm', () => {
  const c = cand({ pockets: [circle(39)] }); // about 4 mm all round a 35 mm circle
  assert.equal(f.narrow([c], query(circle(35)), CHART).kept.length, 0);
  assert.equal(f.narrow([c], query(circle(35), { minClearance: 3 }), CHART).kept.length, 1);
});

test('no_chart keeps candidates and marks the verdict', () => {
  const candidates = [cand({ size_class: '300X100' }), cand({ size_class: '999X999' }), cand({ size_class: null })];
  const r = f.narrow(candidates, query(circle(35), { press: 'PRESS 99' }), CHART);
  assert.equal(r.kept.length, 3);
  for (const c of r.kept) assert.equal(c.chart.verdict, 'no_chart');
  assert.equal(f.narrow(candidates, query(circle(35)), []).kept.length, 3);
});

test('needsTransfer is true when the press is not among held_presses, null when held_presses is empty', () => {
  const candidates = [
    cand({ number: 'HERE', held_presses: [PRESS, 'PRESS 35'] }),
    cand({ number: 'AWAY', held_presses: ['PRESS 35'] }),
    cand({ number: 'NOWHERE', held_presses: [] }),
  ];
  const r = f.narrow(candidates, query(circle(35)), CHART);
  const by = Object.fromEntries(r.kept.map((c) => [c.number, c.needsTransfer]));
  assert.deepEqual(by, { HERE: false, AWAY: true, NOWHERE: null });
});

test('two-cavity insert: both pockets must fit and the clearance is the smaller', () => {
  const c = cand({ cavities: 2, pockets: [circle(45, 90, -60, 0), circle(50, 90, 60, 0)] });
  const r = f.fitCandidate(c, circle(35));
  assert.ok(!r.reason, JSON.stringify(r));
  assert.ok(Math.abs(r.clearance - 10) < 0.3, String(r.clearance));
  assert.equal(r.clearanceCapped, false);
  assert.equal(r.placements.length, 2);
  assert.deepEqual(r.placements.map((p) => p.pocketIndex), [0, 1]);
  assert.ok(Math.abs(r.placements[0].tx + 60) < 0.5 && Math.abs(r.placements[0].ty) < 0.5);
  assert.ok(Math.abs(r.placements[1].tx - 60) < 0.5 && Math.abs(r.placements[1].ty) < 0.5);
  assert.ok(Math.abs(r.placements[0].clearance - 10) < 0.3);
  assert.ok(Math.abs(r.placements[1].clearance - 15) < 0.3);
  assert.equal(c.grids.length, 2);
  const g0 = c.grids[0];
  assert.ok(g0 && g0.data instanceof Float32Array);
  f.fitCandidate(c, circle(35));
  assert.equal(c.grids[0], g0, 'the grid is built once and reused');
});

test('a profile that fits one pocket but not the other is no-fit', () => {
  const c = cand({ cavities: 2, pockets: [circle(45, 90, -60, 0), circle(38, 90, 60, 0)] });
  assert.deepEqual(f.fitCandidate(c, circle(35)), { reason: 'no-fit', pocketIndex: 1 });
});

test('a clearance above 50 mm is capped and flagged', () => {
  const r = f.fitCandidate(cand({ pockets: [circle(100)] }), circle(30));
  assert.equal(r.clearance, 50);
  assert.equal(r.clearanceCapped, true);
  assert.ok(Math.abs(r.rawClearance - 70) < 0.3);
});

test('rankCandidates: clearance ascending, capped last, then pocket area, then confidence', () => {
  const fitted = (number, clearance, area, confidence, clearanceCapped = false) => ({
    number, clearance, clearanceCapped, confidence, pocketStats: [{ area }],
  });
  const input = [
    fitted('CAP-A', 50, 1000, 'confirmed', true),
    fitted('B', 12, 5000, 'confirmed'),
    fitted('C2', 8, 3000, 'uncertain'),
    fitted('C1', 8, 3000, 'likely'),
    fitted('D', 8, 2000, 'uncertain'),
    fitted('E', 6, 9000, 'confirmed'),
    fitted('C0', 8, 3000, 'likely'),
  ];
  const ranked = f.rankCandidates(input);
  assert.deepEqual(ranked.map((x) => x.number), ['E', 'D', 'C0', 'C1', 'C2', 'B', 'CAP-A']);
  assert.equal(input[0].number, 'CAP-A', 'the input is not reordered');
  assert.deepEqual(f.confidenceRank, { confirmed: 0, likely: 1, uncertain: 2 });
});

test('narrow cuts at MAX_FITTED smallest pockets and reports truncated', () => {
  const n = f.MAX_FITTED + 5;
  const candidates = Array.from({ length: n }, (_, i) => cand({ number: `N${i}`, pockets: [rect(200 + (n - i), 200)] }));
  const r = f.narrow(candidates, query(circle(35)), CHART);
  assert.equal(r.kept.length, f.MAX_FITTED);
  assert.equal(r.truncated, true);
  const areas = r.kept.map((c) => c.pocketStats[0].area);
  for (let i = 1; i < areas.length; i++) assert.ok(areas[i] >= areas[i - 1]);
  assert.equal(r.kept[0].number, `N${n - 1}`, 'smallest pocket first');
  assert.ok(!r.kept.some((c) => ['N0', 'N1', 'N2', 'N3', 'N4'].includes(c.number)), 'the five largest are cut');
  assert.equal(f.MIN_CLEARANCE_MM, 5);
  assert.equal(f.CLEARANCE_CAP_MM, 50);
});

// ---- findToolings ----------------------------------------------------------

const { signatureOf } = require('./profileShape.cjs');

// A database scripted by SQL shape. Each test uses its own plant, so the
// module-level caches (candidates, similarity index) never leak between tests.
function finderClient(s) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/max\(GREATEST/.test(sql)) return { rows: [{ max_updated: 'v1', n: s.toolings.length }] };
      if (/FROM toolings t JOIN tooling_openings o/.test(sql)) return { rows: s.toolings };
      if (/FROM tooling_combinations/.test(sql)) return { rows: (s.chart || CHART).filter((r) => r.press === params[0]) };
      if (/FROM profile_shapes\s+WHERE die_no/.test(sql)) return { rows: (s.shapes || []).filter((r) => r.die_no === params[0] && r.plant === params[1]) };
      if (/max\(updated_at\)/.test(sql) && /FROM profile_shapes/.test(sql)) return { rows: [{ max_updated: 'v1', n: (s.index || []).length }] };
      if (/FROM profile_shapes WHERE plant/.test(sql)) return { rows: s.index || [] };
      if (/FROM die_tooling_links l/.test(sql)) return { rows: (s.neighbourLinks || []).filter((r) => params[0].includes(r.die_no)) };
      if (/FROM die_tooling_links\s+WHERE tooling_number = ANY/.test(sql)) return { rows: (s.links || []).filter((r) => params[0].includes(r.tooling_number)) };
      throw new Error(`unexpected query ${sql}`);
    },
  };
}

const CANDIDATE_KEYS = ['number', 'kind', 'sizeClass', 'sizeClassConfidence', 'cavities', 'heldPresses', 'needsTransfer',
  'location', 'confidence', 'clearance', 'clearanceCapped', 'placements', 'chart', 'linkedDies', 'pockets'].sort();

test('fits a profile by polygon and returns ranked candidates with links and placements', async () => {
  const plant = 'FIND A';
  const client = finderClient({
    toolings: [
      row({ number: 'WIDE', pockets: [circle(50)] }),
      row({ number: 'SNUG', pockets: [circle(45)] }),
      row({ number: 'SLOT', pockets: [rect(300, 72)] }),
    ],
    chart: [...CHART, { press: PRESS, die_size: '355X200', insert_size: '460X150', bolster_size: null, remark: null }],
    links: [
      { tooling_number: 'SNUG', die_no: 'D-1', plant, source: 'die-list' },
      { tooling_number: 'SNUG', die_no: 'D-2', plant, source: 'order-pdf' },
    ],
  });
  // Off-centre on purpose: the profile must be recentred before the fit.
  const r = await f.findToolings(client, {
    plant: 'find a', press: PRESS, dieSize: '250x200', cavities: 1, profile: { outer: circle(35, 90, 500, 300) },
  });

  assert.equal(r.query.plant, plant);
  assert.equal(r.query.press, PRESS);
  assert.equal(r.query.dieSize, DIE);
  assert.equal(r.query.cavities, 1);
  assert.equal(r.query.profile.holeCount, 0);
  assert.ok(Math.abs(r.query.profile.area - Math.PI * 35 ** 2) < 60, String(r.query.profile.area));
  assert.ok(Math.abs(r.query.profile.ccd - 70) < 0.5);
  assert.ok(r.query.profile.perimeter > 215 && r.query.profile.perimeter < 221);
  const cx = r.query.profile.points.reduce((s, p) => s + p[0], 0) / r.query.profile.points.length;
  const cy = r.query.profile.points.reduce((s, p) => s + p[1], 0) / r.query.profile.points.length;
  assert.ok(Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6, 'profile points are recentred');

  assert.equal(r.chart.basis, 'chart');
  assert.deepEqual(r.chart.rowsForDieSize, CHART);

  assert.deepEqual(r.candidates.map((c) => c.number), ['SNUG', 'WIDE']);
  const snug = r.candidates[0];
  assert.deepEqual(Object.keys(snug).sort(), CANDIDATE_KEYS);
  assert.ok(Math.abs(snug.clearance - 10) < 0.3, String(snug.clearance));
  assert.equal(snug.clearanceCapped, false);
  assert.equal(snug.placements.length, 1);
  assert.ok(Math.abs(snug.placements[0].tx) < 0.5 && Math.abs(snug.placements[0].ty) < 0.5, JSON.stringify(snug.placements[0]));
  assert.deepEqual(snug.linkedDies, [{ dieNo: 'D-1', source: 'die-list' }, { dieNo: 'D-2', source: 'order-pdf' }]);
  assert.deepEqual(snug.pockets, [circle(45)]);
  assert.deepEqual(snug.heldPresses, [PRESS]);
  assert.equal(snug.needsTransfer, false);
  assert.equal(snug.sizeClass, '300X100');
  assert.equal(snug.sizeClassConfidence, 'confirmed');
  assert.equal(snug.location, 'RACK 1');
  assert.equal(snug.chart.verdict, 'allowed');
  assert.deepEqual(snug.chart.rows, CHART);
  assert.deepEqual(r.candidates[1].linkedDies, []);

  const linkQueries = client.queries.filter((q) => /FROM die_tooling_links\s+WHERE tooling_number/.test(q.sql));
  assert.equal(linkQueries.length, 1, 'one query for all linked dies');
  assert.deepEqual(linkQueries[0].params, [['SNUG', 'WIDE']]);
  const chartQuery = client.queries.find((q) => /FROM tooling_combinations/.test(q.sql));
  assert.deepEqual(chartQuery.params, [PRESS]);
});

test("resolves the profile from a die's newest true-size row", async () => {
  const plant = 'FIND B';
  const client = finderClient({
    toolings: [row({ number: 'SNUG', pockets: [circle(45)] })],
    shapes: [{ die_no: 'DIE-9', plant, outer_mm: circle(35, 90, 200, -80), holes_mm: [], cavities: 1, hole_count: 0 }],
  });
  const r = await f.findToolings(client, { plant, press: PRESS, dieSize: DIE, cavities: 1, dieNo: 'DIE-9' });
  const q = client.queries.find((x) => /FROM profile_shapes\s+WHERE die_no/.test(x.sql));
  assert.deepEqual(q.params, ['DIE-9', plant]);
  assert.match(q.sql, /AND true_size\s+ORDER BY updated_at DESC LIMIT 1/);
  assert.deepEqual(r.candidates.map((c) => c.number), ['SNUG']);
  assert.ok(Math.abs(r.candidates[0].placements[0].tx) < 0.5);

  await assert.rejects(
    () => f.findToolings(client, { plant, press: PRESS, dieSize: DIE, cavities: 1, dieNo: 'NOPE' }),
    (err) => err.code === 'NO_PROFILE' && /no true-size profile for die NOPE/.test(err.message),
  );
});

test('no chart rows: candidates are fitted and flagged no_chart', async () => {
  const client = finderClient({
    toolings: [row({ number: 'NOSIZE', size_class: null, pockets: [circle(45)] }), row({ number: 'ODD', size_class: '999X999', pockets: [circle(50)] })],
  });
  const r = await f.findToolings(client, { plant: 'FIND C', press: 'PRESS 99', dieSize: DIE, cavities: 1, profile: { outer: circle(35) } });
  assert.equal(r.chart.basis, 'no_chart');
  assert.deepEqual(r.chart.rowsForDieSize, []);
  assert.deepEqual(r.candidates.map((c) => c.number), ['NOSIZE', 'ODD']);
  for (const c of r.candidates) assert.deepEqual(c.chart, { verdict: 'no_chart', rows: [] });
});

test('held at another press is a note, not a gate', async () => {
  const client = finderClient({
    toolings: [
      row({ number: 'AWAY', held_presses: ['PRESS 35'], pockets: [circle(45)] }),
      row({ number: 'HERE', held_presses: [PRESS], pockets: [circle(50)] }),
    ],
  });
  const r = await f.findToolings(client, { plant: 'FIND D', press: PRESS, dieSize: DIE, cavities: 1, profile: { outer: circle(35) } });
  assert.deepEqual(r.candidates.map((c) => [c.number, c.needsTransfer]), [['AWAY', true], ['HERE', false]]);
  assert.deepEqual(r.candidates[0].heldPresses, ['PRESS 35']);
});

test('similar dies carry their toolings with scope and chart reasons', async () => {
  const plant = 'FIND E';
  const link = (number, over = {}) => ({
    die_no: 'N-1', tooling_number: number, kind: 'insert', number, t_kind: 'insert', size_class: '300X100',
    status: 'active', plant, cavities: 1, confidence: 'confirmed', has_geometry: true, ...over,
  });
  const client = finderClient({
    toolings: [],
    index: [
      { id: 11, die_no: 'N-1', plant, profile_number: 'P-1', signature: signatureOf({ outer: circle(1) }), hole_count: 0, cavities: 1, true_size: true },
      { id: 12, die_no: 'N-2', plant, profile_number: null, signature: signatureOf({ outer: rect(2, 1) }), hole_count: 0, cavities: 2, true_size: false },
      { id: 13, die_no: 'N-3', plant, profile_number: null, signature: signatureOf({ outer: circle(1) }), hole_count: 1, cavities: 1, true_size: true },
    ],
    neighbourLinks: [
      link('GOOD'),
      link('RET', { status: 'retired' }),
      link('GHOST', { number: null, t_kind: null, size_class: null, status: null, plant: null, cavities: null, confidence: 'none', has_geometry: false }),
      link('ELSEWHERE', { plant: 'GEX 2' }),
      link('NOOP', { confidence: 'none', has_geometry: false }),
      link('NOPOCKETS', { confidence: 'confirmed', has_geometry: false }), // confidence set, o.pockets NULL
      link('CAV2', { cavities: 2 }),
      link('BADCHART', { size_class: '999X999' }),
      link('NOCAV', { cavities: null }),
      link('NOSIZE', { size_class: null }),
      link('BOL', { die_no: 'N-2', kind: 'bolster', t_kind: 'bolster', size_class: '600X150' }),
    ],
  });
  const r = await f.findToolings(client, { plant, press: PRESS, dieSize: DIE, cavities: 1, profile: { outer: circle(35) } });

  assert.deepEqual(r.similar.map((s) => s.dieNo), ['N-1', 'N-2'], 'hole count must match; nearest first');
  const [n1, n2] = r.similar;
  assert.deepEqual(Object.keys(n1).sort(), ['cavityMatch', 'dieNo', 'distance', 'profileNumber', 'shapeId', 'toolings', 'trueSize']);
  assert.equal(n1.profileNumber, 'P-1');
  assert.equal(n1.shapeId, 11);
  assert.equal(n1.trueSize, true);
  assert.equal(n1.cavityMatch, true);
  assert.equal(n2.cavityMatch, false);
  assert.ok(n1.distance < n2.distance);

  const by = Object.fromEntries(n1.toolings.map((t) => [t.number, t]));
  assert.deepEqual(by.GOOD, { number: 'GOOD', kind: 'insert', sizeClass: '300X100', inScope: true, hasGeometry: true, chartVerdict: 'allowed', reason: null });
  assert.equal(by.RET.reason, 'not-in-scope');
  assert.equal(by.RET.inScope, false);
  assert.equal(by.GHOST.reason, 'not-in-scope');
  assert.equal(by.GHOST.hasGeometry, false);
  assert.equal(by.ELSEWHERE.reason, 'not-in-scope');
  assert.equal(by.NOOP.reason, 'no-geometry');
  assert.equal(by.NOOP.hasGeometry, false);
  assert.equal(by.NOPOCKETS.reason, 'no-geometry');
  assert.equal(by.NOPOCKETS.hasGeometry, false);
  assert.equal(by.CAV2.reason, 'cavities');
  assert.equal(by.BADCHART.reason, 'chart');
  assert.equal(by.BADCHART.chartVerdict, 'not_allowed');
  assert.equal(by.NOCAV.reason, 'cavities', 'unknown cavities fail the gate, so never eligible');
  assert.equal(by.NOSIZE.reason, 'chart', 'no size class under a charted press fails the chart gate');
  assert.equal(by.NOSIZE.chartVerdict, 'not_allowed');
  assert.deepEqual(n2.toolings.map((t) => [t.number, t.kind, t.chartVerdict, t.reason]), [['BOL', 'bolster', 'allowed', null]]);

  const q = client.queries.find((x) => /FROM die_tooling_links l/.test(x.sql));
  assert.deepEqual(q.params, [['N-1', 'N-2']]);
  assert.match(q.sql, /l\.kind <> 'unknown'/);
  assert.match(q.sql, /o\.confidence <> 'none' AND o\.pockets IS NOT NULL\) AS has_geometry/);
});

test('timings and rejected counts are reported', async () => {
  const client = finderClient({
    toolings: [
      row({ number: 'A', pockets: [circle(45)] }),
      row({ number: 'B', pockets: [circle(50)] }),
      row({ number: 'SLOT', pockets: [rect(300, 72)] }),
      row({ number: 'TWO', cavities: 2 }),
      row({ number: 'SMALL', pockets: [circle(36)] }),
    ],
  });
  const r = await f.findToolings(client, { plant: 'FIND F', press: PRESS, dieSize: DIE, cavities: 1, profile: { outer: circle(35) }, limit: 1 });
  assert.deepEqual(r.rejected, { cavities: 1, 'cavities-unknown': 0, 'pocket-count': 0, 'no-size-class': 0, chart: 0, 'size-prefilter': 1, 'no-fit': 1 });
  assert.equal(r.fitted, 3, 'every kept candidate is fitted');
  assert.equal(r.truncated, false);
  assert.deepEqual(r.candidates.map((c) => c.number), ['A'], 'limit cuts the list after ranking');
  assert.deepEqual(r.similar, []);
  for (const k of ['narrowMs', 'fitMs', 'totalMs']) {
    assert.ok(Number.isInteger(r.timings[k]) && r.timings[k] >= 0, `${k}=${r.timings[k]}`);
  }
  assert.ok(r.timings.totalMs >= r.timings.fitMs);
  assert.deepEqual(Object.keys(r).sort(), ['candidates', 'chart', 'fitted', 'query', 'rejected', 'similar', 'timings', 'truncated']);
});

test('the queried die is left out of its own similar list', async () => {
  const plant = 'FIND G';
  const client = finderClient({
    toolings: [],
    shapes: [{ die_no: 'SELF', plant, outer_mm: circle(35), holes_mm: [], cavities: 1, hole_count: 0 }],
    index: [
      { id: 21, die_no: 'SELF', plant, profile_number: null, signature: signatureOf({ outer: circle(1) }), hole_count: 0, cavities: 1, true_size: true },
      { id: 22, die_no: 'N-1', plant, profile_number: null, signature: signatureOf({ outer: rect(2, 1) }), hole_count: 0, cavities: 1, true_size: true },
    ],
  });
  const r = await f.findToolings(client, { plant, press: PRESS, dieSize: DIE, cavities: 1, dieNo: 'SELF', similarLimit: 1 });
  assert.deepEqual(r.similar.map((s) => s.dieNo), ['N-1'], 'SELF would be at distance 0 and take the only slot');
});

test('a press that is not canonical is refused with BAD_PRESS', async () => {
  const client = finderClient({ toolings: [] });
  for (const press of ['P25', '25', '', undefined]) {
    await assert.rejects(
      () => f.findToolings(client, { plant: 'FIND H', press, dieSize: DIE, cavities: 1, profile: { outer: circle(35) } }),
      (err) => err.code === 'BAD_PRESS',
    );
  }
  assert.equal(client.queries.length, 0, 'refused before any query');
});

test('a posted polygon with a dieNo: the polygon is the profile and the die is still left out of similar', async () => {
  const plant = 'FIND I';
  const client = finderClient({
    toolings: [],
    shapes: [{ die_no: 'SELF', plant, outer_mm: rect(300, 10), holes_mm: [], cavities: 1, hole_count: 0 }],
    index: [
      { id: 31, die_no: 'SELF', plant, profile_number: null, signature: signatureOf({ outer: circle(1) }), hole_count: 0, cavities: 1, true_size: true },
      { id: 32, die_no: 'N-1', plant, profile_number: null, signature: signatureOf({ outer: rect(2, 1) }), hole_count: 0, cavities: 1, true_size: true },
    ],
  });
  const r = await f.findToolings(client, { plant, press: PRESS, dieSize: DIE, cavities: 1, profile: { outer: circle(35) }, dieNo: 'SELF', similarLimit: 1 });
  assert.deepEqual(r.similar.map((s) => s.dieNo), ['N-1']);
  assert.ok(Math.abs(r.query.profile.ccd - 70) < 0.5, 'the polygon, not the stored 300 x 10 shape, is the profile');
  assert.ok(!client.queries.some((q) => /FROM profile_shapes\s+WHERE die_no/.test(q.sql)), 'the stored shape is not read');
});

test('minClearance reaches the fit and is echoed: a pocket that fails at 5 mm passes at 3 mm', async () => {
  const client = finderClient({ toolings: [row({ number: 'NEAR', pockets: [circle(39)] })] });
  const at = (extra) => f.findToolings(client, { plant: 'FIND J', press: PRESS, dieSize: DIE, cavities: 1, profile: { outer: circle(35) }, ...extra });
  const five = await at({});
  assert.equal(five.query.minClearance, 5);
  assert.deepEqual(five.candidates, []);
  const three = await at({ minClearance: 3 });
  assert.equal(three.query.minClearance, 3);
  assert.deepEqual(three.candidates.map((c) => c.number), ['NEAR']);
  assert.ok(Math.abs(three.candidates[0].clearance - 4) < 0.3, String(three.candidates[0].clearance));
  // The fit gate on its own, past the pre-filter.
  const c = () => f.candidateFromRow(row({ pockets: [circle(39)] }));
  assert.equal(f.fitCandidate(c(), circle(35)).reason, 'no-fit');
  assert.ok(!f.fitCandidate(c(), circle(35), { minClearance: 3 }).reason);
});

test('findToolings logs a skipped tooling (an inch drawing) and still answers with the rest', async () => {
  const client = finderClient({ toolings: [row({ number: 'INCH', pockets: [rect(7620, 3000)] }), row({ number: 'SNUG', pockets: [circle(45)] })] });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => { warned.push(m); };
  let r;
  try {
    r = await f.findToolings(client, { plant: 'FIND K', press: PRESS, dieSize: DIE, cavities: 1, profile: { outer: circle(35) } });
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(r.candidates.map((c) => c.number), ['SNUG']);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^tooling finder: tooling INCH .* over 1000 mm/);
});
