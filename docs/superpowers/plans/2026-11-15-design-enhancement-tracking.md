# Design Enhancement Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a die order be marked as a Design enhancement with a recorded baseline and targets, carry a tag through every stage, record trial numbers and verdicts, and report the projects by period.

**Architecture:** A 0/1 flag on `die_orders` drives the tag and filters. One row per marked order in a new `design_enhancements` table holds baseline, targets, snapshot results and verdicts. All rules (validation, suggested verdict, project state, period summary) live in pure functions in one server service and one client util, each unit-tested; routes and components stay thin.

**Tech Stack:** Node/Express (`.cjs`), PostgreSQL via `pg`, React + Vite, recharts, `node:test` (`npm test`), existing server PDF rendering (`supplierReportPdf.cjs`) and Excel export (`src/utils/exportExcel.js`).

**Spec:** `docs/superpowers/specs/2026-11-15-design-enhancement-tracking-design.md` — read it first; this plan does not repeat its rules in full.

## Global Constraints

- Verdict vocabulary, stored verbatim: `Achieved`, `Partly achieved`, `Not achieved`.
- Units: productivity kg/h, recovery %, failure %. Column suffixes `_kgh`, `_pct`.
- Direction: productivity and recovery higher is better; failure % lower is better; a target is met when the actual is equal to or better.
- A blank number is `null`, shown as "not recorded". Never 0, never defaulted.
- Averages and suggested verdicts skip missing values and missing targets.
- Cancelled orders are excluded from every success rate.
- Schema changes are idempotent SQL in `server/db.cjs` (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) and mirrored in `init.sql`.
- Every admin override and every flag/baseline change writes a row to `order_changes` through `insertChangeLog` (`server/routes/orders.cjs`).
- UI wording: the tag reads "Enhancement"; the switch reads "Design enhancement".
- Tests are `node:test`, co-located (`*.test.cjs` on the server, `*.test.js` in `src/utils`). Route tests use `server/routes/testSupport.cjs` (`installFakeDb`, `listen`, `request`).
- Work on a feature branch `feat/design-enhancement`, not on `main`.

## Review Focus

1. An order marked after it is past simulation (status PENDING FOR DESIGN APPROVAL or later): the flag is set, `simulation_enabled` and status are untouched. (Task 2)
2. A project with no failure assessment: the failure target is `null` and must not count as an unmet target. (Task 1)
3. A Rejected sample on a project that requires the failure assessment: trial verdict becomes final, no life-review item appears. (Tasks 1, 4, 7)
4. A trial edited or added after a verdict was saved: the saved verdict numbers do not change. (Task 4)
5. A decimal typed with a comma or as text (`"12,5"`, `"abc"`), a negative number, or a percentage above 100: rejected with a message, never stored as 0. (Task 1)

---

### Task 1: Schema and the rules module

**Files:**
- Modify: `server/db.cjs` (next to the simulation skip columns, ~line 1538), `init.sql`
- Create: `server/services/designEnhancement.cjs`
- Test: `server/services/designEnhancement.test.cjs`

**Interfaces — Produces:**
- `VERDICTS: string[]`
- `validateBaseline(input) -> { ok: true, value } | { ok: false, error }` — `value` keys: `current_issue`, `reference_dies`, `baseline_failure_pct`, `baseline_productivity_kgh`, `baseline_recovery_pct`, `target_failure_pct`, `target_productivity_kgh`, `target_recovery_pct`, `failure_assessment_required`
- `suggestVerdict({ targets, actuals }) -> 'Achieved' | 'Partly achieved' | 'Not achieved' | null` — `targets`/`actuals` are `{ failure, productivity, recovery }`, any value may be `null`; `null` result when no target has an actual
- `projectState(row, order) -> 'Open' | 'Awaiting life review' | 'Completed' | 'Cancelled'` — `order` needs `status` and `sample_status`
- `needsLifeReview(row, order) -> boolean`

- [ ] **Step 1: Write the failing tests**

```js
test('baseline requires issue, three current values and two targets', () => {
  assert.equal(validateBaseline({}).ok, false);
  const ok = validateBaseline({ current_issue: 'Die cracks at bridge', baseline_failure_pct: 19,
    baseline_productivity_kgh: 850, baseline_recovery_pct: 78.5,
    target_productivity_kgh: 950, target_recovery_pct: 82, failure_assessment_required: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.target_failure_pct, null);
});
test('failure target is required only when the assessment is required', () => {
  const base = { current_issue: 'x', baseline_failure_pct: 19, baseline_productivity_kgh: 850,
    baseline_recovery_pct: 78, target_productivity_kgh: 950, target_recovery_pct: 82 };
  assert.equal(validateBaseline({ ...base, failure_assessment_required: true }).ok, false);
  assert.equal(validateBaseline({ ...base, failure_assessment_required: true, target_failure_pct: 10 }).ok, true);
});
test('bad numbers are rejected, never stored as 0', () => {
  for (const bad of ['abc', '12,5', -1, '']) {
    assert.equal(validateBaseline({ current_issue: 'x', baseline_failure_pct: bad,
      baseline_productivity_kgh: 850, baseline_recovery_pct: 78,
      target_productivity_kgh: 950, target_recovery_pct: 82 }).ok, false);
  }
  // percentages above 100 are rejected; kg/h has no upper bound
});
test('suggested verdict counts only targets that exist', () => {
  const t = { failure: null, productivity: 950, recovery: 82 };
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: 950, recovery: 83 } }), 'Achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: 900, recovery: 83 } }), 'Partly achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: 900, recovery: 80 } }), 'Not achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: null, productivity: null, recovery: null } }), null);
});
test('failure % is met when the actual is lower or equal', () => {
  const t = { failure: 10, productivity: null, recovery: null };
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: 10 } }), 'Achieved');
  assert.equal(suggestVerdict({ targets: t, actuals: { failure: 12 } }), 'Not achieved');
});
test('project state', () => {
  const o = { status: 'DIE RECEIVED', sample_status: 'Approved' };
  assert.equal(projectState({}, o), 'Open');
  assert.equal(projectState({ trial_verdict: 'Achieved', failure_assessment_required: true }, o), 'Awaiting life review');
  assert.equal(projectState({ trial_verdict: 'Achieved', final_verdict: 'Achieved' }, o), 'Completed');
  assert.equal(projectState({}, { status: 'CANCELLED' }), 'Cancelled');
  assert.equal(needsLifeReview({ trial_verdict: 'Not achieved', failure_assessment_required: true },
    { status: 'DIE RECEIVED', sample_status: 'Rejected' }), false);
});
```

- [ ] **Step 2: Run** `node --test server/services/designEnhancement.test.cjs` — expected: FAIL, module not found.
- [ ] **Step 3: Implement the module** with the signatures above. Number parsing accepts a JS number or a plain decimal string with a dot; anything else is an error naming the field.
- [ ] **Step 4: Add the schema** to `server/db.cjs` and `init.sql`:
  - `die_orders.design_enhancement INTEGER DEFAULT 0`
  - `sample_trials.productivity_kgh NUMERIC`, `sample_trials.recovery_pct NUMERIC`
  - table `design_enhancements` with exactly the fields in the spec's Data table; `id SERIAL PRIMARY KEY`, `die_order_id INTEGER NOT NULL UNIQUE REFERENCES die_orders(id) ON DELETE CASCADE`, numbers `NUMERIC`, dates `DATE`, `source_trial_id INTEGER` (no FK, a snapshot pointer), `created_at`/`updated_at TIMESTAMPTZ DEFAULT now()`.
- [ ] **Step 5: Run** `npm test` — expected: all pass.
- [ ] **Step 6: Commit** `feat(enhancement): add the enhancement tables and verdict rules`

---

### Task 2: Mark, edit and remove an enhancement

**Files:**
- Create: `server/routes/design-enhancements.cjs`, `server/routes/design-enhancements.test.cjs`
- Modify: `server/index.cjs` (mount `app.use('/api/design-enhancements', authMiddleware, router)`), `server/services/orderPresentation.cjs` (+ its test), `server/services/orderDetailEdits.cjs`, `server/routes/orders.cjs`

**Interfaces:**
- Consumes: `validateBaseline`, `canEditOrderDetails(user)`, `insertChangeLog`
- Produces:
  - `GET /api/design-enhancements` → `{ enhancements: [...] }` (all rows, snake_case columns plus `die_order_id`)
  - `PUT /api/design-enhancements/order/:orderId` body = baseline fields, plus `reason` when the caller is using an admin-only path → `{ enhancement }`. Creates on first call, updates after.
  - `DELETE /api/design-enhancements/order/:orderId` body `{ reason }`
  - `presentOrder` adds `designEnhancement: boolean`

**Rules to implement (spec "Claude's calls"):**
- Create: order editors while status is before `DIE RECEIVED`; admins after. Sets `design_enhancement = 1`. Sets `simulation_enabled = 1` only when the status is one of `PENDING FOR ORDERING`, `AWAITING FOR DESIGN`, `UNDER SIMULATION`; otherwise leaves it and the status untouched.
- Update baseline/targets: order editors before `DIE RECEIVED`; admins after, `reason` required.
- Delete: order editors while the order has no `sample_trials` row; admins after, `reason` required. Sets `design_enhancement = 0`; does not change `simulation_enabled`.
- In `orderDetailEdits.cjs` / the orders PATCH and PUT paths: reject turning `simulation_enabled` off while `design_enhancement = 1` (400, "Simulation is required on a Design enhancement order").
- `POST /api/orders` accepts an optional `enhancement` object: validated with `validateBaseline`, inserted in the same transaction as the order.

- [ ] **Step 1: Write failing route tests** (fake db records the SQL): editor can mark an `AWAITING FOR DESIGN` order and the update sets both flags; marking a `PENDING FOR PR` order does not touch `simulation_enabled`; a non-editor gets 403; an editor marking a `DIE RECEIVED` order gets 403 and an admin succeeds; an invalid baseline returns 400 with the rule's message; delete with an existing trial is 403 for an editor; an admin baseline edit after receipt without `reason` is 400; each success writes a change-log row; a design revision of the order (`server/services/orderRevisions.cjs`) leaves `design_enhancement` and the enhancement row untouched.
- [ ] **Step 2: Run** `node --test server/routes/design-enhancements.test.cjs` — FAIL.
- [ ] **Step 3: Implement** the router, the mount, `presentOrder`, the simulation-off guard and the create-with-order path.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(enhancement): mark, edit and remove a Design enhancement on an order`

---

### Task 3: Trial numbers and the Approved gate

**Files:**
- Modify: `server/services/sampleTrials.cjs` (+ test), `server/routes/sample-trials.cjs`, `server/routes/orders.cjs` (+ `orders.test.cjs`)

**Interfaces — Produces:**
- `validateTrial(input, today, { enhancement: boolean })` — when `enhancement` is true and `result === 'OK'`, `productivity_kgh` and `recovery_pct` are required (same number rules as Task 1); when false, both are stored as `null` and ignored. `value` gains both keys.
- `createTrial` / `updateTrial` look up whether the parent die order has `design_enhancement = 1` and pass it through. A trial whose parent is a standalone sample followup is never an enhancement trial.
- `hasMeasuredOkTrial(pool, orderId) -> Promise<boolean>`
- Orders PATCH and PUT: setting `Sample Status` to `Approved` on an order with `design_enhancement = 1` and no measured OK trial returns 400 `"Record an OK trial with productivity and recovery before approving an enhancement die"`. Bulk/import paths that would do the same skip the status change for that row and include the die number in the response's skipped list.

- [ ] **Step 1: Write failing tests**: OK enhancement trial without numbers fails; with numbers passes and returns them; Not OK enhancement trial needs no numbers; a routine trial drops any numbers sent; PATCH Approved without a measured OK trial is 400; with one it succeeds; a routine order is unaffected.
- [ ] **Step 2: Run** the two test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(enhancement): record productivity and recovery per trial and require a measured trial before approval`

---

### Task 4: Verdicts and the life review

**Files:**
- Modify: `server/routes/design-enhancements.cjs` (+ test), `server/services/designEnhancement.cjs` (+ test)

**Interfaces:**
- Consumes: `suggestVerdict`, `needsLifeReview`, `pageAccessMiddleware` from `server/routes/auth.cjs`
- Produces:
  - `latestOkTrial(trials) -> trial | null` (highest `trial_no` with result OK)
  - `defaultReviewDate(sampleApprovalDate) -> 'YYYY-MM-DD' | null` (six calendar months later)
  - `GET /api/design-enhancements/order/:orderId/suggestion` → `{ stage: 'trial' | 'final', suggested, actuals, targets, defaultReviewDate }`
  - `POST /api/design-enhancements/order/:orderId/trial-verdict` body `{ verdict, remark, life_review_due_date }`
  - `POST /api/design-enhancements/order/:orderId/life-review` body `{ actual_failure_pct, remark, verdict }`
  - Both POSTs sit behind `pageAccessMiddleware('flow-sample-followup')`.

**Rules:**
- Trial verdict is allowed only when `sample_status` is `Approved` or `Rejected`. It snapshots `trial_productivity_kgh`, `trial_recovery_pct` and `source_trial_id` from `latestOkTrial` (all `null` when there is none).
- `remark` is required when `verdict` differs from the suggestion.
- When `needsLifeReview` is true, `life_review_due_date` is required and no final verdict is written. Otherwise the same verdict, remark, user and date are written as the final verdict.
- Life review requires a valid `actual_failure_pct`; the final suggestion uses all three targets against the snapshot numbers plus the actual failure %.
- Once a verdict exists, repeating the POST is admin-only with `reason`, logged, and takes a fresh snapshot.

- [ ] **Step 1: Write failing tests** for each rule above, plus: after a trial verdict is saved, updating the source trial's numbers through `PUT /api/sample-trials/:id` leaves `trial_productivity_kgh` unchanged; a Rejected sample with the assessment required writes the final verdict immediately; `defaultReviewDate('2026-08-31')` is `'2027-02-28'`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(enhancement): save the trial verdict, the life review and the final verdict`

---

### Task 5: Mark form and the tag everywhere

**Files:**
- Create: `src/utils/designEnhancement.js` (+ `.test.js`), `src/components/orders/EnhancementForm.jsx`
- Modify: `src/DieOrderingSystem.jsx` (`AddOrderModal` ~line 565, `OrderDetailModal` header pills ~1408 and the Simulation toggle ~1602), `src/components/DieAttentionLabels.jsx`, `src/pages/OrdersPage.jsx` (filters ~74), `src/components/search/` palette row, `src/components/work-queue/` row, `src/pages/SampleFollowupPage.jsx` row, `src/utils/orderExport.js` (+ test), `server/routes/export.cjs`, `server/services/autoBackup.cjs`, `server/routes/search.cjs`

**Interfaces — Produces (client util, mirrors the server rules):**
- `isEnhancement(order) -> boolean`
- `validateBaselineForm(form) -> { ok, errors: { [field]: message } }`
- `suggestVerdict`, `projectState` with the same signatures and results as Task 1
- `canMarkEnhancement(order, user) -> boolean`, `canEditBaseline(order, user) -> boolean`, `canRemoveEnhancement(order, user, trialCount) -> boolean`
- `<EnhancementForm value onChange errors activeDies theme />` — the layout in the spec's Workflow step 1; the failure target field is shown only when the assessment box is ticked.

- [ ] **Step 1: Write failing util tests** mirroring Task 1's cases, plus the three permission helpers (editor before receipt, admin after, removal blocked once `trialCount > 0` for non-admins), and an `orderExport` test that the column `Design Enhancement` exports `Yes`/`No`.
- [ ] **Step 2: Run** `node --test src/utils/designEnhancement.test.js src/utils/orderExport.test.js` — FAIL.
- [ ] **Step 3: Implement the util and the export column.**
- [ ] **Step 4: Build the UI.** New-order form: a "Design enhancement" switch that reveals `EnhancementForm`; the order is sent with `enhancement`. Drawer: the same switch opening the form in a dialog (PUT), a read-only baseline block once saved, an edit action gated by `canEditBaseline`, a remove action with a reason; the Simulation required toggle is disabled with the note "Required on a Design enhancement order" while the flag is on. Active dies of the profile come from the existing per-profile data used by the new-die-order prefill (`server/services/jFileData.cjs`). Add the "Enhancement" label to `DieAttentionLabels` and the drawer header, palette, Work Queue and Sample Followup rows; add an Orders filter "Enhancement only"; carry the flag in export, backup and search results.
- [ ] **Step 5: Run** `npm test` and `npm run lint` — PASS.
- [ ] **Step 6: Verify in the browser** on the scratch stack: mark a new order, confirm Simulation is on and locked, the tag shows on Orders, Flow, Dashboard and the palette, and the filter narrows the list.
- [ ] **Step 7: Commit** `feat(enhancement): mark an order from the form or drawer and show the Enhancement tag`

---

### Task 6: Receipt, trial entry and the verdict panel

**Files:**
- Modify: `src/utils/dieReceivance.js` (+ test), `src/components/modals/DieReceivanceModal.jsx`, `src/components/sample/TrialsSection.jsx`, `src/components/sample/SampleFollowupDetail.jsx`, `src/DieOrderingSystem.jsx` (drawer)
- Create: `src/components/orders/EnhancementResultPanel.jsx`

**Interfaces:**
- Consumes: Task 4 endpoints, `isEnhancement`, `suggestVerdict`
- Produces: `skipTrialAllowed(type, order)` — false when `isEnhancement(order)`; `<EnhancementResultPanel order enhancement trials canRecord theme onSaved />`

- [ ] **Step 1: Write failing tests**: `skipTrialAllowed('T', { designEnhancement: true })` is false; `buildReceivancePatch` ignores `skipTrial: true` for an enhancement order.
- [ ] **Step 2: Run** `node --test src/utils/dieReceivance.test.js` — FAIL.
- [ ] **Step 3: Implement the util change**; in the receipt dialog hide the checkbox and show "Trials are required on a Design enhancement die".
- [ ] **Step 4: Trial entry.** For an enhancement die, `TrialsSection` shows Productivity (kg/h) and Recovery (%) inputs, required when the result is OK, and two extra columns in the trial list with the current and target values shown above the list. Keep the inputs controlled from local draft state (the uncontrolled-input trap in this component is known).
- [ ] **Step 5: Result panel.** A table of Current / Target / Actual for the three numbers ("not recorded" for blanks), the suggested verdict, a verdict selector, a remark (required on override), the review due date when a life review is needed, and — in the Awaiting life review state — the actual failure % entry and final verdict. Read-only when `canRecord` is false. Show it in the drawer and the Sample Followup detail. A blocked approval (Task 3) surfaces the server message next to the status control.
- [ ] **Step 6: Run** `npm test`, `npm run lint` — PASS. **Verify in the browser:** receive an enhancement die (no skip option), record a Not OK then an OK trial with numbers, approve, save the trial verdict, then enter the life review.
- [ ] **Step 7: Commit** `feat(enhancement): require trials, capture trial numbers and record the project verdict`

---

### Task 7: Life review in the Work Queue

**Files:**
- Modify: `server/services/workQueueStages.cjs`, `server/services/workQueueSync.cjs` (+ test), the stage seed in `server/migrations/` / `server/services/workQueueExtraSchema.cjs` that mirrors `STAGES`

**Interfaces — Produces:** stage `{ key: 'enhancement_life_review', label: 'Enhancement Life Review', days: null, page: 'flow-sample-followup' }`; the item's due date is `life_review_due_date`.

- [ ] **Step 1: Write failing sync tests**: an order whose enhancement `needsLifeReview` and has no final verdict produces one item due on `life_review_due_date`; saving the final verdict closes it; a Rejected sample or a cancelled order produces none.
- [ ] **Step 2: Run** `node --test server/services/workQueueSync.test.cjs` — FAIL.
- [ ] **Step 3: Implement**, following how the existing date-driven stages are projected in `workQueueSync.cjs`; keep the SQL seed and `STAGES` in step.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(enhancement): raise the die failure review in the Work Queue when it falls due`

---

### Task 8: Analytics — Enhancements tab

**Files:**
- Create: `server/services/enhancementSummary.cjs` (+ test), `server/routes/enhancement-summary.cjs`, `src/pages/analytics/EnhancementsTab.jsx`
- Modify: `server/index.cjs` (mount `/api/enhancement-summary` with `authMiddleware, pageAccessMiddleware('analytics')`), `src/pages/AnalyticsPage.jsx` (new tab id `enhancements`, label "Enhancements")

**Interfaces — Produces:**
- `summarise(rows, { from, to }) -> { totals, months, averages, completed, started, open }` where `rows` are enhancement rows joined with their order (`die_no`, `supplier`, `status`, `sample_status`), and
  - `totals = { started, completed, achieved, partly, notAchieved, successRate, awaitingLifeReview, open }` — `successRate` is `achieved / completed`, `null` when `completed` is 0
  - `months = [{ month: 'YYYY-MM', started, achieved, partly, notAchieved }]`, one entry per month from `from` to `to`, zeros included
  - `averages = { productivity, recovery, failure }`, each `{ baseline, actual, change, count }` over completed projects that have both values
  - `completed` = final verdict date in the period; `started` = `created_at` in the period; `open` = no final verdict at `to` and not cancelled
- `GET /api/enhancement-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` → the object above; defaults to the current year.

- [ ] **Step 1: Write failing tests** for `summarise`: a cancelled project counts in no total; a project completed in March counts in March by `final_verdict_date`, not by `created_at`; `successRate` is `null` with nothing completed; averages skip a project with a `null` actual and report the right `count`; `months` has twelve entries for a full year including empty ones.
- [ ] **Step 2: Run** `node --test server/services/enhancementSummary.test.cjs` — FAIL.
- [ ] **Step 3: Implement** the service and route (model on `simulationSummary.cjs` and `simulation-summary.cjs`).
- [ ] **Step 4: Build the tab** (model on `SimulationSummaryTab.jsx`): `MetricCard`s for the totals, a recharts stacked bar chart per month (started as its own bar; completed stacked by verdict, each series labelled in a legend), the average-change row, and the project table from the spec; a row click opens the order drawer. Uses the page's existing Year filter plus a from/to override.
- [ ] **Step 5: Run** `npm test`, `npm run lint` — PASS. **Verify in the browser** with at least one project in each state.
- [ ] **Step 6: Commit** `feat(enhancement): add the Enhancements summary and monthly chart to Analytics`

---

### Task 9: Enhancement report (PDF and Excel)

**Files:**
- Create: `server/services/enhancementReportPdf.cjs` (+ test), `src/utils/enhancementReport.js` (+ test)
- Modify: `server/routes/enhancement-summary.cjs`, `src/pages/analytics/EnhancementsTab.jsx`

**Interfaces:**
- Consumes: `summarise` output (one builder feeds the screen, the PDF and the Excel file)
- Produces:
  - `generateEnhancementReportPdf(summary, { from, to, logo }) -> Promise<Buffer>`
  - `POST /api/enhancement-summary/pdf` body `{ from, to }` → `application/pdf`, filename `Enhancement-Report-<from>-to-<to>.pdf`
  - `buildEnhancementSheets(summary) -> [{ name, rows }]` with sheets `Summary`, `Completed`, `Started`, `Open`

- [ ] **Step 1: Write failing tests**: the PDF buffer starts with `%PDF` and renders with an empty period (all three groups empty, text "No enhancement projects in this period"); `buildEnhancementSheets` returns four sheets, blank numbers are empty cells not 0, and the Completed sheet has one row per completed project with baseline, target, actual and verdict columns.
- [ ] **Step 2: Run** both test files — FAIL.
- [ ] **Step 3: Implement**, reusing the page furniture, branding and text sanitising of `supplierReportPdf.cjs` and the workbook writer in `src/utils/exportExcel.js`. The PDF holds the summary figures, the monthly chart and the three grouped tables.
- [ ] **Step 4: Add** "Enhancement report" to the tab: from/to pickers and PDF / Excel buttons.
- [ ] **Step 5: Run** `npm test`, `npm run lint`, `npm run build` — PASS. **Verify** by downloading both files for a period with data and opening them.
- [ ] **Step 6: Commit** `feat(enhancement): export the enhancement report as PDF and Excel`

---

## After the last task

Run `npm test`, `npm run lint` and `npm run build` on the branch, then request a whole-branch review before merging to `main`. Deploying needs no manual step beyond the usual restart: the schema is added on boot.
