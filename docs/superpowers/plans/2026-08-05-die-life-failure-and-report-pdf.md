# Die Life, Die Failure, and Report PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture die life and die failure by hand each month, score them as 45% of the supplier rating against year-scoped targets, and replace the browser print-out with a generated PDF fit to send to a supplier.

**Architecture:** A new `supplier_die_life` table holds three typed numbers per supplier per month; failure percentage is always derived, never stored. A new `supplierDieLife.cjs` service owns validation and weighted period aggregation, kept apart from the read-only aggregation in `supplierPerformanceData.cjs`. Scoring targets gain a `year` column so a sent report reprints identically. Export moves from `window.print()` to `supplierReportPdf.cjs`, which draws an A4 document with `pdf-lib` — the same library and the same discipline as the existing QD form renderer.

**Tech Stack:** Node + Express + PostgreSQL (`pg`), `pdf-lib` for PDF generation, `pdfjs-dist` for reading PDFs back in tests, React 18 with inline styles (no CSS framework), `node:test` for backend tests.

**Spec:** `docs/superpowers/specs/2026-08-05-die-life-failure-and-report-pdf-design.md`

## Global Constraints

- **Backend files use `.cjs` and `'use strict';`** — this is a CommonJS server inside an ESM frontend package. A `.js` backend file will not load.
- **Tests are service-level only.** This repo has no route or component test harness. Do not build one. Tests live beside the service as `<name>.test.cjs` and run with `npm test` (`node --test "server/**/*.test.cjs"`).
- **Test pools are hand-rolled mocks**, not a database. Copy the `makePool` helper shown in Task 2; every existing service test uses it.
- **Schema goes in two places:** `server/db.cjs` (runs on boot) and `init.sql` (fresh container). Both, every time, or a fresh deployment diverges from an upgraded one.
- **A blank input is `NULL`, never `0`.** This rule appears in five tasks and is the single most important behaviour in this plan. `0` means "zero dies failed", `NULL` means "nobody recorded it". Confusing them rates a supplier "At risk" on a 25% weight for data that was never collected.
- **Supplier matching is `upper(btrim(supplier))`** everywhere, matching the existing aggregation queries.
- **Weights must total exactly 100%.** `validateMetrics` enforces it and a test asserts it. Any change to `METRIC_DEFAULTS` weights must keep the sum at 1.
- **Frontend styling is inline `style={{}}` objects driven by the `theme` prop.** There is no CSS module or utility framework. Match the surrounding components.
- **Brand colour is `BRAND.navy` (`#1F6FB0`)** from `src/utils/brand.js` for primary actions. Do not hardcode it.
- **Commit after every task.** Message style is `feat(scope): lower case summary` matching `git log`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `server/services/supplierDieLife.cjs` | Validation, upsert, listing, and weighted period aggregation of manual die life entries |
| `server/services/supplierDieLife.test.cjs` | Tests for the above |
| `server/services/supplierReportPdf.cjs` | The A4 document: layout primitives, page composition, chart drawing |
| `server/services/supplierReportPdf.test.cjs` | Tests that read text back out of generated PDFs |
| `src/pages/analytics/DieLifeTab.jsx` | The monthly entry grid |
| `src/components/analytics/DieLifeMatrix.jsx` | On-screen month × metric table |

**Modified:**

| File | Change |
|---|---|
| `server/db.cjs` | `supplier_die_life` table; `year` column migration on settings |
| `init.sql` | Same schema, for fresh containers |
| `server/services/supplierPerformanceSettings.cjs` | Two metric defaults; year-scoped get/save; header comment rewrite |
| `server/services/supplierPerformanceSettings.test.cjs` | **Invert** the test asserting die life is absent; year-scoping tests |
| `server/services/supplierPerformanceData.cjs` | Merge die life into `getSnapshot` |
| `server/services/supplierPerformanceData.test.cjs` | Snapshot now carries two more keys |
| `server/routes/supplier-performance.cjs` | Die life GET/PUT, `POST /pdf`, pass period year to `getSettings` |
| `src/api.js` | Die life get/save, year-scoped settings, PDF blob export |
| `src/pages/AnalyticsPage.jsx` | Third tab |
| `src/pages/analytics/SupplierReportTab.jsx` | Matrix, comments box, PDF export; **delete the stale die-life sentence** |
| `src/components/analytics/metricStyle.js` | Colours for the two new metrics |
| `src/components/settings/SupplierTargetsCard.jsx` | Year selector, copy-from-previous-year |

---

# Phase 1 — Data capture

*Ends with: numbers can be entered and reloaded. Nothing scores them yet, so no rating and no report changes.*

---

### Task 1: The `supplier_die_life` table

**Files:**
- Modify: `server/db.cjs` (after the `supplier_performance_settings` block, ~line 523)
- Modify: `init.sql` (after the `supplier_performance_settings` block, ~line 440)

**Interfaces:**
- Consumes: nothing
- Produces: table `supplier_die_life` with columns `id, supplier, year, month, avg_die_life_mt, dies_in_service, dies_failed, updated_by, created_at, updated_at`

- [ ] **Step 1: Add the table to `server/db.cjs`**

Find the `CREATE TABLE IF NOT EXISTS supplier_performance_settings (` block and insert immediately after its closing `);`:

```sql
      -- Manual monthly die life capture, per supplier. Nothing in this system
      -- records tonnage extruded, so these three numbers are typed in once a
      -- month by the people who know them.
      --
      -- Failure percentage is deliberately NOT a column. It is derived as
      -- dies_failed / dies_in_service at read time, so the stored counts and
      -- the reported percentage cannot drift apart, and a figure a supplier
      -- disputes traces back to a count somebody entered.
      --
      -- Every value is nullable, and NULL means "not recorded" — never zero.
      -- See docs/superpowers/specs/2026-08-05-die-life-failure-and-report-pdf-design.md.
      CREATE TABLE IF NOT EXISTS supplier_die_life (
        id                SERIAL PRIMARY KEY,
        supplier          TEXT     NOT NULL,
        year              INTEGER  NOT NULL,
        month             SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
        avg_die_life_mt   NUMERIC,
        dies_in_service   INTEGER,
        dies_failed       INTEGER,
        updated_by        INTEGER REFERENCES users(id),
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (supplier, year, month)
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_die_life_lookup
        ON supplier_die_life (upper(btrim(supplier)), year, month);
```

- [ ] **Step 2: Add the identical table to `init.sql`**

Copy the same `CREATE TABLE` and `CREATE INDEX` statements (without the leading six-space indentation, matching `init.sql`'s style) after the `supplier_performance_settings` block. Keep a one-line comment; the full rationale lives in `db.cjs`.

- [ ] **Step 3: Verify the schema applies**

Run: `npm run server`

Expected: server starts with no error. Then confirm the table exists:

```bash
docker exec die-ordering-db psql -U postgres -d die_ordering -c "\d supplier_die_life"
```

Expected: the eleven columns above, the unique constraint on `(supplier, year, month)`, and the lookup index.

- [ ] **Step 4: Commit**

```bash
git add server/db.cjs init.sql
git commit -m "feat(die-life): table for manual monthly die life capture"
```

---

### Task 2: Validation and aggregation

The pure arithmetic, tested without a database. Written before anything touches the pool, because this is where the rules that matter live.

**Files:**
- Create: `server/services/supplierDieLife.cjs`
- Create: `server/services/supplierDieLife.test.cjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `validateEntry(entry)` — throws `Error` with `.status = 400`; returns a normalised `{ supplier, avgDieLifeMt, diesInService, diesFailed }` with `null` for blanks
  - `aggregateDieLife(rows)` → `{ dieLife: number|null, dieFailure: number|null }` where `rows` is `[{ avgDieLifeMt, diesInService, diesFailed }]`

- [ ] **Step 1: Write the failing test**

Create `server/services/supplierDieLife.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./supplierDieLife.cjs');

// ---------- validateEntry ----------

test('validateEntry normalises blanks to null, not zero', () => {
  const out = s.validateEntry({ supplier: ' PDTMC ', avgDieLifeMt: '', diesInService: null, diesFailed: undefined });
  assert.equal(out.supplier, 'PDTMC');
  assert.equal(out.avgDieLifeMt, null);
  assert.equal(out.diesInService, null);
  assert.equal(out.diesFailed, null);
});

test('validateEntry keeps a typed zero as zero', () => {
  const out = s.validateEntry({ supplier: 'PHME', diesInService: 12, diesFailed: 0 });
  assert.equal(out.diesFailed, 0, 'a typed 0 means zero failures and must survive');
});

test('validateEntry rejects more failures than dies in service', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesInService: 5, diesFailed: 9 }),
    (e) => e.status === 400 && /more dies failed/i.test(e.message)
  );
});

test('validateEntry rejects negative numbers', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', avgDieLifeMt: -3 }),
    (e) => e.status === 400 && /negative/i.test(e.message)
  );
});

test('validateEntry rejects a failure count with no denominator', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesFailed: 2 }),
    (e) => e.status === 400 && /dies in service/i.test(e.message)
  );
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesInService: 0, diesFailed: 0 }),
    (e) => e.status === 400
  );
});

test('validateEntry allows die life alone — it scores on its own', () => {
  const out = s.validateEntry({ supplier: 'ALMAX', avgDieLifeMt: 64 });
  assert.equal(out.avgDieLifeMt, 64);
  assert.equal(out.diesInService, null);
});

test('validateEntry requires a supplier', () => {
  assert.throws(() => s.validateEntry({ supplier: '  ' }), (e) => e.status === 400);
});

// ---------- aggregateDieLife ----------

test('aggregateDieLife weights die life by dies in service', () => {
  // 40 dies at 80 MT and 4 dies at 20 MT. A simple mean would say 50 MT;
  // the busy month must dominate.
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 40, diesFailed: 4 },
    { avgDieLifeMt: 20, diesInService: 4, diesFailed: 0 },
  ]);
  assert.equal(Math.round(out.dieLife * 100) / 100, 74.55);
});

test('aggregateDieLife pools failure counts rather than averaging percentages', () => {
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 40, diesFailed: 4 },
    { avgDieLifeMt: 20, diesInService: 4, diesFailed: 0 },
  ]);
  assert.equal(Math.round(out.dieFailure * 100) / 100, 9.09); // 4/44
});

test('aggregateDieLife returns null failure when no dies were in service', () => {
  const out = s.aggregateDieLife([{ avgDieLifeMt: 55, diesInService: null, diesFailed: null }]);
  assert.equal(out.dieFailure, null, '0 of 0 is unknown, not a perfect 0%');
});

test('aggregateDieLife falls back to a simple mean when no month has counts', () => {
  // Otherwise a weighted mean with no weights divides by zero and silently
  // discards a figure somebody typed.
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 60, diesInService: null, diesFailed: null },
    { avgDieLifeMt: 80, diesInService: null, diesFailed: null },
  ]);
  assert.equal(out.dieLife, 70);
});

test('aggregateDieLife ignores unweighted months when others carry weight', () => {
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
    { avgDieLifeMt: 20, diesInService: null, diesFailed: null },
  ]);
  assert.equal(out.dieLife, 80);
});

test('aggregateDieLife returns nulls for an empty period', () => {
  assert.deepEqual(s.aggregateDieLife([]), { dieLife: null, dieFailure: null });
});

test('aggregateDieLife treats zero failures as a real zero', () => {
  const out = s.aggregateDieLife([{ avgDieLifeMt: 90, diesInService: 20, diesFailed: 0 }]);
  assert.equal(out.dieFailure, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test server/services/supplierDieLife.test.cjs`

Expected: FAIL — `Cannot find module './supplierDieLife.cjs'`

- [ ] **Step 3: Write the implementation**

Create `server/services/supplierDieLife.cjs`:

```js
'use strict';

// Manual monthly die life capture. Nothing in this system records tonnage
// extruded or dies failing before rated life, so these numbers are typed in.
//
// Kept separate from supplierPerformanceData.cjs on purpose: that module runs
// read-only aggregation queries, this one owns validation, attribution and
// upserts. Different jobs, different failure modes.
//
// See docs/superpowers/specs/2026-08-05-die-life-failure-and-report-pdf-design.md.

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// A blank box is "not recorded" and must stay null. A typed 0 is a real zero.
// Collapsing the two would score an unrecorded die life as 0 MT and rate a
// supplier "At risk" on a 25% weight for data nobody collected.
function nullableNumber(raw, label) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw fail(400, `${label} must be a number`);
  if (n < 0) throw fail(400, `${label} cannot be negative`);
  return n;
}

function validateEntry(entry) {
  const supplier = String((entry && entry.supplier) || '').trim();
  if (!supplier) throw fail(400, 'A supplier is required');

  const avgDieLifeMt = nullableNumber(entry.avgDieLifeMt, `${supplier}: die life`);
  const diesInService = nullableNumber(entry.diesInService, `${supplier}: dies in service`);
  const diesFailed = nullableNumber(entry.diesFailed, `${supplier}: dies failed`);

  // A failure count with no denominator cannot become a percentage. Leaving
  // both blank is the way to say "not recorded this month".
  if (diesFailed !== null && (diesInService === null || diesInService === 0)) {
    throw fail(400, `${supplier}: dies failed needs a dies in service count above zero — leave both blank if there is nothing to record`);
  }
  if (diesFailed !== null && diesInService !== null && diesFailed > diesInService) {
    throw fail(400, `${supplier}: more dies failed (${diesFailed}) than were in service (${diesInService})`);
  }

  return { supplier, avgDieLifeMt, diesInService, diesFailed };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Weighted by dies in service, so a month with 40 dies counts ten times a month
// with 4. Failure pools the raw counts rather than averaging percentages, which
// would give a quiet month equal say.
function aggregateDieLife(rows) {
  let failed = 0;
  let inService = 0;
  let weightedSum = 0;
  let weight = 0;
  const unweighted = [];

  for (const r of rows || []) {
    const svc = num(r.diesInService);
    const bad = num(r.diesFailed);
    const life = num(r.avgDieLifeMt);

    if (svc !== null) {
      inService += svc;
      if (bad !== null) failed += bad;
    }
    if (life !== null) {
      unweighted.push(life);
      if (svc !== null && svc > 0) {
        weightedSum += life * svc;
        weight += svc;
      }
    }
  }

  // 0 dies failed out of 0 in service is unknown, not a flattering 0%. Same
  // reasoning the QD Rate already applies to 0 QDs out of 0 dies received.
  const dieFailure = inService > 0 ? (failed / inService) * 100 : null;

  // Validation permits a die life figure with no counts, so the weighted mean
  // must not be the only path — with no weights it would divide by zero and
  // throw away a number somebody typed.
  let dieLife = null;
  if (weight > 0) dieLife = weightedSum / weight;
  else if (unweighted.length) dieLife = unweighted.reduce((a, b) => a + b, 0) / unweighted.length;

  return { dieLife, dieFailure };
}

module.exports = { validateEntry, aggregateDieLife };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx node --test server/services/supplierDieLife.test.cjs`

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/supplierDieLife.cjs server/services/supplierDieLife.test.cjs
git commit -m "feat(die-life): validation and weighted period aggregation"
```

---

### Task 3: Persistence — list, save, and read a period

**Files:**
- Modify: `server/services/supplierDieLife.cjs`
- Modify: `server/services/supplierDieLife.test.cjs`

**Interfaces:**
- Consumes: `validateEntry`, `aggregateDieLife` from Task 2
- Produces:
  - `listDieLife(pool, { year, month })` → `[{ supplier, avgDieLifeMt, diesInService, diesFailed, updatedBy, updatedAt }]`
  - `saveDieLife(pool, { year, month, entries }, userId)` → same shape as `listDieLife`
  - `getDieLifeRows(pool, { supplier, year, months })` → `[{ month, avgDieLifeMt, diesInService, diesFailed }]` sorted by month
  - `getDieLifeForPeriod(pool, { supplier, year, months })` → `{ dieLife, dieFailure }`

- [ ] **Step 1: Write the failing test**

Append to `server/services/supplierDieLife.test.cjs`:

```js
// ---------- persistence ----------

// Every service test in this repo mocks the pool rather than touching a
// database. Replies are returned in call order.
const makePool = (replies = []) => {
  const calls = [];
  let i = 0;
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return replies[i++] || { rows: [] }; } };
};

// Small indirection so the two tests below read cleanly.
const listDieLifeOf = (pool) => s.listDieLife(pool, { year: 2026, month: 8 });

test('listDieLife maps snake_case columns to the API shape', async () => {
  const pool = makePool([{ rows: [{
    supplier: 'PDTMC', avg_die_life_mt: '72.5', dies_in_service: 40, dies_failed: 6,
    updated_by_name: 'admin', updated_at: '2026-08-05T10:00:00Z',
  }] }]);
  const rows = await listDieLifeOf(pool);
  assert.deepEqual(rows[0], {
    supplier: 'PDTMC', avgDieLifeMt: 72.5, diesInService: 40, diesFailed: 6,
    updatedBy: 'admin', updatedAt: '2026-08-05T10:00:00Z',
  });
});

test('listDieLife keeps a null column null rather than turning it into 0', async () => {
  const pool = makePool([{ rows: [{
    supplier: 'ALMAX', avg_die_life_mt: null, dies_in_service: null, dies_failed: null,
    updated_by_name: null, updated_at: null,
  }] }]);
  const rows = await listDieLifeOf(pool);
  assert.equal(rows[0].avgDieLifeMt, null);
  assert.equal(rows[0].diesInService, null);
});

test('saveDieLife validates every entry before writing anything', async () => {
  const pool = makePool([]);
  await assert.rejects(
    () => s.saveDieLife(pool, { year: 2026, month: 8, entries: [
      { supplier: 'PHME', avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
      { supplier: 'ALMAX', diesInService: 4, diesFailed: 9 },
    ] }, 3),
    (e) => e.status === 400
  );
  assert.equal(pool.calls.length, 0, 'a bad row must not leave a good row half-written');
});

test('saveDieLife upserts on supplier, year and month', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveDieLife(pool, { year: 2026, month: 8, entries: [
    { supplier: 'PHME', avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
  ] }, 3);
  const ins = pool.calls.find(c => /INSERT INTO supplier_die_life/.test(c.sql));
  assert.ok(/ON CONFLICT/.test(ins.sql), 'saving the same month twice must update, not duplicate');
  assert.deepEqual(ins.params, ['PHME', 2026, 8, 80, 10, 1, 3]);
});

test('saveDieLife records who saved it', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveDieLife(pool, { year: 2026, month: 8, entries: [
    { supplier: 'PHME', avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
  ] }, 7);
  const ins = pool.calls.find(c => /INSERT INTO supplier_die_life/.test(c.sql));
  assert.equal(ins.params[6], 7);
});

test('getDieLifeForPeriod aggregates the rows it reads', async () => {
  const pool = makePool([{ rows: [
    { month: 7, avg_die_life_mt: '80', dies_in_service: 40, dies_failed: 4 },
    { month: 8, avg_die_life_mt: '20', dies_in_service: 4, dies_failed: 0 },
  ] }]);
  const out = await s.getDieLifeForPeriod(pool, { supplier: 'PHME', year: 2026, months: [7, 8] });
  assert.equal(Math.round(out.dieLife * 100) / 100, 74.55);
  assert.equal(Math.round(out.dieFailure * 100) / 100, 9.09);
});

test('getDieLifeForPeriod returns nulls when the supplier has no rows', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.deepEqual(
    await s.getDieLifeForPeriod(pool, { supplier: 'NEWCO', year: 2026, months: [8] }),
    { dieLife: null, dieFailure: null }
  );
});

test('getDieLifeRows matches the supplier case-insensitively', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.getDieLifeRows(pool, { supplier: ' phme ', year: 2026, months: [8] });
  assert.ok(/upper\(btrim\(supplier\)\) = upper\(btrim\(\$1\)\)/.test(pool.calls[0].sql));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test server/services/supplierDieLife.test.cjs`

Expected: FAIL — `s.listDieLife is not a function`

- [ ] **Step 3: Write the implementation**

Add to `server/services/supplierDieLife.cjs`, above `module.exports`:

```js
// Postgres returns NUMERIC as a string; null must survive as null.
const toRow = (r) => ({
  supplier: r.supplier,
  avgDieLifeMt: num(r.avg_die_life_mt),
  diesInService: num(r.dies_in_service),
  diesFailed: num(r.dies_failed),
  updatedBy: r.updated_by_name || null,
  updatedAt: r.updated_at || null,
});

async function listDieLife(pool, { year, month }) {
  const { rows } = await pool.query(`
    SELECT d.supplier, d.avg_die_life_mt, d.dies_in_service, d.dies_failed,
           d.updated_at, u.username AS updated_by_name
      FROM supplier_die_life d
      LEFT JOIN users u ON u.id = d.updated_by
     WHERE d.year = $1 AND d.month = $2
     ORDER BY d.supplier`, [Number(year), Number(month)]);
  return rows.map(toRow);
}

// Validate every entry first. A grid save is one action to the person doing it,
// so a bad row in the middle must not leave the earlier rows written and the
// later ones not.
async function saveDieLife(pool, { year, month, entries }, userId) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw fail(400, 'A valid year and month are required');
  }
  const clean = (entries || []).map(validateEntry);

  for (const e of clean) {
    await pool.query(`
      INSERT INTO supplier_die_life
             (supplier, year, month, avg_die_life_mt, dies_in_service, dies_failed, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (supplier, year, month) DO UPDATE
         SET avg_die_life_mt = EXCLUDED.avg_die_life_mt,
             dies_in_service = EXCLUDED.dies_in_service,
             dies_failed     = EXCLUDED.dies_failed,
             updated_by      = EXCLUDED.updated_by,
             updated_at      = CURRENT_TIMESTAMP`,
      [e.supplier, y, m, e.avgDieLifeMt, e.diesInService, e.diesFailed, userId || null]);
  }
  return listDieLife(pool, { year: y, month: m });
}

async function getDieLifeRows(pool, { supplier, year, months }) {
  const { rows } = await pool.query(`
    SELECT month, avg_die_life_mt, dies_in_service, dies_failed
      FROM supplier_die_life
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND year = $2 AND month = ANY($3)
     ORDER BY month`, [supplier, Number(year), months]);
  return rows.map((r) => ({
    month: Number(r.month),
    avgDieLifeMt: num(r.avg_die_life_mt),
    diesInService: num(r.dies_in_service),
    diesFailed: num(r.dies_failed),
  }));
}

async function getDieLifeForPeriod(pool, { supplier, year, months }) {
  return aggregateDieLife(await getDieLifeRows(pool, { supplier, year, months }));
}
```

Replace the export line with:

```js
module.exports = {
  validateEntry, aggregateDieLife,
  listDieLife, saveDieLife, getDieLifeRows, getDieLifeForPeriod,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx node --test server/services/supplierDieLife.test.cjs`

Expected: PASS, 21 tests.

- [ ] **Step 5: Run the whole backend suite for regressions**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/supplierDieLife.cjs server/services/supplierDieLife.test.cjs
git commit -m "feat(die-life): list, upsert and period reads with attribution"
```

---

### Task 4: Die life routes

**Files:**
- Modify: `server/routes/supplier-performance.cjs`

**Interfaces:**
- Consumes: `listDieLife`, `saveDieLife` from Task 3
- Produces:
  - `GET /api/supplier-performance/die-life?year=&month=` → `[{ supplier, avgDieLifeMt, diesInService, diesFailed, updatedBy, updatedAt }]`
  - `PUT /api/supplier-performance/die-life` body `{ year, month, entries: [...] }` → the saved list

- [ ] **Step 1: Add the routes**

In `server/routes/supplier-performance.cjs`, add the require beside the existing ones at the top:

```js
const dieLife = require('../services/supplierDieLife.cjs');
```

Then insert these two handlers **above** the `router.get('/', ...)` handler. Express matches in order, and `/` is registered last so it does not shadow the named paths:

```js
// Manual monthly die life capture. Readable and writable by any authenticated
// user, not admin-only: this is a routine monthly task, and making one person
// the bottleneck guarantees months get skipped. updated_by is the control.
router.get('/die-life', authMiddleware, async (req, res) => {
    try {
        const year = Number(req.query.year) || new Date().getFullYear();
        const month = Number(req.query.month) || (new Date().getMonth() + 1);
        res.json(await dieLife.listDieLife(pool, { year, month }));
    } catch (error) { handle(res, error, 'Failed to fetch die life data'); }
});

router.put('/die-life', authMiddleware, async (req, res) => {
    try {
        const { year, month, entries } = req.body || {};
        res.json(await dieLife.saveDieLife(pool, { year, month, entries }, req.user && req.user.id));
    } catch (error) { handle(res, error, 'Failed to save die life data'); }
});
```

- [ ] **Step 2: Verify by hand**

Start the server (`npm run server`) and, with a valid token from a browser session, confirm the round trip. Expected: the PUT returns the saved row, and the GET returns it again with `updatedBy` set to your username.

There is no route test harness in this repo and this plan does not add one — the logic under these handlers is already covered by Task 3's tests.

- [ ] **Step 3: Commit**

```bash
git add server/routes/supplier-performance.cjs
git commit -m "feat(die-life): read and write routes for monthly entry"
```

---

### Task 5: The entry tab

**Files:**
- Create: `src/pages/analytics/DieLifeTab.jsx`
- Modify: `src/api.js` (in `supplierPerformanceAPI`, ~line 282)
- Modify: `src/pages/AnalyticsPage.jsx`

**Interfaces:**
- Consumes: the two routes from Task 4; `supplierPerformanceAPI.getSuppliers()` which already exists
- Produces: `supplierPerformanceAPI.getDieLife({ year, month })`, `supplierPerformanceAPI.saveDieLife({ year, month, entries })`

- [ ] **Step 1: Add the API methods**

In `src/api.js`, inside `supplierPerformanceAPI`, after `getReport`:

```js
    getDieLife: async ({ year, month }) => {
        const qs = new URLSearchParams({ year: String(year), month: String(month) });
        return apiRequest(`/supplier-performance/die-life?${qs}`);
    },

    saveDieLife: async ({ year, month, entries }) => apiRequest('/supplier-performance/die-life', {
        method: 'PUT',
        body: JSON.stringify({ year, month, entries }),
    }),
```

- [ ] **Step 2: Create the tab**

Create `src/pages/analytics/DieLifeTab.jsx`:

```jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Save } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { MONTHS } from '../../utils/constants';
import { dialogs } from '../../components/ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Manual monthly die life entry. Nothing in this system records tonnage, so
// these three numbers per supplier are typed in once a month.
//
// The failure percentage is shown but never typed: it is derived here exactly
// as the server derives it, so the person entering counts can see the number
// the supplier will be judged on while they can still correct the counts.
export default function DieLifeTab({ theme }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [suppliers, setSuppliers] = useState([]);
  const [rows, setRows] = useState({});
  const [saved, setSaved] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supplierPerformanceAPI.getSuppliers()
      .then((list) => { if (!cancelled) setSuppliers(list || []); })
      .catch(() => { if (!cancelled) setError('Could not load the supplier list.'); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await supplierPerformanceAPI.getDieLife({ year, month });
      const next = {};
      for (const r of data || []) next[r.supplier] = r;
      setRows(next);
      setSaved(next);
    } catch (e) {
      setError(e.message || 'Could not load die life data.');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // '' is how an empty box reaches the server, where it becomes NULL. A typed
  // 0 stays 0. The two must never collapse into one another.
  const edit = (supplier, field, raw) => {
    setRows((prev) => ({ ...prev, [supplier]: { ...(prev[supplier] || { supplier }), [field]: raw === '' ? null : Number(raw) } }));
  };

  const failureOf = (r) => {
    if (!r) return null;
    const svc = r.diesInService;
    const bad = r.diesFailed;
    if (svc == null || svc <= 0 || bad == null) return null;
    return (bad / svc) * 100;
  };

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(saved), [rows, saved]);

  const save = async () => {
    setSaving(true);
    try {
      // Only send rows with something in them. An untouched supplier should not
      // get a row of nulls written against its name.
      const entries = suppliers
        .map((s) => rows[s])
        .filter((r) => r && (r.avgDieLifeMt != null || r.diesInService != null || r.diesFailed != null))
        .map((r) => ({ supplier: r.supplier, avgDieLifeMt: r.avgDieLifeMt, diesInService: r.diesInService, diesFailed: r.diesFailed }));
      const data = await supplierPerformanceAPI.saveDieLife({ year, month, entries });
      const next = {};
      for (const r of data || []) next[r.supplier] = r;
      setRows(next); setSaved(next);
      dialogs.notify('Die life data saved.', 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => thisYear - 4 + i);
  const select = { padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', cursor: 'pointer' };
  const label = { fontSize: 9.5, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 };
  const cell = { padding: '8px 10px', fontSize: '0.8rem', color: theme.text };
  const input = { width: 90, padding: '5px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: theme.text, fontSize: '0.78rem' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.25rem' }}>
        <div>
          <label style={label} htmlFor="dl-year">Year</label>
          <select id="dl-year" value={year} onChange={(e) => setYear(Number(e.target.value))} style={select}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="dl-month">Month</label>
          <select id="dl-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} style={select}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <button onClick={save} disabled={saving || !dirty}
          style={{ marginLeft: 'auto', padding: '9px 16px', background: dirty ? BRAND.navy : theme.cardBorder, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: dirty && !saving ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Save size={15} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p style={{ fontSize: 12, color: theme.textDim, marginTop: 0, marginBottom: '1rem', lineHeight: 1.6, maxWidth: 720 }}>
        Leave a box empty where you have no figure. An empty box means <em>not recorded</em> and is
        left out of the supplier&rsquo;s rating — it is not read as zero. Failure&nbsp;% is worked out
        from the counts and cannot be typed.
      </p>

      {error && <div style={{ padding: 16, borderRadius: 10, border: '1px solid #EF4444', color: '#EF4444', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{error}</div>}
      {loading && <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>Loading…</div>}

      {!loading && (
        <div style={{ background: theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Supplier', 'Avg Die Life (MT)', 'Dies In Service', 'Dies Failed', 'Failure %', 'Last updated'].map((h) => (
                  <th key={h} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const r = rows[s] || {};
                const pct = failureOf(r);
                return (
                  <tr key={s} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 600 }}>{s}</td>
                    {['avgDieLifeMt', 'diesInService', 'diesFailed'].map((f) => (
                      <td key={f} style={cell}>
                        <input type="number" step="any" min="0" aria-label={`${s} ${f}`}
                          value={r[f] == null ? '' : r[f]}
                          onChange={(e) => edit(s, f, e.target.value)} style={input} />
                      </td>
                    ))}
                    <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', color: pct == null ? theme.textDim : theme.text }}>
                      {pct == null ? '—' : `${pct.toFixed(1)}%`}
                    </td>
                    <td style={{ ...cell, color: theme.textDim, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {r.updatedBy ? `${r.updatedBy} · ${new Date(r.updatedAt).toLocaleDateString()}` : '—'}
                    </td>
                  </tr>
                );
              })}
              {suppliers.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: theme.textDim }}>No suppliers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the tab to the page**

In `src/pages/AnalyticsPage.jsx`:

Add the import beside the other two:

```jsx
import DieLifeTab from './analytics/DieLifeTab';
```

Extend `TABS`:

```jsx
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'supplier', label: 'Supplier Report' },
  { id: 'dielife', label: 'Die Life Data' },
];
```

Add the panel after the existing `supplier` panel div:

```jsx
      <div style={{ display: tab === 'dielife' ? 'block' : 'none' }}>
        <DieLifeTab theme={theme} />
      </div>
```

- [ ] **Step 4: Verify**

Run: `npm run build:check`

Expected: lint clean, build succeeds.

Then in the browser: open Analytics → Die Life Data, enter figures for one supplier, save, switch month and back. Confirm the values reload, the Last updated column shows your username, Failure % updates as you type, and **an empty box stays empty after a save rather than becoming 0**.

- [ ] **Step 5: Commit**

```bash
git add src/api.js src/pages/analytics/DieLifeTab.jsx src/pages/AnalyticsPage.jsx
git commit -m "feat(die-life): monthly entry tab with derived failure rate"
```

---

# Phase 2 — Year-scoped targets

*Ends with: targets are stored per year and resolve backwards. No scoring change yet.*

---

### Task 6: Year-scoped settings

**Files:**
- Modify: `server/db.cjs`
- Modify: `init.sql`
- Modify: `server/services/supplierPerformanceSettings.cjs`
- Modify: `server/services/supplierPerformanceSettings.test.cjs`

**Interfaces:**
- Consumes: nothing
- Produces: `getSettings(pool, year)` and `saveSettings(pool, year, metrics)` — note the **new middle argument on save**, which Task 7 must pass

- [ ] **Step 1a: Add the column beside the settings table in `server/db.cjs`**

Everything from line 80 of `db.cjs` is a **single** `client.query(\`...\`)` template literal, so statements execute in the order they appear in the file. That constrains where each half of this step goes.

Immediately after the `CREATE TABLE IF NOT EXISTS supplier_performance_settings (...)` block (~line 523):

```sql
      -- Scoring targets are set annually: 77 MT is 2026's die life KPI, not a
      -- constant. Without a year, setting 2027's targets would silently
      -- rescore a report already sent to a supplier in March 2026.
      ALTER TABLE supplier_performance_settings ADD COLUMN IF NOT EXISTS year INTEGER;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sps_year ON supplier_performance_settings (year);
```

- [ ] **Step 1b: Add the migration after `app_migrations` exists**

The backfill **cannot** go beside the code above. `app_migrations` is not created until ~line 854, and a `DO` block referencing it from line 523 fails at boot with `relation "app_migrations" does not exist`.

Put it directly after the existing `force_pwd_reset_all_users_v1` block, which is the nearest precedent and is already downstream of the marker table:

```sql
      -- Any pre-existing settings row was set against current-year performance,
      -- so that is the year it belongs to.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE id = 'sps_year_scope_v1') THEN
          UPDATE supplier_performance_settings
             SET year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
           WHERE year IS NULL;
          INSERT INTO app_migrations (id) VALUES ('sps_year_scope_v1');
        END IF;
      END $$;
```

Confirm the server boots before moving on: `npm run server` must start with no `relation ... does not exist` error.

- [ ] **Step 2: Mirror it in `init.sql`**

Add `year INTEGER` to the `supplier_performance_settings` column list and add the unique index. A fresh database has no rows, so the `DO $$` migration is not needed there.

- [ ] **Step 3: Write the failing tests**

In `server/services/supplierPerformanceSettings.test.cjs`, **replace** the three tests named `getSettings returns the code defaults when no row exists`, `getSettings merges stored tunables over the defaults`, and `getSettings falls back to defaults when the stored JSON is junk` with these, and add the rest:

```js
test('getSettings returns the code defaults when no row exists', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.deepEqual(await s.getSettings(pool, 2026), s.METRIC_DEFAULTS);
});

test('getSettings merges stored tunables over the defaults', async () => {
  const pool = makePool([{ rows: [{ metrics: JSON.stringify([{ key: 'designLeadTime', target: 2, ten: 2, zero: 8, weight: 0.15 }]) }] }]);
  const out = await s.getSettings(pool, 2026);
  const dlt = out.find(m => m.key === 'designLeadTime');
  assert.equal(dlt.target, 2);
  assert.equal(dlt.zero, 8);
  assert.equal(dlt.label, 'Avg Design Lead Time', 'label comes from code, not the database');
});

test('getSettings falls back to defaults when the stored JSON is junk', async () => {
  const pool = makePool([{ rows: [{ metrics: 'not json' }] }]);
  assert.deepEqual(await s.getSettings(pool, 2026), s.METRIC_DEFAULTS);
});

test('getSettings asks only for years at or before the one requested', async () => {
  // The whole point of year scoping: setting 2027's targets must not rescore a
  // 2026 report that was already sent to a supplier.
  const pool = makePool([{ rows: [] }]);
  await s.getSettings(pool, 2026);
  assert.ok(/year <= \$1/.test(pool.calls[0].sql), 'must not resolve forward');
  assert.ok(/ORDER BY year DESC/.test(pool.calls[0].sql), 'nearest earlier year wins');
  assert.deepEqual(pool.calls[0].params, [2026]);
});

test('getSettings defaults to the current year when none is given', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.getSettings(pool);
  assert.equal(pool.calls[0].params[0], new Date().getFullYear());
});

test('saveSettings upserts against the given year', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveSettings(pool, 2027, s.METRIC_DEFAULTS);
  const ins = pool.calls.find(c => /INSERT INTO supplier_performance_settings/.test(c.sql));
  assert.ok(/ON CONFLICT \(year\)/.test(ins.sql));
  assert.equal(ins.params[0], 2027);
});

test('saveSettings rejects a missing year', async () => {
  const pool = makePool([]);
  await assert.rejects(() => s.saveSettings(pool, null, s.METRIC_DEFAULTS), (e) => e.status === 400);
});
```

Also update the existing `saveSettings persists only the tunable fields` test to pass a year:

```js
test('saveSettings persists only the tunable fields', async () => {
  const pool = makePool([{ rows: [] }, { rows: [] }]);
  await s.saveSettings(pool, 2026, s.METRIC_DEFAULTS);
  const ins = pool.calls.find(c => /INSERT INTO supplier_performance_settings/.test(c.sql));
  const stored = JSON.parse(ins.params[1]);
  assert.deepEqual(Object.keys(stored[0]).sort(), ['key', 'target', 'ten', 'weight', 'zero']);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx node --test server/services/supplierPerformanceSettings.test.cjs`

Expected: FAIL on the year-scoping assertions — the current query has no `year <= $1`.

- [ ] **Step 5: Rewrite `getSettings` and `saveSettings`**

In `server/services/supplierPerformanceSettings.cjs`, replace both functions:

```js
// Targets are set annually — 77 MT is 2026's die life KPI, not a constant — and
// these reports leave the building. A supplier sent 7.4/10 in March must get
// 7.4/10 if they ask for a copy in November, so a report resolves the targets
// for its own year.
//
// Resolution order: the exact year, then the most recent EARLIER year, then the
// code defaults. Never forward: setting 2027's targets must not rescore 2026.
async function getSettings(pool, year) {
  const y = Number(year) || new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT metrics FROM supplier_performance_settings
      WHERE year IS NOT NULL AND year <= $1
      ORDER BY year DESC LIMIT 1`, [y]);

  let stored = [];
  try {
    const parsed = JSON.parse(rows[0]?.metrics || '[]');
    if (Array.isArray(parsed)) stored = parsed;
  } catch { stored = []; }

  // Presentation fields always come from code; only tunables are read back.
  return METRIC_DEFAULTS.map((def) => {
    const s = stored.find(x => x && x.key === def.key);
    if (!s) return def;
    const merged = { ...def };
    for (const f of TUNABLE) if (Number.isFinite(Number(s[f]))) merged[f] = Number(s[f]);
    return merged;
  });
}

async function saveSettings(pool, year, metrics) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw fail(400, 'A valid year is required');
  validateMetrics(metrics);
  const slim = metrics
    .filter(m => METRIC_DEFAULTS.find(d => d.key === m.key && d.scored))
    .map(m => ({ key: m.key, ten: Number(m.ten), zero: Number(m.zero), target: Number(m.target), weight: Number(m.weight) }));
  await pool.query(
    `INSERT INTO supplier_performance_settings (year, metrics) VALUES ($1, $2)
     ON CONFLICT (year) DO UPDATE
        SET metrics = EXCLUDED.metrics, updated_at = CURRENT_TIMESTAMP`,
    [y, JSON.stringify(slim)]);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS. The `supplier-performance.cjs` route still calls `getSettings(pool)` with no year — that keeps working, defaulting to the current year, and Task 7 fixes it properly.

- [ ] **Step 7: Commit**

```bash
git add server/db.cjs init.sql server/services/supplierPerformanceSettings.cjs server/services/supplierPerformanceSettings.test.cjs
git commit -m "feat(scorecard): scope scoring targets by year"
```

---

### Task 7: Year selector in Settings

**Files:**
- Modify: `server/routes/supplier-performance.cjs`
- Modify: `src/api.js`
- Modify: `src/components/settings/SupplierTargetsCard.jsx`

**Interfaces:**
- Consumes: `getSettings(pool, year)`, `saveSettings(pool, year, metrics)` from Task 6
- Produces: `supplierPerformanceAPI.getSettings(year)`, `supplierPerformanceAPI.saveSettings(year, metrics)`

- [ ] **Step 1: Pass the year through the routes**

In `server/routes/supplier-performance.cjs`, replace the settings handlers:

```js
router.get('/settings', authMiddleware, async (req, res) => {
    try {
        const year = Number(req.query.year) || new Date().getFullYear();
        res.json(await settings.getSettings(pool, year));
    } catch (error) { handle(res, error, 'Failed to fetch scoring settings'); }
});

router.put('/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const year = Number(req.body && req.body.year) || new Date().getFullYear();
        await settings.saveSettings(pool, year, req.body && req.body.metrics);
        res.json(await settings.getSettings(pool, year));
    } catch (error) { handle(res, error, 'Failed to save scoring settings'); }
});
```

And in the `router.get('/', ...)` report handler, replace `await settings.getSettings(pool)` with the report's own year:

```js
        const metrics = await settings.getSettings(pool, year);
```

- [ ] **Step 2: Update the API client**

In `src/api.js`, replace the two settings methods in `supplierPerformanceAPI`:

```js
    getSettings: async (year) => {
        const qs = new URLSearchParams(year ? { year: String(year) } : {});
        return apiRequest(`/supplier-performance/settings${qs.toString() ? `?${qs}` : ''}`);
    },

    saveSettings: async (year, metrics) => apiRequest('/supplier-performance/settings', {
        method: 'PUT',
        body: JSON.stringify({ year, metrics }),
    }),
```

- [ ] **Step 3: Add the year selector to the card**

In `src/components/settings/SupplierTargetsCard.jsx`:

Add `useCallback` to the React import, then replace the state and effect:

```jsx
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [metrics, setMetrics] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback((y) => {
    supplierPerformanceAPI.getSettings(y)
      .then((rows) => setMetrics(rows || []))
      .catch(() => setMetrics([]));
  }, []);

  useEffect(() => { load(year); }, [load, year]);
```

Replace `save`:

```jsx
  const save = async () => {
    setSaving(true);
    try {
      setMetrics(await supplierPerformanceAPI.saveSettings(year, metrics));
      dialogs.notify(`Scoring targets saved for ${year}.`, 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Copying is a read of the previous year's resolved settings — which already
  // falls back to the nearest earlier year — into this year's unsaved form.
  const copyPrevious = async () => {
    try {
      setMetrics(await supplierPerformanceAPI.getSettings(year - 1));
      dialogs.notify(`Loaded ${year - 1} targets. Review them, then save to apply to ${year}.`, 'info');
    } catch (e) {
      dialogs.notify('Could not load the previous year: ' + e.message, 'error');
    }
  };
```

Replace the header `<p>` description with one that names the year, and add the controls just below it:

```jsx
        <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: '0.75rem' }}>
          Drives the rating on the Analytics &rarr; Supplier Report tab. &ldquo;10 at&rdquo; scores full marks,
          &ldquo;0 at&rdquo; scores nothing; weights must total 100%. Targets are held per year, so a report
          already sent to a supplier keeps the score it was given.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: '0.78rem', color: theme.textDim }} htmlFor="st-year">Targets for</label>
          <select id="st-year" value={year} onChange={(e) => setYear(Number(e.target.value))}
            style={{ padding: '6px 10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>
            {Array.from({ length: 6 }, (_, i) => thisYear - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {isAdmin && (
            <button onClick={copyPrevious} type="button"
              style={{ padding: '6px 12px', background: 'transparent', border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.78rem', cursor: 'pointer' }}>
              Copy from {year - 1}
            </button>
          )}
        </div>
```

Finally, change the save button label so nobody edits the wrong year by accident:

```jsx
            Save {year} targets
```

- [ ] **Step 4: Verify**

Run: `npm run build:check`

Expected: lint clean, build succeeds.

In the browser: Settings → Supplier Scoring Targets. Change the year to next year, click *Copy from*, adjust a target, save. Switch back to this year and confirm this year's values are unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/routes/supplier-performance.cjs src/api.js src/components/settings/SupplierTargetsCard.jsx
git commit -m "feat(scorecard): edit scoring targets per year"
```

---

# Phase 3 — Scoring

*Ends with: die life and die failure are part of the rating. **Every supplier's score changes in this phase.***

---

### Task 8: Two new metrics

**Files:**
- Modify: `server/services/supplierPerformanceSettings.cjs`
- Modify: `server/services/supplierPerformanceSettings.test.cjs`
- Modify: `server/services/supplierPerformance.test.cjs`

**Interfaces:**
- Consumes: `scoreMetric(metric, value)` from `supplierPerformance.cjs` — unchanged
- Produces: `METRIC_DEFAULTS` containing keys `dieLife` and `dieFailure`

- [ ] **Step 1: Write the failing tests**

In `server/services/supplierPerformanceSettings.test.cjs`, **delete** the test named `METRIC_DEFAULTS omits die life and die failure` — it asserts the opposite of what ships now — and put this in its place:

```js
test('METRIC_DEFAULTS carries die life and die failure', () => {
  // Replaces an earlier test asserting these were absent. They were omitted
  // when nothing recorded tonnage; supplier_die_life now does.
  const keys = s.METRIC_DEFAULTS.map(m => m.key);
  assert.ok(keys.includes('dieLife'));
  assert.ok(keys.includes('dieFailure'));
});

test('die life is the only higher-is-better metric', () => {
  const dl = s.METRIC_DEFAULTS.find(m => m.key === 'dieLife');
  assert.equal(dl.lowerBetter, false);
  assert.equal(dl.ten, 77, "2026's KPI target");
  assert.equal(dl.zero, 20);
  const others = s.METRIC_DEFAULTS.filter(m => m.scored && m.key !== 'dieLife');
  for (const m of others) assert.equal(m.lowerBetter, true, `${m.key} should be lower-better`);
});

test('die life and die failure together carry 45% of the rating', () => {
  const w = (k) => s.METRIC_DEFAULTS.find(m => m.key === k).weight;
  assert.equal(Math.round((w('dieLife') + w('dieFailure')) * 100), 45);
});
```

In `server/services/supplierPerformance.test.cjs`, append:

```js
const settings = require('./supplierPerformanceSettings.cjs');
const dieLifeMetric = settings.METRIC_DEFAULTS.find(m => m.key === 'dieLife');
const dieFailureMetric = settings.METRIC_DEFAULTS.find(m => m.key === 'dieFailure');

// The higher-is-better branch of scoreMetric has never run in production —
// every metric until now was lower-better. Untested branches are where the
// bugs live.
test('scoreMetric scores die life on the higher-is-better branch', () => {
  assert.equal(m.scoreMetric(dieLifeMetric, 77), 10);
  assert.equal(m.scoreMetric(dieLifeMetric, 20), 0);
  assert.equal(Math.round(m.scoreMetric(dieLifeMetric, 48.5) * 100) / 100, 5);
});

test('scoreMetric clamps die life at both ends', () => {
  assert.equal(m.scoreMetric(dieLifeMetric, 500), 10, 'beating the target cannot score above 10');
  assert.equal(m.scoreMetric(dieLifeMetric, 0), 0, 'below the floor cannot score below 0');
});

test('scoreMetric scores die failure lower-is-better', () => {
  assert.equal(m.scoreMetric(dieFailureMetric, 19), 10);
  assert.equal(m.scoreMetric(dieFailureMetric, 40), 0);
  assert.equal(m.scoreMetric(dieFailureMetric, 60), 0, 'clamped');
});

test('an unrecorded die life is excluded, not scored zero', () => {
  const snapshot = { dieLife: null, dieFailure: null, designLeadTime: 3, deliveryLeadTime: 30, trialRatio: 1.5, qdRate: 5, designRevisions: 1 };
  const out = m.overallRating(settings.METRIC_DEFAULTS, snapshot);
  assert.equal(out.score, 10, 'renormalised over the metrics that have data');
  assert.equal(out.contributing, 5);
});
```

Check the top of `supplierPerformance.test.cjs` for how the module is imported; if it is not bound to `m`, match the existing name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --test server/services/supplierPerformanceSettings.test.cjs server/services/supplierPerformance.test.cjs`

Expected: FAIL — `dieLife` is not in `METRIC_DEFAULTS`, so `dieLifeMetric` is `undefined`.

- [ ] **Step 3: Rewrite the metric defaults**

In `server/services/supplierPerformanceSettings.cjs`, replace the header comment and the whole `METRIC_DEFAULTS` array:

```js
// Scoring targets and weights for the supplier scorecard.
//
// Die Life and Die Failure were absent at launch because nothing in the schema
// recorded tonnage extruded or dies failing before rated life. They are now
// captured by hand each month in supplier_die_life, and carry 45% of the
// rating between them — the weighting the original design intended.
//
// Targets are resolved per year: 77 MT is the 2026 die life KPI and under 19%
// is the 2026 failure target, both set by the business. The lead-time and trial
// seeds come from the observed distribution on real orders, not from a mock.
//
// See docs/superpowers/specs/2026-08-05-die-life-failure-and-report-pdf-design.md.
const METRIC_DEFAULTS = [
  { key: 'ordersPlaced', label: 'Orders Placed', unit: '', scored: false, decimals: 0,
    blurb: 'Dies ordered in the period' },
  // The only higher-is-better metric in the system, and the heaviest.
  { key: 'dieLife', label: 'Avg Die Life', unit: 'MT', scored: true,
    lowerBetter: false, ten: 77, zero: 20, target: 77, weight: 0.25, decimals: 1,
    blurb: 'Tonnage extruded per die, entered monthly' },
  // 19% is the business target. The 0-point of 40% is a seed, roughly the 2x
  // spread the other quality metrics use — revisit once real failure data
  // accumulates.
  { key: 'dieFailure', label: 'Die Failure Rate', unit: '%', scored: true,
    lowerBetter: true, ten: 19, zero: 40, target: 19, weight: 0.20, decimals: 1,
    blurb: 'Dies failing before rated life' },
  { key: 'deliveryLeadTime', label: 'Avg Delivery Lead Time', unit: 'days', scored: true,
    lowerBetter: true, ten: 30, zero: 55, target: 30, weight: 0.20, decimals: 0,
    blurb: 'Order placed → die received on site' },
  { key: 'designLeadTime', label: 'Avg Design Lead Time', unit: 'days', scored: true,
    lowerBetter: true, ten: 3, zero: 10, target: 3, weight: 0.15, decimals: 1,
    blurb: 'Order placed → design received' },
  { key: 'trialRatio', label: 'Avg Trial Ratio', unit: 'trials/die', scored: true,
    lowerBetter: true, ten: 1.5, zero: 3.0, target: 1.5, weight: 0.10, decimals: 2,
    blurb: 'Trials needed before acceptance' },
  // QD Rate and Design Revisions drop to 5% each. Both are known-flat: only 8
  // QDs exist and 1 order of 659 has any revisions, so neither can currently
  // tell one supplier from another. That weight is better spent on die life.
  { key: 'qdRate', label: 'QD Rate', unit: '%', scored: true,
    lowerBetter: true, ten: 5, zero: 20, target: 5, weight: 0.05, decimals: 1,
    blurb: 'Discrepancies raised per die received' },
  { key: 'designRevisions', label: 'Design Revisions', unit: 'per die', scored: true,
    lowerBetter: true, ten: 1.0, zero: 3.0, target: 1.0, weight: 0.05, decimals: 2,
    blurb: 'Design revisions before approval' },
];
```

Weights: 25 + 20 + 20 + 15 + 10 + 5 + 5 = 100.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS. The existing `METRIC_DEFAULTS weights total exactly 1` test guards the arithmetic above.

- [ ] **Step 5: Add the two metric colours**

In `src/components/analytics/metricStyle.js`, add to `COLORS`:

```js
  dieLife: '#14B8A6',
  dieFailure: '#F43F5E',
```

- [ ] **Step 6: Commit**

```bash
git add server/services/supplierPerformanceSettings.cjs server/services/supplierPerformanceSettings.test.cjs server/services/supplierPerformance.test.cjs src/components/analytics/metricStyle.js
git commit -m "feat(scorecard): score die life and die failure at 45% of the rating"
```

---

### Task 9: Feed die life into the snapshot

**Files:**
- Modify: `server/services/supplierPerformanceData.cjs`
- Modify: `server/services/supplierPerformanceData.test.cjs`

**Interfaces:**
- Consumes: `getDieLifeForPeriod(pool, { supplier, year, months })` from Task 3
- Produces: `getSnapshot` return value gains `dieLife` and `dieFailure` keys; `getMonthlyTrend` inherits them because it calls `getSnapshot` per month

- [ ] **Step 1: Write the failing test**

Append to `server/services/supplierPerformanceData.test.cjs`:

```js
test('getSnapshot derives the die life period from its own date range', async () => {
  // getSnapshot's signature stays { supplier, from, to }; the months are parsed
  // out of those dates so no caller has to change.
  const pool = makePool([
    { rows: [{ orders_placed: '3', design_lead_time: '2', trial_ratio: null, design_revisions: null }] },
    { rows: [{ delivery_lead_time: '25', dies_received: '2' }] },
    { rows: [{ qd_count: '0' }] },
    { rows: [{ month: 4, avg_die_life_mt: '60', dies_in_service: 10, dies_failed: 2 }] },
  ]);
  const out = await d.getSnapshot(pool, { supplier: 'PHME', from: '2026-04-01', to: '2026-06-30' });
  const dieCall = pool.calls.find(c => /supplier_die_life/.test(c.sql));
  assert.deepEqual(dieCall.params, ['PHME', 2026, [4, 5, 6]]);
  assert.equal(out.dieLife, 60);
  assert.equal(out.dieFailure, 20);
});

test('getSnapshot returns null die life when nothing was entered', async () => {
  const pool = makePool([
    { rows: [{ orders_placed: '1', design_lead_time: null, trial_ratio: null, design_revisions: null }] },
    { rows: [{ delivery_lead_time: null, dies_received: '0' }] },
    { rows: [{ qd_count: '0' }] },
    { rows: [] },
  ]);
  const out = await d.getSnapshot(pool, { supplier: 'NEWCO', from: '2026-08-01', to: '2026-08-31' });
  assert.equal(out.dieLife, null);
  assert.equal(out.dieFailure, null, 'unrecorded is not a perfect 0%');
});
```

Check the top of the file for the existing `makePool` helper and the name the data module is imported as; if it is not `d`, match what is there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test server/services/supplierPerformanceData.test.cjs`

Expected: FAIL — no query touches `supplier_die_life`, and `out.dieLife` is `undefined`.

- [ ] **Step 3: Wire it in**

In `server/services/supplierPerformanceData.cjs`, add the require at the top after `'use strict';`:

```js
const { getDieLifeForPeriod } = require('./supplierDieLife.cjs');
```

Add this helper above `getSnapshot`:

```js
// The die life table is keyed by (year, month), not by date. Deriving the month
// list from the range getSnapshot already has keeps its signature — and every
// caller, including getMonthlyTrend — untouched.
function monthsOfRange(from, to) {
  const year = Number(String(from).slice(0, 4));
  const first = Number(String(from).slice(5, 7));
  const last = Number(String(to).slice(5, 7));
  const months = [];
  for (let m = first; m <= last; m += 1) months.push(m);
  return { year, months };
}
```

At the end of `getSnapshot`, before the `return`, add:

```js
  const { year, months } = monthsOfRange(from, to);
  const die = await getDieLifeForPeriod(pool, { supplier, year, months });
```

and add two keys to the returned object:

```js
    dieLife: die.dieLife,
    dieFailure: die.dieFailure,
```

Add `monthsOfRange` to `module.exports` so tests and the PDF route can reuse it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/supplierPerformanceData.cjs server/services/supplierPerformanceData.test.cjs
git commit -m "feat(scorecard): merge die life into the period snapshot"
```

---

### Task 10: The matrix on screen

**Files:**
- Create: `src/components/analytics/DieLifeMatrix.jsx`
- Modify: `server/routes/supplier-performance.cjs`
- Modify: `src/pages/analytics/SupplierReportTab.jsx`

**Interfaces:**
- Consumes: `getDieLifeRows`, `aggregateDieLife` from Task 3; `monthsOfRange` from Task 9
- Produces: the report payload gains `dieLifeRows: [{ month, avgDieLifeMt, diesInService, diesFailed }]` — Task 12 renders the same array into the PDF

- [ ] **Step 1: Add the rows to the report payload**

In `server/routes/supplier-performance.cjs`, inside the `router.get('/', ...)` handler, after `const trend = await data.getMonthlyTrend(...)`:

```js
        // The month-by-month figures behind the two die life metrics. Sent with
        // the report so the on-screen matrix and the PDF render one source.
        const dieMonths = [];
        for (let i = 1; i <= data.MONTHS.indexOf(month) + 1; i += 1) dieMonths.push(i);
        const dieLifeRows = await dieLife.getDieLifeRows(pool, { supplier, year, months: dieMonths });
```

and add `dieLifeRows` to the `res.json({ ... })` object.

- [ ] **Step 2: Create the matrix component**

Create `src/components/analytics/DieLifeMatrix.jsx`:

```jsx
import React from 'react';
import { MONTHS } from '../../utils/constants';

// The month-by-month figures behind the die life and die failure scores.
//
// The counts are shown beside the percentage on purpose: a supplier who
// disputes a failure rate can be shown the two numbers it came from.
export default function DieLifeMatrix({ rows, theme }) {
  const data = rows || [];
  const cell = { padding: '7px 10px', fontSize: '0.78rem', color: theme.text, fontVariantNumeric: 'tabular-nums' };
  const head = { ...cell, color: theme.textDim, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' };
  const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));

  // Weighted exactly as the server aggregates, so the total row agrees with the
  // score. A simple mean here would quietly contradict the rating above it.
  let failed = 0, inService = 0, weighted = 0, weight = 0;
  for (const r of data) {
    if (r.diesInService != null) {
      inService += r.diesInService;
      if (r.diesFailed != null) failed += r.diesFailed;
      if (r.avgDieLifeMt != null && r.diesInService > 0) {
        weighted += r.avgDieLifeMt * r.diesInService;
        weight += r.diesInService;
      }
    }
  }
  const totalLife = weight > 0 ? weighted / weight : null;
  const totalRate = inService > 0 ? (failed / inService) * 100 : null;

  return (
    <div className="dt-span-all" style={{ padding: 16, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text, marginBottom: 10 }}>Die Life &amp; Failure</div>
      {data.length === 0 ? (
        <p style={{ fontSize: 12, color: theme.textDim, margin: 0 }}>
          No die life figures recorded for this supplier yet. Enter them on the Die Life Data tab.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col" style={{ ...head, textAlign: 'left' }}>Month</th>
                <th scope="col" style={head}>Avg Die Life (MT)</th>
                <th scope="col" style={head}>Dies In Service</th>
                <th scope="col" style={head}>Dies Failed</th>
                <th scope="col" style={head}>Failure %</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const pct = (r.diesInService != null && r.diesInService > 0 && r.diesFailed != null)
                  ? (r.diesFailed / r.diesInService) * 100 : null;
                return (
                  <tr key={r.month} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...cell, fontWeight: 600 }}>{MONTHS[r.month - 1]}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{fmt(r.avgDieLifeMt, 1)}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{fmt(r.diesInService)}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{fmt(r.diesFailed)}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{pct == null ? '—' : `${pct.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `2px solid ${theme.cardBorder}`, fontWeight: 700 }}>
                <td style={cell}>Period</td>
                <td style={{ ...cell, textAlign: 'right' }}>{fmt(totalLife, 1)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{inService || '—'}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{inService ? failed : '—'}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{totalRate == null ? '—' : `${totalRate.toFixed(1)}%`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Render it, and delete the stale sentence**

In `src/pages/analytics/SupplierReportTab.jsx`:

Add the import:

```jsx
import DieLifeMatrix from '../../components/analytics/DieLifeMatrix';
```

Insert the matrix between the metric grid and the Trends heading:

```jsx
          <div style={{ marginTop: '1.5rem' }}>
            <DieLifeMatrix rows={report.dieLifeRows} theme={theme} />
          </div>
```

Then **delete this sentence** from the closing paragraph:

```
            Die life and die failure are not tracked in this system and are not part of the rating.
```

It is currently printed on the last page of every exported report and is now false. Replace the paragraph with:

```jsx
          <p style={{ fontSize: 11, color: theme.textDim, marginTop: '1.5rem', lineHeight: 1.6 }}>
            Each metric is scored 0–10 against its target band, then combined using the weights above.
            Metrics with no data for the period are excluded from the rating rather than scored zero.
            Die life and die failure come from the figures entered on the Die Life Data tab.
          </p>
```

- [ ] **Step 4: Verify**

Run: `npm run build:check`

Expected: lint clean, build succeeds.

In the browser, on the Supplier Report tab: confirm the rating now names Die Life or Die Failure among its weighted metrics, the matrix shows the months you entered in Task 5, the Period row agrees with the Die Life metric card above it, and a supplier with no entries shows "Not tracked yet" on both new cards rather than 0.

- [ ] **Step 5: Commit**

```bash
git add server/routes/supplier-performance.cjs src/components/analytics/DieLifeMatrix.jsx src/pages/analytics/SupplierReportTab.jsx
git commit -m "feat(scorecard): die life matrix on the supplier report"
```

---

# Phase 4 — The PDF

*Ends with: Export produces a document fit to send to a supplier.*

---

### Task 11: Document skeleton and the scorecard page

**Files:**
- Create: `server/services/supplierReportPdf.cjs`
- Create: `server/services/supplierReportPdf.test.cjs`

**Interfaces:**
- Consumes: the report payload shape from Task 10 — `{ supplier, period: { from, to, frequency, year, month }, metrics, snapshot, scores, trend, rating, dieLifeRows }`
- Produces: `generateSupplierReportPdf(report, opts)` → `Promise<Uint8Array>`, where `opts` is `{ comments, preparedBy, logoBytes }`

- [ ] **Step 1: Write the failing test**

Create `server/services/supplierReportPdf.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateSupplierReportPdf } = require('./supplierReportPdf.cjs');

// Reads back every text run pdf-lib wrote, so a test can assert what the
// document actually says. Same helper qdPdf.test.cjs uses.
async function textOf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(content.items.map((i) => i.str).join(' '));
  }
  return pages;
}

const metrics = [
  { key: 'ordersPlaced', label: 'Orders Placed', unit: '', scored: false, decimals: 0 },
  { key: 'dieLife', label: 'Avg Die Life', unit: 'MT', scored: true, lowerBetter: false, ten: 77, zero: 20, target: 77, weight: 0.25, decimals: 1 },
  { key: 'dieFailure', label: 'Die Failure Rate', unit: '%', scored: true, lowerBetter: true, ten: 19, zero: 40, target: 19, weight: 0.20, decimals: 1 },
  { key: 'deliveryLeadTime', label: 'Avg Delivery Lead Time', unit: 'days', scored: true, lowerBetter: true, ten: 30, zero: 55, target: 30, weight: 0.20, decimals: 0 },
];

const baseReport = {
  supplier: 'PDTMC',
  period: { from: '2026-08-01', to: '2026-08-31', frequency: 'Monthly', year: 2026, month: 'Aug' },
  metrics,
  snapshot: { ordersPlaced: 12, dieLife: 64.4, dieFailure: 12.5, deliveryLeadTime: 27 },
  scores: { dieLife: 7.8, dieFailure: 10, deliveryLeadTime: 10 },
  trend: [
    { month: 'Jun', dieLife: 60, dieFailure: 15, deliveryLeadTime: 30, ordersPlaced: 4 },
    { month: 'Jul', dieLife: 70, dieFailure: 10, deliveryLeadTime: 28, ordersPlaced: 5 },
    { month: 'Aug', dieLife: 64.4, dieFailure: 12.5, deliveryLeadTime: 27, ordersPlaced: 3 },
  ],
  rating: { score: 8.9, contributing: 3, band: { label: 'Exceptional', color: '#16A34A', bg: '#F0FDF4' } },
  dieLifeRows: [
    { month: 6, avgDieLifeMt: 60, diesInService: 10, diesFailed: 2 },
    { month: 7, avgDieLifeMt: 70, diesInService: 20, diesFailed: 2 },
  ],
};

test('generateSupplierReportPdf returns a non-empty PDF', async () => {
  const bytes = await generateSupplierReportPdf(baseReport, {});
  assert.ok(bytes.length > 1000);
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), '%PDF');
});

test('page 1 names the supplier, the period and the rating', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  assert.match(pages[0], /PDTMC/);
  assert.match(pages[0], /Aug 2026/);
  assert.match(pages[0], /8\.9/);
  assert.match(pages[0], /Exceptional/);
});

test('page 1 prints the target each metric was judged against', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  // The document must be self-documenting: a supplier reading it next year has
  // to see the thresholds that applied, not have to trust them.
  assert.match(pages[0], /Avg Die Life/);
  assert.match(pages[0], /77/);
});

test('a metric with no data prints "Not recorded" rather than 0', async () => {
  const report = { ...baseReport, snapshot: { ...baseReport.snapshot, dieLife: null }, scores: { ...baseReport.scores, dieLife: null } };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.match(pages[0], /Not recorded/);
});

test('every page carries a footer naming the supplier and its page number', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  for (let i = 0; i < pages.length; i++) {
    assert.match(pages[i], new RegExp(`Page ${i + 1} of ${pages.length}`), `page ${i + 1} has no footer`);
  }
});

test('the document survives a supplier with no rating at all', async () => {
  const report = { ...baseReport, rating: null, snapshot: { ordersPlaced: 0 }, scores: {}, dieLifeRows: [], trend: [] };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.match(pages[0], /Not enough data/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test server/services/supplierReportPdf.test.cjs`

Expected: FAIL — `Cannot find module './supplierReportPdf.cjs'`

- [ ] **Step 3: Write the layout primitives and page 1**

Create `server/services/supplierReportPdf.cjs`:

```js
'use strict';

// The monthly supplier performance report, as a document fit to send to a
// supplier.
//
// This exists because window.print() cannot produce one. The browser injects
// its own header and footer -- the date, the URL, "1/3" -- and the only way to
// suppress them is for whoever exports to untick a box in the print dialog
// every single month. It also prints the live DOM, which is why the reviewed
// export carried the application's sidebar down the left of every page.
//
// Unlike qdPdf.cjs there is no controlled template to reproduce: the QD form is
// a certification record with fixed coordinates, this is a report that may
// reflow freely. The constants below are layout, not contract.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const NAVY = rgb(0.122, 0.435, 0.690); // BRAND.navy #1F6FB0

// StandardFonts are WinAnsi-encoded and throw on characters outside it. The
// metric labels and band names carry "·", and targets read "≤" — all of which
// would crash the generator rather than render. Replaced, not stripped, so the
// meaning survives.
function sanitize(str) {
  return String(str == null ? '' : str)
    .replace(/[·•]/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    // Anything still outside WinAnsi becomes a space rather than an exception.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

const hexColor = (hex) => {
  const h = String(hex || '#000000').replace('#', '');
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
};

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

function rule(page, y, { x = MARGIN, w = CONTENT_W, color = RULE, thickness = 0.7 } = {}) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });
}

// A table row. `cols` is [{ x, w, align }] and `cells` the strings for it.
function tableRow(page, cells, cols, { y, size = 9.5, font, color = INK }) {
  cells.forEach((c, i) => {
    const col = cols[i];
    if (!col) return;
    text(page, c, { x: col.x, y, size, font, color, align: col.align || 'left', width: col.w });
  });
}

const fmt = (v, decimals = 0) => (v == null ? null : Number(v).toFixed(decimals));

function drawHeader(page, report, { bold, font, logo }) {
  let y = PAGE_H - MARGIN;

  if (logo) {
    const maxH = 30;
    const scale = Math.min(maxH / logo.height, 150 / logo.width);
    page.drawImage(logo, { x: MARGIN, y: y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
  }
  text(page, 'SUPPLIER PERFORMANCE REPORT', { x: MARGIN, y: y - 12, size: 9, font: bold, color: MUTED, align: 'right', width: CONTENT_W });
  y -= 44;
  rule(page, y, { color: NAVY, thickness: 1.6 });
  y -= 26;

  text(page, report.supplier, { x: MARGIN, y, size: 22, font: bold });
  const p = report.period || {};
  text(page, `${p.month} ${p.year} - ${p.frequency}`, { x: MARGIN, y: y - 16, size: 10, font, color: MUTED });
  text(page, `Generated ${new Date().toISOString().slice(0, 10)}`, { x: MARGIN, y, size: 9, font, color: MUTED, align: 'right', width: CONTENT_W });
  return y - 40;
}

function drawRating(page, report, y, { bold, font }) {
  const r = report.rating;
  if (!r) {
    text(page, 'Not enough data to rate this supplier', { x: MARGIN, y, size: 13, font: bold });
    text(page, 'No scored metric has a value for this period.', { x: MARGIN, y: y - 15, size: 9.5, font, color: MUTED });
    return y - 44;
  }

  const bandColor = hexColor(r.band.color);
  page.drawRectangle({ x: MARGIN, y: y - 52, width: CONTENT_W, height: 64, color: rgb(0.97, 0.975, 0.98) });
  text(page, r.score.toFixed(1), { x: MARGIN + 16, y: y - 26, size: 34, font: bold, color: bandColor });
  text(page, '/10', { x: MARGIN + 16 + bold.widthOfTextAtSize(r.score.toFixed(1), 34) + 3, y: y - 26, size: 13, font, color: MUTED });
  text(page, r.band.label, { x: MARGIN + 120, y: y - 12, size: 12, font: bold, color: bandColor });

  const scored = (report.metrics || []).filter((m) => m.scored).length;
  const note = r.contributing < scored
    ? `Rated on ${r.contributing} of ${scored} scored metrics; the rating is renormalised over those with data.`
    : `Rated on all ${scored} scored metrics.`;
  text(page, note, { x: MARGIN + 120, y: y - 30, size: 9, font, color: MUTED });
  return y - 76;
}

function drawMetricTable(page, report, y, { bold, font }) {
  const cols = [
    { x: MARGIN, w: 170, align: 'left' },
    { x: MARGIN + 175, w: 80, align: 'right' },
    { x: MARGIN + 260, w: 80, align: 'right' },
    { x: MARGIN + 345, w: 60, align: 'right' },
    { x: MARGIN + 410, w: 89, align: 'right' },
  ];

  text(page, 'PERFORMANCE AGAINST TARGET', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;
  tableRow(page, ['Metric', 'Actual', 'Target', 'Weight', 'Score /10'], cols, { y, font: bold, color: MUTED, size: 8.5 });
  y -= 6;
  rule(page, y);
  y -= 15;

  for (const m of report.metrics || []) {
    if (!m.scored) continue;
    const value = report.snapshot ? report.snapshot[m.key] : null;
    const score = report.scores ? report.scores[m.key] : null;
    const unit = m.unit ? ` ${m.unit}` : '';

    const actual = value == null ? 'Not recorded' : `${fmt(value, m.decimals)}${unit}`;
    const target = `${m.lowerBetter ? '<=' : '>='} ${fmt(m.target, m.decimals)}${unit}`;
    const weight = `${Math.round(m.weight * 100)}%`;
    const scoreText = score == null ? '-' : score.toFixed(1);

    tableRow(page, [m.label, actual, target, weight, scoreText], cols, {
      y, font, size: 9.5, color: value == null ? MUTED : INK,
    });

    // A short bar under the score, so the table reads at a glance.
    if (score != null) {
      const barW = 89;
      const bx = cols[4].x;
      page.drawRectangle({ x: bx, y: y - 6, width: barW, height: 2.5, color: RULE });
      page.drawRectangle({ x: bx, y: y - 6, width: barW * (score / 10), height: 2.5, color: hexColor(scoreBandColor(score)) });
    }
    y -= 20;
  }

  const orders = report.snapshot ? report.snapshot.ordersPlaced : null;
  rule(page, y + 6);
  text(page, `Orders placed in the period: ${orders == null ? '-' : orders}`, { x: MARGIN, y: y - 8, size: 9, font, color: MUTED });
  return y - 30;
}

// Mirrors the server's ratingBand thresholds, colour only.
function scoreBandColor(score) {
  if (score >= 7.5) return '#16A34A';
  if (score >= 6.5) return '#0D9488';
  if (score >= 5.5) return '#D97706';
  if (score >= 4.0) return '#EA580C';
  return '#DC2626';
}

async function generateSupplierReportPdf(report, opts = {}) {
  const { logoBytes = null } = opts;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A report without a logo is still a usable report; the QD renderer takes the
  // same view of a missing asset.
  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  let y = drawHeader(p1, report, { bold, font, logo });
  y = drawRating(p1, report, y, { bold, font });
  drawMetricTable(p1, report, y, { bold, font });

  drawFooters(doc, report, { font });
  return doc.save();
}

// Footers are drawn last because "Page N of M" cannot be known until every page
// exists.
function drawFooters(doc, report, { font }) {
  const pages = doc.getPages();
  const p = report.period || {};
  pages.forEach((page, i) => {
    rule(page, MARGIN + 22);
    text(page, `Gulf Extrusion - Supplier Performance Report - ${report.supplier} - ${p.month} ${p.year}`,
      { x: MARGIN, y: MARGIN + 10, size: 7.5, font, color: MUTED });
    text(page, `Page ${i + 1} of ${pages.length}`,
      { x: MARGIN, y: MARGIN + 10, size: 7.5, font, color: MUTED, align: 'right', width: CONTENT_W });
    text(page, 'Confidential - issued to the named supplier for performance review.',
      { x: MARGIN, y: MARGIN, size: 6.5, font, color: MUTED });
  });
}

module.exports = { generateSupplierReportPdf, sanitize };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --test server/services/supplierReportPdf.test.cjs`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/supplierReportPdf.cjs server/services/supplierReportPdf.test.cjs
git commit -m "feat(report-pdf): A4 scorecard page with targets and footers"
```

---

### Task 12: The matrix page and the trend charts

**Files:**
- Modify: `server/services/supplierReportPdf.cjs`
- Modify: `server/services/supplierReportPdf.test.cjs`

**Interfaces:**
- Consumes: `report.dieLifeRows` from Task 10, `report.trend` from the existing route
- Produces: no new exports; `generateSupplierReportPdf` grows two sections

- [ ] **Step 1: Write the failing tests**

Append to `server/services/supplierReportPdf.test.cjs`:

```js
test('the matrix page lists each month with its counts', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  const matrix = pages.find((p) => /Die Life & Failure|Die Life and Failure/.test(p)) || pages[1];
  assert.match(matrix, /Jun/);
  assert.match(matrix, /Jul/);
  assert.match(matrix, /Dies In Service/);
});

test('the matrix total is weighted, agreeing with the score on page 1', async () => {
  // 10 dies at 60 MT and 20 at 70 MT weights to 66.7, not the simple mean 65.
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  const matrix = pages.find((p) => /Dies In Service/.test(p));
  assert.match(matrix, /66\.7/);
});

test('no matrix section when nothing was ever entered', async () => {
  const report = { ...baseReport, dieLifeRows: [] };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.ok(!pages.some((p) => /Dies In Service/.test(p)), 'an empty table is worse than no table');
});

test('a metric with no trend data produces no chart', async () => {
  const report = { ...baseReport, trend: [{ month: 'Aug', dieLife: null, dieFailure: null, deliveryLeadTime: null, ordersPlaced: 0 }] };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.ok(!pages.some((p) => /Not enough data/.test(p)),
    'the browser export wasted a page on five of these');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --test server/services/supplierReportPdf.test.cjs`

Expected: FAIL — no page contains `Dies In Service`.

- [ ] **Step 3: Add the matrix section**

Add to `server/services/supplierReportPdf.cjs`, above `generateSupplierReportPdf`:

```js
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The counts sit beside the percentage on purpose: a supplier who disputes a
// failure rate can be shown the two numbers it came from.
function drawMatrix(page, report, y, { bold, font }) {
  const rows = report.dieLifeRows || [];
  if (!rows.length) return y;

  const cols = [
    { x: MARGIN, w: 90, align: 'left' },
    { x: MARGIN + 95, w: 100, align: 'right' },
    { x: MARGIN + 200, w: 95, align: 'right' },
    { x: MARGIN + 300, w: 90, align: 'right' },
    { x: MARGIN + 395, w: 104, align: 'right' },
  ];

  text(page, 'DIE LIFE & FAILURE', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;
  tableRow(page, ['Month', 'Avg Die Life (MT)', 'Dies In Service', 'Dies Failed', 'Failure %'], cols,
    { y, font: bold, color: MUTED, size: 8.5 });
  y -= 6;
  rule(page, y);
  y -= 15;

  let failed = 0, inService = 0, weighted = 0, weight = 0;
  for (const r of rows) {
    const pct = (r.diesInService != null && r.diesInService > 0 && r.diesFailed != null)
      ? (r.diesFailed / r.diesInService) * 100 : null;
    tableRow(page, [
      MONTH_NAMES[r.month - 1] || String(r.month),
      fmt(r.avgDieLifeMt, 1) || '-',
      r.diesInService == null ? '-' : String(r.diesInService),
      r.diesFailed == null ? '-' : String(r.diesFailed),
      pct == null ? '-' : `${pct.toFixed(1)}%`,
    ], cols, { y, font, size: 9.5 });

    if (r.diesInService != null) {
      inService += r.diesInService;
      if (r.diesFailed != null) failed += r.diesFailed;
      if (r.avgDieLifeMt != null && r.diesInService > 0) {
        weighted += r.avgDieLifeMt * r.diesInService;
        weight += r.diesInService;
      }
    }
    y -= 17;
  }

  // Weighted exactly as the server aggregates. A simple mean here would print a
  // figure that quietly disagrees with the score on page 1.
  const totalLife = weight > 0 ? weighted / weight : null;
  const totalRate = inService > 0 ? (failed / inService) * 100 : null;
  rule(page, y + 6, { thickness: 1.1 });
  y -= 6;
  tableRow(page, [
    'Period',
    fmt(totalLife, 1) || '-',
    inService ? String(inService) : '-',
    inService ? String(failed) : '-',
    totalRate == null ? '-' : `${totalRate.toFixed(1)}%`,
  ], cols, { y, font: bold, size: 9.5 });

  y -= 20;
  text(page, 'Figures entered monthly. Failure % is derived from the counts, never entered directly.',
    { x: MARGIN, y, size: 8, font, color: MUTED });
  return y - 26;
}
```

- [ ] **Step 4: Add the trend charts**

Add below `drawMatrix`:

```js
// A small line chart, drawn as vector art. Metrics with fewer than two points
// are skipped entirely by the caller -- the browser export devoted a whole page
// to five boxes reading "Not enough data", which is not something to send to a
// supplier.
function drawTrendChart(page, { x, y, w, h, points, target, color, label, unit }, { bold, font }) {
  text(page, label, { x, y: y + h + 8, size: 9, font: bold });
  text(page, unit || '', { x, y: y + h + 8, size: 7.5, font, color: MUTED, align: 'right', width: w });

  const values = points.map((p) => p.value);
  const all = target != null ? [...values, target] : values;
  let min = Math.min(...all);
  let max = Math.max(...all);
  const range = (max - min) || 1;
  min -= range * 0.2;
  max += range * 0.2;
  const span = max - min;

  const px = (i) => x + (i / Math.max(1, points.length - 1)) * w;
  const py = (v) => y + ((v - min) / span) * h;

  page.drawRectangle({ x, y, width: w, height: h, borderColor: RULE, borderWidth: 0.6 });

  if (target != null) {
    const ty = py(target);
    page.drawLine({ start: { x, y: ty }, end: { x: x + w, y: ty }, thickness: 0.8, color: MUTED, dashArray: [3, 3] });
    text(page, `target ${target}`, { x: x - 2, y: ty + 3, size: 6.5, font, color: MUTED, align: 'right', width: w });
  }

  const c = hexColor(color);
  for (let i = 1; i < points.length; i += 1) {
    page.drawLine({
      start: { x: px(i - 1), y: py(points[i - 1].value) },
      end: { x: px(i), y: py(points[i].value) },
      thickness: 1.4, color: c,
    });
  }
  points.forEach((p, i) => {
    page.drawCircle({ x: px(i), y: py(p.value), size: 2, color: c });
    text(page, p.month, { x: px(i) - 12, y: y - 9, size: 6.5, font, color: MUTED, align: 'center', width: 24 });
  });
}

const TREND_COLORS = {
  dieLife: '#14B8A6', dieFailure: '#F43F5E', deliveryLeadTime: '#6366F1',
  designLeadTime: '#0EA5E9', trialRatio: '#8B5CF6', qdRate: '#EF4444', designRevisions: '#F59E0B',
};

// Returns the metrics that actually have two or more points to draw.
function trendable(report) {
  const out = [];
  for (const m of report.metrics || []) {
    if (!m.scored) continue;
    const points = (report.trend || [])
      .map((r) => ({ month: r.month, value: r[m.key] }))
      .filter((p) => Number.isFinite(Number(p.value)))
      .map((p) => ({ month: p.month, value: Number(p.value) }));
    if (points.length >= 2) out.push({ metric: m, points });
  }
  return out;
}
```

- [ ] **Step 5: Compose the extra pages**

In `generateSupplierReportPdf`, replace everything between the page-1 block and `drawFooters` with:

```js
  const matrixRows = report.dieLifeRows || [];
  if (matrixRows.length) {
    const p2 = doc.addPage([PAGE_W, PAGE_H]);
    drawMatrix(p2, report, PAGE_H - MARGIN - 20, { bold, font });
  }

  const charts = trendable(report);
  if (charts.length) {
    const p3 = doc.addPage([PAGE_W, PAGE_H]);
    text(p3, `TRENDS - JAN TO ${String((report.period || {}).month || '').toUpperCase()} ${(report.period || {}).year || ''}`,
      { x: MARGIN, y: PAGE_H - MARGIN - 20, size: 8.5, font: bold, color: MUTED });

    // Two per row, three rows a page.
    const cw = (CONTENT_W - 24) / 2;
    const ch = 96;
    let cy = PAGE_H - MARGIN - 64;
    let page = p3;
    charts.forEach((c, i) => {
      const col = i % 2;
      if (col === 0 && i > 0) cy -= ch + 44;
      if (cy < MARGIN + 60) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        cy = PAGE_H - MARGIN - 64;
      }
      drawTrendChart(page, {
        x: MARGIN + col * (cw + 24), y: cy - ch, w: cw, h: ch,
        points: c.points, target: c.metric.scored ? c.metric.target : null,
        color: TREND_COLORS[c.metric.key] || '#1F6FB0',
        label: c.metric.label, unit: c.metric.unit,
      }, { bold, font });
    });
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx node --test server/services/supplierReportPdf.test.cjs`

Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add server/services/supplierReportPdf.cjs server/services/supplierReportPdf.test.cjs
git commit -m "feat(report-pdf): die life matrix page and vector trend charts"
```

---

### Task 13: Comments and action points

**Files:**
- Modify: `server/services/supplierReportPdf.cjs`
- Modify: `server/services/supplierReportPdf.test.cjs`

**Interfaces:**
- Consumes: `opts.comments` (string) and `opts.preparedBy` (string) on `generateSupplierReportPdf`
- Produces: no new exports

- [ ] **Step 1: Write the failing tests**

Append to `server/services/supplierReportPdf.test.cjs`:

```js
test('comments are printed over the name of whoever generated the report', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {
    comments: 'Delivery has improved. Please hold the trial ratio below 1.5 next quarter.',
    preparedBy: 'Vijeesh',
  }));
  const joined = pages.join(' ');
  assert.match(joined, /Comments/i);
  assert.match(joined, /hold the trial ratio/);
  assert.match(joined, /Vijeesh/);
});

test('no comments section when none were written', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  assert.ok(!/Comments & Action Points/i.test(pages.join(' ')));
});

test('long comments wrap instead of running off the page', async () => {
  const long = 'The delivery lead time is the priority for the coming quarter and we expect it held under thirty days. '.repeat(8);
  const bytes = await generateSupplierReportPdf(baseReport, { comments: long, preparedBy: 'Vijeesh' });
  const pages = await textOf(bytes);
  assert.match(pages.join(' '), /priority for the coming quarter/);
});

test('a character outside WinAnsi does not crash the generator', async () => {
  // StandardFonts throw on unencodable characters. A supplier name or a comment
  // pasted from Word will contain them sooner or later.
  const report = { ...baseReport, supplier: 'PDTMC — 中文' };
  const bytes = await generateSupplierReportPdf(report, { comments: 'Target ≤ 30 days · confirmed' });
  assert.ok(bytes.length > 1000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --test server/services/supplierReportPdf.test.cjs`

Expected: FAIL — no page mentions comments.

- [ ] **Step 3: Add word wrapping and the comments section**

Add to `server/services/supplierReportPdf.cjs`, above `generateSupplierReportPdf`:

```js
// Greedy wrap against the real measured width. Long words that still overflow
// are left long rather than broken mid-word.
function wrapText(str, font, size, maxW) {
  const out = [];
  for (const para of sanitize(str).split(/\r?\n/)) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxW && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function drawComments(doc, report, comments, preparedBy, { bold, font }) {
  const body = String(comments || '').trim();
  if (!body) return;

  const size = 10;
  const leading = 15;
  const lines = wrapText(body, font, size, CONTENT_W);

  // Its own page, so the remarks are never orphaned two lines below a chart.
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN - 20;
  text(page, 'COMMENTS & ACTION POINTS', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 10;
  rule(page, y);
  y -= 24;

  for (const line of lines) {
    if (y < MARGIN + 90) break; // one page of remarks is enough
    text(page, line, { x: MARGIN, y, size, font });
    y -= leading;
  }

  y -= 24;
  rule(page, y, { w: 200 });
  text(page, sanitize(preparedBy || 'Gulf Extrusion'), { x: MARGIN, y: y - 13, size: 9.5, font: bold });
  text(page, `Prepared ${new Date().toISOString().slice(0, 10)}`, { x: MARGIN, y: y - 26, size: 8.5, font, color: MUTED });
}
```

In `generateSupplierReportPdf`, destructure the two new options and call it immediately before `drawFooters`:

```js
  const { logoBytes = null, comments = '', preparedBy = '' } = opts;
```

```js
  drawComments(doc, report, comments, preparedBy, { bold, font });
  drawFooters(doc, report, { font });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS across the whole suite.

- [ ] **Step 5: Commit**

```bash
git add server/services/supplierReportPdf.cjs server/services/supplierReportPdf.test.cjs
git commit -m "feat(report-pdf): comments and action points over a signature block"
```

---

### Task 14: Wire the export button

**Files:**
- Modify: `server/routes/supplier-performance.cjs`
- Modify: `src/api.js`
- Modify: `src/pages/analytics/SupplierReportTab.jsx`

**Interfaces:**
- Consumes: `generateSupplierReportPdf(report, { comments, preparedBy, logoBytes })` from Tasks 11–13
- Produces: `POST /api/supplier-performance/pdf`; `supplierPerformanceAPI.exportPdf({ supplier, year, month, frequency, comments })`

- [ ] **Step 1: Extract the report builder and add the PDF route**

In `server/routes/supplier-performance.cjs`, add these requires at the top:

```js
const fs = require('node:fs');
const path = require('node:path');
const { generateSupplierReportPdf } = require('../services/supplierReportPdf.cjs');
```

The `GET /` handler and the PDF route must produce the same numbers, so lift the body of `GET /` into a helper placed above both:

```js
// One builder for both the screen and the document. The PDF must never be
// rendered from a client-supplied snapshot: the figures a supplier receives
// come from the database, not from whatever the browser was holding.
async function buildReport({ supplier, year, month, frequency }) {
    const metrics = await settings.getSettings(pool, year);
    const { from, to } = data.periodRange({ year, month, frequency });
    const snapshot = await data.getSnapshot(pool, { supplier, from, to });
    const trend = await data.getMonthlyTrend(pool, { supplier, year, throughMonth: month });

    const dieMonths = [];
    for (let i = 1; i <= data.MONTHS.indexOf(month) + 1; i += 1) dieMonths.push(i);
    const dieLifeRows = await dieLife.getDieLifeRows(pool, { supplier, year, months: dieMonths });

    const scores = {};
    for (const m of metrics) scores[m.key] = model.scoreMetric(m, snapshot[m.key]);
    const overall = model.overallRating(metrics, snapshot);

    return {
        supplier,
        period: { from, to, frequency, year, month },
        metrics, snapshot, scores, trend, dieLifeRows,
        rating: overall ? { ...overall, band: model.ratingBand(overall.score) } : null,
    };
}

// Reads the query or body shared by both endpoints.
function readParams(src) {
    const supplier = String(src.supplier || '').trim();
    if (!supplier) throw Object.assign(new Error('A supplier is required'), { status: 400 });
    return {
        supplier,
        year: Number(src.year) || new Date().getFullYear(),
        month: String(src.month || data.MONTHS[new Date().getMonth()]),
        frequency: ['Monthly', 'Quarterly', 'YTD'].includes(src.frequency) ? src.frequency : 'Monthly',
    };
}
```

Replace the `GET /` handler body with:

```js
router.get('/', authMiddleware, async (req, res) => {
    try {
        res.json(await buildReport(readParams(req.query)));
    } catch (error) { handle(res, error, 'Failed to build the supplier report'); }
});
```

And add the PDF route, above `GET /`:

```js
// POST rather than GET: comments are free text of unbounded length and have no
// business in a query string.
router.post('/pdf', authMiddleware, async (req, res) => {
    try {
        const params = readParams(req.body || {});
        const report = await buildReport(params);

        let logoBytes = null;
        try {
            logoBytes = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'company-logo.png'));
        } catch { logoBytes = null; } // a report without a logo is still a report

        const bytes = await generateSupplierReportPdf(report, {
            comments: String((req.body && req.body.comments) || ''),
            preparedBy: (req.user && req.user.username) || '',
            logoBytes,
        });

        const safe = params.supplier.replace(/[^A-Za-z0-9._-]+/g, '-');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `attachment; filename="Supplier-Performance-${safe}-${params.month}-${params.year}.pdf"`);
        res.send(Buffer.from(bytes));
    } catch (error) { handle(res, error, 'Failed to generate the report PDF'); }
});
```

- [ ] **Step 2: Add the API method**

In `src/api.js`, inside `supplierPerformanceAPI`. Follow the existing blob-download pattern used around line 653 for the request headers:

```js
    // Returns a Blob. The report is rebuilt server-side, so what downloads is
    // what the database says, not what this page happens to be showing.
    exportPdf: async ({ supplier, year, month, frequency, comments }) => {
        const response = await fetch(`${API_BASE_URL}/supplier-performance/pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getToken()}`,
            },
            body: JSON.stringify({ supplier, year, month, frequency, comments }),
        });
        if (!response.ok) {
            let message = nonApiErrorMessage(response.status);
            try { message = (await response.json()).error || message; } catch { /* not JSON */ }
            throw new Error(message);
        }
        return response.blob();
    },
```

- [ ] **Step 3: Replace the export button and add the comments box**

In `src/pages/analytics/SupplierReportTab.jsx`:

Add state beside the others:

```jsx
  const [comments, setComments] = useState('');
  const [exporting, setExporting] = useState(false);
```

Add the handler after `load`:

```jsx
  // The typed comments stay in component state on failure, so a 500 does not
  // cost somebody their remarks.
  const exportPdf = async () => {
    setExporting(true);
    try {
      const blob = await supplierPerformanceAPI.exportPdf({ supplier, year, month, frequency, comments });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Supplier-Performance-${supplier}-${month}-${year}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'Could not generate the PDF.');
    } finally {
      setExporting(false);
    }
  };
```

Replace the export button's `onClick={() => window.print()}` with `onClick={exportPdf}` and its label with `{exporting ? 'Generating…' : 'Export PDF'}`, adding `disabled={exporting || !report}`.

Add the comments box just above the closing `</div>` of the `#supplier-report` block, after the explanatory paragraph:

```jsx
          <div className="no-print" style={{ marginTop: '1.5rem' }}>
            <label htmlFor="sr-comments" style={{ fontSize: 9.5, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }}>
              Comments &amp; action points
            </label>
            <textarea id="sr-comments" value={comments} onChange={(e) => setComments(e.target.value)} rows={4}
              placeholder="Your remarks and agreed actions. Printed in the exported PDF over your name."
              style={{ width: '100%', maxWidth: 720, padding: '10px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />
            <p style={{ fontSize: 11, color: theme.textDim, marginTop: 5 }}>
              Not saved — retype if you generate the report again.
            </p>
          </div>
```

- [ ] **Step 4: Verify end to end**

Run: `npm run build:check`

Expected: lint clean, build succeeds.

Run: `npm test`

Expected: PASS.

Then in the browser, with the server running: pick a supplier with die life entries, type a comment, click Export PDF. Open the downloaded file and confirm — this is the list of everything wrong with the export under review:

- no application sidebar on any page
- no `localhost`, no browser date stamp, no `1/3` in the margins
- the Gulf Extrusion logo on page 1
- the metric table shows a Target column, including Die Life 77 MT
- the matrix months match what the Die Life Data tab holds
- **no page of "Not enough data" boxes**
- your comment appears over your username
- every page footer reads `Page N of M`

- [ ] **Step 5: Commit**

```bash
git add server/routes/supplier-performance.cjs src/api.js src/pages/analytics/SupplierReportTab.jsx
git commit -m "feat(report-pdf): export a generated document instead of printing the page"
```

---

## Verification checklist

Before calling this done, confirm each with a command or a look — not from memory:

- [ ] `npm test` passes
- [ ] `npm run build:check` passes
- [ ] The old test asserting `METRIC_DEFAULTS omits die life and die failure` is gone, replaced by its inverse (Task 8)
- [ ] The sentence "Die life and die failure are not tracked in this system" appears nowhere in `src/` (Task 10) — `grep -rn "not tracked in this system" src/` returns nothing
- [ ] An empty box on the Die Life Data tab saves as empty and reloads as empty, never as `0`
- [ ] A supplier with no die life data still gets a rating, renormalised, rather than a low one
- [ ] Setting next year's targets in Settings does not change this year's report score
- [ ] The exported PDF's matrix Period row matches the Die Life value on page 1
