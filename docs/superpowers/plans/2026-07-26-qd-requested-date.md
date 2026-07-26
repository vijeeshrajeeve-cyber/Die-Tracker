# QD Requested Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a mandatory **QD Requested Date** when a QD is created, and show it on the QD Tracker page.

**Architecture:** A new nullable `qd_requested_date DATE` column on `quality_discrepancies`, required at the API and form layers rather than by a `NOT NULL` constraint (existing rows are not backfilled). The existing `raised_date` keeps its meaning as the system's own "record created" stamp, so no KPI, age, resolution, hand-off, year-filter or QD-numbering arithmetic changes. The field rides the codebase's existing machinery: `EDITABLE_FIELDS` for drawer editing and audit logging, `EDIT_BODY_MAP` for the full Edit form, `Handoff` for the tracker cell.

**Tech Stack:** Node 20 + Express 5 (CommonJS `.cjs` under `server/`), PostgreSQL, React 18 + Vite (ESM `.jsx` under `src/`), `node:test` for backend tests.

**Spec:** [docs/superpowers/specs/2026-07-26-qd-requested-date-design.md](../specs/2026-07-26-qd-requested-date-design.md)

## Global Constraints

- **Column name:** `qd_requested_date`. **Camel-case API key:** `qdRequestedDate`. **UI label:** `QD Requested Date` (form) / `QD requested` (table column, fact card). **`EDITABLE_FIELDS` label:** `QD requested date` — error messages are built from this exact string.
- **Date format is `YYYY-MM-DD`** everywhere. The existing `ISO_DATE = /^\d{4}-\d{2}-\d{2}$/` in `qualityDiscrepancies.cjs` is the single source of truth server-side.
- **Never change `raised_date`,** nor any function that reads it (`ageDays`, `resolutionDays`, `handoffDelays`, `computeKpis`, `availableYears`, `filterByYear`, `yearOf`, `summarizeSuppliers`).
- **No backfill.** Existing rows keep `qd_requested_date IS NULL` and render `—`.
- **Do not touch `server/services/qdPdf.cjs`.** The Part-A `DATE` box stays bound to `raised_date`.
- **Schema changes go in two places:** an idempotent `DO $$ ... IF NOT EXISTS ... ALTER TABLE` block in `server/db.cjs`, mirrored into `init.sql` for fresh installs.
- **Backend tests only.** `node:test` via `npm test`; there is no frontend component test framework — frontend tasks verify with `npm run lint` and `npm run build`.
- **Never run an unscoped `DELETE FROM`** against the dev database; the user works in the same live database.

---

### Task 1: The field in the data layer

Adds the column, declares it as an editable+required field, teaches `normalizeField` to refuse clearing a required field, and writes it on insert.

**Files:**
- Modify: `server/db.cjs` (after the hand-off dates `DO $$` block, currently lines 425–434)
- Modify: `init.sql:341` (inside `CREATE TABLE quality_discrepancies`)
- Modify: `server/services/qualityDiscrepancies.cjs` — `createQD` (lines 288–317), `EDITABLE_FIELDS` (lines 324–347), `normalizeField` (lines 351–366)
- Test: `server/services/qualityDiscrepancies.test.cjs` (append at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `EDITABLE_FIELDS.qd_requested_date === { label: 'QD requested date', isDate: true, required: true }`
  - `normalizeField(column, raw)` throws `Invalid QD requested date: a value is required` when a `required` field is given an empty value; behaviour for every other column is unchanged.
  - `createQD(client, input)` accepts `input.qdRequestedDate` (string `YYYY-MM-DD` or omitted → `null`) and writes it as the **last** column/parameter of its INSERT, so `params.at(-1)` is that value.
  - `ISO_DATE` is exported from the module, so the route layer validates dates against the same regex instead of inlining its own.

- [ ] **Step 1: Write the failing tests**

Append to `server/services/qualityDiscrepancies.test.cjs`:

```js
test('the QD requested date is an editable, validated date field', async () => {
  assert.equal(q.EDITABLE_FIELDS.qd_requested_date.label, 'QD requested date');
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateFields(client, { id: 1, fields: { qd_requested_date: '2026-07-20' }, actor: 'x' });
  assert.match(calls[0].sql, /qd_requested_date = /);
  assert.equal(calls[0].params[0], '2026-07-20');
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { qd_requested_date: '20-07-2026' }, actor: 'x' }),
    /Invalid QD requested date/
  );
});

test('a required field cannot be cleared, while other fields still clear', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { qd_requested_date: '' }, actor: 'x' }),
    /Invalid QD requested date: a value is required/
  );
  // the `required` flag must not leak into the other editable fields
  const calls = [];
  const ok = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateFields(ok, { id: 4, fields: { eta_date: '' }, actor: 'x' });
  assert.equal(calls[0].params[0], null);
});

test('createQD writes the QD requested date, and tolerates its absence', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 7 }] }; } };
  const base = {
    dieNo: '029780-2502', raisedDate: '2026-07-26', plant: 'GEX 2',
    supplier: 'PDTMC', issueSummary: 'Profile out of tolerance',
  };
  const id = await q.createQD(client, { ...base, qdRequestedDate: '2026-07-20' });
  assert.equal(id, 7);
  assert.match(calls[0].sql, /qd_requested_date/);
  assert.equal(calls[0].params.at(-1), '2026-07-20');
  // the sheet importer calls createQD without one — that must not throw
  calls.length = 0;
  await q.createQD(client, base);
  assert.equal(calls[0].params.at(-1), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL — three failures. The first two report `Cannot read properties of undefined (reading 'label')` / no rejection thrown; the third reports `params.at(-1)` is the `recommended_action` value (`undefined`), not `'2026-07-20'`.

- [ ] **Step 3: Add the column in `server/db.cjs`**

Insert this immediately **after** the hand-off dates `DO $$ ... END $$;` block (the one adding `sent_to_purchase_date` / `sent_to_supplier_date`, currently ending at line 434) and **before** the `-- ── QD approval workflow ──` comment:

```sql
      -- When the plant actually requested the QD, as entered by the person
      -- raising it — distinct from raised_date, which is the system's own
      -- "record created" stamp. Rows predating this column stay NULL rather
      -- than being backfilled from raised_date, which would assert a date the
      -- legacy sheet never recorded. Required by the API for new QDs, so the
      -- column itself stays nullable.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='qd_requested_date') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN qd_requested_date DATE;
        END IF;
      END $$;
```

- [ ] **Step 4: Mirror the column in `init.sql`**

In the `CREATE TABLE IF NOT EXISTS quality_discrepancies` block, add the column directly after `raised_date`:

```sql
    raised_date      DATE NOT NULL,
    qd_requested_date DATE,
```

- [ ] **Step 5: Declare the field in `EDITABLE_FIELDS`**

In `server/services/qualityDiscrepancies.cjs`, add this line to the `EDITABLE_FIELDS` object, directly above the existing `die_received_date` entry:

```js
  qd_requested_date:    { label: 'QD requested date', isDate: true, required: true },
```

- [ ] **Step 6: Teach `normalizeField` about `required`**

Replace the opening of `normalizeField` — the `spec` lookup moves above the empty check, because the empty branch now needs it:

```js
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
```

The rest of the function is unchanged. **Delete the now-duplicated `const spec = EDITABLE_FIELDS[column];` line** that sat between the `outcome` check and the `oneOf` check.

Also export `ISO_DATE` so the route layer can validate against the same regex — add it to the first line of the `module.exports` object at the bottom of the file:

```js
module.exports = {
  STATUSES, OPEN_STATUSES, NOT_OPEN_STATUSES, SETTLED_STATUSES, OUTCOMES, ACTIVITY_KINDS, EDITABLE_FIELDS, ISO_DATE,
```

- [ ] **Step 7: Write the column in `createQD`**

Three edits inside `createQD`. Add to the destructure — append to the last line of it:

```js
    productionDate, manufacturingDefect, diePerformance, recommendedAction, qdRequestedDate,
```

Append the column to the INSERT's column list and `$31` to its VALUES (the column list currently ends `..., die_performance, recommended_action)`):

```js
        no_of_corrections, production_date, manufacturing_defect, die_performance, recommended_action,
        qd_requested_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
```

Append the value as the **last** parameter (the array currently ends `..., recommendedAction || null,`):

```js
      manufacturingDefect || null, diePerformance || null, recommendedAction || null,
      qdRequestedDate || null,
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS — all tests, including the three new ones. No previously passing test may fail; `updateFields clears a field when given an empty value` in particular proves the `required` flag did not leak.

- [ ] **Step 9: Commit**

```bash
git add server/db.cjs init.sql server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): qd_requested_date column, editable and required in the service layer"
```

---

### Task 2: API — required on create, saved by the Edit form

**Files:**
- Modify: `server/routes/quality-discrepancies.cjs` — POST `/` (lines 115–178) and `EDIT_BODY_MAP` (lines 386–392)
- Modify: `src/api.js:620` (comment only, documenting the new required key)

**Interfaces:**
- Consumes: `createQD(client, { …, qdRequestedDate })`, `EDITABLE_FIELDS.qd_requested_date` and the exported `ISO_DATE` from Task 1 (the route already imports the module as `qd`).
- Produces:
  - `POST /api/quality-discrepancies` requires `qdRequestedDate` (`YYYY-MM-DD`); answers `400 { error: 'QD requested date is required' }` when absent and `400 { error: 'Invalid QD requested date (expected YYYY-MM-DD)' }` when malformed.
  - `PUT /api/quality-discrepancies/:id` accepts `qdRequestedDate` and maps it to `qd_requested_date`.

There are no route-level tests in this repo (`npm test` only covers `server/services/*.test.cjs`), so this task is verified by a syntax check, the unchanged service suite, and an optional live smoke test.

- [ ] **Step 1: Accept and validate `qdRequestedDate` on create**

In the POST `/` handler, append the key to the `req.body` destructure's last line:

```js
      productionDate, manufacturingDefect, diePerformance, recommendedAction, dieOrderId,
      qdRequestedDate,
    } = req.body;
```

Then add the validation immediately after the existing `supplier` check and before the `outcome` check:

```js
    // Required on every new QD: the plant's own request date, which the system
    // cannot infer. Nullable in the DB only because pre-existing rows have none.
    const requestedDate = String(qdRequestedDate || '').trim();
    if (!requestedDate) { client.release(); return res.status(400).json({ error: 'QD requested date is required' }); }
    if (!qd.ISO_DATE.test(requestedDate)) { client.release(); return res.status(400).json({ error: 'Invalid QD requested date (expected YYYY-MM-DD)' }); }
```

- [ ] **Step 2: Pass it to `createQD`**

In the same handler's `qd.createQD(client, { … })` call, add the field directly below the existing `raisedDate:` line:

```js
      raisedDate: new Date().toISOString().slice(0, 10),
      qdRequestedDate: requestedDate,
```

- [ ] **Step 3: Let the Edit form save it**

Add to `EDIT_BODY_MAP`, on the line that already carries the other dates:

```js
  dieReceivedDate: 'die_received_date', press: 'press', dieType: 'die_type', dieSize: 'die_size',
  qdRequestedDate: 'qd_requested_date',
```

- [ ] **Step 4: Document the required key on the API client**

In `src/api.js`, add a comment directly above `create:` in `qualityDiscrepanciesAPI`:

```js
    // payload.qdRequestedDate (YYYY-MM-DD) is required — the server answers 400 without it.
    create: async (payload) =>
```

- [ ] **Step 5: Verify the server still parses and the suite still passes**

```bash
node --check server/routes/quality-discrepancies.cjs && npm test
```

Expected: no output from `node --check`, then PASS for the whole test suite.

- [ ] **Step 6: Commit**

```bash
git add server/routes/quality-discrepancies.cjs src/api.js
git commit -m "feat(qd): require qdRequestedDate on create, accept it on the Edit PUT"
```

---

### Task 3: Raise / Edit form field

**Files:**
- Modify: `src/components/qd/RaiseQDModal.jsx` — state (near line 57), `canSubmit` (line 116), `buildEditPayload` (lines 160–167), create payload (lines 191–201), header hint (lines 278–282), Die selection grid (lines 294–322)

**Interfaces:**
- Consumes: the `qdRequestedDate` key on `POST /` and `PUT /:id` from Task 2; `DatePickerField` (already imported at line 5), whose `onChange` receives the ISO string directly.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the state**

Directly below the `const [dieNo, setDieNo] = useState(...)` line, add:

```jsx
  // Required on every QD. A new QD defaults to today; editing an older QD that
  // predates the field starts empty, so the editor picks a real date rather
  // than having today's silently stamped on it.
  const [qdRequestedDate, setQdRequestedDate] = useState(
    isEdit
      ? (editQd.qd_requested_date ? String(editQd.qd_requested_date).slice(0, 10) : '')
      : new Date().toISOString().slice(0, 10)
  );
```

- [ ] **Step 2: Gate both save buttons on it**

Replace the `canSubmit` line:

```jsx
  const canSubmit = !!dieNo.trim() && !!supplier.trim() && !!qdRequestedDate && !submitting;
```

- [ ] **Step 3: Render the picker in the Die selection section**

In the Die selection grid, insert this block directly after the `Die No` group's closing `</div>` and before the `Plant` group:

```jsx
              <div style={group}>
                <label style={label}>QD Requested Date</label>
                <DatePickerField value={qdRequestedDate} onChange={setQdRequestedDate} theme={theme} />
                {!qdRequestedDate && <span style={{ fontSize: 11.5, color: dim }}>Required</span>}
              </div>
```

- [ ] **Step 4: Update the header hint**

In the modal header, replace the non-edit branch string so the third mandatory field is stated:

```jsx
                : 'Against a received die · QD no assigned on submit · Save Draft needs Die No + Supplier + Requested date'}
```

- [ ] **Step 5: Send it in both payloads**

In `buildEditPayload`, append to the first line's object:

```jsx
    profileNumber: partA.profileNumber, supplier: supplier.trim(), plant, corrector: corrector.trim(),
    qdRequestedDate,
```

In the `qualityDiscrepanciesAPI.create({ … })` call, add it beside the other top-level fields:

```jsx
            dieNo: dieNo.trim(), plant, supplier: supplier.trim(), qdRequestedDate,
```

- [ ] **Step 6: Verify**

```bash
npm run lint && npm run build
```

Expected: lint reports no new errors for `RaiseQDModal.jsx`; the Vite build completes with `built in …`.

- [ ] **Step 7: Commit**

```bash
git add src/components/qd/RaiseQDModal.jsx
git commit -m "feat(qd): required QD Requested Date picker on the raise/edit form"
```

---

### Task 4: QD Tracker column and CSV export

**Files:**
- Modify: `src/pages/QDTrackerPage.jsx` — `exportCsv` (lines 177–196), table `<thead>` (lines 300–309), row cells (line 337)

**Interfaces:**
- Consumes: `q.qd_requested_date` on each row of the list response (present automatically — `listQDs` does `SELECT *`), and the existing `Handoff` component at line 43.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the CSV column**

In `exportCsv`, add the header between `'Outcome'` and `'QD raised'`:

```jsx
    const header = ['QD No', 'Die No', 'Plant', 'Supplier', 'Corrector', 'Quality issue', 'Status', 'Outcome',
      'QD requested', 'QD raised', 'Sent to purchase', 'Days to purchase', 'Sent to supplier', 'Days purchase→supplier', 'ETA', 'Settled', 'Age (days)'];
```

and the matching value in the same position in the row mapping:

```jsx
      q.status, q.outcome, d(q.qd_requested_date), d(q.raised_date),
```

- [ ] **Step 2: Add the table header**

```jsx
                  {['QD No', 'Die No', 'Plant', 'Supplier', 'Corrector', 'Quality issue', 'Status', 'Outcome',
                    'QD requested', 'QD raised', 'Sent to purchase', 'Sent to supplier', 'Age'].map(h => <th key={h} style={th}>{h}</th>)}
```

- [ ] **Step 3: Add the row cell**

Insert directly above the existing `raised_date` cell. No `days` prop — this is an origin date, not a hand-off, so it carries no delay badge:

```jsx
                      <td style={td}><Handoff date={q.qd_requested_date} mono={mono} muted={muted} dim={dim} /></td>
                      <td style={td}><Handoff date={q.raised_date} mono={mono} muted={muted} dim={dim} /></td>
```

- [ ] **Step 4: Correct the stale column-count comment**

The comment above the table reads `{/* 11 columns. …`. It was already out of date at 12; set it right:

```jsx
            {/* 13 columns. No min-width on the table: the app shell's flex item
```

- [ ] **Step 5: Verify**

```bash
npm run lint && npm run build
```

Expected: lint reports no new errors for `QDTrackerPage.jsx`; the Vite build completes with `built in …`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/QDTrackerPage.jsx
git commit -m "feat(qd): QD requested column on the tracker table and CSV export"
```

---

### Task 5: Detail drawer fact card

**Files:**
- Modify: `src/components/qd/QDDetailPanel.jsx` — the `facts` array (lines 198–226)

**Interfaces:**
- Consumes: `EDITABLE_FIELDS.qd_requested_date` from Task 1 (the drawer's PATCH goes through `updateFields`), plus the file's existing `dateOnly` / `dateVal` helpers.
- Produces: nothing.

- [ ] **Step 1: Add the fact card**

Insert this entry into the `facts` array directly **above** the `label: 'Sent to purchase'` entry, so the drawer's dates read requested → purchase → supplier:

```jsx
    {
      label: 'QD requested',
      value: dateOnly(qd.qd_requested_date),
      field: 'qd_requested_date', type: 'date',
      current: dateVal(qd.qd_requested_date),
    },
```

It picks up in-place editing, the 400-error surface and the timeline entry from the existing fact-card machinery. Attempting to clear it surfaces the server's `Invalid QD requested date: a value is required` in the drawer's error line — that is the intended behaviour, not a bug to work around.

- [ ] **Step 2: Verify**

```bash
npm run lint && npm run build
```

Expected: lint reports no new errors for `QDDetailPanel.jsx`; the Vite build completes with `built in …`.

- [ ] **Step 3: Full gate**

```bash
npm test && npm run lint && npm run build
```

Expected: all three pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/qd/QDDetailPanel.jsx
git commit -m "feat(qd): show and edit the QD requested date in the detail drawer"
```

---

## Manual smoke test (after Task 5)

The backend port is not published to the host; go through the nginx proxy on `:8080`, or exec inside the backend container. Per the project's dev notes, restart the backend so the migration in `server/db.cjs` runs:

```bash
docker compose restart backend && docker compose logs --tail 40 backend
```

Then, in the UI:

1. **Raise QD** → the modal's Die selection section shows **QD Requested Date** pre-filled with today; clearing it disables both *Save Draft* and *Submit for approval*.
2. Save a draft, and confirm the **QD requested** column shows the date in the Drafts view.
3. Open the QD → the drawer's **QD requested** card edits in place and logs the change on the timeline.
4. **Export** → the CSV carries a `QD requested` column between `Outcome` and `QD raised`.
5. An older QD raised before this change shows `—` in the new column, and its PDF's Part-A `DATE` box is unchanged.

Column check (read-only, safe):

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT id, qd_no, qd_requested_date, raised_date FROM quality_discrepancies ORDER BY id DESC LIMIT 5;"
```
