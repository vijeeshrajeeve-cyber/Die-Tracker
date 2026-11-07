'use strict';
const express = require('express');
const { pool } = require('../db.cjs');
const { loadPresses } = require('../services/frozenDesigns.cjs');
const { resolvePress } = require('../services/dieListImport.cjs');
const { normalizeSizeClass } = require('../services/toolingNumbers.cjs');

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
    if (text(req.query.plant)) add('t.plant = ?', text(req.query.plant));
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
              (SELECT count(1) FROM die_tooling_links l WHERE l.tooling_number = t.number)::int AS linked_dies
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
    // One die row per link: prefer the die of the same plant when die_no repeats across plants.
    const links = await pool.query(
      `SELECT l.die_no, l.plant, l.source, l.seen_at,
              d.die_size, d.press, d.cavity, d.die_status, (d.die_no IS NOT NULL) AS die_found
         FROM die_tooling_links l
         LEFT JOIN LATERAL (
              SELECT e.die_no, e.die_size, e.press, e.cavity, e.die_status
                FROM existing_die_details e
               WHERE e.die_no = l.die_no
               ORDER BY (e.plant IS NOT DISTINCT FROM l.plant) DESC
               LIMIT 1
         ) d ON true
        WHERE l.tooling_number = $1
        ORDER BY l.die_no, l.id`,
      [tooling.number],
    );
    res.json({
      tooling,
      opening: opening.rows[0] || null,
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

module.exports = router;
