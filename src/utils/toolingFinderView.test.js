import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finderChecklist, dieSizeKey, matchDieSize, sizeClassText, openingSizes, openingText, profileSizeText, chartCheck, chartSummary,
  placedProfile, overlayViewBox, svgPath, candidateTags, candidateMeta, linkedDiesText,
  similarCards, similarOnlyCards, applyChoice, finderReadiness, rejectedSummary,
  sourceLabel, similarMeta, similarFromItems,
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
  heldPresses: ['PRESS 7'], needsTransfer: false, location: 'Rack B3', confidence: 'confirmed', extractionSource: 'dxf',
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
    'ok:Clears by 6.8 mm', 'ok:Chart: allowed PRESS 7 / 250X140', 'muted:Rack B3', 'ok:opening from DXF (confirmed)',
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
    'warn:held at PRESS 2, PRESS 3, needs transfer', 'ok:opening from DXF (confirmed)']);
  assert.equal(texts(candidateTags(cand({ needsTransfer: false }), ctx)).filter((x) => x.includes('held')).length, 0);
  const n = texts(candidateTags(cand({ needsTransfer: null, heldPresses: [], location: null }), ctx));
  assert.deepEqual(n, ['ok:Clears by 6.8 mm', 'ok:Chart: allowed PRESS 7 / 250X140', 'muted:location unknown',
    'muted:held press unknown', 'ok:opening from DXF (confirmed)']);
});

test('candidateTags: likely and uncertain confidence', () => {
  assert.deepEqual(candidateTags(cand({ confidence: 'likely', extractionSource: 'pdf-vector' }), ctx).at(-1),
    { text: 'opening from PDF (likely)', tone: 'muted' });
  assert.deepEqual(candidateTags(cand({ confidence: 'uncertain', extractionSource: 'pdf-raster' }), ctx).at(-1),
    { text: 'opening from PDF trace (uncertain) — needs review', tone: 'warn' });
  assert.deepEqual(candidateTags(cand({ confidence: 'confirmed', extractionSource: 'manual' }), ctx).at(-1),
    { text: 'opening from manual entry (confirmed)', tone: 'ok' });
  assert.deepEqual(candidateTags(cand({ extractionSource: null }), ctx).at(-1),
    { text: 'opening from unknown source (confirmed)', tone: 'ok' });
  assert.deepEqual(candidateTags(cand({ extractionSource: undefined }), ctx).at(-1),
    { text: 'opening from unknown source (confirmed)', tone: 'ok' }, 'an older response without the field');
  assert.equal(candidateTags(cand({ confidence: 'none' }), ctx).length, 3, 'no tag for a confidence it does not know');
});

test('sourceLabel names every extraction source', () => {
  assert.deepEqual(['dxf', 'pdf-vector', 'pdf-raster', 'manual', null, undefined, ''].map(sourceLabel),
    ['DXF', 'PDF', 'PDF trace', 'manual entry', 'unknown source', 'unknown source', 'unknown source']);
  assert.equal(sourceLabel('ocr'), 'ocr', 'an unlisted source is shown as stored');
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
  const list = Array.from({ length: 20 }, (_, i) => sim(`D-${i}`, [], { profileNumber: `P${i}` }));
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

test('similarCards fills meta from dieMeta when the caller knows the die', () => {
  const known = { 'N-1': 'PRESS 7 · 250X140 · 2 cav' };
  const cards = similarCards([sim('N-1'), sim('N-2', [], { profileNumber: 'P2' })], 8, (dieNo) => known[dieNo] ?? null);
  assert.deepEqual(cards.map((c) => c.meta), ['PRESS 7 · 250X140 · 2 cav', null]);
  assert.equal(similarCards([sim('N-1')])[0].meta, null);
});

test('similarCards builds meta from the item die-list fields; dieMeta overrides when it answers', () => {
  const items = [
    sim('N-1', [], { press: 'PRESS 6', dieSize: '450X250', cavity: 3 }),
    sim('N-2', [], { press: null, dieSize: '320X160', cavity: null }),
    sim('N-3', [], { press: null, dieSize: null, cavity: null }),
  ];
  assert.deepEqual(similarCards(items).map((c) => c.meta), ['PRESS 6 · 450X250 · 3 cav', '320X160', null]);
  const override = similarCards(items, 8, (dieNo) => (dieNo === 'N-1' ? 'from the caller' : null));
  assert.deepEqual(override.map((c) => c.meta), ['from the caller', '320X160', null]);
  assert.equal(similarMeta({ press: ' PRESS 2 ', dieSize: '', cavity: 0 }), 'PRESS 2 · 0 cav');
  assert.equal(similarMeta(null), null);
});

test('similarFromItems maps the /profile-shapes/similar items to the strip shape', () => {
  const [a, b] = similarFromItems([
    { die_no: 'N_1', profile_number: 'P-1', distance: 0.2, cavityMatch: false, trueSize: false, shapeId: 4,
      toolings: [st('I-1')], dieSize: '250X160', press: 'PRESS 5', cavity: 2, ccd: 181.6, outline: { outer: [[0, 0], [1, 0], [0, 1]], holes: [] } },
    { die_no: 'N_2', distance: 0.3 },
  ]);
  assert.deepEqual(a, { dieNo: 'N_1', profileNumber: 'P-1', distance: 0.2, cavityMatch: false, trueSize: false, shapeId: 4,
    toolings: [st('I-1')], dieSize: '250X160', press: 'PRESS 5', cavity: 2, ccd: 181.6, outline: { outer: [[0, 0], [1, 0], [0, 1]], holes: [] } });
  assert.deepEqual(b, { dieNo: 'N_2', profileNumber: null, distance: 0.3, cavityMatch: null, trueSize: false, shapeId: null,
    toolings: [], dieSize: null, press: null, cavity: null, ccd: null, outline: null });
  assert.equal(similarCards([a])[0].meta, 'PRESS 5 · 250X160 · 2 cav');
  const [card] = similarCards([a]);
  assert.deepEqual([card.ccd, card.dieSize, card.press, card.cavity], [181.6, '250X160', 'PRESS 5', 2], 'the strip states CCD and die size');
  assert.deepEqual(card.outline, a.outline, 'and draws the profile');
  assert.deepEqual([similarCards([b])[0].ccd, similarCards([b])[0].outline], [null, null]);
  assert.deepEqual(similarFromItems(undefined), []);
});

test('similarOnlyCards: similar-list toolings not among the candidates, deduped, with reason text', () => {
  const similar = [
    sim('N-1', [st('I-1'), st('I-2', { reason: 'cavities' }), st('I-3')]),
    sim('N-2', [st('I-2', { reason: 'cavities' }), st('I-4', { reason: 'no-geometry' }), st('I-5', { reason: 'not-in-scope' }), st('I-6', { reason: 'chart' })]),
  ];
  const out = similarOnlyCards(similar, [cand({ number: 'I-1' })]);
  assert.deepEqual(out.map((o) => [o.number, o.dieNo, o.reasonText]), [
    ['I-2', 'N-1', 'Cavity count differs — shown because the shape is similar'],
    ['I-3', 'N-1', 'Not among the ranked fits — shown because the shape is similar'],
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

test('finder readiness: an unscaled profile with a unit outline runs the similarity route only', () => {
  const unit = [[0, 0], [1, 0], [1, 1]];
  const ok = { profile: { true_size: false, outer_unit: unit }, press: 'P7', dieSize: '250X140', cavities: 2, plant: 'GEX 1' };
  const unscaled = 'profile size unknown — fit needs a scale or CCD';
  assert.deepEqual(finderReadiness(ok), { ready: false, reason: unscaled, similarityOnly: true });
  // Any other input missing: no similarity mode either; the size reason stays first.
  for (const over of [{ press: '' }, { dieSize: null }, { cavities: 0 }, { plant: '' }]) {
    assert.deepEqual(finderReadiness({ ...ok, ...over }), { ready: false, reason: unscaled }, JSON.stringify(over));
  }
  // No usable unit outline.
  for (const outer_unit of [undefined, null, [], [[0, 0], [1, 1]]]) {
    assert.deepEqual(finderReadiness({ ...ok, profile: { true_size: false, outer_unit } }), { ready: false, reason: unscaled });
  }
  // A true-size profile is never similarity-only.
  assert.deepEqual(finderReadiness({ ...ok, profile: { true_size: true, outer_unit: unit } }), { ready: true, reason: null });
});

test('rejectedSummary lists the non-zero reasons, largest first, and the cap', () => {
  const r = { cavities: 3, 'cavities-unknown': 0, 'pocket-count': 1, 'no-size-class': 0, chart: 7, 'size-prefilter': 0, 'no-fit': 2 };
  assert.equal(rejectedSummary(r, false), '13 rejected: 7 chart, 3 cavities, 2 no fit, 1 pocket count');
  assert.equal(rejectedSummary({ cavities: 0, chart: 0 }, true), '(capped at 400 candidates)');
  assert.equal(rejectedSummary({ 'size-prefilter': 4, 'cavities-unknown': 1, 'no-size-class': 1 }, true),
    '6 rejected: 4 too small, 1 cavities unknown, 1 no size class (capped at 400 candidates)');
  assert.equal(rejectedSummary(null, false), '');
});

test('finderChecklist says what Find tooling still waits on', () => {
  const states = (list) => Object.fromEntries(list.map((i) => [i.key, i.state]));
  const full = { plant: 'GEX 1', press: 'PRESS 6', dieSize: '450X250', cavities: '2' };
  assert.deepEqual(states(finderChecklist({})), { plant: 'todo', press: 'todo', dieSize: 'todo', cavities: 'todo', profile: 'todo' });
  assert.deepEqual(states(finderChecklist({ ...full, cavities: '0' })).cavities, 'todo');
  const done = finderChecklist({ ...full, profile: { true_size: true, ccd_mm: 181.6 } });
  assert.deepEqual(states(done), { plant: 'ok', press: 'ok', dieSize: 'ok', cavities: 'ok', profile: 'ok' });
  assert.equal(done[4].note, 'true size · CCD 182 mm');
  assert.equal(done[1].note, 'PRESS 6');
  // Unscaled: usable for similar dies only.
  assert.equal(finderChecklist({ ...full, profile: { true_size: false } })[4].state, 'warn');
  // No profile yet: the form's own note, busy while the trace runs.
  const busy = finderChecklist({ ...full, profileNote: 'reading the profile…', profileBusy: true })[4];
  assert.deepEqual([busy.state, busy.note], ['busy', 'reading the profile…']);
  assert.equal(finderChecklist(full)[4].note, 'not read yet');
});

test('matchDieSize finds a typed die size among the chart sizes of a press', () => {
  const sizes = ['150X120', '302.5X160', '302.5X180'];
  assert.equal(dieSizeKey(' ø302.5 x 160 '), '302.5X160');
  assert.equal(dieSizeKey('302.50×160'), '302.5X160');
  assert.equal(matchDieSize('Ø302.5 X 160', sizes), '302.5X160');
  assert.equal(matchDieSize('150x120', sizes), '150X120');
  assert.equal(matchDieSize('305X160', sizes), null);
  assert.equal(matchDieSize('', sizes), null);
  assert.equal(matchDieSize('302.5X160'), null);
});

test('a suggestion states its size and its opening', () => {
  const box = (w, h, x = 0) => [[x, 0], [x + w, 0], [x + w, h], [x, h]];
  assert.equal(sizeClassText('460X150'), 'Ø460 × 150 mm');
  assert.equal(sizeClassText('302.5x160'), 'Ø302.5 × 160 mm');
  assert.equal(sizeClassText('SPECIAL'), 'SPECIAL');
  assert.equal(sizeClassText(null), null);
  assert.deepEqual(openingSizes([box(181.6, 64.2), [[0, 0], [1, 1]]]), [{ w: 182, h: 64 }], 'a pocket that is not a polygon is left out');
  assert.equal(openingText([box(182, 64)]), '182 × 64 mm');
  assert.equal(openingText([box(90, 40), box(90, 40, 100)]), '2 openings, 90 × 40 mm each');
  assert.equal(openingText([box(90, 40), box(80, 30, 100)]), '2 openings: 90 × 40, 80 × 30 mm');
  assert.equal(openingText([]), null);
  assert.equal(profileSizeText(box(120, 35)), '120 × 35 mm');
  assert.equal(profileSizeText(null), null);
});

test('chartCheck says what the combination chart decided for one suggestion', () => {
  const ctx = { press: 'PRESS 6', dieSize: '355X200', chartBasis: 'chart' };
  const rows = [{ insert_size: '460X150', bolster_size: '700X196' }, { insert_size: '460X150', bolster_size: '700X250' }, { insert_size: '460X150', bolster_size: '700X196' }];
  assert.deepEqual(chartCheck({ kind: 'insert', sizeClass: '460X150', chart: { verdict: 'allowed', rows } }, ctx), {
    tone: 'ok', text: 'Insert 460X150 is allowed on PRESS 6 for die 355X200', detail: 'The chart pairs it with bolster 700X196 or 700X250',
  });
  const bolster = chartCheck({ kind: 'bolster', sizeClass: '700X196', chart: { verdict: 'allowed', rows: [{ insert_size: null, bolster_size: '700X196' }] } }, ctx);
  assert.deepEqual([bolster.text, bolster.detail], ['Bolster 700X196 is allowed on PRESS 6 for die 355X200', null]);
  assert.equal(chartCheck({ kind: 'insert', sizeClass: '999X9', chart: { verdict: 'not_allowed', rows: [] } }, ctx).tone, 'no');
  const none = chartCheck({ kind: 'insert', sizeClass: '460X150' }, { press: 'PRESS 7', dieSize: '250X140', chartBasis: 'no_chart' });
  assert.deepEqual([none.tone, none.text], ['warn', 'Not checked: the chart has no rows for PRESS 7']);
  assert.equal(chartCheck({ kind: 'insert' }, ctx), null);
});

test('chartSummary says what the chart allows for the press and die size', () => {
  const q = { press: 'PRESS 6', dieSize: '355X200' };
  const rows = [
    { insert_size: '460X150', bolster_size: '700X196', remark: null },
    { insert_size: '300X100', bolster_size: null, remark: '' },
    { insert_size: '999X999', bolster_size: '900X300', remark: ' Hold ' },
  ];
  const ok = chartSummary({ basis: 'chart', rowsForDieSize: rows }, q);
  assert.equal(ok.tone, 'ok');
  assert.equal(ok.text, 'Chart for PRESS 6 with die 355X200 allows insert 300X100, 460X150 · bolster 700X196.');
  const off = chartSummary({ basis: 'chart', rowsForDieSize: [rows[2]] }, q);
  assert.equal(off.tone, 'no', 'only a HOLD row: nothing is allowed');
  assert.match(off.text, /Die size 355X200 is not on the tooling combination chart for PRESS 6/);
  assert.equal(chartSummary({ basis: 'no_chart', rowsForDieSize: [] }, q).tone, 'warn');
  assert.equal(chartSummary(null, q), null);
});

test('similarCards lists one profile once per press, die size, cavities and toolings', () => {
  const die = (dieNo, over = {}, toolings = [st('BOL-A')]) => sim(dieNo, toolings, {
    profileNumber: '13794', press: 'PRESS 6', dieSize: '355X200', cavity: 2, ...over,
  });
  const cards = similarCards([
    die('13794_624'),
    die('13794_625', { dieSize: '355 x 200', press: 'press 6' }), // the same, written differently
    die('13794_623', { cavity: 3 }),
    die('13794_284', { press: 'PRESS 2' }, []),
    die('13794_286', { press: 'PRESS 2' }),
    die('13794_285', { press: 'PRESS 2' }),
    die('13794_524', { dieSize: '250X160' }),
    die('99999_601', { profileNumber: '99999' }),
    sim('X-1', [], { profileNumber: null, press: 'PRESS 6' }),
    sim('X-2', [], { profileNumber: null, press: 'PRESS 6' }),
  ]);
  assert.deepEqual(cards.map((c) => [c.dieNo, c.otherDies]), [
    ['13794_624', ['13794_625']],
    ['13794_623', []],
    ['13794_284', []],
    ['13794_286', ['13794_285']],
    ['13794_524', []],
    ['99999_601', []],
    ['X-1', []],
    ['X-2', []],
  ], 'cavities, die size, press, tooling or profile differing keeps a card; no profile number never merges');
  const many = Array.from({ length: 12 }, (_, i) => die(`D_${i}`));
  assert.equal(similarCards([...many, die('LAST', { cavity: 1 })]).length, 2, 'merged before the cap, so later profiles still show');
});
