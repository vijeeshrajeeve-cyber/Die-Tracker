'use strict';
// Write side of the tooling master: edit a tooling, add one, review its opening, attach a drawing (stored,
// extracted, opening upserted) and review a profile shape. Every function takes the database `client`; file IO
// is injected (`io`) so the tests use fakes. Errors meant for the caller carry an HTTP `status`.
const path = require('node:path');
const { storedRelativePath, absolutePath, formatOf, sha256Of } = require('./toolingDrawings.cjs');
const { parseToolingNumber, normalizeSizeClass, drawingHintsFromNumber } = require('./toolingNumbers.cjs');
const { pocketGapMm } = require('./openingGeometry.cjs');
const { normalizePlant } = require('./frozenDesigns.cjs');
// Called through the module objects so a test can spy on invalidate.
const toolingFinder = require('./toolingFinder.cjs');
const profileSimilarity = require('./profileSimilarity.cjs');

const httpError = (status, message) => Object.assign(new Error(message), { status });

const PLANTS = new Set(['GEX 1', 'GEX 2']);
const KINDS = new Set(['insert', 'bolster']);
const SIZE_CLASS = /^\d+(?:\.\d+)?X\d+(?:\.\d+)?$/;
const UPLOAD_FORMATS = new Set(['dxf', 'pdf']);

const isPolygon = (poly) => Array.isArray(poly) && poly.length >= 3
  && poly.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)));
const textOrNull = (v) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
};

function sizeClassOf(raw) {
  const s = normalizeSizeClass(raw);
  if (!s || !SIZE_CLASS.test(s)) throw httpError(400, 'sizeClass must look like 175X80 (diameter X thickness)');
  return s;
}

function cavitiesOf(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, 'cavities must be a positive integer');
  return n;
}

// The tooling_openings columns for an extraction result (dxfOpenings / pdfOpenings / openingResult shape). The one
// mapping both the bundle apply (toolingBundle.applyBundle) and a drawing upload write through.
function openingRowFromExtraction(x, { drawingId = null, drawingFile = null } = {}) {
  return {
    outer_outline: x.outer == null ? null : JSON.stringify(x.outer),
    pockets: x.pockets == null ? null : JSON.stringify(x.pockets),
    pocket_gap_mm: x.pocketGapMm ?? null,
    extraction_source: x.source ?? null,
    confidence: x.confidence ?? 'none',
    drawing_file: drawingFile,
    drawing_id: drawingId,
    extraction_note: (x.notes || []).join('; '),
    extraction_meta: x.meta == null ? null : JSON.stringify(x.meta),
  };
}

// Column order of the opening INSERTs (after tooling_id).
const OPENING_COLUMNS = ['outer_outline', 'pockets', 'pocket_gap_mm', 'extraction_source', 'confidence', 'drawing_file',
  'drawing_id', 'extraction_note', 'extraction_meta'];
const openingParams = (toolingId, row) => [toolingId, ...OPENING_COLUMNS.map((c) => row[c])];

// DXF text is decoded latin1 (drawing texts are single-byte); a PDF goes in as bytes. Required lazily: the PDF reader
// pulls in pdfjs.
async function extractForUpload({ buffer, format, hints = {} }) {
  if (format === 'dxf') return require('./dxfOpenings.cjs').extractFromDxf(buffer.toString('latin1'), hints);
  if (format === 'pdf') return require('./pdfOpenings.cjs').extractFromPdf(buffer, hints);
  throw httpError(400, 'Only .dxf and .pdf drawings can be uploaded');
}

const REVIEW_SET = 'reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, review_note = $3, updated_at = CURRENT_TIMESTAMP';

// confirm: the stored geometry is right. correct: replace the pockets (and the outer when given) by hand.
// none: the drawing shows no usable pocket. None of them writes the toolings row.
async function reviewOpening(client, toolingId, { action, pockets, outer, note, userId } = {}) {
  if (!['confirm', 'correct', 'none'].includes(action)) throw httpError(400, 'action must be confirm, correct or none');
  if (action === 'correct') {
    if (!Array.isArray(pockets) || pockets.length < 1 || !pockets.every(isPolygon)) {
      throw httpError(400, 'pockets must be at least one polygon of at least 3 [x, y] number pairs');
    }
    if (outer != null && !isPolygon(outer)) throw httpError(400, 'outer must be at least 3 [x, y] number pairs');
  }
  const found = await client.query('SELECT id, plant FROM toolings WHERE id = $1', [toolingId]);
  const tooling = found.rows[0];
  if (!tooling) throw httpError(404, 'Tooling not found');
  const reviewNote = textOrNull(note);

  let res;
  if (action === 'correct') {
    res = await client.query(
      `INSERT INTO tooling_openings (tooling_id, outer_outline, pockets, pocket_gap_mm, extraction_source, confidence, reviewed_by, reviewed_at, review_note)
       VALUES ($1, $2, $3, $4, 'manual', 'confirmed', $5, CURRENT_TIMESTAMP, $6)
       ON CONFLICT (tooling_id) DO UPDATE SET
         outer_outline = COALESCE(EXCLUDED.outer_outline, tooling_openings.outer_outline),
         pockets = EXCLUDED.pockets, pocket_gap_mm = EXCLUDED.pocket_gap_mm,
         extraction_source = EXCLUDED.extraction_source, confidence = EXCLUDED.confidence,
         reviewed_by = EXCLUDED.reviewed_by, reviewed_at = CURRENT_TIMESTAMP, review_note = EXCLUDED.review_note,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [toolingId, outer == null ? null : JSON.stringify(outer), JSON.stringify(pockets),
        pocketGapMm(pockets.map((points) => ({ points }))), userId ?? null, reviewNote]);
  } else {
    const confirm = action === 'confirm';
    const set = confirm
      ? "confidence = 'confirmed'"
      : "pockets = NULL, pocket_gap_mm = NULL, confidence = 'none'";
    // An opening with no pockets is "not known": confirming it would claim a geometry nobody has.
    // jsonb_typeof is NULL for SQL NULL, so this also refuses a NULL or JSON-null pockets.
    const guard = confirm ? " AND jsonb_typeof(pockets) = 'array' AND pockets <> '[]'::jsonb" : '';
    res = await client.query(
      `UPDATE tooling_openings SET ${set}, ${REVIEW_SET} WHERE tooling_id = $1${guard} RETURNING *`,
      [toolingId, userId ?? null, reviewNote]);
    if (!res.rows[0]) {
      if (confirm) {
        const exists = await client.query('SELECT 1 FROM tooling_openings WHERE tooling_id = $1', [toolingId]);
        if (exists.rows.length) throw httpError(409, 'No pockets to confirm — correct the pockets or mark the opening not known');
      }
      throw httpError(404, 'No opening to review');
    }
  }
  toolingFinder.invalidate(tooling.plant);
  return res.rows[0];
}

const UPDATABLE = ['location', 'status', 'sizeClass', 'cavities', 'notes'];

// Edit the fields a reviewer may change. `userId` rides along for the caller; the master has no editor column.
async function updateTooling(client, number, patch = {}) {
  const unknown = Object.keys(patch).filter((k) => k !== 'userId' && !UPDATABLE.includes(k));
  if (unknown.length) throw httpError(400, `Unknown fields: ${unknown.join(', ')}`);
  const sets = [];
  const params = [number];
  const set = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);

  if (has('location')) set('location = ?', textOrNull(patch.location));
  if (has('status')) {
    if (!['active', 'retired'].includes(patch.status)) throw httpError(400, 'status must be active or retired');
    set('status = ?', patch.status);
  }
  if (has('sizeClass')) {
    // Clearing the size class clears its provenance too: a null size is not a confirmed manual entry.
    if (patch.sizeClass == null || String(patch.sizeClass).trim() === '') {
      sets.push('size_class = NULL, size_class_source = NULL, size_class_confidence = NULL');
    } else {
      set("size_class = ?, size_class_source = 'manual', size_class_confidence = 'confirmed'", sizeClassOf(patch.sizeClass));
    }
  }
  if (has('cavities')) set('cavities = ?', cavitiesOf(patch.cavities));
  if (has('notes')) set('notes = ?', textOrNull(patch.notes));
  if (!sets.length) throw httpError(400, 'Nothing to update');

  const res = await client.query(
    `UPDATE toolings SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE number = $1 RETURNING *`, params);
  if (!res.rows[0]) throw httpError(404, 'Tooling not found');
  toolingFinder.invalidate(res.rows[0].plant);
  return res.rows[0];
}

// Add a tooling by hand. The number must parse to a canonical insert or bolster number.
async function createTooling(client, { number, kind, plant, sizeClass, cavities, location, notes } = {}) {
  const parsed = parseToolingNumber(number);
  if (!parsed.canonical || !KINDS.has(parsed.kind)) throw httpError(400, 'number is not a recognised insert or bolster number');
  if (kind != null && !KINDS.has(kind)) throw httpError(400, 'kind must be insert or bolster');
  // The number decides the kind (the parse above is never ambiguous); a given kind may only agree with it.
  if (kind != null && kind !== parsed.kind) {
    throw httpError(400, `kind ${kind} contradicts the number, which parses as ${parsed.kind}`);
  }
  const plantName = normalizePlant(plant || parsed.plant);
  if (!PLANTS.has(plantName)) throw httpError(400, 'plant must be GEX 1 or GEX 2');
  const size = sizeClass == null || sizeClass === '' ? null : sizeClassOf(sizeClass);
  const cav = cavities == null || cavities === '' ? parsed.cavities : cavitiesOf(cavities);

  const res = await client.query(
    `INSERT INTO toolings (number, kind, plant, size_class, size_class_source, size_class_confidence, cavities, location, made_for_die, notes, source, status, held_presses)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', 'active', '{}')
     ON CONFLICT (number) DO NOTHING RETURNING *`,
    [parsed.canonical, kind || parsed.kind, plantName, size, size ? 'manual' : null, size ? 'confirmed' : null,
      cav ?? null, textOrNull(location), parsed.madeForDie ?? null, textOrNull(notes)]);
  if (!res.rows[0]) throw httpError(409, `Tooling ${parsed.canonical} already exists`);
  toolingFinder.invalidate(plantName);
  return res.rows[0];
}

// Store an uploaded drawing, link it to the tooling and write the opening it yields. A confirmed or reviewed opening
// is never replaced (openingKept: true). io = { exists(abs), mkdirp(dir), writeFile(abs, buffer) }.
async function attachDrawing(client, tooling, { buffer, originalName, root, io }) {
  const format = formatOf(originalName);
  if (!UPLOAD_FORMATS.has(format)) throw httpError(400, 'Only .dxf and .pdf drawings can be uploaded');
  const sha256 = sha256Of(buffer);
  const filePath = storedRelativePath({ number: tooling.number, sha256, originalName });
  const abs = absolutePath(root, filePath);

  // A file the reader cannot parse is the uploader's to fix: nothing is stored.
  let extraction;
  try {
    const fromNumber = drawingHintsFromNumber(tooling.number);
    extraction = await extractForUpload({
      buffer, format,
      hints: {
        sizeClass: tooling.size_class ?? null, cavities: tooling.cavities ?? null,
        steppedPockets: fromNumber.steppedPockets,
      },
    });
  } catch (err) {
    throw httpError(422, `Could not read the drawing: ${err.message}`);
  }

  if (!io.exists(abs)) {
    io.mkdirp(path.dirname(abs));
    io.writeFile(abs, buffer);
  }

  await client.query('BEGIN');
  try {
    // The same file twice is one drawing row; the first drawing of a tooling becomes its primary.
    const inserted = await client.query(
      `INSERT INTO tooling_drawings (tooling_id, file_path, original_name, format, match_basis, sha256, byte_size, is_primary)
       VALUES ($1, $2, $3, $4, 'manual', $5, $6,
               NOT EXISTS (SELECT 1 FROM tooling_drawings p WHERE p.tooling_id = $1 AND p.is_primary))
       ON CONFLICT (tooling_id, sha256) DO UPDATE SET original_name = tooling_drawings.original_name
       RETURNING *`,
      [tooling.id, filePath, originalName, format, sha256, buffer.length]);
    const drawing = inserted.rows[0];

    const row = openingRowFromExtraction(extraction, { drawingId: drawing.id, drawingFile: drawing.file_path });
    const written = await client.query(
      `INSERT INTO tooling_openings (tooling_id, ${OPENING_COLUMNS.join(', ')})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tooling_id) DO UPDATE SET
         outer_outline = EXCLUDED.outer_outline, pockets = EXCLUDED.pockets, pocket_gap_mm = EXCLUDED.pocket_gap_mm,
         extraction_source = EXCLUDED.extraction_source, confidence = EXCLUDED.confidence,
         drawing_file = EXCLUDED.drawing_file, drawing_id = EXCLUDED.drawing_id,
         extraction_note = EXCLUDED.extraction_note, extraction_meta = EXCLUDED.extraction_meta,
         updated_at = CURRENT_TIMESTAMP
       WHERE tooling_openings.reviewed_at IS NULL AND tooling_openings.confidence <> 'confirmed'
       RETURNING *`,
      openingParams(tooling.id, row));
    const openingKept = !written.rows[0];
    const opening = openingKept
      ? (await client.query('SELECT * FROM tooling_openings WHERE tooling_id = $1', [tooling.id])).rows[0] || null
      : written.rows[0];
    await client.query('COMMIT');
    toolingFinder.invalidate(tooling.plant);
    return { drawing, opening, openingKept, extraction: { confidence: extraction.confidence, notes: extraction.notes || [] } };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the original error matters more */ }
    throw err;
  }
}

// clear: the shape is fine, it joins the similarity index; keep: it stays out, flagged.
async function reviewProfileShape(client, id, { action, note, userId } = {}) {
  if (!['clear', 'keep'].includes(action)) throw httpError(400, 'action must be clear or keep');
  const res = await client.query(
    `UPDATE profile_shapes SET needs_review = $2,
       review_reason = CASE WHEN $4::text IS NULL THEN review_reason ELSE concat_ws('; ', review_reason, 'reviewer: ' || $4) END,
       reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [id, action === 'keep', userId ?? null, textOrNull(note)]);
  if (!res.rows[0]) throw httpError(404, 'Profile shape not found');
  profileSimilarity.invalidate(res.rows[0].plant);
  return res.rows[0];
}

module.exports = {
  openingRowFromExtraction, openingParams, OPENING_COLUMNS, extractForUpload, reviewOpening, updateTooling, createTooling,
  attachDrawing, reviewProfileShape,
};
