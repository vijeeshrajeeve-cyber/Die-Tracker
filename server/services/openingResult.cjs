'use strict';
// Shared tail of every opening extractor (DXF, vector PDF, scanned PDF): classify the loops, frame them,
// grade the confidence, decide the size class, cross-check the inventory dimensions, build the ExtractionResult
// documented in dxfOpenings.cjs.
//
// buildExtractionResult({
//   source       'dxf' | 'pdf-vector' | 'pdf-raster'
//   loops        loops already in millimetres ({ points, layer, bridgedGaps, sources })
//   bridged      number of gaps bridged while chaining
//   scaleBasis   as in ExtractionResult (never null here)
//   texts        plain drawing texts;  numbers  canonical tooling numbers found in them
//   hints        { sizeClass, cavities, inventoryDims, steppedPockets }
//   stated       sizeFromTexts() result or null
//   canConfirm   true only when the scale is native (DXF): a drawn outer then confirms stated text. A PDF is scaled
//                from its own text/hint/inventory dims, so its drawn circle can never confirm anything.
//   notes        array, appended to
//   openChains   chains that did not close (centre lines), used to centre a synthesised outer
//   mmPerUnit    millimetres per source unit, recorded in meta
//   warnings     reader warnings; any one caps the result at 'uncertain'
// })
// With scaleBasis 'inventory-dims' and no expected diameter the outer is not guessed (the pocket is never promoted),
// and a short side more than 2 mm away from inventoryDims.b_wid makes the result 'none'.
// Caps at 'uncertain' (each with a note): several different plausible size texts; with no known cavity count, a pocket
// smaller than a tenth of the largest one (a locating slot or a title-block symbol, not a cavity); a drawn rim showing
// the drawing at a clean 1:n scale (the geometry is not rescaled); a reader warning.

const {
  classifyLoops, pocketGapMm, normaliseFrame, gradeConfidence, bbox, polygonArea, robustCircle, cleanScale, NATIVE_SCALES,
} = require('./openingGeometry.cjs');
const { normalizeSizeClass } = require('./toolingNumbers.cjs');

const TOLERANCE_MM = 2;
const fmt = (n) => String(Math.round(n * 10) / 10);

function hintDiameter(sizeClass) {
  const m = /^(\d+(?:\.\d+)?)X\d/.exec(normalizeSizeClass(sizeClass) || '');
  return m ? Number(m[1]) : null;
}

const SMALL_POCKET_SHARE = 0.1;

// The scales a drawing states, as reductions n (1 for 1:1, 2 for 1:2 or a 0.5 view scale). A ratio counts when it
// follows a SCALE / SCALA label in the same text or stands alone as a text of its own (title blocks keep the label
// and the value in separate texts, not always next to each other). Empty without a SCALE label.
const SCALE_LABEL = /\bSCAL[EA]\b/i;
const RATIO_AFTER_LABEL = /\bSCAL[EA]\b[^\d]*1\s*[:/]\s*(\d)(?![\d.:])/i;
const RATIO_ALONE = /^\s*1\s*[:/]\s*(\d)\s*$/;
const DECIMAL_AFTER_LABEL = /\bSCAL[EA]\b[^\d]*(0\.\d+)\s*$/i;
function statedScales(texts) {
  const list = (texts || []).map(String);
  const found = new Set();
  if (!list.some((t) => SCALE_LABEL.test(t))) return found;
  for (const t of list) {
    const m = RATIO_AFTER_LABEL.exec(t) || RATIO_ALONE.exec(t);
    if (m) found.add(Number(m[1]));
    const d = DECIMAL_AFTER_LABEL.exec(t);
    if (d && Number(d[1]) > 0) {
      const n = 1 / Number(d[1]);
      if (Math.abs(n - Math.round(n)) < 0.01) found.add(Math.round(n));
    }
  }
  return found;
}

// The one reduction (2..5) a drawing states, or null: no statement, 1:1, or several different scales.
function scaleFromTexts(texts) {
  const found = statedScales(texts);
  if (found.size !== 1) return null;
  const [n] = found;
  return n >= 2 && n <= 5 ? n : null;
}

// A drawing in its own units can still be drawn reduced: the sheet is true size and the part is at 1:n. Returns
// { n, basis: 'rim' | 'text' } when the geometry has to be multiplied by n, else null.
//   rim   a drawn rim is the expected diameter at a clean 1:n, none is near the expected diameter itself, and the
//         drawing states that scale (a circle a quarter of the die's size is otherwise just a round pocket)
//   text  the drawing states one scale 1:n and its largest rim, multiplied by n, is a possible tooling diameter
function reductionOf(loops, { expectedDiameter, texts }) {
  const rims = loops.map((l) => robustCircle(l.points)).filter((f) => f && f.r * 2 >= 50).map((f) => f.r * 2);
  if (!rims.length) return null;
  if (expectedDiameter) {
    if (rims.some((d) => Math.abs(d - expectedDiameter) <= 0.1 * expectedDiameter)) return null;
    const stated = statedScales(texts);
    const clean = rims.map((d) => cleanScale(expectedDiameter, d)).filter((n) => n && stated.has(n));
    if (clean.length) return { n: Math.max(...clean), basis: 'rim' };
  }
  const n = scaleFromTexts(texts);
  const largest = Math.max(...rims);
  if (n && largest * n >= 100 && largest * n <= 1500) return { n, basis: 'text' };
  return null;
}

function capUncertain(state, note) {
  state.notes.push(note);
  if (state.confidence === 'confirmed' || state.confidence === 'likely') state.confidence = 'uncertain';
}

function buildExtractionResult({
  source, loops, bridged, scaleBasis, texts, numbers, hints, stated, canConfirm, notes,
  openChains = [], mmPerUnit = 1, warnings = [],
}) {
  const { sizeClass: hintSize = null, cavities: hintCavities = null, inventoryDims = null, steppedPockets = null } = hints || {};
  const normHint = hintSize ? normalizeSizeClass(hintSize) : null;
  const validHint = normHint && hintDiameter(normHint) != null ? normHint : null;
  if (normHint && !validHint) notes.push('ignored malformed size hint');
  const hinted = stated ? null : validHint;
  const hintedDiameter = hinted ? hintDiameter(hinted) : null;
  const expectedDiameter = stated ? stated.diameter : hintedDiameter;

  // A reduced drawing is brought to true size before anything is classified.
  const reduction = NATIVE_SCALES.has(scaleBasis) ? reductionOf(loops, { expectedDiameter, texts }) : null;
  if (reduction) {
    const grow = (c) => ({ ...c, points: c.points.map(([x, y]) => [x * reduction.n, y * reduction.n]) });
    loops = loops.map(grow);
    openChains = openChains.map(grow);
    mmPerUnit *= reduction.n;
  }

  const cls = classifyLoops(loops, {
    expectedOuterDiameter: expectedDiameter,
    noOuterFallback: scaleBasis === 'inventory-dims' && !expectedDiameter,
    openChains,
    knownCavities: hintCavities,
    steppedPockets,
  });
  notes.push(...cls.notes);
  const framed = normaliseFrame({ outer: cls.outer, pockets: cls.pockets, centre: cls.patternCentre });
  const outer = framed.outer ? framed.outer.points : null;
  const pockets = framed.pockets.map((p) => p.points);

  // The drawn circle the outer sits on: a robust fit, so a rim drawn with its key slot still measures true.
  const drawnCircle = !!(cls.outer && !cls.outerSynthesised && cls.outerFit);
  const drawnDiameter = drawnCircle ? cls.outerFit.r * 2 : null;

  const graded = gradeConfidence({
    outer: cls.outer,
    outerSynthesised: cls.outerSynthesised,
    outerFit: cls.outerFit,
    outerBasis: cls.outerBasis,
    pockets,
    bridged,
    source,
    statedDiameter: drawnCircle || cls.outerSynthesised ? expectedDiameter : null,
    knownCavities: hintCavities,
    scaleBasis,
    centred: !!cls.patternCentre,
  });
  let confidence = graded.confidence;
  notes.push(...graded.notes);

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
    } else if (canConfirm && stated && drawnDiameter != null) {
      sizeClassConfidence = 'confirmed';
    } else {
      sizeClassConfidence = 'likely';
    }
  } else if (drawnDiameter != null) {
    notes.push(`outer diameter ${fmt(drawnDiameter)} mm found; thickness unknown — size class needs the die shop`);
  }
  if (sizeClassConfidence === 'uncertain' && confidence !== 'none') confidence = 'uncertain';

  // Inventory dimensions cross-check on the largest pocket. An inventory-dims scale fixes the long side by
  // construction, so only the short side can disagree - and then the scale is wrong, not merely doubtful.
  if (inventoryDims && pockets.length) {
    const b = bbox(pockets[0]);
    const long = Math.max(b.width, b.height);
    const short = Math.min(b.width, b.height);
    const byDims = scaleBasis === 'inventory-dims';
    const longOk = byDims || Math.abs(long - inventoryDims.a_len) <= TOLERANCE_MM;
    if (longOk && Math.abs(short - inventoryDims.b_wid) <= TOLERANCE_MM) {
      notes.push('inventory dims agree');
    } else {
      notes.push(`pocket ${fmt(long)} x ${fmt(short)} mm disagrees with inventory dims ${inventoryDims.a_len} x ${inventoryDims.b_wid}`);
      if (byDims) confidence = 'none';
      else if (confidence !== 'none') confidence = 'uncertain';
    }
  }

  const state = { confidence, notes };
  if (stated && stated.candidates && stated.candidates.length > 1) {
    capUncertain(state, `several size texts: ${stated.candidates.join(', ')}`);
  }
  if (hintCavities == null && pockets.length > 1) {
    const areas = pockets.map(polygonArea);
    const largest = Math.max(...areas);
    const small = areas.filter((a) => a < SMALL_POCKET_SHARE * largest).length;
    if (small) capUncertain(state, `${small} pocket${small === 1 ? '' : 's'} under a tenth of the largest pocket's area`);
  }
  if (cls.drawingScale) capUncertain(state, `drawing appears to be at 1:${cls.drawingScale} scale; geometry not rescaled`);
  // Pockets picked out by the cavity count are a reading, not a measurement of an unambiguous drawing.
  if (cls.pocketsInferred && state.confidence === 'confirmed') state.confidence = 'likely';
  if (reduction) {
    // Rescaled geometry is measured from a reduced drawing: never better than likely.
    state.notes.push(reduction.basis === 'text'
      ? `drawing states scale 1:${reduction.n}; geometry multiplied by ${reduction.n}`
      : `drawn rim is the stated size at 1:${reduction.n}; geometry multiplied by ${reduction.n}`);
    if (state.confidence === 'confirmed') state.confidence = 'likely';
    if (sizeClassConfidence === 'confirmed') sizeClassConfidence = 'likely';
  }
  for (const w of warnings) capUncertain(state, w);
  confidence = state.confidence;

  return {
    source,
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
    numbersInDrawing: numbers,
    texts,
    notes,
    meta: { scaleBasis, outerSynthesised: cls.outerSynthesised, offset: framed.offset, mmPerUnit },
  };
}

module.exports = { buildExtractionResult, hintDiameter, statedScales, scaleFromTexts, reductionOf };
