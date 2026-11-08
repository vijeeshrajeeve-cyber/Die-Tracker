'use strict';
// PDF opening extractors. A vector PDF is read from its operator list (no rendering); a scanned PDF is
// read from its decoded image and traced by rasterTrace. Both return the ExtractionResult documented in
// dxfOpenings.cjs (source 'pdf-vector' | 'pdf-raster').
//
// Neither extractor knows the drawing scale natively, so it comes from the stated diameter (drawing text,
// then size-class hint), or from the inventory dimensions of the pocket. Nothing here is ever 'confirmed'.

const {
  chainLoops, circleFit, isCircleLike, bbox, centroid, robustCircle,
} = require('./openingGeometry.cjs');
const { buildExtractionResult, hintDiameter } = require('./openingResult.cjs');
const { sizeFromTexts, numbersFromTexts } = require('./dxfOpenings.cjs');
const { toGray, traceLoops } = require('./rasterTrace.cjs');

const STROKING = new Set(['stroke', 'closeStroke', 'fillStroke', 'closeFillStroke', 'eoFillStroke', 'closeEOFillStroke']);
const CLOSING = new Set(['closeStroke', 'closeFillStroke', 'closeEOFillStroke']);
const CURVE_SEGMENTS = 16;
const INK_MAX_CHANNEL = 0.63;
const INK_MAX_SPREAD = 0.25;
const NO_SCALE_NOTE = 'scale unknown: no size text, size class or inventory dims';
const IMAGE_TIMEOUT_MS = 30000;
const BORDER_SPAN = 0.8; // a loop longer than this share of the sheet's short side is its border or title frame
const NO_CIRCLE_NOTE = 'scale circle does not contain the drawing';

async function openFirstPage(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0,
  }).promise;
  const page = await doc.getPage(1);
  const opNames = {};
  for (const [name, code] of Object.entries(pdfjs.OPS)) opNames[code] = name;
  return { doc, page, opNames };
}

// ---- operator-list walk ------------------------------------------------------

const multiply = (m, n) => [ // apply m first, then n
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

// Normalised [r, g, b] in 0..1 from a pdfjs colour op: '#rrggbb', or 3 numbers in 0..1 or 0..255.
function normaliseRgb(args) {
  if (typeof args[0] === 'string') {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(args[0]);
    return m ? [1, 2, 3].map((i) => parseInt(m[i], 16) / 255) : null;
  }
  const v = args.map(Number);
  if (v.length < 3 || v.some((n) => !Number.isFinite(n))) return null;
  const scale = Math.max(...v) > 1 ? 255 : 1;
  return v.slice(0, 3).map((n) => n / scale);
}

function isInk([r, g, b]) {
  const max = Math.max(r, g, b);
  return max < INK_MAX_CHANNEL && max - Math.min(r, g, b) < INK_MAX_SPREAD;
}

function bezier(p0, p1, p2, p3, out) {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

// Maps user space to the sheet as it is read: the page /Rotate applied, y flipped back to y-up.
function sheetMatrix(page) {
  const t = page.getViewport({ scale: 1 }).transform; // user space -> device (y down), includes /Rotate
  return [t[0], -t[1], t[2], -t[3], t[4], -t[5]];
}

// Returns the stroked ink chains (points in sheet space, CTM applied).
function walkPaths(opList, opNames, base) {
  const chains = [];
  let ctm = base;
  let stroke = [0, 0, 0];
  const stack = [];
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const name = opNames[fnArray[i]];
    const args = argsArray[i];
    if (name === 'save') stack.push({ ctm, stroke });
    else if (name === 'restore') { const s = stack.pop(); if (s) ({ ctm, stroke } = s); }
    else if (name === 'transform') ctm = multiply(args, ctm);
    else if (name === 'paintFormXObjectBegin') {
      stack.push({ ctm, stroke });
      if (args && args[0]) ctm = multiply(args[0], ctm);
    } else if (name === 'paintFormXObjectEnd') { const s = stack.pop(); if (s) ({ ctm, stroke } = s); }
    else if (name === 'setStrokeRGBColor' || name === 'setStrokeColor') { const c = normaliseRgb(args); if (c) stroke = c; }
    else if (name === 'setStrokeGray') { const g = Number(args[0]) > 1 ? Number(args[0]) / 255 : Number(args[0]); stroke = [g, g, g]; }
    else if (name === 'setStrokeCMYKColor') {
      const [c, m, y, k] = args.map((n) => (Number(n) > 1 ? Number(n) / 255 : Number(n)));
      stroke = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
    } else if (name === 'constructPath') {
      const paint = opNames[args[0]];
      if (!STROKING.has(paint)) continue;
      if (!isInk(stroke)) continue;
      const data = args[1][0];
      const apply = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
      let sub = null;
      const flush = () => {
        if (sub && sub.points.length >= 2) {
          // A path whose ends meet is a closed loop even without closePath; leaving it open lets the chainer
          // splice a neighbouring arc onto its end.
          const a = sub.points[0];
          const z = sub.points[sub.points.length - 1];
          if (sub.points.length >= 3 && Math.hypot(a[0] - z[0], a[1] - z[1]) < 0.01) sub.closed = true;
          chains.push(sub);
        }
        sub = null;
      };
      for (let k = 0; k < data.length;) {
        const op = data[k++]; // pdfjs 5 DrawOPS: 0 move, 1 line, 2 cubic, 3 quadratic, 4 close
        if (op === 0) { flush(); sub = { points: [apply(data[k], data[k + 1])], closed: false }; k += 2; }
        else if (op === 1) { if (sub) sub.points.push(apply(data[k], data[k + 1])); k += 2; }
        else if (op === 2) {
          if (sub) {
            bezier(sub.points[sub.points.length - 1], apply(data[k], data[k + 1]), apply(data[k + 2], data[k + 3]),
              apply(data[k + 4], data[k + 5]), sub.points);
          }
          k += 6;
        } else if (op === 3) { // quadratic curve, raised to a cubic
          if (sub) {
            const p0 = sub.points[sub.points.length - 1];
            const q = apply(data[k], data[k + 1]);
            const p2 = apply(data[k + 2], data[k + 3]);
            bezier(p0, [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
              [p2[0] + (2 / 3) * (q[0] - p2[0]), p2[1] + (2 / 3) * (q[1] - p2[1])], p2, sub.points);
          }
          k += 4;
        } else if (op === 4) { if (sub) sub.closed = true; } // closePath
        else break; // unknown op: stop rather than misread coordinates
      }
      if (sub && CLOSING.has(paint)) sub.closed = true;
      flush();
    }
  }
  return chains;
}

function countOps(opList, opNames) {
  let strokedPaths = 0;
  let imageCount = 0;
  let firstImage = null;
  opList.fnArray.forEach((fn, i) => {
    const name = opNames[fn];
    if (name === 'constructPath' && STROKING.has(opNames[opList.argsArray[i][0]])) strokedPaths++;
    else if (name === 'paintImageXObject' || name === 'paintInlineImageXObject') {
      imageCount++;
      if (!firstImage && name === 'paintImageXObject') firstImage = opList.argsArray[i][0];
    }
  });
  return { strokedPaths, imageCount, firstImage };
}

async function pageTexts(page) {
  const { items } = await page.getTextContent();
  const strings = items.map((it) => it.str).filter((s) => s && s.trim());
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const key = Math.round(it.transform[5]);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(it);
  }
  const lines = [...rows.values()].map((row) => row.sort((a, b) => a.transform[4] - b.transform[4]).map((it) => it.str.trim()).join(' '));
  return [...new Set([...strings.map((s) => s.trim()), ...lines])];
}

async function classifyPdf(buffer) {
  const { doc, page, opNames } = await openFirstPage(buffer);
  try {
    const { strokedPaths, imageCount } = countOps(await page.getOperatorList(), opNames);
    const { width, height } = page.getViewport({ scale: 1 });
    let kind = 'vector';
    if (strokedPaths <= 5 && imageCount >= 1) kind = 'scan';
    else if (strokedPaths === 0 && imageCount === 0) kind = 'empty';
    return { kind, pageSize: [width, height], strokedPaths, imageCount };
  } finally {
    await doc.destroy();
  }
}

// ---- shared result building -----------------------------------------------------

function noneResult(source, notes, extra = {}) {
  return {
    source, outer: null, outerSynthesised: false, pockets: [], pocketGapMm: null, cavities: null,
    sizeClass: null, sizeClassSource: null, sizeClassConfidence: null, scaleBasis: null,
    confidence: 'none', numbersInDrawing: [], texts: [], notes, meta: null, ...extra,
  };
}

const longSide = (points) => { const b = bbox(points); return Math.max(b.width, b.height); };

function circlePolygon({ cx, cy, r }, n = 64) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
}

// A circle-like loop (fit) that contains the centroid of at least one other loop: the scale circle must hold the drawing.
function containsOther(fit, loops, self) {
  return loops.some((l) => l !== self && Math.hypot(...centroid(l.points).map((v, i) => v - [fit.cx, fit.cy][i])) < fit.r);
}

const isBorder = (points, shortSide) => longSide(points) > BORDER_SPAN * shortSide;

const asLoops = (rings) => rings.map((points) => ({ points, layer: '', bridgedGaps: 0, sources: [] }));

// ---- vector PDF -------------------------------------------------------------------

async function extractFromVectorPdf(buffer, hints = {}) {
  const { doc, page, opNames } = await openFirstPage(buffer);
  let chains;
  let texts;
  let shortSide;
  try {
    chains = walkPaths(await page.getOperatorList(), opNames, sheetMatrix(page));
    texts = await pageTexts(page);
    const viewport = page.getViewport({ scale: 1 });
    shortSide = Math.min(viewport.width, viewport.height);
  } finally {
    await doc.destroy();
  }
  const source = 'pdf-vector';
  const notes = [];
  const safeHints = hints || {};
  const numbers = numbersFromTexts(texts);
  const stated = sizeFromTexts(texts);
  const hintDia = safeHints.sizeClass ? hintDiameter(safeHints.sizeClass) : null;
  const diameter = stated ? stated.diameter : hintDia;
  const none = (extraNotes) => noneResult(source, extraNotes, { numbersInDrawing: numbers, texts });

  // Pass 1, in PDF points: find the scale circle (the largest circle-like loop) and the unscaled loops.
  const first = chainLoops(chains, { joinTol: 0.5, bridgeTol: 2 });
  let mmPerUnit = null;
  let scaleBasis = null;
  let dropped = [];
  const circles = first.loops.map((l) => ({ loop: l, fit: robustCircle(l.points) })).filter((c) => c.fit)
    .sort((x, y) => y.fit.r - x.fit.r);
  if (circles.length && diameter) {
    if (!containsOther(circles[0].fit, first.loops, circles[0].loop)) return none([NO_CIRCLE_NOTE]);
    mmPerUnit = diameter / (2 * circles[0].fit.r);
    scaleBasis = stated ? 'text-diameter' : 'hint-diameter';
  } else if (!circles.length && safeHints.inventoryDims && safeHints.inventoryDims.a_len) {
    dropped = first.loops.filter((l) => isBorder(l.points, shortSide));
    const candidates = first.loops.filter((l) => !dropped.includes(l));
    if (candidates.length) {
      const largest = candidates.reduce((m, l) => (longSide(l.points) > longSide(m.points) ? l : m));
      mmPerUnit = safeHints.inventoryDims.a_len / longSide(largest.points);
      scaleBasis = 'inventory-dims';
    }
  }
  if (!scaleBasis) return none([NO_SCALE_NOTE, `${first.loops.length} unscaled loops found`]);

  // Pass 2: scale the raw chains, then chain again so the 0.5 mm / 2 mm tolerances mean millimetres.
  const scaled = chains.map((c) => ({ ...c, points: c.points.map(([x, y]) => [x * mmPerUnit, y * mmPerUnit]) }));
  const second = chainLoops(scaled);
  let keyed = false;
  const loops = second.loops.map((l) => {
    // The scale circle drawn with its key slot is one loop that is not quite a circle: use the circle it is drawn on.
    // Only a loop matching the stated diameter is ever replaced; a pocket never is.
    if (keyed || !diameter || isCircleLike(l.points)) return l;
    const fit = robustCircle(l.points);
    if (!fit || Math.abs(fit.r * 2 - diameter) > 0.1 * diameter) return l;
    keyed = true;
    notes.push('key slot cut into the outer circle ignored');
    return { ...l, points: circlePolygon(fit) };
  });
  if (scaleBasis === 'inventory-dims') {
    // The border was identified in points; drop its scaled twin by size.
    const limit = BORDER_SPAN * shortSide * mmPerUnit;
    for (let i = loops.length - 1; i >= 0; i--) if (longSide(loops[i].points) > limit) loops.splice(i, 1);
  }
  return buildExtractionResult({
    source, loops, bridged: second.bridged, scaleBasis, texts, numbers, hints: safeHints, stated, canConfirm: false, notes,
    openChains: second.open, mmPerUnit,
  });
}

// ---- scanned PDF ------------------------------------------------------------------

// pdfjs hands decoded images over through a callback, and never calls back for an object that fails to decode.
function getImageObject(page, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the page image')), IMAGE_TIMEOUT_MS);
    try {
      (name.startsWith('g_') ? page.commonObjs : page.objs).get(name, (img) => { clearTimeout(timer); resolve(img); });
    } catch (err) { clearTimeout(timer); reject(err); }
  });
}

async function extractFromScannedPdf(buffer, hints = {}) {
  const { doc, page, opNames } = await openFirstPage(buffer);
  let image;
  try {
    const { firstImage } = countOps(await page.getOperatorList(), opNames);
    if (!firstImage) return noneResult('pdf-raster', ['no image on the page']);
    image = await getImageObject(page, firstImage);
  } finally {
    await doc.destroy();
  }
  if (!image || !image.data || !image.width || !image.height) return noneResult('pdf-raster', ['page image could not be decoded']);
  const source = 'pdf-raster';
  const safeHints = hints || {};
  const { width, height } = image;
  // Pixel y grows downward: negate it so the loops are in a y-up frame.
  const pxLoops = traceLoops(image).loops.map((l) => l.map(([x, y]) => [x, -y])).filter((l) => l.length >= 3);

  const hintDia = safeHints.sizeClass ? hintDiameter(safeHints.sizeClass) : null;
  const notes = [];
  let mmPerPx = null;
  let scaleBasis = null;
  let usable = pxLoops;
  const shortSide = Math.min(width, height);
  const bigCircle = pxLoops.map((l) => ({ loop: l, fit: isCircleLike(l) ? circleFit(l) : null }))
    .filter((c) => c.fit && c.fit.r * 2 >= 0.4 * shortSide).sort((x, y) => y.fit.r - x.fit.r)[0];
  const noneRaster = (n) => noneResult(source, n);
  if (bigCircle && hintDia) {
    if (!containsOther(bigCircle.fit, pxLoops, bigCircle.loop)) return noneRaster([NO_CIRCLE_NOTE]);
    mmPerPx = hintDia / (2 * bigCircle.fit.r);
    scaleBasis = 'hint-diameter';
  } else if (safeHints.inventoryDims && safeHints.inventoryDims.a_len) {
    usable = pxLoops.filter((l) => !isBorder(l, shortSide)); // largest first, minus any sheet border
    if (usable.length) {
      mmPerPx = safeHints.inventoryDims.a_len / longSide(usable[0]);
      scaleBasis = 'inventory-dims';
    }
  }
  if (!scaleBasis) {
    return noneRaster(pxLoops.length
      ? [NO_SCALE_NOTE, `${pxLoops.length} unscaled loops found`]
      : ['no enclosed outline found (an outline cut off by the scan edge is not enclosed)']);
  }
  const loops = asLoops(usable.map((l) => l.map(([x, y]) => [x * mmPerPx, y * mmPerPx])));
  return buildExtractionResult({
    source, loops, bridged: 0, scaleBasis, texts: [], numbers: [], hints: safeHints, stated: null, canConfirm: false, notes,
    mmPerUnit: mmPerPx,
  });
}

async function extractFromPdf(buffer, hints = {}) {
  const info = await classifyPdf(buffer);
  if (info.kind === 'scan') return extractFromScannedPdf(buffer, hints);
  if (info.kind === 'vector') return extractFromVectorPdf(buffer, hints);
  return noneResult('pdf-vector', ['empty PDF: no drawn paths and no image']);
}

module.exports = { classifyPdf, extractFromVectorPdf, extractFromScannedPdf, extractFromPdf };
