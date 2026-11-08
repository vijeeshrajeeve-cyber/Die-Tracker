'use strict';
// Profile shape bundle. The build half runs on the PC: it reads the image-check workbook, traces
// every picture into a shape and writes a bundle folder (manifest.json, shapes.json, report.json,
// files/profiles/…). The apply half (server side, Task 5) loads that bundle into profile_shapes.
const { sha256Of, profileImagePath } = require('./toolingDrawings.cjs');
const { decodeImage, shapeFromImage } = require('./profileRaster.cjs');
const { toUnitFrame, signatureOf, shapeStats } = require('./profileShape.cjs');
const {
  readSheetIndex, readSharedStrings, readRows, readPictureAnchors, parseGex1Row, parseGex2Row, reviewFromNote,
} = require('./imageCheckWorkbook.cjs');

// ---------------------------------------------------------------------------------------------
// Build (PC side)
// ---------------------------------------------------------------------------------------------

const SHEETS = {
  GEX1: { plant: 'GEX 1', parse: parseGex1Row },
  GEX2: { plant: 'GEX 2', parse: parseGex2Row },
};
const IMAGE_EXTS = new Set(['gif', 'png']);
const NEARLY_BLANK = 'image nearly blank'; // profileRaster's review reason for an empty picture

// 'Hollow' / 'HOLOW' -> true, 'SOLID' / 'solid' / 'SOLD' -> false, anything else -> null.
const hollowFrom = (s) => {
  const t = (s || '').trim().toUpperCase();
  if (t.startsWith('HOL')) return true;
  if (t.startsWith('SOL')) return false;
  return null;
};

const finiteOrNull = (n) => (Number.isFinite(n) ? n : null);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const roundPoly = (poly) => poly.map(([x, y]) => [round6(x), round6(y)]);

const noteKind = (note) => {
  if (!note) return null;
  if (/^mismatch/i.test(note)) return 'noteMismatch';
  if (/^no image/i.test(note)) return 'noImage';
  return 'blankOrUnclear';
};

function newReport() {
  return {
    rowsSeen: 0,
    rowsWithPicture: 0,
    rowsWithoutPicture: 0,
    picturesDecoded: 0,
    picturesShared: 0,
    shapesWritten: 0,
    // Note categories (noteMismatch, noImage, blankOrUnclear) count every data row whose column-G
    // note says so, picture or not; verdictMismatch and nullShape count traced pictures;
    // a tracer "nearly blank" picture also counts under blankOrUnclear.
    needsReview: { verdictMismatch: 0, noteMismatch: 0, noImage: 0, blankOrUnclear: 0, nullShape: 0 },
    styles: { silhouette: 0, outline: 0 },
    styleResolvedBy: { geometry: 0, verdict: 0, default: 0 },
    errors: [],
  };
}

// Rows -> work items: every data row is counted; rows with a die number and pictures become items.
// `limit` caps the number of pictures taken, so the last row may keep only some of its pictures.
function collectItems(zip, plan, sharedStrings, limit, report) {
  const items = [];
  let pictures = 0;
  for (const sheet of plan) {
    const byRow = new Map();
    for (const a of sheet.anchors) {
      if (!byRow.has(a.row)) byRow.set(a.row, []);
      byRow.get(a.row).push(a);
    }
    for (const { row, cells } of readRows(zip, sheet.sheetPath, sharedStrings)) {
      if (row === 1) continue; // header
      if (limit != null && pictures >= limit) return items;
      report.rowsSeen++;
      const r = sheet.parse(cells);
      const note = reviewFromNote(r.note);
      if (note.needsReview) report.needsReview[noteKind(note.reason)]++;
      if (!r.dieNo) { report.errors.push({ row: `${sheet.name}!${row}`, error: 'blank IDDie' }); continue; }
      const anchors = byRow.get(row) || [];
      if (!anchors.length) { report.rowsWithoutPicture++; continue; }
      report.rowsWithPicture++;
      const taken = limit == null ? anchors : anchors.slice(0, limit - pictures);
      pictures += taken.length;
      items.push({
        sheet, row, r, note, anchors: taken,
        // The verdict (F) when it parses, else the die type (C).
        expectHollow: hollowFrom(r.verdict) ?? hollowFrom(r.dieType),
      });
    }
  }
  return items;
}

async function buildProfileBundle({
  zip, sheets = ['GEX1', 'GEX2'], io, decode = decodeImage, limit = null, onProgress,
}) {
  const index = readSheetIndex(zip);
  const sharedStrings = readSharedStrings(zip);
  const plan = sheets.map((name) => {
    if (!SHEETS[name]) throw new Error(`Unsupported sheet ${name}: expected one of ${Object.keys(SHEETS).join(', ')}`);
    const where = index.get(name);
    if (!where) throw new Error(`Sheet ${name} not found in the workbook`);
    const anchors = where.drawingPath ? readPictureAnchors(zip, where.drawingPath) : [];
    return { name, ...SHEETS[name], sheetPath: where.sheetPath, anchors };
  });

  const report = newReport();
  const items = collectItems(zip, plan, sharedStrings, limit, report);
  // The trace depends on the row's expectHollow (style resolution and the review rule), so each
  // media is traced once per distinct value its rows need, straight after decoding; the decoded
  // image (up to ~60 MB for GEX2's 15-megapixel pictures) is then dropped.
  const variants = new Map();
  for (const it of items) {
    for (const a of it.anchors) {
      if (!variants.has(a.mediaPath)) variants.set(a.mediaPath, new Set());
      variants.get(a.mediaPath).add(it.expectHollow);
    }
  }
  const total = items.reduce((n, it) => n + it.anchors.length, 0);

  const media = new Map(); // mediaPath -> { sha, imageFile, traces: Map<expectHollow, shape|null>, error, used }
  const mediaEntry = async (mediaPath) => {
    if (media.has(mediaPath)) return media.get(mediaPath);
    const entry = { sha: null, imageFile: null, traces: new Map(), error: null, used: 0 };
    media.set(mediaPath, entry);
    const ext = mediaPath.split('.').pop().toLowerCase();
    try {
      if (!IMAGE_EXTS.has(ext)) throw new Error(`unsupported picture type .${ext}`);
      const bytes = zip.read(mediaPath);
      const image = await decode(bytes);
      for (const expectHollow of variants.get(mediaPath)) entry.traces.set(expectHollow, shapeFromImage(image, { expectHollow }));
      entry.sha = sha256Of(bytes);
      entry.imageFile = `files/${profileImagePath(entry.sha, ext)}`;
      io.copyBytes(entry.imageFile, bytes);
      report.picturesDecoded++;
    } catch (e) {
      entry.error = `decode failed: ${e.message}`;
    }
    return entry;
  };

  const shapes = [];
  let done = 0;
  for (const { sheet, row, r, note, anchors, expectHollow } of items) {
    for (let i = 0; i < anchors.length; i++) {
      const sourceRef = `${sheet.name}!E${row}${i ? `#${i + 1}` : ''}`;
      const m = await mediaEntry(anchors[i].mediaPath);
      m.used++;
      done++;
      if (onProgress) onProgress({ done, total });
      if (m.error) { report.errors.push({ row: sourceRef, error: m.error }); continue; }
      const shape = m.traces.get(expectHollow);
      if (!shape) { report.needsReview.nullShape++; continue; }
      const geometry = { outer: shape.outer, holes: shape.holes };
      const signature = signatureOf(geometry);
      if (!signature.every(Number.isFinite)) { report.errors.push({ row: sourceRef, error: 'degenerate outline' }); continue; }
      const unit = toUnitFrame(geometry);
      const stats = shapeStats(geometry);

      if (shape.reviewReason === NEARLY_BLANK) report.needsReview.blankOrUnclear++;
      else if (shape.reviewReason) report.needsReview.verdictMismatch++;
      report.styles[shape.style]++;
      report.styleResolvedBy[shape.styleResolvedBy]++;
      const reasons = [note.reason, shape.reviewReason].filter(Boolean);
      shapes.push({
        die_no: r.dieNo,
        plant: sheet.plant,
        profile_number: r.profileNumber,
        source: 'image-check-xlsx',
        source_ref: sourceRef,
        image_sha: m.sha,
        image_file: m.imageFile,
        style: shape.style,
        outer_unit: roundPoly(unit.outer),
        holes_unit: unit.holes.map(roundPoly),
        signature,
        hole_count: shape.holeCount,
        die_type: r.dieType,
        aspect_ratio: finiteOrNull(stats.aspectRatio),
        solidity: finiteOrNull(stats.solidity),
        needs_review: note.needsReview || shape.needsReview,
        review_reason: reasons.length ? reasons.join('; ') : null,
      });
      report.shapesWritten++;
    }
  }
  report.picturesShared = [...media.values()].filter((m) => m.used > 1).length;

  io.writeJson('shapes.json', shapes);
  io.writeJson('report.json', report);
  // The manifest goes last: a bundle folder without one is an interrupted build.
  io.writeJson('manifest.json', {
    version: 1,
    kind: 'profile-shapes',
    createdAt: new Date().toISOString(),
    counts: {
      shapes: shapes.length,
      files: report.picturesDecoded,
      needsReview: shapes.filter((s) => s.needs_review).length,
      errors: report.errors.length,
    },
  });
  return { shapes, report };
}

// ---------------------------------------------------------------------------------------------
// Apply (server side) — Task 5
// ---------------------------------------------------------------------------------------------

module.exports = { buildProfileBundle };
