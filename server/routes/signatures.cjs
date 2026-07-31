'use strict';
// Self-service signature management. Every route acts on the caller's own
// signature only -- there is deliberately no "upload a signature for someone
// else" path, because a signature nobody else can install is the only thing
// that makes it worth printing on the QD form.
const express = require('express');
const multer = require('multer');
const { pool } = require('../db.cjs');
const signatures = require('../services/userSignatures.cjs');

const router = express.Router();

// Signatures are small and go straight into the database, so there is no reason
// to touch the disk on the way through.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: signatures.MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (signatures.isAllowed(file)) return cb(null, true);
    cb(new Error('File type not allowed'));
  },
});

// Multer reports a rejected upload as an error; without this it reaches the
// generic handler as an opaque 500 when it is really a client mistake.
const acceptSignature = (req, res, next) => {
  upload.single('signature')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Signature image too large (max ${Math.round(signatures.MAX_BYTES / 1024)} KB)`
      : err.message === 'File type not allowed'
        ? `File type not allowed (accepted: ${signatures.ALLOWED_EXTENSIONS.join(', ')})`
        : err.message;
    return res.status(400).json({ error: message });
  });
};

// GET /api/signatures/me — { dataUrl, updatedAt }, both null when none is set.
router.get('/me', async (req, res) => {
  try {
    const sig = await signatures.getSignature(pool, req.user?.id);
    res.json({ dataUrl: signatures.toDataUrl(sig), updatedAt: sig?.updatedAt || null });
  } catch (e) {
    console.error('Get signature error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/signatures/me  (multipart, field "signature")
router.put('/me', acceptSignature, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No signature image uploaded' });
    await signatures.saveSignature(pool, req.user.id, {
      mimeType: signatures.mimeFor(req.file),
      bytes: req.file.buffer,
    });
    const sig = await signatures.getSignature(pool, req.user.id);
    res.json({ message: 'Signature saved', dataUrl: signatures.toDataUrl(sig), updatedAt: sig.updatedAt });
  } catch (e) {
    console.error('Save signature error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/signatures/me — QDs already issued keep the signature that was
// rendered into them; this only affects PDFs generated from now on.
router.delete('/me', async (req, res) => {
  try {
    const removed = await signatures.deleteSignature(pool, req.user.id);
    if (!removed) return res.status(404).json({ error: 'No signature to remove' });
    res.json({ message: 'Signature removed' });
  } catch (e) {
    console.error('Delete signature error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
