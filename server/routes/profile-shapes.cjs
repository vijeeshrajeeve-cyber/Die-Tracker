'use strict';
// Read side of the profile library: a die's stored shapes, its nearest
// neighbours, nearest-to-a-posted-polygon, and the stored picture.
const path = require('node:path');
const express = require('express');
const { pool } = require('../db.cjs');
const { reviewerMiddleware } = require('./auth.cjs');
const { normalizePlant } = require('../services/frozenDesigns.cjs');
const { toUnitFrame, signatureOf } = require('../services/profileShape.cjs');
const { loadIndex, nearest, DEFAULT_LIMIT } = require('../services/profileSimilarity.cjs');
const orderFiles = require('../services/orderFiles.cjs');
const toolingDrawings = require('../services/toolingDrawings.cjs');
const { reviewProfileShape } = require('../services/toolingReview.cjs');

const router = express.Router();

const MAX_LIMIT = 100;

const clampLimit = (raw) => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : DEFAULT_LIMIT;
};

const plantOf = (raw) => normalizePlant(raw) || null;

const isPolygon = (poly) => Array.isArray(poly) && poly.length >= 3
  && poly.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));

const NEWEST_FIRST = 'ORDER BY updated_at DESC, id DESC';

// Literal path first, so it is never read as a die number.
router.post('/similar', async (req, res) => {
  try {
    const { plant: rawPlant, outer, holes = [], cavities = null, limit } = req.body || {};
    const plant = plantOf(rawPlant);
    if (!plant) return res.status(400).json({ error: 'plant is required' });
    if (!isPolygon(outer)) return res.status(400).json({ error: 'outer must be an array of at least 3 [x, y] number pairs' });
    if (!Array.isArray(holes) || !holes.every(isPolygon)) {
      return res.status(400).json({ error: 'holes must be an array of polygons of at least 3 [x, y] number pairs' });
    }
    if (cavities != null && !Number.isFinite(Number(cavities))) return res.status(400).json({ error: 'cavities must be a number' });
    const unit = toUnitFrame({ outer, holes });
    const signature = signatureOf({ outer: unit.outer, holes: unit.holes });
    if (!signature.every(Number.isFinite)) return res.status(400).json({ error: 'outer is degenerate' });
    const index = await loadIndex(pool, { plant });
    const items = nearest(index, { signature, holeCount: holes.length, cavities, limit: clampLimit(limit) });
    res.json({ items, signature });
  } catch (err) {
    console.error('profile similarity (posted shape) failed', err);
    res.status(500).json({ error: 'Failed to find similar profiles' });
  }
});

router.get('/:dieNo', async (req, res) => {
  try {
    const plant = plantOf(req.query.plant);
    if (!plant) return res.status(400).json({ error: 'plant is required' });
    const { rows } = await pool.query(
      `SELECT * FROM profile_shapes WHERE die_no = $1 AND plant = $2 ${NEWEST_FIRST}`,
      [req.params.dieNo, plant],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No profile shape for this die' });
    const shapes = rows.map(({ signature, ...rest }) => rest);
    res.json({ shapes, hasTrueSize: shapes.some((s) => s.true_size === true) });
  } catch (err) {
    console.error('profile shapes for die failed', err);
    res.status(500).json({ error: 'Failed to load profile shapes' });
  }
});

router.get('/:dieNo/similar', async (req, res) => {
  try {
    const plant = plantOf(req.query.plant);
    if (!plant) return res.status(400).json({ error: 'plant is required' });
    // The newest row is the query shape even when it is flagged for review.
    const { rows } = await pool.query(
      `SELECT signature, hole_count, cavities FROM profile_shapes WHERE die_no = $1 AND plant = $2 ${NEWEST_FIRST} LIMIT 1`,
      [req.params.dieNo, plant],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No profile shape for this die' });
    const index = await loadIndex(pool, { plant });
    const items = nearest(index, {
      signature: rows[0].signature,
      holeCount: rows[0].hole_count,
      cavities: rows[0].cavities,
      limit: clampLimit(req.query.limit),
      excludeDieNo: req.params.dieNo,
    });
    res.json({ items });
  } catch (err) {
    console.error('profile similarity for die failed', err);
    res.status(500).json({ error: 'Failed to find similar profiles' });
  }
});

router.get('/:dieNo/image/:shapeId', async (req, res) => {
  const unavailable = () => res.status(404).json({ error: 'Profile image not available' });
  try {
    if (!/^\d+$/.test(req.params.shapeId)) return unavailable();
    const { rows } = await pool.query(
      'SELECT source, image_path FROM profile_shapes WHERE id = $1 AND die_no = $2 AND ($3::text IS NULL OR plant = $3)',
      [Number(req.params.shapeId), req.params.dieNo, plantOf(req.query.plant)],
    );
    if (rows.length === 0 || !rows[0].image_path) return unavailable();
    const { source, image_path: rel } = rows[0];
    const root = source === 'order-pdf' ? orderFiles.getRoot() : toolingDrawings.getRoot();
    const abs = path.resolve(root, rel);
    if (!orderFiles.isInsideRoot(root, abs)) return unavailable();
    res.download(abs, `${req.params.dieNo}-${req.params.shapeId}${path.extname(abs).toLowerCase()}`, (err) => {
      if (err && !res.headersSent) unavailable();
    });
  } catch (err) {
    console.error('profile image download failed', err);
    res.status(500).json({ error: 'Failed to load the profile image' });
  }
});

// A reviewer's verdict on a shape: clear puts it into the similarity index, keep leaves it out, flagged.
router.post('/:id/review', reviewerMiddleware, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Profile shape not found' });
    const { action, note } = req.body || {};
    const shape = await reviewProfileShape(pool, Number(req.params.id), { action, note, userId: req.user.id });
    res.json({ shape });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error('profile shape review failed', err);
    res.status(500).json({ error: 'Failed to review the profile shape' });
  }
});

module.exports = router;
