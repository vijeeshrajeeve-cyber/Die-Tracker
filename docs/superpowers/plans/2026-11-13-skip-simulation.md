# Skip Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Skip simulation" action on the Simulation page that records a free-text reason, keeps "Simulation required", and moves the order to Design Approval without looking like a pass.

**Architecture:** The skip is three columns on `die_orders`, written by one new service function behind `POST /api/simulation/:orderId/skip`. Simulation rounds are untouched. On the client one small module answers "did this order pass or skip simulation", and every reader of the pass date goes through it.

**Tech Stack:** Express + pg (CommonJS, `node:test`), React (Vite), no component test framework.

**Spec:** `docs/superpowers/specs/2026-11-13-skip-simulation-design.md`

## Global Constraints

- Reason is free text, required, trimmed, at most 500 characters.
- Skip is allowed only while `status = 'UNDER SIMULATION'`; it sets status `PENDING FOR DESIGN APPROVAL`.
- A skip never writes `simulation_completed_date` or `three_d_model_received_date`, and never touches `simulation_rounds`.
- `simulation_enabled` stays 1.
- Change-log reason text is exactly `Simulation skipped: <reason>`.
- Tests: `npm test` (runs `server/**/*.test.cjs` and `src/**/*.test.js`). Frontend: `npx eslint <changed files>` and `npm run build`; never `npm run build:check` (lint fails on pre-existing problems).
- Schema changes go in both `init.sql` and the idempotent block in `server/db.cjs`.

## Review Focus

1. A skipped order with a 3D model date is edited in the drawer → it must stay in Design Approval, not bounce to Simulation. (Task 3 test.)
2. A skip part-way through a round (model received, prep done) → allowed; the round row is left exactly as it was. (Task 1 test.)
3. A reason of only spaces, or missing → 400, nothing written. A 600-character reason → stored as its first 500. (Task 1 tests.)
4. A skipped order whose design is sent back (revision to Awaiting Design or Simulation) → all three skip columns cleared, so the next pass starts clean. (Task 2 test.)
5. Two people act on the same die: one records OK, the other skips → the second gets 409 "This die is no longer in Simulation". (Task 1 test, via the status check under the row lock.)

---

### Task 1: Skip service, route and columns

**Files:**
- Modify: `init.sql` (beside `simulation_completed_date DATE,` line 71)
- Modify: `server/db.cjs` (beside `ADD COLUMN IF NOT EXISTS simulation_completed_date DATE;` line 1538)
- Modify: `server/services/simulation.cjs`
- Modify: `server/routes/simulation.cjs`
- Modify: `server/services/orderPresentation.cjs`
- Test: `server/services/simulation.test.cjs`, `server/routes/simulation.test.cjs`

**Interfaces:**
- Produces: columns `simulation_skipped_date DATE`, `simulation_skipped_reason TEXT`, `simulation_skipped_by TEXT`.
- Produces: `svc.skipSimulation(client, orderId, input, user, today)` → `{ ok: true, die, order }` or `{ ok: false, status, error }`, the same shape as `recordStep`. `input.reason` is the reason.
- Produces: `POST /api/simulation/:orderId/skip`, body `{ reason }`, response as the steps route.
- Produces: `presentOrder` keys `'Simulation Skipped Date'`, `'Simulation Skipped Reason'`, `'Simulation Skipped By'` (each `?? null`).

- [ ] **Step 1: Write the failing service tests** in `server/services/simulation.test.cjs`, using the file's `fakeDb`, `order`, `round`, `committed`, `user`, `TODAY`:

```js
test('skip moves the order to Design Approval and records who, when and why', async () => {
  const db = fakeDb({ order: order() });
  const out = await svc.skipSimulation(db.client, 7, { reason: '  Repeat of die D-0, same design  ' }, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.order.status, 'PENDING FOR DESIGN APPROVAL');
  assert.equal(db.order.simulation_skipped_date, TODAY);
  assert.equal(db.order.simulation_skipped_reason, 'Repeat of die D-0, same design');
  assert.equal(db.order.simulation_skipped_by, 'eng');
  assert.equal(db.order.simulation_completed_date, null);
  assert.equal(db.order.three_d_model_received_date, null);
  assert.equal(out.die.stage, null);
  assert.equal(out.order['Simulation Skipped Date'], TODAY);
  const change = db.changes[0];
  assert.equal(change[4], 'STATUS');
  assert.equal(change[5], 'UNDER SIMULATION');
  assert.equal(change[6], 'PENDING FOR DESIGN APPROVAL');
  assert.equal(change[7], 'Simulation skipped: Repeat of die D-0, same design');
  assert.ok(committed(db));
});

test('skip part-way through a round leaves the round as it was', async () => {
  const open = round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-20' });
  const db = fakeDb({ order: order({ three_d_model_received_date: '2026-10-19' }), rounds: [open] });
  const out = await svc.skipSimulation(db.client, 7, { reason: 'Customer deadline' }, user, TODAY);
  assert.equal(out.ok, true);
  assert.deepEqual(db.rounds, [open]);
  assert.equal(out.die.rounds[0].stage, 'left');
});

test('skip needs a reason', async () => {
  for (const reason of [undefined, '', '   ']) {
    const db = fakeDb({ order: order() });
    const out = await svc.skipSimulation(db.client, 7, { reason }, user, TODAY);
    assert.deepEqual([out.ok, out.status], [false, 400]);
    assert.equal(db.order.status, 'UNDER SIMULATION');
    assert.equal(db.changes.length, 0);
  }
});

test('a long skip reason is kept to 500 characters', async () => {
  const db = fakeDb({ order: order() });
  await svc.skipSimulation(db.client, 7, { reason: 'x'.repeat(600) }, user, TODAY);
  assert.equal(db.order.simulation_skipped_reason.length, 500);
});

test('skip is refused once the die has left Simulation', async () => {
  const db = fakeDb({ order: order({ status: 'PENDING FOR DESIGN APPROVAL' }) });
  const out = await svc.skipSimulation(db.client, 7, { reason: 'x' }, user, TODAY);
  assert.deepEqual([out.ok, out.status, out.error], [false, 409, 'This die is no longer in Simulation']);
  assert.equal(db.order.simulation_skipped_date ?? null, null);
});
```

Add `simulation_skipped_date: null, simulation_skipped_reason: null, simulation_skipped_by: null` to the test file's `order()` factory.

- [ ] **Step 2: Run** `node --test server/services/simulation.test.cjs` — expect the five new tests to FAIL with `svc.skipSimulation is not a function`.

- [ ] **Step 3: Implement `skipSimulation`** in `server/services/simulation.cjs` and export it. Validate the reason before opening the transaction (blank → `refuse(400, 'A reason is required to skip simulation')`). Then use the existing `inTransaction` (it already gives 404 and the 409 above); inside, one `UPDATE die_orders SET simulation_skipped_date = $1, simulation_skipped_reason = $2, simulation_skipped_by = $3, status = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5` and one `order_changes` insert with the same nine columns `recordStep` uses for an OK. Return `{ ok: true, ...(await describe(client, orderId, today)) }`.

- [ ] **Step 4: Add the columns** to `init.sql` and `server/db.cjs` (three `ADD COLUMN IF NOT EXISTS` lines), and the three keys to `presentOrder`.

- [ ] **Step 5: Write the failing route tests** in `server/routes/simulation.test.cjs`:

```js
test('a skip on a missing order is 404', async () => {
  const { status } = await request(base, '/api/simulation/7/skip', { body: { reason: 'No model available' } });
  assert.equal(status, 404);
});

test('a skip without a reason is 400 and touches nothing', async () => {
  const { status } = await request(base, '/api/simulation/7/skip', { body: {} });
  assert.equal(status, 400);
  assert.equal(log.length, 0);
});
```

- [ ] **Step 6: Add the route** `router.post('/:orderId/skip', orderIdValidation, handleValidationErrors, ...)` in `server/routes/simulation.cjs`, the same shape as the steps route, calling `svc.skipSimulation`. Update the file's header comment.

- [ ] **Step 7: Run** `node --test server/services/simulation.test.cjs server/routes/simulation.test.cjs` — expect all PASS.

- [ ] **Step 8: Commit** `feat(simulation): add skip simulation with a recorded reason`.

### Task 2: Other server readers of the pass

**Files:**
- Modify: `server/services/orderRevisions.cjs`
- Modify: `server/services/dailySummaryData.cjs` (lines 91, 106)
- Modify: `server/routes/export.cjs` (both maps, beside `simulation_completed_date`)
- Modify: `server/services/autoBackup.cjs` (`FIELDS`)
- Test: `server/services/simulation.test.cjs`, plus the existing daily-summary, export and auto-backup suites

**Interfaces:**
- Consumes: the three columns from Task 1.

- [ ] **Step 1: Write the failing test** in `server/services/simulation.test.cjs`:

```js
test('a supplier modification clears an earlier skip', async () => {
  const db = fakeDb({ order: order({ simulation_skipped_date: '2026-10-15', simulation_skipped_reason: 'old', simulation_skipped_by: 'eng' }),
    rounds: [round({ model_received_date: '2026-10-19', prep_done_date: '2026-10-20' })] });
  const out = await svc.recordStep(db.client, 7, { step: 'sim_completed', date: '2026-10-21', result: 'Not OK',
    fail_reason: 'Other', modification: 'Supplier', revision_notes: 'rework' }, user, TODAY);
  assert.equal(out.ok, true);
  assert.equal(db.order.status, 'AWAITING FOR DESIGN');
  assert.equal(db.order.simulation_skipped_date, null);
  assert.equal(db.order.simulation_skipped_reason, null);
  assert.equal(db.order.simulation_skipped_by, null);
});
```

- [ ] **Step 2: Run it** — expect FAIL on `simulation_skipped_date`.

- [ ] **Step 3: In `createRevision`**, extend `clearPass` to also set the three skip columns to `NULL`. Update the comment above `CLEARS_SIMULATION_PASS` to say "pass or skip".

- [ ] **Step 4: Daily summary:** Design Approval `ageFrom` keeps its order and gains the skip date: `['design_received_date', 'simulation_completed_date', 'simulation_skipped_date']`. Add `'simulation_skipped_date'` to `ORDER_COLUMNS`. Read how `ageFrom` and `simulation_completed_date` are used around line 200 first; if there is special handling that prefers the completed date for simulation orders, give the skip date the same treatment, and add a test beside the existing one for it.

- [ ] **Step 5: Export and auto-backup:** add `simulation_skipped_date` ('Simulation Skipped Date'), `simulation_skipped_reason` ('Simulation Skipped Reason'), `simulation_skipped_by` ('Simulation Skipped By') to both export maps and to auto-backup `FIELDS`. If a test pins either list, update it.

- [ ] **Step 6: Run** `npm test` — expect 0 failures.

- [ ] **Step 7: Commit** `feat(simulation): clear a skip on revision and carry it through summary, export and backup`.

### Task 3: Client rules for a skipped order

**Files:**
- Create: `src/utils/simulationState.js`
- Test: `src/utils/simulationState.test.js`, `src/utils/determineStatus.test.js`
- Modify: `src/utils/determineStatus.js`
- Modify: `src/pages/FlowPage.jsx:50`, `src/DieOrderingSystem.jsx:2728`, `src/utils/orderExport.js:36`
- Modify: `src/pages/DashboardPage.jsx:55`, `src/pages/analytics/OverviewTab.jsx:123-126`

**Interfaces:**
- Produces, from `src/utils/simulationState.js`:
  - `isSimulationEnabled(value): boolean` — the same rule as the local copies in `DashboardPage.jsx`.
  - `simulationSkipped(order): boolean` — `'Simulation Skipped Date'` is non-blank.
  - `simulationPassDate(order): string|null` — `'Simulation Completed Date'`, else `'Simulation Skipped Date'`, else null.
  - `wasSimulated(order): boolean` — simulation enabled and not skipped.

- [ ] **Step 1: Write the failing tests.** `src/utils/simulationState.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulationSkipped, simulationPassDate, wasSimulated } from './simulationState.js';

test('a skipped simulation order is not a simulated one', () => {
  const skipped = { simulationEnabled: true, 'Simulation Skipped Date': '2026-11-13' };
  assert.equal(simulationSkipped(skipped), true);
  assert.equal(wasSimulated(skipped), false);
  assert.equal(simulationPassDate(skipped), '2026-11-13');
});

test('a passed simulation order is simulated and ages from the pass', () => {
  const passed = { simulationEnabled: 1, 'Simulation Completed Date': '2026-11-10', 'Simulation Skipped Date': null };
  assert.equal(simulationSkipped(passed), false);
  assert.equal(wasSimulated(passed), true);
  assert.equal(simulationPassDate(passed), '2026-11-10');
});

test('an order without simulation is neither', () => {
  assert.equal(wasSimulated({ simulationEnabled: false }), false);
  assert.equal(simulationPassDate({ simulationEnabled: false }), null);
  assert.equal(simulationSkipped({ 'Simulation Skipped Date': '  ' }), false);
});
```

In `src/utils/determineStatus.test.js`:

```js
test('a skipped simulation order stays in Design Approval even with a 3D model date', () => {
  assert.equal(determineStatus({
    simulationEnabled: true, STATUS: 'PENDING FOR DESIGN APPROVAL',
    'Ordered date': '2026-11-01', 'Design Received Date': '2026-11-05',
    '3D Model Received Date': '2026-11-06', 'Simulation Skipped Date': '2026-11-07',
  }), 'PENDING FOR DESIGN APPROVAL');
});
```

- [ ] **Step 2: Run** `node --test src/utils/simulationState.test.js src/utils/determineStatus.test.js` — expect FAIL (module missing; status is `UNDER SIMULATION`).

- [ ] **Step 3: Create `src/utils/simulationState.js`** with the four functions above.

- [ ] **Step 4: `determineStatus`:** the simulation branch's `!orderData['Simulation Completed Date']` becomes `!simulationPassDate(orderData)`; extend the comment to say a skip passes it too.

- [ ] **Step 5: Stage-entry readers:** in the three `getStageEntryDate` copies replace `order['Simulation Completed Date']` with `simulationPassDate(order)`.

- [ ] **Step 6: Lead-time split:** `DashboardPage.jsx:55` uses `wasSimulated(o)`; `OverviewTab.jsx` `nonSimulation` filters `!wasSimulated(o)`. Remove a local `isSimulationEnabled` copy only where it becomes unused.

- [ ] **Step 7: Run** `npm test`, then `npx eslint` on the changed files — expect 0 failures and no new lint problems.

- [ ] **Step 8: Commit** `feat(simulation): treat a skipped simulation as not simulated in status, ageing and lead times`.

### Task 4: Skip action on the Simulation page and the drawer timeline

**Files:**
- Modify: `src/api.js` (`simulationAPI`)
- Create: `src/components/simulation/SkipSimulationDialog.jsx`
- Modify: `src/components/simulation/SimulationDetail.jsx`
- Modify: `src/pages/SimulationPage.jsx`
- Modify: `src/DieOrderingSystem.jsx` (drawer `stages` near line 1175, `stageNote` near 1195)
- Test: `src/api.test.js` if it covers `simulationAPI`; otherwise lint, build and the browser walk-through in Task 5

**Interfaces:**
- Consumes: `POST /simulation/:orderId/skip` (Task 1); `simulationSkipped` (Task 3).
- Produces: `simulationAPI.skip(orderId, reason)`; `<SkipSimulationDialog open dieNo busy onSkip(reason) onClose />`; `SimulationDetail` prop `onSkip`.

- [ ] **Step 1: `simulationAPI.skip`** — `POST /simulation/${orderId}/skip` with `{ reason }`.

- [ ] **Step 2: `SkipSimulationDialog`.** Use the project's `useDialog` hook as other dialogs do (see its use in `src/pages/FlowPage.jsx`) and the `sf-` classes the Simulation page already uses. Content: title `Skip simulation for <die no>`; one line "The order moves to Design Approval and stays marked Simulation required."; a required `<textarea>` labelled "Reason", `maxLength={500}`; buttons "Cancel" and "Skip simulation" (disabled while the trimmed reason is empty or `busy`). The reason state resets when the dialog opens.

- [ ] **Step 3: `SimulationDetail`:** a "Skip simulation" button (`sf-button sf-button-sm`) in `sf-pane-actions` beside "Open order", `disabled={busy}`, calling `onSkip`. Shown to every user, since the skip has the same access as recording a step.

- [ ] **Step 4: `SimulationPage`:** hold `skipOpen` state; `skip = (reason) => run(() => simulationAPI.skip(selected.order_id, reason), 'Simulation skipped — moved to Design Approval')`, closing the dialog when it resolves. `applyResult` already removes a die whose `stage` is null.

- [ ] **Step 5: Drawer timeline.** When `simulationSkipped(currentOrder)`: the simulation entries of `stages` become — `3D model received` only if that date is filled, then `{ field: 'Simulation Skipped Date', label: 'Simulation skipped' }` in place of "Simulation completed". `stageNote` for that field returns the reason, followed by ` · by <Simulation Skipped By>` when present.

- [ ] **Step 6: Run** `npm test`, `npx eslint` on the changed files, `npm run build` — expect all clean.

- [ ] **Step 7: Commit** `feat(simulation): add the Skip simulation action and show a skip on the order timeline`.

### Task 5: Verify end to end

- [ ] **Step 1:** `npm test` — 0 failures. Note separately whether the two Work Queue Postgres suites ran or skipped.
- [ ] **Step 2:** Browser walk-through on a scratch stack (not the user's data): create a test die with Simulation required, take it to Simulation, record "3D model received", skip with a reason. Check: it leaves the Simulation page; Design Approval lists it with days counted from the skip date; the drawer timeline shows "Simulation skipped" with reason and name; a drawer edit leaves it in Design Approval; the change log has `Simulation skipped: <reason>`; a Revision back to Simulation clears the skip. Delete the test die by its id.
- [ ] **Step 3:** Whole-branch review by a fresh reviewer; fix what it finds.
