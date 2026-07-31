'use strict';
const signature = require('./emailSignature.cjs');
const { extractProfileFromDie } = require('./frozenDesigns.cjs');
const focRounds = require('./qdFocRounds.cjs');

// 'FOC Received' sits between the supplier's promise and closure: the
// replacement is physically in the plant but has not been trialled, so the
// claim is neither outstanding nor settled. Without it a die sitting on the
// floor is indistinguishable from one still at the supplier.
const STATUSES = ['Open', 'Sent to Supplier', 'FOC Accepted', 'FOC Received', 'Rejected', 'Reference', 'Rework In-house', 'Closed'];

// A QD is open unless it has been settled: Closed (done), Rejected (claim
// refused) or Reference (logged for information only — the sheet's old "info").
// An accepted FOC is open, since the replacement is still to arrive; a received
// one is too, since it still has to prove itself on a trial.
// Derived from STATUSES so any status added later counts as open by default.
const NOT_OPEN_STATUSES = ['Closed', 'Rejected', 'Reference'];
const OPEN_STATUSES = STATUSES.filter((s) => !NOT_OPEN_STATUSES.includes(s));

// Statuses that conclude a QD and so stamp the settled date (closed_at).
// A rejection ends the claim just as a closure does, so it counts towards
// average resolution — otherwise rejections would sit in a blind spot,
// neither open nor resolved. Reference is excluded: it is logged for
// information and was never a claim to resolve.
const SETTLED_STATUSES = ['Closed', 'Rejected'];
const OUTCOMES = ['Supplier rework', 'FOC replacement', 'In-house correction', 'Credit note', 'Reference only'];

const APPROVAL_STATES = ['Draft', 'Pending', 'Approved', 'SentBack'];
const EDITABLE_APPROVAL_STATES = ['Draft', 'SentBack'];

// Legal approval transitions. Throwing here (rather than returning null) means
// an illegal action surfaces as a 400 at the route, not a silent no-op.
const APPROVAL_TRANSITIONS = {
  Draft:    { submit: 'Pending' },
  SentBack: { submit: 'Pending' },
  Pending:  { approve: 'Approved', sendBack: 'SentBack' },
};
function nextApprovalState(from, action) {
  const to = APPROVAL_TRANSITIONS[from] && APPROVAL_TRANSITIONS[from][action];
  if (!to) throw new Error(`Cannot ${action} a QD that is ${from}`);
  return to;
}

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

// How long each hand-off took. Null (never 0) when a date is missing, so an
// unrecorded step never looks like a same-day hand-off.
function handoffDelays(row) {
  const gap = (a, b) => {
    const from = toDate(a);
    const to = toDate(b);
    return from && to ? daysBetween(from, to) : null;
  };
  return {
    toPurchase: gap(row.raised_date, row.sent_to_purchase_date),
    purchaseToSupplier: gap(row.sent_to_purchase_date, row.sent_to_supplier_date),
    toSupplier: gap(row.raised_date, row.sent_to_supplier_date),
  };
}

function etaDisplay(row, now = new Date()) {
  if (!row.eta_date) return '—';
  const eta = String(row.eta_date).slice(0, 10);
  if (!row.closed_at && toDate(eta) < now) return 'Overdue';
  return eta;
}

const avgOrNull = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

// "Recovered" means the replacement arrived and passed its trial. This used to
// count QDs merely sitting on 'FOC Accepted', which reported the supplier's
// promises as though they were dies back in production.
function focRecoveredInFy(row, fyStart) {
  const f = row.foc;
  if (!f || f.state !== 'trial-passed' || !f.receivedDate) return false;
  return toDate(f.receivedDate) >= fyStart;
}

// A supplier has a FOC claim once a round exists. Rows loaded without their
// rounds fall back to the status, which after migration says the same thing.
const hasFocClaim = (r) => (r.foc
  ? r.foc.roundCount > 0
  : ['FOC Accepted', 'FOC Received'].includes(r.status));

function computeKpis(rows, now = new Date()) {
  const list = rows || [];
  const fyStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const resolutions = list.map(resolutionDays).filter((d) => d !== null);
  const pending = pendingFoc(list, now);
  return {
    total: list.length,
    openCount: list.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    closedCount: list.filter((r) => r.status === 'Closed').length,
    atSupplier: list.filter((r) => r.status === 'Sent to Supplier').length,
    focRecovered: list.filter((r) => focRecoveredInFy(r, fyStart)).length,
    focAwaitingReceipt: pending.awaitingReceipt.length,
    focOverdue: pending.overdueCount,
    focAwaitingTrial: pending.awaitingTrial.length,
    avgResolution: avgOrNull(resolutions),
  };
}

// The two things that can be pending against an accepted FOC. Settled QDs are
// excluded: a claim that was closed or rejected is nobody's to chase, whatever
// state its last round was left in.
function focPendingRow(r) {
  const f = r.foc;
  return {
    id: r.id,
    qd_no: r.qd_no,
    die_no: r.die_no,
    profile_number: r.profile_number,
    supplier: r.supplier,
    plant: r.plant,
    status: r.status,
    round_no: focRounds.latestRound(f.rounds)?.round_no ?? null,
    round_count: f.roundCount,
    promised_eta: f.promisedEta,
    received_date: f.receivedDate,
    days_overdue: f.daysOverdue,
    days_idle: f.daysIdle,
  };
}

// Rows with no ETA sort last rather than poisoning the comparison with NaN.
const overdueKey = (r) => (r.days_overdue == null ? -Infinity : r.days_overdue);

function pendingFoc(rows, now = new Date()) {
  const awaitingReceipt = [];
  const awaitingTrial = [];
  for (const r of rows || []) {
    if (!r.foc || NOT_OPEN_STATUSES.includes(r.status)) continue;
    if (r.foc.state === 'awaiting-receipt') awaitingReceipt.push(focPendingRow(r));
    else if (r.foc.state === 'awaiting-trial') awaitingTrial.push(focPendingRow(r));
  }
  awaitingReceipt.sort((a, b) => overdueKey(b) - overdueKey(a) || String(a.qd_no).localeCompare(String(b.qd_no)));
  awaitingTrial.sort((a, b) => (b.days_idle || 0) - (a.days_idle || 0) || String(a.qd_no).localeCompare(String(b.qd_no)));
  return {
    awaitingReceipt,
    awaitingTrial,
    overdueCount: awaitingReceipt.filter((r) => r.days_overdue > 0).length,
  };
}

// ── QD numbering: YYYY + supplier code + '-' + per-supplier sequence ────────
// e.g. the first PDTMC QD of 2026 is 2026PD-01, the second 2026PD-02.

// Default code for a supplier: its first two letters. Suppliers whose codes
// would collide (PHOENIX/PHME) carry an explicit qd_code instead.
function deriveQdCode(name) {
  const letters = String(name || '').replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 ? letters.slice(0, 2).toUpperCase() : null;
}

function formatQdNo(year, code, sequence) {
  return `${year}${String(code).toUpperCase()}-${String(sequence).padStart(2, '0')}`;
}

// Continue from the highest number already issued in this supplier-year series.
// Counting rows instead would re-issue a number after one was deleted.
function nextSequence(existingNumbers, year, code) {
  const prefix = `${year}${String(code).toUpperCase()}-`;
  let max = 0;
  for (const raw of existingNumbers || []) {
    const no = String(raw || '').toUpperCase();
    if (!no.startsWith(prefix)) continue;
    const n = parseInt(no.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
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
        foc: list.filter(hasFocClaim).length,
        rejected: list.filter((r) => r.status === 'Rejected').length,
        avg: avgOrNull(list.map(resolutionDays).filter((d) => d !== null)),
        trend: computeTrend(raised(recentFrom, now), raised(priorFrom, recentFrom)),
      };
    })
    .sort((a, b) => b.open - a.open || b.total - a.total || a.name.localeCompare(b.name));
}

// ── Billet parameters (Part-A "first billet"/"last billet" readings) ───────

const BILLETS = ['first', 'last'];
const BILLET_COLS = ['die_soaking_hours','die_temperature','billet_temp','breakthrough_pressure',
  'running_pressure','billet_length','alloy','ram_speed','any_delay_observed','any_delay_details'];

const hasAnyValue = (obj) => BILLET_COLS.some((c) => String(obj?.[c] ?? '').trim() !== '');

async function saveBilletParameters(client, qdId, params) {
  for (const billet of BILLETS) {
    const data = params?.[billet];
    if (!data || !hasAnyValue(data)) {
      await client.query('DELETE FROM qd_billet_parameters WHERE qd_id = $1 AND billet = $2', [qdId, billet]);
      continue;
    }
    const vals = BILLET_COLS.map((c) => String(data[c] ?? '').trim() || null);
    await client.query(
      `INSERT INTO qd_billet_parameters (qd_id, billet, ${BILLET_COLS.join(', ')})
       VALUES ($1, $2, ${BILLET_COLS.map((_, i) => `$${i + 3}`).join(', ')})
       ON CONFLICT (qd_id, billet) DO UPDATE SET
         ${BILLET_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      [qdId, billet, ...vals]);
  }
}

async function listBilletParameters(client, qdIds) {
  const map = new Map();
  if (!qdIds || !qdIds.length) return map;
  const { rows } = await client.query(
    `SELECT * FROM qd_billet_parameters WHERE qd_id = ANY($1)`, [qdIds]);
  for (const r of rows) {
    if (!map.has(r.qd_id)) map.set(r.qd_id, []);
    map.get(r.qd_id).push(r);
  }
  return map;
}

async function listQDs(client) {
  const { rows } = await client.query(
    `SELECT * FROM quality_discrepancies ORDER BY raised_date DESC, id DESC`
  );
  const ids = rows.map((r) => r.id);
  let files = [];
  let activity = [];
  let billets = new Map();
  let rounds = new Map();
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
    billets = await listBilletParameters(client, ids);
    rounds = await focRounds.listRounds(client, ids);
  }
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    age_days: ageDays(r, now),
    resolution_days: resolutionDays(r),
    eta_display: etaDisplay(r, now),
    handoff: handoffDelays(r),
    foc: focRounds.focSummary(rounds.get(r.id) || [], now),
    files: files.filter((f) => f.qd_id === r.id),
    activity: activity.filter((a) => a.qd_id === r.id),
    billets: billets.get(r.id) || [],
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
    approvalState, preparedBy,
    dieReceivedDate, press, dieType, dieSize, noOfCavity, tooling, noOfTrials, noOfCorrections,
    productionDate, manufacturingDefect, diePerformance, recommendedAction, qdRequestedDate,
  } = input;
  const { rows } = await client.query(
    `INSERT INTO quality_discrepancies
       (qd_no, die_no, profile_number, die_order_id, raised_date, plant, supplier, corrector,
        status, outcome, issue_summary, issue_detail, eta_date, input_at_failure, closed_at,
        created_by, approval_state, prepared_by,
        die_received_date, press, die_type, die_size, no_of_cavity, tooling, no_of_trials,
        no_of_corrections, production_date, manufacturing_defect, die_performance, recommended_action,
        qd_requested_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
     RETURNING id`,
    [
      qdNo || null, dieNo, extractProfileFromDie(dieNo), dieOrderId || null, raisedDate, plant, supplier,
      corrector || null, status || 'Open', outcome || null, issueSummary, issueDetail || null,
      etaDate || null, inputAtFailure || null, closedAt || null, createdBy || null,
      approvalState || 'Draft', preparedBy || null,
      dieReceivedDate || null, press || null, dieType || null, dieSize || null, noOfCavity || null,
      tooling || null, noOfTrials || null, noOfCorrections || null, productionDate || null,
      manufacturingDefect || null, diePerformance || null, recommendedAction || null,
      qdRequestedDate || null,
    ]
  );
  return rows[0].id;
}

// Fields the drawer can edit after a QD is raised. Status has its own path
// (it stamps closed_at), and everything else — qd_no, die_no, dates — is either
// identity or derived, so it is deliberately not editable here.
const YES_NO = ['Yes', 'No'];

// `progress: true` marks a field that only becomes knowable after the QD has
// been approved and sent out — the supplier's reply, the hand-off dates, the
// ETA they gave. Those must stay editable for the QD's whole life.
//
// Everything else is Part-A: the description of the discrepancy as it was
// raised, which is printed on the form that goes to Purchase on approval. Once
// that document exists, its contents must not move underneath it, so these lock
// exactly as editQdDetails locks them. A new field with no `progress` flag is
// treated as Part-A, which is the safe default.
const EDITABLE_FIELDS = {
  outcome: { label: 'Outcome sought', progress: false },
  input_at_failure: { label: 'Input at failure', progress: false },
  eta_date: { label: 'ETA from supplier', isDate: true, progress: true },
  sent_to_purchase_date: { label: 'Sent to purchase', isDate: true, progress: true },
  sent_to_supplier_date: { label: 'Sent to supplier', isDate: true, progress: true },
  corrector: { label: 'Corrector', progress: false },
  recommended_action:   { label: 'Recommended action', progress: false },
  manufacturing_defect: { label: 'Manufacturing defect', oneOf: YES_NO, progress: false },
  die_performance:      { label: 'Die performance', oneOf: YES_NO, progress: false },
  supplier_acceptance:  { label: 'Supplier acceptance', oneOf: YES_NO, progress: true },
  action_taken:         { label: 'Action taken', progress: true },
  supplier_comments:    { label: 'Supplier comments', progress: true },
  received_by_supplier: { label: 'Received by (supplier)', progress: true },
  press:                { label: 'Press', progress: false },
  die_type:             { label: 'Die type', progress: false },
  die_size:             { label: 'Die size', progress: false },
  no_of_cavity:         { label: 'No of cavity', progress: false },
  tooling:              { label: 'Tooling', progress: false },
  no_of_trials:         { label: 'No of trials', progress: false },
  no_of_corrections:    { label: 'No of corrections', progress: false },
  qd_requested_date:    { label: 'QD requested date', isDate: true, required: true, progress: false },
  die_received_date:    { label: 'Die received date', progress: false },
  production_date:      { label: 'Production date', progress: false },
};

const isProgressField = (column) => EDITABLE_FIELDS[column]?.progress === true;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeField(column, raw) {
  const value = raw == null ? '' : String(raw).trim();
  const spec = EDITABLE_FIELDS[column];
  if (!value) {
    // A required field must not be cleared. The raise form insists on it, so
    // neither edit path may become a back door to emptying it.
    if (spec?.required) throw new Error(`Invalid ${spec.label}: a value is required`);
    return null; // empty clears the field
  }
  if (column === 'outcome' && !OUTCOMES.includes(value)) {
    throw new Error(`Invalid outcome: ${value}`);
  }
  if (spec?.oneOf && !spec.oneOf.includes(value)) {
    throw new Error(`Invalid ${spec.label}: ${value} (expected ${spec.oneOf.join(' or ')})`);
  }
  if (spec?.isDate && !ISO_DATE.test(value)) {
    const what = column === 'eta_date' ? 'ETA date' : spec.label;
    throw new Error(`Invalid ${what}: ${value} (expected YYYY-MM-DD)`);
  }
  return value;
}

async function updateFields(client, { id, fields, actor, userId }) {
  const entries = Object.entries(fields || {}).filter(([k]) => EDITABLE_FIELDS[k]);
  if (entries.length === 0) return false;

  // Checked before anything is validated or written, so a payload that mixes
  // locked and progress fields is refused whole rather than half-applied.
  if (entries.some(([column]) => !isProgressField(column))) {
    const row = await getApprovalRow(client, id);
    if (!row) return false;
    if (!EDITABLE_APPROVAL_STATES.includes(row.approval_state)) {
      throw new Error(`Cannot edit a QD in ${row.approval_state} state`);
    }
  }

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

// Columns the full "Edit QD" form may write. A superset of the fact-card path:
// it adds the identity-ish Part-A fields (discrepancy text, supplier, profile,
// plant) that the raise form captures. qd_no, die_no and raised_date stay out —
// they are identity/derived. Editing is gated to Draft/SentBack in editQdDetails.
const EXTRA_EDIT_LABELS = {
  issue_detail: 'Discrepancy', profile_number: 'Profile number', supplier: 'Supplier', plant: 'Plant',
};
const EDIT_DETAIL_COLUMNS = new Set([
  ...Object.keys(EDITABLE_FIELDS), ...Object.keys(EXTRA_EDIT_LABELS),
]);
const editDetailLabel = (col) => EDITABLE_FIELDS[col]?.label || EXTRA_EDIT_LABELS[col] || col;

// Bulk edit of a QD's Part-A / discrepancy fields and billet readings. Allowed
// only while the QD is a Draft or has been sent back — an approved (or
// in-review) record must not shift under the approver. Validation reuses
// normalizeField, so dates and Yes/No fields are checked exactly as the
// fact-card path checks them. Returns false if the QD is gone or nothing changed.
async function editQdDetails(client, { id, fields = {}, billets, actor, userId }) {
  const row = await getApprovalRow(client, id);
  if (!row) return false;
  if (!EDITABLE_APPROVAL_STATES.includes(row.approval_state)) {
    throw new Error(`Cannot edit a QD in ${row.approval_state} state`);
  }
  const changes = [];
  const entries = Object.entries(fields).filter(([k]) => EDIT_DETAIL_COLUMNS.has(k));
  if (entries.length) {
    const sets = [];
    const params = [];
    for (const [column, raw] of entries) {
      const value = normalizeField(column, raw);
      params.push(value);
      sets.push(`${column} = $${params.length}`);
      changes.push(value === null ? `cleared ${editDetailLabel(column)}` : `set ${editDetailLabel(column)}`);
    }
    params.push(id);
    await client.query(
      `UPDATE quality_discrepancies SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${params.length}`,
      params
    );
  }
  if (billets !== undefined) {
    await saveBilletParameters(client, id, billets);
    changes.push('updated production parameters');
  }
  if (!changes.length) return false;
  await addActivity(client, {
    qdId: id, actor, action: `edited the QD — ${changes.join(', ')}`, icon: 'pencil', tone: 'neutral', userId,
  });
  return true;
}

// Tone the timeline dot by where the status lands, so the history reads at a glance.
const STATUS_TONE = {
  'FOC Accepted': 'good',
  'FOC Received': 'good',
  'Closed': 'good',
  'Rejected': 'bad',
  'Sent to Supplier': 'send',
};

async function updateStatus(client, { id, status, reason, etaDate, receivedDate, actor, userId }) {
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

  // Same bargain on the other side: the point of this status is the arrival
  // date, so it cannot be set without one.
  const received = String(receivedDate == null ? '' : receivedDate).trim();
  if (status === 'FOC Received' && !received) {
    throw new Error('Received date is required when the status is FOC Received');
  }
  if (received && !ISO_DATE.test(received)) {
    throw new Error(`Invalid received date: ${received} (expected YYYY-MM-DD)`);
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
            closed_at = CASE WHEN $1 IN ('Closed', 'Rejected') THEN COALESCE(closed_at, CURRENT_DATE) ELSE NULL END${etaSql},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    params
  );
  if (!rowCount) return false;

  // The round table is the record of what was promised and what turned up.
  // These throw on an impossible move (a receipt against no promise), which
  // rolls the whole transaction back — the status change goes with it.
  let detail = eta ? ` · ETA ${eta}` : '';
  if (status === 'FOC Accepted') {
    const { roundNo, revised } = await focRounds.openFocRound(client, { qdId: id, promisedEta: eta });
    detail = `${revised ? ' · revised ETA' : ` · FOC round ${roundNo}, ETA`} ${eta}`;
  }
  if (status === 'FOC Received') {
    const { roundNo } = await focRounds.recordReceipt(client, {
      qdId: id, receivedDate: received, receivedBy: userId || null,
    });
    detail = ` · FOC round ${roundNo} received ${received}`;
  }

  await addActivity(client, {
    qdId: id,
    actor,
    action: `changed status to ${status} — ${why}${detail}`,
    icon: 'pencil',
    tone: STATUS_TONE[status] || 'neutral',
    userId,
  });
  return true;
}

// Recording the trial verdict. The round closes here; the QD's next status is a
// separate, deliberate decision by the user (see the route), because a failed
// trial can mean going back to the supplier, reworking in-house, or giving up.
async function recordFocTrial(client, { id, trialDate, result, notes, actor, userId }) {
  const { rowCount } = await client.query('SELECT 1 FROM quality_discrepancies WHERE id = $1', [id]);
  if (!rowCount) return false;
  const { roundNo } = await focRounds.recordTrial(client, {
    qdId: id, trialDate, result, notes,
  });
  const why = String(notes || '').trim();
  await addActivity(client, {
    qdId: id,
    actor,
    action: `FOC round ${roundNo} trialled ${trialDate} — ${result}${why ? ` — ${why}` : ''}`,
    icon: result === 'Pass' ? 'check' : 'undo',
    tone: result === 'Pass' ? 'good' : 'bad',
    userId,
  });
  return true;
}

async function getApprovalRow(client, id) {
  const { rows } = await client.query(
    `SELECT id, qd_no, approval_state, supplier, assigned_approver, created_by
       FROM quality_discrepancies WHERE id = $1`, [id]);
  return rows[0] || null;
}

// `approverUserId` is the approver the raiser is sending this QD to. The route
// checks they are actually eligible; resubmitting a sent-back QD may name a
// different one, so this always overwrites rather than coalescing.
async function submitForApproval(client, { id, newQdNo, actor, userId, approverUserId = null, approverName = '' }) {
  const row = await getApprovalRow(client, id);
  if (!row) return { ok: false };
  const to = nextApprovalState(row.approval_state, 'submit');
  const qdNo = row.qd_no || newQdNo;
  if (!qdNo) throw new Error('A QD number is required to submit');
  await client.query(
    `UPDATE quality_discrepancies
        SET qd_no = $1, approval_state = $2, submitted_by = $3, assigned_approver = $4,
            submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5`,
    [qdNo, to, userId || null, approverUserId, id]);
  const to_whom = approverName ? ` to ${approverName}` : '';
  await addActivity(client, { qdId: id, actor, action: `submitted QD ${qdNo} for approval${to_whom}`, icon: 'send', tone: 'send', userId });
  return { ok: true, qdNo, state: to };
}

// Who may act on this QD's approval. Anyone in the approver list can act on a
// QD that names nobody (QDs submitted before assignment existed), but once the
// raiser has sent it to a named approver only they — or an admin, who must be
// able to unblock an absent approver — can approve or send it back.
function canActOnApproval(user, row) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!row?.assigned_approver) return true;
  return row.assigned_approver === user.id;
}

// The approver's personal queue: Pending QDs that are theirs to pick up.
//
// Deliberately NOT canActOnApproval(). That returns true for any admin on any
// QD — right for permissions, wrong for a work list. An admin's power to act on
// someone else's QD is an escape hatch for an absent approver, not a daily
// inbox. A QD with no assigned approver predates assignment and is open to any
// approver, so it sits in everyone's queue until someone acts on it.
function isInApprovalQueue(row, userId) {
  if (!row || row.approval_state !== 'Pending') return false;
  if (row.assigned_approver == null) return true;
  return row.assigned_approver === userId;
}

// Pending rows are fetched and then filtered in JS rather than in SQL so the
// rule above is one testable function instead of a WHERE clause nobody can
// unit-test. There are only ever a handful of Pending QDs.
async function listPendingApprovals(client, userId) {
  const { rows } = await client.query(
    `SELECT id, qd_no, die_no, supplier, plant, submitted_at, prepared_by,
            approval_state, assigned_approver
       FROM quality_discrepancies
      WHERE approval_state = 'Pending'
      ORDER BY submitted_at DESC NULLS LAST, id DESC`
  );
  return rows.filter((r) => isInApprovalQueue(r, userId));
}

async function approveQD(client, { id, actor, userId }) {
  const row = await getApprovalRow(client, id);
  if (!row) return { ok: false };
  nextApprovalState(row.approval_state, 'approve');
  await client.query(
    `UPDATE quality_discrepancies
        SET approval_state = 'Approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP,
            sent_to_purchase_date = COALESCE(sent_to_purchase_date, CURRENT_DATE),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [userId || null, id]);
  await addActivity(client, { qdId: id, actor, action: `approved QD ${row.qd_no}`, icon: 'check', tone: 'good', userId });
  return { ok: true, qdNo: row.qd_no };
}

async function sendBack(client, { id, reason, actor, userId }) {
  const why = String(reason == null ? '' : reason).trim();
  if (!why) throw new Error('Reason is required to send a QD back');
  const row = await getApprovalRow(client, id);
  if (!row) return { ok: false };
  nextApprovalState(row.approval_state, 'sendBack');
  await client.query(
    `UPDATE quality_discrepancies
        SET approval_state = 'SentBack', sent_back_reason = $1,
            sent_back_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [why, id]);
  await addActivity(client, { qdId: id, actor, action: `sent QD back — ${why}`, icon: 'undo', tone: 'bad', userId });
  return { ok: true };
}

const excludeDrafts = (rows) => (rows || []).filter((r) => r.approval_state !== 'Draft');
const onlyDrafts = (rows, userId) => (rows || []).filter(
  (r) => r.approval_state === 'Draft' && (userId == null || r.created_by === userId));

// ── Purchase email builders ────────────────────────────────────────────────

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function purchaseEmailSubject(qd) {
  return `QD ${qd.qd_no} approved — action required`;
}

// `sender` is the approver whose action sent this — the mail is from a person,
// so it signs as them (falling back to the department when their account has
// no name or contact details on file).
function buildPurchaseEmailHtml(qd, sender) {
  const row = (k, v) => `<tr><td style="padding:3px 10px;color:#555">${k}</td>` +
    `<td style="padding:3px 10px"><b>${escapeHtml(v) || '—'}</b></td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
    <h2 style="margin:0 0 6px">Quality Discrepancy ${escapeHtml(qd.qd_no)}</h2>
    <p>This QD has been approved and is handed over to Purchase for further processing.</p>
    <table style="border-collapse:collapse;margin:8px 0">
      ${row('QD No', qd.qd_no)}${row('Die No', qd.die_no)}${row('Profile', qd.profile_number)}
      ${row('Supplier', qd.supplier)}${row('Raised', qd.raised_date)}
      ${row('Recommended action', qd.recommended_action || qd.outcome)}
    </table>
    <p style="white-space:pre-wrap">${escapeHtml(qd.issue_detail || qd.issue_summary)}</p>
    ${signature.userSignature(sender)}
  </div>`;
}

// Sent back to the raiser. Unlike the Purchase mail this goes to one person and
// carries no PDF: the QD is unfinished, and the point is to get them back into
// the app to fix it.
function sendBackEmailSubject(qd) {
  return `QD ${qd.qd_no} sent back — changes needed`;
}

function buildSendBackEmailHtml(qd, { reason, by, sender } = {}) {
  const row = (k, v) => `<tr><td style="padding:3px 10px;color:#555">${k}</td>` +
    `<td style="padding:3px 10px"><b>${escapeHtml(v) || '—'}</b></td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
    <h2 style="margin:0 0 6px">Quality Discrepancy ${escapeHtml(qd.qd_no)} was sent back</h2>
    <p>${escapeHtml(by) || 'The approver'} has returned this QD to you for changes. It is not approved and has not gone to Purchase.</p>
    <table style="border-collapse:collapse;margin:8px 0">
      ${row('QD No', qd.qd_no)}${row('Die No', qd.die_no)}${row('Supplier', qd.supplier)}
      ${row('Sent back by', by)}
    </table>
    <p style="margin:12px 0 4px;color:#555">Reason given:</p>
    <blockquote style="margin:0;padding:8px 12px;border-left:3px solid #EF4444;background:#FEF2F2;white-space:pre-wrap">${escapeHtml(reason)}</blockquote>
    <p style="margin-top:14px">Open the QD Tracker, edit the QD, and resubmit it for approval.</p>
    ${signature.userSignature(sender)}
  </div>`;
}

module.exports = {
  STATUSES, OPEN_STATUSES, NOT_OPEN_STATUSES, SETTLED_STATUSES, OUTCOMES, ACTIVITY_KINDS, EDITABLE_FIELDS, ISO_DATE,
  mapSheetStatus, ageDays, resolutionDays, etaDisplay, handoffDelays,
  computeKpis, computeTrend, summarizeSuppliers, availableYears, filterByYear,
  pendingFoc, focRecoveredInFy, hasFocClaim, TRIAL_RESULTS: focRounds.TRIAL_RESULTS,
  deriveQdCode, formatQdNo, nextSequence,
  listQDs, createQD, addActivity, addActivityOfKind, updateStatus, recordFocTrial, updateFields, editQdDetails,
  APPROVAL_STATES, EDITABLE_APPROVAL_STATES, nextApprovalState, getApprovalRow,
  submitForApproval, approveQD, sendBack, canActOnApproval, excludeDrafts, onlyDrafts,
  isInApprovalQueue, listPendingApprovals,
  purchaseEmailSubject, buildPurchaseEmailHtml,
  sendBackEmailSubject, buildSendBackEmailHtml,
  BILLETS, saveBilletParameters, listBilletParameters,
};
