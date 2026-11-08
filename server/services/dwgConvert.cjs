'use strict';
// DWG -> DXF conversion through AutoCAD's headless core console (accoreconsole.exe).
// Pure apart from the injectable spawn / fs; the tests never touch AutoCAD.

const childProcess = require('node:child_process');
const nodeFs = require('node:fs');
const path = require('node:path');

const DEFAULT_ACCORECONSOLE = 'C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe';

function dxfPathFor(file, dxfRoot) {
  return path.join(dxfRoot, file.relPath.replace(/\.dwg$/i, '.dxf'));
}

// A DWG needs converting unless a non-empty DXF exists that is at least as new as the DWG.
function planConversions(files, dxfRoot, statLike) {
  const todo = [];
  let done = 0;
  for (const f of files) {
    let upToDate = false;
    try {
      const dxf = statLike(dxfPathFor(f, dxfRoot));
      upToDate = dxf.size > 0 && dxf.mtimeMs >= statLike(f.absPath).mtimeMs;
    } catch { upToDate = false; }
    if (upToDate) done++; else todo.push(f);
  }
  return { todo, done };
}

function scriptText(dxfPath) {
  return ['FILEDIA', '0', '_.DXFOUT', `"${dxfPath}"`, '16', '_.QUIT', 'Y'].join('\r\n') + '\r\n';
}

function convertOne(file, dxfRoot, opts = {}) {
  const {
    exe = DEFAULT_ACCORECONSOLE,
    spawn = childProcess.spawn,
    timeoutMs = 120000,
    fsLike = nodeFs,
  } = opts;
  const dxf = dxfPathFor(file, dxfRoot);
  const scr = dxf.replace(/\.dxf$/i, '.scr');
  const started = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let child = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fsLike.unlinkSync(scr); } catch { /* already gone */ }
      const seconds = (Date.now() - started) / 1000;
      resolve(error ? { ok: false, seconds, error } : { ok: true, seconds });
    };

    try {
      fsLike.mkdirSync(path.dirname(dxf), { recursive: true });
      fsLike.writeFileSync(scr, scriptText(dxf));
      child = spawn(exe, ['/i', file.absPath, '/s', scr, '/l', 'en-US'], { windowsHide: true, stdio: 'ignore' });
    } catch (e) {
      return finish(`could not start: ${e.message}`);
    }

    timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(`timeout after ${timeoutMs} ms`);
    }, timeoutMs);

    child.on('error', (e) => finish(`spawn error: ${e.message}`));
    child.on('exit', (code) => {
      if (code !== 0) return finish(`exit code ${code}`);
      let size = 0;
      try { size = fsLike.existsSync(dxf) ? fsLike.statSync(dxf).size : 0; } catch { size = 0; }
      finish(size > 0 ? null : 'exit 0 but no DXF was written');
    });
  });
}

async function convertAll(files, dxfRoot, opts = {}) {
  // skipped: the up-to-date count from planConversions, passed through to the result.
  const { concurrency = 3, onProgress, skipped = 0, ...rest } = opts;
  const failed = [];
  let converted = 0;
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      const r = await convertOne(f, dxfRoot, rest);
      if (r.ok) converted++; else failed.push({ relPath: f.relPath, error: r.error });
      done++;
      if (onProgress) onProgress({ done, total: files.length, failed: failed.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { converted, failed, skipped };
}

module.exports = { DEFAULT_ACCORECONSOLE, dxfPathFor, planConversions, scriptText, convertOne, convertAll };
