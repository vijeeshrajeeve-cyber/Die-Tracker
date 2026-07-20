'use strict';
const { extractProfileFromDie } = require('./frozenDesigns.cjs');

const STATUSES = ['Open', 'Sent to Supplier', 'FOC Accepted', 'Rejected', 'Reference', 'Rework In-house', 'Closed'];

// A QD is open unless it has been settled: Closed (done), Rejected (claim
// refused) or Reference (logged for information only — the sheet's old "info").
// An accepted FOC is open, since the replacement is still to arrive.
// Derived from STATUSES so any status added later counts as open by default.
const NOT_OPEN_STATUSES = ['Closed', 'Rejected', 'Reference'];
const OPEN_STATUSES = STATUSES.filter((s) => !NOT_OPEN_STATUSES.includes(s));
const OUTCOMES = ['Supplier rework', 'FOC replacement', 'In-house correction', 'Credit note', 'Reference only'];

// Timeline entry kinds. The icon/tone are decided here rather than by the
// client so the timeline vocabulary stays consistent (and unspoofable).
const ACTIVITY_KINDS = {
  note: { icon: 'message-square', tone: 'neutral' },
  email: { icon: 'send', tone: 'send' },
  reminder: { icon: 'bell', tone: 'send' },
};

// The legacy Excel sheet used a looser vocabulary (including the 'Refrance'
// typo). Map it onto the 7 canonical statuses; unknown values fall back to Open.
const SHEET_STATUS_MAP = {
  open: 'Open',
  rejected: 'Rejected',
  refrance: 'Reference',
  reference: 'Reference',
  info: 'Reference',
  completed: 'Closed',
  closed: 'Closed',
  hold: 'Open',
};

function mapSheetStatus(raw) {
  return SHEET_STATUS_MAP[String(raw || '').trim().toLowerCase()] || 'Open';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : null);
const daysBetween = (a, b) => Math.max(0, Math.round((b - a) / DAY_MS));

function ageDays(row, now = new Date()) {
  if (row.closed_at) return 0;
  const raised = toDate(row.raised_date);
  return raised ? daysBetween(raised, now) : 0;
}

function resolutionDays(row) {
  const raised = toDate(row.raised_date);
  const closed = toDate(row.closed_at);
  if (!raised || !closed) return null;
  return daysBetween(raised, closed);
}

function etaDisplay(row, now = new Date()) {
  if (!row.eta_date) return '—';
  const eta = String(row.eta_date).slice(0, 10);
  if (!row.closed_at && toDate(eta) < now) return 'Overdue';
  return eta;
}

const avgOrNull = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

function computeKpis(rows, now = new Date()) {
  const list = rows || [];
  const fyStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const resolutions = list.map(resolutionDays).filter((d) => d !== null);
  return {
    total: list.length,
    openCount: list.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    closedCount: list.filter((r) => r.status === 'Closed').length,
    atSupplier: list.filter((r) => r.status === 'Sent to Supplier').length,
    focRecovered: list.filter((r) => r.status === 'FOC Accepted' && toDate(r.raised_date) >= fyStart).length,
    avgResolution: avgOrNull(resolutions),
  };
}

const yearOf = (row) => {
  const d = toDate(row.raised_date);
  return d ? d.getUTCFullYear() : null;
};

function availableYears(rows) {
  const years = new Set();
  for (const r of rows || []) {
    const y = yearOf(r);
    if (y) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

// Anything that is not a real year ('All', undefined, junk) means "no scoping".
function filterByYear(rows, year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1900) return rows || [];
  return (rows || []).filter((r) => yearOf(r) === y);
}

function computeTrend(recent, prior) {
  if (recent > prior) return 'up';
  if (recent < prior) return 'down';
  return 'flat';
}

// Per-supplier rollup. Trend compares QDs raised in the last 90 days against
// the 90 days before that — a real signal, unlike the prototype's fixed arrows.
function summarizeSuppliers(rows, now = new Date()) {
  const WINDOW = 90 * DAY_MS;
  const recentFrom = new Date(now - WINDOW);
  const priorFrom = new Date(now - 2 * WINDOW);
  const byName = new Map();
  for (const r of rows || []) {
    if (!r.supplier) continue;
    if (!byName.has(r.supplier)) byName.set(r.supplier, []);
    byName.get(r.supplier).push(r);
  }
  return Array.from(byName.entries())
    .map(([name, list]) => {
      const raised = (from, to) => list.filter((r) => {
        const d = toDate(r.raised_date);
        return d && d >= from && d < to;
      }).length;
      return {
        name,
        total: list.length,
        open: list.filter((r) => OPEN_STATUSES.includes(r.status)).length,
        foc: list.filter((r) => r.status === 'FOC Accepted').length,
        rejected: list.filter((r) => r.status === 'Rejected').length,
        avg: avgOrNull(list.map(resolutionDays).filter((d) => d !== null)),
        trend: computeTrend(raised(recentFrom, now), raised(priorFrom, recentFrom)),
      };
    })
    .sort((a, b) => b.open - a.open || b.total - a.total || a.name.localeCompare(b.name));
}

async function listQDs(client) {
  const { rows } = await client.query(
    `SELECT * FROM quality_discrepancies ORDER BY raised_date DESC, id DESC`
  );
  const ids = rows.map((r) => r.id);
  let files = [];
  let activity = [];
  if (ids.length) {
    files = (await client.query(
      `SELECT id, qd_id, original_name, mime_type, size_bytes, uploaded_at
         FROM quality_discrepancy_files WHERE qd_id = ANY($1) ORDER BY uploaded_at ASC`,
      [ids]
    )).rows;
    activity = (await client.query(
      `SELECT id, qd_id, actor, action, icon, tone, occurred_at
         FROM quality_discrepancy_activity WHERE qd_id = ANY($1) ORDER BY occurred_at ASC, id ASC`,
      [ids]
    )).rows;
  }
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    age_days: ageDays(r, now),
    resolution_days: resolutionDays(r),
    eta_display: etaDisplay(r, now),
    files: files.filter((f) => f.qd_id === r.id),
    activity: activity.filter((a) => a.qd_id === r.id),
  }));
}

async function addActivity(client, { qdId, actor, action, icon, tone, userId, occurredAt }) {
  await client.query(
    `INSERT INTO quality_discrepancy_activity (qd_id, actor, action, icon, tone, user_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_TIMESTAMP))`,
    [qdId, actor, action, icon || null, tone || null, userId || null, occurredAt || null]
  );
}

async function addActivityOfKind(client, { qdId, kind, actor, note, userId }) {
  const spec = ACTIVITY_KINDS[kind];
  if (!spec) throw new Error(`Invalid activity kind: ${kind}`);
  await addActivity(client, { qdId, actor, action: note, icon: spec.icon, tone: spec.tone, userId });
}

async function createQD(client, input) {
  const {
    qdNo, dieNo, raisedDate, plant, supplier, corrector, status, outcome,
    issueSummary, issueDetail, etaDate, inputAtFailure, closedAt, createdBy, dieOrderId,
  } = input;
  const { rows } = await client.query(
    `INSERT INTO quality_discrepancies
       (qd_no, die_no, profile_number, die_order_id, raised_date, plant, supplier, corrector,
        status, outcome, issue_summary, issue_detail, eta_date, input_at_failure, closed_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      qdNo, dieNo, extractProfileFromDie(dieNo), dieOrderId || null, raisedDate, plant, supplier,
      corrector || null, status || 'Open', outcome || null, issueSummary, issueDetail || null,
      etaDate || null, inputAtFailure || null, closedAt || null, createdBy || null,
    ]
  );
  return rows[0].id;
}

// Fields the drawer can edit after a QD is raised. Status has its own path
// (it stamps closed_at), and everything else — qd_no, die_no, dates — is either
// identity or derived, so it is deliberately not editable here.
const EDITABLE_FIELDS = {
  outcome: { label: 'Outcome sought' },
  input_at_failure: { label: 'Input at failure' },
  eta_date: { label: 'ETA from supplier' },
  corrector: { label: 'Corrector' },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeField(column, raw) {
  const value = raw == null ? '' : String(raw).trim();
  if (!value) return null; // empty clears the field
  if (column === 'outcome' && !OUTCOMES.includes(value)) {
    throw new Error(`Invalid outcome: ${value}`);
  }
  if (column === 'eta_date' && !ISO_DATE.test(value)) {
    throw new Error(`Invalid ETA date: ${value} (expected YYYY-MM-DD)`);
  }
  return value;
}

async function updateFields(client, { id, fields, actor, userId }) {
  const entries = Object.entries(fields || {}).filter(([k]) => EDITABLE_FIELDS[k]);
  if (entries.length === 0) return false;

  const sets = [];
  const params = [];
  const changes = [];
  for (const [column, raw] of entries) {
    const value = normalizeField(column, raw);
    params.push(value);
    sets.push(`${column} = $${params.length}`);
    changes.push(value === null
      ? `cleared ${EDITABLE_FIELDS[column].label}`
      : `set ${EDITABLE_FIELDS[column].label} to ${value}`);
  }
  params.push(id);
  const { rowCount } = await client.query(
    `UPDATE quality_discrepancies SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${params.length}`,
    params
  );
  if (!rowCount) return false;
  await addActivity(client, {
    qdId: id, actor, action: changes.join(' · '), icon: 'pencil', tone: 'neutral', userId,
  });
  return true;
}

// Tone the timeline dot by where the status lands, so the history reads at a glance.
const STATUS_TONE = {
  'FOC Accepted': 'good',
  'Closed': 'good',
  'Rejected': 'bad',
  'Sent to Supplier': 'send',
};

async function updateStatus(client, { id, status, reason, etaDate, actor, userId }) {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  const why = String(reason == null ? '' : reason).trim();
  if (!why) throw new Error('Reason is required for a status change');

  // Accepting a FOC means the supplier committed to a replacement — we need to
  // know when it lands, so the ETA is mandatory here.
  const eta = String(etaDate == null ? '' : etaDate).trim();
  if (status === 'FOC Accepted' && !eta) {
    throw new Error('ETA is required when the status is FOC Accepted');
  }
  if (eta && !ISO_DATE.test(eta)) {
    throw new Error(`Invalid ETA date: ${eta} (expected YYYY-MM-DD)`);
  }

  // Only 'Closed' stamps closed_at. An accepted FOC is still in flight —
  // treating it as closed would zero the age and skew avg resolution.
  const params = [status, id];
  let etaSql = '';
  if (eta) {
    params.push(eta);
    etaSql = `, eta_date = $${params.length}`;
  }
  const { rowCount } = await client.query(
    `UPDATE quality_discrepancies
        SET status = $1,
            closed_at = CASE WHEN $1 = 'Closed' THEN COALESCE(closed_at, CURRENT_DATE) ELSE NULL END${etaSql},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    params
  );
  if (!rowCount) return false;

  await addActivity(client, {
    qdId: id,
    actor,
    action: `changed status to ${status} — ${why}${eta ? ` · ETA ${eta}` : ''}`,
    icon: 'pencil',
    tone: STATUS_TONE[status] || 'neutral',
    userId,
  });
  return true;
}

module.exports = {
  STATUSES, OPEN_STATUSES, NOT_OPEN_STATUSES, OUTCOMES, ACTIVITY_KINDS, EDITABLE_FIELDS,
  mapSheetStatus, ageDays, resolutionDays, etaDisplay,
  computeKpis, computeTrend, summarizeSuppliers, availableYears, filterByYear,
  listQDs, createQD, addActivity, addActivityOfKind, updateStatus, updateFields,
};
