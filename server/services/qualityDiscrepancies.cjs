'use strict';
const { extractProfileFromDie } = require('./frozenDesigns.cjs');

const STATUSES = ['Open', 'Sent to Supplier', 'FOC Accepted', 'Rejected', 'Reference', 'Rework In-house', 'Closed'];
const OPEN_STATUSES = ['Open', 'Sent to Supplier', 'Rework In-house', 'Rejected'];
const OUTCOMES = ['Supplier rework', 'FOC replacement', 'In-house correction', 'Credit note', 'Reference only'];

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
    openCount: list.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    atSupplier: list.filter((r) => r.status === 'Sent to Supplier').length,
    focRecovered: list.filter((r) => r.status === 'FOC Accepted' && toDate(r.raised_date) >= fyStart).length,
    avgResolution: avgOrNull(resolutions),
  };
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

async function updateStatus(client, { id, status, actor, userId }) {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  // Closing stamps closed_at; reopening clears it so age/resolution stay honest.
  const { rowCount } = await client.query(
    `UPDATE quality_discrepancies
        SET status = $1,
            closed_at = CASE WHEN $1 IN ('Closed', 'FOC Accepted') THEN COALESCE(closed_at, CURRENT_DATE) ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [status, id]
  );
  if (!rowCount) return false;
  await addActivity(client, { qdId: id, actor, action: `changed status to ${status}`, icon: 'pencil', tone: 'neutral', userId });
  return true;
}

module.exports = {
  STATUSES, OPEN_STATUSES, OUTCOMES,
  mapSheetStatus, ageDays, resolutionDays, etaDisplay,
  computeKpis, computeTrend, summarizeSuppliers,
  listQDs, createQD, addActivity, updateStatus,
};
