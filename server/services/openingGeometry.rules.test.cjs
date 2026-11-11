'use strict';
// The reading rules added with the mass import: shorter centre lines, pocket-only drawings, stepped pockets and
// minor features beside a known number of cavities.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLoops, normaliseFrame, gradeConfidence } = require('./openingGeometry.cjs');

const seg = (x1, y1, x2, y2) => ({ layer: '0', points: [[x1, y1], [x2, y2]], closed: false, source: 'LINE' });
const circle = (cx, cy, r, n = 64) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
const rect = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
// A rectangle with its corners cut off: a plain rectangle holding everything would be read as a sheet frame.
const chamfered = (w, h, c = 35) => [[-w / 2 + c, -h / 2], [w / 2 - c, -h / 2], [w / 2, -h / 2 + c], [w / 2, h / 2 - c],
  [w / 2 - c, h / 2], [-w / 2 + c, h / 2], [-w / 2, h / 2 - c], [-w / 2, -h / 2 + c]];
const translate = (points, dx, dy) => points.map(([x, y]) => [x + dx, y + dy]);
const loop = (points) => ({ points, layer: '0', bridgedGaps: 0, sources: [] });

test('centre lines between 40 % and 60 % of the diameter centre the outer only when they cross near the pockets', () => {
  const pocket = loop(rect(250, 150));
  const short = [seg(-111, 0, 111, 0), seg(0, -143, 0, 143)]; // 222 and 286 mm against Ø475
  const r = classifyLoops([pocket], { expectedOuterDiameter: 475, openChains: short });
  assert.equal(r.outerBasis, 'synthesised-centre-lines');
  // the same lines down in the title block, 400 mm from the pocket, are not centre lines
  const away = short.map((c) => ({ ...c, points: translate(c.points, 0, -400) }));
  assert.equal(classifyLoops([pocket], { expectedOuterDiameter: 475, openChains: away }).outerBasis, 'synthesised-bbox');
});

test('a pocket-only drawing: centre lines on the pockets give patternCentre and a likely grade; stray symbols go', () => {
  const pockets = [loop(translate(rect(70, 60), 46, 42)), loop(translate(rect(70, 60), -46, 42)),
    loop(translate(rect(70, 60), 46, -42)), loop(translate(rect(70, 60), -46, -42))];
  const symbol = loop(translate(rect(17, 18), 90, -260));
  const lines = [seg(-85, 3, 85, 3), seg(2, -82, 2, 82)];
  const r = classifyLoops([...pockets, symbol], { openChains: lines });
  assert.equal(r.outer, null);
  assert.equal(r.pockets.length, 4);
  assert.deepEqual(r.ignored.map((i) => i.reason), ['stray-symbol']);
  assert.deepEqual(r.patternCentre.map(Math.round), [2, 3]);
  const grade = (centred, scaleBasis = 'native-mm') => gradeConfidence({
    outer: null, outerSynthesised: false, pockets: r.pockets.map((p) => p.points), bridged: 0, source: 'dxf',
    statedDiameter: null, knownCavities: null, scaleBasis, centred,
  });
  assert.deepEqual(grade(true), { confidence: 'likely', notes: ['no outer outline; pockets centred on the drawn centre lines'] });
  assert.equal(grade(false).confidence, 'uncertain');
  assert.equal(grade(true, 'text-diameter').confidence, 'uncertain', 'only a drawing in its own units');
  const framed = normaliseFrame({ outer: null, pockets: r.pockets, centre: r.patternCentre });
  assert.deepEqual(framed.offset, r.patternCentre);
  // a small loop among the pockets is not a stray symbol: it stays, for the small-pocket check to flag
  const among = classifyLoops([...pockets, loop(rect(12, 12))], { openChains: lines });
  assert.equal(among.pockets.length, 5);
  // without centre lines there is no pattern centre
  assert.equal(classifyLoops(pockets, {}).patternCentre, null);
});

test('stepped pockets: the recess holding exactly the promised number of openings is not a pocket', () => {
  const outer = loop(circle(0, 0, 150));
  const recess = loop(chamfered(220, 200));
  const openings = [loop(translate(rect(107, 65), 0, 44)), loop(translate(rect(107, 65), 0, -46))];
  const stamp = loop(translate(rect(66, 21), 0, 118));
  const all = [outer, recess, ...openings, stamp];
  const plain = classifyLoops(all, { expectedOuterDiameter: 300 });
  assert.deepEqual(plain.pockets, [recess, stamp], 'without the pointer the openings are nested and dropped');
  assert.equal(plain.pocketsInferred, false);
  const r = classifyLoops(all, { expectedOuterDiameter: 300, steppedPockets: 2 });
  assert.deepEqual(r.pockets, openings);
  assert.equal(r.pocketsInferred, true);
  assert.ok(r.notes.includes('recess holding 2 openings is not a pocket; the openings are (1 other loop ignored)'));
  assert.deepEqual(r.ignored.map((i) => i.reason).filter((x) => /step/.test(x)).sort(), ['beside-step', 'step']);
  // a different number of openings than promised: nothing is inferred
  const three = classifyLoops(all, { expectedOuterDiameter: 300, steppedPockets: 3 });
  assert.deepEqual(three.pockets, [recess, stamp]);
  // a smaller loop that happens to hold the right number is not the recess
  const decoy = [outer, loop(translate(rect(110, 100), -65, 0)), loop(translate(rect(60, 40), -65, 0)), loop(translate(rect(110, 110), 60, 0))];
  assert.equal(classifyLoops(decoy, { expectedOuterDiameter: 300, steppedPockets: 1 }).pocketsInferred, false);
});

test('more loops than known cavities: alike largest loops are the pockets when the rest are far smaller', () => {
  const outer = loop(circle(0, 0, 150));
  const pocket = loop(rect(125, 75));
  const slots = [loop(translate(rect(40, 21), 0, 80)), loop(translate(rect(40, 21), 0, -80))];
  const r = classifyLoops([outer, pocket, ...slots], { expectedOuterDiameter: 300, knownCavities: 1 });
  assert.deepEqual(r.pockets, [pocket]);
  assert.equal(r.pocketsInferred, true);
  assert.ok(r.notes.includes('2 smaller loops beside the 1 pocket ignored (not cavities)'));
  // an extra loop of comparable size is a real disagreement and is left for the reviewer
  const rival = classifyLoops([outer, loop(translate(rect(100, 60), 0, 40)), loop(translate(rect(90, 40), 0, -50))], { expectedOuterDiameter: 300, knownCavities: 1 });
  assert.equal(rival.pockets.length, 2);
  assert.equal(rival.pocketsInferred, false);
  // unlike "pockets" (the second under half the first) are not taken as two cavities
  const unlike = classifyLoops([outer, loop(translate(rect(100, 60), 0, 40)), loop(translate(rect(40, 30), 0, -50)), loop(translate(rect(10, 8), 60, -60))], { expectedOuterDiameter: 300, knownCavities: 2 });
  assert.equal(unlike.pockets.length, 3);
});
