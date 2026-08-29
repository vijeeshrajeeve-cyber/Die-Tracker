'use strict';

// The daily summary's pure core: what counts as a stage, how a stage date is
// read off an order row, and how a day's rows become a report object.
//
// This module deliberately does not require db.cjs -- it takes a `db` argument
// instead. That is what lets db.cjs require it back for the one-time ledger
// seed without a circular import.

// Report order. Adding a stage means adding one entry here: the SQL, the PDF
// rows and the email body all read this list.
//
// `column` is the die_orders column carrying the stage's date. `match` narrows
// which rows a stage may claim -- only the sample split uses it. `optional`
// rows are omitted from the report when their count is zero; everything else
// renders at zero, because a zero is information.
const STAGES = [
  { key: 'requested',       label: 'Die orders requested',           column: 'die_requested_date' },
  { key: 'ordered',         label: 'Die orders placed',              column: 'ordered_date' },
  { key: 'design_received', label: 'Designs received',               column: 'design_received_date' },
  { key: 'design_approved', label: 'Designs approved',               column: 'design_approved_date' },
  // pr_entry and oracle_entry are used as dates by the workflow but persisted
  // through sanitizeString (server/routes/orders.cjs:329,332), so they can hold
  // arbitrary text. freeText marks them for the unparseable-value footnote.
  { key: 'pr_created',      label: 'PRs created',                    column: 'pr_entry',       freeText: true },
  { key: 'oracle_entry',    label: 'Oracle entries done',            column: 'oracle_entry',   freeText: true },
  { key: 'design_to_ems',   label: 'Designs to EMS completed',       column: 'design_to_ems_date' },
  { key: 'die_received',    label: 'Dies received',                  column: 'die_received_date' },
  { key: 'sample_new',      label: 'Samples submitted - New',        column: 'submission_date', match: (r) => r.type === 'N' },
  { key: 'sample_backup',   label: 'Samples submitted - Backup',     column: 'submission_date', match: (r) => r.type === 'B' },
  // Types T, C and H are rare but real. Without this row they would fall
  // between the two buckets above and disappear from every report.
  { key: 'sample_other',    label: 'Samples submitted - other type', column: 'submission_date',
    match: (r) => r.type !== 'N' && r.type !== 'B', optional: true },
].map((s) => ({ match: () => true, freeText: false, optional: false, ...s }));

const pad = (n) => String(n).padStart(2, '0');

// Accepts what the columns actually hold: ISO dates, ISO timestamps, DD/MM/YYYY
// (the form sanitizeDate in routes/backup-requests.cjs:21 accepts), and real
// Date objects. DATE columns arrive as plain 'YYYY-MM-DD' strings -- db.cjs:10
// overrides pg's parser for OID 1082 -- but TIMESTAMP is left alone, so
// created_at really does come back as a Date and the pending-age fallback
// depends on this branch. Everything else is null -- never a guess. Callers
// count the nulls rather than hiding them.
function parseStageDate(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  const s = String(value).trim();
  if (!s) return null;

  let y, m, d;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    [, y, m, d] = iso;
  } else {
    const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (!dmy) return null;
    [, d, m, y] = dmy;
  }

  const mm = Number(m), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${pad(mm)}-${pad(dd)}`;
}

// The date this row carries for this stage, or null if it carries none, the
// value is unreadable, or the row does not belong to the stage at all.
function stageDateOf(row, stage) {
  if (!stage.match(row)) return null;
  return parseStageDate(row[stage.column]);
}

// Pending pipeline, in flow order. CANCELLED is deliberately absent -- a
// cancelled order is not waiting for anything. HOLD is present but last: it is
// not a step in the flow, yet orders parked there are invisible if omitted.
//
// `ageFrom` is the column completed by the *preceding* step, which is when the
// order entered this stage. Kept here rather than derived from WORKFLOW_STEPS
// because that lives in src/ and the server must not import across that
// boundary; a test pins the two status lists equal instead.
const PENDING_STAGES = [
  { status: 'PENDING FOR ORDERING',        label: 'Pending Order',     ageFrom: ['die_requested_date'] },
  { status: 'AWAITING FOR DESIGN',         label: 'Awaiting Design',   ageFrom: ['ordered_date'] },
  { status: 'UNDER SIMULATION',            label: 'Simulation',        ageFrom: ['ordered_date'] },
  { status: 'PENDING FOR DESIGN APPROVAL', label: 'Design Approval',   ageFrom: ['design_received_date', 'three_d_model_received_date'] },
  { status: 'PENDING FOR PR',              label: 'Pending PR',        ageFrom: ['design_approved_date'] },
  { status: 'PENDING FOR ORACLE ENTRY',    label: 'Oracle Entry',      ageFrom: ['pr_entry'] },
  { status: 'PENDING FOR DESIGN TO EMS',   label: 'Design to EMS',     ageFrom: ['oracle_entry'] },
  { status: 'DONE',                        label: 'In Manufacturing',  ageFrom: ['design_to_ems_date'] },
  { status: 'DIE RECEIVED',                label: 'Die Received',      ageFrom: ['die_received_date'] },
  { status: 'HOLD',                        label: 'On Hold',           ageFrom: ['die_requested_date'] },
];

// A long backlog would otherwise push the pending table onto page four. The
// count stays honest; only the listing is trimmed.
const LATE_LIST_LIMIT = 40;

const ORDER_COLUMNS = [
  'id', 'die_no', 'order_no', 'plant', 'type', 'status', 'created_at',
  'three_d_model_received_date',
  ...new Set(STAGES.map((s) => s.column)),
].join(', ');

async function fetchOrders(db) {
  const { rows } = await db.query(`SELECT ${ORDER_COLUMNS} FROM die_orders`);
  return rows;
}

async function fetchLedgerKeys(db) {
  const { rows } = await db.query('SELECT order_id, stage FROM daily_report_ledger');
  return new Set(rows.map((r) => `${r.order_id}:${r.stage}`));
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

// Counts for the report date, plus anything older that has never been reported.
// Both go into `commits` so each stage is reported exactly once, whichever
// bucket it landed in.
function buildActivity({ rows, reported, reportDate }) {
  const counts = new Map(STAGES.map((s) => [s.key, 0]));
  const unreadable = new Map();
  const late = [];
  const commits = [];

  for (const row of rows) {
    for (const stage of STAGES) {
      if (!stage.match(row)) continue;

      const raw = row[stage.column];
      const stageDate = parseStageDate(raw);

      if (stageDate === null) {
        // Only free-text columns can hold something unreadable; a genuinely
        // empty cell is not a data-quality problem.
        if (stage.freeText && raw !== null && raw !== undefined && String(raw).trim() !== '') {
          unreadable.set(stage.label, (unreadable.get(stage.label) || 0) + 1);
        }
        continue;
      }

      if (stageDate === reportDate) {
        // Counted unconditionally, ledger or no ledger. "How many designs were
        // received on the 28th" must give the same answer every time it is
        // asked, so the report reconciles against the Orders register and a
        // re-run does not report zeros. The ON CONFLICT on the insert is what
        // keeps the ledger clean, not a check here.
        counts.set(stage.key, counts.get(stage.key) + 1);
        commits.push({ orderId: row.id, stage: stage.key, stageDate });
      } else if (stageDate < reportDate) {
        // The ledger gate belongs here and only here: an older stage is late
        // precisely when no report has carried it yet. A stage counted on its
        // own day was ledgered then, so it cannot resurface as late tomorrow.
        if (reported.has(`${row.id}:${stage.key}`)) continue;
        late.push({
          dieNo: row.die_no, orderNo: row.order_no,
          stageLabel: stage.label, stageDate,
        });
        commits.push({ orderId: row.id, stage: stage.key, stageDate });
      }
      // A future date is left alone entirely -- not counted, not called late,
      // and above all not committed, so it still reports on the day it names.
    }
  }

  const activity = STAGES
    .filter((s) => !s.optional || counts.get(s.key) > 0)
    .map((s) => ({ key: s.key, label: s.label, count: counts.get(s.key) }));

  late.sort((a, b) =>
    a.stageDate.localeCompare(b.stageDate) || String(a.dieNo).localeCompare(String(b.dieNo)));

  return {
    activity,
    activityTotal: activity.reduce((n, a) => n + a.count, 0),
    late: late.slice(0, LATE_LIST_LIMIT),
    lateTotal: late.length,
    unparseable: STAGES
      .filter((s) => unreadable.has(s.label))
      .map((s) => ({ label: s.label, count: unreadable.get(s.label) })),
    commits,
  };
}

function buildPending(rows, today) {
  return PENDING_STAGES.map((stage) => {
    const mine = rows.filter((r) => r.status === stage.status);
    let oldestDays = null;

    for (const row of mine) {
      let entered = null;
      for (const col of [...stage.ageFrom, 'die_requested_date', 'created_at']) {
        entered = parseStageDate(row[col]);
        if (entered) break;
      }
      if (!entered) continue;
      const age = daysBetween(entered, today);
      if (age !== null && (oldestDays === null || age > oldestDays)) oldestDays = age;
    }

    return { status: stage.status, label: stage.label, count: mine.length, oldestDays };
  });
}

async function commitLedger(db, commits, reportDate) {
  if (!commits.length) return 0;
  for (let i = 0; i < commits.length; i += 500) {
    const chunk = commits.slice(i, i + 500);
    const values = chunk.map((_, n) =>
      `($${n * 4 + 1}, $${n * 4 + 2}, $${n * 4 + 3}, $${n * 4 + 4})`).join(', ');
    const params = chunk.flatMap((c) => [c.orderId, c.stage, c.stageDate, reportDate]);
    await db.query(
      `INSERT INTO daily_report_ledger (order_id, stage, stage_date, reported_on)
       VALUES ${values} ON CONFLICT (order_id, stage) DO NOTHING`,
      params
    );
  }
  return commits.length;
}

// `commit` is the caller's explicit intent, never inferred: the ledger records
// what was emailed, so the scheduler and Send-now commit and the download
// preview does not. See the spec's "What commits to the ledger".
async function buildReport(db, { reportDate, today, commit }) {
  const [rows, reported] = await Promise.all([fetchOrders(db), fetchLedgerKeys(db)]);
  const activity = buildActivity({ rows, reported, reportDate });
  const pending = buildPending(rows, today);

  if (commit) await commitLedger(db, activity.commits, reportDate);

  return {
    reportDate,
    activity: activity.activity,
    activityTotal: activity.activityTotal,
    late: activity.late,
    lateTotal: activity.lateTotal,
    pending,
    unparseable: activity.unparseable,
  };
}

module.exports = {
  STAGES, PENDING_STAGES, LATE_LIST_LIMIT, ORDER_COLUMNS,
  parseStageDate, stageDateOf,
  fetchOrders, fetchLedgerKeys, buildActivity, buildPending, commitLedger, buildReport,
};
