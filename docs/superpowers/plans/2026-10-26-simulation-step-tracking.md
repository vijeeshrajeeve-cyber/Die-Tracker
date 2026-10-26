# Simulation Step Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-button Simulation tab with a Sample-Followup-style worklist that tracks each die's simulation rounds step by step, records Not OK reasons, and sends supplier modifications through the existing revision workflow.

**Architecture:** A new `simulation_rounds` table holds one row per round. Pure rules in `server/services/simulationRounds.cjs` derive each die's stage, its days and whether it's late from the order plus its rounds. That includes a *virtual* round for dies that have no row yet, so deploying writes nothing. `server/services/simulation.cjs` does the transactional step writes, and `server/routes/simulation.cjs` exposes them. The server computes working days using the Work Queue calendar, so the client only groups, sorts and draws. A new `die_orders.simulation_completed_date` takes over the "simulation finished" meaning that `three_d_model_received_date` carries today. The Work Queue projection SQL changes to the same 1-working-day rule.

**Tech Stack:** Node/Express 5 (CommonJS `.cjs`), Postgres via `pg`, React 18 + Vite (ESM), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-26-simulation-step-tracking-design.md`. Read it before starting any task; this plan argues from it.

## Global Constraints

- Today's date only through `todayLocal()` (`server/services/dates.cjs`, `src/utils/today.js`). Never `new Date().toISOString()`; `src/utils/todayUsage.test.js` fails on it.
- Date columns are Postgres `DATE`, read as raw `'YYYY-MM-DD'` strings (`server/db.cjs` type parser 1082).
- Not OK reasons, verbatim and in this order: `Uneven exit velocity / flow imbalance`, `Extrusion pressure too high (exceeds press capacity)`, `Die deflection / stress too high`, `Weld seam quality`, `Exit temperature out of range`, `Profile dimension / shape deviation`, `Other`.
- Modification values: `In-house`, `Supplier`. Results: `OK`, `Not OK`.
- Stage labels, verbatim: `Awaiting 3D model`, `3D model received`, `Preparation done`, `In-house modification`.
- Late = more than **1 working day** from the round's model-received date to its simulation-completed date, or to today while it's open. Working days come from the Work Queue calendar (Mon–Sat, holidays skipped, per-plant override). Only the `3D model received` and `Preparation done` stages can be late.
- No fabricated numbers: a missing date stays `null` and shows as `—`. Never back-fill rounds.
- Step dates: required, not in the future, never earlier than the round's previous step date.
- Page access key stays `flow-simulation`. Delete/undo is admin-only.
- Schema changes are idempotent blocks in `server/db.cjs`, mirrored in `init.sql`. One-time data changes are guarded by an `app_migrations` id.
- Tests: `npm test`. Work Queue Postgres suites need `WORK_QUEUE_TEST_DATABASE_URL` / `WORK_QUEUE_API_TEST_DATABASE_URL` (see memory "Dev workflow"). Without them they skip silently.
- Frontend checks: `npx eslint <changed files>` plus `npm run build`. Don't use `build:check`, which always fails on pre-existing lint problems.

## Review Focus

1. **Stale page / two people on one die:** a step that doesn't match the die's current stage gets a 409 with a plain message, and the page reloads that die. Test in Task 5.
2. **Status changed elsewhere while the page is open:** a step on an order no longer in `UNDER SIMULATION` gets a 409 and writes nothing. Test in Task 5.
3. **Supplier revision insert fails:** the round must not be left closed. The whole step rolls back. Test in Task 5.
4. **Sunday or a holiday inside the 1-day window:** model received Saturday, simulation done Monday, is **not** late. Tests in Tasks 1 and 3.
5. **Legacy die back after a revision:** its old `three_d_model_received_date` (an earlier pass's finish date) must not become round 1's receipt. Test in Task 3.

---

### Task 1: Working-day count

**Files:**
- Modify: `server/services/workQueueCalendar.cjs` (add an export)
- Test: `server/services/workQueueCalendar.test.cjs`

**Interfaces:**
- Produces: `workingDaysBetween(from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', calendar?: object) -> number`. It counts the working days `d` with `from < d <= to`, using `validateCalendar` rules (default weekdays `[1..6]`, `holidays`). It returns `0` when `to <= from`, and throws a 400 error on an invalid date, like `dueDate`.

- [ ] **Step 1: Write the failing tests**

```js
test('working days between counts days after the start up to and including the end', () => {
  assert.equal(cal.workingDaysBetween('2026-10-19', '2026-10-20'), 1); // Mon → Tue
  assert.equal(cal.workingDaysBetween('2026-10-19', '2026-10-21'), 2); // Mon → Wed
  assert.equal(cal.workingDaysBetween('2026-10-19', '2026-10-19'), 0);
  assert.equal(cal.workingDaysBetween('2026-10-20', '2026-10-19'), 0);
});
test('Sunday is not a working day', () => {
  assert.equal(cal.workingDaysBetween('2026-10-24', '2026-10-26'), 1); // Sat → Mon
});
test('holidays are skipped', () => {
  assert.equal(cal.workingDaysBetween('2026-10-19', '2026-10-21', { holidays: ['2026-10-20'] }), 1);
});
```

- [ ] **Step 2:** Run `node --test server/services/workQueueCalendar.test.cjs`. Expected: FAIL (`workingDaysBetween is not a function`).
- [ ] **Step 3:** Implement `workingDaysBetween` beside `pauseCredit`, with the same day-walk and the same `dateNumber`/`isoDay` helpers, and export it.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(calendar): count working days between two dates`

---

### Task 2: Schema, `simulation_completed_date`, and order presentation

**Files:**
- Modify: `server/db.cjs` (new table and column before the Work Queue init at ~line 1431; one-time backfill), `init.sql`
- Modify: `server/services/orderPresentation.cjs`, `server/routes/export.cjs`, `server/services/autoBackup.cjs`, `src/pages/SettingsPage.jsx:772` (backup column list)
- Test: `server/services/orderPresentation.test.cjs`

**Interfaces:**
- Produces table `simulation_rounds`:

```sql
CREATE TABLE IF NOT EXISTS simulation_rounds (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES die_orders(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL,
  started_from TEXT NOT NULL CHECK (started_from IN ('initial','supplier','in_house','reentry')),
  revision_id INTEGER REFERENCES order_revisions(id) ON DELETE SET NULL,          -- revision that started it
  model_received_date DATE,
  model_date_target TEXT CHECK (model_date_target IN ('order','revision')),        -- where the receipt was also written
  prep_done_date DATE,
  sim_completed_date DATE,
  result TEXT CHECK (result IN ('OK','Not OK')),
  fail_reason TEXT,
  modification TEXT CHECK (modification IN ('In-house','Supplier')),
  supplier_revision_id INTEGER REFERENCES order_revisions(id) ON DELETE SET NULL,  -- revision this round created
  modification_done_date DATE,
  comments TEXT,
  created_by INTEGER REFERENCES users(id), created_by_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id, round_no),
  CONSTRAINT simulation_rounds_result_fields CHECK (
    (result = 'Not OK' AND fail_reason IS NOT NULL AND modification IS NOT NULL)
    OR (result = 'OK' AND fail_reason IS NULL AND modification IS NULL)
    OR (result IS NULL AND fail_reason IS NULL AND modification IS NULL)),
  CONSTRAINT simulation_rounds_dates_in_order CHECK (
    (prep_done_date IS NULL OR prep_done_date >= model_received_date)
    AND (sim_completed_date IS NULL OR sim_completed_date >= prep_done_date)
    AND (modification_done_date IS NULL OR modification_done_date >= sim_completed_date))
);
```

- Produces column `die_orders.simulation_completed_date DATE`, presented as `'Simulation Completed Date'`, exported and backed up with that label.
- One-time backfill, `app_migrations` id `simulation_completed_backfill_v1`: `UPDATE die_orders SET simulation_completed_date = three_d_model_received_date WHERE simulation_enabled = 1 AND three_d_model_received_date IS NOT NULL AND simulation_completed_date IS NULL AND status NOT IN ('PENDING FOR ORDERING','AWAITING FOR DESIGN','UNDER SIMULATION')`. It never touches `three_d_model_received_date`.

- [ ] **Step 1: Write the failing test** in `orderPresentation.test.cjs`: `presentOrder({ ..., simulation_completed_date: '2026-10-20' })['Simulation Completed Date'] === '2026-10-20'`.
- [ ] **Step 2:** Run `node --test server/services/orderPresentation.test.cjs`. Expected: FAIL.
- [ ] **Step 3:** Add the table, the column, the backfill, the `init.sql` mirror, and the presentation/export/backup entries.
- [ ] **Step 4:** Run the test. Expected: PASS. Then `npm test`. Expected: no new failures.
- [ ] **Step 5: Commit** `feat(simulation): simulation_rounds table and simulation_completed_date`

---

### Task 3: Simulation rules (pure)

**Files:**
- Create: `server/services/simulationRounds.cjs`
- Test: `server/services/simulationRounds.test.cjs`

**Interfaces:**
- Consumes: `workingDaysBetween` (Task 1).
- Produces:
  - `STAGES = ['awaiting_model','model_received','prep_done','in_house_mod']`; `STAGE_LABELS` (Global Constraints labels); `FAIL_REASONS`; `MODIFICATIONS`; `RESULTS`; `TARGET_WORKING_DAYS = 1`.
  - `NEXT_STEP = { awaiting_model: 'model_received', model_received: 'prep_done', prep_done: 'sim_completed', in_house_mod: 'modification_done' }`.
  - `stageOfRound(round) -> stage | 'closed'`. Closed when `result === 'OK'`, or `modification === 'Supplier'`, or (`modification === 'In-house'` and `modification_done_date`). `in_house_mod` when Not OK + In-house without a done date. Otherwise `prep_done` / `model_received` / `awaiting_model` by which dates are set.
  - `deriveRounds({ order, rows }) -> Round[]`. `rows` are DB rows sorted by `round_no`. When `order.status === 'UNDER SIMULATION'` and there are no rows, or the last row is closed, append a **virtual** round `{ id: null, round_no: last + 1, started_from, ... }` where:
    - `started_from` is `'initial'` with no rows, `'supplier'` when the last closed row has `modification === 'Supplier'`, and `'reentry'` otherwise.
    - The legacy case: no rows, `design_revision_count` 0, and `three_d_model_received_date` set. The virtual round then carries `model_received_date` = that date and `legacy: true`.
    - When the order is **not** in Simulation and the last row is open, that round gets `left_simulation: order.status`.
  - `deriveDie({ order, rows, latestRevision, calendar, today }) -> SimulationDie`, where `SimulationDie = { order_id, die_no, order_no, plant, supplier, press, customer, profile, design_revision_count, stage, stage_label, round_no, stage_since, days_on_stage, late, rounds: Round[] }`. Each `Round` adds `stage`, `late` and `model_to_result_days` (working days, `null` until completed). `stage_since`:
    - `awaiting_model`: `latestRevision.design_received_date || latestRevision.revision_date || order.design_received_date`
    - `model_received`: `model_received_date`
    - `prep_done`: `prep_done_date`
    - `in_house_mod`: `sim_completed_date`

    `days_on_stage = workingDaysBetween(stage_since, today)`, or `null` without a `stage_since`.
  - `validateStep(round, input, today) -> { ok: true, value } | { ok: false, error }`. `input = { step, date, result?, fail_reason?, modification?, comments?, revision_notes? }`. `step` must equal `NEXT_STEP[stageOfRound(round)]`. Errors mention "stage" for a mismatch. `date` is normalised like `sampleTrials.normaliseDate`. On `sim_completed`, `result` is required. Not OK needs a listed `fail_reason` **and** `modification`, and Supplier also needs non-blank `revision_notes`. OK drops any reason or modification. `comments` are trimmed, at most 2000 characters, blank becomes `null`.

- [ ] **Step 1: Write the failing tests.** Names and the assertions that matter:

```js
test('reason list is exactly the agreed vocabulary, in order', () => assert.deepEqual(sim.FAIL_REASONS, [
  'Uneven exit velocity / flow imbalance', 'Extrusion pressure too high (exceeds press capacity)',
  'Die deflection / stress too high', 'Weld seam quality', 'Exit temperature out of range',
  'Profile dimension / shape deviation', 'Other']));
test('a new die in Simulation gets one virtual round awaiting its 3D model', ...);        // stage 'awaiting_model', id null, started_from 'initial'
test('first-pass legacy die with a 3D date starts at 3D model received from that date', ...); // revision count 0
test('legacy die back after a revision does not reuse the old 3D date', ...);             // revision count 1 → awaiting_model, model_received_date null
test('after a Supplier round closes, the next virtual round starts from supplier', ...);
test('an open round on an order that left Simulation is marked left_simulation', ...);
test('late: model Mon, open on Wed is late; open on Tue is not', ...);                     // 2026-10-19 → 21 / 20
test('late: model Sat, completed Mon is not late (Sunday skipped)', ...);                 // 2026-10-24 → 26
test('awaiting and in-house stages are never late', ...);
test('step must match the stage', ...);       // prep_done on awaiting_model → error /stage/
test('future date and date before previous step are rejected', ...);
test('Not OK needs a listed reason and a modification; Supplier needs revision notes', ...);
test('OK drops reason and modification', ...);
```

- [ ] **Step 2:** Run `node --test server/services/simulationRounds.test.cjs`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the module. Keep it free of DB access, following the conventions of `sampleTrials.cjs`.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(simulation): round stage, late and step rules`

---

### Task 4: Shared revision creation

**Files:**
- Create: `server/services/orderRevisions.cjs`
- Modify: `server/routes/orders.cjs:936-1013` (the route calls the service)
- Test: `server/services/orderRevisions.test.cjs`

**Interfaces:**
- Produces: `createRevision(client, { orderId, targetStatus, notes, revisionDate, revisionPdf, user }) -> { id, revisionNumber, status, lastRevisionDate, fromStatus } | null` (`null` when the order doesn't exist). It runs **inside the caller's transaction**: no BEGIN/COMMIT. It does the same three writes the route does today (the `order_revisions` insert, the `die_orders` status/counter/date update, the `order_changes` audit), and it also sets `simulation_completed_date = NULL` when `targetStatus` is `'AWAITING FOR DESIGN'` or `'UNDER SIMULATION'`. A design sent back invalidates the previous pass, so Design Approval timing and the drawer's status rule (Task 9) start fresh. The route keeps its own BEGIN/COMMIT/ROLLBACK and response shape.

- [ ] **Step 1: Write the failing tests** with a fake client recording SQL. Check that a revision to `AWAITING FOR DESIGN` increments `design_revision_count`, inserts the revision and audit rows, and clears `simulation_completed_date`. Check that a revision to `PENDING FOR PR` leaves `simulation_completed_date` alone, and that a missing order returns `null`.
- [ ] **Step 2:** Run `node --test server/services/orderRevisions.test.cjs`. Expected: FAIL.
- [ ] **Step 3:** Move the logic into the service and make the route call it.
- [ ] **Step 4:** Run it plus `node --test server/routes/orders.test.cjs`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(revisions): share revision creation; clear simulation pass on send-back`

---

### Task 5: Simulation service, routes and API client

**Files:**
- Create: `server/services/simulation.cjs`, `server/routes/simulation.cjs`
- Modify: `server/index.cjs` (mount it), `src/api.js` (add `simulationAPI`)
- Test: `server/services/simulation.test.cjs`, `server/routes/simulation.test.cjs` (route test via `testSupport.installFakeDb`)

**Interfaces:**
- Consumes: Task 3 (`deriveDie`, `deriveRounds`, `validateStep`, `stageOfRound`), Task 4 (`createRevision`), `planReceivedDate` (`server/services/stageCompletion.cjs`), `presentOrder`.
- Produces:
  - `listSimulation(client, today) -> { dies: SimulationDie[] }`. Orders with status `UNDER SIMULATION`, their rounds, each order's latest revision, and the calendar per plant (`work_queue_calendars`, plant row else the global row).
  - `recordStep(client, orderId, input, user, today) -> { ok: true, die, order } | { ok: false, status, error }`. `order` is `presentOrder(row)` so the page can update `data`. Everything runs in one transaction with the order row locked `FOR UPDATE`. Order not found returns 404. Status not `UNDER SIMULATION` returns 409 "This die is no longer in Simulation". A `validateStep` error returns 409 when it's a stage mismatch, otherwise 400. Writes per step:
    - `model_received`: insert the virtual round, or update it. Then `planReceivedDate({ field: '3D Model Received Date', existingValue })`. `'order'` writes `three_d_model_received_date` and `model_date_target='order'`. Otherwise, if the round has `revision_id`, write `order_revisions.model_received_date` (only when it's null) and `model_date_target='revision'`.
    - `prep_done`: update the round, inserting a legacy virtual round first if needed.
    - `sim_completed` OK: update the round, set `die_orders.simulation_completed_date` = date and `status='PENDING FOR DESIGN APPROVAL'`, and add an `order_changes` STATUS audit row.
    - `sim_completed` Not OK + In-house: update the round.
    - `sim_completed` Not OK + Supplier: update the round, call `createRevision({ targetStatus: 'AWAITING FOR DESIGN', notes: revision_notes, revisionDate: date })`, and store `supplier_revision_id`.
    - `modification_done`: update the round, then insert round `n+1` with `started_from='in_house'` and `model_received_date` = date.
    - Virtual rounds being inserted get `revision_id` = the latest revision's id when `started_from` is `'supplier'` or `'reentry'`.
  - `undoLastStep(client, orderId, user) -> same shape`. Admin only (the route returns 403 for others). It reverses the newest entry: a fresh `in_house` round with only its model date is deleted, and the previous round's `modification_done_date` is cleared. Otherwise it clears the open round's latest field, in the order Not OK In-house result fields, then `prep_done_date`, then `model_received_date`. Clearing the model date also clears it where `model_date_target` says it was written, and deletes the row when nothing is left in it. It refuses with 409 when there's nothing to undo, or when the latest entry is an OK or Supplier result.
  - Routes: `GET /api/simulation`, `POST /api/simulation/:orderId/steps`, `DELETE /api/simulation/:orderId/last-step`, mounted with `authMiddleware, pageAccessMiddleware('flow-simulation')`. Validation and error handling follow `server/routes/sample-trials.cjs`.
  - `simulationAPI = { list(), recordStep(orderId, payload), undoLastStep(orderId) }` in `src/api.js`.

- [ ] **Step 1: Write the failing tests** (fake client dispatching on SQL, as in `sampleTrials.test.cjs`):

```js
test('model received on a first receipt writes the order column', ...);          // three_d_model_received_date set, model_date_target 'order'
test('model received in a supplier round writes the revision row, not the order', ...);
test('OK sets simulation_completed_date and moves to Design Approval', ...);
test('Not OK Supplier creates a revision to AWAITING FOR DESIGN in the same transaction', ...);
test('if the revision insert throws, the step rolls back and nothing commits', ...);   // ROLLBACK seen, COMMIT not
test('modification done opens the next round at 3D model received', ...);
test('a step on an order no longer in Simulation is refused with 409', ...);
test('a step that does not match the current stage is refused with 409', ...);
test('undo is refused for an OK or Supplier result', ...);
test('DELETE last-step is admin only', ...);                                        // route test, 403 for role 'user'
```

- [ ] **Step 2:** Run `node --test server/services/simulation.test.cjs server/routes/simulation.test.cjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the service, the routes, the mount and the API client.
- [ ] **Step 4:** Run them again. Expected: PASS. Then `npm test`. Expected: no new failures.
- [ ] **Step 5: Commit** `feat(simulation): step recording, undo and API`

---

### Task 6: Work Queue follows the 1-working-day rule

**Files:**
- Modify: `server/migrations/20260921_work_queue.sql` (re-applied at every boot by `initializeWorkQueue`, so edit it in place)
- Modify: `server/services/workQueueStages.cjs` (`simulation` days `2` → `1`)
- Test: `server/services/workQueueSync.test.cjs` (Postgres suite)

**Interfaces:**
- Consumes: the `simulation_rounds` table (Task 2), created before the Work Queue init.
- Behaviour in `work_queue_project`, `WHEN 'UNDER SIMULATION'`:
  - Load the latest `simulation_rounds` row for the order.
  - The open round has a `model_received_date`, no `sim_completed_date`, and isn't an in-house modification. That gives stage `simulation`, anchor = `model_received_date`, and `sig = 'simulation:round:' || id || ':' || epoch`.
  - No rows, revision count 0 and `three_d_model_received_date` set (legacy): anchor = that date, `sig = 'simulation:legacy:' || epoch`.
  - Every other case is **awaiting model or in-house modification**: `RETURN jsonb_build_object('terminal','completed')`. That means no item and no overdue reminder.
- Change the seed `('simulation',2)` to `('simulation',1)`. Add a guarded one-time block (`app_migrations` id `work_queue_simulation_1day_v1`): `UPDATE work_queue_rules SET days = 1 WHERE stage_key = 'simulation' AND days = 2 AND version = 1`, then `PERFORM work_queue_sync('order', id)` for every order in `UNDER SIMULATION`.
- Add a trigger `work_queue_simulation_round_sync` on `simulation_rounds` (AFTER INSERT/UPDATE/DELETE, deferrable, like `work_queue_revision_sync`). Extend `work_queue_child_changed` with a `simulation_rounds` branch that syncs `('order', order_id)`.

- [ ] **Step 1: Write the failing Postgres tests:**
  - an order in Simulation with an open round received `2026-10-24` (Sat) gets due date Monday `2026-10-26` at cutoff;
  - an awaiting-model order has no active item;
  - an in-house modification has no active item;
  - an admin-edited rule (`days = 3`, `version = 2`) stays 3 after init.
- [ ] **Step 2:** Run `npm test` with `WORK_QUEUE_TEST_DATABASE_URL` set. Expected: those tests FAIL.
- [ ] **Step 3:** Implement the SQL and the stage-days change.
- [ ] **Step 4:** Run them again. Expected: PASS, with both Work Queue suites actually running (not skipped).
- [ ] **Step 5: Commit** `feat(work-queue): simulation item follows the 1-working-day round rule`

---

### Task 7: Client view rules and shared vocabulary

**Files:**
- Create: `src/utils/simulationView.js`
- Modify: `src/utils/constants.js` (add `SIMULATION_FAIL_REASONS`, `SIMULATION_MODIFICATIONS`, `SIMULATION_STAGE_LABELS`)
- Test: `src/utils/simulationView.test.js`

**Interfaces:**
- Consumes: the `SimulationDie` shape from Task 3, via the API.
- Produces:
  - `scopeDies(dies, { search, plant }) -> SimulationDie[]`. Search matches die no, order no, profile and supplier, case-insensitively.
  - `sortDies(dies, sort) -> SimulationDie[]`, with `sort` one of `'overdue'` (late first, then most `days_on_stage`), `'newest'` (latest `stage_since` first) or `'plant'`.
  - `bandsFor(stage, rows) -> { key, label, tone, rows }[]`. `model_received` and `prep_done` get a `late` band ("Past the 1-day target") and an `open` band. The other stages get one `waiting` band. Empty bands are dropped.
  - `stageSummary(dies) -> { [stage]: { count, late } }`.
  - `modelToResult(dies, today) -> { current: number|null, previous: number|null }`. This is the mean of `model_to_result_days` for rounds completed in the last 90 calendar days, and in the 90 days before that.
  - `topReason(dies, today) -> { reason, count, total } | null`. It looks at Not OK rounds completed in the last 90 days.

- [ ] **Step 1: Write the failing tests:** the vocabulary equals the server's (load `server/services/simulationRounds.cjs` with `createRequire`, as `src/utils/deliveryFollowup.test.js` does); late band first; awaiting stage has one band; `modelToResult` returns `null` with no completions; `topReason` picks the most frequent reason and returns `null` with none.
- [ ] **Step 2:** Run `node --test src/utils/simulationView.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(simulation): client view rules`

---

### Task 8: Simulation page

**Files:**
- Create: `src/pages/SimulationPage.jsx`, `src/components/simulation/SimulationDetail.jsx`, `src/components/simulation/StepForm.jsx`, `src/styles/simulation.css` (round step boxes only; everything else reuses `src/styles/sample-followup.css` `sf-*` classes)
- Modify: `src/DieOrderingSystem.jsx` (lazy-load `SimulationPage` for `activeTab === 'flow-simulation'`; exclude `flow-simulation` from the `FlowPage` branch at ~line 3372)

**Interfaces:**
- Consumes: `simulationAPI` (Task 5), `simulationView` + constants (Task 7), `exportToExcel`, `todayLocal`.
- Props: `{ theme, user, setData, setToast, searchTerm, setSearchTerm, setSelectedOrder }`.

Layout and copy follow the spec's "The page" section and mockup option A (`.superpowers/brainstorm/697-1793032893/content/simulation-layout.html`):
- **Header:** "Simulation", with the subtitle "{late} of {n} dies are past the 1-day simulation target" or "No dies in simulation".
- **Summary cards:** Where the dies sit · Model to result · Top Not OK reason.
- **Stage tabs** with counts and "n late", a Plant select, and a Sort select.
- **Banded list.** Rows show die no, `profile · supplier · Round n` and a days chip (`{d}d`, red when late).
- **Detail pane.** All rounds as step boxes with dates (skipped steps dashed; a `left_simulation` round greyed with "Left Simulation (status changed to X)"). The open round's `StepForm` shows the next step's button with a date input (default `todayLocal()`, `max` = today). Simulation completed adds result, reason (only when Not OK), modification and comments. Supplier adds revision notes prefilled `"{reason}: {comments}"`. Admins get "Undo last step" behind `dialogs.confirm`.
- After a successful step, replace the die from the response. Call `setData(prev => prev.map(o => o.id === order.id ? { ...o, ...order, changeCount: (o.changeCount || 0) + 1 } : o))`, and drop the die from the list when it left Simulation. On a 409, show the error toast and reload the list.
- **Export:** Dies and Rounds sheets, with the columns listed in the spec.
- Date inputs are controlled. Don't repeat the uncontrolled `defaultValue` gotcha from Sample Followup.

- [ ] **Step 1:** Build the page and the wiring.
- [ ] **Step 2:** Run `npx eslint src/pages/SimulationPage.jsx src/components/simulation src/DieOrderingSystem.jsx` and `npm run build`. Expected: no new lint errors in these files; the build succeeds.
- [ ] **Step 3: Commit** `feat(simulation): worklist page replaces the Simulation tab`

---

### Task 9: Design Approval timing and the drawer status rule

**Files:**
- Create: `src/utils/determineStatus.js` (moved out of `DieOrderingSystem.jsx:1011-1037`)
- Modify: `src/DieOrderingSystem.jsx` (import it; `getStageEntryDate` ~line 2718), `src/pages/FlowPage.jsx:50`, `src/pages/OrdersPage.jsx:37`, `server/services/dailySummaryData.cjs:91` (`'three_d_model_received_date'` → `'simulation_completed_date'`, and add it to whatever column list that module selects)
- Test: `src/utils/determineStatus.test.js`, `server/services/dailySummaryData.test.cjs`

**Interfaces:**
- Produces: `determineStatus(orderData) -> status`. Behaviour is unchanged except for the simulation line, which becomes: `simulationEnabled && Design Received && Ordered && !'Simulation Completed Date' && (STATUS === 'UNDER SIMULATION' || '3D Model Received Date')` returns `'UNDER SIMULATION'`.
- `getStageEntryDate` for `PENDING FOR DESIGN APPROVAL` uses `order.simulationEnabled ? order['Simulation Completed Date'] : order['Design Received Date']` (all three copies).
- Before switching, grep every remaining reader of `3D Model Received Date` / `three_d_model_received_date` (the import modals, `orderDetailEdits`, export, backup, search). Keep the ones that mean "model arrived". Switch any that mean "simulation done". List the decision for each site in the commit message.

- [ ] **Step 1: Write the failing tests:**
  - a die in Awaiting 3D model (Simulation, no 3D date) stays `UNDER SIMULATION`;
  - a die with `Simulation Completed Date` goes to `PENDING FOR DESIGN APPROVAL`;
  - a historic Design Approval order with no 3D date and no completed date stays in Design Approval;
  - Daily Summary Design Approval aging falls back to `simulation_completed_date`.
- [ ] **Step 2:** Run `node --test src/utils/determineStatus.test.js server/services/dailySummaryData.test.cjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run them again, then `npm test`. Expected: PASS, no new failures.
- [ ] **Step 5: Commit** `fix(simulation): Design Approval timing reads simulation_completed_date`

---

### Task 10: End-to-end check on the test server

The backend runs from a built image (memory "Dev workflow"), so a browser check needs the test server rebuilt. **Ask the user before rebuilding**, because it applies the schema change and both one-time migrations to the test database.

- [ ] **Step 1:** Run `npm test` with both Work Queue database URLs set. Expected: 0 failures, and the Work Queue suites ran.
- [ ] **Step 2:** With the user's go-ahead, run `docker compose build backend frontend && docker compose up -d backend frontend`. Check the backend IP and restart the frontend if it moved.
- [ ] **Step 3:** In the browser, open Process Flow → Simulation. Use a test die you create yourself, and delete only that die afterwards. Run through: model received → preparation → Not OK In-house → modification done (round 2 at 3D model received) → Not OK Supplier (the order shows in Awaiting Design with Rev +1) → Design Received → back in Simulation at Awaiting 3D model → model received → preparation → OK (the order shows in Design Approval, and its day count starts at the OK date). Confirm the Work Queue shows a Simulation item only while the die is at 3D model received or Preparation done.
- [ ] **Step 4:** Take a screenshot of the page and the round history as proof.
