const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDxf, flattenDxf, plainText } = require('./dxfReader.cjs');
const { dxfOf, line, arc, circleEntity, lwpolyline, insert } = require('./fixtures/tooling/dxfBuilders.cjs');
const { chainLoops, circleFit } = require('./openingGeometry.cjs');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'tooling', n), 'utf8');

test('parses the Dieshop fixture into header, blocks and entities', () => {
  const dxf = parseDxf(fixture('dieshop-21599.dxf'));
  assert.equal(dxf.header.insunits, 4);
  const byType = {}; for (const e of dxf.entities) byType[e.type] = (byType[e.type] || 0) + 1;
  assert.equal(byType.CIRCLE, 2); assert.equal(byType.LWPOLYLINE, 5); assert.equal(byType.TEXT, 13); assert.equal(byType.MTEXT, 1);
  assert.ok(dxf.blocks.size >= 1);
});

test('flattens the Dieshop fixture: circles closed, the pocket polyline keeps its bulge arcs, texts are plain', () => {
  const { chains, texts, unitScale } = flattenDxf(parseDxf(fixture('dieshop-21599.dxf')));
  assert.equal(unitScale, 1);
  const circles = chains.filter((c) => c.source === 'CIRCLE');
  assert.equal(circles.length, 2);
  assert.ok(circles.every((c) => c.closed && c.points.length >= 32));
  const pocket = chains.find((c) => c.source === 'LWPOLYLINE' && c.points.length > 30); // 26 vertices + 18 bulges flattened
  assert.ok(pocket, 'the bulged polyline was flattened into many points');
  assert.ok(texts.some((t) => t.value === 'Ø175 x 80'));
  assert.ok(texts.some((t) => t.value === '21599'));
});

test('flattens the bolster fixture: six lines and four quarter arcs, MTEXT split on \\P', () => {
  const { chains, texts } = flattenDxf(parseDxf(fixture('bolster-14017.dxf')));
  assert.equal(chains.filter((c) => c.source === 'LINE').length, 6);
  assert.equal(chains.filter((c) => c.source === 'ARC').length, 4);
  const arc = chains.find((c) => c.source === 'ARC');
  assert.ok(arc.points.length >= 8);
  const r = Math.hypot(arc.points[0][0] - -110, arc.points[0][1] - -60); // first arc centre (-110,-60) r 15
  assert.ok(Math.abs(r - 15) < 1e-6);
  assert.ok(texts.some((t) => t.value === 'BOL-14017 475X220'));
});

test('expands INSERT block references with translation, scale and rotation', () => {
  const text = dxfOf({ blocks: { SQ: [line(0, 0, 10, 0), line(10, 0, 10, 10)] }, entities: [insert('SQ', 100, 50, 2, 90)] });
  const { chains } = flattenDxf(parseDxf(text));
  assert.equal(chains.length, 2);
  // (10,0) scaled ×2 then rotated 90° → (0,20), translated → (100,70)
  assert.deepEqual(chains[0].points[1].map((v) => Math.round(v)), [100, 70]);
});

test('arcs flatten within 0.1 mm chord deviation and 8 segments per quadrant', () => {
  const { chains } = flattenDxf(parseDxf(dxfOf({ entities: [arc(0, 0, 100, 0, 90)] })));
  assert.ok(chains[0].points.length >= 9);
  for (let i = 1; i < chains[0].points.length; i++) {
    const [ax, ay] = chains[0].points[i - 1], [bx, by] = chains[0].points[i];
    const mid = Math.hypot((ax + bx) / 2, (ay + by) / 2);
    assert.ok(100 - mid <= 0.1 + 1e-9);
  }
});

test('inch drawings report unitScale 25.4', () => {
  assert.equal(flattenDxf(parseDxf(dxfOf({ insunits: 1, entities: [line(0, 0, 1, 0)] }))).unitScale, 25.4);
});

test('plainText strips MTEXT codes and maps %% symbols', () => {
  assert.equal(plainText('{\\fTimes New Roman|b0|i0|c0|p18;ALL DIMENSIONS ARE IN MM.}'), 'ALL DIMENSIONS ARE IN MM.');
  assert.equal(plainText('%%C300X100 INSERT'), 'Ø300X100 INSERT');
  assert.equal(plainText('{\\W0.83;\\p;BOLSTER DIA.475xH.220^M\\P\\p;\\P}'), 'BOLSTER DIA.475xH.220');
});

// Largest distance from the true circle/arc (centre origin, radius r) to any chord midpoint, in mm.
const maxSagittaMm = (points, r, scale) => {
  let worst = 0;
  for (let i = 1; i < points.length; i++) {
    const mid = Math.hypot((points[i - 1][0] + points[i][0]) / 2, (points[i - 1][1] + points[i][1]) / 2);
    worst = Math.max(worst, (r - mid) * scale);
  }
  return worst;
};

test('large radii are refined until the chord deviation is within 0.1 mm', () => {
  const { chains } = flattenDxf(parseDxf(dxfOf({ entities: [arc(0, 0, 5000, 0, 90)] })));
  assert.ok(chains[0].points.length > 100);
  assert.ok(maxSagittaMm(chains[0].points, 5000, 1) <= 0.1 + 1e-9);
});

test('inch drawings meet 0.1 mm once multiplied by unitScale', () => {
  const { chains, unitScale } = flattenDxf(parseDxf(dxfOf({ insunits: 1, entities: [circleEntity(0, 0, 10)] })));
  assert.equal(unitScale, 25.4);
  const pts = [...chains[0].points, chains[0].points[0]];
  assert.ok(maxSagittaMm(pts, 10, unitScale) <= 0.1 + 1e-9);
});

test('arcs inside a scaled block meet 0.1 mm after the INSERT scale', () => {
  const text = dxfOf({ blocks: { A: [arc(0, 0, 100, 0, 90)] }, entities: [insert('A', 0, 0, 10, 0)] });
  const { chains } = flattenDxf(parseDxf(text));
  assert.ok(maxSagittaMm(chains[0].points, 1000, 1) <= 0.1 + 1e-9);
});

// ---------- OCS extrusion normal (group 230) ----------

const flat = (entities, opts) => flattenDxf(parseDxf(dxfOf({ entities })), opts);

test('a mirrored ARC lands on the world-space side', () => {
  // OCS arc centre (10, 0), r 5, 0..180 runs (15,0) -> (10,5) -> (5,0); world x = -OCS x.
  const { chains } = flat([arc(10, 0, 5, 0, 180, { normal: -1 })]);
  const pts = chains[0].points;
  assert.ok(pts.every(([x, y]) => x >= -15 - 1e-9 && x <= -5 + 1e-9 && y >= -1e-9));
  const ends = [pts[0], pts[pts.length - 1]].sort((a, b) => a[0] - b[0]);
  assert.ok(Math.abs(ends[0][0] + 15) < 1e-9 && Math.abs(ends[0][1]) < 1e-9);
  assert.ok(Math.abs(ends[1][0] + 5) < 1e-9 && Math.abs(ends[1][1]) < 1e-9);
});

test('a mirrored CIRCLE is centred at the mirrored centre', () => {
  const { chains } = flat([circleEntity(10, 0, 5, { normal: -1 })]);
  const fit = circleFit(chains[0].points);
  assert.ok(Math.abs(fit.cx + 10) < 1e-6 && Math.abs(fit.cy) < 1e-6);
});

test('a mirrored LWPOLYLINE mirrors x and flips bulges', () => {
  // Bottom edge (0,0)->(10,0) bulging below (positive bulge, CCW) in OCS; the mirror image bows below too.
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const up = flat([lwpolyline(pts, { closed: true, bulges: [0.5] })]).chains[0].points;
  const mir = flat([lwpolyline(pts, { closed: true, bulges: [0.5], normal: -1 })]).chains[0].points;
  const lowest = (p) => p.reduce((m, q) => (q[1] < m[1] ? q : m));
  assert.ok(lowest(up)[1] < -1 && lowest(mir)[1] < -1, 'bow stays on the same (lower) side');
  assert.ok(Math.abs(lowest(mir)[0] + 5) < 0.5, 'bow midpoint is at the mirrored x');
  assert.ok(mir.every(([x]) => x <= 1e-9));
});

test('a mirrored pocket chains closed', () => {
  // Rounded rectangle 40 x 20 (corner r 5) centred at world x = 40, so a missed mirror cannot close by symmetry.
  // Arcs are authored in the -1 OCS: centre x negated, angles reflected (start' = 180 - end, end' = 180 - start).
  const n = { normal: -1 };
  const entities = [
    line(25, 10, 55, 10), line(25, -10, 55, -10), line(60, -5, 60, 5), line(20, -5, 20, 5),
    arc(-25, 5, 5, 0, 90, n), arc(-55, 5, 5, 90, 180, n), arc(-55, -5, 5, 180, 270, n), arc(-25, -5, 5, 270, 360, n),
  ];
  const { chains } = flat(entities);
  assert.equal(chainLoops(chains).loops.length, 1);
});

test('a tilted normal warns once and leaves coordinates untouched', () => {
  const tilted = arc(10, 0, 5, 0, 180, { normal: [0.5, 0, 0.866] });
  const warnings = [];
  const { chains } = flat([tilted], { onWarn: (m) => warnings.push(m) });
  assert.deepEqual(warnings, ['entity on a tilted OCS left untransformed']);
  const xs = chains[0].points.map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - 15) < 1e-9 && Math.abs(Math.min(...xs) - 5) < 1e-9);
});

const ellipseEntity = (cx, cy, mx, my, ratio, t0, t1, normal) =>
  `0
ELLIPSE
8
0
10
${cx}
20
${cy}
11
${mx}
21
${my}
40
${ratio}
41
${t0}
42
${t1}
` +
  (normal === undefined ? '' : `210
0
220
0
230
${normal}
`);

test('an ELLIPSE is a WCS entity: a -1 normal does not move its centre or major axis', () => {
  const { chains } = flat([ellipseEntity(40, 10, 20, 0, 0.5, 0, 2 * Math.PI, -1)]);
  const xs = chains[0].points.map((p) => p[0]), ys = chains[0].points.map((p) => p[1]);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(near((Math.max(...xs) + Math.min(...xs)) / 2, 40) && near((Math.max(...ys) + Math.min(...ys)) / 2, 10));
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 40) && near(Math.max(...ys) - Math.min(...ys), 20));
});

test('a half ELLIPSE on a -1 normal sweeps the other way: the minor-axis side flips', () => {
  const up = flat([ellipseEntity(40, 10, 20, 0, 0.5, 0, Math.PI, 1)]).chains[0].points;
  const mir = flat([ellipseEntity(40, 10, 20, 0, 0.5, 0, Math.PI, -1)]).chains[0].points;
  assert.ok(up.every(([, y]) => y >= 10 - 1e-9));
  assert.ok(mir.every(([, y]) => y <= 10 + 1e-9));
  const cx = (p) => (Math.max(...p.map((q) => q[0])) + Math.min(...p.map((q) => q[0]))) / 2;
  assert.ok(Math.abs(cx(up) - 40) < 1e-6 && Math.abs(cx(mir) - 40) < 1e-6);
});

test('an INSERT on a mirrored or tilted OCS warns (it is not transformed)', () => {
  for (const normal of [-1, [0.5, 0, 0.866]]) {
    const warnings = [];
    flattenDxf(parseDxf(dxfOf({ blocks: { SQ: [line(0, 0, 10, 0)] }, entities: [insert('SQ', 100, 50, 1, 0, { normal })] })),
      { onWarn: (m) => warnings.push(m) });
    assert.deepEqual(warnings, ['block reference on a mirrored or tilted OCS left untransformed'], JSON.stringify(normal));
  }
  const quiet = [];
  flattenDxf(parseDxf(dxfOf({ blocks: { SQ: [line(0, 0, 10, 0)] }, entities: [insert('SQ', 100, 50)] })), { onWarn: (m) => quiet.push(m) });
  assert.deepEqual(quiet, []);
});
