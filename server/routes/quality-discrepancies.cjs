'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { pool } = require('../db.cjs');
const qd = require('../services/qualityDiscrepancies.cjs');
const store = require('../services/qdStorage.cjs');
const qdSettings = require('../services/qdSettings.cjs');
const email = require('../services/email.cjs');
const qdDocument = require('../services/qdDocument.cjs');

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

// QD numbers run YYYY + supplier code + per-supplier sequence, e.g. 2026PD-01.
// The code comes from the supplier master so collisions (PHOENIX/PHME) stay
// resolved in one place; we only fall back to deriving it for suppliers that
// have no row in the master yet.
async function nextQdNo(client, supplierName) {
  const year = new Date().getFullYear();
  const { rows: sup } = await client.query(
    `SELECT name, qd_code FROM suppliers WHERE UPPER(name) = UPPER($1) LIMIT 1`,
    [supplierName]
  );
  const code = sup[0]?.qd_code || qd.deriveQdCode(sup[0]?.name || supplierName);
  if (!code) {
    throw new Error(`No QD code for supplier "${supplierName}" — set one in Settings → Suppliers`);
  }
  const { rows } = await client.query(
    `SELECT qd_no FROM quality_discrepancies WHERE qd_no LIKE $1`,
    [`${year}${code}-%`]
  );
  return qd.formatQdNo(year, code, qd.nextSequence(rows.map(r => r.qd_no), year, code));
}

// Resolves the assigned approvers of a page of QDs to usernames in one query.
async function approverNameMap(rows) {
  const ids = [...new Set((rows || []).map((r) => r.assigned_approver).filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows: users } = await pool.query('SELECT id, username FROM users WHERE id = ANY($1::int[])', [ids]);
  return new Map(users.map((u) => [u.id, u.username]));
}

// GET /api/quality-discrepancies?year=2026 → rows + derived KPIs + supplier rollup
// The year is a period selector: it scopes the rows, the KPIs and the supplier
// rollup together. `years` always lists every year on record so the filter can
// still offer the others.
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const all = await qd.listQDs(pool);
    const scoped = qd.filterByYear(all, req.query.year);
    const settings = await qdSettings.getQdSettings(pool);
    const visible = req.query.drafts === '1'
      ? qd.onlyDrafts(scoped, req.user?.id)
      : qd.excludeDrafts(scoped);
    const forKpis = qd.excludeDrafts(scoped);
    // Approving is per-QD now, so each row carries its own verdict rather than
    // the drawer deciding from a single account-wide flag.
    const isApprover = qdSettings.isApprover(req.user, settings.approverUserIds);
    const approverNames = await approverNameMap(visible);
    const decorated = visible.map((r) => ({
      ...r,
      assigned_approver_name: approverNames.get(r.assigned_approver) || null,
      can_approve: isApprover && qd.canActOnApproval(req.user, r),
    }));
    res.json({
      qds: decorated,
      kpis: qd.computeKpis(forKpis, now),
      // The two FOC buckets, ready to render: promised-but-not-arrived, and
      // arrived-but-not-trialled. Scoped by the same year filter as the KPIs.
      foc: qd.pendingFoc(forKpis, now),
      suppliers: qd.summarizeSuppliers(forKpis, now),
      years: qd.availableYears(all),
      canApprove: qdSettings.isApprover(req.user, settings.approverUserIds),
      // Dropdown option lists for the raise/edit form (admin-managed in Settings).
      options: { press: settings.pressOptions, dieType: settings.dieTypeOptions, alloy: settings.alloyOptions },
    });
  } catch (e) {
    console.error('List QDs error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quality-discrepancies
router.post('/', async (req, res) => {
  const {
    dieNo, plant, supplier, corrector, issue, outcome, inputAtFailure,
    dieReceivedDate, press, dieType, dieSize, noOfCavity, tooling, noOfTrials, noOfCorrections,
    productionDate, manufacturingDefect, diePerformance, recommendedAction, dieOrderId,
    qdRequestedDate,
  } = req.body || {};
  // Validated before taking a pool connection: none of these checks need the
  // database, and releasing on a validation path left the finally block below
  // releasing the same client twice — which pg throws on.
  if (!String(dieNo || '').trim()) return res.status(400).json({ error: 'Die No is required' });
  if (!String(plant || '').trim()) return res.status(400).json({ error: 'Plant is required' });
  if (!String(supplier || '').trim()) return res.status(400).json({ error: 'Supplier is required' });
  // Required on every new QD: the plant's own request date, which the system
  // cannot infer. Nullable in the DB only because pre-existing rows have none.
  const requestedDate = String(qdRequestedDate || '').trim();
  if (!requestedDate) return res.status(400).json({ error: 'QD requested date is required' });
  if (!qd.ISO_DATE.test(requestedDate)) return res.status(400).json({ error: 'Invalid QD requested date (expected YYYY-MM-DD)' });
  if (outcome && !qd.OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Invalid outcome' });

  const client = await pool.connect();
  try {
    const text = String(issue || '').trim() || 'Quality discrepancy raised';
    const summary = text.split('\n')[0].slice(0, 160);

    await client.query('BEGIN');
    const id = await qd.createQD(client, {
      qdNo: null,
      dieNo: String(dieNo).trim(),
      raisedDate: new Date().toISOString().slice(0, 10),
      qdRequestedDate: requestedDate,
      plant: String(plant).trim(),
      supplier: String(supplier).trim(),
      corrector: String(corrector || '').trim() || null,
      status: 'Open',
      approvalState: 'Draft',
      outcome: outcome || null,
      issueSummary: summary,
      issueDetail: text,
      inputAtFailure: String(inputAtFailure || '').trim() || null,
      // "Prepared By" on the QD form is who raised the record, not who is
      // fixing the die -- the corrector is a different person and belongs in
      // its own field. Left null rather than defaulted so the signed form never
      // names someone who did not prepare it.
      preparedBy: req.user?.username || null,
      createdBy: req.user?.id,
      dieReceivedDate: String(dieReceivedDate || '').trim() || null,
      press: String(press || '').trim() || null,
      dieType: String(dieType || '').trim() || null,
      dieSize: String(dieSize || '').trim() || null,
      noOfCavity: String(noOfCavity || '').trim() || null,
      tooling: String(tooling || '').trim() || null,
      noOfTrials: String(noOfTrials || '').trim() || null,
      noOfCorrections: String(noOfCorrections || '').trim() || null,
      productionDate: String(productionDate || '').trim() || null,
      manufacturingDefect: String(manufacturingDefect || '').trim() || null,
      diePerformance: String(diePerformance || '').trim() || null,
      recommendedAction: String(recommendedAction || '').trim() || null,
      dieOrderId: dieOrderId || null,
    });
    await qd.addActivity(client, {
      qdId: id, actor: String(corrector || '').trim() || actorFor(req),
      action: `drafted QD against die ${String(dieNo).trim()}`,
      icon: 'flag', tone: 'flag', userId: req.user?.id,
    });
    if (req.body.billets) await qd.saveBilletParameters(client, id, req.body.billets);
    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'QD number already exists — please retry' });
    if (/^No QD code/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Create QD error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /settings → approver ids + Purchase recipients (any authed user may read;
// the client uses it to prefill the admin form, and canApprove is derived here too)
router.get('/settings', async (req, res) => {
  try {
    res.json(await qdSettings.getQdSettings(pool));
  } catch (e) { console.error('QD settings read error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /settings → admin only
router.put('/settings', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const body = req.body || {};
    // Merge onto current settings so a payload that omits a field leaves it intact.
    const cur = await qdSettings.getQdSettings(pool);
    await qdSettings.saveQdSettings(pool, {
      approverUserIds: Array.isArray(body.approverUserIds) ? body.approverUserIds : cur.approverUserIds,
      purchaseEmailTo: body.purchaseEmailTo != null ? String(body.purchaseEmailTo) : cur.purchaseEmailTo,
      purchaseEmailCc: body.purchaseEmailCc != null ? String(body.purchaseEmailCc) : cur.purchaseEmailCc,
      pressOptions: Array.isArray(body.pressOptions) ? body.pressOptions : cur.pressOptions,
      dieTypeOptions: Array.isArray(body.dieTypeOptions) ? body.dieTypeOptions : cur.dieTypeOptions,
      alloyOptions: Array.isArray(body.alloyOptions) ? body.alloyOptions : cur.alloyOptions,
    });
    res.json({ message: 'Saved' });
  } catch (e) { console.error('QD settings save error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Everyone eligible to approve: the users an admin ticked in Settings, plus
// admins, who can always approve. Readable by any QD user because the raiser has
// to choose one when submitting — and /api/users is admin-only.
async function listEligibleApprovers() {
  const { approverUserIds } = await qdSettings.getQdSettings(pool);
  const { rows } = await pool.query(
    `SELECT id, username, role FROM users
      WHERE role = 'admin' OR id = ANY($1::int[])
      ORDER BY username`,
    [(approverUserIds || []).map(Number).filter(Number.isFinite)]
  );
  return rows;
}

// GET /approvers → [{ id, username, role }] for the submit-time picker
router.get('/approvers', async (req, res) => {
  try {
    res.json({ approvers: await listEligibleApprovers() });
  } catch (e) { console.error('List approvers error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Gate for approve / send back / resend. Being an approver is necessary but not
// sufficient: once a QD names an approver, only they (or an admin) may act, so
// two approvers cannot both act on the same QD.
const requireApprover = async (req, res, next) => {
  try {
    const { approverUserIds } = await qdSettings.getQdSettings(pool);
    if (!qdSettings.isApprover(req.user, approverUserIds)) {
      return res.status(403).json({ error: 'Not authorized to approve QDs' });
    }
    const { rows } = await pool.query(
      'SELECT assigned_approver FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (rows[0] && !qd.canActOnApproval(req.user, rows[0])) {
      return res.status(403).json({ error: 'This QD was sent to another approver' });
    }
    next();
  } catch (e) { console.error('Approver check error:', e); res.status(500).json({ error: 'Internal server error' }); }
};

// The rendered QD form, built by the shared service (also used by the
// supplier email sent from the compose modal).
const buildQdPdfBytes = (qdId) => qdDocument.buildQdPdfBytes(pool, qdId);

// The acting user's signature details. Returns null when there is no user (or
// the lookup fails), which the signature builder handles by falling back to
// the department block rather than signing with a blank name.
async function signatureUser(userId) {
  if (!userId) return null;
  try {
    const { rows } = await pool.query('SELECT username, full_name, email, phone FROM users WHERE id = $1', [userId]);
    return rows[0] || null;
  } catch { return null; }
}

// Emails the raiser that their QD came back, and records on the timeline
// whether they were actually reached. Never throws: the send-back has already
// been committed by the time this runs. Returns { emailWarning } when the
// raiser could not be told, so the approver sees it instead of assuming.
async function notifySendBack(qdId, { reason, by, userId }) {
  let warning = null;
  const senderUser = await signatureUser(userId);
  try {
    const { rows } = await pool.query(
      `SELECT q.qd_no, q.die_no, q.supplier, u.username, u.email
         FROM quality_discrepancies q
         LEFT JOIN users u ON u.id = q.created_by
        WHERE q.id = $1`, [qdId]);
    const row = rows[0];
    if (!row) return {};
    const to = String(row.email || '').trim();
    if (!to) {
      warning = `${row.username || 'The raiser'} has no email address on file, so they were not notified`;
    } else {
      await email.sendEmail({
        to,
        subject: qd.sendBackEmailSubject(row),
        body: qd.buildSendBackEmailHtml(row, { reason, by, sender: senderUser }),
        importance: 'high', sentBy: userId,
      });
      await qd.addActivityOfKind(pool, {
        qdId, kind: 'email', actor: by, note: `sent-back notice emailed to ${row.username || to}`, userId,
      });
    }
  } catch (e) {
    console.error('Send-back notification failed:', e.message);
    warning = e.message;
  }
  if (warning) {
    // Recorded as a note, not an email: no mail went out.
    await qd.addActivityOfKind(pool, {
      qdId, kind: 'note', actor: by, note: `raiser not notified — ${warning}`, userId,
    }).catch(() => { /* the send-back itself still stands */ });
  }
  return warning ? { emailWarning: warning } : {};
}

// Shared: build + send the Purchase email for an already-approved QD.
// Non-blocking — the caller decides how to report a send failure.
async function sendPurchaseEmail(qdId, sentBy) {
  const { row, bytes } = await buildQdPdfBytes(qdId);
  const { purchaseEmailTo, purchaseEmailCc } = await qdSettings.getQdSettings(pool);
  if (!purchaseEmailTo) throw new Error('No Purchase recipient configured (Settings → QD)');
  await email.sendEmail({
    to: purchaseEmailTo, cc: purchaseEmailCc || undefined,
    subject: qd.purchaseEmailSubject(row), body: qd.buildPurchaseEmailHtml(row, await signatureUser(sentBy)),
    importance: 'high', sentBy,
    attachments: [{ filename: qdDocument.qdPdfFilename(row), content: Buffer.from(bytes), contentType: 'application/pdf' }],
  });
}

// POST /:id/submit → Draft/SentBack → Pending (assigns a number if unnumbered)
router.post('/:id/submit', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await qd.getApprovalRow(client, req.params.id);
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'QD not found' }); }
    // The raiser names the approver. Validated against the eligible list so a
    // QD cannot be parked with someone who has no power to act on it.
    const approverUserId = Number(req.body?.approverUserId);
    if (!Number.isFinite(approverUserId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose an approver to send this QD to' });
    }
    const approver = (await listEligibleApprovers()).find((a) => a.id === approverUserId);
    if (!approver) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That user cannot approve QDs' });
    }
    const newQdNo = row.qd_no || await nextQdNo(client, row.supplier);
    const out = await qd.submitForApproval(client, {
      id: req.params.id, newQdNo, actor: actorFor(req), userId: req.user?.id,
      approverUserId, approverName: approver.username,
    });
    await client.query('COMMIT');
    res.json({ message: 'Submitted', qd_no: out.qdNo, approval_state: out.state });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'QD number already exists — please retry' });
    if (/^Cannot submit/.test(e.message)) return res.status(400).json({ error: e.message });
    if (/^No QD code/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Submit QD error:', e); res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

// POST /:id/approve → Pending → Approved, then email Purchase (non-blocking)
router.post('/:id/approve', requireApprover, async (req, res) => {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const out = await qd.approveQD(client, { id: req.params.id, actor: actorFor(req), userId: req.user?.id });
    if (!out.ok) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'QD not found' }); }
    await client.query('COMMIT');
    client.release();
    released = true;
    // Email after commit and after releasing the pooled client — a mail
    // failure must not undo the approval, and buildQdPdfBytes acquires more
    // pool connections of its own, so holding this one idle risks starvation.
    try {
      await sendPurchaseEmail(req.params.id, req.user?.id);
      await qd.addActivityOfKind(pool, { qdId: req.params.id, kind: 'email',
        actor: actorFor(req), note: 'QD emailed to Purchase team', userId: req.user?.id });
      res.json({ message: 'Approved and sent to Purchase' });
    } catch (mailErr) {
      console.error('Purchase email failed:', mailErr.message);
      res.json({ message: 'Approved', emailWarning: mailErr.message });
    }
  } catch (e) {
    await client.query('ROLLBACK');
    if (/^Cannot approve/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Approve QD error:', e); res.status(500).json({ error: 'Internal server error' });
  } finally { if (!released) client.release(); }
});

// POST /:id/resend-purchase → re-send the Purchase email for an Approved QD
router.post('/:id/resend-purchase', requireApprover, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT approval_state FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'QD not found' });
    if (rows[0].approval_state !== 'Approved') return res.status(400).json({ error: 'Only an approved QD can be sent to Purchase' });
    await sendPurchaseEmail(req.params.id, req.user?.id);
    await qd.addActivityOfKind(pool, { qdId: req.params.id, kind: 'email',
      actor: actorFor(req), note: 'QD re-sent to Purchase team', userId: req.user?.id });
    res.json({ message: 'Re-sent to Purchase' });
  } catch (e) {
    if (/^No Purchase recipient configured/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Resend Purchase error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/send-back → Pending → SentBack (reason required), approver only
router.post('/:id/send-back', requireApprover, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await qd.sendBack(client, {
      id: req.params.id, reason: req.body?.reason, actor: actorFor(req), userId: req.user?.id });
    if (!out.ok) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'QD not found' }); }
    await client.query('COMMIT');
    // Telling the raiser is the whole point, but a mail failure must not undo a
    // send-back that already happened — same rule as the Purchase email on
    // approve. The outcome goes on the timeline either way, so nobody is left
    // assuming the raiser was told when they were not.
    const notice = await notifySendBack(req.params.id, {
      reason: req.body?.reason, by: actorFor(req), userId: req.user?.id,
    });
    res.json({ message: 'Sent back', ...notice });
  } catch (e) {
    await client.query('ROLLBACK');
    if (/^Reason is required/.test(e.message) || /^Cannot sendBack/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Send-back QD error:', e); res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

// GET /api/quality-discrepancies/:id/document  (rendered QD form as a PDF, inline)
// Must stay ahead of PATCH /:id so it isn't shadowed by that param route.
router.get('/:id/document', async (req, res) => {
  try {
    const { row, bytes } = await buildQdPdfBytes(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="QD-${row.qd_no || row.id}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    if (/QD not found/.test(e.message)) return res.status(404).json({ error: e.message });
    console.error('QD document error:', e); res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/quality-discrepancies/:id  { outcome?, input_at_failure?, eta_date?, corrector? }
// Editable detail fields. An empty string clears the field. Part-A fields are
// refused once the QD is Pending or Approved, exactly as PUT /:id refuses them —
// the progress fields (supplier reply, hand-off dates, ETA) stay open.
router.patch('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ok = await qd.updateFields(client, {
      id: req.params.id, fields: req.body || {}, actor: actorFor(req), userId: req.user?.id,
    });
    await client.query('COMMIT');
    if (!ok) return res.status(400).json({ error: 'No editable fields supplied, or QD not found' });
    res.json({ message: 'Updated' });
  } catch (e) {
    await client.query('ROLLBACK');
    // Same mapping as PUT /:id: a locked QD is a conflict, not a bad request.
    if (/^Cannot edit a QD/.test(e.message)) return res.status(409).json({ error: e.message });
    // Validation failures are the caller's mistake — answer 400, not 500.
    if (/^Invalid /.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Update QD fields error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT /api/quality-discrepancies/:id  — full "Edit QD" save (Part-A, discrepancy
// text, billets). Allowed only while the QD is a Draft or has been sent back.
// The body reuses the raise form's camelCase field names; billets is
// { first:{…}, last:{…} }. The PDF is generated live, so no regenerate step.
const EDIT_BODY_MAP = {
  profileNumber: 'profile_number', supplier: 'supplier', plant: 'plant', corrector: 'corrector',
  dieReceivedDate: 'die_received_date', press: 'press', dieType: 'die_type', dieSize: 'die_size',
  qdRequestedDate: 'qd_requested_date',
  noOfCavity: 'no_of_cavity', tooling: 'tooling', noOfTrials: 'no_of_trials', noOfCorrections: 'no_of_corrections',
  productionDate: 'production_date', manufacturingDefect: 'manufacturing_defect', diePerformance: 'die_performance',
  issue: 'issue_detail', recommendedAction: 'recommended_action', inputAtFailure: 'input_at_failure', outcome: 'outcome',
};
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fields = {};
    for (const [bodyKey, col] of Object.entries(EDIT_BODY_MAP)) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, bodyKey)) fields[col] = req.body[bodyKey];
    }
    const ok = await qd.editQdDetails(client, {
      id: req.params.id, fields, billets: req.body?.billets,
      actor: actorFor(req), userId: req.user?.id,
    });
    await client.query('COMMIT');
    if (!ok) return res.status(404).json({ error: 'QD not found, or no changes supplied' });
    res.json({ message: 'Saved' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (/^Cannot edit a QD/.test(e.message)) return res.status(409).json({ error: e.message });
    if (/^Invalid /.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Edit QD error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Caller mistakes the QD service reports by throwing: a missing reason, a bad
// or absent date, or an impossible FOC move (a receipt against no promise).
// These are 400s, not 500s — the UI shows the message as-is.
const isClientError = (message) => /^(Reason|ETA|Received date|Invalid|No FOC round|This FOC round|Record the receipt|Trial date) /.test(message);

// PATCH /api/quality-discrepancies/:id/status  { status, reason, etaDate?, receivedDate? }
// A reason is always mandatory; an ETA is mandatory when moving to FOC Accepted,
// and an arrival date when moving to FOC Received.
router.patch('/:id/status', async (req, res) => {
  const { status, reason, etaDate, receivedDate } = req.body || {};
  // Validated before connecting, so the finally block is the only release path.
  if (!qd.STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ok = await qd.updateStatus(client, {
      id: req.params.id, status, reason, etaDate, receivedDate,
      actor: actorFor(req), userId: req.user?.id,
    });
    await client.query('COMMIT');
    if (!ok) return res.status(404).json({ error: 'QD not found' });
    res.json({ message: 'Status updated' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (isClientError(e.message)) return res.status(400).json({ error: e.message });
    console.error('Update QD status error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/quality-discrepancies/:id/foc-trial
//   { trialDate, result, notes?, nextStatus?, reason?, etaDate? }
//
// Records the verdict on the open FOC round. A failed trial must be answered
// with a next status and a reason in the same request: the round is closed
// either way, and leaving the QD parked on 'FOC Received' with nothing left to
// receive would put it in a state nobody owns. What that status should be is
// the user's judgement — back to the supplier, reworked in-house, or given up.
router.post('/:id/foc-trial', async (req, res) => {
  const { trialDate, result, notes, nextStatus, reason, etaDate } = req.body || {};
  if (!qd.TRIAL_RESULTS.includes(result)) {
    return res.status(400).json({ error: 'Trial result must be Pass or Fail' });
  }
  if (result === 'Fail' && !qd.STATUSES.includes(nextStatus)) {
    return res.status(400).json({ error: 'A next status is required after a failed trial' });
  }
  if (nextStatus !== undefined && nextStatus !== null && !qd.STATUSES.includes(nextStatus)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ok = await qd.recordFocTrial(client, {
      id: req.params.id, trialDate, result, notes, actor: actorFor(req), userId: req.user?.id,
    });
    if (!ok) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'QD not found' });
    }
    if (nextStatus) {
      await qd.updateStatus(client, {
        id: req.params.id, status: nextStatus, reason, etaDate,
        actor: actorFor(req), userId: req.user?.id,
      });
    }
    await client.query('COMMIT');
    res.json({ message: 'Trial recorded' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (isClientError(e.message)) return res.status(400).json({ error: e.message });
    console.error('Record FOC trial error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/quality-discrepancies/:id/notes  { note, kind? }
// kind defaults to 'note'; 'email' / 'reminder' are logged by the drawer after
// an email actually sends, so the timeline reflects what really happened.
router.post('/:id/notes', async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    const kind = String(req.body?.kind || 'note');
    if (!note) return res.status(400).json({ error: 'Note is required' });
    if (!qd.ACTIVITY_KINDS[kind]) return res.status(400).json({ error: 'Invalid activity kind' });
    const exists = await pool.query('SELECT id FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'QD not found' });
    await qd.addActivityOfKind(pool, {
      qdId: req.params.id, kind, actor: actorFor(req), note, userId: req.user?.id,
    });
    res.status(201).json({ message: 'Activity added' });
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
    const category = ['profile_image', 'approved_design', 'trial_photo', 'general'].includes(req.body.category)
      ? req.body.category
      : 'general';
    const saved = [];
    for (const file of (req.files || [])) {
      const dest = store.buildStoredPath(root, { qdNo: row.qd_no, qdId: row.id, fileName: file.originalname });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await moveIntoPlace(file.path, dest);
      const ins = await pool.query(
        `INSERT INTO quality_discrepancy_files (qd_id, original_name, stored_path, mime_type, size_bytes, uploaded_by, category)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [row.id, file.originalname, path.relative(root, dest), file.mimetype, file.size, req.user?.id || null, category]
      );
      saved.push({ id: ins.rows[0].id, original_name: file.originalname });
    }
    res.status(201).json({ files: saved });
  } catch (e) {
    console.error('Upload QD files error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/quality-discrepancies/:id/files/:fileId  — remove an image while
// editing. Destructive, so gated to the editable states (Draft/SentBack) like
// the rest of the Edit flow. Deletes the row, then best-effort unlinks the file.
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const meta = await pool.query('SELECT approval_state FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (meta.rowCount === 0) return res.status(404).json({ error: 'QD not found' });
    if (!qd.EDITABLE_APPROVAL_STATES.includes(meta.rows[0].approval_state)) {
      return res.status(409).json({ error: `Cannot edit a QD in ${meta.rows[0].approval_state} state` });
    }
    const fr = await pool.query(
      'SELECT stored_path, original_name FROM quality_discrepancy_files WHERE id = $1 AND qd_id = $2',
      [req.params.fileId, req.params.id]
    );
    if (fr.rowCount === 0) return res.status(404).json({ error: 'File not found' });
    await pool.query('DELETE FROM quality_discrepancy_files WHERE id = $1', [req.params.fileId]);
    try {
      const root = path.resolve(store.getRoot());
      const abs = path.resolve(root, fr.rows[0].stored_path);
      if (abs.startsWith(root)) await fsp.unlink(abs);
    } catch { /* the DB row is gone; a stray file on disk is harmless */ }
    await qd.addActivity(pool, {
      qdId: req.params.id, actor: actorFor(req),
      action: `removed image ${fr.rows[0].original_name}`, icon: 'trash', tone: 'neutral', userId: req.user?.id,
    });
    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('Delete QD file error:', e);
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
