# Die Life by Plant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter die life, failure and trial counts per plant and supplier each month, and calculate die life, failure % and the trial ratios from those counts everywhere they are shown.

**Architecture:** `supplier_die_life` gains a plant and raw-count columns. One pure calculation function (`aggregateDieLife`) is the only place ratios are computed; the tab, the Supplier Report, the trend and the PDF all read its output. The client mirrors it in one util so cells update while typing.

**Tech Stack:** Node/Express (`.cjs`), PostgreSQL, React + Vite, pdf-lib report, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-15-die-life-by-plant-design.md` — read it first; the Rules section and the "Settled after a builder's read" section are binding.

## Global Constraints

- A blank is `null` ("not recorded"); never shown, summed as a recorded value, or scored as 0. A typed 0 is a real zero.
- Period and all-plant figures come from summed counts, never from averaging monthly or per-plant ratios.
- Die life with tonnage recorded and Σ dies scrapped = 0 reads "no dies scrapped" and has no numeric value.
- Labels: "Tonnage (MT)", "Dies scrapped", "Dies run", "Dies unloaded", "New dies received", "New die trials", "Backup dies received", "Backup die trials".
- Column names `dies_in_service` / `dies_failed` and API fields `diesInService` / `diesFailed` keep their names; only labels change.
- Legacy rows (plant NULL) are excluded from every calculation.
- Schema changes are idempotent in `server/db.cjs`, mirrored in `init.sql`, placed after the `app_migrations` table is created, and must never fail boot.
- Metric keys, weights, targets and display order in `supplierPerformanceSettings.cjs` do not change.
- Work on branch `feat/die-life-by-plant`.

## Review Focus

1. A row with dies run recorded and dies unloaded blank: counts its dies run with 0 unloaded. (Task 1)
2. A row with only the new-die pair recorded: contributes to the new and the scored ratio, not the backup ratio. (Task 1)
3. Two plants in one month, one with 0 dies scrapped: all-plants die life = total tonnage ÷ total scrapped. (Task 1)
4. Saving with plant "All plants", a blank plant, or an unlisted plant: refused, nothing written. (Task 2)
5. A supplier typed with different case on two saves for the same plant and month: one row, updated. (Task 2)

---

### Task 1: Schema and calculation rules

**Files:**
- Modify: `server/db.cjs`, `init.sql`, `server/services/supplierDieLife.cjs`
- Test: `server/services/supplierDieLife.test.cjs`

**Interfaces — Produces:**
- `validateEntry(entry) -> { supplier, tonnageMt, diesScrapped, diesInService, diesFailed, newDiesReceived, newDieTrials, backupDiesReceived, backupDieTrials }` (throws a 400 `fail` as today; plant is validated in `saveDieLife`, Task 2)
- `aggregateDieLife(rows) -> { dieLife, noDiesScrapped, dieFailure, newTrialRatio, backupTrialRatio, trialRatio, totals }` where `rows` use the field names above, `noDiesScrapped` is true only when tonnage is recorded and Σ scrapped is 0, and `totals` holds the eight summed counts (`null` when no row recorded that count)
- `num` exported

- [ ] **Step 1: Write the failing tests** (replace the tests that pin `avgDieLifeMt`):

```js
const row = (o) => ({ tonnageMt: null, diesScrapped: null, diesInService: null, diesFailed: null,
  newDiesReceived: null, newDieTrials: null, backupDiesReceived: null, backupDieTrials: null, ...o });
test('die life is total tonnage over total dies scrapped', () => {
  const a = aggregateDieLife([row({ tonnageMt: 420, diesScrapped: 6 }), row({ tonnageMt: 150, diesScrapped: 0 })]);
  assert.equal(a.dieLife, 95); assert.equal(a.noDiesScrapped, false);
});
test('tonnage with no die scrapped has no die life', () => {
  const a = aggregateDieLife([row({ tonnageMt: 150, diesScrapped: 0 })]);
  assert.equal(a.dieLife, null); assert.equal(a.noDiesScrapped, true);
});
test('a row missing tonnage or scrapped is left out of die life', () => {
  const a = aggregateDieLife([row({ tonnageMt: 420, diesScrapped: 6 }), row({ diesScrapped: 4 }), row({ tonnageMt: 99 })]);
  assert.equal(a.dieLife, 70);
});
test('failure pools counts; blank unloaded counts as none', () => {
  const a = aggregateDieLife([row({ diesInService: 40, diesFailed: 5 }), row({ diesInService: 10 })]);
  assert.equal(a.dieFailure, 10);
  assert.equal(aggregateDieLife([row({})]).dieFailure, null);
});
test('trial ratios pool each pair on its own', () => {
  const a = aggregateDieLife([row({ newDiesReceived: 3, newDieTrials: 5 }), row({ backupDiesReceived: 2, backupDieTrials: 2, newDiesReceived: 4 })]);
  assert.equal(a.newTrialRatio, 5 / 3); assert.equal(a.backupTrialRatio, 1); assert.equal(a.trialRatio, 7 / 5);
  assert.equal(aggregateDieLife([row({ newDiesReceived: 0, newDieTrials: 0 })]).trialRatio, null);
});
test('validation', () => {
  assert.throws(() => validateEntry({ supplier: 'WEFA', diesFailed: 2 }));                         // needs dies run > 0
  assert.throws(() => validateEntry({ supplier: 'WEFA', diesInService: 3, diesFailed: 4 }));
  assert.throws(() => validateEntry({ supplier: 'WEFA', newDieTrials: 2 }));                        // needs new dies received > 0
  assert.throws(() => validateEntry({ supplier: 'WEFA', backupDiesReceived: 0, backupDieTrials: 1 }));
  assert.throws(() => validateEntry({ supplier: 'WEFA', diesScrapped: 1.5 }));                      // die counts are whole numbers
  assert.throws(() => validateEntry({ supplier: 'WEFA', tonnageMt: -1 }));
  const ok = validateEntry({ supplier: ' WEFA ', tonnageMt: '420.5', diesScrapped: 6, newDiesReceived: 3, newDieTrials: 2 });
  assert.equal(ok.tonnageMt, 420.5); assert.equal(ok.newDieTrials, 2); assert.equal(ok.diesFailed, null);
});
```

- [ ] **Step 2: Run** `node --test server/services/supplierDieLife.test.cjs` — FAIL.
- [ ] **Step 3: Implement** `validateEntry` and `aggregateDieLife` as specified (spec "Rules").
- [ ] **Step 4: Schema.** Add to `supplier_die_life`: `plant TEXT`, `tonnage_mt NUMERIC`, `new_dies_received INTEGER`, `new_die_trials INTEGER`, `backup_dies_received INTEGER`, `backup_die_trials INTEGER`. Drop the old `UNIQUE (supplier, year, month)` constraint by looking up its name in `pg_constraint`. Before creating the new index, delete older duplicates among rows with a plant that collide on `(upper(btrim(supplier)), plant, year, month)`, keeping the latest `updated_at`. Create `CREATE UNIQUE INDEX IF NOT EXISTS supplier_die_life_plant_month_uq ON supplier_die_life (upper(btrim(supplier)), plant, year, month) WHERE plant IS NOT NULL`. Mirror in `init.sql`.
- [ ] **Step 5: Run** `npm test` — the suite must pass; tests in other files that fail only because they call the old `aggregateDieLife` shape are fixed in Task 2, so in this task keep `getDieLifeRows` / `getDieLifeForPeriod` returning what their callers need (`dieLife`, `dieFailure`) by mapping the new result.
- [ ] **Step 6: Commit** `feat(die-life): store counts per plant and calculate die life, failure and trial ratios from them`

---

### Task 2: Save, list and report data per plant

**Files:**
- Modify: `server/services/supplierDieLife.cjs` (+ test), `server/routes/supplier-performance.cjs`, `server/services/supplierPerformanceData.cjs` (+ test), `server/routes/plants.cjs`, `server/services/supplierTrialRatio.cjs` (delete with its test if nothing else imports it)

**Interfaces:**
- Consumes: `validateEntry`, `aggregateDieLife`
- Produces:
  - `listDieLife(pool, { year, month, plant }) -> { rows, legacy }` — `plant` a plant name gives that plant's rows; `plant: 'all'` gives one summed row per supplier (`totals` field names, plus `calculated` = the `aggregateDieLife` result); `legacy` = rows with no plant for that month (`id`, `supplier`, `avgDieLifeMt`, `diesInService`, `diesFailed`, `diesScrapped`), always returned
  - `saveDieLife(pool, { year, month, plant, entries }, userId)` — refuses a blank plant, `'all'`, or a plant not in the `plants` table (400 "Choose a plant to save figures for"); all entries validated before any write; upsert on the new unique index
  - `deleteLegacyRow(pool, id) -> boolean` — only a row with `plant IS NULL`
  - `getDieLifeRows(pool, { supplier, year, months }) -> [{ month, ...aggregateDieLife(rowsOfThatMonthAcrossPlants) }]`, one entry per month that has any row with a plant
  - `getDieLifeForPeriod(pool, { supplier, year, months }) -> aggregateDieLife(all rows with a plant in the period)`
  - Routes: `GET /api/supplier-performance/die-life?year&month&plant`, `PUT /die-life` body `{ year, month, plant, entries }`, `DELETE /die-life/legacy/:id` (admin). `GET/PUT /trial-ratio` removed.
  - `getSnapshot` returns `trialRatio`, `newTrialRatio`, `backupTrialRatio` from `getDieLifeForPeriod`; the orders-based `trial_ratio` query column and the corrections path are removed.
  - Plants: renaming a plant updates `supplier_die_life.plant` in the same transaction; deleting a plant with die life rows returns 409 "This plant has die life figures and cannot be deleted".

- [ ] **Step 1: Write failing tests** (fake pool, as the existing tests do): save refuses `plant: 'all'`, blank and unlisted plants with no INSERT run; one bad entry writes nothing; the upsert's conflict target is the new index; `listDieLife` with `plant: 'all'` sums two plants' rows per supplier and returns calculated figures; legacy rows are returned separately and excluded from the sums; `getSnapshot` takes `trialRatio` from the typed counts and no longer queries `no_of_trial`; `getDieLifeRows` returns one aggregated entry per month; plant delete with rows is 409 and rename cascades.
- [ ] **Step 2: Run** the three test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(die-life): save and report die life figures per plant and take the trial ratio from typed counts`

---

### Task 3: Die Life Data tab

**Files:**
- Create: `src/utils/dieLifeCalc.js` (+ `.test.js`)
- Modify: `src/pages/analytics/DieLifeTab.jsx`, `src/api.js`

**Interfaces:**
- Consumes: Task 2 endpoints; the plants list from the existing `plantsAPI`
- Produces: `calcDieLife(rows)` — the same result as the server `aggregateDieLife` for the same input (the test imports the server module and compares); `formatDieLife(result) -> string` ("70.0", "no dies scrapped", "not recorded"); `rowErrors(row) -> { [field]: message }` mirroring `validateEntry`

- [ ] **Step 1: Write failing util tests**: parity with the server on the Task 1 cases; `formatDieLife` three outputs; `rowErrors` for unloaded > run and trials without dies.
- [ ] **Step 2: Run** `node --test src/utils/dieLifeCalc.test.js` — FAIL.
- [ ] **Step 3: Implement the util and the API helpers** (`getDieLife({ year, month, plant })`, `saveDieLife({ year, month, plant, entries })`, `deleteLegacyDieLife(id)`; remove the two trial-ratio helpers).
- [ ] **Step 4: Rebuild the tab** to the spec's "Screen" section: plant selector (plants, then "All plants"; default the first plant), grouped columns as in the spec sketch with the calculated cells read-only and live, inline row errors that block Save, "All plants" read-only with no Save, the "Plant not set" block with an admin-only delete, the correction dialog and its state removed. Switching plant, year or month with unsaved edits asks before discarding (keep whatever the tab does today for month changes). Controlled inputs from local draft state.
- [ ] **Step 5: Run** `npm test`, `npm run build`, `npx eslint` on touched files — no new errors. Re-read the component top to bottom for use-before-declare and hook-order mistakes.
- [ ] **Step 6: Commit** `feat(die-life): enter die life figures per plant with calculated die life, failure and trial ratios`

---

### Task 4: Supplier Report and PDF

**Files:**
- Modify: `src/pages/analytics/SupplierReportTab.jsx`, `src/components/analytics/DieLifeMatrix.jsx`, `server/services/supplierReportPdf.cjs` (+ test), `server/routes/supplier-performance.cjs` (`buildReport` only if the row shape needs it)

**Interfaces — Consumes:** `report.dieLifeRows` = `[{ month, dieLife, noDiesScrapped, dieFailure, newTrialRatio, backupTrialRatio, trialRatio, totals }]`; `snapshot.newTrialRatio`, `snapshot.backupTrialRatio`.

- [ ] **Step 1: Write failing PDF tests**: the die life table prints the labels "Tonnage (MT)", "Dies scrapped", "Dies run", "Dies unloaded" and no longer "Dies Extruded" / "Dies Failed"; a month with tonnage and 0 scrapped prints "no dies scrapped"; a blank prints as it does today for unrecorded values, never 0; the trial ratio line shows the new and backup ratios with their counts.
- [ ] **Step 2: Run** `node --test server/services/supplierReportPdf.test.cjs` — FAIL.
- [ ] **Step 3: Implement** the PDF table and `matrixRows`; update `DieLifeMatrix` and the report tab to the same columns (counts and calculated figures per month, all plants combined) and show the new and backup ratios beside the trial ratio metric.
- [ ] **Step 4: Run** `npm test`, `npm run build`, eslint on touched files.
- [ ] **Step 5: Commit** `feat(die-life): show per-plant totals, the new labels and the new and backup trial ratios in the Supplier Report and PDF`

---

## After the last task

Whole-branch review, then a browser check on a scratch stack: save two plants for one supplier and month, confirm "All plants" and the Supplier Report show the summed figures, and open the PDF.
