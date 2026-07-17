'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { pool } = require('../db.cjs');
const qd = require('../services/qualityDiscrepancies.cjs');
const store = require('../services/qdStorage.cjs');

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

// Multer surfaces rejections (bad extension, oversize) as errors. Without this
// they reach the generic handler and become an opaque 500 — these are client
// mistakes, so answer 400 with a message the UI can actually show.
const acceptFiles = (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `File too large (max ${Math.round(store.MAX_FILE_BYTES / 1024 / 1024)} MB)`
      : err.message === 'File type not allowed'
        ? `File type not allowed (accepted: ${store.ALLOWED_EXTENSIONS.join(', ')})`
        : err.message;
    return res.status(400).json({ error: message });
  });
};

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

const actorFor = (req) => req.user?.username || 'You';

// Next QD number for the current year: 2026-01, 2026-02, …
async function nextQdNo(client) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT qd_no FROM quality_discrepancies WHERE qd_no LIKE $1`,
    [`${year}-%`]
  );
  const max = rows.reduce((acc, r) => {
    const n = parseInt(String(r.qd_no).split('-')[1], 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${year}-${String(max + 1).padStart(2, '0')}`;
}

// GET /api/quality-discrepancies → rows + derived KPIs + supplier rollup
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const qds = await qd.listQDs(pool);
    res.json({
      qds,
      kpis: qd.computeKpis(qds, now),
      suppliers: qd.summarizeSuppliers(qds, now),
    });
  } catch (e) {
    console.error('List QDs error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quality-discrepancies
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { dieNo, plant, supplier, corrector, issue, outcome } = req.body;
    if (!String(dieNo || '').trim()) { client.release(); return res.status(400).json({ error: 'Die No is required' }); }
    if (!String(plant || '').trim()) { client.release(); return res.status(400).json({ error: 'Plant is required' }); }
    if (!String(supplier || '').trim()) { client.release(); return res.status(400).json({ error: 'Supplier is required' }); }
    if (outcome && !qd.OUTCOMES.includes(outcome)) { client.release(); return res.status(400).json({ error: 'Invalid outcome' }); }

    const text = String(issue || '').trim() || 'Quality discrepancy raised';
    const summary = text.split('\n')[0].slice(0, 160);

    await client.query('BEGIN');
    const qdNo = await nextQdNo(client);
    const id = await qd.createQD(client, {
      qdNo,
      dieNo: String(dieNo).trim(),
      raisedDate: new Date().toISOString().slice(0, 10),
      plant: String(plant).trim(),
      supplier: String(supplier).trim(),
      corrector: String(corrector || '').trim() || null,
      status: 'Open',
      outcome: outcome || null,
      issueSummary: summary,
      issueDetail: text,
      createdBy: req.user?.id,
    });
    await qd.addActivity(client, {
      qdId: id,
      actor: String(corrector || '').trim() || actorFor(req),
      action: `raised QD against die ${String(dieNo).trim()}`,
      icon: 'flag',
      tone: 'flag',
      userId: req.user?.id,
    });
    await client.query('COMMIT');
    res.status(201).json({ id, qd_no: qdNo });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'QD number already exists — please retry' });
    console.error('Create QD error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/quality-discrepancies/:id/status  { status }
router.patch('/:id/status', async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body;
    if (!qd.STATUSES.includes(status)) { client.release(); return res.status(400).json({ error: 'Invalid status' }); }
    await client.query('BEGIN');
    const ok = await qd.updateStatus(client, {
      id: req.params.id, status, actor: actorFor(req), userId: req.user?.id,
    });
    await client.query('COMMIT');
    if (!ok) return res.status(404).json({ error: 'QD not found' });
    res.json({ message: 'Status updated' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Update QD status error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/quality-discrepancies/:id/notes  { note }
router.post('/:id/notes', async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note is required' });
    const exists = await pool.query('SELECT id FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'QD not found' });
    await qd.addActivity(pool, {
      qdId: req.params.id,
      actor: actorFor(req),
      action: note,
      icon: 'message-square',
      tone: 'neutral',
      userId: req.user?.id,
    });
    res.status(201).json({ message: 'Note added' });
  } catch (e) {
    console.error('Add QD note error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quality-discrepancies/:id/files  (multipart, field "files")
router.post('/:id/files', acceptFiles, async (req, res) => {
  try {
    const meta = await pool.query('SELECT id, qd_no FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (meta.rowCount === 0) return res.status(404).json({ error: 'QD not found' });
    const row = meta.rows[0];
    const root = store.getRoot();
    const saved = [];
    for (const file of (req.files || [])) {
      const dest = store.buildStoredPath(root, { qdNo: row.qd_no, qdId: row.id, fileName: file.originalname });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await moveIntoPlace(file.path, dest);
      const ins = await pool.query(
        `INSERT INTO quality_discrepancy_files (qd_id, original_name, stored_path, mime_type, size_bytes, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [row.id, file.originalname, path.relative(root, dest), file.mimetype, file.size, req.user?.id || null]
      );
      saved.push({ id: ins.rows[0].id, original_name: file.originalname });
    }
    res.status(201).json({ files: saved });
  } catch (e) {
    console.error('Upload QD files error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/quality-discrepancies/files/:fileId  (download)
router.get('/files/:fileId', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM quality_discrepancy_files WHERE id = $1', [req.params.fileId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'File not found' });
    const root = path.resolve(store.getRoot());
    const abs = path.resolve(root, r.rows[0].stored_path);
    if (!abs.startsWith(root)) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
    res.download(abs, r.rows[0].original_name);
  } catch (e) {
    console.error('Download QD file error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
