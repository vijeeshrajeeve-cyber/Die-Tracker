'use strict';
// The title block of a die drawing whose lettering is drawn, not typed: no text to extract, so
// the strip is read by OCR (the `tesseract` program, installed in the backend image). Only the
// two things the profile's true size needs are taken: the CCD and the list of scales.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OCR_TIMEOUT_MS = 30_000;
const MIN_CCD_MM = 3;
const MAX_CCD_MM = 800;

// "CCD 102", "CCD | 318", "CCD: 181.6": the number right after the label.
const CCD = /\bCCD\b[\s:|\]}]*(\d{1,3}(?:[.,]\d{1,3})?)(?!\d)/i;
// "Scale : 1:1, 3:2, 4:1": every ratio after the label, up to the next word.
// Title-block scales are whole-number ratios, so a full stop between two of them ("1:1. 2:1",
// which OCR also gives as "1:1.2:1") is a comma misread, never a decimal point.
const SCALE_LIST = /\bScale\s*[:;.]?\s*((?:\d{1,2}\s*[:;]\s*\d{1,2}[\s,.]*)+)/i;
const RATIO = /(\d{1,2})\s*[:;]\s*(\d{1,2})/g;

// OCR text -> { ccd, scales }. `scales` are drawing mm per sheet mm in the order printed
// (SCALE 3:2 -> 2/3), as pdfImportFields' readScales gives them; the first is the overview's.
function parseTitleBlock(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  let ccd = null;
  const m = flat.match(CCD);
  if (m) {
    const n = Number(m[1].replace(',', '.'));
    if (Number.isFinite(n) && n >= MIN_CCD_MM && n <= MAX_CCD_MM) ccd = n;
  }
  const scales = [];
  const list = flat.match(SCALE_LIST);
  if (list) {
    for (const r of list[1].matchAll(RATIO)) {
      const a = Number(r[1]);
      const b = Number(r[2]);
      if (!(a > 0) || !(b > 0) || a > 50 || b > 50) continue;
      const ratio = b / a;
      if (!scales.includes(ratio)) scales.push(ratio);
    }
  }
  return { ccd, scales };
}

function runTesseract(file) {
  return new Promise((resolve, reject) => {
    execFile('tesseract', [file, 'stdout', '--psm', '11'], { timeout: OCR_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// PNG bytes of the title-block strip -> { available, ccd, scales }. `available: false` means the
// OCR program is not installed here (a development machine): nothing was read, nothing failed.
async function readTitleBlock(buffer, { run = runTesseract } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'title-block-'));
  const file = path.join(dir, 'strip.png');
  try {
    await fs.promises.writeFile(file, buffer);
    const text = await run(file);
    return { available: true, ...parseTitleBlock(text) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { available: false, ccd: null, scales: [] };
    throw err;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { parseTitleBlock, readTitleBlock };
