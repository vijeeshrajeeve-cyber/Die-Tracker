'use strict';
const express = require('express');
const { pool } = require('../db.cjs');
const { loadPresses, normalizePlant } = require('../services/frozenDesigns.cjs');
const { resolvePress } = require('../services/dieListImport.cjs');
const { normalizeSizeClass } = require('../services/toolingNumbers.cjs');
const drawingStore = require('../services/toolingDrawings.cjs');

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

    add('t.status = ?', text(req.query.status) || 'active');
    if (text(req.query.plant)) add('t.plant = ?', normalizePlant(req.query.plant));
    if (text(req.query.kind)) add('t.kind = ?', text(req.query.kind));
    if (text(req.query.sizeClass)) {
      add('t.size_class = ?', normalizeSizeClass(req.query.sizeClass) || text(req.query.sizeClass));
    }
    if (text(req.query.press)) add('t.held_presses @> ARRAY[?]::text[]', await normalizePress(req.query.press));
    if (text(req.query.q)) {
      add("t.number ILIKE ? ESCAPE '\\'", `%${text(req.query.q).replace(/[\\%_]/g, '\\$&')}%`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
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

router.get('/:number', async (req, res) => {
  try {
    const found = await pool.query(
      `SELECT t.*, COALESCE(o.confidence, 'none') AS opening_confidence
         FROM toolings t
         LEFT JOIN tooling_openings o ON o.tooling_id = t.id
        WHERE t.number = $1`,
      [req.params.number],
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'Tooling not found' });
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
    res.json({
      tooling,
      opening: opening.rows[0] || null,
      drawings: drawings.rows,
      links: links.rows.map(({ die_size, press, cavity, die_status, die_found, ...link }) => ({
        ...link,
        die: die_found === false ? null : { die_size, press, cavity, die_status },
      })),
    });
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

module.exports = router;
