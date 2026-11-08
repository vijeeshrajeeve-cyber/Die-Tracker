'use strict';
// New-die-order forms: stamp the die-order template onto a new die's drawing, keep both PDFs under
// the tooling root, and record the form with the tooling chosen for it. Mounted behind
// authMiddleware + pageAccessMiddleware(['orders', 'backup-requests']); nginx's
// location /api/new-die-order-forms/ lets the 30 MB drawing through.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { pool } = require('../db.cjs');
const { generateBackupOrderPdf, VALUE_KEYS } = require('../services/dieOrderTemplate.cjs');
const toolingDrawings = require('../services/toolingDrawings.cjs');
const { normalizePlant } = require('../services/frozenDesigns.cjs');
const { formPaths, recordForm } = require('../services/newDieOrderForms.cjs');

const router = express.Router();

const PDF_MAX_BYTES = 30 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PDF_MAX_BYTES, files: 1 } });

const isPdf = (bytes) => Buffer.isBuffer(bytes) && bytes.subarray(0, 4).toString('latin1') === '%PDF';
const safeName = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, '_');

class BadRequest extends Error {}

// --- values -------------------------------------------------------------------------------------

const CHECKBOX_KEYS = new Set(['SOLID', 'HOLLOW', 'FINISH_MILL', 'FINISH_ANODIZING', 'FINISH_POWDER']);
const FORM_KEYS = new Set([...VALUE_KEYS, 'PLANT', 'DIE_NO', 'PROFILE_NO', 'CUSTOMER']);
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'x', 'on', 'checked']);

// The template's keys plus the form's identity; text capped at 200 characters, checkboxes as booleans.
function sanitizeValues(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!FORM_KEYS.has(key)) continue;
    if (CHECKBOX_KEYS.has(key)) out[key] = typeof value === 'boolean' ? value : TRUTHY.has(String(value ?? '').trim().toLowerCase());
    else out[key] = value == null ? '' : String(value).trim().slice(0, 200);
  }
  return out;
}

// --- finder -------------------------------------------------------------------------------------

const MAX_CANDIDATES = 50;
const MAX_POINTS = 4000;
const MAX_HOLES = 100;
const isPolygon = (poly) => Array.isArray(poly) && poly.length >= 3 && poly.length <= MAX_POINTS
  && poly.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
const isPolygonList = (list) => Array.isArray(list) && list.length <= MAX_HOLES && list.every(isPolygon);
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// The trace result, cut to the profile_shapes columns it fills (signature and stats are recomputed).
function sanitizeProfile(raw) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) throw new BadRequest('finder.profile must be an object');
  if (!isPolygon(raw.outer_unit)) throw new BadRequest('finder.profile.outer_unit must be a polygon');
  const holes = raw.holes_unit == null ? [] : raw.holes_unit;
  if (!isPolygonList(holes)) throw new BadRequest('finder.profile.holes_unit must be a list of polygons');
  const trueSize = raw.true_size === true;
  if (trueSize && (!isPolygon(raw.outer_mm) || !isPolygonList(raw.holes_mm == null ? [] : raw.holes_mm))) {
    throw new BadRequest('finder.profile.outer_mm must be a polygon when true_size is set');
  }
  return {
    style: textOrNull(raw.style),
    outer_unit: raw.outer_unit,
    holes_unit: holes,
    true_size: trueSize,
    outer_mm: trueSize ? raw.outer_mm : null,
    holes_mm: trueSize ? raw.holes_mm || [] : null,
    ccd_mm: trueSize && Number.isFinite(raw.ccd_mm) ? raw.ccd_mm : null,
    true_size_source: trueSize ? textOrNull(raw.true_size_source) : null,
    true_size_confidence: trueSize ? textOrNull(raw.true_size_confidence) : null,
    needs_review: raw.needs_review === true,
    review_reason: textOrNull(raw.review_reason),
  };
}

function sanitizeFinder(raw) {
  if (raw == null) return { chosen: null, candidates: null, profile: null };
  if (!isPlainObject(raw)) throw new BadRequest('finder must be an object');
  const c = raw.chosen;
  const tooling = isPlainObject(c) ? textOrNull(c.tooling) : null;
  const chosen = tooling ? {
    tooling: tooling.slice(0, 64),
    kind: c.kind === 'insert' || c.kind === 'bolster' ? c.kind : null,
    fromFinder: c.fromFinder === true,
  } : null;
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.slice(0, MAX_CANDIDATES).filter(isPlainObject).map(({ pockets, placements, ...rest }) => rest)
    : null;
  return { chosen, candidates, profile: sanitizeProfile(raw.profile) };
}

const parseJsonField = (text, name) => {
  if (text == null || text === '') return null;
  try { return JSON.parse(text); } catch { throw new BadRequest(`${name} must be JSON`); }
};

const positiveIntOrNull = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// --- routes -------------------------------------------------------------------------------------

// Multipart: `file` = the drawing PDF, `values` = JSON form values, `finder` = optional JSON
// { chosen, candidates, profile }. Answers the stamped PDF with X-Form-Id and X-Chosen-Tooling
// (URI-encoded; empty when none was chosen).
router.post('/generate', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Drawing PDF too large (max 30 MB)' : err.message });
  });
}, async (req, res) => {
  let values; let finder;
  try {
    values = sanitizeValues(parseJsonField(req.body && req.body.values, 'values'));
    finder = sanitizeFinder(parseJsonField(req.body && req.body.finder, 'finder'));
  } catch (err) {
    // Only BadRequest can come out of the two sanitizers.
    return res.status(400).json({ error: err.message });
  }
  const plant = normalizePlant(values.PLANT);
  const dieNo = values.DIE_NO || '';
  if (!plant || !dieNo) return res.status(400).json({ error: 'PLANT and DIE_NO are required' });
  if (!req.file || !isPdf(req.file.buffer)) return res.status(400).json({ error: 'Attach the drawing as a PDF' });

  let stamped;
  try {
    stamped = await generateBackupOrderPdf(req.file.buffer, values);
  } catch (err) {
    console.warn('new die order: stamping failed', err.message);
    return res.status(422).json({ error: 'The drawing PDF could not be stamped', detail: err.message });
  }

  const root = toolingDrawings.getRoot();
  const paths = formPaths({ plant, dieNo, stamp: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}` });
  const written = [];
  let client = null;
  try {
    const drawingAbs = toolingDrawings.absolutePath(root, paths.drawingPath);
    const formAbs = toolingDrawings.absolutePath(root, paths.formPdfPath);
    await fsp.mkdir(path.dirname(drawingAbs), { recursive: true });
    written.push(drawingAbs);
    await fsp.writeFile(drawingAbs, req.file.buffer);
    written.push(formAbs);
    await fsp.writeFile(formAbs, stamped);

    client = await pool.connect();
    const form = await recordForm(client, {
      user: req.user, plant, dieNo,
      profileNumber: values.PROFILE_NO || null, customer: values.CUSTOMER || null, press: values.PRESS || null,
      dieSize: values.DIE_SIZE || null, cavities: positiveIntOrNull(values.NO_OF_CAV), values,
      chosen: finder.chosen, candidates: finder.candidates, profile: finder.profile,
      drawingPath: paths.drawingPath, formPdfPath: paths.formPdfPath, drawingSha: toolingDrawings.sha256Of(req.file.buffer),
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName(dieNo)}-die-order.pdf"`,
      'X-Form-Id': String(form.id),
      'X-Chosen-Tooling': encodeURIComponent(finder.chosen ? finder.chosen.tooling : ''),
    });
    res.send(stamped);
  } catch (err) {
    await Promise.all(written.map((f) => fsp.rm(f, { force: true }).catch(() => {})));
    console.error('new die order form failed', err);
    res.status(500).json({ error: 'Failed to record the die order form' });
  } finally {
    if (client) client.release();
  }
});

const LIST_COLUMNS = `id, plant, die_no, profile_number, customer, press, die_size, cavities, chosen_tooling, chosen_kind,
  chosen_from_finder, profile_shape_id, drawing_path, form_pdf_path, generated_by, generated_at`;
const MAX_LIST = 200;

router.get('/', async (req, res) => {
  try {
    const dieNo = typeof req.query.dieNo === 'string' && req.query.dieNo.trim() ? req.query.dieNo.trim() : null;
    const plant = normalizePlant(req.query.plant) || null;
    const n = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIST) : 50;
    const columns = req.query.full === '1' ? `${LIST_COLUMNS}, form_values, candidates` : LIST_COLUMNS;
    const { rows } = await pool.query(
      `SELECT ${columns} FROM new_die_order_forms
        WHERE ($1::text IS NULL OR die_no = $1) AND ($2::text IS NULL OR plant = $2)
        ORDER BY generated_at DESC, id DESC LIMIT $3`,
      [dieNo, plant, limit],
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('new die order forms list failed', err);
    res.status(500).json({ error: 'Failed to load the die order forms' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  const unavailable = () => res.status(404).json({ error: 'Die order form not available' });
  try {
    if (!/^\d+$/.test(req.params.id)) return unavailable();
    const { rows } = await pool.query('SELECT die_no, form_pdf_path FROM new_die_order_forms WHERE id = $1', [Number(req.params.id)]);
    if (rows.length === 0 || !rows[0].form_pdf_path) return unavailable();
    let abs;
    try { abs = toolingDrawings.absolutePath(toolingDrawings.getRoot(), rows[0].form_pdf_path); } catch { return unavailable(); }
    res.download(abs, `${safeName(rows[0].die_no)}-die-order.pdf`, (err) => {
      if (err && !res.headersSent) unavailable();
    });
  } catch (err) {
    console.error('new die order form download failed', err);
    res.status(500).json({ error: 'Failed to load the die order form' });
  }
});

module.exports = router;
