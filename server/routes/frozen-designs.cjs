'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { pool } = require('../db.cjs');
const { adminMiddleware } = require('./auth.cjs');
const fd = require('../services/frozenDesigns.cjs');
const store = require('../services/frozenDesignStorage.cjs');

const router = express.Router();

// Keep the temp dir on the same filesystem as the final storage so moving the
// file into place is an intra-device rename (avoids EXDEV across the Docker volume).
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = store.getTmpDir();
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: store.MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (store.isAllowedExtension(file.originalname)) return cb(null, true);
    cb(new Error('File type not allowed'));
  },
});

// Move a finished upload into place; rename when on the same device, otherwise
// fall back to copy + unlink (defensive — temp dir should already be co-located).
async function moveIntoPlace(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw e;
    }
  }
}

// GET /api/frozen-designs?profile=&plant=&press=&cavity=&activeOnly=
router.get('/', async (req, res) => {
  try {
    const { profile, plant, press, cavity, activeOnly } = req.query;
    const rows = await fd.listFrozenDesigns(pool, {
      profile, plant, press, cavity,
      activeOnly: activeOnly === 'true' || activeOnly === '1',
    });
    res.json(rows);
  } catch (e) {
    console.error('List frozen designs error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/frozen-designs/match?profile=&plant=&press=&cavity=
router.get('/match', async (req, res) => {
  try {
    const { profile, plant, press, cavity } = req.query;
    const match = await fd.findActiveMatch(pool, { profile, plant, press, cavity });
    if (!match) return res.json(null);
    const files = await pool.query(
      `SELECT id, original_name, mime_type, size_bytes FROM frozen_design_files WHERE frozen_design_id = $1`,
      [match.id]
    );
    // Enrich with the source order's re-orderable details (Generate Die Order PDF prefill).
    let source_order = null;
    if (match.source_order_id) {
      const so = await pool.query(
        `SELECT supplier, die_size, cavity, press, shipment_type, type, eta
           FROM die_orders WHERE id = $1`,
        [match.source_order_id]
      );
      source_order = so.rows[0] || null;
    }
    res.json({ ...match, files: files.rows, source_order });
  } catch (e) {
    console.error('Match frozen design error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/frozen-designs  { profile, plant, press, cavity, sourceOrderId, notes }
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { profile, plant, press, cavity, sourceOrderId, notes, supplier, dieSize } = req.body;
    if (!fd.hasFullKey({ profile, plant, press, cavity })) {
      client.release();
      return res.status(400).json({ error: 'profile, plant, press and cavity are required' });
    }
    await client.query('BEGIN');
    const id = await fd.freezeDesign(client, {
      profile, plant, press, cavity, sourceOrderId, frozenBy: req.user?.id, notes, supplier, dieSize,
    });
    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create frozen design error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/frozen-designs/:id/files  (multipart, field name "files")
router.post('/:id/files', upload.array('files', 10), async (req, res) => {
  try {
    const { id } = req.params;
    const meta = await pool.query(`SELECT * FROM frozen_designs WHERE id = $1`, [id]);
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Frozen design not found' });
    const d = meta.rows[0];
    const root = store.getRoot();
    const saved = [];
    for (const file of (req.files || [])) {
      const dest = store.buildStoredPath(root, {
        profile: d.profile_number, press: d.press, cavity: d.cavity,
        frozenDesignId: d.id, fileName: file.originalname,
      });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await moveIntoPlace(file.path, dest);
      const rel = path.relative(root, dest);
      const ins = await pool.query(
        `INSERT INTO frozen_design_files (frozen_design_id, original_name, stored_path, mime_type, size_bytes, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [d.id, file.originalname, rel, file.mimetype, file.size, req.user?.id || null]
      );
      saved.push({ id: ins.rows[0].id, original_name: file.originalname });
    }
    res.status(201).json({ files: saved });
  } catch (e) {
    console.error('Upload frozen design files error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/frozen-designs/files/:fileId  (download)
router.get('/files/:fileId', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM frozen_design_files WHERE id = $1`, [req.params.fileId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'File not found' });
    const root = store.getRoot();
    const abs = path.resolve(root, r.rows[0].stored_path);
    if (!abs.startsWith(path.resolve(root))) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
    res.download(abs, r.rows[0].original_name);
  } catch (e) {
    console.error('Download frozen design file error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/frozen-designs/:id/release  (admin)
router.post('/:id/release', adminMiddleware, async (req, res) => {
  try {
    const ok = await fd.manualRelease(pool, { id: req.params.id, userId: req.user?.id });
    if (!ok) return res.status(404).json({ error: 'Active frozen design not found' });
    res.json({ message: 'Released' });
  } catch (e) {
    console.error('Release frozen design error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
