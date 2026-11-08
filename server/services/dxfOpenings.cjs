'use strict';
// DXF opening extractor: turns a die-shop / bolster drawing into outer outline, pocket outlines and a size class.
//
// ExtractionResult (shared by all three extractors and the bundle builder):
//   source               'dxf' | 'pdf-vector' | 'pdf-raster'
//   outer                Array<[x, y]> | null   millimetres, centred on the outer's bbox centre
//   outerSynthesised     boolean                outer was built from the stated diameter, not drawn
//   pockets              Array<Array<[x, y]>>   same frame as outer, largest first
//   pocketGapMm          number | null          closest pocket-centroid distance (null for fewer than two)
//   cavities             number | null          pockets.length, null when none
//   sizeClass            string | null          e.g. '175X80'
//   sizeClassSource      'drawing-text' | 'drawing-outline' | 'hint' | null
//   sizeClassConfidence  'confirmed' | 'likely' | 'uncertain' | null
//   scaleBasis           'native-mm' | 'native-inch' | 'native-feet' | 'text-diameter' | 'hint-diameter' | 'inventory-dims' | null
//   confidence           'confirmed' | 'likely' | 'uncertain' | 'none'
//   numbersInDrawing     string[]               canonical tooling numbers found in the drawing text
//   texts                string[]               plain drawing texts
//   notes                string[]
//   meta                 { scaleBasis, outerSynthesised, offset: [cx, cy], mmPerUnit } | null
//                        offset is the translation normaliseFrame subtracted (source mm); a source point is
//                        (x + offset[0]) / mmPerUnit. mmPerUnit is the DXF unit scale (1 for a mm drawing) or the
//                        PDF scale (mm per PDF point / per scan pixel; a PDF's y axis is the sheet's, y-up).

const { parseDxf, flattenDxf, plainText } = require('./dxfReader.cjs');
const { chainLoops } = require('./openingGeometry.cjs');
const { buildExtractionResult } = require('./openingResult.cjs');
const { parseToolingNumber, normalizeSizeClass } = require('./toolingNumbers.cjs');

// The leading look-behind keeps '8023.700X200' from reading as 700X200 (or 23X200).
const SIZE_RE = /(?<![\d.])(?:Ø|DIA\.?|DIAMETER)?\s*(\d{2,4}(?:\.\d+)?)\s*[xX×]\s*(?:H\.?\s*)?(\d{2,4}(?:\.\d+)?)/g;
const SHEET_SIZE_BEFORE = /(?:^|[^A-Z0-9])A[0-4]\s*$/i; // 'A3 420x297' is a paper size

// The first plausible size text (100..1500 mm diameter, thickness 10 mm up to but below the diameter), plus
// `candidates`: every distinct plausible size class found, so the caller can tell when the drawing disagrees with itself.
function sizeFromTexts(texts) {
  let firstHit = null;
  const candidates = [];
  for (const raw of texts) {
    const text = String(raw);
    for (const m of text.matchAll(SIZE_RE)) {
      const diameter = Number(m[1]);
      const thickness = Number(m[2]);
      if (!(diameter >= 100 && diameter <= 1500 && thickness >= 10 && thickness < diameter)) continue;
      const digitsAt = m.index + m[0].indexOf(m[1]);
      if (SHEET_SIZE_BEFORE.test(text.slice(0, digitsAt))) continue;
      const sizeClass = normalizeSizeClass(`${m[1]}X${m[2]}`);
      if (!candidates.includes(sizeClass)) candidates.push(sizeClass);
      if (!firstHit) firstHit = { sizeClass, diameter, thickness, raw: text };
    }
  }
  return firstHit ? { ...firstHit, candidates } : null;
}

function numbersFromTexts(texts) {
  const found = [];
  const add = (c) => { if (c && !found.includes(c)) found.push(c); };
  const tryParse = (s) => {
    const p = parseToolingNumber(s);
    // In drawing text a bolster code must start with a letter or digit: 'BOL:(ALV-14)45-48 HRC' is a material note.
    if (p.kind === 'bolster' && !/^BOL-[A-Z0-9]/.test(p.canonical)) return;
    if (p.kind !== 'unknown') add(p.canonical);
  };
  for (const raw of texts) {
    for (const token of String(raw).trim().split(/\s+/).filter(Boolean)) {
      tryParse(token);
      if (/^\d{5}$/.test(token)) add(`I-${token}`);
      const ins = /^INS[-.]?(\d{5})$/i.exec(token);
      if (ins) add(`I-${ins[1]}`);
    }
  }
  return found;
}

function extractFromDxf(text, hints = {}) {
  const dxf = parseDxf(text);
  const warned = new Map();
  const onWarn = (message) => warned.set(message, (warned.get(message) || 0) + 1);
  const flat = flattenDxf(dxf, { onWarn });
  const unitScale = flat.unitScale;
  const scaleBasis = unitScale === 25.4 ? 'native-inch' : unitScale === 304.8 ? 'native-feet' : 'native-mm';
  const texts = flat.texts.map((t) => plainText(t.value)).filter(Boolean);
  const notes = [];
  const warnings = [...warned].map(([message, n]) => (n > 1 ? `${message} (${n} times)` : message));

  const chains = flat.chains.map((c) => ({ ...c, points: c.points.map(([x, y]) => [x * unitScale, y * unitScale]) }));
  const { loops, open, bridged } = chainLoops(chains);

  const stated = sizeFromTexts(texts);
  return buildExtractionResult({
    source: 'dxf', loops, bridged, scaleBasis, texts, numbers: numbersFromTexts(texts), hints, stated, canConfirm: true, notes,
    openChains: open, mmPerUnit: unitScale, warnings,
  });
}

module.exports = { sizeFromTexts, numbersFromTexts, extractFromDxf };
