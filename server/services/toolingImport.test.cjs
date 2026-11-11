'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const toolingFinder = require('./toolingFinder.cjs');
const review = require('./toolingReview.cjs');
const imp = require('./toolingImport.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'tooling', 'dieshop-21599.dxf');

// A tiny in-memory toolings table behind the SQL the import sends.
function fakeDb(initial = []) {
  const table = new Map(initial.map((t) => [t.number, { ...t }]));
  const calls = [];
  let nextId = 100;
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/^SELECT id, number, kind, plant, size_class/.test(sql)) return { rows: params[0].filter((n) => table.has(n)).map((n) => ({ ...table.get(n) })) };
    if (/^SELECT \* FROM toolings WHERE number = \$1/.test(sql)) return { rows: table.has(params[0]) ? [{ ...table.get(params[0]) }] : [] };
    if (/^INSERT INTO toolings/.test(sql)) {
      if (table.has(params[0])) return { rows: [], rowCount: 0 };
      const row = { id: nextId++, number: params[0], kind: params[1], plant: params[2], size_class: params[3], cavities: params[6], location: params[7], notes: params[9], status: 'active' };
      table.set(row.number, row);
      return { rows: [row], rowCount: 1 };
    }
    if (/^UPDATE toolings SET\s+size_class_source/.test(sql) && /WHERE number = \$1/.test(sql)) {
      const t = table.get(params[0]);
      t.size_class = t.size_class ?? params[1]; t.cavities = t.cavities ?? params[2];
      t.location = t.location || params[3]; t.notes = t.notes || params[4];
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE toolings SET\s+size_class_source/.test(sql) && /WHERE id = \$1/.test(sql)) return { rows: [], rowCount: 1 };
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (/^INSERT INTO tooling_drawings/.test(sql)) return { rows: [{ id: 55, tooling_id: params[0], file_path: params[1] }], rowCount: 1 };
    if (/^INSERT INTO tooling_openings/.test(sql)) return { rows: [{ id: 3, confidence: params[5] }], rowCount: 1 };
    throw new Error(`unexpected query ${sql}`);
  };
  return { query, calls, table };
}
const fakeIo = () => {
  const written = new Map();
  return { written, io: { exists: (p) => written.has(p), mkdirp() {}, writeFile: (p, b) => written.set(p, b) } };
};
function quietFinder(t) {
  const real = toolingFinder.invalidate;
  const seen = [];
  toolingFinder.invalidate = (p) => seen.push(p);
  t.after(() => { toolingFinder.invalidate = real; });
  return seen;
}

test('normaliseRow canonicalises the number and checks every field', () => {
  assert.deepEqual(imp.normaliseRow({ number: ' i 21599 ', sizeClass: 'Ø175 x 80', cavities: '2', location: ' Rack 4 ', notes: '' }),
    { number: 'I-21599', kind: 'insert', plant: 'GEX 1', sizeClass: '175X80', cavities: 2, location: 'Rack 4', notes: null });
  assert.deepEqual(imp.normaliseRow({ number: '25IC2-090454' }),
    { number: '25IC2-090454', kind: 'insert', plant: 'GEX 2', sizeClass: null, cavities: 2, location: null, notes: null });
  assert.equal(imp.normaliseRow({ number: 'BOL-4-6-B', plant: 'gex 01', kind: 'Bol' }).plant, 'GEX 1');
  assert.equal(imp.normaliseRow({ number: 'BOL-4-6-B' }, { defaultPlant: 'GEX 2' }).plant, 'GEX 2');
  assert.match(imp.normaliseRow({ number: 'BOL-4-6-B' }).error, /plant is needed/);
  assert.match(imp.normaliseRow({ number: '' }).error, /no tooling number/);
  assert.match(imp.normaliseRow({ number: 'hello' }).error, /not an insert or bolster number/);
  assert.match(imp.normaliseRow({ number: 'I-21599', kind: 'bolster' }).error, /contradicts the number/);
  assert.match(imp.normaliseRow({ number: 'I-21599', kind: 'ring' }).error, /not insert or bolster/);
  assert.match(imp.normaliseRow({ number: 'I-21599', plant: 'GEX 9' }).error, /not GEX 1 or GEX 2/);
  assert.match(imp.normaliseRow({ number: 'I-21599', sizeClass: 'big' }).error, /must look like 175X80/);
  assert.match(imp.normaliseRow({ number: 'I-21599', cavities: '1.5' }).error, /whole number/);
});

test('planRows: new toolings are added, blanks filled, existing values kept, repeats refused; nothing is written', async () => {
  const db = fakeDb([
    { id: 1, number: 'I-21599', kind: 'insert', plant: 'GEX 1', size_class: '175X80', cavities: null, location: '', notes: null },
    { id: 2, number: 'I-30000', kind: 'insert', plant: 'GEX 1', size_class: '220X80', cavities: 1, location: 'A1', notes: 'x' },
  ]);
  const plan = await imp.planRows(db, [
    { number: 'I-40000', sizeClass: '300x100' },
    { number: 'I-21599', sizeClass: '220X80', cavities: 2, location: 'Rack 4' },
    { number: 'I-30000', sizeClass: '220 x 80', cavities: 1, location: 'a1' },
    { number: 'i-40000' },
    { number: 'nonsense' },
  ]);
  assert.deepEqual(plan.map((p) => p.action), ['create', 'fill', 'same', 'error', 'error']);
  assert.deepEqual(plan[1].fills, ['cavities', 'location']);
  assert.deepEqual(plan[1].kept, ['size class 175X80 (sheet: 220X80)']);
  assert.deepEqual(plan[2].kept, []);
  assert.match(plan[3].message, /more than once/);
  assert.ok(db.calls.every((c) => /^SELECT/.test(c.sql)));
  await assert.rejects(imp.planRows(db, new Array(imp.MAX_ROWS + 1).fill({ number: 'I-1' })), { status: 400 });
});

test('applyRows adds and fills blanks only; one bad row does not stop the rest', async (t) => {
  const seen = quietFinder(t);
  const db = fakeDb([{ id: 1, number: 'I-21599', kind: 'insert', plant: 'GEX 1', size_class: '175X80', cavities: null, location: null, notes: null }]);
  const out = await imp.applyRows(db, [
    { number: 'I-21599', sizeClass: '220X80', cavities: 2, location: 'Rack 4' },
    { number: 'bad' },
    { number: 'BOL-4-6-B', plant: 'GEX 1', sizeClass: '475x220' },
  ], { userId: 9 });
  assert.deepEqual(out.map((o) => o.action), ['fill', 'error', 'create']);
  assert.deepEqual(db.table.get('I-21599'), { id: 1, number: 'I-21599', kind: 'insert', plant: 'GEX 1', size_class: '175X80', cavities: 2, location: 'Rack 4', notes: null });
  const fill = db.calls.find((c) => /^UPDATE toolings/.test(c.sql));
  assert.match(fill.sql, /size_class = COALESCE\(size_class, \$2\)/);
  assert.match(fill.sql, /location = COALESCE\(NULLIF\(trim\(location\), ''\), \$4\)/);
  assert.equal(db.table.get('BOL-4-6-B').size_class, '475X220');
  assert.deepEqual([...new Set(seen)], ['GEX 1']);
});

test('targetFromName follows the drawing-archive rules, plus a bare-number meaning and exact numbers', () => {
  assert.deepEqual(imp.targetFromName('C:\\x\\14017 Bol(475x220).dxf'), { number: 'BOL-14017', kind: 'bolster', plant: 'GEX 1', sizeClass: '475X220' });
  assert.deepEqual(imp.targetFromName('25IC2-090454.pdf'), { number: '25IC2-090454', kind: 'insert', plant: 'GEX 2', sizeClass: null });
  assert.deepEqual(imp.targetFromName('21599.dxf'), { skip: 'unrecognised' });
  assert.equal(imp.targetFromName('21599.dxf', { bareNumbers: 'insert' }).number, 'I-21599');
  assert.equal(imp.targetFromName('21599.dxf', { bareNumbers: 'bolster' }).number, 'BOL-21599');
  assert.equal(imp.targetFromName('I-2B.dxf').number, 'I-2B');
  assert.deepEqual(imp.targetFromName('13477-SCRAP.dxf'), { skip: 'scrap' });
});

test('planDrawings sorts file names into attach / new / lookup / skipped / convert / unsupported', async () => {
  const db = fakeDb([{ id: 1, number: 'I-21599', kind: 'insert', plant: 'GEX 1' }]);
  const plan = await imp.planDrawings(db, ['21599-Ins.dxf', 'INS-30000.pdf', 'INS-30001.pdf', 'keys.pdf', '14017-Bol.dwg', 'notes.txt', 'EYEBOLTM16.pdf'],
    { sheetNumbers: ['I-30001'] });
  assert.deepEqual(plan.map((p) => [p.state, p.number || null]),
    [['attach', 'I-21599'], ['new', 'I-30000'], ['attach', 'I-30001'], ['lookup', null], ['convert', null], ['unsupported', null], ['skipped', null]]);
  assert.equal(plan[3].message, 'no tooling number in the name — looked up in the drawing');
  assert.equal(plan[6].message, 'a press part, not an insert or bolster');
});

test('importDrawing files a drawing under its tooling and fills the master blanks from a sure opening', async (t) => {
  quietFinder(t);
  const buffer = fs.readFileSync(FIXTURE);
  const db = fakeDb([{ id: 1, number: 'I-21599', kind: 'insert', plant: 'GEX 1', size_class: null, cavities: null }]);
  const { io, written } = fakeIo();
  const out = await imp.importDrawing(db, { buffer, originalName: '21599-Ins.dxf', root: '/store', io });
  assert.deepEqual({ number: out.number, created: out.created, basis: out.basis, extracted: out.extracted, openingKept: out.openingKept },
    { number: 'I-21599', created: false, basis: 'file-name', extracted: 'confirmed', openingKept: false });
  assert.deepEqual(out.filled, ['size class 175X80', 'cavities 1']);
  assert.equal(written.size, 1);
  const fill = db.calls.find((c) => /^UPDATE toolings/.test(c.sql));
  assert.deepEqual(fill.params, [1, '175X80', 'confirmed', 1]);
});

test('importDrawing: a missing tooling is refused unless asked for; then it is added from the file name', async (t) => {
  quietFinder(t);
  const buffer = fs.readFileSync(FIXTURE);
  const db = fakeDb();
  const { io, written } = fakeIo();
  await assert.rejects(imp.importDrawing(db, { buffer, originalName: 'INS-21599 (175x80).dxf', root: '/store', io }),
    { status: 404, message: 'I-21599 is not in the tooling master' });
  assert.equal(written.size, 0);
  const out = await imp.importDrawing(db, { buffer, originalName: 'INS-21599 (175x80).dxf', createMissing: true, root: '/store', io });
  assert.equal(out.created, true);
  assert.equal(db.table.get('I-21599').size_class, '175X80');
  assert.equal(db.table.get('I-21599').notes, 'added with drawing INS-21599 (175x80).dxf');
});

test('importDrawing reads the tooling number from the drawing when the file name has none', async (t) => {
  quietFinder(t);
  const buffer = fs.readFileSync(FIXTURE); // its title block names I-21599
  const db = fakeDb([{ id: 1, number: 'I-21599', kind: 'insert', plant: 'GEX 1', size_class: '175X80', cavities: 1 }]);
  const { io } = fakeIo();
  const out = await imp.importDrawing(db, { buffer, originalName: 'scan0042.dxf', root: '/store', io });
  assert.equal(out.number, 'I-21599');
  assert.equal(out.basis, 'drawing-text');
  assert.deepEqual(out.filled, []);
});

test('importDrawing: a given number wins; a drawing that names another tooling is kept uncertain', async (t) => {
  quietFinder(t);
  const buffer = fs.readFileSync(FIXTURE);
  const db = fakeDb([{ id: 4, number: 'I-30000', kind: 'insert', plant: 'GEX 1', size_class: null, cavities: null }]);
  const { io } = fakeIo();
  const out = await imp.importDrawing(db, { buffer, originalName: '21599-Ins.dxf', number: 'i-30000', root: '/store', io });
  assert.equal(out.number, 'I-30000');
  assert.equal(out.basis, 'given');
  assert.equal(out.extracted, 'uncertain');
  assert.ok(out.notes.includes('drawing names I-21599, not I-30000'));
  assert.deepEqual(out.filled, [], 'an uncertain opening fills nothing');
  await assert.rejects(imp.importDrawing(db, { buffer, originalName: 'a.dxf', number: 'zzz', root: '/store', io }), { status: 400 });
  await assert.rejects(imp.importDrawing(db, { buffer, originalName: 'EYEBOLTM16.dxf', root: '/store', io }), { status: 422 });
  await assert.rejects(imp.importDrawing(db, { buffer, originalName: 'a.dwg', root: '/store', io }), { status: 400 });
});

test('attachDrawing without fillMaster never writes the toolings row', async (t) => {
  quietFinder(t);
  const db = fakeDb();
  const { io } = fakeIo();
  const tooling = { id: 1, number: 'I-21599', plant: 'GEX 1', size_class: null, cavities: null };
  const out = await review.attachDrawing(db, tooling, { buffer: fs.readFileSync(FIXTURE), originalName: 'I-21599.dxf', root: '/store', io });
  assert.deepEqual(out.filled, []);
  assert.ok(!db.calls.some((c) => /^UPDATE toolings/.test(c.sql)));
});
