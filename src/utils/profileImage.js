/**
 * Find the extrusion profile on a rendered die drawing sheet and cut it out on white.
 *
 * Ported from the NPE analyzer (backend/app/extract/gulf_profile.py: ink_mask,
 * candidate_views, crop_profile). Gulf drawings dimension in blue and mark up in
 * red/magenta, so the profile outline is the only large region of dark, unsaturated
 * ink. Everything here works on plain RGBA pixel buffers, so it runs the same in the
 * browser (canvas ImageData) and in Node tests.
 *
 * Unlike the analyzer we measure nothing, so no scale is needed: the profile is the
 * biggest ink component that is not the sheet border.
 */

// Thresholds are the analyzer's, which renders at 400 DPI; pixel sizes are scaled to
// PROFILE_RENDER_DPI below.
export const PROFILE_RENDER_DPI = 200;
const ANALYZER_DPI = 400;
const px = (atAnalyzerDpi) => Math.max(1, Math.round((atAnalyzerDpi * PROFILE_RENDER_DPI) / ANALYZER_DPI));

const INK_MAX_LEVEL = 110;
const INK_MAX_CHROMA = 45;
const GAP_BRIDGE_PX = px(5);          // a coloured dimension line crossing the outline breaks it
const MIN_VIEW_BBOX_PX2 = 30_000 * (PROFILE_RENDER_DPI / ANALYZER_DPI) ** 2;
const SHEET_BORDER_FRACTION = 0.9;
const KEEP_DILATE_PX = px(5);         // keep the stroke's antialiased edge, or the outline looks ragged
const IMAGE_MARGIN_PX = px(24);
// Outline-style sheets draw each cavity as its own closed loop inside the outer
// contour. A loop is kept when it encloses at least this much white; letter
// counters ("0", "8", "R") and centre marks enclose far less.
const MIN_LOOP_HOLE_PX2 = 300 * (PROFILE_RENDER_DPI / 200) ** 2;
// An order form's table: nearly all straight rules, cut into many cells.
const TABLE_STRAIGHT_FRACTION = 0.85;
const TABLE_MIN_CELLS = 6;
const FORM_TABLE_WIDTH_FRACTION = 0.6;
// Gulf sheets put the complete section, drawn solid at a stated scale, in the top right corner
// under the notes; the larger views below are enlargements and may be broken or partial. A view
// that starts this near the top and reaches this far right is that overview.
const OVERVIEW_MAX_TOP = 0.13;
const OVERVIEW_MIN_RIGHT = 0.85;
const OVERVIEW_MIN_HEIGHT = 0.025;   // a line of notes is about 1 % of the sheet tall
const OVERVIEW_MIN_WIDTH = 0.06;
// The "x" printed beside an exposed surface: a small, squarish glyph of two crossing strokes.
const MARK_MIN_PX = px(14);
const MARK_MAX_PX = px(52);
const MARK_PAD_PX = px(4);

/** Dark, unsaturated pixels: the profile outline, without coloured dimensions and notes. */
export function inkMask({ data, width, height }) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    if (high < INK_MAX_LEVEL && high - low < INK_MAX_CHROMA) mask[p] = 1;
  }
  return mask;
}

// Square-kernel dilate/erode, done as two 1-D passes (separable for a square kernel).
function morph(mask, width, height, size, dilate) {
  const lo = Math.floor((size - 1) / 2);
  const hi = size - 1 - lo;
  const pass = (src, horizontal) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = dilate ? 0 : 1;
        for (let k = -lo; k <= hi; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          // Outside the image counts as background for dilate and as ink for erode, so an
          // erode never eats in from the page edge (cv2's default border behaviour).
          const s = xx < 0 || yy < 0 || xx >= width || yy >= height ? (dilate ? 0 : 1) : src[yy * width + xx];
          if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
        }
        out[y * width + x] = v;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

export const dilate = (mask, width, height, size) => morph(mask, width, height, size, true);
export const close = (mask, width, height, size) =>
  morph(morph(mask, width, height, size, true), width, height, size, false);

/**
 * Connected components: a label per pixel (0 = background) and each label's area and box.
 * 8-connected for ink; pass `diagonal = false` for white space, which must not leak
 * through the corners of a thin diagonal stroke.
 */
export function connectedComponents(mask, width, height, diagonal = true) {
  const labels = new Int32Array(width * height);
  const stats = [null];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = stats.length;
    let top = 0, area = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    stack[top++] = start;
    labels[start] = id;
    while (top) {
      const p = stack[--top];
      const x = p % width, y = (p - x) / width;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (!diagonal && dx && dy)) continue;
          const q = yy * width + xx;
          if (mask[q] && !labels[q]) { labels[q] = id; stack[top++] = q; }
        }
      }
    }
    stats.push({ id, area, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return { labels, stats: stats.slice(1) };
}

/**
 * The white enclosed by one component, within its own box: `inside` (1 = enclosed white)
 * and the area of each enclosed region.
 */
export function enclosedWhite(labels, width, box) {
  const w = box.w + 2, h = box.h + 2; // a white ring, so the outside is one region
  const white = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = box.x + x - 1, sy = box.y + y - 1;
      const own = x > 0 && y > 0 && x <= box.w && y <= box.h && labels[sy * width + sx] === box.id;
      white[y * w + x] = own ? 0 : 1;
    }
  }
  const { labels: regions, stats } = connectedComponents(white, w, h, false);
  const outside = regions[0];
  const inside = new Uint8Array(w * h);
  for (let p = 0; p < inside.length; p++) if (regions[p] && regions[p] !== outside) inside[p] = 1;
  return { inside, w, holes: stats.filter((r) => r.id !== outside).map((r) => r.area) };
}

// Share of a component's pixels on long horizontal or vertical rules.
function straightFraction(labels, width, box) {
  let straight = 0;
  const minRunX = Math.max(8, box.w * 0.3), minRunY = Math.max(8, box.h * 0.3);
  const onRule = new Uint8Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) {
    let run = 0;
    for (let x = 0; x <= box.w; x++) {
      const own = x < box.w && labels[(box.y + y) * width + box.x + x] === box.id;
      if (own) { run++; continue; }
      if (run >= minRunX) for (let k = x - run; k < x; k++) onRule[y * box.w + k] = 1;
      run = 0;
    }
  }
  for (let x = 0; x < box.w; x++) {
    let run = 0;
    for (let y = 0; y <= box.h; y++) {
      const own = y < box.h && labels[(box.y + y) * width + box.x + x] === box.id;
      if (own) { run++; continue; }
      if (run >= minRunY) for (let k = y - run; k < y; k++) onRule[k * box.w + x] = 1;
      run = 0;
    }
  }
  for (const v of onRule) straight += v;
  return straight / box.area;
}

/** A form's table rather than a drawing: straight rules cut into many cells. */
export function looksLikeTable(labels, width, box) {
  if (straightFraction(labels, width, box) < TABLE_STRAIGHT_FRACTION) return false;
  return enclosedWhite(labels, width, box).holes.filter((a) => a >= MIN_LOOP_HOLE_PX2).length >= TABLE_MIN_CELLS;
}

/** The component most likely to be the profile, or null when nothing on the sheet qualifies. */
export function chooseProfile(stats, width, height, labels = null) {
  const candidates = stats
    .filter((s) =>
      !(s.w > SHEET_BORDER_FRACTION * width && s.h > SHEET_BORDER_FRACTION * height) &&
      s.w * s.h >= MIN_VIEW_BBOX_PX2)
    .sort((a, b) => b.area - a.area);
  const [biggest] = candidates;
  if (!biggest) return null;
  // An order form has no drawing: its biggest ink is a table across the page. The
  // supplier box stamped on a drawing is a table too, but a narrow one.
  if (labels && biggest.w > FORM_TABLE_WIDTH_FRACTION * width && looksLikeTable(labels, width, biggest)) return null;
  const overview = candidates.find((s) =>
    s.y <= OVERVIEW_MAX_TOP * height && s.x + s.w >= OVERVIEW_MIN_RIGHT * width &&
    s.h >= OVERVIEW_MIN_HEIGHT * height && s.w >= OVERVIEW_MIN_WIDTH * width);
  return overview || biggest;
}

/**
 * The views worth cutting out, best first: the overview, then the biggest view when that is a
 * different one. A stamp pasted over the overview hides part of it on some sheets; whoever can
 * check a picture against the drawing's CCD then has the other view to fall back on.
 */
export function chooseProfiles(stats, width, height, labels = null) {
  const first = chooseProfile(stats, width, height, labels);
  if (!first) return [];
  const biggest = stats
    .filter((s) =>
      !(s.w > SHEET_BORDER_FRACTION * width && s.h > SHEET_BORDER_FRACTION * height) &&
      s.w * s.h >= MIN_VIEW_BBOX_PX2)
    .sort((a, b) => b.area - a.area)[0];
  return biggest && biggest.id !== first.id ? [first, biggest] : [first];
}

/** Two strokes crossing: ink in the middle and towards the corners, none at the middle of any side. */
function looksLikeCross(ink, w, h) {
  const share = (x0, y0, x1, y1) => {
    let n = 0, on = 0;
    for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++) {
      for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) { n++; on += ink[y * w + x]; }
    }
    return n ? on / n : 0;
  };
  const third = 1 / 3, edge = 0.22;
  if (share(third, third, 2 * third, 2 * third) < 0.25) return false;
  const sides = [share(third, 0, 2 * third, edge), share(third, 1 - edge, 2 * third, 1), share(0, third, edge, 2 * third), share(1 - edge, third, 1, 2 * third)];
  if (sides.some((v) => v > 0.12)) return false;
  const corners = [share(0, 0, third, third), share(2 * third, 0, 1, third), share(0, 2 * third, third, 1), share(2 * third, 2 * third, 1, 1)];
  return corners.every((v) => v > 0.12);
}

/**
 * The "x" surface marks standing beside the view: 1 for every pixel of one (padded a little).
 * `ink` is the sheet's ink before any gap is bridged, so a mark that only sits close to the
 * outline is still a piece of its own. A mark printed onto the outline cannot be told apart.
 */
export function surfaceMarks(ink, width, height, view) {
  const x0 = Math.max(0, view.x - MARK_MAX_PX), y0 = Math.max(0, view.y - MARK_MAX_PX);
  const x1 = Math.min(width, view.x + view.w + MARK_MAX_PX), y1 = Math.min(height, view.y + view.h + MARK_MAX_PX);
  const w = x1 - x0, h = y1 - y0;
  const local = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) local[y * w + x] = ink[(y + y0) * width + x + x0];
  const { labels, stats } = connectedComponents(local, w, h);
  const marks = new Uint8Array(width * height);
  let found = 0;
  for (const s of stats) {
    if (s.w < MARK_MIN_PX || s.h < MARK_MIN_PX || s.w > MARK_MAX_PX || s.h > MARK_MAX_PX) continue;
    const ratio = s.w / s.h;
    if (ratio < 0.55 || ratio > 1.8) continue;
    const own = new Uint8Array(s.w * s.h);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) own[y * s.w + x] = labels[(s.y + y) * w + s.x + x] === s.id ? 1 : 0;
    if (!looksLikeCross(own, s.w, s.h)) continue;
    found++;
    for (let y = Math.max(0, s.y - MARK_PAD_PX); y < Math.min(h, s.y + s.h + MARK_PAD_PX); y++) {
      for (let x = Math.max(0, s.x - MARK_PAD_PX); x < Math.min(w, s.x + s.w + MARK_PAD_PX); x++) {
        // Only around the glyph's own pixels, so the outline beside it stays whole.
        let near = false;
        for (let dy = -MARK_PAD_PX; dy <= MARK_PAD_PX && !near; dy++) {
          const yy = y + dy;
          if (yy < s.y || yy >= s.y + s.h) continue;
          for (let dx = -MARK_PAD_PX; dx <= MARK_PAD_PX; dx++) {
            const xx = x + dx;
            if (xx >= s.x && xx < s.x + s.w && labels[yy * w + xx] === s.id) { near = true; break; }
          }
        }
        if (near && labels[y * w + x] === 0 || labels[y * w + x] === s.id) marks[(y + y0) * width + x + x0] = 1;
      }
    }
  }
  return { marks, found };
}

/**
 * The view's pieces: the outer contour, plus every closed loop drawn inside it (the
 * cavities of an outline-style sheet). Text, centre marks and dimension strokes inside
 * the bore enclose no real area and are left out.
 */
export function profileParts(labels, stats, width, view) {
  const parts = new Set([view.id]);
  const { inside, w } = enclosedWhite(labels, width, view);
  const isInside = (x, y) => inside[(y - view.y + 1) * w + (x - view.x + 1)] === 1;
  for (const s of stats) {
    if (s.id === view.id || s.x < view.x || s.y < view.y ||
        s.x + s.w > view.x + view.w || s.y + s.h > view.y + view.h) continue;
    // Within the contour only if every pixel sits in the white it encloses.
    let within = true;
    for (let y = s.y; y < s.y + s.h && within; y++) {
      for (let x = s.x; x < s.x + s.w; x++) {
        if (labels[y * width + x] === s.id && !isInside(x, y)) { within = false; break; }
      }
    }
    if (!within) continue;
    if (enclosedWhite(labels, width, s).holes.some((a) => a >= MIN_LOOP_HOLE_PX2)) parts.add(s.id);
  }
  return parts;
}

/**
 * The profile alone, on white: { data, width, height } (RGBA), or null when no profile
 * was found. Only the component's own pixels are kept, so dimension text, "x" marks and
 * anything printed inside the bore are dropped, not just cropped around.
 */
export function extractProfile(image) {
  return extractProfiles(image, 1)[0] || null;
}

/** Every view chooseProfiles names (at most `limit`), each cut out as extractProfile does. */
export function extractProfiles(image, limit = 2) {
  const { width, height } = image;
  const ink = inkMask(image);
  const mask = close(ink, width, height, GAP_BRIDGE_PX);
  const { labels, stats } = connectedComponents(mask, width, height);
  return chooseProfiles(stats, width, height, labels).slice(0, limit)
    .map((view) => cutView(image, ink, labels, stats, view));
}

function cutView(image, ink, labels, stats, view) {
  const { data, width, height } = image;
  const parts = profileParts(labels, stats, width, view);
  const component = new Uint8Array(width * height);
  for (let p = 0; p < component.length; p++) if (parts.has(labels[p])) component[p] = 1;
  const keep = dilate(component, width, height, KEEP_DILATE_PX);
  const { marks } = surfaceMarks(ink, width, height, view);

  const left = Math.max(0, view.x - IMAGE_MARGIN_PX);
  const top = Math.max(0, view.y - IMAGE_MARGIN_PX);
  const right = Math.min(width, view.x + view.w + IMAGE_MARGIN_PX);
  const bottom = Math.min(height, view.y + view.h + IMAGE_MARGIN_PX);
  const outW = right - left, outH = bottom - top;
  const out = new Uint8ClampedArray(outW * outH * 4).fill(255);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = (y + top) * width + (x + left);
      if (!keep[p] || marks[p]) continue;
      const o = (y * outW + x) * 4;
      out[o] = data[p * 4]; out[o + 1] = data[p * 4 + 1]; out[o + 2] = data[p * 4 + 2];
    }
  }
  return { data: out, width: outW, height: outH };
}

/**
 * Browser only: render a pdf.js page and return its profile as a PNG Blob, or null
 * when the sheet has none. Never throws; an import must not fail over a picture.
 */
export async function captureProfileImage(page) {
  return (await captureProfileImages(page, 1))[0] || null;
}

/**
 * Browser only: the page's views (extractProfiles) as PNG Blobs, best first; [] when the sheet
 * has no profile. Never throws.
 */
export async function captureProfileImages(page, limit = 2) {
  try {
    const viewport = page.getViewport({ scale: PROFILE_RENDER_DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blobs = [];
    for (const profile of extractProfiles(ctx.getImageData(0, 0, canvas.width, canvas.height), limit)) {
      const out = document.createElement('canvas');
      out.width = profile.width;
      out.height = profile.height;
      out.getContext('2d').putImageData(new ImageData(profile.data, profile.width, profile.height), 0, 0);
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
      if (blob) blobs.push(blob);
    }
    return blobs;
  } catch (err) {
    console.warn('Profile image capture failed:', err);
    return [];
  }
}

// The title block sits in the bottom of the sheet; this much of the page holds all of it.
const TITLE_BLOCK_FROM = 0.83;
const TITLE_BLOCK_DPI = 300; // small lettering: OCR wants about 300 DPI

/**
 * Browser only: the bottom strip of a pdf.js page (its title block) as a PNG Blob, for OCR on
 * the server. Null when it cannot be rendered; never throws.
 */
export async function captureTitleBlockImage(page) {
  try {
    const viewport = page.getViewport({ scale: TITLE_BLOCK_DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const top = Math.floor(canvas.height * TITLE_BLOCK_FROM);
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height - top;
    out.getContext('2d').drawImage(canvas, 0, top, out.width, out.height, 0, 0, out.width, out.height);
    return await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  } catch (err) {
    console.warn('Title block capture failed:', err);
    return null;
  }
}
