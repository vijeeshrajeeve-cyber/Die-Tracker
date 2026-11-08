'use strict';
// Picture -> profile shape: decodes a GIF/PNG and turns its largest ink component into an outer
// outline plus holes in pixel coordinates (y up: pixel rows negated). Pictures come in two styles:
// filled silhouettes (holes are the white regions directly inside the ink) and thin-stroke outline
// drawings (the outer stroke encloses white, inner strokes draw the cavities: holes are the white
// regions at even nesting depth). A review rule compares the hole count with the sheet verdict.
// The root is the largest ink component whose bounding box covers >= 2 % of the picture: a
// bounding box, not ink pixels, so a thin-walled section (oval tube, clip) still qualifies.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  toGray, otsuThreshold, inkMask, closeMask, enclosedRegions, traceBoundary, simplify,
} = require('./rasterTrace.cjs');

const MIN_COMPONENT_FRACTION = 0.02; // a root's bounding-box area vs the picture area
const BORDER_SPAN = 0.95; // a component this wide and tall may be a picture frame
const FRAME_INK_FRACTION = 0.9; // ...and is one when this much of its ink hugs its bbox edges
const MIN_HOLE_FRACTION = 0.01; // of the outer area
const OUTLINE_STROKE_RATIO = 0.04; // stroke width vs the outer bbox's shorter side
const OUTLINE_WHITE_FRACTION = 0.5; // largest enclosed white region vs the outer area

async function decodeImage(buffer) {
  const img = await loadImage(buffer);
  const { width, height } = img;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

// RGBA -> grey with transparency composited onto white.
function grayOnWhite({ data, width, height }) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 4, q += 3) {
    const a = data[p + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[q + c] = Math.round(data[p + c] * a + 255 * (1 - a));
  }
  return toGray({ data: rgb, width, height, kind: 2 });
}

// 8-connected labelling of ink; components carry their area, bbox and first pixel in raster order.
function labelInk(mask, w, h) {
  const labels = new Int32Array(w * h);
  const comps = [null];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < labels.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = comps.length;
    const c = { id, area: 0, first: start, minX: w, minY: h, maxX: -1, maxY: -1 };
    comps.push(c);
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; }
        }
      }
    }
  }
  return { labels, comps };
}

// A picture frame spans the picture and keeps nearly all its ink near its own bbox edges (span
// alone is not enough: some sections, e.g. GEX1 row 18681, fill their whole picture).
function isPictureBorder(c, inkLabels, w, h) {
  const bw = c.maxX - c.minX + 1;
  const bh = c.maxY - c.minY + 1;
  if (bw < BORDER_SPAN * w || bh < BORDER_SPAN * h) return false;
  const m = Math.max(3, Math.round(0.03 * Math.min(bw, bh)));
  let nearEdge = 0;
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      if (inkLabels[y * w + x] !== c.id) continue;
      if (x - c.minX < m || c.maxX - x < m || y - c.minY < m || c.maxY - y < m) nearEdge++;
    }
  }
  return nearEdge >= FRAME_INK_FRACTION * c.area;
}

const bboxArea = (c) => (c.maxX - c.minX + 1) * (c.maxY - c.minY + 1);

// The largest qualifying component by ink area; qualifying is by bounding-box area (see the top).
function pickRoot(ink, w, h) {
  const minArea = MIN_COMPONENT_FRACTION * w * h;
  return ink.comps.slice(1)
    .filter((c) => bboxArea(c) >= minArea && !isPictureBorder(c, ink.labels, w, h))
    .sort((a, b) => b.area - a.area)[0] || null;
}

// Nesting depth below the root ink component: the root is 0, a white region directly inside it 1,
// an ink component inside that region 1, a white region inside that ink 2, and so on. A
// component's parent is found through the pixel above its first (top-left) pixel, which lies in
// the enclosing region of the other kind. -1 = not inside the root.
function nestingDepths(root, ink, white, w) {
  const enclosed = new Set(white.regions.map((r) => r.id));
  const whiteFirst = new Map();
  for (let i = 0; i < white.labels.length; i++) {
    const id = white.labels[i];
    if (id && enclosed.has(id) && !whiteFirst.has(id)) whiteFirst.set(id, i);
  }
  const inkDepth = new Map([[root.id, 0]]);
  const whiteDepth = new Map();
  let depthOfInk;
  const depthOfWhite = (id) => {
    if (!enclosed.has(id)) return -1;
    if (!whiteDepth.has(id)) {
      whiteDepth.set(id, -1); // guards against cycles while resolving
      const parent = depthOfInk(ink.labels[whiteFirst.get(id) - w]);
      whiteDepth.set(id, parent < 0 ? -1 : parent + 1);
    }
    return whiteDepth.get(id);
  };
  depthOfInk = (id) => {
    if (!id) return -1;
    if (!inkDepth.has(id)) {
      inkDepth.set(id, -1);
      const p = ink.comps[id].first;
      inkDepth.set(id, p < w ? -1 : depthOfWhite(white.labels[p - w]));
    }
    return inkDepth.get(id);
  };
  for (const r of white.regions) depthOfWhite(r.id);
  for (let id = 1; id < ink.comps.length; id++) depthOfInk(id);
  return { inkDepth, whiteDepth };
}

// Stroke width from erosion: count 3x3 erosions until half the ink is gone; width ~ 2 * passes + 1.
function strokeWidthOf(inkOnly, w, h) {
  let cur = inkOnly;
  let total = 0;
  for (let i = 0; i < cur.length; i++) total += cur[i];
  if (!total) return 0;
  let passes = 0;
  let left = total;
  while (left > total / 2) {
    const next = new Uint8Array(cur.length);
    left = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!cur[p]) continue;
        if (cur[p - w - 1] && cur[p - w] && cur[p - w + 1] && cur[p - 1] && cur[p + 1]
          && cur[p + w - 1] && cur[p + w] && cur[p + w + 1]) { next[p] = 1; left++; }
      }
    }
    cur = next;
    passes++;
  }
  return 2 * passes + 1;
}

const yUp = (pts) => pts.map(([x, y]) => [x, y ? -y : 0]);

function traceRegion(labels, id, bb, w, h) {
  const m = new Uint8Array(w * h);
  for (let y = bb.minY; y <= bb.maxY; y++) {
    for (let x = bb.minX; x <= bb.maxX; x++) if (labels[y * w + x] === id) m[y * w + x] = 1;
  }
  return yUp(simplify(traceBoundary(m, w, h), 1));
}

// Silhouette or outline drawing? `candidates` are the enclosed white regions >= 1 % of the outer
// area, largest first. Nested strokes (even-depth regions) prove an outline drawing; thick walls,
// several cavities or a small cavity prove a silhouette. A thin stroke around one dominant region
// looks the same either way: the sheet verdict decides, else it defaults to a line drawing.
function resolveStyle(candidates, whiteDepth, area, thick, expectHollow) {
  const depth = (r) => whiteDepth.get(r.id);
  const nested = candidates.filter((r) => depth(r) >= 2 && depth(r) % 2 === 0);
  if (nested.length) return { style: 'outline', holeRegions: nested, styleResolvedBy: 'geometry' };
  const direct = candidates.filter((r) => depth(r) === 1);
  const dominant = direct.length === 1 && direct[0].area >= OUTLINE_WHITE_FRACTION * area;
  if (thick || !dominant) return { style: 'silhouette', holeRegions: direct, styleResolvedBy: 'geometry' };
  if (expectHollow === true) return { style: 'silhouette', holeRegions: direct, styleResolvedBy: 'verdict' };
  return { style: 'outline', holeRegions: [], styleResolvedBy: expectHollow === false ? 'verdict' : 'default' };
}

// inkFraction is reported but not judged: a thin outline of a large solid is legitimately low.
function reviewOf({ holeCount }, expectHollow) {
  if (expectHollow !== true && expectHollow !== false) return null;
  if ((holeCount > 0) === expectHollow) return null;
  return holeCount > 0
    ? 'image shows a hollow section but the sheet says solid'
    : 'image shows a solid section but the sheet says hollow';
}

function shapeFromImage(image, { expectHollow = null } = {}) {
  const { width: w, height: h } = image;
  const gray = grayOnWhite(image);
  const mask = closeMask(inkMask(gray, otsuThreshold(gray)), w, h, 3);
  const ink = labelInk(mask, w, h);
  const root = pickRoot(ink, w, h);
  if (!root) return null;
  const regions = enclosedRegions(mask, w, h);
  // The shared label array rides on each region; with none enclosed, no pixel needs a white label.
  const white = { regions, labels: regions.length ? regions[0].labels : new Int32Array(w * h) };
  const { inkDepth, whiteDepth } = nestingDepths(root, ink, white, w);

  // Filled silhouette = the root ink and everything nested inside it.
  const filled = new Uint8Array(w * h);
  const inkInside = new Uint8Array(w * h);
  let area = 0;
  let inkPixels = 0;
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let p = 0; p < filled.length; p++) {
    const isInk = ink.labels[p] ? inkDepth.get(ink.labels[p]) >= 0 : false;
    const isWhite = !ink.labels[p] && (whiteDepth.get(white.labels[p]) ?? -1) >= 1;
    if (!isInk && !isWhite) continue;
    filled[p] = 1;
    area++;
    if (isInk) { inkInside[p] = 1; inkPixels++; }
    const x = p % w;
    const y = (p - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const outer = yUp(simplify(traceBoundary(filled, w, h), 1));
  const pxBbox = { width: maxX - minX + 1, height: maxY - minY + 1 };

  const candidates = white.regions
    .filter((r) => whiteDepth.get(r.id) >= 1 && r.area >= MIN_HOLE_FRACTION * area)
    .sort((a, b) => b.area - a.area);
  const strokeWidthPx = strokeWidthOf(inkInside, w, h);
  const thick = strokeWidthPx > OUTLINE_STROKE_RATIO * Math.min(pxBbox.width, pxBbox.height);
  const { style, holeRegions, styleResolvedBy } = resolveStyle(candidates, whiteDepth, area, thick, expectHollow);
  const holes = holeRegions.map((r) => traceRegion(white.labels, r.id, r.bbox, w, h));

  const inkFraction = inkPixels / area;
  const reviewReason = reviewOf({ holeCount: holes.length }, expectHollow);
  return {
    outer, holes, style, styleResolvedBy, inkFraction, strokeWidthPx, holeCount: holes.length,
    needsReview: reviewReason !== null, reviewReason, pxBbox,
  };
}

module.exports = { decodeImage, shapeFromImage };
