'use strict';
// PDF opening extractors. A vector PDF is read from its operator list (no rendering); a scanned PDF is
// read from its decoded image and traced by rasterTrace. Both return the ExtractionResult documented in
// dxfOpenings.cjs (source 'pdf-vector' | 'pdf-raster').
//
// Neither extractor knows the drawing scale natively, so it comes from the stated diameter (drawing text,
// then size-class hint), or from the inventory dimensions of the pocket. Nothing here is ever 'confirmed'.

const {
  chainLoops, classifyLoops, pocketGapMm, normaliseFrame, gradeConfidence, circleFit, isCircleLike, bbox,
} = require('./openingGeometry.cjs');
const { sizeFromTexts, numbersFromTexts } = require('./dxfOpenings.cjs');
const { normalizeSizeClass } = require('./toolingNumbers.cjs');
const { toGray, otsuThreshold, inkMask, closeMask, enclosedRegions, traceBoundary, simplify } = require('./rasterTrace.cjs');

const STROKING = new Set(['stroke', 'closeStroke', 'fillStroke', 'closeFillStroke', 'eoFillStroke', 'closeEOFillStroke']);
const CLOSING = new Set(['closeStroke', 'closeFillStroke', 'closeEOFillStroke']);
const CURVE_SEGMENTS = 16;
const INK_MAX_CHANNEL = 0.63;
const INK_MAX_SPREAD = 0.25;
const NO_SCALE_NOTE = 'scale unknown: no size text, size class or inventory dims';
const TOLERANCE_MM = 2;

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

// Returns the stroked ink chains (points in sheet space, CTM applied) plus the stroked-path count.
function walkPaths(opList, opNames, base) {
  const chains = [];
  let strokedPaths = 0;
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
      strokedPaths++;
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
  return { chains, strokedPaths };
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

const fmt = (n) => String(Math.round(n * 10) / 10);

function diameterOf(sizeClass) {
  const m = /^(\d+(?:\.\d+)?)X\d/.exec(normalizeSizeClass(sizeClass) || '');
  return m ? Number(m[1]) : null;
}

function noneResult(source, notes, extra = {}) {
  return {
    source, outer: null, outerSynthesised: false, pockets: [], pocketGapMm: null, cavities: null,
    sizeClass: null, sizeClassSource: null, sizeClassConfidence: null, scaleBasis: null,
    confidence: 'none', numbersInDrawing: [], texts: [], notes, ...extra,
  };
}

const longSide = (points) => { const b = bbox(points); return Math.max(b.width, b.height); };

// Circle fit that tolerates a key slot cut into the rim: refit on the points inside a tightening band until the
// fit is within 1 % of the radius. Accepted only when most points are on the circle and they go nearly all the way
// round, so a pocket outline never passes. Returns the fit or null.
function robustCircle(points) {
  if (points.length < 8) return null;
  let pts = points;
  // Start from the bounding box: a key slot cuts inwards, so the rim still defines it, whereas a least-squares
  // fit over every point is dragged off-centre by the slot.
  const bb = bbox(points);
  let fit = { cx: bb.cx, cy: bb.cy, r: (bb.width + bb.height) / 4, maxDeviation: Infinity };
  for (const band of [0.03, 0.015, 0.01]) {
    for (let again = 0; again < 5; again++) {
      if (!Number.isFinite(fit.r)) return null;
      const tol = Math.max(1, band * fit.r);
      const keep = pts.filter((q) => Math.abs(Math.hypot(q[0] - fit.cx, q[1] - fit.cy) - fit.r) <= tol);
      if (keep.length < 8) return null;
      const stable = keep.length === pts.length;
      pts = keep;
      fit = circleFit(pts);
      if (stable) break;
    }
  }
  if (pts.length < 0.6 * points.length || fit.maxDeviation > Math.max(1, 0.01 * fit.r)) return null;
  const angles = pts.map((q) => Math.atan2(q[1] - fit.cy, q[0] - fit.cx)).sort((a, b) => a - b);
  let widest = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) widest = Math.max(widest, angles[i] - angles[i - 1]);
  return widest <= Math.PI / 3 ? fit : null;
}

function circlePolygon({ cx, cy, r }, n = 64) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
}

// loops are already in millimetres. stated = sizeFromTexts() result or null.
function buildResult({ source, loops, bridged, stated, hints, scaleBasis, texts, notes }) {
  const { sizeClass: hintSize = null, cavities: knownCavities = null, inventoryDims = null } = hints || {};
  const normHint = hintSize ? normalizeSizeClass(hintSize) : null;
  const validHint = normHint && diameterOf(normHint) != null ? normHint : null;
  if (normHint && !validHint) notes.push('ignored malformed size hint');
  const hinted = stated ? null : validHint;
  const expectedDiameter = stated ? stated.diameter : hinted ? diameterOf(hinted) : null;

  const cls = classifyLoops(loops, { expectedOuterDiameter: expectedDiameter });
  const framed = normaliseFrame({ outer: cls.outer, pockets: cls.pockets });
  const outer = framed.outer ? framed.outer.points : null;
  const pockets = framed.pockets.map((p) => p.points);

  const drawnCircle = !!(cls.outer && !cls.outerSynthesised && isCircleLike(cls.outer.points));
  const graded = gradeConfidence({
    outer: cls.outer,
    outerSynthesised: cls.outerSynthesised,
    pockets,
    bridged,
    source,
    statedDiameter: drawnCircle || cls.outerSynthesised ? expectedDiameter : null,
    knownCavities,
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
    sizeClassConfidence = 'likely'; // a PDF is scaled from its own size text, so the drawn circle cannot confirm it
  }

  if (inventoryDims && pockets.length) {
    const b = bbox(pockets[0]);
    const long = Math.max(b.width, b.height);
    const short = Math.min(b.width, b.height);
    // Scaling to inventory dims fixes the long side by construction; only the short side is a check then.
    const longOk = scaleBasis === 'inventory-dims' || Math.abs(long - inventoryDims.a_len) <= TOLERANCE_MM;
    if (longOk && Math.abs(short - inventoryDims.b_wid) <= TOLERANCE_MM) {
      notes.push('inventory dims agree');
    } else {
      notes.push(`pocket ${fmt(long)} x ${fmt(short)} mm disagrees with inventory dims ${inventoryDims.a_len} x ${inventoryDims.b_wid}`);
      if (confidence !== 'none') confidence = 'uncertain';
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
    numbersInDrawing: numbersFromTexts(texts),
    texts,
    notes,
  };
}

const asLoops = (rings) => rings.map((points) => ({ points, layer: '', bridgedGaps: 0, sources: [] }));

// ---- vector PDF -------------------------------------------------------------------

async function extractFromVectorPdf(buffer, hints = {}) {
  const { doc, page, opNames } = await openFirstPage(buffer);
  let chains;
  let texts;
  let pageSize;
  try {
    ({ chains } = walkPaths(await page.getOperatorList(), opNames, sheetMatrix(page)));
    texts = await pageTexts(page);
    const viewport = page.getViewport({ scale: 1 });
    pageSize = [viewport.width, viewport.height];
  } finally {
    await doc.destroy();
  }
  const source = 'pdf-vector';
  const notes = [];
  const safeHints = hints || {};
  const stated = sizeFromTexts(texts);
  const hintDia = safeHints.sizeClass ? diameterOf(safeHints.sizeClass) : null;
  const diameter = stated ? stated.diameter : hintDia;

  // Pass 1, in PDF points: find the scale circle (the largest circle-like loop) and the unscaled loops.
  const first = chainLoops(chains, { joinTol: 0.5, bridgeTol: 2 });
  let mmPerUnit = null;
  let scaleBasis = null;
  const circles = first.loops.map((l) => robustCircle(l.points)).filter(Boolean).sort((a, b) => b.r - a.r);
  if (circles.length && diameter) {
    mmPerUnit = diameter / (2 * circles[0].r);
    scaleBasis = stated ? 'text-diameter' : 'hint-diameter';
  } else if (!circles.length && safeHints.inventoryDims && safeHints.inventoryDims.a_len) {
    // Ignore a loop spanning the whole sheet (the drawing border).
    const candidates = first.loops.filter((l) => {
      const b = bbox(l.points);
      return !(b.width >= 0.9 * pageSize[0] && b.height >= 0.9 * pageSize[1]);
    });
    if (candidates.length) {
      const largest = candidates.reduce((m, l) => (longSide(l.points) > longSide(m.points) ? l : m));
      mmPerUnit = safeHints.inventoryDims.a_len / longSide(largest.points);
      scaleBasis = 'inventory-dims';
    }
  }
  if (!scaleBasis) {
    return noneResult(source, [NO_SCALE_NOTE, `${first.loops.length} unscaled loops found`], {
      numbersInDrawing: numbersFromTexts(texts), texts,
    });
  }

  // Pass 2: scale the raw chains, then chain again so the 0.5 mm / 2 mm tolerances mean millimetres.
  const scaled = chains.map((c) => ({ ...c, points: c.points.map(([x, y]) => [x * mmPerUnit, y * mmPerUnit]) }));
  const second = chainLoops(scaled);
  const bridged = second.bridged;
  // A rim drawn with its key slot is one loop that is not quite a circle: use the circle it is drawn on.
  const loops = second.loops.map((l) => {
    if (isCircleLike(l.points)) return l;
    const fit = robustCircle(l.points);
    if (!fit || fit.r * 2 < 100) return l;
    notes.push('key slot cut into the outer circle ignored');
    return { ...l, points: circlePolygon(fit) };
  });
  return buildResult({ source, loops, bridged, stated, hints: safeHints, scaleBasis, texts, notes });
}

// ---- scanned PDF ------------------------------------------------------------------

function getImageObject(page, name) {
  return new Promise((resolve, reject) => {
    try {
      const store = name.startsWith('g_') ? page.commonObjs : page.objs;
      store.get(name, resolve);
    } catch (err) { reject(err); }
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
  const source = 'pdf-raster';
  const safeHints = hints || {};
  const { width, height } = image;
  const gray = toGray({ data: image.data, width, height, kind: image.kind });
  const mask = closeMask(inkMask(gray, otsuThreshold(gray)), width, height, 3);
  const minArea = 0.002 * width * height;
  const regions = enclosedRegions(mask, width, height).filter((r) => r.area >= minArea).sort((a, b) => b.area - a.area);
  // Pixel y grows downward: negate it so the loops are in a y-up frame.
  const pxLoops = regions.map((r) => {
    const rm = new Uint8Array(width * height);
    for (let y = r.bbox.minY; y <= r.bbox.maxY; y++) {
      for (let x = r.bbox.minX; x <= r.bbox.maxX; x++) if (r.labels[y * width + x] === r.id) rm[y * width + x] = 1;
    }
    return simplify(traceBoundary(rm, width, height), 1).map(([x, y]) => [x, -y]);
  }).filter((l) => l.length >= 3);

  const hintDia = safeHints.sizeClass ? diameterOf(safeHints.sizeClass) : null;
  const notes = [];
  let mmPerPx = null;
  let scaleBasis = null;
  const shortSide = Math.min(width, height);
  const bigCircle = pxLoops.map((l) => (isCircleLike(l) ? circleFit(l) : null)).filter((f) => f && f.r * 2 >= 0.4 * shortSide)
    .sort((a, b) => b.r - a.r)[0];
  if (bigCircle && hintDia) {
    mmPerPx = hintDia / (2 * bigCircle.r);
    scaleBasis = 'hint-diameter';
  } else if (pxLoops.length && safeHints.inventoryDims && safeHints.inventoryDims.a_len) {
    mmPerPx = safeHints.inventoryDims.a_len / longSide(pxLoops[0]);
    scaleBasis = 'inventory-dims';
  }
  if (!scaleBasis) {
    return noneResult(source, pxLoops.length
      ? [NO_SCALE_NOTE, `${pxLoops.length} unscaled loops found`]
      : ['no enclosed outline found (an outline cut off by the scan edge is not enclosed)']);
  }
  const loops = asLoops(pxLoops.map((l) => l.map(([x, y]) => [x * mmPerPx, y * mmPerPx])));
  return buildResult({ source, loops, bridged: 0, stated: null, hints: safeHints, scaleBasis, texts: [], notes });
}

async function extractFromPdf(buffer, hints = {}) {
  const info = await classifyPdf(buffer);
  if (info.kind === 'scan') return extractFromScannedPdf(buffer, hints);
  if (info.kind === 'vector') return extractFromVectorPdf(buffer, hints);
  return noneResult('pdf-vector', ['empty PDF: no drawn paths and no image']);
}

module.exports = { classifyPdf, extractFromVectorPdf, extractFromScannedPdf, extractFromPdf };
