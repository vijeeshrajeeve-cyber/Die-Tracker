# QD Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Quality Discrepancy (QD) Tracker — a new top-level page that records quality discrepancies raised against received dies, with a QD Register tab, a Supplier Summary tab, a detail drawer with activity timeline, and a Raise QD modal — backed by real Postgres persistence and file uploads.

**Architecture:** Mirrors the Frozen Designs feature end-to-end: three new tables (`quality_discrepancies`, `quality_discrepancy_activity`, `quality_discrepancy_files`) created by an idempotent migration in `server/db.cjs`; a pure-logic service (`qualityDiscrepancies.cjs`) that computes ages, KPIs, supplier stats and trends in JS from fetched rows (data volume is small — 6 rows today, hundreds at most); a storage service for attachments on a Docker volume; a REST router mounted with `authMiddleware` + `pageAccessMiddleware('qd-tracker')`; and a React page split into three focused components (page, detail drawer, raise modal).

**Tech Stack:** Node 20 + Express 5 + Postgres (`pg`), multer for uploads, `node:test` for backend tests. React 19 + Vite, `lucide-react` icons, inline styles (repo convention — no CSS framework).

**Source design:** `Quality discrepancy tracker-handoff.zip` → `quality-discrepancy-tracker/project/QD Tracker.dc.html`. Read it before starting. The design is a prototype: recreate its **visual output**, not its `sc-for`/`sc-if` internals.

## Global Constraints

- **Statuses (exactly these 7, exact casing):** `Open`, `Sent to Supplier`, `FOC Accepted`, `Rejected`, `Reference`, `Rework In-house`, `Closed`.
- **Open statuses** (count toward "open"): `Open`, `Sent to Supplier`, `Rework In-house`, `Rejected`.
- **Outcomes sought (exactly these 5):** `Supplier rework`, `FOC replacement`, `In-house correction`, `Credit note`, `Reference only`.
- **No fabricated numbers.** Every KPI, supplier stat and trend is computed from real rows. Where a value is not derivable, render `—`. The prototype's invented figures (`FOC recovered: 2`, `Avg resolution: 38d`, per-supplier `avg`/`trend`, and the `extras` stats for Kompass/Almax/Decoral/UBE Tools/Exal) must NOT be copied.
- **Page id** is `qd-tracker` everywhere (sidebar tab id, `CONTROLLABLE_PAGES` id, `pageAccessMiddleware` arg).
- **API base** is `/api/quality-discrepancies`.
- Inline styles only, matching `FrozenDesignsPage.jsx`. Theme tokens come from the `theme` prop with dark-zinc defaults (`bg #09090b`, `border #27272a`, `text #fafafa`, `muted #a1a1aa`, `dim #71717a`).
- Do NOT edit `server/db.cjs` migrations destructively — append idempotent blocks only, and mirror them in `init.sql`.
- Backend tests mock the pg pool (see `server/services/frozenDesigns.test.cjs`). Frontend has no test framework — verify with `npm run lint` + `npm run build`.

---

## File Structure

**Create:**
- `server/services/qualityDiscrepancies.cjs` — status vocabulary, sheet-status mapping, age/KPI/supplier-stat/trend computation, list/create/update/activity queries.
- `server/services/qualityDiscrepancies.test.cjs` — unit tests for the pure logic.
- `server/services/qdStorage.cjs` — attachment path/extension rules.
- `server/services/qdStorage.test.cjs` — unit tests for storage rules.
- `server/routes/quality-discrepancies.cjs` — REST router.
- `server/scripts/import-qd-sheet.cjs` — manual one-off importer for `sample.xlsx`.
- `src/pages/QDTrackerPage.jsx` — page shell, tabs, KPIs, filters, register table, supplier summary.
- `src/components/qd/QDDetailPanel.jsx` — right-hand drawer: facts, issue, files, activity timeline, note box, status change.
- `src/components/qd/RaiseQDModal.jsx` — Raise QD modal.

**Modify:**
- `server/db.cjs` — append migration block (after the Frozen Designs block, ~line 374).
- `init.sql` — mirror the three tables for fresh installs.
- `server/index.cjs` — require + mount router.
- `src/api.js` — add `qualityDiscrepanciesAPI`.
- `src/utils/constants.js` — `QD_STATUS_CONFIG`, `QD_OUTCOMES`, `CONTROLLABLE_PAGES` entry.
- `src/components/layout/Sidebar.jsx` — nav entry.
- `src/DieOrderingSystem.jsx` — import + `activeTab === 'qd-tracker'` branch.
- `docker-compose.yml`, `Dockerfile.backend` — `QD_FILES_ROOT` env + volume.

---

## Data Model

```
quality_discrepancies
  id             SERIAL PK
  qd_no          TEXT UNIQUE NOT NULL     -- '2026GI-03'
  die_no         TEXT NOT NULL            -- '019480-2505'
  profile_number TEXT                     -- derived via extractProfileFromDie(die_no)
  die_order_id   INTEGER REFERENCES die_orders(id)   -- soft link, nullable
  raised_date    DATE NOT NULL
  plant          TEXT NOT NULL            -- 'GEX 1' | 'GEX 2'
  supplier       TEXT NOT NULL
  corrector      TEXT
  status         TEXT NOT NULL DEFAULT 'Open'
  outcome        TEXT                     -- outcome sought
  issue_summary  TEXT NOT NULL            -- one line, shown in table
  issue_detail   TEXT                     -- full paragraph, shown in drawer
  eta_date       DATE
  input_at_failure TEXT                   -- '3,417 kg', '>10 mT'
  closed_at      DATE
  created_by     INTEGER REFERENCES users(id)
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP

quality_discrepancy_activity
  id, qd_id FK ON DELETE CASCADE, actor TEXT, action TEXT,
  icon TEXT, tone TEXT, occurred_at TIMESTAMP, user_id FK

quality_discrepancy_files
  id, qd_id FK ON DELETE CASCADE, original_name, stored_path,
  mime_type, size_bytes, uploaded_by FK, uploaded_at
```

**Derived semantics (never stored):**
- `age_days` = `closed_at ? 0 : days(today − raised_date)`. The drawer shows `Closed` when age is 0 and status is `Closed`. Age colour: `>40 → #FCA5A5`, `>20 → #FBBF24`, else `var(--fg-muted)` — matching the design.
- `resolution_days` = `closed_at − raised_date`, only for closed rows; feeds Avg resolution.
- ETA display: `eta_date` null → `—`; `eta_date < today` and not closed → `Overdue`; else the ISO date.
- **FY for "FOC recovered"** = calendar year to date (Jan 1 → today). Counts rows with `status = 'FOC Accepted'` and `raised_date` in that window.

---

### Task 1: Database migration

**Files:**
- Modify: `server/db.cjs` (append after the Frozen Designs `DO $$` block ending ~line 374)
- Modify: `init.sql`

**Interfaces:**
- Produces: tables `quality_discrepancies`, `quality_discrepancy_activity`, `quality_discrepancy_files` used by every later backend task.

- [ ] **Step 1: Append the migration to `server/db.cjs`**

Insert this SQL inside the same big template-literal query, immediately after the Frozen Designs `END $$;` (~line 374) and before the `-- Press master` comment:

```sql
      -- ── Quality Discrepancies (QD Tracker) ──────────────────────────────
      CREATE TABLE IF NOT EXISTS quality_discrepancies (
        id SERIAL PRIMARY KEY,
        qd_no            TEXT UNIQUE NOT NULL,
        die_no           TEXT NOT NULL,
        profile_number   TEXT,
        die_order_id     INTEGER REFERENCES die_orders(id),
        raised_date      DATE NOT NULL,
        plant            TEXT NOT NULL,
        supplier         TEXT NOT NULL,
        corrector        TEXT,
        status           TEXT NOT NULL DEFAULT 'Open',
        outcome          TEXT,
        issue_summary    TEXT NOT NULL,
        issue_detail     TEXT,
        eta_date         DATE,
        input_at_failure TEXT,
        closed_at        DATE,
        created_by       INTEGER REFERENCES users(id),
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_qd_supplier ON quality_discrepancies (supplier);
      CREATE INDEX IF NOT EXISTS idx_qd_status   ON quality_discrepancies (status);

      CREATE TABLE IF NOT EXISTS quality_discrepancy_activity (
        id SERIAL PRIMARY KEY,
        qd_id       INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE,
        actor       TEXT NOT NULL,
        action      TEXT NOT NULL,
        icon        TEXT,
        tone        TEXT,
        occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id     INTEGER REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_qd_activity_qd ON quality_discrepancy_activity (qd_id);

      CREATE TABLE IF NOT EXISTS quality_discrepancy_files (
        id SERIAL PRIMARY KEY,
        qd_id         INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        stored_path   TEXT NOT NULL,
        mime_type     TEXT,
        size_bytes    BIGINT,
        uploaded_by   INTEGER REFERENCES users(id),
        uploaded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_qd_files_qd ON quality_discrepancy_files (qd_id);
```

- [ ] **Step 2: Mirror the same three `CREATE TABLE` statements in `init.sql`**

Append them verbatim (without the `DO $$` wrapper) at the end of `init.sql`, so fresh installs get the tables.

- [ ] **Step 3: Verify the migration runs**

Run: `docker compose up -d && docker compose logs backend --tail 30`
Expected: no SQL errors; server prints `Die Ordering API Server running`.

Then confirm the tables exist:

Run: `docker exec die-ordering-db psql -U postgres -d die_ordering -c "\d quality_discrepancies"`
Expected: the column list above.

If Docker isn't running, note it and move on — Task 2's tests don't need a live DB.

- [ ] **Step 4: Commit**

```bash
git add server/db.cjs init.sql
git commit -m "feat(qd): add quality discrepancy tables"
```

---

### Task 2: Quality discrepancies service (pure logic + queries)

**Files:**
- Create: `server/services/qualityDiscrepancies.cjs`
- Test: `server/services/qualityDiscrepancies.test.cjs`

**Interfaces:**
- Consumes: `extractProfileFromDie` from `server/services/frozenDesigns.cjs`.
- Produces (used by Tasks 4, 5):
  - `STATUSES: string[]` (7), `OPEN_STATUSES: string[]` (4), `OUTCOMES: string[]` (5)
  - `mapSheetStatus(raw: string) => string`
  - `ageDays(row, now: Date) => number`
  - `resolutionDays(row) => number | null`
  - `etaDisplay(row, now: Date) => string`
  - `computeKpis(rows: Row[], now: Date) => { openCount, atSupplier, focRecovered, avgResolution }`
  - `computeTrend(recent: number, prior: number) => 'up' | 'down' | 'flat'`
  - `summarizeSuppliers(rows: Row[], now: Date) => Array<{ name, total, open, foc, rejected, avg, trend }>`
  - `listQDs(client) => Promise<Row[]>` (rows include `files: []`, `activity: []`)
  - `createQD(client, input) => Promise<number>`
  - `addActivity(client, { qdId, actor, action, icon, tone, userId }) => Promise<void>`
  - `updateStatus(client, { id, status, actor, userId }) => Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Create `server/services/qualityDiscrepancies.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const q = require('./qualityDiscrepancies.cjs');

const NOW = new Date('2026-07-17T00:00:00Z');

test('exposes exactly the 7 agreed statuses and 4 open statuses', () => {
  assert.deepEqual(q.STATUSES, [
    'Open', 'Sent to Supplier', 'FOC Accepted', 'Rejected', 'Reference', 'Rework In-house', 'Closed',
  ]);
  assert.deepEqual(q.OPEN_STATUSES, ['Open', 'Sent to Supplier', 'Rework In-house', 'Rejected']);
});

test('mapSheetStatus maps the legacy Excel vocabulary onto the new one', () => {
  assert.equal(q.mapSheetStatus('OPEN'), 'Open');
  assert.equal(q.mapSheetStatus('Rejected '), 'Rejected');
  assert.equal(q.mapSheetStatus('Refrance'), 'Reference');   // sheet typo
  assert.equal(q.mapSheetStatus('info'), 'Reference');
  assert.equal(q.mapSheetStatus('Completed'), 'Closed');
  assert.equal(q.mapSheetStatus('Hold '), 'Open');
  assert.equal(q.mapSheetStatus('nonsense'), 'Open');        // safe default
});

test('ageDays counts days open, and is 0 once closed', () => {
  assert.equal(q.ageDays({ raised_date: '2026-07-01', closed_at: null }, NOW), 16);
  assert.equal(q.ageDays({ raised_date: '2026-01-05', closed_at: '2026-03-05' }, NOW), 0);
});

test('resolutionDays is raised→closed, null when still open', () => {
  assert.equal(q.resolutionDays({ raised_date: '2026-01-05', closed_at: '2026-02-04' }), 30);
  assert.equal(q.resolutionDays({ raised_date: '2026-01-05', closed_at: null }), null);
});

test('etaDisplay shows dash, the date, or Overdue', () => {
  assert.equal(q.etaDisplay({ eta_date: null, closed_at: null }, NOW), '—');
  assert.equal(q.etaDisplay({ eta_date: '2026-08-29', closed_at: null }, NOW), '2026-08-29');
  assert.equal(q.etaDisplay({ eta_date: '2026-01-01', closed_at: null }, NOW), 'Overdue');
  // a closed QD is never "overdue"
  assert.equal(q.etaDisplay({ eta_date: '2026-01-01', closed_at: '2026-02-01' }, NOW), '2026-01-01');
});

test('computeKpis derives every tile from real rows, with no invented numbers', () => {
  const rows = [
    { status: 'Open',             raised_date: '2026-07-01', closed_at: null },
    { status: 'Sent to Supplier', raised_date: '2026-06-01', closed_at: null },
    { status: 'FOC Accepted',     raised_date: '2026-05-01', closed_at: '2026-06-01' },
    { status: 'Closed',           raised_date: '2026-01-01', closed_at: '2026-01-31' },
    { status: 'FOC Accepted',     raised_date: '2025-05-01', closed_at: '2025-06-01' }, // prior FY
  ];
  const k = q.computeKpis(rows, NOW);
  assert.equal(k.openCount, 2);        // Open + Sent to Supplier
  assert.equal(k.atSupplier, 1);
  assert.equal(k.focRecovered, 1);     // only the current-calendar-year one
  assert.equal(k.avgResolution, 30);   // (31 + 30) / 2 = 30.5 → rounds to 30? see impl
});

test('computeKpis reports avgResolution null when nothing has closed', () => {
  const k = q.computeKpis([{ status: 'Open', raised_date: '2026-07-01', closed_at: null }], NOW);
  assert.equal(k.avgResolution, null);
});

test('computeTrend compares recent vs prior QD counts', () => {
  assert.equal(q.computeTrend(5, 2), 'up');
  assert.equal(q.computeTrend(2, 5), 'down');
  assert.equal(q.computeTrend(3, 3), 'flat');
  assert.equal(q.computeTrend(0, 0), 'flat');
});

test('summarizeSuppliers aggregates real rows and omits suppliers with no QDs', () => {
  const rows = [
    { supplier: 'PDTMC',   status: 'Sent to Supplier', outcome: 'Supplier rework', raised_date: '2026-07-01', closed_at: null },
    { supplier: 'PDTMC',   status: 'Closed',           outcome: 'In-house correction', raised_date: '2026-01-01', closed_at: '2026-01-21' },
    { supplier: 'Phoenix', status: 'Rejected',         outcome: 'FOC requested', raised_date: '2026-06-01', closed_at: null },
  ];
  const out = q.summarizeSuppliers(rows, NOW);
  const pdtmc = out.find(s => s.name === 'PDTMC');
  const phoenix = out.find(s => s.name === 'Phoenix');
  assert.equal(out.length, 2);                 // no fabricated Kompass/Almax/etc.
  assert.equal(pdtmc.total, 2);
  assert.equal(pdtmc.open, 1);
  assert.equal(pdtmc.avg, 20);                 // one closed QD, 20 days
  assert.equal(phoenix.rejected, 1);
  assert.equal(phoenix.avg, null);             // nothing closed → not derivable
  assert.equal(out[0].name, 'PDTMC');          // sorted by open desc, then total desc
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './qualityDiscrepancies.cjs'`.

- [ ] **Step 3: Implement the service**

Create `server/services/qualityDiscrepancies.cjs`:

```js
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
  return rows.map((r) => ({
    ...r,
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

Note on `avgResolution`: `(31 + 30) / 2 = 30.5`, and `Math.round(30.5) = 31` in JS — so the test's `assert.equal(k.avgResolution, 30)` will FAIL. Fix the **test** to expect `31` (the implementation is right; the test comment was wrong). Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): add quality discrepancy service with derived metrics"
```

---

### Task 3: Attachment storage service

**Files:**
- Create: `server/services/qdStorage.cjs`
- Test: `server/services/qdStorage.test.cjs`
- Modify: `docker-compose.yml`, `Dockerfile.backend`

**Interfaces:**
- Produces (used by Task 4): `ALLOWED_EXTENSIONS`, `MAX_FILE_BYTES`, `getRoot()`, `getTmpDir()`, `isAllowedExtension(name)`, `sanitizeFilename(name)`, `buildStoredPath(root, { qdNo, qdId, fileName })`.

- [ ] **Step 1: Write the failing tests**

Create `server/services/qdStorage.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const s = require('./qdStorage.cjs');

test('isAllowedExtension accepts evidence types, rejects executables', () => {
  assert.equal(s.isAllowedExtension('report.PDF'), true);
  assert.equal(s.isAllowedExtension('mandrel.jpg'), true);
  assert.equal(s.isAllowedExtension('shot.jpeg'), true);
  assert.equal(s.isAllowedExtension('shot.png'), true);
  assert.equal(s.isAllowedExtension('virus.exe'), false);
  assert.equal(s.isAllowedExtension('noext'), false);
});

test('sanitizeFilename strips traversal and unsafe chars', () => {
  assert.equal(s.sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(s.sanitizeFilename('Die performance analysis.pdf'), 'Die_performance_analysis.pdf');
  assert.equal(s.sanitizeFilename(''), 'file');
});

test('buildStoredPath composes root/qdNo/qdId/name', () => {
  const root = path.join('/srv', 'qd');
  const out = s.buildStoredPath(root, { qdNo: '2026GI-03', qdId: 7, fileName: 'a b.jpg' });
  assert.equal(out, path.join(root, '2026GI-03', '7', 'a_b.jpg'));
});

test('getTmpDir sits directly under the storage root (same filesystem)', () => {
  assert.equal(s.getTmpDir(), path.join(s.getRoot(), '.uploads-tmp'));
});

test('MAX_FILE_BYTES is 25 MB', () => {
  assert.equal(s.MAX_FILE_BYTES, 25 * 1024 * 1024);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `Cannot find module './qdStorage.cjs'`.

- [ ] **Step 3: Implement**

Create `server/services/qdStorage.cjs`:

```js
'use strict';
const path = require('path');

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — QD evidence is photos and reports

function getRoot() {
  return process.env.QD_FILES_ROOT || '/app/storage/qd-files';
}

// Keep temp uploads on the same filesystem as the storage root so moving a
// finished upload into place is an intra-device rename (no EXDEV).
function getTmpDir() {
  return path.join(getRoot(), '.uploads-tmp');
}

function extOf(name) {
  const base = String(name || '');
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

function isAllowedExtension(name) {
  return ALLOWED_EXTENSIONS.includes(extOf(name));
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || '')).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'file';
}

function sanitizeSegment(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || '_';
}

function buildStoredPath(root, { qdNo, qdId, fileName }) {
  return path.join(root, sanitizeSegment(qdNo), sanitizeSegment(qdId), sanitizeFilename(fileName));
}

module.exports = {
  ALLOWED_EXTENSIONS, MAX_FILE_BYTES,
  getRoot, getTmpDir, isAllowedExtension, sanitizeFilename, sanitizeSegment, buildStoredPath,
};
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire the Docker volume**

In `docker-compose.yml`, next to the existing `FROZEN_DESIGNS_ROOT` env (~line 60) add:

```yaml
      QD_FILES_ROOT: /app/storage/qd-files
```

and next to the `frozen_designs_data` volume mount (~line 63):

```yaml
      - qd_files_data:/app/storage/qd-files
```

Declare `qd_files_data:` in the top-level `volumes:` block alongside `frozen_designs_data:`.

In `Dockerfile.backend` (~line 15), extend the mkdir so the directory exists and is owned by `node`:

```dockerfile
RUN mkdir -p /app/backups /app/storage/frozen-designs /app/storage/qd-files && chown -R node:node /app
```

- [ ] **Step 6: Commit**

```bash
git add server/services/qdStorage.cjs server/services/qdStorage.test.cjs docker-compose.yml Dockerfile.backend
git commit -m "feat(qd): add QD attachment storage service"
```

---

### Task 4: REST router

**Files:**
- Create: `server/routes/quality-discrepancies.cjs`
- Modify: `server/index.cjs`

**Interfaces:**
- Consumes: everything exported by `qualityDiscrepancies.cjs` and `qdStorage.cjs`.
- Produces (used by Task 6):
  - `GET /api/quality-discrepancies` → `{ qds: Row[], kpis, suppliers }`
  - `POST /api/quality-discrepancies` → `{ id, qd_no }`
  - `PATCH /api/quality-discrepancies/:id/status` `{ status }` → `{ message }`
  - `POST /api/quality-discrepancies/:id/notes` `{ note }` → `{ message }`
  - `POST /api/quality-discrepancies/:id/files` (multipart `files`) → `{ files: [{ id, original_name }] }`
  - `GET /api/quality-discrepancies/files/:fileId` → download

- [ ] **Step 1: Implement the router**

Create `server/routes/quality-discrepancies.cjs`:

```js
'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { pool } = require('../db.cjs');
const qd = require('../services/qualityDiscrepancies.cjs');
const store = require('../services/qdStorage.cjs');

const router = express.Router();

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

const actorFor = (req) => req.user?.full_name || req.user?.username || 'You';

// Next QD number for the current year: 2026-01, 2026-02, …
async function nextQdNo(client) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT qd_no FROM quality_discrepancies WHERE qd_no LIKE $1`,
    [`${year}-%`]
  );
  const max = rows.reduce((acc, r) => {
    const n = parseInt(String(r.qd_no).split('-')[1], 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${year}-${String(max + 1).padStart(2, '0')}`;
}

// GET /api/quality-discrepancies → rows + derived KPIs + supplier rollup
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const qds = await qd.listQDs(pool);
    res.json({
      qds,
      kpis: qd.computeKpis(qds, now),
      suppliers: qd.summarizeSuppliers(qds, now),
    });
  } catch (e) {
    console.error('List QDs error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quality-discrepancies
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { dieNo, plant, supplier, corrector, issue, outcome } = req.body;
    if (!String(dieNo || '').trim()) return res.status(400).json({ error: 'Die No is required' });
    if (!String(plant || '').trim()) return res.status(400).json({ error: 'Plant is required' });
    if (!String(supplier || '').trim()) return res.status(400).json({ error: 'Supplier is required' });
    if (outcome && !qd.OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Invalid outcome' });

    const text = String(issue || '').trim() || 'Quality discrepancy raised';
    const summary = text.split('\n')[0].slice(0, 160);

    await client.query('BEGIN');
    const qdNo = await nextQdNo(client);
    const id = await qd.createQD(client, {
      qdNo,
      dieNo: String(dieNo).trim(),
      raisedDate: new Date().toISOString().slice(0, 10),
      plant, supplier,
      corrector: String(corrector || '').trim() || null,
      status: 'Open',
      outcome: outcome || null,
      issueSummary: summary,
      issueDetail: text,
      createdBy: req.user?.id,
    });
    await qd.addActivity(client, {
      qdId: id,
      actor: String(corrector || '').trim() || actorFor(req),
      action: `raised QD against die ${String(dieNo).trim()}`,
      icon: 'flag', tone: 'flag', userId: req.user?.id,
    });
    await client.query('COMMIT');
    res.status(201).json({ id, qd_no: qdNo });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'QD number already exists — retry' });
    console.error('Create QD error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/quality-discrepancies/:id/status  { status }
router.patch('/:id/status', async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body;
    if (!qd.STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await client.query('BEGIN');
    const ok = await qd.updateStatus(client, {
      id: req.params.id, status, actor: actorFor(req), userId: req.user?.id,
    });
    await client.query('COMMIT');
    if (!ok) return res.status(404).json({ error: 'QD not found' });
    res.json({ message: 'Status updated' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Update QD status error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/quality-discrepancies/:id/notes  { note }
router.post('/:id/notes', async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note is required' });
    const exists = await pool.query('SELECT id FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'QD not found' });
    await qd.addActivity(pool, {
      qdId: req.params.id, actor: actorFor(req), action: note,
      icon: 'message-square', tone: 'neutral', userId: req.user?.id,
    });
    res.status(201).json({ message: 'Note added' });
  } catch (e) {
    console.error('Add QD note error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quality-discrepancies/:id/files  (multipart, field "files")
router.post('/:id/files', upload.array('files', 10), async (req, res) => {
  try {
    const meta = await pool.query('SELECT id, qd_no FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (meta.rowCount === 0) return res.status(404).json({ error: 'QD not found' });
    const row = meta.rows[0];
    const root = store.getRoot();
    const saved = [];
    for (const file of (req.files || [])) {
      const dest = store.buildStoredPath(root, { qdNo: row.qd_no, qdId: row.id, fileName: file.originalname });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await moveIntoPlace(file.path, dest);
      const ins = await pool.query(
        `INSERT INTO quality_discrepancy_files (qd_id, original_name, stored_path, mime_type, size_bytes, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [row.id, file.originalname, path.relative(root, dest), file.mimetype, file.size, req.user?.id || null]
      );
      saved.push({ id: ins.rows[0].id, original_name: file.originalname });
    }
    res.status(201).json({ files: saved });
  } catch (e) {
    console.error('Upload QD files error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/quality-discrepancies/files/:fileId
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
```

- [ ] **Step 2: Mount the router in `server/index.cjs`**

Add the require next to the frozen designs one (~line 29):

```js
const qualityDiscrepanciesRouter = require('./routes/quality-discrepancies.cjs');
```

Add the mount next to the frozen-designs mount (~line 96):

```js
app.use('/api/quality-discrepancies', authMiddleware, pageAccessMiddleware('qd-tracker'), qualityDiscrepanciesRouter);
```

- [ ] **Step 3: Verify the server boots**

Run: `node -e "require('./server/routes/quality-discrepancies.cjs'); console.log('router loads OK')"`
Expected: `router loads OK` (no syntax/require errors).

- [ ] **Step 4: Commit**

```bash
git add server/routes/quality-discrepancies.cjs server/index.cjs
git commit -m "feat(qd): add quality discrepancies API"
```

---

### Task 5: Manual import script for the historical sheet

**Files:**
- Create: `server/scripts/import-qd-sheet.cjs`

**Interfaces:**
- Consumes: `qualityDiscrepancies.cjs` (`mapSheetStatus`, `createQD`, `addActivity`).
- Run manually — NOT wired into startup migrations.

The six real records come from the handoff bundle's `uploads/sample.xlsx`. Columns: `QD NO, Die no, Die corrector, Date, Purchase to Supplier, Delay, Plant, Supplier, Corrector, Quality Issue, Status, ETA Date, Die received, Remarks`. Dates are Excel serials (e.g. `45712`). Statuses use the legacy vocabulary and must go through `mapSheetStatus`.

- [ ] **Step 1: Write the script**

Create `server/scripts/import-qd-sheet.cjs`:

```js
'use strict';
// One-off importer for the historical QD Excel sheet.
//   node server/scripts/import-qd-sheet.cjs <path-to-sheet.xlsx> [--dry-run]
// Idempotent: skips any QD NO that already exists.
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../db.cjs');
const qd = require('../services/qualityDiscrepancies.cjs');

// Excel serial date (1900 system) → 'YYYY-MM-DD'
function excelDate(serial) {
  if (serial === '' || serial === null || serial === undefined) return null;
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

const norm = (v) => String(v == null ? '' : v).trim();
// The sheet writes plants as 'GEX-1' / 'Gex-2'; the app uses 'GEX 1' / 'GEX 2'.
const normPlant = (v) => norm(v).toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
const clean = (v) => norm(v).replace(/\r\n/g, '\n');

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file) {
    console.error('Usage: node server/scripts/import-qd-sheet.cjs <sheet.xlsx> [--dry-run]');
    process.exit(1);
  }
  const wb = XLSX.readFile(path.resolve(file));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  let created = 0, skipped = 0;
  for (const r of rows) {
    const qdNo = norm(r['QD NO']);
    const dieNo = norm(r['Die no '] ?? r['Die no']);
    if (!qdNo || !dieNo) { skipped++; continue; }

    const exists = await pool.query('SELECT id FROM quality_discrepancies WHERE qd_no = $1', [qdNo]);
    if (exists.rowCount) { console.log(`skip ${qdNo} (already imported)`); skipped++; continue; }

    const issueText = clean(r['Quality Issue']) || 'Quality discrepancy raised';
    const remarks = clean(r['Remarks '] ?? r['Remarks']);
    const status = qd.mapSheetStatus(r['Status '] ?? r['Status']);
    const raised = excelDate(r['Date']);
    if (!raised) { console.log(`skip ${qdNo} (unparseable date)`); skipped++; continue; }

    const record = {
      qdNo,
      dieNo,
      raisedDate: raised,
      plant: normPlant(r['Plant '] ?? r['Plant']) || 'GEX 2',
      supplier: norm(r['Supplier '] ?? r['Supplier']) || 'Unknown',
      corrector: norm(r['Corrector']) || null,
      status,
      issueSummary: issueText.split('\n')[0].slice(0, 160),
      // Remarks carry the follow-up narrative — keep them with the issue detail.
      issueDetail: remarks ? `${issueText}\n\n${remarks}` : issueText,
      etaDate: excelDate(r['ETA Date']),
      closedAt: status === 'Closed' ? excelDate(r['Die received']) || raised : null,
    };

    if (dryRun) { console.log('would create', JSON.stringify(record, null, 2)); created++; continue; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = await qd.createQD(client, record);
      await qd.addActivity(client, {
        qdId: id,
        actor: record.corrector || 'Engineering',
        action: `raised QD against die ${dieNo}`,
        icon: 'flag', tone: 'flag',
        occurredAt: `${raised} 00:00:00`,
      });
      await client.query('COMMIT');
      console.log(`created ${qdNo} (${status})`);
      created++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`FAILED ${qdNo}:`, e.message);
    } finally {
      client.release();
    }
  }
  console.log(`\nDone. created=${created} skipped=${skipped}${dryRun ? ' (dry run)' : ''}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run it against the bundled sheet**

Copy `uploads/sample.xlsx` out of the handoff bundle first, then:

Run: `node server/scripts/import-qd-sheet.cjs <path-to>/sample.xlsx --dry-run`
Expected: 6 `would create` blocks — `2025-09` (Closed), `2025-40` (Rejected), `2025-100` (Reference), `2026PD-01` (Reference), `2026PD-03` (Reference), `2026GI-03` (Reference) — and `created=6 skipped=0 (dry run)`.

A dry run needs no DB connection for the `createQD` path, but `db.cjs` still constructs a pool at require time; if it exits on missing env, run it inside the backend container (see `dev-workflow` memory) or with `.env` present.

- [ ] **Step 3: Commit (do NOT run the real import yet — that's for the user to trigger)**

```bash
git add server/scripts/import-qd-sheet.cjs
git commit -m "feat(qd): add manual importer for historical QD sheet"
```

---

### Task 6: Frontend API client + constants + navigation

**Files:**
- Modify: `src/api.js` (append after `frozenDesignsAPI`, ~line 606)
- Modify: `src/utils/constants.js`
- Modify: `src/components/layout/Sidebar.jsx`
- Modify: `src/DieOrderingSystem.jsx`

**Interfaces:**
- Produces (used by Tasks 7–9): `qualityDiscrepanciesAPI.{ list, create, setStatus, addNote, uploadFiles, downloadFile }`; `QD_STATUS_CONFIG`, `QD_OUTCOMES`.

- [ ] **Step 1: Add the API client to `src/api.js`**

```js
// Quality Discrepancies (QD Tracker) API
export const qualityDiscrepanciesAPI = {
    list: async () => apiRequest('/quality-discrepancies'),

    create: async (payload) =>
        apiRequest('/quality-discrepancies', { method: 'POST', body: JSON.stringify(payload) }),

    setStatus: async (id, status) =>
        apiRequest(`/quality-discrepancies/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

    addNote: async (id, note) =>
        apiRequest(`/quality-discrepancies/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) }),

    uploadFiles: async (id, fileList) => {
        const form = new FormData();
        Array.from(fileList).forEach((f) => form.append('files', f));
        return apiRequest(`/quality-discrepancies/${id}/files`, { method: 'POST', body: form, isMultipart: true });
    },

    downloadFile: async (fileId, filename) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/quality-discrepancies/files/${fileId}`, {
            headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'qd-file';
        a.click();
        URL.revokeObjectURL(url);
    },
};
```

- [ ] **Step 2: Add constants to `src/utils/constants.js`**

Append (colours copied verbatim from the design's `S` map):

```js
// QD Tracker status vocabulary — colours match the QD Tracker design.
export const QD_STATUS_CONFIG = {
  'Open':             { fg: '#FBBF24', bg: 'rgba(245,158,11,0.15)' },
  'Sent to Supplier': { fg: '#60A5FA', bg: 'rgba(59,130,246,0.15)' },
  'FOC Accepted':     { fg: '#34D399', bg: 'rgba(16,185,129,0.15)' },
  'Rejected':         { fg: '#FCA5A5', bg: 'rgba(239,68,68,0.15)' },
  'Reference':        { fg: '#A1A1AA', bg: 'rgba(161,161,170,0.14)' },
  'Rework In-house':  { fg: '#A78BFA', bg: 'rgba(139,92,246,0.15)' },
  'Closed':           { fg: '#22D3EE', bg: 'rgba(6,182,212,0.14)' },
};

export const QD_STATUSES = Object.keys(QD_STATUS_CONFIG);

export const QD_OUTCOMES = ['Supplier rework', 'FOC replacement', 'In-house correction', 'Credit note', 'Reference only'];

export const QD_OUTCOME_ICONS = {
  'Supplier rework': 'truck',
  'FOC replacement': 'refresh-ccw',
  'In-house correction': 'wrench',
  'Credit note': 'file-text',
  'Reference only': 'eye',
};
```

And add to `CONTROLLABLE_PAGES`, immediately after the `frozen-designs` entry:

```js
  { id: 'qd-tracker', label: 'QD Tracker' },
```

- [ ] **Step 3: Add the sidebar entry in `src/components/layout/Sidebar.jsx`**

Add `AlertTriangle` to the lucide import on line 2. Add the tab after the `frozen-designs` entry (~line 20):

```js
        { id: 'qd-tracker', label: 'QD Tracker', icon: AlertTriangle, pageId: 'qd-tracker' },
```

Add `'qd-tracker'` to BOTH the `topTabs` and `bottomTabs` filter arrays (~lines 33–34) so it groups with the main pages:

```js
    const topTabs = mainTabs.filter(t => ['dashboard', 'orders', 'backup-requests', 'frozen-designs', 'qd-tracker', 'email-inbox'].includes(t.id));
    const bottomTabs = mainTabs.filter(t => !['dashboard', 'orders', 'backup-requests', 'frozen-designs', 'qd-tracker', 'email-inbox'].includes(t.id));
```

- [ ] **Step 4: Wire the page in `src/DieOrderingSystem.jsx`**

Add the import next to `FrozenDesignsPage` (~line 27):

```js
import QDTrackerPage from './pages/QDTrackerPage';
```

Add the render branch after the `frozen-designs` branch (~line 2874):

```jsx
          {activeTab === 'qd-tracker' && hasPageAccess('qd-tracker') && (
            <QDTrackerPage user={user} theme={theme} />
          )}
```

- [ ] **Step 5: Create a placeholder page so the build passes**

Create `src/pages/QDTrackerPage.jsx`:

```jsx
import React from 'react';

export default function QDTrackerPage() {
  return <div style={{ padding: '32px 28px' }}>QD Tracker</div>;
}
```

- [ ] **Step 6: Verify lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/api.js src/utils/constants.js src/components/layout/Sidebar.jsx src/DieOrderingSystem.jsx src/pages/QDTrackerPage.jsx
git commit -m "feat(qd): wire QD Tracker navigation and API client"
```

---

### Task 7: QD Register tab (page shell, KPIs, filters, table)

**Files:**
- Modify: `src/pages/QDTrackerPage.jsx` (replace the placeholder)

**Interfaces:**
- Consumes: `qualityDiscrepanciesAPI.list`, `QD_STATUS_CONFIG`, `QD_STATUSES`, `QD_OUTCOME_ICONS`.
- Produces (used by Tasks 8–9): renders `<QDDetailPanel>` when `selectedId` is set, and `<RaiseQDModal>` when `showRaise` is true.

**Design reference — match exactly:**
- Header: `Quality Discrepancies` (20px/700) + count line (13px, `--fg-dim`): `N of M QDs · raised against received dies`.
- Header buttons: `Export` (outline, `download` icon) and `Raise QD` (gradient `linear-gradient(135deg,#3B82F6,#8B5CF6)`, `plus` icon, radius 10).
- Tabs: `QD Register` (`clipboard-list`) and `Supplier Summary` (`factory`); active gets `border-bottom: 2px solid #8B5CF6` and `--fg`, inactive `transparent` + `--fg-muted`; container has `border-bottom: 1px solid var(--border)` and tabs sit `margin-bottom: -1px`.
- KPI grid: `repeat(auto-fit, minmax(240px, 1fr))`, gap 20. Each card: border 1px, radius 8, padding `20px 24px`; label 12px/700 uppercase `0.06em` `--fg-dim`; icon 18px; value 26px/700 tabular-nums; sub 12px `--fg-dim`.
- Filter bar: search (with `search` icon inset left 14px) + plant/supplier/status selects + conditional `Clear` button. Radius 8, padding 20.
- Table columns: `QD No, Die No, Plant, Supplier, Quality issue, Status, Outcome, Age`. Header cells 11px/500 uppercase `--fg-muted`. Die No cell stacks mono die number over an 11px `--fg-dim` date. Plant cell shows an 8px dot (`GEX 1` → `#32a838`, else `#6366F1`). Issue clamps to 2 lines, `max-width: 320px`. Age is mono, coloured `>40 → #FCA5A5`, `>20 → #FBBF24`, else `--fg-muted`.
- Empty state: `No QDs match your filters`, padding 40, centred, 13px `--fg-dim`.

**KPI tiles (all derived — never hard-code):**

| Label | Value | Sub |
|---|---|---|
| Open QDs | `kpis.openCount` | `${kpis.atSupplier} awaiting supplier action` |
| At supplier | `kpis.atSupplier` | `sent back for rework / FOC` |
| FOC recovered | `kpis.focRecovered` | `dies + mandrels this FY` |
| Avg resolution | `kpis.avgResolution === null ? '—' : kpis.avgResolution + 'd'` | `raised → closed` |

- [ ] **Step 1: Implement the page**

Replace `src/pages/QDTrackerPage.jsx` with the full implementation:

```jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Download, Plus, ClipboardList, Factory, Search, X,
  AlertTriangle, Truck, CheckCircle, Clock, Wrench, RefreshCcw, FileText, Eye,
} from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../api';
import { QD_STATUS_CONFIG, QD_STATUSES } from '../utils/constants';
import QDDetailPanel from '../components/qd/QDDetailPanel';
import RaiseQDModal from '../components/qd/RaiseQDModal';

const OUTCOME_ICON = {
  'Supplier rework': Truck,
  'FOC replacement': RefreshCcw,
  'In-house correction': Wrench,
  'Credit note': FileText,
  'Reference only': Eye,
};
const PLANT_COLORS = { 'GEX 1': '#32a838' };
const GRADIENT = 'linear-gradient(135deg,#3B82F6,#8B5CF6)';

const ageColor = (age, muted) => (age > 40 ? '#FCA5A5' : age > 20 ? '#FBBF24' : muted);

export default function QDTrackerPage({ user, theme = {} }) {
  const [tab, setTab] = useState('qds');
  const [data, setData] = useState({ qds: [], kpis: null, suppliers: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plant, setPlant] = useState('All');
  const [supplier, setSupplier] = useState('All');
  const [status, setStatus] = useState('All');
  const [selectedId, setSelectedId] = useState(null);
  const [showRaise, setShowRaise] = useState(false);
  const [pickedSuppliers, setPickedSuppliers] = useState([]);

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const surfaceHover = theme.rowHover || 'rgba(255,255,255,0.06)';
  const inputBg = theme.inputBg || '#09090b';

  const load = useCallback(() => {
    setLoading(true);
    qualityDiscrepanciesAPI.list()
      .then(setData)
      .catch(() => setData({ qds: [], kpis: null, suppliers: [] }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const supplierOptions = useMemo(
    () => Array.from(new Set(data.qds.map(q => q.supplier).filter(Boolean))).sort(),
    [data.qds]
  );

  const filtered = useMemo(() => data.qds.filter(q => {
    if (search) {
      const s = search.toLowerCase();
      const hit = String(q.qd_no).toLowerCase().includes(s)
        || String(q.die_no).toLowerCase().includes(s)
        || String(q.issue_summary || '').toLowerCase().includes(s);
      if (!hit) return false;
    }
    if (plant !== 'All' && q.plant !== plant) return false;
    if (supplier !== 'All' && q.supplier !== supplier) return false;
    if (status !== 'All' && q.status !== status) return false;
    return true;
  }), [data.qds, search, plant, supplier, status]);

  const selected = data.qds.find(q => q.id === selectedId) || null;
  const hasFilters = !!(search || plant !== 'All' || supplier !== 'All' || status !== 'All');
  const k = data.kpis;

  const supSelected = (n) => pickedSuppliers.length === 0 || pickedSuppliers.includes(n);
  const visibleSuppliers = data.suppliers.filter(s => supSelected(s.name));
  const supplierTabQds = data.qds.filter(q => supSelected(q.supplier));

  const countLine = tab === 'qds'
    ? `${filtered.length} of ${data.qds.length} QDs · raised against received dies`
    : `${visibleSuppliers.length} supplier${visibleSuppliers.length === 1 ? '' : 's'} · ${supplierTabQds.length} QD${supplierTabQds.length === 1 ? '' : 's'}`;

  const kpis = k ? [
    { label: 'Open QDs',       value: k.openCount,   sub: `${k.atSupplier} awaiting supplier action`, icon: AlertTriangle, color: '#FBBF24' },
    { label: 'At supplier',    value: k.atSupplier,  sub: 'sent back for rework / FOC',               icon: Truck,         color: '#60A5FA' },
    { label: 'FOC recovered',  value: k.focRecovered, sub: 'dies + mandrels this FY',                 icon: CheckCircle,   color: '#34D399' },
    { label: 'Avg resolution', value: k.avgResolution === null ? '—' : `${k.avgResolution}d`, sub: 'raised → closed', icon: Clock, color: '#A78BFA' },
  ] : [];

  const exportCsv = () => {
    const header = ['QD No', 'Die No', 'Plant', 'Supplier', 'Corrector', 'Quality issue', 'Status', 'Outcome', 'Raised', 'Age (days)'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = filtered.map(q => [
      q.qd_no, q.die_no, q.plant, q.supplier, q.corrector, q.issue_summary,
      q.status, q.outcome, q.raised_date, q.age_days,
    ].map(esc).join(','));
    const csv = [header.map(esc).join(','), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `quality-discrepancies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectStyle = { padding: '10px 14px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: 14, cursor: 'pointer', outline: 'none' };
  const th = { padding: '14px 16px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `1px solid ${border}` };
  const td = { padding: '14px 16px', borderBottom: `1px solid ${border}` };
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const sectionLabel = { fontSize: 12, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em' };

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1400, margin: '0 auto', color: text }}>
      <style>{`
        .qd-row { transition: background .15s ease; cursor: pointer; }
        .qd-row:hover { background: ${surfaceHover}; }
        .qd-btn { transition: all .15s ease; }
        .qd-btn:hover { background: ${surfaceHover}; color: ${text}; }
        .qd-primary:hover { filter: brightness(1.06); }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Quality Discrepancies</h1>
          <p style={{ fontSize: 13, color: dim, margin: '4px 0 0' }}>{countLine}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={exportCsv} className="qd-btn" style={{ padding: '10px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: muted, fontWeight: 500, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Download size={16} /> Export
          </button>
          <button onClick={() => setShowRaise(true)} className="qd-primary" style={{ padding: '10px 18px', background: GRADIENT, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} /> Raise QD
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${border}`, marginBottom: 24 }}>
        {[{ key: 'qds', label: 'QD Register', Icon: ClipboardList }, { key: 'suppliers', label: 'Supplier Summary', Icon: Factory }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '10px 18px', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.key ? '#8B5CF6' : 'transparent'}`, color: tab === t.key ? text : muted, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, marginBottom: -1 }}>
            <t.Icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'qds' && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 20 }}>
            {kpis.map(kp => (
              <div key={kp.label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={sectionLabel}>{kp.label}</span>
                  <kp.icon size={18} style={{ color: kp.color }} />
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 10 }}>{kp.value}</div>
                <div style={{ fontSize: 12, color: dim, marginTop: 4 }}>{kp.sub}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 20, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 250, position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, color: dim, pointerEvents: 'none' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by QD no, die number, or issue…"
                style={{ width: '100%', padding: '10px 14px 10px 42px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <select value={plant} onChange={(e) => setPlant(e.target.value)} style={{ ...selectStyle, minWidth: 130 }}>
              <option value="All">All plants</option><option value="GEX 1">GEX 1</option><option value="GEX 2">GEX 2</option>
            </select>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={{ ...selectStyle, minWidth: 150 }}>
              <option value="All">All suppliers</option>
              {supplierOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...selectStyle, minWidth: 170 }}>
              <option value="All">All statuses</option>
              {QD_STATUSES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {hasFilters && (
              <button onClick={() => { setSearch(''); setPlant('All'); setSupplier('All'); setStatus('All'); }}
                style={{ padding: '10px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <X size={14} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['QD No', 'Die No', 'Plant', 'Supplier', 'Quality issue', 'Status', 'Outcome', 'Age'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map(q => {
                  const sc = QD_STATUS_CONFIG[q.status] || QD_STATUS_CONFIG.Open;
                  const OIcon = OUTCOME_ICON[q.outcome] || Eye;
                  return (
                    <tr key={q.id} className="qd-row" onClick={() => setSelectedId(q.id)}>
                      <td style={td}><span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{q.qd_no}</span></td>
                      <td style={td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 600 }}>{q.die_no}</span>
                          <span style={{ fontSize: 11, color: dim }}>{q.raised_date}</span>
                        </div>
                      </td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLANT_COLORS[q.plant] || '#6366F1' }} />{q.plant}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: 13, color: muted }}>{q.supplier}</td>
                      <td style={{ ...td, maxWidth: 320 }}>
                        <span style={{ fontSize: 13, color: muted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>{q.issue_summary}</span>
                      </td>
                      <td style={td}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: sc.bg, color: sc.fg }}>{q.status}</span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 12, color: muted, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                          <OIcon size={14} style={{ color: dim }} />{q.outcome || '—'}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: ageColor(q.age_days, muted) }}>{q.age_days}d</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: dim, fontSize: 13 }}>
                {data.qds.length === 0 ? 'No QDs raised yet' : 'No QDs match your filters'}
              </div>
            )}
            {loading && <div style={{ padding: 40, textAlign: 'center', color: dim, fontSize: 13 }}>Loading…</div>}
          </div>
        </>
      )}

      {tab === 'suppliers' && (
        <div style={{ padding: 32, textAlign: 'center', color: dim, fontSize: 13 }}>Supplier summary — built in Task 9</div>
      )}

      {selected && (
        <QDDetailPanel qd={selected} theme={theme} user={user} onClose={() => setSelectedId(null)} onChanged={load} />
      )}
      {showRaise && (
        <RaiseQDModal theme={theme} suppliers={supplierOptions} onClose={() => setShowRaise(false)}
          onCreated={(id) => { setShowRaise(false); load(); setSelectedId(id); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `age_days` to the API response**

The table reads `q.age_days`, which the backend must supply. In `server/services/qualityDiscrepancies.cjs`, update `listQDs`'s return mapping to include the derived fields:

```js
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    age_days: ageDays(r, now),
    resolution_days: resolutionDays(r),
    eta_display: etaDisplay(r, now),
    files: files.filter((f) => f.qd_id === r.id),
    activity: activity.filter((a) => a.qd_id === r.id),
  }));
```

Add a test for it in `server/services/qualityDiscrepancies.test.cjs`:

```js
test('listQDs decorates rows with derived age, resolution and eta', async () => {
  const client = {
    query: async (sql) => {
      if (sql.includes('FROM quality_discrepancies')) {
        return { rows: [{ id: 1, raised_date: '2026-07-01', closed_at: null, eta_date: null }] };
      }
      return { rows: [] };
    },
  };
  const [row] = await q.listQDs(client);
  assert.equal(row.age_days, q.ageDays({ raised_date: '2026-07-01', closed_at: null }, new Date()));
  assert.equal(row.resolution_days, null);
  assert.equal(row.eta_display, '—');
  assert.deepEqual(row.files, []);
  assert.deepEqual(row.activity, []);
});
```

- [ ] **Step 3: Create stub components so the build passes**

Create `src/components/qd/QDDetailPanel.jsx`:

```jsx
import React from 'react';
export default function QDDetailPanel({ onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0 }} />;
}
```

Create `src/components/qd/RaiseQDModal.jsx`:

```jsx
import React from 'react';
export default function RaiseQDModal({ onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0 }} />;
}
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/QDTrackerPage.jsx src/components/qd server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): build QD register tab with derived KPIs"
```

---

### Task 8: QD detail drawer + Raise QD modal

**Files:**
- Modify: `src/components/qd/QDDetailPanel.jsx` (replace stub)
- Modify: `src/components/qd/RaiseQDModal.jsx` (replace stub)

**Interfaces:**
- Consumes: `qualityDiscrepanciesAPI.{ setStatus, addNote, uploadFiles, downloadFile, create }`, `QD_STATUS_CONFIG`, `QD_STATUSES`, `QD_OUTCOMES`.
- `QDDetailPanel` props: `{ qd, theme, user, onClose, onChanged }`. `RaiseQDModal` props: `{ theme, suppliers, onClose, onCreated }`.

**Design reference — detail drawer:**
- Backdrop `rgba(0,0,0,0.7)` + `backdrop-filter: blur(8px)`, `z-index: 200`; clicking it closes.
- Drawer: fixed right, `width: 720px; max-width: 92vw`, full height, `border-left: 1px solid var(--border)`, `overflow-y: auto`, `padding: 28px 32px`, `z-index: 201`, `animation: slideDownAndFade 0.2s ease-out`.
- Title `QD {no}` mono 20px/700 + status pill. Sub-line 13px `--fg-dim`: `Die {die} · {supplier} · {plant} · Raised {date}`.
- Action row: `Email supplier` outline button (`mail` icon) + status `<select>` on `--primary` background.
- Facts grid: 4 columns, gap 12 — `Outcome sought`, `Input at failure`, `ETA from supplier`, `Age`. Label 10.5px/700 uppercase; value 13.5px/600. Age shows `Closed` when the QD is closed, else `N days`.
- Quality issue card: label `QUALITY ISSUE`, body 13.5px `--fg-muted`, `line-height: 1.55`, `white-space: pre-line`. File chips below + a dashed `Add file` chip (`border: 2px dashed var(--slate-border)`).
- Activity timeline: 24px circular dot (tone-coloured) with a 1px connector line, `who` bold + `what`, `when` 11.5px `--fg-dim`. Bottom row: `ME` gradient avatar + note input + `Post` button; Enter posts.

Tone → colours (copy verbatim from the design's `tones` map):
```
flag:    bg rgba(245,158,11,0.18)  fg #FBBF24
send:    bg rgba(59,130,246,0.18)  fg #60A5FA
bad:     bg rgba(239,68,68,0.18)   fg #FCA5A5
good:    bg rgba(16,185,129,0.18)  fg #34D399
neutral: bg rgba(161,161,170,0.16) fg #A1A1AA
```

**Design reference — raise modal:**
- Overlay `rgba(0,0,0,0.75)` + blur(8px), `z-index: 300`, centred, padding 24.
- Card: `width: 640px`, `max-height: 90vh`, `border-radius: 20px`, `box-shadow: var(--shadow-modal)`.
- Header: 44px gradient square with `alert-triangle`, title `Raise Quality Discrepancy` 17px/700, sub `Against a received die · QD no {next} assigned automatically`, close button.
- Body: 2×2 grid — `Die No` (mono input, placeholder `e.g. 029780-2502`), `Plant` (select, GEX 2 first), `Supplier` (select), `Corrector` (input, placeholder `e.g. Sijith`). Then `Quality issue` textarea (4 rows). Then `Outcome sought` pill group (selected = `rgba(139,92,246,0.15)` bg / `#A78BFA` fg / `rgba(139,92,246,0.4)` border). Then a dashed dropzone.
- Footer: `Cancel` outline + `Raise QD` gradient (`box-shadow: var(--shadow-cta)`).

**Deviations from the prototype (deliberate):**
- The QD number shown in the modal sub-line comes from the server on submit, not from a client-side guess. Render the sub-line as `QD no assigned automatically` — do NOT invent `2026-XX` client-side the way the prototype's `nextNo` does, since it would be wrong.
- `Email supplier` — the prototype has no handler. Wire it to the existing compose flow only if `onCompose` is threaded through; otherwise omit the button rather than shipping a dead control. Prefer omitting; note it in the completion summary.
- Files chosen in the raise modal upload **after** create returns an id (two-step, same as `FreezeDesignModal`).

- [ ] **Step 1: Implement `QDDetailPanel.jsx`**

Follow the design spec above. Key behaviours:
- Status `<select>` calls `qualityDiscrepanciesAPI.setStatus(qd.id, value)` then `onChanged()`.
- Note input + `Post` call `addNote(qd.id, note)` then clear and `onChanged()`; Enter key posts.
- `Add file` chip opens a hidden `<input type="file" multiple>`; on change call `uploadFiles(qd.id, files)` then `onChanged()`.
- File chips call `downloadFile(f.id, f.original_name)`; icon is `FileText` for PDFs (colour `#F87171`), `Image` otherwise (colour `#60A5FA`) — matching the design's per-file icon/colour.
- Age fact: `qd.closed_at ? 'Closed' : qd.age_days + ' days'`. ETA fact: `qd.eta_display`. Input fact: `qd.input_at_failure || '—'`. Outcome fact: `qd.outcome || '—'`.
- Add the keyframe locally (the design defines it globally):
  ```jsx
  <style>{`@keyframes qdSlideIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }`}</style>
  ```

- [ ] **Step 2: Implement `RaiseQDModal.jsx`**

Follow the design spec above. Key behaviours:
- Local state: `dieNo`, `plant` (default `GEX 2`), `supplier`, `corrector`, `issue`, `outcome` (default `Supplier rework`), `files`, `submitting`, `error`.
- Submit is disabled when `dieNo` is blank (design's `submitRaise` silently returns — instead disable the button so the UI explains itself).
- On submit: `create({ dieNo, plant, supplier, corrector, issue, outcome })`, then if files were chosen `uploadFiles(id, files)`, then `onCreated(id)`.
- Surface API errors in the modal (red 12.5px text above the footer) rather than failing silently.
- Supplier select is populated from the `suppliers` prop; when empty, fall back to a free-text input so a first QD can still be raised.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/qd/QDDetailPanel.jsx src/components/qd/RaiseQDModal.jsx
git commit -m "feat(qd): add QD detail drawer and raise modal"
```

---

### Task 9: Supplier Summary tab

**Files:**
- Modify: `src/pages/QDTrackerPage.jsx` (replace the Task 7 placeholder block)

**Interfaces:**
- Consumes: `data.suppliers` from `summarizeSuppliers` (fields `name, total, open, foc, rejected, avg, trend`).

**Design reference:**
- Supplier chip row: `Suppliers` label + `All` chip + one chip per supplier. On = `rgba(139,92,246,0.15)` bg / `#A78BFA` fg / `rgba(139,92,246,0.4)` border; off = `--bg` / `--fg-muted` / `--border`. `All` is on when nothing is picked. Radius 20, padding `6px 14px`, 12.5px/600.
- Two-panel grid `1fr 1.8fr`, gap 16:
  - **Open QDs by stage** — 4 rows, grid `120px 1fr 24px`: label 12px `--fg-muted`; an 8px track (`--primary-soft`) with a coloured fill whose width is `count / max * 100%`; mono count. Rows: `Open` `#FBBF24`, `At supplier` `#60A5FA`, `Rework in-house` `#A78BFA`, `Rejected / escalate` `#FCA5A5`. Guard `max` with `Math.max(1, …)` so an all-zero pipeline doesn't divide by zero.
  - **Supplier performance** — header `Sorted by open QDs · click to filter`. Column grid `1.4fr 60px 60px 60px 70px 70px 90px`: Supplier (with a 6px dot: `open > 1 → #FBBF24`, `open === 1 → #60A5FA`, else `#34D399`), QDs, Open (coloured the same way), FOC `#34D399`, Rejected `#F87171`, Avg res., Trend pill. Body scrolls at `max-height: 196px`. Clicking a row toggles that supplier in `pickedSuppliers`; picked rows get `--surface-hover`.
- **Trend pill** — render from the real `trend` enum, NOT the prototype's fixed strings:
  ```js
  const TREND = {
    up:   { label: '↑ QD rate',   bg: 'rgba(239,68,68,0.15)',    fg: '#FCA5A5' },
    down: { label: '↓ improving', bg: 'rgba(16,185,129,0.15)',   fg: '#34D399' },
    flat: { label: 'flat',        bg: 'rgba(161,161,170,0.14)',  fg: '#A1A1AA' },
  };
  ```
- **Avg res.** — `s.avg === null ? '—' : s.avg + 'd'`. Never fabricate.
- Bottom card **QDs for selected suppliers** — grid `100px 130px 100px 1fr 160px 70px`: QD no (mono), die (mono `--fg-muted`), supplier, issue (clamp 1 line), status pill, age (mono, `ageColor`). Row click opens the detail drawer. Empty state: `No QDs recorded for the selected suppliers`.

- [ ] **Step 1: Implement the tab**

Replace the `{tab === 'suppliers' && …}` placeholder with the full implementation per the spec above. Compute the pipeline from `supplierTabQds` (already filtered by `pickedSuppliers`):

```jsx
const pipeline = useMemo(() => {
  const rows = [
    ['Open', 'Open', '#FBBF24'],
    ['At supplier', 'Sent to Supplier', '#60A5FA'],
    ['Rework in-house', 'Rework In-house', '#A78BFA'],
    ['Rejected / escalate', 'Rejected', '#FCA5A5'],
  ].map(([label, st, color]) => ({ label, color, count: supplierTabQds.filter(q => q.status === st).length }));
  const max = Math.max(1, ...rows.map(r => r.count));
  return rows.map(r => ({ ...r, pct: `${Math.round((r.count / max) * 100)}%` }));
}, [supplierTabQds]);
```

Note: `supplierTabQds` is recomputed each render, so either wrap it in its own `useMemo` keyed on `[data.qds, pickedSuppliers]` or inline the filter inside this `useMemo`'s body. Do the former — it's also used by `countLine`.

- [ ] **Step 2: Verify**

Run: `npm run lint && npm run build`
Expected: no errors. ESLint's `react-hooks/exhaustive-deps` must be clean — do not suppress it.

- [ ] **Step 3: Commit**

```bash
git add src/pages/QDTrackerPage.jsx
git commit -m "feat(qd): add supplier summary tab with real trend data"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full check**

Run: `npm test && npm run lint && npm run build`
Expected: all green. Paste the real output into the summary — do not claim success without it.

- [ ] **Step 2: Bring the stack up**

Run: `docker compose up -d --build && docker compose logs backend --tail 40`
Expected: no migration errors, server listening.

- [ ] **Step 3: Grant page access**

`qd-tracker` is a new `CONTROLLABLE_PAGES` id. Admins get every page implicitly (`hasAccess` returns true for `role === 'admin'`), but non-admin users with an explicit `pageAccess` list will NOT see the tab until it's added. Verify an admin sees the tab; note in the summary that other users need the page granted in Settings → Users.

- [ ] **Step 4: Drive the real flow**

Use the `verify` skill, or manually through the UI at `http://localhost:8080`:
1. Open QD Tracker — table renders (empty state if nothing imported).
2. Raise a QD — modal validates a blank Die No, submits, drawer opens on the new QD.
3. Change status to `Sent to Supplier` — the `At supplier` KPI increments; an activity entry appears.
4. Post a note — it appears in the timeline.
5. Upload a JPG — chip appears; click it to download. Confirm an `.exe` is rejected.
6. Switch to Supplier Summary — chips filter, pipeline bars and the performance table reflect real counts.
7. Export — CSV downloads with the filtered rows.

- [ ] **Step 5: Run the historical import (ask the user first)**

This writes real rows. Confirm with the user before running:

```bash
docker cp <path>/sample.xlsx die-ordering-backend:/tmp/sample.xlsx
docker exec die-ordering-backend node /app/server/scripts/import-qd-sheet.cjs /tmp/sample.xlsx --dry-run
# then, once the dry run looks right:
docker exec die-ordering-backend node /app/server/scripts/import-qd-sheet.cjs /tmp/sample.xlsx
```

Expected: `created=6 skipped=0`. Re-running is idempotent — the second run prints 6 `skip` lines and `created=0 skipped=6`.

- [ ] **Step 6: Commit any fixes and update memory**

Record the feature in `C:\Users\vijee\.claude\projects\C--Users-vijee-Desktop-18-06-2026-Die-Tracker\memory\` as `qd-tracker-feature.md` (type: project), linking `[[frozen-design-feature]]` and `[[dev-workflow]]`, and add the pointer line to `MEMORY.md`.

---

## Self-Review

**Spec coverage:**
- QD Register tab (KPIs, filters, table, empty state) → Task 7
- Supplier Summary tab (chips, pipeline, performance table, QD list) → Task 9
- Detail drawer (facts, issue, files, activity, notes, status) → Task 8
- Raise QD modal → Task 8
- Persistence + API → Tasks 1, 2, 4
- Attachments → Tasks 3, 4, 8
- Historical import → Task 5
- Navigation + page access → Task 6
- Export CSV → Task 7

**Decisions applied:** full stack ✓ · design's 7 statuses with import mapping ✓ · manual import script ✓ · all metrics computed from real data ✓.

**Known deviations from the prototype (all deliberate, all because the prototype fabricates):**
1. Supplier performance lists only suppliers that actually have QDs — the prototype's Kompass/Almax/Decoral/UBE Tools/Exal rows are invented.
2. `Avg resolution` / `Avg res.` render `—` when nothing has closed.
3. Trend is computed (90-day vs prior-90-day QD rate) instead of fixed arrows.
4. The Raise modal doesn't pre-compute a QD number; the server assigns it.
5. `Email supplier` is omitted unless the compose flow is threaded through — a dead button is worse than no button.
