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
  assert.deepEqual(r.rejected, { cavities: 1, 'cavities-unknown': 1, 'no-size-class': 1, chart: 1, 'size-prefilter': 1 });
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
