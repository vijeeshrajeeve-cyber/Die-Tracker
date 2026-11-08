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
const {
  chainLoops, classifyLoops, pocketGapMm, normaliseFrame, gradeConfidence, circleFit, isCircleLike, bbox,
} = require('./openingGeometry.cjs');
const { parseToolingNumber, normalizeSizeClass } = require('./toolingNumbers.cjs');

const SIZE_RE = /(?:Ø|DIA\.?|DIAMETER)?\s*(\d{2,4}(?:\.\d+)?)\s*[xX×]\s*(?:H\.?\s*)?(\d{2,4}(?:\.\d+)?)/g;
const TOLERANCE_MM = 2;

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

function hintDiameter(sizeClass) {
  const m = /^(\d+(?:\.\d+)?)X\d/.exec(normalizeSizeClass(sizeClass) || '');
  return m ? Number(m[1]) : null;
}

const fmt = (n) => String(Math.round(n * 10) / 10);

function extractFromDxf(text, hints = {}) {
  const { sizeClass: hintSize = null, cavities: hintCavities = null, inventoryDims = null } = hints || {};
  const dxf = parseDxf(text);
  const flat = flattenDxf(dxf);
  const unitScale = flat.unitScale;
  const scaleBasis = unitScale === 25.4 ? 'native-inch' : 'native-mm';
  const texts = flat.texts.map((t) => plainText(t.value)).filter(Boolean);
  const notes = [];

  const chains = flat.chains.map((c) => ({ ...c, points: c.points.map(([x, y]) => [x * unitScale, y * unitScale]) }));
  const { loops, bridged } = chainLoops(chains);

  const stated = sizeFromTexts(texts);
  const normHint = hintSize ? normalizeSizeClass(hintSize) : null;
  const validHint = normHint && hintDiameter(normHint) != null ? normHint : null;
  if (normHint && !validHint) notes.push('ignored malformed size hint');
  const hinted = stated ? null : validHint;
  const hintedDiameter = hinted ? hintDiameter(hinted) : null;
  const expectedDiameter = stated ? stated.diameter : hintedDiameter;

  const cls = classifyLoops(loops, { expectedOuterDiameter: expectedDiameter });
  const framed = normaliseFrame({ outer: cls.outer, pockets: cls.pockets });
  const outer = framed.outer ? framed.outer.points : null;
  const pockets = framed.pockets.map((p) => p.points);

  const drawnCircle = !!(cls.outer && !cls.outerSynthesised && isCircleLike(cls.outer.points));
  const drawnDiameter = drawnCircle ? circleFit(cls.outer.points).r * 2 : null;

  const graded = gradeConfidence({
    outer: cls.outer,
    outerSynthesised: cls.outerSynthesised,
    pockets,
    bridged,
    source: 'dxf',
    statedDiameter: drawnCircle || cls.outerSynthesised ? expectedDiameter : null,
    knownCavities: hintCavities,
    scaleBasis,
  });
  let confidence = graded.confidence;
  notes.push(...graded.notes);

  // Size class.
  let sizeClass = null;
  let sizeClassSource = null;
  let sizeClassConfidence = null;
  if (stated || hinted) {
    sizeClass = stated ? stated.sizeClass : hinted;
    sizeClassSource = stated ? 'drawing-text' : 'hint';
    const diameter = stated ? stated.diameter : hintedDiameter;
    if (drawnDiameter != null && Math.abs(drawnDiameter - diameter) > TOLERANCE_MM) {
      sizeClassConfidence = 'uncertain';
      notes.push(`drawn outer ${fmt(drawnDiameter)} mm disagrees with ${stated ? 'the drawing text' : 'the size hint'} (${diameter} mm)`);
    } else if (stated && drawnDiameter != null) {
      sizeClassConfidence = 'confirmed';
    } else {
      sizeClassConfidence = 'likely';
    }
  } else if (drawnDiameter != null) {
    notes.push(`outer diameter ${fmt(drawnDiameter)} mm found; thickness unknown — size class needs the die shop`);
  }
  if (sizeClassConfidence === 'uncertain' && confidence !== 'none') confidence = 'uncertain';

  // Inventory dimensions cross-check on the largest pocket.
  if (inventoryDims && pockets.length) {
    const b = bbox(pockets[0]);
    const long = Math.max(b.width, b.height);
    const short = Math.min(b.width, b.height);
    if (Math.abs(long - inventoryDims.a_len) <= TOLERANCE_MM && Math.abs(short - inventoryDims.b_wid) <= TOLERANCE_MM) {
      notes.push('inventory dims agree');
    } else {
      notes.push(`pocket ${fmt(long)} x ${fmt(short)} mm disagrees with inventory dims ${inventoryDims.a_len} x ${inventoryDims.b_wid}`);
      if (confidence !== 'none') confidence = 'uncertain';
    }
  }

  return {
    source: 'dxf',
    outer,
    outerSynthesised: cls.outerSynthesised,
    pockets,
    pocketGapMm: pocketGapMm(framed.pockets),
    cavities: pockets.length || null,
    sizeClass,
    sizeClassSource,
    sizeClassConfidence,
    scaleBasis,
    confidence,
    numbersInDrawing: numbersFromTexts(texts),
    texts,
    notes,
  };
}

module.exports = { sizeFromTexts, numbersFromTexts, extractFromDxf };
