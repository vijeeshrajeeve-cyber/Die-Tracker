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
//   hints        { sizeClass, cavities, inventoryDims }
//   stated       sizeFromTexts() result or null
//   canConfirm   true only when the scale is native (DXF): a drawn outer then confirms stated text. A PDF is scaled
//                from its own text/hint/inventory dims, so its drawn circle can never confirm anything.
//   notes        array, appended to
// })
// With scaleBasis 'inventory-dims' and no expected diameter the outer is not guessed (the pocket is never promoted),
// and a short side more than 2 mm away from inventoryDims.b_wid makes the result 'none'.

const {
  classifyLoops, pocketGapMm, normaliseFrame, gradeConfidence, circleFit, isCircleLike, bbox,
} = require('./openingGeometry.cjs');
const { normalizeSizeClass } = require('./toolingNumbers.cjs');

const TOLERANCE_MM = 2;
const fmt = (n) => String(Math.round(n * 10) / 10);

function hintDiameter(sizeClass) {
  const m = /^(\d+(?:\.\d+)?)X\d/.exec(normalizeSizeClass(sizeClass) || '');
  return m ? Number(m[1]) : null;
}

function buildExtractionResult({ source, loops, bridged, scaleBasis, texts, numbers, hints, stated, canConfirm, notes }) {
  const { sizeClass: hintSize = null, cavities: hintCavities = null, inventoryDims = null } = hints || {};
  const normHint = hintSize ? normalizeSizeClass(hintSize) : null;
  const validHint = normHint && hintDiameter(normHint) != null ? normHint : null;
  if (normHint && !validHint) notes.push('ignored malformed size hint');
  const hinted = stated ? null : validHint;
  const hintedDiameter = hinted ? hintDiameter(hinted) : null;
  const expectedDiameter = stated ? stated.diameter : hintedDiameter;

  const cls = classifyLoops(loops, {
    expectedOuterDiameter: expectedDiameter,
    noOuterFallback: scaleBasis === 'inventory-dims' && !expectedDiameter,
  });
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
    source,
    statedDiameter: drawnCircle || cls.outerSynthesised ? expectedDiameter : null,
    knownCavities: hintCavities,
    scaleBasis,
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
  };
}

module.exports = { buildExtractionResult, hintDiameter };
