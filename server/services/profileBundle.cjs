'use strict';
// Profile shape bundle. The build half runs on the PC: it reads the image-check workbook, traces
// every picture into a shape and writes a bundle folder (manifest.json, shapes.json, report.json,
// files/profiles/…). The apply half (server side, Task 5) loads that bundle into profile_shapes.
const nodePath = require('node:path');
const { sha256Of, profileImagePath, absolutePath } = require('./toolingDrawings.cjs');
const { decodeImage, shapeFromImage } = require('./profileRaster.cjs');
const { toUnitFrame, signatureOf, shapeStats, minEnclosingCircle } = require('./profileShape.cjs');
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

const MIN_CCD_MM = 20; // below this the die list's ProfileCCD is a placeholder, not a diameter

// Stored spellings of each plant in existing_die_details.plant.
const PLANT_SPELLINGS = { 'GEX 1': ['GEX 1', 'GEX 01'], 'GEX 2': ['GEX 2'] };

const SELECT_DIE_LIST = `SELECT cavity, die_type, profile_number, raw_data->>'ProfileCCD' AS ccd
  FROM existing_die_details WHERE die_no = $1 AND plant = ANY($2)`;
const SELECT_EXISTING = `SELECT signature, true_size, ccd_mm, needs_review, review_reason, image_path
  FROM profile_shapes WHERE die_no = $1 AND plant = $2 AND source = $3 AND source_ref = $4`;
const UPSERT_SHAPE = `INSERT INTO profile_shapes
    (die_no, plant, profile_number, source, source_ref, image_sha, image_path, style, outer_unit, holes_unit, signature,
     hole_count, cavities, die_type, aspect_ratio, solidity, true_size, outer_mm, holes_mm, ccd_mm,
     true_size_source, true_size_confidence, needs_review, review_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
  ON CONFLICT (die_no, plant, source, source_ref) DO UPDATE SET
    profile_number = EXCLUDED.profile_number, image_sha = EXCLUDED.image_sha, image_path = EXCLUDED.image_path,
    style = EXCLUDED.style, outer_unit = EXCLUDED.outer_unit, holes_unit = EXCLUDED.holes_unit,
    signature = EXCLUDED.signature, hole_count = EXCLUDED.hole_count, cavities = EXCLUDED.cavities,
    die_type = EXCLUDED.die_type, aspect_ratio = EXCLUDED.aspect_ratio, solidity = EXCLUDED.solidity,
    true_size = EXCLUDED.true_size, outer_mm = EXCLUDED.outer_mm, holes_mm = EXCLUDED.holes_mm, ccd_mm = EXCLUDED.ccd_mm,
    true_size_source = EXCLUDED.true_size_source, true_size_confidence = EXCLUDED.true_size_confidence,
    needs_review = EXCLUDED.needs_review, review_reason = EXCLUDED.review_reason, updated_at = CURRENT_TIMESTAMP
  WHERE profile_shapes.reviewed_at IS NULL
  RETURNING (xmax = 0) AS inserted`;

// readProfileBundle(dir, fsLike) reads and validates a bundle folder written by buildProfileBundle.
function readProfileBundle(dir, fsLike = require('node:fs')) {
  const read = (name, optional = false) => {
    try { return JSON.parse(fsLike.readFileSync(nodePath.join(dir, name), 'utf8')); } catch (err) {
      if (optional && err && err.code === 'ENOENT') return null;
      throw new Error(`Cannot read ${name} from the bundle: ${err.message}`);
    }
  };
  const manifest = read('manifest.json');
  if (!manifest || manifest.version !== 1 || manifest.kind !== 'profile-shapes') {
    throw new Error(`Not a profile-shapes bundle of version 1 (version ${manifest && manifest.version}, kind ${manifest && manifest.kind})`);
  }
  const shapes = read('shapes.json');
  if (!Array.isArray(shapes)) throw new Error('shapes.json must be an array');
  return { dir, manifest, shapes, report: read('report.json', true) };
}

// Scales the unit-frame outline so the smallest circle around it measures `ccdMm` across.
function trueSizeFromCcd({ outer_unit: outerUnit, holes_unit: holesUnit = [] }, ccdMm) {
  const scale = ccdMm / (2 * minEnclosingCircle(outerUnit).r);
  const mm = (poly) => poly.map(([x, y]) => [x * scale, y * scale]);
  return { outer_mm: mm(outerUnit), holes_mm: holesUnit.map(mm), ccd_mm: ccdMm, source: 'ccd-scaled', confidence: 'likely' };
}

const sameCcd = (a, b) => (a == null || b == null ? (a == null) === (b == null) : Math.abs(Number(a) - Number(b)) < 1e-9);
const jsonOrNull = (v) => (v == null ? null : JSON.stringify(v));

// Writes a profile bundle into profile_shapes in one transaction. A row a person has reviewed is never
// rewritten; a picture is copied only when it is not already stored. All file IO is injected.
async function applyProfileBundle(client, bundle, { root, io, dryRun = false, log = () => {} }) {
  const counts = { inserted: 0, updated: 0, unchanged: 0, skippedReviewed: 0, filesCopied: 0, trueSized: 0, dieListMisses: 0 };
  await client.query('BEGIN');
  try {
    const toCopy = new Map(); // imagePath -> source file
    for (const s of bundle.shapes) {
      const spellings = PLANT_SPELLINGS[s.plant] || [s.plant];
      const dieRow = (await client.query(SELECT_DIE_LIST, [s.die_no, spellings])).rows[0];
      if (!dieRow) counts.dieListMisses++;
      const cavity = dieRow && dieRow.cavity != null && Number.isFinite(Number(dieRow.cavity)) ? Number(dieRow.cavity) : null;
      const ccd = dieRow && dieRow.ccd != null && dieRow.ccd !== '' ? Number(dieRow.ccd) : NaN;
      const sized = Number.isFinite(ccd) && ccd >= MIN_CCD_MM ? trueSizeFromCcd(s, ccd) : null;
      const imagePath = s.image_file ? s.image_file.replace(/^files\//, '') : null;
      const incoming = {
        signature: s.signature, true_size: sized != null, ccd_mm: sized ? sized.ccd_mm : null,
        needs_review: !!s.needs_review, review_reason: s.review_reason ?? null, image_path: imagePath,
      };
      const old = (await client.query(SELECT_EXISTING, [s.die_no, s.plant, s.source, s.source_ref])).rows[0];
      const same = old
        && JSON.stringify(old.signature) === JSON.stringify(incoming.signature)
        && old.true_size === incoming.true_size && sameCcd(old.ccd_mm, incoming.ccd_mm)
        && old.needs_review === incoming.needs_review && (old.review_reason ?? null) === incoming.review_reason
        && (old.image_path ?? null) === incoming.image_path;
      if (same) {
        counts.unchanged++;
      } else {
        const res = await client.query(UPSERT_SHAPE, [
          s.die_no, s.plant, s.profile_number ?? null, s.source, s.source_ref, s.image_sha ?? null, imagePath, s.style ?? null,
          jsonOrNull(s.outer_unit), jsonOrNull(s.holes_unit || []), jsonOrNull(s.signature), s.hole_count, cavity,
          s.die_type || (dieRow && dieRow.die_type) || null, s.aspect_ratio ?? null, s.solidity ?? null,
          incoming.true_size, jsonOrNull(sized && sized.outer_mm), jsonOrNull(sized && sized.holes_mm), incoming.ccd_mm,
          sized ? sized.source : null, sized ? sized.confidence : null, incoming.needs_review, incoming.review_reason,
        ]);
        if (res.rowCount === 0) { counts.skippedReviewed++; continue; }
        if (res.rows[0] && res.rows[0].inserted) counts.inserted++; else counts.updated++;
      }
      if (sized) counts.trueSized++;
      if (imagePath && !toCopy.has(imagePath)) toCopy.set(imagePath, `${bundle.dir}/files/${imagePath}`.replace(/\\/g, '/'));
    }

    for (const [imagePath, src] of toCopy) {
      const dest = absolutePath(root, imagePath);
      if (io.exists(dest)) continue;
      if (dryRun) { log(`would copy ${imagePath}`); continue; }
      io.mkdirp(nodePath.dirname(dest));
      io.copyFile(src, dest);
      counts.filesCopied++;
    }
    log(dryRun ? 'dry run: rolling back' : 'committing');
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return counts;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { log(`rollback failed: ${rollbackErr.message}`); }
    throw err;
  }
}

module.exports = { buildProfileBundle, readProfileBundle, trueSizeFromCcd, applyProfileBundle };
