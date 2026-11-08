'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { dxfPathFor, planConversions, scriptText, convertOne, convertAll } = require('./dwgConvert.cjs');

const ROOT = path.join('C:', 'dxf');
const file = (rel) => ({ absPath: path.join('C:', 'arc', rel), relPath: rel, stem: path.basename(rel, '.dwg'), ext: 'dwg', plant: 'GEX 1', kindHint: 'insert' });

// In-memory fs fake: a Map of path -> size.
function makeFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    statSync: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return { size: files.get(p) }; },
    mkdirSync: () => {},
    writeFileSync: (p, text) => files.set(p, String(text).length),
    unlinkSync: (p) => { files.delete(p); },
  };
}

// Fake spawner: behaviour(child, args) decides what happens.
function fakeSpawn(behaviour) {
  return (exe, args) => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    setImmediate(() => behaviour(child, args));
    return child;
  };
}

test('scriptText is CRLF and ends with QUIT then Y', () => {
  assert.equal(scriptText('C:\\out\\a.dxf'), 'FILEDIA\r\n0\r\n_.DXFOUT\r\n"C:\\out\\a.dxf"\r\n16\r\n_.QUIT\r\nY\r\n');
});

test('planConversions skips DXFs newer than their DWG', () => {
  const a = file('x/a.dwg');
  const b = file('x/b.dwg');
  const mtimes = {
    [a.absPath]: 100, [dxfPathFor(a, ROOT)]: 200, // up to date
    [b.absPath]: 300, [dxfPathFor(b, ROOT)]: 250, // stale
  };
  const statLike = (p) => { if (!(p in mtimes)) throw new Error('ENOENT'); return { mtimeMs: mtimes[p], size: 10 }; };
  const plan = planConversions([a, b], ROOT, statLike);
  assert.equal(plan.done, 1);
  assert.deepEqual(plan.todo.map((f) => f.relPath), ['x/b.dwg']);
  assert.equal(dxfPathFor(a, ROOT), path.join(ROOT, 'x/a.dxf'));
});

test('convertOne reports ok only when the exit code is 0 and the DXF appeared', async () => {
  const f = file('x/a.dwg');
  const dxf = dxfPathFor(f, ROOT);

  const fsOk = makeFs();
  const ok = await convertOne(f, ROOT, { exe: 'acc', fsLike: fsOk, spawn: fakeSpawn((c) => { fsOk.files.set(dxf, 500); c.emit('exit', 0); }) });
  assert.equal(ok.ok, true);
  assert.equal(fsOk.files.has(dxf.replace(/\.dxf$/, '.scr')), false, 'script is cleaned up');

  const fsNone = makeFs();
  const noFile = await convertOne(f, ROOT, { exe: 'acc', fsLike: fsNone, spawn: fakeSpawn((c) => c.emit('exit', 0)) });
  assert.equal(noFile.ok, false);

  const fsBad = makeFs();
  const bad = await convertOne(f, ROOT, { exe: 'acc', fsLike: fsBad, spawn: fakeSpawn((c) => c.emit('exit', 1)) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /exit/);
});

test('convertOne kills a hung process after the timeout', async () => {
  let child;
  const r = await convertOne(file('x/a.dwg'), ROOT, {
    exe: 'acc', fsLike: makeFs(), timeoutMs: 10,
    spawn: (...a) => { child = fakeSpawn(() => {})(...a); return child; },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
  assert.equal(child.killed, true);
});

test('convertAll runs at most `concurrency` at once and collects failures', async () => {
  const files = Array.from({ length: 7 }, (_, i) => file(`x/f${i}.dwg`));
  const fsx = makeFs();
  let running = 0;
  let peak = 0;
  const spawn = fakeSpawn((child, args) => {
    running++; peak = Math.max(peak, running);
    const dwg = args[1];
    setTimeout(() => {
      running--;
      if (dwg.endsWith('f3.dwg')) return child.emit('exit', 1);
      fsx.files.set(dxfPathFor(files.find((f) => f.absPath === dwg), ROOT), 100);
      child.emit('exit', 0);
    }, 15);
  });
  const progress = [];
  const res = await convertAll(files, ROOT, { concurrency: 3, exe: 'acc', fsLike: fsx, spawn, onProgress: (p) => progress.push(p) });
  assert.equal(peak, 3);
  assert.equal(res.converted, 6);
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].relPath, 'x/f3.dwg');
  assert.equal(progress.length, 7);
  assert.deepEqual(progress[6], { done: 7, total: 7, failed: 1 });
});
