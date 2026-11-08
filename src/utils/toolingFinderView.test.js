import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placedProfile, overlayViewBox, svgPath, candidateTags, candidateMeta, linkedDiesText,
  similarCards, similarOnlyCards, applyChoice, finderReadiness, rejectedSummary,
} from './toolingFinderView.js';

const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach(([x, y], i) => {
    assert.ok(Math.abs(x - expected[i][0]) < 1e-9 && Math.abs(y - expected[i][1]) < 1e-9,
      `point ${i}: got [${x}, ${y}], want [${expected[i]}]`);
  });
};

const cand = (over = {}) => ({
  number: 'I-12999', kind: 'insert', sizeClass: '460X150', sizeClassConfidence: 'confirmed', cavities: 2,
  heldPresses: ['PRESS 7'], needsTransfer: false, location: 'Rack B3', confidence: 'confirmed',
  clearance: 6.84, clearanceCapped: false,
  placements: [{ pocketIndex: 0, theta: 0, tx: 0, ty: 0, clearance: 6.84 }],
  chart: { verdict: 'allowed', rows: [] },
  linkedDies: [{ dieNo: '110634-2501', source: 'die-list' }, { dieNo: '118802-2502', source: 'die-list' }],
  pockets: [[[-10, -5], [10, -5], [10, 5], [-10, 5]]],
  ...over,
});
const ctx = { press: 'PRESS 7', dieSize: '250X140', chartBasis: 'chart' };
const texts = (tags) => tags.map((t) => `${t.tone}:${t.text}`);

test('placedProfile rotates then translates', () => {
  // A quarter turn takes (1,0) to (0,1), (0,1) to (-1,0), (2,3) to (-3,2); then shift by (10, 20).
  near(placedProfile([[1, 0], [0, 1], [2, 3]], { pocketIndex: 0, theta: Math.PI / 2, tx: 10, ty: 20 }),
    [[10, 21], [9, 20], [7, 22]]);
  // theta 0: a pure translation.
  near(placedProfile([[1, 2]], { theta: 0, tx: -1, ty: 1 }), [[0, 3]]);
  assert.deepEqual(placedProfile(null, { theta: 0, tx: 0, ty: 0 }), []);
});

test('overlayViewBox pads the pocket bbox, with y negated for the flipped group', () => {
  // Two pockets: bbox x -20..20 (w 40), y -5..15 (h 20); 10 % pad = 4 and 2.
  const vb = overlayViewBox([[[-20, -5], [0, 0]], [[20, 15], [5, 5]]]);
  assert.deepEqual(vb, { minX: -24, minY: -17, width: 48, height: 24 });
  assert.deepEqual(overlayViewBox([[[0, 0], [10, 10]]], 0), { minX: 0, minY: -10, width: 10, height: 10 });
  assert.equal(overlayViewBox([]), null);
  assert.equal(overlayViewBox(null), null);
});

test('a placed profile lands inside the pocket box of the viewBox', () => {
  // A circle of radius 5 placed at (30, -12) in a 20 x 20 pocket centred there.
  const circle = Array.from({ length: 24 }, (_, i) => [5 * Math.cos(i * Math.PI / 12), 5 * Math.sin(i * Math.PI / 12)]);
  const pocket = [[20, -22], [40, -22], [40, -2], [20, -2]];
  const placed = placedProfile(circle, { theta: 1.1, tx: 30, ty: -12 });
  const vb = overlayViewBox([pocket]);
  assert.deepEqual(vb, { minX: 18, minY: 0, width: 24, height: 24 });
  for (const [x, y] of placed) {
    // The screen point after scale(1,-1) is (x, -y); it must fall inside the viewBox.
    assert.ok(x >= vb.minX && x <= vb.minX + vb.width, `x ${x}`);
    assert.ok(-y >= vb.minY && -y <= vb.minY + vb.height, `y ${y}`);
    assert.ok(x > 20 && x < 40 && y > -22 && y < -2, 'inside the pocket');
  }
});

test('svgPath closes the polygon and rounds to 0.01', () => {
  assert.equal(svgPath([[0, 0], [10.123, 0], [10, 5.5]]), 'M0 0 L10.12 0 L10 5.5 Z');
  assert.equal(svgPath([]), '');
  assert.equal(svgPath(null), '');
});

test('candidateTags: allowed chart, location, held at the press, confirmed', () => {
  assert.deepEqual(texts(candidateTags(cand(), ctx)), [
    'ok:Clears by 6.8 mm', 'ok:Chart: allowed PRESS 7 / 250X140', 'muted:Rack B3', 'ok:opening confirmed',
  ]);
});

test('candidateTags: not allowed, no chart, capped and tight clearance', () => {
  assert.deepEqual(candidateTags(cand({ chart: { verdict: 'not_allowed' } }), ctx)[1], { text: 'Chart: not allowed', tone: 'no' });
  assert.deepEqual(candidateTags(cand({ chart: { verdict: 'no_chart' } }), { ...ctx, chartBasis: 'no_chart' })[1],
    { text: 'Chart: no chart for this press', tone: 'warn' });
  // The basis wins when a candidate carries no verdict of its own.
  assert.deepEqual(candidateTags(cand({ chart: null }), { ...ctx, chartBasis: 'no_chart' })[1],
    { text: 'Chart: no chart for this press', tone: 'warn' });
  assert.deepEqual(candidateTags(cand({ clearance: 50, clearanceCapped: true }), ctx)[0], { text: 'Clears by > 50 mm', tone: 'muted' });
  assert.deepEqual(candidateTags(cand({ clearance: 3.24 }), ctx)[0], { text: 'Clears by 3.2 mm (under 5)', tone: 'warn' });
  assert.deepEqual(candidateTags(cand({ clearance: 4.97 }), ctx)[0], { text: 'Clears by 5.0 mm (under 5)', tone: 'warn' });
  assert.deepEqual(candidateTags(cand({ clearance: 5 }), ctx)[0], { text: 'Clears by 5.0 mm', tone: 'ok' });
});

test('candidateTags: needsTransfer true / false / null and unknown location', () => {
  const t = texts(candidateTags(cand({ needsTransfer: true, heldPresses: ['PRESS 2', 'PRESS 3'] }), ctx));
  assert.deepEqual(t, ['ok:Clears by 6.8 mm', 'ok:Chart: allowed PRESS 7 / 250X140', 'muted:Rack B3',
    'warn:held at PRESS 2, PRESS 3, needs transfer', 'ok:opening confirmed']);
  assert.equal(texts(candidateTags(cand({ needsTransfer: false }), ctx)).filter((x) => x.includes('held')).length, 0);
  const n = texts(candidateTags(cand({ needsTransfer: null, heldPresses: [], location: null }), ctx));
  assert.deepEqual(n, ['ok:Clears by 6.8 mm', 'ok:Chart: allowed PRESS 7 / 250X140', 'muted:location unknown',
    'muted:held press unknown', 'ok:opening confirmed']);
});

test('candidateTags: likely and uncertain confidence', () => {
  assert.deepEqual(candidateTags(cand({ confidence: 'likely' }), ctx).at(-1), { text: 'opening likely', tone: 'muted' });
  assert.deepEqual(candidateTags(cand({ confidence: 'uncertain' }), ctx).at(-1), { text: 'opening uncertain — needs review', tone: 'warn' });
});

test('candidateMeta and linkedDiesText', () => {
  assert.equal(candidateMeta(cand()), 'Insert · 460X150 · 2 cav');
  assert.equal(candidateMeta(cand({ kind: 'bolster', sizeClass: null, cavities: null })), 'Bolster · size unknown · cav unknown');
  assert.equal(linkedDiesText(cand()), 'Currently used by 110634-2501, 118802-2502');
  const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((dieNo) => ({ dieNo, source: 'die-list' }));
  assert.equal(linkedDiesText(cand({ linkedDies: many })), 'Currently used by A, B, C (+3 more)');
  assert.equal(linkedDiesText(cand({ linkedDies: [] })), 'Not linked to a die');
  assert.equal(linkedDiesText(cand({ linkedDies: undefined })), 'Not linked to a die');
});

const sim = (dieNo, toolings = [], over = {}) => ({ dieNo, profileNumber: 'P', distance: 0.1, cavityMatch: true, trueSize: true, shapeId: 1, toolings, ...over });
const st = (number, over = {}) => ({ number, kind: 'insert', sizeClass: '300X100', inScope: true, hasGeometry: true, chartVerdict: 'allowed', reason: null, ...over });

test('similarCards caps at 8 and tags scope', () => {
  const list = Array.from({ length: 20 }, (_, i) => sim(`D-${i}`));
  assert.deepEqual(similarCards(list).map((s) => s.dieNo), ['D-0', 'D-1', 'D-2', 'D-3', 'D-4', 'D-5', 'D-6', 'D-7']);
  assert.equal(similarCards(list, 3).length, 3);
  assert.deepEqual(similarCards(null), []);
  const [card] = similarCards([sim('N-1', [
    st('GOOD'),
    st('OLD', { inScope: false, reason: 'not-in-scope' }),
    st('BLANK', { hasGeometry: false, reason: 'no-geometry' }),
    st('TWO', { reason: 'cavities' }),
    st('NOPE', { chartVerdict: 'not_allowed', reason: 'chart' }),
    st('NOSIZE', { sizeClass: null }),
  ], { distance: 0.25, cavityMatch: null })]);
  assert.equal(card.dieNo, 'N-1');
  assert.equal(card.distance, 0.25);
  assert.equal(card.cavityMatch, null);
  assert.equal(card.meta, null);
  assert.deepEqual(card.toolings.map((t) => `${t.number}:${t.tag}:${t.tone}`), [
    'GOOD:in scope:ok', 'OLD:not in scope:muted', 'BLANK:no geometry:muted',
    'TWO:cavities differ:warn', 'NOPE:chart: not allowed:no', 'NOSIZE:size unknown:muted',
  ]);
  assert.equal(card.toolings[0].kind, 'insert');
});

test('similarOnlyCards: similar-list toolings not among the candidates, deduped, with reason text', () => {
  const similar = [
    sim('N-1', [st('I-1'), st('I-2', { reason: 'cavities' }), st('I-3')]),
    sim('N-2', [st('I-2', { reason: 'cavities' }), st('I-4', { reason: 'no-geometry' }), st('I-5', { reason: 'not-in-scope' }), st('I-6', { reason: 'chart' })]),
  ];
  const out = similarOnlyCards(similar, [cand({ number: 'I-1' })]);
  assert.deepEqual(out.map((o) => [o.number, o.dieNo, o.reasonText]), [
    ['I-2', 'N-1', 'Cavity count differs — shown because the shape is similar'],
    ['I-3', 'N-1', 'Did not fit — shown because the shape is similar'],
    ['I-4', 'N-2', 'Opening not known — shown because the shape is similar'],
    ['I-5', 'N-2', 'Not in scope (retired, unknown or other plant) — shown because the shape is similar'],
    ['I-6', 'N-2', 'Chart: not allowed — shown because the shape is similar'],
  ]);
  assert.equal(out[0].kind, 'insert');
  assert.equal(out[0].sizeClass, '300X100');
  assert.equal(out[0].reason, 'cavities');
  assert.deepEqual(similarOnlyCards(null, null), []);
});

test('applyChoice fills one pair and keeps the other', () => {
  const start = { INSERT_NO: '', INSERT_SIZE: '', BOLSTER_NO: 'BOL-OLD', BOLSTER_SIZE: '600X200', DIE_SIZE: '250X140' };
  const a = applyChoice(start, cand({ number: 'I-12999', kind: 'insert', sizeClass: '460X150' }));
  assert.deepEqual(a.values, { ...start, INSERT_NO: 'I-12999', INSERT_SIZE: '460X150' });
  assert.deepEqual(a.chosen, { tooling: 'I-12999', kind: 'insert', fromFinder: true });
  assert.equal(start.INSERT_NO, '', 'input not mutated');
  // A bolster after the insert fills the bolster pair and leaves the insert pair as it was.
  const b = applyChoice(a.values, cand({ number: 'BOL-77', kind: 'bolster', sizeClass: null }));
  assert.deepEqual(b.values, { ...start, INSERT_NO: 'I-12999', INSERT_SIZE: '460X150', BOLSTER_NO: 'BOL-77', BOLSTER_SIZE: '' });
  assert.deepEqual(b.chosen, { tooling: 'BOL-77', kind: 'bolster', fromFinder: true });
  // A kind it cannot place changes nothing.
  const u = applyChoice(start, cand({ kind: 'unknown' }));
  assert.deepEqual(u, { values: start, chosen: null });
});

test('finder readiness explains why it cannot run', () => {
  const ok = { profile: { true_size: true }, press: 'P7', dieSize: '250X140', cavities: 2, plant: 'GEX 1' };
  assert.deepEqual(finderReadiness(ok), { ready: true, reason: null });
  assert.deepEqual(finderReadiness({ ...ok, cavities: '2' }), { ready: true, reason: null });
  assert.deepEqual(finderReadiness({ ...ok, profile: null }), { ready: false, reason: 'no profile yet' });
  assert.deepEqual(finderReadiness({ ...ok, profile: { true_size: false }, press: '' }),
    { ready: false, reason: 'profile size unknown — fit needs a scale or CCD' });
  assert.deepEqual(finderReadiness({ ...ok, press: ' ' }), { ready: false, reason: 'press missing' });
  assert.deepEqual(finderReadiness({ ...ok, dieSize: null, cavities: 0 }), { ready: false, reason: 'die size missing' });
  for (const cavities of [0, -1, 1.5, '', 'two', null, '2.5']) {
    assert.deepEqual(finderReadiness({ ...ok, cavities }), { ready: false, reason: 'cavities missing' }, String(cavities));
  }
  assert.deepEqual(finderReadiness({ ...ok, plant: undefined }), { ready: false, reason: 'plant missing' });
});

test('rejectedSummary lists the non-zero reasons, largest first, and the cap', () => {
  const r = { cavities: 3, 'cavities-unknown': 0, 'pocket-count': 1, 'no-size-class': 0, chart: 7, 'size-prefilter': 0, 'no-fit': 2 };
  assert.equal(rejectedSummary(r, false), '13 rejected: 7 chart, 3 cavities, 2 no fit, 1 pocket count');
  assert.equal(rejectedSummary({ cavities: 0, chart: 0 }, true), '(capped at 400 candidates)');
  assert.equal(rejectedSummary({ 'size-prefilter': 4, 'cavities-unknown': 1, 'no-size-class': 1 }, true),
    '6 rejected: 4 too small, 1 cavities unknown, 1 no size class (capped at 400 candidates)');
  assert.equal(rejectedSummary(null, false), '');
});
