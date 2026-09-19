'use strict';
// Turns an old, already-issued QD form into a QD in the register. The paper
// form was raised and signed before the tracker existed, so the record goes
// straight to Approved -- no submit, no approval, no Purchase email -- and the
// uploaded PDF, never a redrawn one, stays its document (see qdDocument.cjs).
const qd = require('./qualityDiscrepancies.cjs');

const ORIGINAL_FORM = 'original_form';
const STATUS_REASON = 'Status at import';

// Mistakes the admin can fix; the route answers these with 400.
const importError = (message) => Object.assign(new Error(message), { clientError: true });
const str = (v) => String(v == null ? '' : v).trim();

function validateImport(body, { today }) {
  const b = body || {};
  const f = {
    qdNo: str(b.qdNo).toUpperCase(),
    raisedDate: str(b.raisedDate),
    supplier: str(b.supplier),
    dieNo: str(b.dieNo),
    plant: str(b.plant),
    issue: str(b.issue).replace(/\r\n/g, '\n'),
    recommendedAction: str(b.recommendedAction) || null,
    preparedBy: str(b.preparedBy) || null,
    authorizedBy: str(b.authorizedBy) || null,
    status: str(b.status) || 'Open',
    closedDate: null,
    etaDate: null,
    receivedDate: null,
  };
  if (!f.qdNo) throw importError('QD No is required');
  if (!f.dieNo) throw importError('Die No is required');
  if (!f.plant) throw importError('Plant is required');
  if (!f.supplier) throw importError('Supplier is required');
  if (!f.issue) throw importError('Quality issue is required');

  const date = (label, value, { notFuture = true } = {}) => {
    if (!value) throw importError(`${label} is required`);
    if (!qd.ISO_DATE.test(value)) throw importError(`${label} must be a date (YYYY-MM-DD)`);
    if (notFuture && value > today) throw importError(`${label} cannot be in the future`);
    return value;
  };
  date('Date raised', f.raisedDate);
  if (!qd.STATUSES.includes(f.status)) throw importError(`Invalid status: ${f.status}`);

  // Only the dates the chosen status asks for are kept, so a value left in a
  // hidden field can never be written against an unrelated status.
  if (qd.SETTLED_STATUSES.includes(f.status)) {
    f.closedDate = date('Closed date', str(b.closedDate));
    if (f.closedDate < f.raisedDate) throw importError('Closed date cannot be before the date raised');
  }
  if (f.status === 'FOC Accepted' || f.status === 'FOC Received') {
    // An ETA is the supplier's promise, so it may well be in the future.
    f.etaDate = date('ETA', str(b.etaDate), { notFuture: false });
  }
  if (f.status === 'FOC Received') {
    f.receivedDate = date('Received date', str(b.receivedDate));
    if (f.receivedDate < f.raisedDate) throw importError('Received date cannot be before the date raised');
  }
  return f;
}

async function qdNoExists(client, qdNo) {
  const { rowCount } = await client.query(
    'SELECT 1 FROM quality_discrepancies WHERE UPPER(qd_no) = UPPER($1) LIMIT 1', [str(qdNo)]);
  return rowCount > 0;
}

async function insertImportedQd(client, f, { actor, userId, fileName }) {
  if (await qdNoExists(client, f.qdNo)) throw importError(`QD ${f.qdNo} already exists in the register`);
  // The master's spelling, so contact_email lookups and the supplier rollup
  // treat this QD exactly like one raised in the app.
  const { rows: sup } = await client.query(
    'SELECT name FROM suppliers WHERE UPPER(name) = UPPER($1) LIMIT 1', [f.supplier]);
  if (!sup[0]) throw importError(`Unknown supplier "${f.supplier}" — add it under Settings → Suppliers first`);

  const id = await qd.createQD(client, {
    qdNo: f.qdNo,
    dieNo: f.dieNo,
    raisedDate: f.raisedDate,
    plant: f.plant,
    supplier: sup[0].name,
    status: 'Open',
    approvalState: 'Approved',
    issueSummary: f.issue.split('\n')[0].slice(0, 160),
    issueDetail: f.issue,
    recommendedAction: f.recommendedAction,
    preparedBy: f.preparedBy,
    // A settled QD keeps the paper's closed date: updateStatus below stamps
    // COALESCE(closed_at, CURRENT_DATE), so it does not overwrite it.
    closedAt: f.closedDate,
    createdBy: userId,
  });
  await client.query('UPDATE quality_discrepancies SET imported = TRUE WHERE id = $1', [id]);

  await qd.addActivity(client, {
    qdId: id, actor: f.preparedBy || actor, action: `raised QD against die ${f.dieNo}`,
    icon: 'flag', tone: 'flag', occurredAt: `${f.raisedDate} 00:00:00`,
  });
  // The authorizer need not be an app user, so the timeline is the one place
  // the name can be kept.
  await qd.addActivity(client, {
    qdId: id, actor,
    action: `imported from the original QD form ${fileName}${f.authorizedBy ? ` · Authorized by ${f.authorizedBy}` : ''}`,
    icon: 'check', tone: 'neutral', userId,
  });

  // Through the ordinary path, so the import obeys the same rules and FOC
  // round bookkeeping as any other status change. A receipt needs a round to
  // land on, so FOC Received is reached through FOC Accepted.
  const change = (status, extra) => qd.updateStatus(client, {
    id, status, reason: STATUS_REASON, actor, userId, ...extra,
  });
  if (f.status === 'FOC Received') {
    await change('FOC Accepted', { etaDate: f.etaDate });
    await change('FOC Received', { receivedDate: f.receivedDate });
  } else if (f.status !== 'Open') {
    await change(f.status, { etaDate: f.etaDate || undefined });
  }
  return id;
}

async function attachOriginal(client, { qdId, originalName, storedPath, mimeType, size, userId }) {
  await client.query(
    `INSERT INTO quality_discrepancy_files (qd_id, original_name, stored_path, mime_type, size_bytes, uploaded_by, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [qdId, originalName, storedPath, mimeType || 'application/pdf', size || null, userId || null, ORIGINAL_FORM]
  );
}

// Takes back a QD that came in through the importer, so a wrong import can be
// redone. It must never become a way to delete a QD raised in the app. Returns
// the stored paths so the caller can remove the files once this has committed.
async function deleteImportedQd(client, id) {
  const { rows } = await client.query('SELECT imported FROM quality_discrepancies WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw Object.assign(new Error('QD not found'), { notFound: true });
  if (!rows[0].imported) throw importError('Only an imported QD can be undone — this one was raised in the app');
  const files = await client.query('SELECT stored_path FROM quality_discrepancy_files WHERE qd_id = $1', [id]);
  // Activity, billets, files and FOC rounds all cascade.
  await client.query('DELETE FROM quality_discrepancies WHERE id = $1', [id]);
  return files.rows.map((r) => r.stored_path);
}

module.exports = { ORIGINAL_FORM, validateImport, qdNoExists, insertImportedQd, attachOriginal, deleteImportedQd };
