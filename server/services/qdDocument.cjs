'use strict';
// Builds the rendered QD form for one QD. Lives in a service rather than in the
// QD route because more than one route needs it: the QD download and Purchase
// email, and the supplier email sent from the compose modal.
const fsp = require('fs/promises');
const path = require('path');
const qd = require('./qualityDiscrepancies.cjs');
const store = require('./qdStorage.cjs');
const qdPdf = require('./qdPdf.cjs');
const signatures = require('./userSignatures.cjs');

// Loads everything generateQdPdf needs for a single QD: the row (with
// approved_by resolved to a username), its files, billet parameters, and the
// bytes of any image files/logo it can render inline.
async function buildQdPdfBytes(pool, qdId) {
  const [{ rows: qrows }, filesRes] = await Promise.all([
    pool.query('SELECT * FROM quality_discrepancies WHERE id = $1', [qdId]),
    pool.query('SELECT id, original_name, mime_type, stored_path, category FROM quality_discrepancy_files WHERE qd_id = $1', [qdId]),
  ]);
  const row = qrows[0];
  if (!row) throw new Error('QD not found');
  if (row.approved_by) {
    const u = await pool.query('SELECT username FROM users WHERE id = $1', [row.approved_by]);
    row.approved_by_name = u.rows[0]?.username || '';
  }
  const billets = (await qd.listBilletParameters(pool, [row.id])).get(row.id) || [];
  const fileBytes = new Map();
  const root = path.resolve(store.getRoot());
  for (const f of filesRes.rows) {
    if (!/(png|jpe?g|webp)$/i.test(f.original_name)) continue;
    const abs = path.resolve(root, f.stored_path);
    if (!abs.startsWith(root)) continue;
    try { fileBytes.set(f.id, await fsp.readFile(abs)); } catch { /* skip */ }
  }
  let logoBytes = null;
  try { logoBytes = await fsp.readFile(path.join(__dirname, '..', 'assets', 'gulfex-logo.png')); } catch { /* optional */ }
  // The controlled QD form. The renderer reproduces its grid from measured
  // coordinates and lifts the letterhead artwork straight out of this file.
  let templateBytes = null;
  try { templateBytes = await fsp.readFile(path.join(__dirname, '..', 'assets', 'qd-form-template.pdf')); } catch { /* optional */ }
  const sigs = await loadQdSignatures(pool, row);
  return {
    row,
    bytes: await qdPdf.generateQdPdf(row, {
      files: filesRes.rows, billets, fileBytes, logoBytes, templateBytes, signatures: sigs,
    }),
  };
}

// Decides whose scanned signature may appear on this QD. A signature asserts
// that a named person performed an act, so each one is tied to the record of
// that act rather than to whoever happens to be printing the PDF.
async function loadQdSignatures(pool, row) {
  const out = {};
  // Prepared By is signed by submitting the QD for approval -- a Draft is not
  // yet anybody's finished work. The signature belongs to whoever created the
  // QD; QDs raised before prepared_by was pinned to the creator may carry the
  // corrector's name instead, so only sign when the name on the form really is
  // the creating user's.
  if (row.created_by && row.submitted_at) {
    const u = await pool.query('SELECT username FROM users WHERE id = $1', [row.created_by]);
    const creator = u.rows[0]?.username || '';
    if (creator && creator === String(row.prepared_by || '').trim()) {
      out.prepared = await signatures.getSignature(pool, row.created_by);
    }
  }
  // Authorized By is signed by approving it.
  if (row.approved_by && row.approved_at) {
    out.authorized = await signatures.getSignature(pool, row.approved_by);
  }
  return out;
}

// The filename the supplier and Purchase both see on the attachment.
const qdPdfFilename = (row) => `QD-${row.qd_no || row.id}.pdf`;

module.exports = { buildQdPdfBytes, loadQdSignatures, qdPdfFilename };
