'use strict';
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const { pool } = require('../db.cjs');
const { reviewerMiddleware } = require('./auth.cjs');
const { loadPresses, normalizePlant } = require('../services/frozenDesigns.cjs');
const { resolvePress } = require('../services/dieListImport.cjs');
const { normalizeSizeClass } = require('../services/toolingNumbers.cjs');
const drawingStore = require('../services/toolingDrawings.cjs');
const { findToolings, MIN_CLEARANCE_MM } = require('../services/toolingFinder.cjs');
const toolingReview = require('../services/toolingReview.cjs');

const router = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Canonical press name: "PRESS 6", "P6" and "6" all become "PRESS 6". The
// presses master resolves press codes; a bare name or number is normalised
// directly when the master has nothing for it.
async function normalizePress(raw) {
  const token = text(raw);
  if (!token) return '';
  const resolved = String(resolvePress(token, await loadPresses(pool)) || token).trim().toUpperCase();
  const m = resolved.match(/^(?:PRESS\s*|P)?(\d+)$/);
  return m ? `PRESS ${Number(m[1])}` : resolved;
}

const sortedDistinct = (rows, field) =>
  [...new Set(rows.map((r) => r[field]).filter((v) => v != null && v !== ''))].sort();

router.get('/', async (req, res) => {
  try {
    const where = [];
    const params = [];
    const add = (clause, value) => {
      params.push(value);
      where.push(clause.replace('?', `$${params.length}`));
    };

    // status=all lists every status; no status means active.
    const status = text(req.query.status) || 'active';
    if (status !== 'all') add('t.status = ?', status);
    if (text(req.query.plant)) add('t.plant = ?', normalizePlant(req.query.plant));
    if (text(req.query.kind)) add('t.kind = ?', text(req.query.kind));
    if (text(req.query.sizeClass)) {
      add('t.size_class = ?', normalizeSizeClass(req.query.sizeClass) || text(req.query.sizeClass));
    }
    if (text(req.query.press)) add('t.held_presses @> ARRAY[?]::text[]', await normalizePress(req.query.press));
    if (text(req.query.q)) {
      add("t.number ILIKE ? ESCAPE '\\'", `%${text(req.query.q).replace(/[\\%_]/g, '\\$&')}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // count(1), not count(*): keeps the correlated subquery distinct from the
    // total query below.
    const list = await pool.query(
      `SELECT t.*, COALESCE(o.confidence, 'none') AS opening_confidence,
              (SELECT count(DISTINCT l.die_no) FROM die_tooling_links l WHERE l.tooling_number = t.number)::int AS linked_dies
         FROM toolings t
         LEFT JOIN tooling_openings o ON o.tooling_id = t.id
         ${whereSql}
        ORDER BY t.number
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const count = await pool.query(`SELECT count(*) FROM toolings t ${whereSql}`, params);
    res.json({ items: list.rows, total: Number(count.rows[0].count) });
  } catch (err) {
    console.error('toolings list failed', err);
    res.status(500).json({ error: 'Failed to list toolings' });
  }
});

// Registered before '/:number' so "combinations" is not read as a tooling number.
router.get('/combinations', async (req, res) => {
  try {
    const press = await normalizePress(req.query.press);
    const dieSize = normalizeSizeClass(req.query.dieSize);
    if (!press || !dieSize) return res.status(400).json({ error: 'press and dieSize are required' });

    const { rows } = await pool.query(
      'SELECT * FROM tooling_combinations tc WHERE tc.press = $1 AND tc.die_size = $2 ORDER BY tc.insert_size, tc.bolster_size',
      [press, dieSize],
    );
    let verdictBasis = 'chart';
    if (rows.length === 0) {
      const any = await pool.query('SELECT 1 FROM tooling_combinations tc WHERE tc.press = $1 LIMIT 1', [press]);
      if (any.rows.length === 0) verdictBasis = 'no_chart';
    }
    res.json({
      press,
      dieSize,
      rows,
      insertSizes: sortedDistinct(rows, 'insert_size'),
      bolsterSizes: sortedDistinct(rows, 'bolster_size'),
      verdictBasis,
    });
  } catch (err) {
    console.error('toolings combinations failed', err);
    res.status(500).json({ error: 'Failed to load combinations' });
  }
});

// The die sizes the tooling chart lists for a press, smallest first. Registered before '/:number'.
router.get('/die-sizes', async (req, res) => {
  try {
    const press = await normalizePress(req.query.press);
    if (!press) return res.status(400).json({ error: 'press is required' });
    const { rows } = await pool.query(
      'SELECT DISTINCT tc.die_size FROM tooling_combinations tc WHERE tc.press = $1',
      [press],
    );
    const dims = (size) => String(size).split('X').map(Number);
    const dieSizes = sortedDistinct(rows, 'die_size').sort((a, b) => {
      const [da, ta] = dims(a); const [db, tb] = dims(b);
      return (da - db) || (ta - tb) || String(a).localeCompare(String(b));
    });
    res.json({ press, dieSizes });
  } catch (err) {
    console.error('toolings die sizes failed', err);
    res.status(500).json({ error: 'Failed to load die sizes' });
  }
});

// '_' and '-' match as the same separator (the GEX 1 die list writes 13794_525, requests 13794-525).
// Registered before '/:number'. The toolings a die is recorded with (die list, order PDF, new-order form), each with
// its master row when the master has the number.
router.get('/for-die/:dieNo', async (req, res) => {
  try {
    const plant = text(req.query.plant) ? normalizePlant(req.query.plant) : null;
    const { rows } = await pool.query(
      `SELECT l.tooling_number, l.kind, l.source, l.seen_at,
              t.number AS t_number, t.kind AS t_kind, t.size_class, t.status, t.location,
              CASE WHEN t.id IS NULL THEN NULL ELSE COALESCE(o.confidence, 'none') END AS opening_confidence
         FROM die_tooling_links l
         LEFT JOIN toolings t ON t.number = l.tooling_number
         LEFT JOIN tooling_openings o ON o.tooling_id = t.id
        WHERE translate(l.die_no, '_', '-') = translate($1, '_', '-') AND ($2::text IS NULL OR l.plant = $2)
        ORDER BY l.tooling_number NULLS LAST, l.id`,
      [req.params.dieNo, plant],
    );
    res.json({
      links: rows.map((r) => ({
        tooling_number: r.tooling_number,
        kind: r.kind,
        source: r.source,
        seen_at: r.seen_at,
        tooling: r.t_number == null ? null : {
          number: r.t_number, kind: r.t_kind, size_class: r.size_class, status: r.status, location: r.location,
          opening_confidence: r.opening_confidence,
        },
      })),
    });
  } catch (err) {
    console.error('toolings for die failed', err);
    res.status(500).json({ error: 'Failed to load the toolings for this die' });
  }
});

// Registered before '/:number' so "review-queue" is not read as a tooling number.
// A tooling lands here for the first reason that applies, in this order.
const REASON_SQL = `CASE
           WHEN t.status = 'unverified' THEN 'unverified'
           WHEN o.id IS NULL THEN 'no-opening'
           WHEN o.confidence = 'none' THEN 'no-pockets'
           WHEN o.confidence = 'uncertain' THEN 'uncertain'
           WHEN t.size_class IS NULL THEN 'no-size-class'
           ELSE NULL
         END`;
const REASON_PRIORITY_SQL = `CASE
           WHEN t.status = 'unverified' THEN 1
           WHEN o.id IS NULL THEN 2
           WHEN o.confidence = 'none' THEN 3
           WHEN o.confidence = 'uncertain' THEN 4
           ELSE 5
         END`;

router.get('/review-queue', async (req, res) => {
  try {
    const where = [`t.status IN ('active', 'unverified')`, `(${REASON_SQL}) IS NOT NULL`];
    const params = [];
    const add = (clause, value) => {
      params.push(value);
      where.push(clause.replace('?', `$${params.length}`));
    };
    if (text(req.query.plant)) add('t.plant = ?', normalizePlant(req.query.plant));
    if (text(req.query.kind)) add('t.kind = ?', text(req.query.kind));

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const list = await pool.query(
      `SELECT t.number, t.kind, t.plant, t.size_class, t.status,
              COALESCE(o.confidence, 'none') AS opening_confidence,
              o.extraction_source,
              (SELECT count(*) FROM tooling_drawings d WHERE d.tooling_id = t.id)::int AS drawing_count,
              ${REASON_SQL} AS reason
         FROM toolings t
         LEFT JOIN tooling_openings o ON o.tooling_id = t.id
         ${whereSql}
        ORDER BY ${REASON_PRIORITY_SQL}, t.number
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const count = await pool.query(
      `SELECT count(*) FROM toolings t LEFT JOIN tooling_openings o ON o.tooling_id = t.id ${whereSql}`,
      params,
    );
    res.json({ items: list.rows, total: Number(count.rows[0].count) });
  } catch (err) {
    console.error('toolings review queue failed', err);
    res.status(500).json({ error: 'Failed to load the review queue' });
  }
});

// ---- POST /find: which toolings can take a profile ---------------------------
// Registered before '/:number' like the routes above.
const FIND_DEFAULT_LIMIT = 20;
const FIND_MAX_LIMIT = 50;
const FIND_SIMILAR_LIMIT = 20;
// Fit cost grows with the point count (10,000 points: about 41 ms per pocket),
// so a posted polygon is capped well above any drawn or extracted profile.
const MAX_PROFILE_POINTS = 5000;
const MAX_MIN_CLEARANCE_MM = 10;

const str = (v) => (v == null ? '' : String(v).trim());
const isPolygon = (poly) => Array.isArray(poly) && poly.length >= 3
  && poly.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)));
const positiveInt = (v) => {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n > 0 ? n : null;
};

router.post('/find', async (req, res) => {
  const body = req.body || {};
  const bad = (error) => res.status(400).json({ error });
  for (const field of ['plant', 'press', 'dieSize']) {
    if (!str(body[field])) return bad(`${field} is required`);
  }
  const cavities = positiveInt(body.cavities);
  if (cavities == null) return bad('cavities must be a positive integer');
  let profile = null;
  if (body.profile != null) {
    const { outer, holes } = body.profile;
    const tooMany = (poly) => Array.isArray(poly) && poly.length > MAX_PROFILE_POINTS;
    if (tooMany(outer) || (Array.isArray(holes) && holes.some(tooMany))) {
      return bad(`profile has too many points (max ${MAX_PROFILE_POINTS})`);
    }
    if (!isPolygon(outer)) return bad('profile.outer must be at least 3 [x, y] number pairs');
    if (holes != null && !(Array.isArray(holes) && holes.every(isPolygon))) {
      return bad('profile.holes must be polygons of at least 3 [x, y] number pairs');
    }
    profile = { outer, holes: holes || [] };
  }
  const dieNo = str(body.dieNo);
  if (!profile && !dieNo) return bad('profile or dieNo is required');
  const dieSize = normalizeSizeClass(body.dieSize);
  if (!dieSize) return bad('dieSize is required');
  let minClearance = MIN_CLEARANCE_MM;
  if (body.minClearance != null) {
    const v = typeof body.minClearance === 'string' && body.minClearance.trim() !== '' ? Number(body.minClearance) : body.minClearance;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_MIN_CLEARANCE_MM) {
      return bad(`minClearance must be a number from 0 to ${MAX_MIN_CLEARANCE_MM}`);
    }
    minClearance = v;
  }
  const parsedLimit = parseInt(body.limit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), FIND_MAX_LIMIT)
    : FIND_DEFAULT_LIMIT;

  try {
    const result = await findToolings(pool, {
      plant: normalizePlant(body.plant),
      press: await normalizePress(str(body.press)),
      dieSize,
      cavities,
      profile,
      // With a polygon posted, dieNo only keeps that die out of its own similar list.
      dieNo: dieNo || null,
      minClearance,
      limit,
      similarLimit: FIND_SIMILAR_LIMIT,
    });
    res.json(result);
  } catch (err) {
    if (err && err.code === 'NO_PROFILE') return res.status(404).json({ error: `no true-size profile for die ${dieNo}` });
    if (err && err.code === 'BAD_PRESS') return res.status(400).json({ error: 'press is not recognised' });
    console.error('tooling finder failed', err);
    res.status(500).json({ error: 'Finder failed' });
  }
});

// The detail payload: the tooling, its opening, its drawings and the dies linked to it; null when unknown.
async function loadDetail(number) {
  const found = await pool.query(
    `SELECT t.*, COALESCE(o.confidence, 'none') AS opening_confidence
       FROM toolings t
       LEFT JOIN tooling_openings o ON o.tooling_id = t.id
      WHERE t.number = $1`,
    [number],
  );
  if (found.rows.length === 0) return null;
  const tooling = found.rows[0];

  const opening = await pool.query('SELECT * FROM tooling_openings o WHERE o.tooling_id = $1', [tooling.id]);
  // Stored paths stay on the server; the client downloads through the file route.
  const drawings = await pool.query(
    `SELECT id, original_name, format, match_basis, is_primary, byte_size, created_at
       FROM tooling_drawings WHERE tooling_id = $1 ORDER BY is_primary DESC, original_name`,
    [tooling.id],
  );
  // One die row per link: prefer the die of the same plant when die_no repeats across plants.
  const links = await pool.query(
    `SELECT l.die_no, l.plant, l.source, l.seen_at,
            d.die_size, d.press, d.cavity, d.die_status, (d.die_no IS NOT NULL) AS die_found
       FROM die_tooling_links l
       LEFT JOIN LATERAL (
            SELECT e.die_no, e.die_size, e.press, e.cavity, e.die_status
              FROM existing_die_details e
             WHERE e.die_no = l.die_no
             ORDER BY (regexp_replace(upper(trim(e.plant)), '\\m0+(\\d+)', '\\1', 'g') IS NOT DISTINCT FROM l.plant) DESC
             LIMIT 1
       ) d ON true
      WHERE l.tooling_number = $1
      ORDER BY l.die_no, l.id`,
    [tooling.number],
  );
  return {
    tooling,
    opening: opening.rows[0] || null,
    drawings: drawings.rows,
    links: links.rows.map(({ die_size, press, cavity, die_status, die_found, ...link }) => ({
      ...link,
      die: die_found === false ? null : { die_size, press, cavity, die_status },
    })),
  };
}

router.get('/:number', async (req, res) => {
  try {
    const detail = await loadDetail(req.params.number);
    if (!detail) return res.status(404).json({ error: 'Tooling not found' });
    res.json(detail);
  } catch (err) {
    console.error('tooling detail failed', err);
    res.status(500).json({ error: 'Failed to load tooling' });
  }
});

router.get('/:number/drawings/:id/file', async (req, res) => {
  const unavailable = () => res.status(404).json({ error: 'Drawing file not available' });
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Drawing not found' });
    const found = await pool.query(
      `SELECT d.file_path, d.original_name
         FROM tooling_drawings d
         JOIN toolings t ON t.id = d.tooling_id
        WHERE d.id = $1 AND t.number = $2`,
      [Number(req.params.id), req.params.number],
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'Drawing not found' });
    const row = found.rows[0];
    let abs;
    try {
      abs = drawingStore.absolutePath(drawingStore.getRoot(), row.file_path);
    } catch {
      return unavailable();
    }
    res.download(abs, row.original_name, (err) => {
      if (err && !res.headersSent) unavailable();
    });
  } catch (err) {
    console.error('tooling drawing download failed', err);
    res.status(500).json({ error: 'Failed to load the drawing' });
  }
});

// ---- write side: reviewers only (admins, or users with can_review_toolings) --------------------------
// A service error carries its HTTP status; anything else is a 500.
function fail(res, err, what) {
  if (err && err.status) return res.status(err.status).json({ error: err.message });
  console.error(`tooling: ${what} failed`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}

const MAX_DRAWING_BYTES = 50 * 1024 * 1024; // nginx allows 60m on /api/toolings/
// Memory storage: the bytes are needed whole anyway (sha-256 name, extraction), and 50 MB bounds them.
const drawingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DRAWING_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (['dxf', 'pdf'].includes(drawingStore.formatOf(file.originalname))) return cb(null, true);
    cb(new Error('Only .dxf and .pdf drawings can be uploaded'));
  },
});
// Multer rejections (type, size) are client mistakes: 400 with a message the UI can show.
const acceptDrawing = (req, res, next) => {
  drawingUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${MAX_DRAWING_BYTES / 1024 / 1024} MB)` : err.message;
    return res.status(400).json({ error: message });
  });
};
const diskIo = {
  exists: (p) => fs.existsSync(p),
  mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
  writeFile: (p, buffer) => fs.writeFileSync(p, buffer),
};

router.post('/', reviewerMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    const tooling = await toolingReview.createTooling(pool, {
      number: b.number, kind: b.kind, plant: b.plant, sizeClass: b.sizeClass, cavities: b.cavities,
      location: b.location, notes: b.notes, userId: req.user.id,
    });
    res.status(201).json({ tooling });
  } catch (err) {
    fail(res, err, 'add the tooling');
  }
});

router.patch('/:number', reviewerMiddleware, async (req, res) => {
  try {
    const tooling = await toolingReview.updateTooling(pool, req.params.number, { ...(req.body || {}), userId: req.user.id });
    res.json({ tooling });
  } catch (err) {
    fail(res, err, 'update the tooling');
  }
});

router.post('/:number/opening/review', reviewerMiddleware, async (req, res) => {
  try {
    const found = await pool.query('SELECT id, plant FROM toolings WHERE number = $1', [req.params.number]);
    if (found.rows.length === 0) return res.status(404).json({ error: 'Tooling not found' });
    const { action, pockets, outer, note } = req.body || {};
    const opening = await toolingReview.reviewOpening(pool, found.rows[0].id, { action, pockets, outer, note, userId: req.user.id });
    res.json({ opening });
  } catch (err) {
    fail(res, err, 'review the opening');
  }
});

// Answers with the fresh detail payload plus openingKept (a confirmed or reviewed opening is never replaced).
router.post('/:number/drawing', reviewerMiddleware, acceptDrawing, async (req, res) => {
  let client = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const found = await pool.query('SELECT * FROM toolings WHERE number = $1', [req.params.number]);
    if (found.rows.length === 0) return res.status(404).json({ error: 'Tooling not found' });
    client = await pool.connect();
    const out = await toolingReview.attachDrawing(client, found.rows[0], {
      buffer: req.file.buffer, originalName: req.file.originalname, root: drawingStore.getRoot(), io: diskIo,
    });
    client.release();
    client = null;
    const detail = await loadDetail(found.rows[0].number);
    res.json({ ...detail, openingKept: out.openingKept, extraction: out.extraction });
  } catch (err) {
    fail(res, err, 'attach the drawing');
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
