'use strict';
// Raster tracer for scanned drawings: grey -> Otsu threshold -> ink mask -> morphological close ->
// enclosed white regions -> Moore boundary trace -> Douglas-Peucker. Pure functions over typed arrays.

// pdfjs ImageKind: 1 = 1-bpp grey (packed bits, rows padded to bytes), 2 = RGB 24-bit, 3 = RGBA 32-bit.
function toGray({ data, width, height, kind }) {
  const out = new Uint8Array(width * height);
  if (kind === 1) {
    const stride = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      }
    }
    return out;
  }
  const step = kind === 3 ? 4 : kind === 2 ? 3 : 0;
  if (!step) throw new Error(`unsupported image kind ${kind}`);
  for (let i = 0, p = 0; i < out.length; i++, p += step) {
    out[i] = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
  }
  return out;
}

// Returns t such that the dark class is gray <= t.
function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const diff = sumB / wB - (sumAll - sumB) / wF;
    const between = wB * wF * diff * diff;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

function inkMask(gray, threshold) {
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] <= threshold ? 1 : 0;
  return mask;
}

// Separable box dilate (ink = true) / erode (ink = false). Outside the image is background for
// dilation and ink for erosion, so closing never eats into ink touching the border.
function boxFilter(mask, w, h, radius, dilate) {
  const pass = (src, horizontal) => {
    const dst = new Uint8Array(src.length);
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < n; i++) {
        let out = dilate ? 0 : 1;
        for (let k = -radius; k <= radius; k++) {
          const j = i + k;
          if (j < 0 || j >= n) continue;
          const v = src[horizontal ? l * w + j : j * w + l];
          if (dilate ? v : !v) { out = dilate ? 1 : 0; break; }
        }
        dst[horizontal ? l * w + i : i * w + l] = out;
      }
    }
    return dst;
  };
  return pass(pass(mask, true), false);
}

function closeMask(mask, w, h, size = 3) {
  const radius = Math.max(0, Math.floor(size / 2));
  if (!radius) return mask.slice();
  return boxFilter(boxFilter(mask, w, h, radius, true), w, h, radius, false);
}

// 4-connected labelling of background pixels; regions not touching the border are enclosed.
// `labels` is one shared Int32Array (0 = ink); each region has the id its pixels carry in it.
function enclosedRegions(mask, w, h) {
  const labels = new Int32Array(w * h);
  const regions = [];
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let start = 0; start < labels.length; start++) {
    if (mask[start] || labels[start]) continue;
    next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let area = 0;
    let touchesBorder = false;
    let minX = w; let minY = h; let maxX = -1; let maxY = -1;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      if (x > 0 && !mask[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && !mask[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && !mask[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    if (!touchesBorder) {
      regions.push({
        id: next, area, labels,
        bbox: { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
      });
    }
  }
  return regions;
}

// Moore-neighbour outer boundary of the first foreground blob found, clockwise on screen (y down).
function traceBoundary(regionMask, w, h) {
  let start = -1;
  for (let i = 0; i < regionMask.length; i++) if (regionMask[i]) { start = i; break; }
  if (start < 0) return [];
  const fg = (x, y) => x >= 0 && y >= 0 && x < w && y < h && regionMask[y * w + x] === 1;
  // Clockwise on screen starting west: W, NW, N, NE, E, SE, S, SW.
  const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
  const DY = [0, -1, -1, -1, 0, 1, 1, 1];
  const sx = start % w;
  const sy = (start - sx) / w;
  const pts = [];
  let cx = sx;
  let cy = sy;
  let back = 0; // direction from the current pixel to the background pixel we arrived from (start: west)
  let firstMove = -1;
  const limit = 4 * (w + h) + 8 * w * h;
  for (let guard = 0; guard < limit; guard++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (fg(cx + DX[d], cy + DY[d])) { found = d; break; }
    }
    if (found < 0) { pts.push([cx, cy]); break; } // isolated pixel
    if (cx === sx && cy === sy) {
      if (firstMove < 0) firstMove = found;
      else if (found === firstMove) break; // Jacob's stopping criterion
    }
    pts.push([cx, cy]);
    // The background pixel examined just before the hit is the new backtrack.
    const prev = (found + 7) % 8;
    const bx = cx + DX[prev];
    const by = cy + DY[prev];
    cx += DX[found];
    cy += DY[found];
    for (let d = 0; d < 8; d++) {
      if (cx + DX[d] === bx && cy + DY[d] === by) { back = d; break; }
    }
  }
  return pts;
}

// Douglas-Peucker on a closed ring (anchored at the first point and its farthest point).
function simplify(points, epsilon = 1) {
  const n = points.length;
  if (n < 4) return points.slice();
  const keep = new Uint8Array(n);
  const segDist = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  };
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  keep[0] = 1;
  keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = points[i];
    const b = points[j % n];
    let worst = -1;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(points[k], a, b);
      if (d > worst) { worst = d; idx = k; }
    }
    if (idx >= 0 && worst > epsilon) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function traceLoops(image, { minAreaFraction = 0.002 } = {}) {
  const { width, height } = image;
  const gray = toGray(image);
  const mask = closeMask(inkMask(gray, otsuThreshold(gray)), width, height, 3);
  const minArea = minAreaFraction * width * height;
  const regions = enclosedRegions(mask, width, height)
    .filter((r) => r.area >= minArea)
    .sort((a, b) => b.area - a.area);
  const loops = regions.map((r) => {
    const rm = new Uint8Array(width * height);
    for (let y = r.bbox.minY; y <= r.bbox.maxY; y++) {
      for (let x = r.bbox.minX; x <= r.bbox.maxX; x++) if (r.labels[y * width + x] === r.id) rm[y * width + x] = 1;
    }
    return simplify(traceBoundary(rm, width, height), 1);
  });
  return { loops, width, height };
}

module.exports = {
  toGray, otsuThreshold, inkMask, closeMask, enclosedRegions, traceBoundary, simplify, traceLoops,
};
