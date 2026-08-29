# Daily Summary Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a signed-off-able PDF of the previous day's die-order activity and pending pipeline, and email it automatically at 06:00 every morning to a configured recipient list.

**Architecture:** One SQL read pulls every die order into memory; pure functions turn those rows into a plain report object (activity counts, late entries, pending-by-stage); a separate module turns the report object into PDF bytes; a third module owns settings, the once-a-minute scheduler tick, and the email. A `daily_report_ledger` table records which `(order_id, stage)` pairs have already been reported, so a back-dated entry surfaces exactly once under "Recorded late" instead of falling between two mornings' reports.

**Tech Stack:** Node.js (CommonJS `.cjs`), Express 5, PostgreSQL via `pg`, `pdf-lib` for the PDF, `nodemailer` via the existing email service, React 19 for the settings panel, `node:test` for tests.

## Global Constraints

- **Source of truth:** `docs/superpowers/specs/2026-08-29-daily-summary-report-design.md`. Read it before starting.
- **Backend files are CommonJS `.cjs`.** `require`, not `import`. Match the surrounding style (4-space indent in `routes/`, 2-space in newer `services/` — copy whichever file you are editing).
- **Tests use `node:test` + `node:assert/strict`.** No Jest, no Vitest. Run with `npm test`. Mock the pg pool with a fake object exposing `query`, as `server/services/focReminder.test.cjs` does.
- **`npm run build:check` is unusable** — `npm run lint` fails on 77 pre-existing problems repo-wide and never reaches the build. Verify frontend work with `npx eslint <your changed files>` plus `npm run build`.
- **`server/db.cjs` is one giant template-literal query executed in file order.** Anything referencing `app_migrations` must appear *after* that table is created (~line 888). Every schema change must also be mirrored into `init.sql` for fresh installs.
- **Backend assets live in `server/assets/`, never `public/`.** `Dockerfile.backend` copies only `server/`; a `public/` path resolves in dev and silently yields an unbranded PDF in the container.
- **pdf-lib `StandardFonts` are WinAnsi-encoded and throw on characters outside it.** All text drawn into the PDF must pass through a `sanitize()` that replaces `—`, `≤`, `·` etc.
- **`docker compose restart` never picks up a source edit.** Use `docker compose build backend && docker compose up -d backend`.
- **`TZ` is `Asia/Dubai`** for the backend in `docker-compose.yml`. `06:00` means local 06:00.
- **Never run an unscoped `DELETE FROM`** against the dev database — the user works in it.
- Commit after every task. End commit messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `server/services/dailySummaryData.cjs` | `STAGES`, `PENDING_STAGES`, `parseStageDate`, and the pure functions that turn order rows + ledger keys into a report object. No database, no formatting. | 1, 3 |
| `server/services/dailySummaryData.test.cjs` | Tests for the above. | 1, 3 |
| `server/db.cjs` | Ledger table DDL, the five `reminder_settings` columns, and the one-time ledger seed. | 2 |
| `init.sql` | Same DDL, for fresh installs. | 2 |
| `server/services/dailySummaryPdf.cjs` | Report object → PDF bytes. No database access. | 4 |
| `server/services/dailySummaryPdf.test.cjs` | Tests for the above. | 4 |
| `server/services/dailySummary.cjs` | Settings read/write, `isDue`, HTML email body, send, scheduler tick. The only file here that talks to the mailer. | 5 |
| `server/services/dailySummary.test.cjs` | Tests for the above. | 5 |
| `server/index.cjs` | Start the scheduler. | 5 |
| `server/routes/email.cjs` | The four endpoints. | 6 |
| `src/api.js` | Client methods for those endpoints. | 6 |
| `src/components/email/settingsStyles.jsx` | `inputStyle`, `cardStyle`, `ToggleButton` extracted so two panels can share them. | 7 |
| `src/components/email/DailySummarySettings.jsx` | The settings panel. | 7 |
| `src/components/email/EmailSettings.jsx` | Use the extracted styles; render the new panel. | 7 |

The data module never formats and the PDF module never queries, so the report object is a testable interface between them. `dailySummaryData.cjs` deliberately does **not** `require('../db.cjs')` — it takes a `db` argument — which is what lets `db.cjs` require it for the seed without a circular import.

---

### Task 1: Stage catalogue and date parsing

The pure core. Everything else builds on these two exports.

**Files:**
- Create: `server/services/dailySummaryData.cjs`
- Test: `server/services/dailySummaryData.test.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `STAGES` — array of `{ key, label, column, match }`. `match(row) → boolean`.
  - `parseStageDate(value) → 'YYYY-MM-DD' | null`
  - `stageDateOf(row, stage) → 'YYYY-MM-DD' | null`

- [ ] **Step 1: Write the failing test**

Create `server/services/dailySummaryData.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const data = require('./dailySummaryData.cjs');

// ── parseStageDate ──────────────────────────────────────────────────────────

test('parseStageDate accepts ISO dates', () => {
  assert.equal(data.parseStageDate('2026-08-28'), '2026-08-28');
});

test('parseStageDate accepts an ISO timestamp, keeping the date half', () => {
  assert.equal(data.parseStageDate('2026-08-28T00:00:00.000Z'), '2026-08-28');
});

test('parseStageDate accepts DD/MM/YYYY and DD-MM-YYYY, zero-padding', () => {
  assert.equal(data.parseStageDate('28/08/2026'), '2026-08-28');
  assert.equal(data.parseStageDate('5/8/2026'), '2026-08-05');
  assert.equal(data.parseStageDate('28-08-2026'), '2026-08-28');
});

test('parseStageDate accepts a Date object, since DATE columns come back as one', () => {
  assert.equal(data.parseStageDate(new Date(2026, 7, 28)), '2026-08-28');
});

// pr_entry and oracle_entry are free text (saved through sanitizeString, not
// sanitizeDate) so they really do contain things like this.
test('parseStageDate rejects free text and empties rather than guessing', () => {
  for (const junk of ['done', 'YES', '', '   ', null, undefined, 'N/A', '2026-13-45']) {
    assert.equal(data.parseStageDate(junk), null, `expected null for ${JSON.stringify(junk)}`);
  }
});

// ── STAGES ──────────────────────────────────────────────────────────────────

test('STAGES covers the eleven reported stages, in report order', () => {
  assert.deepEqual(data.STAGES.map(s => s.key), [
    'requested', 'ordered', 'design_received', 'design_approved',
    'pr_created', 'oracle_entry', 'design_to_ems', 'die_received',
    'sample_new', 'sample_backup', 'sample_other',
  ]);
});

test('every stage names a real die_orders column and carries a label', () => {
  for (const s of data.STAGES) {
    assert.ok(s.column, `${s.key} has no column`);
    assert.ok(s.label, `${s.key} has no label`);
    assert.equal(typeof s.match, 'function', `${s.key} has no match predicate`);
  }
});

test('the sample stages split on type, and other-type catches the rest', () => {
  const byKey = Object.fromEntries(data.STAGES.map(s => [s.key, s]));
  assert.equal(byKey.sample_new.match({ type: 'N' }), true);
  assert.equal(byKey.sample_new.match({ type: 'B' }), false);
  assert.equal(byKey.sample_backup.match({ type: 'B' }), true);
  for (const type of ['T', 'C', 'H', '', null, undefined]) {
    assert.equal(byKey.sample_other.match({ type }), true,
      `type ${JSON.stringify(type)} must land in other, not vanish`);
  }
  assert.equal(byKey.sample_other.match({ type: 'N' }), false);
});

test('only sample_other is optional; every other row renders even at zero', () => {
  const optional = data.STAGES.filter(s => s.optional).map(s => s.key);
  assert.deepEqual(optional, ['sample_other']);
});

// ── stageDateOf ─────────────────────────────────────────────────────────────

test('stageDateOf reads the stage column and applies the match predicate', () => {
  const byKey = Object.fromEntries(data.STAGES.map(s => [s.key, s]));
  const row = { submission_date: '2026-08-28', type: 'N' };
  assert.equal(data.stageDateOf(row, byKey.sample_new), '2026-08-28');
  assert.equal(data.stageDateOf(row, byKey.sample_backup), null,
    'a New submission must not also count as Backup');
});

test('stageDateOf returns null for an unparseable value', () => {
  const pr = data.STAGES.find(s => s.key === 'pr_created');
  assert.equal(data.stageDateOf({ pr_entry: 'done' }, pr), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="parseStageDate"
```

Expected: FAIL — `Cannot find module './dailySummaryData.cjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/services/dailySummaryData.cjs`:

```js
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
// Date objects, since DATE columns come back from pg as Dates. Everything else
// is null -- never a guess. Callers count the nulls rather than hiding them.
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

module.exports = { STAGES, parseStageDate, stageDateOf };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS. Every pre-existing test must still pass too.

- [ ] **Step 5: Commit**

```bash
git add server/services/dailySummaryData.cjs server/services/dailySummaryData.test.cjs
git commit -m "feat(daily-summary): stage catalogue and tolerant date parsing"
```

---

### Task 2: The ledger table, settings columns, and seed

Schema only. Nothing reads it yet, but the seed must exist before the first report runs or the report opens with years of history filed as "recorded late".

**Files:**
- Modify: `server/db.cjs` (schema block, and after the `app_migrations` table at ~line 888)
- Modify: `init.sql`

**Interfaces:**
- Consumes: `STAGES`, `stageDateOf` from Task 1.
- Produces: table `daily_report_ledger(order_id, stage, stage_date, reported_on)`; five `reminder_settings` columns.

- [ ] **Step 1: Add the DDL to `server/db.cjs`**

Inside the big template-literal query, immediately after the `reminder_settings` `ALTER TABLE` lines (~line 796):

```sql
      -- Daily summary: schedule, recipients, and the once-a-day guard. Shares
      -- reminder_settings with the design and FOC reminders so all scheduled
      -- mail is configured in one place.
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS daily_summary_enabled  BOOLEAN DEFAULT false;
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS daily_summary_time     TEXT DEFAULT '06:00';
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS daily_summary_last_run DATE;
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS daily_summary_to       TEXT DEFAULT '';
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS daily_summary_cc       TEXT DEFAULT '';

      -- Which (order, stage) pairs have already appeared in a report that was
      -- emailed. A stage reports exactly once: the primary key is what stops a
      -- back-dated entry being counted twice, and its absence is what lets a
      -- late entry be found at all.
      CREATE TABLE IF NOT EXISTS daily_report_ledger (
        order_id    INTEGER NOT NULL REFERENCES die_orders(id) ON DELETE CASCADE,
        stage       TEXT    NOT NULL,
        stage_date  DATE    NOT NULL,
        reported_on DATE    NOT NULL,
        PRIMARY KEY (order_id, stage)
      );
      CREATE INDEX IF NOT EXISTS idx_daily_report_ledger_reported_on
        ON daily_report_ledger(reported_on);
```

- [ ] **Step 2: Mirror the same DDL into `init.sql`**

Append the `CREATE TABLE daily_report_ledger` + index verbatim, and add the five columns to the `reminder_settings` definition there. Fresh installs run `init.sql` only, so a schema change that lands in just one of the two files works on this machine and fails on a new one.

- [ ] **Step 3: Add the one-time seed to `server/db.cjs`**

This runs in JavaScript, *after* the big query resolves, so it can reuse `parseStageDate` rather than reimplementing date parsing in SQL. Place it alongside the other post-query seeding (near the default-admin block, ~line 940). Add the require at the top of `db.cjs`:

```js
const { STAGES, stageDateOf } = require('./services/dailySummaryData.cjs');
```

Then:

```js
    // One-time: fill the ledger with everything that happened before today, so
    // the first daily summary does not open with several years of history
    // filed under "Recorded late".
    //
    // The boundary is strictly `< today`, not `<=`. Seeding today as well would
    // swallow the migration day itself, and the first real report -- which runs
    // tomorrow morning covering exactly today -- would show zeros everywhere.
    const seeded = await client.query(
      `SELECT 1 FROM app_migrations WHERE id = 'daily_report_ledger_seed_v1'`
    );
    if (seeded.rows.length === 0) {
      const today = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

      const orders = await client.query(`
        SELECT id, type, die_requested_date, ordered_date, design_received_date,
               design_approved_date, pr_entry, oracle_entry, design_to_ems_date,
               die_received_date, submission_date
          FROM die_orders
      `);

      const rows = [];
      for (const order of orders.rows) {
        for (const stage of STAGES) {
          const stageDate = stageDateOf(order, stage);
          if (stageDate && stageDate < todayStr) {
            rows.push([order.id, stage.key, stageDate, todayStr]);
          }
        }
      }

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const values = chunk.map((_, n) =>
          `($${n * 4 + 1}, $${n * 4 + 2}, $${n * 4 + 3}, $${n * 4 + 4})`).join(', ');
        await client.query(
          `INSERT INTO daily_report_ledger (order_id, stage, stage_date, reported_on)
           VALUES ${values} ON CONFLICT (order_id, stage) DO NOTHING`,
          chunk.flat()
        );
      }

      await client.query(`INSERT INTO app_migrations (id) VALUES ('daily_report_ledger_seed_v1')`);
      console.log(`Seeded daily_report_ledger with ${rows.length} historical stage(s)`);
    }
```

- [ ] **Step 4: Verify the schema applies**

The seed reads `app_migrations`, which is created inside the big query — so it must run after that query resolves, not inside it. Confirm by starting the backend:

```bash
docker compose build backend && docker compose up -d backend && docker compose logs --tail=40 backend
```

Expected: a `Seeded daily_report_ledger with N historical stage(s)` line and no error. Then confirm the boundary held — the seed must contain nothing dated today:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) AS total, count(*) FILTER (WHERE stage_date >= CURRENT_DATE) AS should_be_zero FROM daily_report_ledger;"
```

Expected: `should_be_zero` is `0`.

> Pass `-h /var/run/postgresql` explicitly. The db service inherits a stale `PGHOST=supabase-db` from `.env`, so a bare `docker exec ... psql` goes out over TCP and hits the scram rule.

Restarting the backend is not enough to pick up a source edit — `Dockerfile.backend` copies the source into the image, so you must `build` then `up -d`.

- [ ] **Step 5: Commit**

```bash
git add server/db.cjs init.sql
git commit -m "feat(daily-summary): ledger table, settings columns, and historical seed"
```

---

### Task 3: Building the report object

The whole report, as pure functions over rows the caller fetched. This is where the counting rules live.

**Files:**
- Modify: `server/services/dailySummaryData.cjs`
- Modify: `server/services/dailySummaryData.test.cjs`

**Interfaces:**
- Consumes: `STAGES`, `stageDateOf`, `parseStageDate` from Task 1.
- Produces:
  - `ORDER_COLUMNS` — string of columns the single query selects.
  - `fetchOrders(db) → Promise<row[]>`
  - `fetchLedgerKeys(db) → Promise<Set<string>>` (`"<orderId>:<stage>"`)
  - `buildActivity({ rows, reported, reportDate }) → { activity, activityTotal, late, lateTotal, unparseable, commits }`
  - `buildPending(rows, today) → [{ status, label, count, oldestDays }]`
  - `commitLedger(db, commits, reportDate) → Promise<number>`
  - `buildReport(db, { reportDate, today, commit }) → Promise<report>`

  The report object every downstream module consumes:

  ```js
  {
    reportDate: '2026-08-28',
    activity: [{ key, label, count }],       // sample_other omitted when 0
    activityTotal: 42,
    late: [{ dieNo, orderNo, stageLabel, stageDate }],  // capped at LATE_LIST_LIMIT
    lateTotal: 3,                            // uncapped count
    pending: [{ status, label, count, oldestDays }],    // oldestDays may be null
    unparseable: [{ label, count }],         // only non-zero entries
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `server/services/dailySummaryData.test.cjs`:

```js
// ── buildActivity ───────────────────────────────────────────────────────────

const order = (over = {}) => ({
  id: 1, die_no: 'D-100', order_no: 'PO-1', type: 'N', status: 'DONE',
  created_at: new Date('2026-01-01'), die_requested_date: null, ordered_date: null,
  design_received_date: null, three_d_model_received_date: null,
  design_approved_date: null, pr_entry: null, oracle_entry: null,
  design_to_ems_date: null, die_received_date: null, submission_date: null,
  ...over,
});

const countOf = (result, key) => result.activity.find(a => a.key === key)?.count;

test('a stage dated on the report date is counted', () => {
  const r = data.buildActivity({
    rows: [order({ id: 1, design_received_date: '2026-08-28' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 1);
  assert.equal(r.activityTotal, 1);
});

test('a stage dated on another day is not counted', () => {
  const r = data.buildActivity({
    rows: [order({ design_received_date: '2026-08-27' })],
    reported: new Set(['1:design_received']), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 0);
  assert.equal(r.late.length, 0);
});

test('one order can contribute to several stages on the same day', () => {
  const r = data.buildActivity({
    rows: [order({ ordered_date: '2026-08-28', design_received_date: '2026-08-28' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'ordered'), 1);
  assert.equal(countOf(r, 'design_received'), 1);
  assert.equal(r.activityTotal, 2);
});

test('samples split New from Backup, and neither claims the other', () => {
  const r = data.buildActivity({
    rows: [
      order({ id: 1, type: 'N', submission_date: '2026-08-28' }),
      order({ id: 2, type: 'B', submission_date: '2026-08-28' }),
      order({ id: 3, type: 'B', submission_date: '2026-08-28' }),
    ],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'sample_new'), 1);
  assert.equal(countOf(r, 'sample_backup'), 2);
});

test('every non-optional stage renders at zero; sample_other only when non-zero', () => {
  const quiet = data.buildActivity({ rows: [], reported: new Set(), reportDate: '2026-08-28' });
  assert.equal(quiet.activity.length, data.STAGES.length - 1, 'sample_other is hidden at zero');
  assert.ok(quiet.activity.every(a => a.count === 0));

  const withOther = data.buildActivity({
    rows: [order({ type: 'T', submission_date: '2026-08-28' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(withOther, 'sample_other'), 1);
});

test('an unreported earlier stage is listed as recorded late, not counted', () => {
  const r = data.buildActivity({
    rows: [order({ die_no: 'D-777', design_received_date: '2026-08-25' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 0, 'a late entry must not inflate the headline');
  assert.equal(r.lateTotal, 1);
  assert.deepEqual(r.late[0], {
    dieNo: 'D-777', orderNo: 'PO-1', stageLabel: 'Designs received', stageDate: '2026-08-25',
  });
});

test('re-running the same day gives the same counts, not zeros', () => {
  // The ledger stops a stage being reported twice as LATE. It must not gag the
  // headline count, or the second run of a day would claim nothing happened.
  const r = data.buildActivity({
    rows: [order({ id: 9, design_received_date: '2026-08-28' })],
    reported: new Set(['9:design_received']), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 1);
});

test('a stage counted on its own day never resurfaces as late', () => {
  const rows = [order({ id: 9, design_received_date: '2026-08-28' })];
  const first = data.buildActivity({ rows, reported: new Set(), reportDate: '2026-08-28' });
  const ledger = new Set(first.commits.map(c => `${c.orderId}:${c.stage}`));
  const next = data.buildActivity({ rows, reported: ledger, reportDate: '2026-08-29' });
  assert.equal(next.lateTotal, 0, 'yesterday\'s report already carried it');
});

test('an earlier stage already in the ledger is silent', () => {
  const r = data.buildActivity({
    rows: [order({ id: 42, design_received_date: '2026-08-25' })],
    reported: new Set(['42:design_received']), reportDate: '2026-08-28',
  });
  assert.equal(r.lateTotal, 0);
});

test('a stage dated in the future is neither counted nor called late', () => {
  const r = data.buildActivity({
    rows: [order({ design_received_date: '2026-09-30' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 0);
  assert.equal(r.lateTotal, 0);
  assert.equal(r.commits.length, 0, 'a future date must not be marked reported');
});

test('the late list is capped for display but counted in full', () => {
  const rows = [];
  for (let i = 1; i <= data.LATE_LIST_LIMIT + 5; i++) {
    rows.push(order({ id: i, die_no: `D-${i}`, design_received_date: '2026-08-20' }));
  }
  const r = data.buildActivity({ rows, reported: new Set(), reportDate: '2026-08-28' });
  assert.equal(r.late.length, data.LATE_LIST_LIMIT);
  assert.equal(r.lateTotal, data.LATE_LIST_LIMIT + 5);
  assert.equal(r.commits.length, data.LATE_LIST_LIMIT + 5,
    'every late stage is ledgered, including the ones not listed');
});

test('commits cover both the counted and the late stages', () => {
  const r = data.buildActivity({
    rows: [
      order({ id: 1, design_received_date: '2026-08-28' }),
      order({ id: 2, ordered_date: '2026-08-20' }),
    ],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.deepEqual(r.commits.sort((a, b) => a.orderId - b.orderId), [
    { orderId: 1, stage: 'design_received', stageDate: '2026-08-28' },
    { orderId: 2, stage: 'ordered', stageDate: '2026-08-20' },
  ]);
});

test('unreadable free-text dates are reported as a footnote, not dropped in silence', () => {
  const r = data.buildActivity({
    rows: [
      order({ id: 1, pr_entry: 'done' }),
      order({ id: 2, pr_entry: 'YES' }),
      order({ id: 3, pr_entry: '2026-08-28' }),
      order({ id: 4, oracle_entry: 'n/a' }),
    ],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'pr_created'), 1);
  assert.deepEqual(r.unparseable, [
    { label: 'PRs created', count: 2 },
    { label: 'Oracle entries done', count: 1 },
  ]);
});

test('an empty free-text column is not an unreadable value', () => {
  const r = data.buildActivity({
    rows: [order({ pr_entry: '' }), order({ id: 2, pr_entry: null })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.deepEqual(r.unparseable, []);
});

// ── buildPending ────────────────────────────────────────────────────────────

const pendingFor = (result, status) => result.find(p => p.status === status);

test('pending covers every pipeline status, in flow order, and excludes CANCELLED', () => {
  const p = data.buildPending([], '2026-08-29');
  assert.deepEqual(p.map(x => x.status), [
    'PENDING FOR ORDERING', 'AWAITING FOR DESIGN', 'UNDER SIMULATION',
    'PENDING FOR DESIGN APPROVAL', 'PENDING FOR PR', 'PENDING FOR ORACLE ENTRY',
    'PENDING FOR DESIGN TO EMS', 'DONE', 'DIE RECEIVED', 'HOLD',
  ]);
  assert.equal(pendingFor(p, 'CANCELLED'), undefined);
});

test('a cancelled order is counted in no pending row', () => {
  const p = data.buildPending([order({ status: 'CANCELLED' })], '2026-08-29');
  assert.equal(p.reduce((n, x) => n + x.count, 0), 0);
});

test('an unknown status is ignored rather than inventing a row', () => {
  const p = data.buildPending([order({ status: 'SOMETHING ELSE' })], '2026-08-29');
  assert.equal(p.reduce((n, x) => n + x.count, 0), 0);
});

test('oldest waiting days is measured from the previous stage date', () => {
  const p = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: '2026-08-19' }),
    order({ id: 2, status: 'PENDING FOR PR', design_approved_date: '2026-08-27' }),
  ], '2026-08-29');
  const row = pendingFor(p, 'PENDING FOR PR');
  assert.equal(row.count, 2);
  assert.equal(row.oldestDays, 10, 'the oldest of the two, not the newest');
});

test('design approval falls back to the 3D model date when there is no design date', () => {
  const p = data.buildPending([
    order({ status: 'PENDING FOR DESIGN APPROVAL', three_d_model_received_date: '2026-08-27' }),
  ], '2026-08-29');
  assert.equal(pendingFor(p, 'PENDING FOR DESIGN APPROVAL').oldestDays, 2);
});

test('a missing stage date falls back through requested date, then created_at', () => {
  const viaRequested = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: null, die_requested_date: '2026-08-24' }),
  ], '2026-08-29');
  assert.equal(pendingFor(viaRequested, 'PENDING FOR PR').oldestDays, 5);

  const viaCreated = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: null, die_requested_date: null,
            created_at: new Date('2026-08-27T10:00:00') }),
  ], '2026-08-29');
  assert.equal(pendingFor(viaCreated, 'PENDING FOR PR').oldestDays, 2);
});

test('with no date at all the age is null, never a fabricated zero', () => {
  const p = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: null,
            die_requested_date: null, created_at: null }),
  ], '2026-08-29');
  const row = pendingFor(p, 'PENDING FOR PR');
  assert.equal(row.count, 1);
  assert.equal(row.oldestDays, null);
});

test('an empty stage has a zero count and a null age', () => {
  const row = pendingFor(data.buildPending([], '2026-08-29'), 'PENDING FOR PR');
  assert.equal(row.count, 0);
  assert.equal(row.oldestDays, null);
});

// ── buildReport and the ledger ──────────────────────────────────────────────

const fakeDb = (results = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM die_orders/.test(sql)) return { rows: results.orders || [] };
      if (/FROM daily_report_ledger/.test(sql)) return { rows: results.ledger || [] };
      return { rows: [] };
    },
  };
};

test('buildReport with commit:false writes nothing to the ledger', async () => {
  const db = fakeDb({ orders: [order({ design_received_date: '2026-08-28' })] });
  const report = await data.buildReport(db, {
    reportDate: '2026-08-28', today: '2026-08-29', commit: false,
  });
  assert.equal(report.activity.find(a => a.key === 'design_received').count, 1);
  assert.equal(db.calls.filter(c => /INSERT INTO daily_report_ledger/.test(c.sql)).length, 0,
    'a preview must never consume ledger rows');
});

test('buildReport with commit:true inserts every reported stage, idempotently', async () => {
  const db = fakeDb({ orders: [order({ design_received_date: '2026-08-28' })] });
  await data.buildReport(db, { reportDate: '2026-08-28', today: '2026-08-29', commit: true });
  const insert = db.calls.find(c => /INSERT INTO daily_report_ledger/.test(c.sql));
  assert.ok(insert, 'commit:true must write the ledger');
  assert.match(insert.sql, /ON CONFLICT \(order_id, stage\) DO NOTHING/,
    're-running the same day must not duplicate rows');
  assert.deepEqual(insert.params.slice(0, 3), [1, 'design_received', '2026-08-28']);
});

test('buildReport commits nothing when there was nothing to report', async () => {
  const db = fakeDb({ orders: [] });
  await data.buildReport(db, { reportDate: '2026-08-28', today: '2026-08-29', commit: true });
  assert.equal(db.calls.filter(c => /INSERT INTO daily_report_ledger/.test(c.sql)).length, 0);
});

test('buildReport treats already-ledgered rows as reported', async () => {
  const db = fakeDb({
    orders: [order({ id: 7, design_received_date: '2026-08-20' })],
    ledger: [{ order_id: 7, stage: 'design_received' }],
  });
  const report = await data.buildReport(db, {
    reportDate: '2026-08-28', today: '2026-08-29', commit: false,
  });
  assert.equal(report.lateTotal, 0);
});

test('the order query selects every column the report needs', async () => {
  const db = fakeDb();
  await data.fetchOrders(db);
  const { sql } = db.calls[0];
  for (const col of ['id', 'die_no', 'order_no', 'type', 'status', 'created_at',
    'three_d_model_received_date', ...data.STAGES.map(s => s.column)]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `data.buildActivity is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `server/services/dailySummaryData.cjs`, above `module.exports`:

```js
// Pending pipeline, in flow order. CANCELLED is deliberately absent -- a
// cancelled order is not waiting for anything. HOLD is present but last: it is
// not a step in the flow, yet orders parked there are invisible if omitted.
//
// `ageFrom` is the column completed by the *preceding* step, which is when the
// order entered this stage. Kept here rather than derived from WORKFLOW_STEPS
// because that lives in src/ and the server must not import across that
// boundary; the test below pins the two status lists equal instead.
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

  late.sort((a, b) => a.stageDate.localeCompare(b.stageDate) || String(a.dieNo).localeCompare(String(b.dieNo)));

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
```

Update the exports:

```js
module.exports = {
  STAGES, PENDING_STAGES, LATE_LIST_LIMIT, ORDER_COLUMNS,
  parseStageDate, stageDateOf,
  fetchOrders, fetchLedgerKeys, buildActivity, buildPending, commitLedger, buildReport,
};
```

- [ ] **Step 4: Add the drift guard between server and frontend status lists**

The server keeps its own copy of the statuses. Pin the two together so they cannot drift — this is the mistake `STATUS_CONFIG`'s comment records having already happened once. Append to the test file:

```js
const fs = require('node:fs');
const path = require('node:path');

test('the pending statuses match the frontend status vocabulary', () => {
  const constants = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'constants.js'), 'utf8');
  const block = constants.slice(constants.indexOf('export const STATUS_CONFIG'));
  const frontend = [...block.slice(0, block.indexOf('};')).matchAll(/^\s*'([^']+)':\s*\{/gm)]
    .map(m => m[1]);

  const server = data.PENDING_STAGES.map(s => s.status);
  assert.deepEqual([...server].sort(), frontend.filter(s => s !== 'CANCELLED').sort(),
    'PENDING_STAGES must cover every status in STATUS_CONFIG except CANCELLED');
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add server/services/dailySummaryData.cjs server/services/dailySummaryData.test.cjs
git commit -m "feat(daily-summary): build the report object from order rows and the ledger"
```

---

### Task 4: The PDF

**Files:**
- Create: `server/services/dailySummaryPdf.cjs`
- Test: `server/services/dailySummaryPdf.test.cjs`

**Interfaces:**
- Consumes: the report object from Task 3.
- Produces: `generateDailySummaryPdf(report, { logoBytes, generatedAt, timeZone }) → Promise<Uint8Array>`

- [ ] **Step 1: Write the failing test**

Create `server/services/dailySummaryPdf.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { generateDailySummaryPdf } = require('./dailySummaryPdf.cjs');

const report = (over = {}) => ({
  reportDate: '2026-08-28',
  activity: [
    { key: 'requested', label: 'Die orders requested', count: 3 },
    { key: 'ordered', label: 'Die orders placed', count: 0 },
  ],
  activityTotal: 3,
  late: [],
  lateTotal: 0,
  pending: [
    { status: 'PENDING FOR PR', label: 'Pending PR', count: 2, oldestDays: 11 },
    { status: 'HOLD', label: 'On Hold', count: 0, oldestDays: null },
  ],
  unparseable: [],
  ...over,
});

const opts = { generatedAt: new Date('2026-08-29T06:00:00'), timeZone: 'Asia/Dubai' };

test('renders a non-empty PDF', async () => {
  const bytes = await generateDailySummaryPdf(report(), opts);
  assert.ok(bytes.length > 1000);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});

// StandardFonts are WinAnsi and throw on anything outside it. The labels really
// do carry an em dash, so this is the crash that would take out the 06:00 run.
test('survives characters outside WinAnsi', async () => {
  const bytes = await generateDailySummaryPdf(report({
    activity: [{ key: 'sample_new', label: 'Samples submitted — New ≤ 5 · ok', count: 1 }],
    late: [{ dieNo: 'D—1', orderNo: 'PO‑9', stageLabel: 'Designs received', stageDate: '2026-08-20' }],
    lateTotal: 1,
  }), opts);
  assert.ok(bytes.length > 1000);
});

test('a day with no activity still renders every section', async () => {
  const bytes = await generateDailySummaryPdf(report({
    activity: [{ key: 'requested', label: 'Die orders requested', count: 0 }],
    activityTotal: 0,
  }), opts);
  assert.ok(bytes.length > 1000);
});

test('a missing logo degrades to an unbranded PDF rather than throwing', async () => {
  const bytes = await generateDailySummaryPdf(report(), { ...opts, logoBytes: null });
  assert.ok(bytes.length > 1000);
});

test('a corrupt logo is ignored rather than throwing', async () => {
  const bytes = await generateDailySummaryPdf(report(), {
    ...opts, logoBytes: Buffer.from('not a png'),
  });
  assert.ok(bytes.length > 1000);
});

test('a long late list flows onto further pages and still ends with the sign-off', async () => {
  const late = [];
  for (let i = 0; i < 40; i++) {
    late.push({ dieNo: `D-${i}`, orderNo: `PO-${i}`, stageLabel: 'Designs received', stageDate: '2026-08-20' });
  }
  const bytes = await generateDailySummaryPdf(report({ late, lateTotal: 40 }), opts);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, 'forty late rows do not fit on one page');
});

test('the sign-off block is on the last page, not page one', async () => {
  const late = [];
  for (let i = 0; i < 40; i++) {
    late.push({ dieNo: `D-${i}`, orderNo: `PO-${i}`, stageLabel: 'Designs received', stageDate: '2026-08-20' });
  }
  const bytes = await generateDailySummaryPdf(report({ late, lateTotal: 40 }), opts);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPageCount();
  assert.equal(await pageHasSignOff(bytes, pages - 1), true, 'last page must carry the sign-off');
  assert.equal(await pageHasSignOff(bytes, 0), false, 'page one must not');
});

// pdf-lib cannot read text back, so assert on the drawing calls instead: the
// generator records which page index it drew the sign-off onto.
async function pageHasSignOff(bytes, index) {
  return generateDailySummaryPdf.lastSignOffPageIndex === index;
}
```

> The `pageHasSignOff` helper reads a value the generator records. Implement `generateDailySummaryPdf.lastSignOffPageIndex` as a plain assignment at the end of the generator. It exists solely so this assertion is possible — pdf-lib offers no text extraction — and is documented as such in the source.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './dailySummaryPdf.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `server/services/dailySummaryPdf.cjs`. Copy `sanitize`, `text` and `rule` from `supplierReportPdf.cjs` — they are small, and importing across two report generators would couple layouts that are free to diverge.

```js
'use strict';

// The daily summary, as a sheet somebody can print, read at a glance and sign.
//
// Layout constants below mirror supplierReportPdf.cjs so the two documents look
// like they came from the same company; they are layout, not contract.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = MARGIN + 96; // room reserved so the sign-off never straddles a break

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const NAVY = rgb(0.122, 0.435, 0.690);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// StandardFonts are WinAnsi-encoded and throw on characters outside it. The
// stage labels carry an em dash, so without this the 06:00 run would crash
// rather than render. Replaced, not stripped, so the meaning survives.
function sanitize(str) {
  return String(str == null ? '' : str)
    .replace(/[·•]/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[—–‑]/g, '-')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

function text(page, str, { x, y, size = 10, font, color = INK, align = 'left', width = 0 }) {
  const s = sanitize(str);
  if (!s) return;
  let px = x;
  if (align !== 'left') {
    const w = font.widthOfTextAtSize(s, size);
    px = align === 'right' ? x + width - w : x + (width - w) / 2;
  }
  page.drawText(s, { x: px, y, size, font, color });
}

function rule(page, y, { x = MARGIN, w = CONTENT_W, color = RULE } = {}) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color });
}

function longDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

module.exports.generateDailySummaryPdf = generateDailySummaryPdf;

async function generateDailySummaryPdf(report, opts = {}) {
  const { logoBytes = null, generatedAt = new Date(), timeZone = 'Asia/Dubai' } = opts;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A report without a logo is still a usable report -- and a corrupt file must
  // not take the morning's mail down with it.
  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const pages = [doc.addPage([PAGE_W, PAGE_H])];
  let page = pages[0];
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - MARGIN;
    return page;
  };
  const need = (space) => { if (y - space < BOTTOM) newPage(); };

  // ── Header ────────────────────────────────────────────────────────────────
  if (logo) {
    const scale = Math.min(34 / logo.height, 150 / logo.width);
    page.drawImage(logo, {
      x: MARGIN, y: y - logo.height * scale,
      width: logo.width * scale, height: logo.height * scale,
    });
    y -= logo.height * scale + 14;
  }
  text(page, 'DAILY DIE ORDER SUMMARY', { x: MARGIN, y, size: 15, font: bold, color: NAVY });
  y -= 17;
  text(page, longDate(report.reportDate), { x: MARGIN, y, size: 10.5, font: bold });
  y -= 13;
  text(page, `Generated ${generatedAt.toLocaleString('en-GB')} (${timeZone})`,
    { x: MARGIN, y, size: 7.6, font, color: MUTED });
  y -= 12;
  rule(page, y, { color: NAVY });
  y -= 22;

  // ── Activity ──────────────────────────────────────────────────────────────
  text(page, 'ACTIVITY RECORDED FOR THIS DAY', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 15;
  rule(page, y);
  y -= 15;

  for (const row of report.activity) {
    need(16);
    text(page, row.label, { x: MARGIN, y, size: 9.5, font });
    text(page, String(row.count), { x: MARGIN, y, size: 9.5, font: bold,
      align: 'right', width: CONTENT_W });
    y -= 15;
  }

  need(20);
  rule(page, y + 4);
  y -= 2;
  text(page, 'Total movements', { x: MARGIN, y, size: 9.5, font: bold });
  text(page, String(report.activityTotal), { x: MARGIN, y, size: 9.5, font: bold,
    align: 'right', width: CONTENT_W });
  y -= 26;

  // ── Recorded late ─────────────────────────────────────────────────────────
  if (report.lateTotal > 0) {
    need(46);
    text(page, 'RECORDED LATE', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
    y -= 12;
    text(page, 'Entered after the day they belong to, and not included in the counts above.',
      { x: MARGIN, y, size: 7.6, font, color: MUTED });
    y -= 12;
    rule(page, y);
    y -= 14;

    const cols = [
      { x: MARGIN, w: 110, align: 'left' },
      { x: MARGIN + 115, w: 110, align: 'left' },
      { x: MARGIN + 230, w: 160, align: 'left' },
      { x: MARGIN + 395, w: 104, align: 'right' },
    ];
    const head = ['Die Number', 'Order Number', 'Stage', 'Dated'];
    head.forEach((h, i) => text(page, h, { ...cols[i], y, size: 8, font: bold, color: MUTED, width: cols[i].w }));
    y -= 13;

    for (const row of report.late) {
      need(14);
      const cells = [row.dieNo || '-', row.orderNo || '-', row.stageLabel, row.stageDate];
      cells.forEach((c, i) => text(page, c, { ...cols[i], y, size: 8.6, font, width: cols[i].w }));
      y -= 13;
    }

    if (report.lateTotal > report.late.length) {
      need(14);
      text(page, `... and ${report.lateTotal - report.late.length} more not listed`,
        { x: MARGIN, y, size: 7.6, font, color: MUTED });
      y -= 13;
    }
    y -= 14;
  }

  // ── Pending ───────────────────────────────────────────────────────────────
  need(70);
  text(page, 'PENDING AT EACH STAGE', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 12;
  // Without this line the two blocks look like they contradict each other.
  text(page, 'Position as at the time of generation, not as at the report date above.',
    { x: MARGIN, y, size: 7.6, font, color: MUTED });
  y -= 12;
  rule(page, y);
  y -= 14;

  const pcols = [
    { x: MARGIN, w: 240, align: 'left' },
    { x: MARGIN + 250, w: 100, align: 'right' },
    { x: MARGIN + 360, w: 139, align: 'right' },
  ];
  ['Stage', 'Orders', 'Oldest waiting (days)'].forEach((h, i) =>
    text(page, h, { ...pcols[i], y, size: 8, font: bold, color: MUTED, width: pcols[i].w }));
  y -= 13;

  for (const row of report.pending) {
    need(15);
    // An age of null renders "-", never 0: no date is not the same as today.
    const cells = [row.label, String(row.count), row.oldestDays === null ? '-' : String(row.oldestDays)];
    cells.forEach((c, i) => text(page, c, {
      ...pcols[i], y, size: 9.2, font: i === 0 ? font : bold, width: pcols[i].w,
    }));
    y -= 14;
  }
  y -= 12;

  // ── Footnotes ─────────────────────────────────────────────────────────────
  if (report.unparseable.length) {
    need(30);
    rule(page, y + 6);
    for (const note of report.unparseable) {
      need(12);
      text(page, `${note.count} "${note.label}" value(s) could not be read as a date and are not counted.`,
        { x: MARGIN, y, size: 7.4, font, color: MUTED });
      y -= 11;
    }
  }

  // ── Sign-off, on the last page ────────────────────────────────────────────
  // On the last page, not page one: that placement is the standing complaint
  // against the supplier report and there is no reason to repeat it.
  if (y - 78 < MARGIN) newPage();
  drawSignOff(page, MARGIN + 60, { bold, font });
  generateDailySummaryPdf.lastSignOffPageIndex = pages.length - 1;

  return doc.save();
}

// Blank name, signature and date lines. A daily report nobody signs is a memo;
// being signable is the point of generating a PDF rather than an email alone.
function drawSignOff(page, y, { bold, font }) {
  const colW = (CONTENT_W - 40) / 3;
  const cols = ['Prepared by', 'Reviewed by', 'Approved by'];

  text(page, 'SIGN-OFF', { x: MARGIN, y: y + 46, size: 8.5, font: bold, color: MUTED });

  cols.forEach((label, i) => {
    const x = MARGIN + i * (colW + 20);
    text(page, label, { x, y: y + 32, size: 7.4, font: bold, color: MUTED });
    rule(page, y + 20, { x, w: colW, color: rgb(0.65, 0.68, 0.72) });
    text(page, 'Name', { x, y: y + 11, size: 6.6, font, color: MUTED });
    rule(page, y, { x, w: colW, color: rgb(0.65, 0.68, 0.72) });
    text(page, 'Signature and date', { x, y: y - 9, size: 6.6, font, color: MUTED });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Eyeball the output once**

Automated tests confirm it renders; they cannot tell you it looks right. Write a scratch script that builds a report object with realistic values and writes `daily-summary-sample.pdf`, then open it. Check: nothing overlaps, the sign-off is at the foot of the last page, and the pending table is not orphaned from its heading. Delete the scratch script before committing.

- [ ] **Step 6: Commit**

```bash
git add server/services/dailySummaryPdf.cjs server/services/dailySummaryPdf.test.cjs
git commit -m "feat(daily-summary): render the report as a signable A4 PDF"
```

---

### Task 5: Settings, email, and the scheduler

**Files:**
- Create: `server/services/dailySummary.cjs`
- Test: `server/services/dailySummary.test.cjs`
- Modify: `server/index.cjs` (~line 203, beside the other schedulers)

**Interfaces:**
- Consumes: `buildReport` (Task 3), `generateDailySummaryPdf` (Task 4), `emailService.sendEmail`.
- Produces:
  - `getDailySummarySettings() → Promise<row>`
  - `updateDailySummarySettings({ enabled, time, to, cc }) → Promise<row>`
  - `isDue({ enabled, time, lastRun }, now) → boolean`
  - `localDateString(date) → 'YYYY-MM-DD'`
  - `previousDay(iso) → 'YYYY-MM-DD'`
  - `buildEmailBody(report) → string` (HTML)
  - `sendDailySummary() → Promise<summary>` — always commits; it mails the real list
  - `renderPdfFor(reportDate, { commit }) → Promise<Uint8Array>`
  - `scheduleDailySummary()`, `getDailySummaryState()`

- [ ] **Step 1: Write the failing test**

Create `server/services/dailySummary.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const summary = require('./dailySummary.cjs');

const at = (hhmm, date = '2026-08-29') => new Date(`${date}T${hhmm}:00`);

test('a disabled summary is never due', () => {
  assert.equal(summary.isDue({ enabled: false, time: '06:00', lastRun: null }, at('07:00')), false);
});

test('the summary is due at or after its time, once a day', () => {
  const cfg = { enabled: true, time: '06:00', lastRun: null };
  assert.equal(summary.isDue(cfg, at('05:59')), false);
  assert.equal(summary.isDue(cfg, at('06:00')), true);
  assert.equal(summary.isDue(cfg, at('23:30')), true);
});

test('a summary that already ran today stays quiet', () => {
  assert.equal(summary.isDue({ enabled: true, time: '06:00', lastRun: '2026-08-29' }, at('07:00')), false);
  assert.equal(summary.isDue({ enabled: true, time: '06:00', lastRun: '2026-08-28' }, at('07:00')), true);
});

test('a run missed while the server was down goes out on the next tick', () => {
  assert.equal(summary.isDue({ enabled: true, time: '06:00', lastRun: '2026-08-25' }, at('14:00')), true);
});

test('a timestamp-shaped last_run is compared by day, not by string', () => {
  assert.equal(summary.isDue(
    { enabled: true, time: '06:00', lastRun: '2026-08-29T00:00:00.000Z' }, at('07:00')), false);
});

test('the report covers the day before the run, across a month boundary', () => {
  assert.equal(summary.previousDay('2026-08-29'), '2026-08-28');
  assert.equal(summary.previousDay('2026-09-01'), '2026-08-31');
  assert.equal(summary.previousDay('2026-01-01'), '2025-12-31');
  assert.equal(summary.previousDay('2026-03-01'), '2026-02-28');
});

test('the email body carries every headline number and escapes its input', () => {
  const html = summary.buildEmailBody({
    reportDate: '2026-08-28',
    activity: [{ key: 'requested', label: 'Die orders <requested>', count: 3 }],
    activityTotal: 3, late: [], lateTotal: 0,
    pending: [{ status: 'PENDING FOR PR', label: 'Pending PR', count: 2, oldestDays: 11 }],
    unparseable: [],
  });
  assert.match(html, /Die orders &lt;requested&gt;/, 'labels must be escaped, not injected');
  assert.match(html, />3</);
  assert.match(html, /Pending PR/);
  assert.match(html, />11</);
});

test('the email body names the late count when there is one', () => {
  const base = {
    reportDate: '2026-08-28', activity: [], activityTotal: 0,
    pending: [], unparseable: [],
  };
  assert.doesNotMatch(summary.buildEmailBody({ ...base, late: [], lateTotal: 0 }), /recorded late/i);
  assert.match(summary.buildEmailBody({ ...base, late: [], lateTotal: 4 }), /4[^<]*recorded late/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './dailySummary.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `server/services/dailySummary.cjs`. Structure it on `focReminder.cjs`: pure `isDue` and `localDateString` exported for testing, everything else async.

```js
'use strict';

// The daily summary report: settings, the once-a-minute scheduler tick, and the
// 06:00 email. The only module here that talks to the mailer.

const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const { buildReport } = require('./dailySummaryData.cjs');
const { generateDailySummaryPdf } = require('./dailySummaryPdf.cjs');

let tickInterval = null;

const state = { lastRun: null, lastResult: null, error: null, running: false };

// ── Settings ────────────────────────────────────────────────────────────────

async function getDailySummarySettings() {
    const result = await pool.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
    if (result.rows.length > 0) return result.rows[0];
    const inserted = await pool.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *');
    return inserted.rows[0];
}

async function updateDailySummarySettings({ enabled, time, to, cc }) {
    const existing = await getDailySummarySettings();
    const result = await pool.query(`
        UPDATE reminder_settings SET
            daily_summary_enabled = COALESCE($1, daily_summary_enabled),
            daily_summary_time    = COALESCE($2, daily_summary_time),
            daily_summary_to      = COALESCE($3, daily_summary_to),
            daily_summary_cc      = COALESCE($4, daily_summary_cc),
            updated_at            = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
    `, [enabled, time, to, cc, existing.id]);
    return result.rows[0];
}

// ── Dates ───────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

function localDateString(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// last_run comes back as a DATE, but a timestamp-shaped value has turned up
// before; compare by day rather than by string.
const day = (value) => (value ? String(value).slice(0, 10) : null);

function previousDay(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function isDue({ enabled, time, lastRun }, now = new Date()) {
    if (!enabled) return false;
    const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (nowHHMM < (time || '06:00')) return false;
    return day(lastRun) !== localDateString(now);
}

// ── Email body ──────────────────────────────────────────────────────────────

function escapeHtml(value) {
    return (value === null || value === undefined || value === '' ? '-' : value)
        .toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TD = 'padding:7px 10px;border:1px solid #CBD5E1;';
const TH = 'padding:8px 10px;border:1px solid #CBD5E1;background:#E2E8F0;color:#0F172A;text-align:left;';

// The numbers are repeated in the body on purpose: the PDF is the record, but
// nobody opens an attachment on a phone at six in the morning.
function buildEmailBody(report) {
    const activityRows = report.activity.map((a) => `
        <tr><td style="${TD}">${escapeHtml(a.label)}</td>
            <td style="${TD}text-align:right;font-weight:600;">${a.count}</td></tr>`).join('');

    const pendingRows = report.pending.map((p) => `
        <tr><td style="${TD}">${escapeHtml(p.label)}</td>
            <td style="${TD}text-align:right;font-weight:600;">${p.count}</td>
            <td style="${TD}text-align:right;">${p.oldestDays === null ? '-' : p.oldestDays}</td></tr>`).join('');

    const lateNote = report.lateTotal > 0
        ? `<p style="font-size:13px;color:#B45309;">${report.lateTotal} entr${report.lateTotal === 1 ? 'y was' : 'ies were'} recorded late and are listed in the attached PDF.</p>`
        : '';

    return `
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
        <p>Daily die order summary for <strong>${escapeHtml(report.reportDate)}</strong>.</p>

        <h3 style="font-size:13px;margin:18px 0 6px;">Activity recorded for this day</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <thead><tr><th style="${TH}">Stage</th><th style="${TH}text-align:right;">Count</th></tr></thead>
            <tbody>${activityRows}
                <tr><td style="${TD}font-weight:700;">Total movements</td>
                    <td style="${TD}text-align:right;font-weight:700;">${report.activityTotal}</td></tr>
            </tbody>
        </table>
        ${lateNote}

        <h3 style="font-size:13px;margin:18px 0 6px;">Pending at each stage</h3>
        <p style="font-size:11px;color:#64748B;margin:0 0 6px;">
            Position as at the time of generation, not as at the report date.</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <thead><tr><th style="${TH}">Stage</th><th style="${TH}text-align:right;">Orders</th>
                <th style="${TH}text-align:right;">Oldest waiting (days)</th></tr></thead>
            <tbody>${pendingRows}</tbody>
        </table>

        <p style="font-size:11px;color:#64748B;margin-top:18px;">
            The attached PDF is the signable copy. Generated automatically by the Die Ordering System.</p>
        </div>`;
}

// ── Generation and sending ──────────────────────────────────────────────────

function readLogo() {
    // server/assets, not public/. Dockerfile.backend copies only server/, so a
    // path into public/ resolves in dev and silently yields an unbranded PDF in
    // the container -- which is where the real reports are generated.
    try {
        return fs.readFileSync(path.join(__dirname, '..', 'assets', 'company-logo.png'));
    } catch { return null; }
}

async function renderPdfFor(reportDate, { commit }) {
    const report = await buildReport(pool, {
        reportDate, today: localDateString(), commit,
    });
    const bytes = await generateDailySummaryPdf(report, {
        logoBytes: readLogo(),
        generatedAt: new Date(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'UTC',
    });
    return { report, bytes };
}

// `commit` is always true here: this function sends to the real recipient list,
// so anything it reports has been reported. Only the download preview passes
// false, and it does not come through here.
async function sendDailySummary() {
    if (state.running) return { skipped: 'already running' };
    state.running = true;
    try {
        const settings = await getDailySummarySettings();
        const to = String(settings.daily_summary_to || '').trim();

        // Sending nowhere is not a run. Returning without stamping last_run
        // means configuring recipients later today still produces the report.
        if (!to) {
            state.lastRun = new Date().toISOString();
            state.lastResult = { skipped: 'no recipients configured' };
            state.error = null;
            return state.lastResult;
        }

        const reportDate = previousDay(localDateString());
        const { report, bytes } = await renderPdfFor(reportDate, { commit: true });

        await emailService.sendEmail({
            to,
            cc: String(settings.daily_summary_cc || '').trim() || null,
            subject: `Daily Die Order Summary - ${reportDate}`,
            body: buildEmailBody(report),
            attachments: [{
                filename: `Daily-Die-Summary-${reportDate}.pdf`,
                content: Buffer.from(bytes),
                contentType: 'application/pdf',
            }],
        });

        await pool.query(
            'UPDATE reminder_settings SET daily_summary_last_run = CURRENT_DATE WHERE id = $1',
            [settings.id]
        );

        state.lastRun = new Date().toISOString();
        state.lastResult = {
            reportDate, movements: report.activityTotal, late: report.lateTotal, recipients: to,
        };
        state.error = null;
        return state.lastResult;
    } catch (error) {
        state.lastRun = new Date().toISOString();
        state.error = error.message;
        console.error('Daily summary run error:', error.message);
        throw error;
    } finally {
        state.running = false;
    }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

async function dailySummaryTick() {
    try {
        const settings = await getDailySummarySettings();
        if (!isDue({
            enabled: settings.daily_summary_enabled,
            time: settings.daily_summary_time,
            lastRun: settings.daily_summary_last_run,
        })) return;
        await sendDailySummary();
    } catch {
        // Already logged in sendDailySummary; never let the tick throw.
    }
}

function scheduleDailySummary() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(dailySummaryTick, 60 * 1000);
    // Print the clock the scheduler compares against -- a container without TZ
    // set runs on UTC, which silently shifts when the report goes out.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'UTC';
    console.log(`Daily summary scheduler started (checks every minute; ` +
        `server time ${new Date().toLocaleTimeString('en-GB')} ${tz})`);
}

const getDailySummaryState = () => ({ ...state });

module.exports = {
    getDailySummarySettings, updateDailySummarySettings,
    isDue, localDateString, previousDay, buildEmailBody,
    renderPdfFor, sendDailySummary, scheduleDailySummary, getDailySummaryState,
};
```

- [ ] **Step 4: Start the scheduler**

In `server/index.cjs`, add the require beside the others (~line 26):

```js
const dailySummaryService = require('./services/dailySummary.cjs');
```

and start it beside `focReminderService.scheduleFocReminders();` (~line 203):

```js
        // Daily summary of the previous day's activity (runs when enabled in settings)
        dailySummaryService.scheduleDailySummary();
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/dailySummary.cjs server/services/dailySummary.test.cjs server/index.cjs
git commit -m "feat(daily-summary): settings, morning email, and the 06:00 scheduler"
```

---

### Task 6: Endpoints and client methods

**Files:**
- Modify: `server/routes/email.cjs` (after the FOC block, ~line 340)
- Modify: `src/api.js` (inside `emailAPI`, after `runFocRemindersNow`)

**Interfaces:**
- Consumes: everything `dailySummary.cjs` exports.
- Produces: `emailAPI.getDailySummarySettings`, `.updateDailySummarySettings`, `.runDailySummaryNow`, `.downloadDailySummaryPdf`.

- [ ] **Step 1: Add the routes**

In `server/routes/email.cjs`, add the require at the top beside the others, then after the FOC `run-now` route:

```js
// ── Daily summary ─────────────────────────────────────────────────────────────

router.get('/daily-summary-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const settings = await dailySummaryService.getDailySummarySettings();
        res.json({ settings, state: dailySummaryService.getDailySummaryState() });
    } catch (error) {
        console.error('Get daily summary settings error:', error);
        res.status(500).json({ error: 'Failed to fetch daily summary settings' });
    }
});

router.put('/daily-summary-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const { enabled, time, to, cc } = req.body;

        if (enabled !== undefined && typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        if (time !== undefined && !HHMM.test(time)) {
            return res.status(400).json({ error: 'time must be in HH:MM (24-hour) format' });
        }

        const recipients = to === undefined ? undefined : String(to).trim();
        // Turning it on with nobody to send to would fail quietly every morning.
        if (enabled === true && recipients !== undefined && !recipients) {
            return res.status(400).json({ error: 'At least one recipient is required to enable the daily summary' });
        }

        const settings = await dailySummaryService.updateDailySummarySettings({
            enabled, time, to: recipients,
            cc: cc === undefined ? undefined : String(cc).trim(),
        });
        res.json({ message: 'Daily summary settings updated', settings });
    } catch (error) {
        console.error('Update daily summary settings error:', error);
        res.status(500).json({ error: 'Failed to update daily summary settings' });
    }
});

// Sends the real report to the real recipient list, now. It commits to the
// ledger for exactly that reason -- see the spec's "What commits to the ledger".
// The PDF download below is the preview that does not.
router.post('/daily-summary-settings/run-now', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const summary = await dailySummaryService.sendDailySummary();
        res.json({ message: 'Daily summary sent', summary });
    } catch (error) {
        console.error('Manual daily summary run error:', error);
        res.status(500).json({ error: error.message || 'Failed to send the daily summary' });
    }
});

// Preview only: renders the identical PDF and writes nothing to the ledger.
router.get('/daily-summary.pdf', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const date = String(req.query.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
        }

        const { bytes } = await dailySummaryService.renderPdfFor(date, { commit: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Daily-Die-Summary-${date}.pdf"`);
        res.send(Buffer.from(bytes));
    } catch (error) {
        console.error('Daily summary PDF error:', error);
        res.status(500).json({ error: 'Failed to generate the daily summary PDF' });
    }
});
```

- [ ] **Step 2: Add the client methods**

In `src/api.js`, inside `emailAPI` after `runFocRemindersNow`:

```js
    getDailySummarySettings: async () => {
        return apiRequest('/email/daily-summary-settings');
    },

    updateDailySummarySettings: async (settings) => {
        return apiRequest('/email/daily-summary-settings', {
            method: 'PUT',
            body: JSON.stringify(settings),
        });
    },

    // Sends to the configured recipients immediately. Use downloadDailySummaryPdf
    // to preview -- that one writes nothing.
    runDailySummaryNow: async () => {
        return apiRequest('/email/daily-summary-settings/run-now', { method: 'POST' });
    },

    // Returns a Blob. Preview only: the report is rebuilt server-side and no
    // ledger rows are consumed.
    downloadDailySummaryPdf: async (date) => {
        const response = await fetch(`${API_BASE_URL}/email/daily-summary.pdf?date=${encodeURIComponent(date)}`, {
            headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!response.ok) {
            let message = nonApiErrorMessage(response.status);
            try { message = (await response.json()).error || message; } catch { /* not JSON */ }
            throw new Error(message);
        }
        return response.blob();
    },
```

- [ ] **Step 3: Verify the endpoints against a running backend**

```bash
docker compose build backend && docker compose up -d backend
```

Then, through the nginx proxy on port 80 (port 3001 is internal-only), log in as admin and confirm `GET /api/email/daily-summary-settings` returns the five new fields, and that `GET /api/email/daily-summary.pdf?date=<yesterday>` returns a PDF.

Critically, confirm the preview wrote nothing:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) FROM daily_report_ledger;"
```

Run this before and after the download. The two numbers must be identical. This is the one failure mode that would be hard to notice later.

- [ ] **Step 4: Lint and commit**

```bash
npx eslint src/api.js
git add server/routes/email.cjs src/api.js
git commit -m "feat(daily-summary): settings, run-now and preview-download endpoints"
```

---

### Task 7: The settings panel

**Files:**
- Create: `src/components/email/settingsStyles.jsx`
- Create: `src/components/email/DailySummarySettings.jsx`
- Modify: `src/components/email/EmailSettings.jsx`

**Interfaces:**
- Consumes: the four `emailAPI` methods from Task 6.
- Produces: nothing other modules depend on.

`EmailSettings.jsx` is already 749 lines and defines `inputStyle`, `cardStyle` and `ToggleButton` *inside* its render function. A fourth panel inline would push it past 950, and copying those three into a new file would duplicate them. Extract them first — a small, mechanical change to code this task has to touch anyway. It also fixes a real bug in passing: `ToggleButton` declared inside the component is a new component type on every render, so React unmounts and remounts it each time.

- [ ] **Step 1: Extract the shared styles**

Create `src/components/email/settingsStyles.jsx`. Move `inputStyle`, `cardStyle` and `ToggleButton` out of `EmailSettings.jsx` verbatim, turning the first two into functions of `theme`:

```jsx
import React from 'react';

// Extracted from EmailSettings so the daily-summary panel can share them rather
// than carry a second copy. ToggleButton in particular was declared inside
// EmailSettings' render, which made it a fresh component type every render and
// remounted it on each keystroke elsewhere in the form.

export const inputStyle = (theme) => ({
  width: '100%',
  padding: '12px 14px',
  background: theme.inputBg,
  border: `1px solid ${theme.cardBorder}`,
  borderRadius: '10px',
  color: theme.text,
  fontSize: '0.875rem',
  outline: 'none',
  boxSizing: 'border-box'
});

export const cardStyle = (theme) => ({
  background: theme.cardBg, borderRadius: '20px',
  padding: '24px', border: `1px solid ${theme.cardBorder}`,
  boxShadow: theme.shadowMd,
  marginBottom: '1.5rem'
});

export const ToggleButton = ({ enabled, onToggle, label, sublabel, icon: Icon, color, theme }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <Icon size={20} color={enabled ? color : theme.textDim} />
      <div>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: 0 }}>{label}</h3>
        <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: '2px 0 0' }}>{sublabel}</p>
      </div>
    </div>
    <button
      onClick={onToggle}
      style={{
        width: '52px', height: '28px', borderRadius: '14px',
        background: enabled ? color : theme.cardBorder,
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background 0.2s'
      }}
    >
      <div style={{
        width: '22px', height: '22px', borderRadius: '50%',
        background: 'white', position: 'absolute', top: '3px',
        left: enabled ? '27px' : '3px',
        transition: 'left 0.2s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
      }} />
    </button>
  </div>
);
```

Update `EmailSettings.jsx` to import these and delete its local copies. Every existing use of `style={inputStyle}` becomes `style={inputStyle(theme)}`, `style={cardStyle}` becomes `style={cardStyle(theme)}`, and every `<ToggleButton ... />` gains `theme={theme}`.

- [ ] **Step 2: Verify the extraction changed nothing**

```bash
npx eslint src/components/email/EmailSettings.jsx src/components/email/settingsStyles.jsx && npm run build
```

Then open Settings → Email in the browser and confirm all three existing panels look exactly as before. This step must be visually verified before moving on — a styling regression here is easy to introduce and easy to miss.

- [ ] **Step 3: Commit the extraction on its own**

Keeping it separate means the next commit's diff is only the new feature.

```bash
git add src/components/email/settingsStyles.jsx src/components/email/EmailSettings.jsx
git commit -m "refactor(email-settings): extract shared panel styles and ToggleButton"
```

- [ ] **Step 4: Build the panel**

Create `src/components/email/DailySummarySettings.jsx`:

```jsx
import React, { useState, useEffect } from 'react';
import { FileText, Save, Send, Download, CheckCircle, XCircle } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, cardStyle, ToggleButton } from './settingsStyles';

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const DailySummarySettings = ({ theme, showToast }) => {
  const [settings, setSettings] = useState({ enabled: false, time: '06:00', to: '', cc: '' });
  const [state, setState] = useState(null);
  const [lastRunDate, setLastRunDate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewDate, setPreviewDate] = useState(yesterday);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const result = await emailAPI.getDailySummarySettings();
      const s = result.settings || {};
      setSettings({
        enabled: s.daily_summary_enabled || false,
        time: s.daily_summary_time || '06:00',
        to: s.daily_summary_to || '',
        cc: s.daily_summary_cc || '',
      });
      setState(result.state);
      setLastRunDate(s.daily_summary_last_run);
    } catch (err) {
      console.error('Failed to fetch daily summary settings:', err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await emailAPI.updateDailySummarySettings(settings);
      showToast('Daily summary settings saved', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to save daily summary settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    setSending(true);
    try {
      const result = await emailAPI.runDailySummaryNow();
      showToast(result.summary?.skipped
        ? `Not sent — ${result.summary.skipped}`
        : `Daily summary sent to ${result.summary?.recipients || 'the configured recipients'}`,
        result.summary?.skipped ? 'error' : 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to send the daily summary', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await emailAPI.downloadDailySummaryPdf(previewDate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Daily-Die-Summary-${previewDate}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message || 'Failed to download the report', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const label = { display: 'block', fontSize: '0.75rem', fontWeight: 600,
    color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' };
  const hint = { fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' };

  return (
    <div style={cardStyle(theme)}>
      <ToggleButton
        theme={theme}
        enabled={settings.enabled}
        onToggle={() => setSettings({ ...settings, enabled: !settings.enabled })}
        label="Daily Summary Report"
        sublabel={settings.enabled
          ? `Active — every day at ${settings.time}, covering the previous day`
          : 'Disabled — no daily summary will be sent'}
        icon={FileText}
        color="#0EA5E9"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '18px' }}>
        <div>
          <label style={label} htmlFor="dailysummary-time">Send Time</label>
          <input id="dailysummary-time" type="time" value={settings.time}
            onChange={(e) => setSettings({ ...settings, time: e.target.value || '06:00' })}
            style={inputStyle(theme)} />
          <p style={hint}>Server time, Asia/Dubai. The report covers the previous day.</p>
        </div>
        <div>
          <label style={label} htmlFor="dailysummary-cc">CC (optional)</label>
          <input id="dailysummary-cc" type="text" value={settings.cc}
            onChange={(e) => setSettings({ ...settings, cc: e.target.value })}
            placeholder="name@company.com, other@company.com" style={inputStyle(theme)} />
          <p style={hint}>Comma-separated.</p>
        </div>
      </div>

      <div style={{ marginTop: '12px' }}>
        <label style={label} htmlFor="dailysummary-to">Recipients</label>
        <input id="dailysummary-to" type="text" value={settings.to}
          onChange={(e) => setSettings({ ...settings, to: e.target.value })}
          placeholder="name@company.com, other@company.com" style={inputStyle(theme)} />
        <p style={hint}>Comma-separated. Required to enable. Needs outgoing email (SMTP) to be enabled.</p>
      </div>

      {(state?.error || lastRunDate) && (
        <div style={{
          marginTop: '14px', padding: '10px 14px', borderRadius: '10px',
          background: state?.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
          fontSize: '0.8rem', color: state?.error ? '#EF4444' : '#10B981',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          {state?.error
            ? <><XCircle size={14} /> Last run error: {state.error}</>
            : <><CheckCircle size={14} /> Last run: {lastRunDate}
              {state?.lastResult?.reportDate
                ? ` — ${state.lastResult.movements} movement(s) for ${state.lastResult.reportDate}`
                : ''}</>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <button onClick={handleSave} disabled={saving} style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px',
          borderRadius: '12px', border: 'none', background: '#0EA5E9', color: '#fff',
          fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
        }}>
          <Save size={15} /> {saving ? 'Saving…' : 'Save'}
        </button>

        <button onClick={handleSendNow} disabled={sending} style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px',
          borderRadius: '12px', border: `1px solid ${theme.border}`,
          background: 'transparent', color: theme.text, fontWeight: 600,
          cursor: sending ? 'wait' : 'pointer',
        }}>
          <Send size={15} /> {sending ? 'Sending…' : 'Send now'}
        </button>

        <div>
          <label style={label} htmlFor="dailysummary-preview-date">Preview a day</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input id="dailysummary-preview-date" type="date" value={previewDate}
              onChange={(e) => setPreviewDate(e.target.value)} style={inputStyle(theme)} />
            <button onClick={handleDownload} disabled={downloading || !previewDate} style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px',
              borderRadius: '12px', border: `1px solid ${theme.border}`,
              background: 'transparent', color: theme.text, fontWeight: 600,
              cursor: downloading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}>
              <Download size={15} /> {downloading ? '…' : 'Download'}
            </button>
          </div>
        </div>
      </div>

      {/* The distinction matters: one mails people, the other does not. */}
      <p style={{ ...hint, marginTop: '12px' }}>
        <strong>Send now</strong> emails the report for yesterday to the recipients above straight away.
        <strong> Download</strong> only builds a copy for you — it sends nothing and changes nothing.
      </p>
    </div>
  );
};

export default DailySummarySettings;
```

- [ ] **Step 5: Render it**

In `EmailSettings.jsx`, import the panel and render it after the FOC reminder card, passing `theme` and the existing `showToast`.

- [ ] **Step 6: Verify in the browser**

```bash
npx eslint src/components/email/DailySummarySettings.jsx && npm run build
```

To reach the API from the vite dev server, point `vite.config.js`'s `/api` proxy at `http://localhost:80` for the duration of the check (3001 is internal-only, and nginx already proxies `/api/`), then revert it.

Confirm: saving persists; enabling with an empty recipient list is refused with the server's message; **Download** produces a PDF and leaves `SELECT count(*) FROM daily_report_ledger` unchanged; the panel reads correctly in both light and dark themes.

- [ ] **Step 7: Commit**

```bash
git add src/components/email/DailySummarySettings.jsx src/components/email/EmailSettings.jsx
git commit -m "feat(daily-summary): settings panel with send-now and preview download"
```

---

## Final verification

- [ ] `npm test` — all suites pass, including the pre-existing ones.
- [ ] `npx eslint` clean on every file this plan touched (the repo has 77 pre-existing problems elsewhere; do not try to fix those here).
- [ ] `npm run build` succeeds.
- [ ] `docker compose build backend && docker compose up -d backend` — logs show both the seed line and `Daily summary scheduler started`.
- [ ] End-to-end: set the send time to two minutes from now, enable with a real recipient, and confirm the email arrives with the PDF attached, `daily_summary_last_run` is stamped, and the ledger grew by exactly the number of stages reported.
- [ ] Re-run the same day via **Send now**: the second report carries the *same* counts as the first and the ledger does not grow. Identical output plus no new rows is what idempotence means here — zeros on the second run would mean the ledger is gagging the headline counts.

## Deferred

Per-plant reports, weekly and monthly rollups, digital signature stamping, and restating corrected dates are all out of scope. `buildReport` takes its rows from one query, so adding a plant filter later is a `WHERE` clause and a settings field, not a rewrite.
