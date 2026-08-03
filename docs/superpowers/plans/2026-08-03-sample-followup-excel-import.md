# Sample Followup Excel Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill nine months of hand-tracked sample data from `Sample.xlsx` into `die_orders`, so the Sample Followup page shows ~194 rows instead of 2.

**Architecture:** Pure decision logic lives in a service module with colocated `node:test` tests (the pattern every other `server/services/*.cjs` follows). A thin CLI script does the I/O — read the workbook, read `die_orders`, hand both to the service, print the plan, and apply it in one transaction. The service never touches a database or a file; the script holds no business rules.

**Tech Stack:** Node 20 (CommonJS, `.cjs`), `xlsx@0.18.5`, `pg` via `server/db.cjs`, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md`

## Global Constraints

- This is a **one-time backfill**. No API route, no UI, no schema migration. The only files touched are the three listed below.
- **Never widen the blast radius.** The only writable columns are `die_received_date`, `submission_date`, `sample_approval_date`, `no_of_trial`, `corrector`, `sample_status`. Enforce with a whitelist, not by convention.
- **A blank sheet cell is omitted from the `UPDATE` entirely** — never written as `''` or `NULL`. The live columns are `date` type (despite `init.sql` declaring `TEXT`), and `''` raises `invalid input syntax for type date`.
- **Orders with `status = 'CANCELLED'` are excluded from matching.**
- No `DELETE`, ever. No unscoped `UPDATE` — every statement is keyed to one order id.
- Dates normalize to `YYYY-MM-DD`, matching `sanitizeDate` in `server/routes/orders.cjs`.
- Follow the existing script conventions in `server/scripts/import-qd-sheet.cjs`: `'use strict'`, a usage comment header, `--dry-run`, `await pool.end()` at exit.

## File Structure

| File | Responsibility |
|---|---|
| Create: `server/services/sampleFollowupImport.cjs` | All decision logic as pure functions: parsing sheet values, choosing which order a die belongs to, deciding what to update. No I/O. |
| Create: `server/services/sampleFollowupImport.test.cjs` | `node:test` coverage of every rule above. No database, no fixture files. |
| Create: `server/scripts/import-sample-followup-sheet.cjs` | CLI: read workbook + `die_orders`, call the service, print/write the report, apply inside a transaction. |

---

### Task 1: Sheet value parsers

**Files:**
- Create: `server/services/sampleFollowupImport.cjs`
- Test: `server/services/sampleFollowupImport.test.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `COLUMNS` — object mapping logical names to sheet headers.
  - `readCell(row, headerName) -> any` — header lookup tolerant of stray trailing spaces.
  - `normalizeDieNo(value) -> string` — trimmed, uppercased, all whitespace removed.
  - `cleanText(value) -> string | null` — trimmed, internal whitespace collapsed; `null` when empty.
  - `parseSheetDate(value) -> 'YYYY-MM-DD' | null`
  - `parseTrialCount(value) -> number | null`

- [ ] **Step 1: Write the failing test**

Create `server/services/sampleFollowupImport.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imp = require('./sampleFollowupImport.cjs');

test('normalizeDieNo strips case and every kind of whitespace', () => {
  assert.equal(imp.normalizeDieNo(' 027048-2502 '), '027048-2502');
  assert.equal(imp.normalizeDieNo('gex 1234'), 'GEX1234');
  assert.equal(imp.normalizeDieNo(null), '');
  assert.equal(imp.normalizeDieNo(undefined), '');
});

test('cleanText trims, collapses, and nulls out blanks', () => {
  assert.equal(imp.cleanText('Sujith '), 'Sujith');
  assert.equal(imp.cleanText('Van  der  Berg'), 'Van der Berg');
  assert.equal(imp.cleanText('   '), null);
  assert.equal(imp.cleanText(null), null);
});

test('parseSheetDate reads Excel serials', () => {
  // 45954 and 46085 are real values from the sheet.
  assert.equal(imp.parseSheetDate(45954), '2025-10-24');
  assert.equal(imp.parseSheetDate(46085), '2026-03-04');
  assert.equal(imp.parseSheetDate('45954'), '2025-10-24');
});

test('parseSheetDate reads typed text in both orders', () => {
  assert.equal(imp.parseSheetDate('2026-03-12'), '2026-03-12');
  assert.equal(imp.parseSheetDate('2026-03-12T00:00:00Z'), '2026-03-12');
  assert.equal(imp.parseSheetDate('12/03/2026'), '2026-03-12');
  assert.equal(imp.parseSheetDate('12-03-2026'), '2026-03-12');
  assert.equal(imp.parseSheetDate('5.3.2026'), '2026-03-05');
});

test('parseSheetDate rejects blanks, zero, and garbage', () => {
  // Die 007223-3501 carries a Submission Date of 0 — it must read as blank.
  assert.equal(imp.parseSheetDate(0), null);
  assert.equal(imp.parseSheetDate(''), null);
  assert.equal(imp.parseSheetDate('   '), null);
  assert.equal(imp.parseSheetDate(null), null);
  assert.equal(imp.parseSheetDate(undefined), null);
  assert.equal(imp.parseSheetDate(-5), null);
  assert.equal(imp.parseSheetDate('n/a'), null);
  assert.equal(imp.parseSheetDate('2026-13-45'), null);
  assert.equal(imp.parseSheetDate('32/01/2026'), null);
});

test('parseTrialCount accepts 0..1000 and rejects the rest', () => {
  assert.equal(imp.parseTrialCount(0), 0);
  assert.equal(imp.parseTrialCount(7), 7);
  assert.equal(imp.parseTrialCount('3'), 3);
  assert.equal(imp.parseTrialCount(2.4), 2);
  assert.equal(imp.parseTrialCount(''), null);
  assert.equal(imp.parseTrialCount(null), null);
  assert.equal(imp.parseTrialCount(-1), null);
  assert.equal(imp.parseTrialCount(1001), null);
  assert.equal(imp.parseTrialCount('many'), null);
});

test('readCell tolerates headers with stray trailing spaces', () => {
  assert.equal(imp.readCell({ 'Corrector ': 'Dinesh' }, 'Corrector'), 'Dinesh');
  assert.equal(imp.readCell({ Corrector: 'Dinesh' }, 'Corrector'), 'Dinesh');
  assert.equal(imp.readCell({}, 'Corrector'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/sampleFollowupImport.test.cjs`
Expected: FAIL — `Cannot find module './sampleFollowupImport.cjs'`

- [ ] **Step 3: Write minimal implementation**

Create `server/services/sampleFollowupImport.cjs`:

```javascript
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

// No of Trial ceiling, matching the validator in server/routes/orders.cjs.
const MAX_TRIALS = 1000;

// Sheet headers sometimes carry stray trailing spaces (the QD sheet did).
function readCell(row, name) {
  if (row[name] !== undefined) return row[name];
  const key = Object.keys(row).find((k) => k.trim() === name);
  return key === undefined ? '' : row[key];
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

module.exports = {
  COLUMNS, MAX_TRIALS,
  readCell, normalizeDieNo, cleanText, parseSheetDate, parseTrialCount,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/services/sampleFollowupImport.test.cjs`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/sampleFollowupImport.cjs server/services/sampleFollowupImport.test.cjs
git commit -m "feat(import): sheet value parsers for the sample followup backfill"
```

---

### Task 2: Order selection and status derivation

**Files:**
- Modify: `server/services/sampleFollowupImport.cjs`
- Test: `server/services/sampleFollowupImport.test.cjs`

**Interfaces:**
- Consumes: `normalizeDieNo` from Task 1.
- Produces:
  - `selectOrder(candidates) -> { reason, order, candidates }` where `reason` is one of `'matched' | 'not-found' | 'all-cancelled' | 'ambiguous'`. `order` is non-null only when `reason === 'matched'`.
  - `deriveSampleStatus({ approvalDate, submissionDate, currentStatus }) -> string | null`. `null` means "leave the existing status alone".

An order object is a row from `die_orders`, using snake_case column names: `{ id, die_no, plant, supplier, status, die_received_date, submission_date, sample_approval_date, no_of_trial, corrector, sample_status }`.

- [ ] **Step 1: Write the failing test**

Append to `server/services/sampleFollowupImport.test.cjs`:

```javascript
const order = (over = {}) => ({
  id: 1, die_no: '027048-2502', plant: 'GEX 2', supplier: 'PHME', status: 'DONE',
  die_received_date: null, submission_date: null, sample_approval_date: null,
  no_of_trial: 0, corrector: null, sample_status: '', ...over,
});

test('selectOrder reports a die the app has never seen', () => {
  assert.equal(imp.selectOrder([]).reason, 'not-found');
  assert.equal(imp.selectOrder(undefined).reason, 'not-found');
});

test('selectOrder picks the only live order', () => {
  const o = order();
  const got = imp.selectOrder([o]);
  assert.equal(got.reason, 'matched');
  assert.equal(got.order, o);
});

test('selectOrder ignores cancelled re-orders', () => {
  // Every duplicate in the real sheet looks like this: a live DONE order and a
  // newer CANCELLED one. The sample data belongs to the DONE order.
  const done = order({ id: 326, status: 'DONE', supplier: 'PDTMC' });
  const cancelled = order({ id: 383, status: 'CANCELLED', supplier: 'JIANGSU' });
  const got = imp.selectOrder([done, cancelled]);
  assert.equal(got.reason, 'matched');
  assert.equal(got.order.id, 326);
});

test('selectOrder treats cancelled status case-insensitively', () => {
  const got = imp.selectOrder([order({ id: 9, status: ' cancelled ' })]);
  assert.equal(got.reason, 'all-cancelled');
  assert.equal(got.order, null);
});

test('selectOrder refuses to guess between several live orders', () => {
  const got = imp.selectOrder([order({ id: 1 }), order({ id: 2 })]);
  assert.equal(got.reason, 'ambiguous');
  assert.equal(got.order, null);
  assert.deepEqual(got.candidates.map((o) => o.id), [1, 2]);
});

test('deriveSampleStatus prefers approval over submission', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: '2026-03-01', currentStatus: '',
  }), 'Approved');
});

test('deriveSampleStatus falls back to submission', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: '2026-03-01', currentStatus: '',
  }), 'Sample Submitted');
});

test('deriveSampleStatus leaves status alone when there are no dates', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: null, currentStatus: 'Pending',
  }), null);
});

test('deriveSampleStatus never downgrades', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: '2026-03-01', currentStatus: 'Approved',
  }), null);
  assert.equal(imp.deriveSampleStatus({
    approvalDate: null, submissionDate: '2026-03-01', currentStatus: 'Sample Submitted',
  }), null);
});

test('deriveSampleStatus never overrides a hand-set judgement', () => {
  // Rejected and On hold are decisions a person made; no date implies them.
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: 'Rejected',
  }), null);
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: 'On hold',
  }), null);
});

test('deriveSampleStatus upgrades an empty or pending status', () => {
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: '',
  }), 'Approved');
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: 'Pending',
  }), 'Approved');
  assert.equal(imp.deriveSampleStatus({
    approvalDate: '2026-03-04', submissionDate: null, currentStatus: null,
  }), 'Approved');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/sampleFollowupImport.test.cjs`
Expected: FAIL — `imp.selectOrder is not a function`

- [ ] **Step 3: Write minimal implementation**

In `server/services/sampleFollowupImport.cjs`, add above `module.exports`:

```javascript
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
```

Extend the export list to:

```javascript
module.exports = {
  COLUMNS, MAX_TRIALS, STATUS_RANK,
  readCell, normalizeDieNo, cleanText, parseSheetDate, parseTrialCount,
  selectOrder, deriveSampleStatus,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/services/sampleFollowupImport.test.cjs`
Expected: PASS — 18 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/sampleFollowupImport.cjs server/services/sampleFollowupImport.test.cjs
git commit -m "feat(import): order selection excluding cancelled, and status derivation"
```

---

### Task 3: Update planning

**Files:**
- Modify: `server/services/sampleFollowupImport.cjs`
- Test: `server/services/sampleFollowupImport.test.cjs`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces:
  - `WRITABLE_COLUMNS` — `Set` of the six columns this import may write.
  - `planRowUpdate({ row, order }) -> { updates, warnings }`. `updates` maps column name → new value, containing **only** columns that must change. `warnings` is an array of strings.
  - `buildImportPlan({ rows, orders }) -> { updates, noop, notFound, ambiguous, warnings }`. Each entry in `updates`/`noop` is `{ sheetRow, die, orderId, before, updates }`; `notFound` entries are `{ sheetRow, die }`; `ambiguous` entries are `{ sheetRow, die, reason, orderIds }`.

- [ ] **Step 1: Write the failing test**

Append to `server/services/sampleFollowupImport.test.cjs`:

```javascript
const sheetRow = (over = {}) => ({
  'Die': '027048-2502', 'Plant': 'GEX 2', 'Supplier': 'PHME',
  'Die Received Date': 45954, 'Ascona Ref': 'Yes',
  'Submission Date': 45954, 'Sample Approval Date': 45954,
  'No. of Trial': 0, 'Corrector': 'Dinesh', ...over,
});

test('planRowUpdate fills an empty order from the sheet', () => {
  const { updates } = imp.planRowUpdate({ row: sheetRow(), order: order() });
  assert.deepEqual(updates, {
    die_received_date: '2025-10-24',
    submission_date: '2025-10-24',
    sample_approval_date: '2025-10-24',
    corrector: 'Dinesh',
    sample_status: 'Approved',
  });
  // no_of_trial is absent: the sheet says 0 and the order already holds 0.
  assert.equal('no_of_trial' in updates, false);
});

test('planRowUpdate omits blank cells entirely rather than clearing', () => {
  const { updates } = imp.planRowUpdate({
    row: sheetRow({ 'Sample Approval Date': '', 'Corrector': '   ' }),
    order: order({ sample_approval_date: '2026-01-01', corrector: 'Kailash' }),
  });
  assert.equal('sample_approval_date' in updates, false);
  assert.equal('corrector' in updates, false);
  // The surviving approval date still drives the status.
  assert.equal(updates.sample_status, 'Approved');
});

test('planRowUpdate skips fields the order already agrees with', () => {
  const { updates } = imp.planRowUpdate({
    row: sheetRow(),
    order: order({
      die_received_date: '2025-10-24', submission_date: '2025-10-24',
      sample_approval_date: '2025-10-24', corrector: 'Dinesh',
      sample_status: 'Approved',
    }),
  });
  assert.deepEqual(updates, {});
});

test('planRowUpdate compares trial counts numerically', () => {
  const { updates } = imp.planRowUpdate({
    row: sheetRow({ 'No. of Trial': 2 }),
    order: order({ no_of_trial: '2' }),
  });
  assert.equal('no_of_trial' in updates, false);
});

test('planRowUpdate warns about an unreadable date without changing it', () => {
  const { updates, warnings } = imp.planRowUpdate({
    row: sheetRow({ 'Die Received Date': 'sometime' }),
    order: order(),
  });
  assert.equal('die_received_date' in updates, false);
  assert.equal(warnings.some((w) => w.includes('Die Received Date')), true);
});

test('planRowUpdate reports a supplier disagreement but never writes it', () => {
  const { updates, warnings } = imp.planRowUpdate({
    row: sheetRow({ 'Supplier': 'COMPES' }),
    order: order({ supplier: 'PDTMC' }),
  });
  assert.equal('supplier' in updates, false);
  assert.equal(warnings.some((w) => w.includes('COMPES') && w.includes('PDTMC')), true);
});

test('planRowUpdate only ever emits writable columns', () => {
  const { updates } = imp.planRowUpdate({ row: sheetRow(), order: order() });
  for (const col of Object.keys(updates)) {
    assert.equal(imp.WRITABLE_COLUMNS.has(col), true, `${col} is not writable`);
  }
});

test('buildImportPlan sorts rows into matched, not-found and ambiguous', () => {
  const plan = imp.buildImportPlan({
    rows: [
      sheetRow({ 'Die': '027048-2502' }),
      sheetRow({ 'Die': '007122-703' }),
      sheetRow({ 'Die': '030552-3501' }),
    ],
    orders: [
      order({ id: 10, die_no: '027048-2502' }),
      order({ id: 20, die_no: '030552-3501' }),
      order({ id: 21, die_no: '030552-3501' }),
    ],
  });
  assert.deepEqual(plan.updates.map((u) => u.orderId), [10]);
  assert.deepEqual(plan.notFound.map((n) => n.die), ['007122-703']);
  assert.deepEqual(plan.ambiguous.map((a) => a.die), ['030552-3501']);
  assert.equal(plan.updates[0].sheetRow, 2);   // row 1 is the header
});

test('buildImportPlan matches regardless of spacing and case', () => {
  const plan = imp.buildImportPlan({
    rows: [sheetRow({ 'Die': ' 27048-2502 ' })],
    orders: [order({ id: 10, die_no: '27048-2502' })],
  });
  assert.equal(plan.updates.length, 1);
});

test('buildImportPlan separates rows that need no change', () => {
  const plan = imp.buildImportPlan({
    rows: [sheetRow()],
    orders: [order({
      id: 10, die_received_date: '2025-10-24', submission_date: '2025-10-24',
      sample_approval_date: '2025-10-24', corrector: 'Dinesh', sample_status: 'Approved',
    })],
  });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.noop.length, 1);
});

test('buildImportPlan flags a blank die number and a repeated one', () => {
  const plan = imp.buildImportPlan({
    rows: [sheetRow({ 'Die': '  ' }), sheetRow(), sheetRow()],
    orders: [order({ id: 10 })],
  });
  assert.equal(plan.warnings.some((w) => w.includes('blank die number')), true);
  assert.equal(plan.warnings.some((w) => w.includes('later row wins')), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/sampleFollowupImport.test.cjs`
Expected: FAIL — `imp.planRowUpdate is not a function`

- [ ] **Step 3: Write minimal implementation**

In `server/services/sampleFollowupImport.cjs`, add above `module.exports`:

```javascript
// The only columns this import may ever write.
const WRITABLE_COLUMNS = new Set([
  'die_received_date', 'submission_date', 'sample_approval_date',
  'no_of_trial', 'corrector', 'sample_status',
]);

// Sheet column → order column, with the parser that reads it.
const FIELDS = [
  { col: 'die_received_date',    key: 'received',   parse: parseSheetDate },
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
  if (current == null || String(current).trim() === '') return false;
  if (typeof next === 'number') return Number(current) === next;
  return String(current).trim() === String(next);
}

function planRowUpdate({ row, order }) {
  const updates = {};
  const warnings = [];
  const parsed = {};

  for (const f of FIELDS) {
    const raw = readCell(row, COLUMNS[f.key]);
    const value = f.parse(raw);
    parsed[f.col] = value;

    if (value === null) {
      // A blank cell means "not recorded", not "clear it" — omit the column.
      if (String(raw == null ? '' : raw).trim() !== '') {
        warnings.push(`${COLUMNS[f.key]}: could not read ${JSON.stringify(raw)} — left unchanged`);
      }
      continue;
    }
    if (!alreadyEqual(order[f.col], value)) updates[f.col] = value;
  }

  const status = deriveSampleStatus({
    approvalDate: parsed.sample_approval_date || order.sample_approval_date || null,
    submissionDate: parsed.submission_date || order.submission_date || null,
    currentStatus: order.sample_status,
  });
  if (status) updates.sample_status = status;

  // Plant and supplier are cross-checks only — reported, never written.
  for (const key of ['plant', 'supplier']) {
    const sheetValue = cleanText(readCell(row, COLUMNS[key]));
    const appValue = cleanText(order[key]);
    if (sheetValue && appValue && !sameText(sheetValue, appValue)) {
      warnings.push(`${key}: sheet says ${sheetValue}, app says ${appValue} — not changed`);
    }
  }

  return { updates, warnings };
}

function buildImportPlan({ rows, orders }) {
  const byDie = new Map();
  for (const o of orders || []) {
    const key = normalizeDieNo(o.die_no);
    if (!key) continue;
    if (!byDie.has(key)) byDie.set(key, []);
    byDie.get(key).push(o);
  }

  const plan = { updates: [], noop: [], notFound: [], ambiguous: [], warnings: [] };
  const seen = new Map();

  (rows || []).forEach((row, i) => {
    const sheetRow = i + 2;                       // +1 for the header, +1 for 1-based
    const dieRaw = cleanText(readCell(row, COLUMNS.die));
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
      plan.notFound.push({ sheetRow, die: dieRaw });
      return;
    }
    if (selection.reason !== 'matched') {
      plan.ambiguous.push({
        sheetRow, die: dieRaw, reason: selection.reason,
        orderIds: selection.candidates.map((o) => o.id),
      });
      return;
    }

    const { updates, warnings } = planRowUpdate({ row, order: selection.order });
    warnings.forEach((w) => plan.warnings.push(`row ${sheetRow} (${dieRaw}): ${w}`));

    const entry = { sheetRow, die: dieRaw, orderId: selection.order.id, before: selection.order, updates };
    if (Object.keys(updates).length === 0) plan.noop.push(entry);
    else plan.updates.push(entry);
  });

  return plan;
}
```

Extend the export list to:

```javascript
module.exports = {
  COLUMNS, MAX_TRIALS, STATUS_RANK, WRITABLE_COLUMNS, FIELDS,
  readCell, normalizeDieNo, cleanText, parseSheetDate, parseTrialCount,
  selectOrder, deriveSampleStatus, planRowUpdate, buildImportPlan,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/services/sampleFollowupImport.test.cjs`
Expected: PASS — 29 tests.

- [ ] **Step 5: Run the whole backend suite to prove nothing else broke**

Run: `npm test`
Expected: PASS, with the pre-existing suites unchanged.

- [ ] **Step 6: Commit**

```bash
git add server/services/sampleFollowupImport.cjs server/services/sampleFollowupImport.test.cjs
git commit -m "feat(import): build the sample followup update plan from sheet rows"
```

---

### Task 4: The CLI script

**Files:**
- Create: `server/scripts/import-sample-followup-sheet.cjs`

**Interfaces:**
- Consumes: `buildImportPlan` and `WRITABLE_COLUMNS` from Task 3; `pool` from `server/db.cjs`.
- Produces: a CLI. No exports.

There are no unit tests for this file — it is I/O wiring, and Task 5 exercises it end-to-end against the real sheet. Keep every decision in the service so this stays true.

- [ ] **Step 1: Write the script**

Create `server/scripts/import-sample-followup-sheet.cjs`:

```javascript
'use strict';
// One-off importer for the historical Sample Followup Excel sheet.
//   node server/scripts/import-sample-followup-sheet.cjs <sheet.xlsx> [--dry-run] [--report <path>]
// The sheet path must come first. Updates only the five sample fields on
// matching die_orders; never creates
// orders, never deletes, never clears a value the sheet leaves blank.
// Design: docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../db.cjs');
const imp = require('../services/sampleFollowupImport.cjs');

const ORDER_QUERY = `
  SELECT id, die_no, plant, supplier, status,
         die_received_date::text    AS die_received_date,
         submission_date::text      AS submission_date,
         sample_approval_date::text AS sample_approval_date,
         no_of_trial, corrector, sample_status
    FROM die_orders
`;

function describe(entry) {
  const before = entry.before;
  return Object.entries(entry.updates)
    .map(([col, next]) => {
      const current = before[col];
      const shown = current == null || String(current).trim() === '' ? '(empty)' : current;
      return `      ${col}: ${shown} → ${next}`;
    })
    .join('\n');
}

function renderReport(plan, { file, dryRun }) {
  const out = [];
  out.push(`Sample Followup import ${dryRun ? '(DRY RUN — nothing written)' : '(LIVE)'}`);
  out.push(`Sheet: ${file}`);
  out.push(`Run:   ${new Date().toISOString()}`);
  out.push('');

  out.push(`== 1. Matched and changing (${plan.updates.length}) ==`);
  for (const e of plan.updates) {
    out.push(`  row ${e.sheetRow}  ${e.die}  (order ${e.orderId})`);
    out.push(describe(e));
  }

  const fieldCounts = {};
  for (const e of plan.updates) {
    for (const col of Object.keys(e.updates)) fieldCounts[col] = (fieldCounts[col] || 0) + 1;
  }
  out.push('');
  out.push('  changes per field:');
  for (const [col, n] of Object.entries(fieldCounts).sort()) out.push(`    ${col}: ${n}`);

  out.push('');
  out.push(`== 2. Matched, already correct (${plan.noop.length}) ==`);
  for (const e of plan.noop) out.push(`  row ${e.sheetRow}  ${e.die}  (order ${e.orderId})`);

  out.push('');
  out.push(`== 3. Not found in the app — SKIPPED (${plan.notFound.length}) ==`);
  for (const e of plan.notFound) out.push(`  row ${e.sheetRow}  ${e.die}`);

  out.push('');
  out.push(`== 4. Ambiguous — SKIPPED (${plan.ambiguous.length}) ==`);
  for (const e of plan.ambiguous) out.push(`  row ${e.sheetRow}  ${e.die}  ${e.reason}  orders: ${e.orderIds.join(', ')}`);

  out.push('');
  out.push(`== 5. Data warnings (${plan.warnings.length}) ==`);
  for (const w of plan.warnings) out.push(`  ${w}`);

  out.push('');
  out.push(`Totals: ${plan.updates.length} to update, ${plan.noop.length} unchanged, `
         + `${plan.notFound.length} not found, ${plan.ambiguous.length} ambiguous, `
         + `${plan.warnings.length} warnings.`);
  return out.join('\n');
}

async function apply(plan) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const entry of plan.updates) {
      const cols = Object.keys(entry.updates).filter((c) => imp.WRITABLE_COLUMNS.has(c));
      if (cols.length === 0) continue;
      const sets = cols.map((c, i) => `${c} = $${i + 1}`);
      const params = cols.map((c) => entry.updates[c]);
      params.push(entry.orderId);
      await client.query(
        `UPDATE die_orders SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length}`,
        params,
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const reportFlag = process.argv.indexOf('--report');
  const explicitReport = reportFlag > -1 ? process.argv[reportFlag + 1] : null;
  if (!file || file.startsWith('--')) {
    console.error('Usage: node server/scripts/import-sample-followup-sheet.cjs <sheet.xlsx> [--dry-run] [--report <path>]');
    console.error('The sheet path must be the first argument.');
    process.exit(1);
  }

  const wb = XLSX.readFile(path.resolve(file));
  const sheetName = wb.SheetNames.includes('Sample Followup') ? 'Sample Followup' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

  const orders = (await pool.query(ORDER_QUERY)).rows;
  const plan = imp.buildImportPlan({ rows, orders });

  const report = renderReport(plan, { file, dryRun });
  console.log(report);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.resolve(
    explicitReport || `sample-followup-import-${dryRun ? 'dryrun-' : ''}${stamp}.txt`,
  );
  fs.writeFileSync(reportPath, report + '\n', 'utf8');
  console.log(`\nReport written to ${reportPath}`);

  if (dryRun) {
    console.log('Dry run — no changes were written.');
  } else {
    await apply(plan);
    console.log(`Applied ${plan.updates.length} updates.`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify it refuses to run without a file**

Run: `node server/scripts/import-sample-followup-sheet.cjs`
Expected: prints the usage line, exits 1, no database connection attempted.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS with no new warnings.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/import-sample-followup-sheet.cjs
git commit -m "feat(import): CLI for the one-time sample followup backfill"
```

---

### Task 5: Dry run, then the live import

**Files:** none — this task runs the script and verifies the outcome.

**Interfaces:**
- Consumes: the script from Task 4.
- Produces: the backfilled database and two report files.

The script runs **inside the backend container**, which already holds `xlsx` and the Postgres credentials (`PGHOST=supabase-db`). The running image predates these files, so copy them in — no rebuild needed for a one-off.

- [ ] **Step 1: Copy the script and the sheet into the container**

```bash
docker cp server/services/sampleFollowupImport.cjs die-ordering-backend:/app/server/services/sampleFollowupImport.cjs
```

```bash
docker cp server/scripts/import-sample-followup-sheet.cjs die-ordering-backend:/app/server/scripts/import-sample-followup-sheet.cjs
```

```bash
docker cp "C:/Users/vijee/Desktop/18.06.2026/Sample.xlsx" die-ordering-backend:/app/Sample.xlsx
```

- [ ] **Step 2: Dry run**

```bash
docker exec die-ordering-backend node server/scripts/import-sample-followup-sheet.cjs /app/Sample.xlsx --dry-run --report /app/sf-import-dryrun.txt
```

Expected totals, from the analysis done against this database on 2026-08-03:

- **192** to update
- **0** unchanged
- **32** not found
- **0** ambiguous
- **1** supplier warning — `018114-802`, sheet `COMPES` vs app `PDTMC`
- Per-field counts: `die_received_date` 192, `corrector` 192, `sample_status` 192, `submission_date` 191, `sample_approval_date` 186, `no_of_trial` 93

**If the totals differ, stop and investigate before going further.** The two most likely explanations are that the sheet changed since it was profiled, or that someone entered sample data in the app in the meantime — the second is fine and shows up as rows moving from "changing" into "already correct", but it should be understood rather than assumed.

- [ ] **Step 3: Read the dry-run report**

Pull the report out and read it, in particular section 3 (the 32 skipped dies) and section 5:

```bash
mkdir -p import-reports && docker cp die-ordering-backend:/app/sf-import-dryrun.txt ./import-reports/
```

Confirm the spot-check row `027048-2502` shows all five fields moving from `(empty)` and a status of `Approved`.

- [ ] **Step 4: Back up the database**

```bash
npm run db:backup
```

Expected: a `backup-YYYYMMDD-HHMMSS.sql.gz` in the project root. Confirm it is non-empty before continuing.

- [ ] **Step 5: Run the import for real**

```bash
docker exec die-ordering-backend node server/scripts/import-sample-followup-sheet.cjs /app/Sample.xlsx --report /app/sf-import-live.txt
```

Expected: the same report, then `Applied 192 updates.`

- [ ] **Step 6: Verify against the database**

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) FILTER (WHERE die_received_date IS NOT NULL) AS with_received, count(*) FILTER (WHERE sample_status = 'Approved') AS approved, count(*) FILTER (WHERE sample_status = 'Sample Submitted') AS submitted FROM die_orders"
```

Expected: `with_received` ≈ 192, and `approved` + `submitted` ≈ 192 with roughly 9 of them `Sample Submitted` (the rows whose approval date is blank, minus any that did not match).

- [ ] **Step 7: Confirm idempotency**

```bash
docker exec die-ordering-backend node server/scripts/import-sample-followup-sheet.cjs /app/Sample.xlsx --dry-run --report /app/sf-import-verify.txt
```

Expected: **0** to update, **192** unchanged. This proves a re-run is harmless.

- [ ] **Step 8: Verify the page in the browser**

Open the app, go to Sample Followup, and confirm it now lists ~194 rows instead of 2, with populated dates, correctors, statuses, and computed Delay Days.

- [ ] **Step 9: Commit the reports**

```bash
docker cp die-ordering-backend:/app/sf-import-live.txt ./import-reports/ && docker cp die-ordering-backend:/app/sf-import-verify.txt ./import-reports/
```

```bash
git add import-reports/ && git commit -m "chore(import): sample followup backfill run reports"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: mechanism → Task 4; matching including the cancelled-order rule → Task 2; write rules and the blank-cell rule → Tasks 1 and 3; status derivation → Task 2; report (all five lists) → Task 4; safety (transaction, `pg_dump`, no deletes) → Tasks 4 and 5; expected outcome → Task 5 steps 6–8; testing → the test steps in Tasks 1–3 and the dry run in Task 5. Decisions 1–5 are all enforced in code: no order is created (Task 4 issues only `UPDATE`), unmatched dies land in `notFound` and are never written, blanks are omitted, status is upgrade-only, and cancelled orders are filtered in `selectOrder`.

**Placeholder scan.** No TBD/TODO. Every code step carries complete code; every test step carries real assertions; every run step carries the exact command and the expected output.

**Type consistency.** `selectOrder` returns `{ reason, order, candidates }` in Task 2 and is destructured as such in Task 3. `buildImportPlan` returns `{ updates, noop, notFound, ambiguous, warnings }` in Task 3, and Task 4's `renderReport` and `apply` read exactly those five keys plus the `{ sheetRow, die, orderId, before, updates }` entry shape. `WRITABLE_COLUMNS` is a `Set` in Task 3 and used with `.has()` in Tasks 3 and 4. Order objects use snake_case column names throughout, matching `ORDER_QUERY`'s aliases.
