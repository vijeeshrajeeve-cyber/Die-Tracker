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
//   scaleBasis           'native-mm' | 'native-inch' | 'text-diameter' | 'hint-diameter' | 'inventory-dims' | null
//   confidence           'confirmed' | 'likely' | 'uncertain' | 'none'
//   numbersInDrawing     string[]               canonical tooling numbers found in the drawing text
//   texts                string[]               plain drawing texts
//   notes                string[]

const { parseDxf, flattenDxf, plainText } = require('./dxfReader.cjs');
const { chainLoops } = require('./openingGeometry.cjs');
const { buildExtractionResult } = require('./openingResult.cjs');
const { parseToolingNumber, normalizeSizeClass } = require('./toolingNumbers.cjs');

const SIZE_RE = /(?:Ø|DIA\.?|DIAMETER)?\s*(\d{2,4}(?:\.\d+)?)\s*[xX×]\s*(?:H\.?\s*)?(\d{2,4}(?:\.\d+)?)/g;

function sizeFromTexts(texts) {
  for (const raw of texts) {
    for (const m of String(raw).matchAll(SIZE_RE)) {
      const diameter = Number(m[1]);
      const thickness = Number(m[2]);
      if (diameter >= 100 && diameter > thickness) {
        return { sizeClass: normalizeSizeClass(`${m[1]}X${m[2]}`), diameter, thickness, raw: String(raw) };
      }
    }
  }
  return null;
}

function numbersFromTexts(texts) {
  const found = [];
  const add = (c) => { if (c && !found.includes(c)) found.push(c); };
  const tryParse = (s) => {
    const p = parseToolingNumber(s);
    if (p.kind !== 'unknown') add(p.canonical);
  };
  for (const raw of texts) {
    for (const token of String(raw).trim().split(/\s+/).filter(Boolean)) {
      tryParse(token);
      if (/^\d{5}$/.test(token)) add(`I-${token}`);
    }
  }
  return found;
}

function extractFromDxf(text, hints = {}) {
  const dxf = parseDxf(text);
  const flat = flattenDxf(dxf);
  const unitScale = flat.unitScale;
  const scaleBasis = unitScale === 25.4 ? 'native-inch' : 'native-mm';
  const texts = flat.texts.map((t) => plainText(t.value)).filter(Boolean);
  const notes = [];

  const chains = flat.chains.map((c) => ({ ...c, points: c.points.map(([x, y]) => [x * unitScale, y * unitScale]) }));
  const { loops, bridged } = chainLoops(chains);

  const stated = sizeFromTexts(texts);
  return buildExtractionResult({
    source: 'dxf', loops, bridged, scaleBasis, texts, numbers: numbersFromTexts(texts), hints, stated, canConfirm: true, notes,
  });
}

module.exports = { sizeFromTexts, numbersFromTexts, extractFromDxf };
