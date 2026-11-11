'use strict';
// Pure decision logic for the one-time Sample Followup Excel backfill.
// Driven by server/scripts/import-sample-followup-sheet.cjs.
// Design: docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md

// Logical name → header text in the 'Sample Followup' sheet.
const COLUMNS = {
  die: 'Die',
  plant: 'Plant',
  supplier: 'Supplier',
  received: 'Die Received Date',
  submission: 'Submission Date',
  approval: 'Sample Approval Date',
  trials: 'No. of Trial',
  corrector: 'Corrector',
};

// Other spellings of the same headers. A misread header would look exactly
// like a column of blank cells and silently import nothing.
const COLUMN_ALIASES = {
  die: ['Die No', 'Die No.', 'Die Number'],
  submission: ['Sample Submission Date', 'Sample Submission'],
  approval: ['Sample Approval', 'Approval Date'],
  trials: ['No of Trial', 'No. of Trials', 'No of Trials', 'Number of Trial', 'Number of Trials'],
  corrector: ['Corrector Name', 'Corrector Names'],
};

// Columns the import needs. Plant, supplier and received date are not here:
// they are cross-checks at most.
const REQUIRED_COLUMNS = ['die', 'submission', 'approval', 'trials', 'corrector'];

// No of Trial ceiling, matching the validator in server/routes/orders.cjs.
const MAX_TRIALS = 1000;

// Sheet headers sometimes carry stray trailing spaces (the QD sheet did).
function readCell(row, name) {
  if (row[name] !== undefined) return row[name];
  const wanted = name.toLowerCase();
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === wanted);
  return key === undefined ? '' : row[key];
}

function headersFor(key) {
  return [COLUMNS[key], ...(COLUMN_ALIASES[key] || [])];
}

function readColumn(row, key) {
  for (const header of headersFor(key)) {
    const value = readCell(row, header);
    if (value !== '') return value;
  }
  return '';
}

// Which required columns does the sheet not have at all?
function checkColumns(rows) {
  const headers = new Set();
  for (const row of rows || []) {
    for (const k of Object.keys(row)) headers.add(k.trim().toLowerCase());
  }
  const missing = REQUIRED_COLUMNS
    .filter((key) => !headersFor(key).some((h) => headers.has(h.toLowerCase())))
    .map((key) => COLUMNS[key]);
  return { missing };
}

function normalizeDieNo(v) {
  return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(v) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

// Guards against well-formed but impossible dates like '2026-13-45'.
function isValidYmd(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

// Excel serial (1900 system) or typed text → 'YYYY-MM-DD'. Blank/garbage → null.
function parseSheetDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(Math.round((n - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) {
    const ymd = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidYmd(ymd) ? ymd : null;
  }

  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const ymd = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return isValidYmd(ymd) ? ymd : null;
  }

  return null;
}

function parseTrialCount(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const r = Math.trunc(n);
  return r < 0 || r > MAX_TRIALS ? null : r;
}

// Statuses this import is allowed to move between. Anything else on an order
// (Rejected, On hold) is a person's judgement — never overwrite it.
const STATUS_RANK = { '': 0, 'PENDING': 0, 'SAMPLE SUBMITTED': 1, 'APPROVED': 2 };

function isCancelled(o) {
  return String(o.status == null ? '' : o.status).trim().toUpperCase() === 'CANCELLED';
}

// Which die order does a sheet row belong to? Cancelled orders never win:
// a cancelled re-order shares its die number with the live order that the
// sample data actually describes.
function selectOrder(candidates) {
  const list = candidates || [];
  if (list.length === 0) return { reason: 'not-found', order: null, candidates: [] };

  const live = list.filter((o) => !isCancelled(o));
  if (live.length === 0) return { reason: 'all-cancelled', order: null, candidates: list };
  if (live.length > 1) return { reason: 'ambiguous', order: null, candidates: live };
  return { reason: 'matched', order: live[0], candidates: live };
}

// The sheet has no status column, so derive one from the dates. Upgrade-only:
// returns null whenever the existing status should stand.
function deriveSampleStatus({ approvalDate, submissionDate, currentStatus }) {
  const derived = approvalDate ? 'Approved' : (submissionDate ? 'Sample Submitted' : null);
  if (!derived) return null;

  const current = String(currentStatus == null ? '' : currentStatus).trim().toUpperCase();
  const currentRank = STATUS_RANK[current];
  if (currentRank === undefined) return null;   // unranked = hand-set, leave it

  return STATUS_RANK[derived.toUpperCase()] > currentRank ? derived : null;
}

// The only columns this import may ever write.
const WRITABLE_COLUMNS = new Set([
  'submission_date', 'sample_approval_date',
  'no_of_trial', 'corrector', 'sample_status',
]);

// Sheet column → order column, with the parser that reads it.
const FIELDS = [
  { col: 'submission_date',      key: 'submission', parse: parseSheetDate },
  { col: 'sample_approval_date', key: 'approval',   parse: parseSheetDate },
  { col: 'no_of_trial',          key: 'trials',     parse: parseTrialCount },
  { col: 'corrector',            key: 'corrector',  parse: cleanText },
];

function sameText(a, b) {
  return String(a == null ? '' : a).trim().toUpperCase()
       === String(b == null ? '' : b).trim().toUpperCase();
}

// Does the order already hold this value? Dates arrive from pg as 'YYYY-MM-DD'
// strings; trial counts may arrive as either number or string.
function alreadyEqual(current, next) {
  if (typeof next === 'number') return Number(current) === next;
  return sameText(current, next);
}

// no_of_trial defaults to 0, so a 0 there means nobody has recorded anything.
function isBlank(col, current) {
  if (current == null || String(current).trim() === '') return true;
  return col === 'no_of_trial' && Number(current) === 0;
}

// Same rule as src/utils/correctorOptions.js: "GEX 01", "gex 1" and "GEX 1"
// are one plant.
function normalizePlant(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/\b0+(\d)/g, '$1');
}

// Would the Corrector dropdown offer this name for this plant? Mirrors
// correctorOptions in src/utils/correctorOptions.js; a name it would not offer
// is stored as typed and shows as "not in list".
function correctorInDropdown(correctors, plant, name) {
  const active = (correctors || []).filter((c) => c.is_active);
  const wanted = normalizePlant(plant);
  const forPlant = wanted ? active.filter((c) => normalizePlant(c.plant) === wanted) : active;
  const pool = forPlant.length ? forPlant : active;
  return pool.some((c) => c.name === name);
}

function planRowUpdate({ row, order, loggedTrials = 0 }) {
  const updates = {};
  const warnings = [];
  const conflicts = [];
  const parsed = {};
  let trialsIgnored = null;

  for (const f of FIELDS) {
    const raw = readColumn(row, f.key);
    const value = f.parse(raw);
    parsed[f.col] = value;

    if (value === null) {
      // A blank cell means "not recorded", not "clear it" — omit the column.
      if (String(raw == null ? '' : raw).trim() !== '') {
        warnings.push(`${COLUMNS[f.key]}: could not read ${JSON.stringify(raw)} — left unchanged`);
      }
      continue;
    }

    if (f.col === 'no_of_trial' && loggedTrials > 0) {
      // Logged trials win on screen, so a typed count would never be seen.
      if (value > 0 && value !== loggedTrials) trialsIgnored = { logged: loggedTrials, sheet: value };
      continue;
    }

    if (isBlank(f.col, order[f.col])) {
      if (!(f.col === 'no_of_trial' && value === 0)) updates[f.col] = value;
    } else if (!alreadyEqual(order[f.col], value)) {
      // The app may be newer than the sheet, so an existing value always stands.
      conflicts.push({ col: f.col, current: order[f.col], sheet: value });
    }
  }

  if (updates.sample_approval_date && sameText(order.sample_status, 'Rejected')) {
    warnings.push('status is Rejected — approval date will be saved, status left as Rejected');
  }

  const status = deriveSampleStatus({
    approvalDate: parsed.sample_approval_date || order.sample_approval_date || null,
    submissionDate: parsed.submission_date || order.submission_date || null,
    currentStatus: order.sample_status,
  });
  if (status) updates.sample_status = status;

  // Plant and supplier are cross-checks only — reported, never written.
  for (const key of ['plant', 'supplier']) {
    const sheetValue = cleanText(readColumn(row, key));
    const appValue = cleanText(order[key]);
    if (sheetValue && appValue && !sameText(sheetValue, appValue)) {
      warnings.push(`${key}: sheet says ${sheetValue}, app says ${appValue} — not changed`);
    }
  }

  return { updates, warnings, conflicts, trialsIgnored };
}

function buildImportPlan({ rows, orders, correctors, loggedTrials, standaloneProfiles }) {
  const byDie = new Map();
  for (const o of orders || []) {
    const key = normalizeDieNo(o.die_no);
    if (!key) continue;
    if (!byDie.has(key)) byDie.set(key, []);
    byDie.get(key).push(o);
  }

  const plan = {
    updates: [], noop: [], notFound: [], ambiguous: [], warnings: [],
    conflicts: [], notReceived: [], trialsIgnored: [], standalone: [], unknownCorrectors: [],
  };
  const seen = new Map();
  const unknownNames = new Map();

  (rows || []).forEach((row, i) => {
    const sheetRow = i + 2;                       // +1 for the header, +1 for 1-based
    const dieRaw = cleanText(readColumn(row, 'die'));
    const die = normalizeDieNo(dieRaw);
    if (!die) {
      plan.warnings.push(`row ${sheetRow}: blank die number — skipped`);
      return;
    }
    if (seen.has(die)) {
      plan.warnings.push(`row ${sheetRow}: die ${dieRaw} also appears on row ${seen.get(die)} — later row wins`);
    }
    seen.set(die, sheetRow);

    const selection = selectOrder(byDie.get(die));
    if (selection.reason === 'not-found') {
      // A hand-added Sample Followup record holds its die number in `profile`.
      const list = standaloneProfiles && standaloneProfiles.has(die) ? plan.standalone : plan.notFound;
      list.push({ sheetRow, die: dieRaw });
      return;
    }
    if (selection.reason !== 'matched') {
      plan.ambiguous.push({
        sheetRow, die: dieRaw, reason: selection.reason,
        orderIds: selection.candidates.map((o) => o.id),
      });
      return;
    }

    const order = selection.order;
    const { updates, warnings, conflicts, trialsIgnored } = planRowUpdate({
      row, order, loggedTrials: loggedTrials ? loggedTrials.get(order.id) || 0 : 0,
    });
    warnings.forEach((w) => plan.warnings.push(`row ${sheetRow} (${dieRaw}): ${w}`));

    const entry = { sheetRow, die: dieRaw, orderId: order.id, before: order, updates };
    if (Object.keys(updates).length === 0) plan.noop.push(entry);
    else plan.updates.push(entry);

    if (conflicts.length) plan.conflicts.push({ ...entry, conflicts });
    if (trialsIgnored) plan.trialsIgnored.push({ ...entry, ...trialsIgnored });
    if (Object.keys(updates).length && !order.die_received_date) plan.notReceived.push(entry);
    if (correctors && updates.corrector && !correctorInDropdown(correctors, order.plant, updates.corrector)) {
      if (!unknownNames.has(updates.corrector)) unknownNames.set(updates.corrector, []);
      unknownNames.get(updates.corrector).push(dieRaw);
    }
  });

  plan.unknownCorrectors = [...unknownNames].map(([name, dies]) => ({ name, dies }));
  return plan;
}

// Daily Summary lists any stage dated before the report date that has no ledger
// row as "Recorded late". These are old dates being backfilled, not late entries,
// so they go into the ledger with the import. Stage keys match STAGES in
// dailySummaryData.cjs (a test pins this); that module is not required here so
// the importer can still be copied onto a server that does not have it.
function ledgerRows(plan, today) {
  const rows = [];
  for (const entry of plan.updates) {
    const stageDate = entry.updates.submission_date;
    if (!stageDate || stageDate >= today) continue;
    const type = entry.before.type;
    const stage = type === 'N' ? 'sample_new' : type === 'B' ? 'sample_backup' : 'sample_other';
    rows.push({ orderId: entry.orderId, stage, stageDate });
  }
  return rows;
}

module.exports = {
  COLUMNS, MAX_TRIALS, STATUS_RANK, WRITABLE_COLUMNS, FIELDS,
  readCell, readColumn, checkColumns, normalizeDieNo, cleanText, parseSheetDate, parseTrialCount,
  selectOrder, deriveSampleStatus, correctorInDropdown, planRowUpdate, buildImportPlan, ledgerRows,
};
