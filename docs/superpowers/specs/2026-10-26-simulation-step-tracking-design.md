# Simulation step tracking — design

Date: 2026-10-26
Status: agreed with the user in chat; awaiting their review of this document.

## Why

Today the Simulation stage is a single button. "Simulation Complete" on the
Process Flow → Simulation tab stamps `3D Model Received Date` and moves the
order to Design Approval. Nothing records what actually happens in between, how
many rounds a die needed, or why a simulation failed.

The simulation engineer's real process is a loop, in the user's words:

> 3D model received from supplier → Preparation done → Simulation completed →
> Modification (internal or from supplier). For every revision the same cycle
> repeats until the results are okay and the design moves to Design Approval.

The user wants this tracked step by step, "similar to Sample Followup": a page
the simulation engineer works from, with a history of rounds per die and a
fixed list of failure reasons.

## Goals

- A dedicated Simulation worklist page, laid out like the Sample Followup page
  (summary strip, stage tabs, banded worklist, detail pane). Mockup option A,
  chosen by the user: `.superpowers/brainstorm/697-1793032893/content/simulation-layout.html`.
- Each die's simulation history is a list of **rounds**. Every round runs
  through the stages below, and ends with a result of OK or Not OK.
- A Not OK result records exactly one reason from a fixed list, and whether the
  fix is an **In-house** or **Supplier** modification.
- A Supplier modification goes through the **existing revision mechanism**, so the
  revision counter, the revision history and the supplier design-reminder emails
  keep working unchanged.
- Show what is late against the user's target: **simulation completed within 1
  day of the 3D model arriving**.

## Non-goals

- No change to how orders enter Simulation (the `simulationEnabled` toggle and
  the Awaiting Design → Simulation step stay as they are).
- No change to what the Daily Summary Report, the Dashboard, or Analytics show.
  The only code change there is pointing the Design Approval aging at the new
  `simulation_completed_date` column, so the figures stay the same.
- No supplier-facing emails from this page. The only supplier chasing is what the
  existing design reminder already does for Awaiting Design.
- No backfill of past rounds.

## Anti-goals (would make this a failure even if it works)

- **Invented numbers.** Existing dies must not get fabricated round history,
  dates, or "days" values (the no-fabricated-numbers rule used on QD Tracker and
  Sample Followup). A blank date stays blank and is shown as "—".
- **Breaking the revision workflow.** A supplier modification that bypasses
  `POST /orders/:id/revisions`, or that leaves the order in Simulation, would stop
  the revision counter and the reminder emails, which is the reason the user asked
  for the status change.
- **Lost history.** Rounds keep their own dates; nothing overwrites an earlier
  round.
- **Shifting existing timings.** Design Approval aging for simulation orders must
  keep counting from the day simulation passed, even though the column it reads
  today changes meaning (see "The 3D Model Received Date" below).

## The stages (user-confirmed)

A die in Simulation sits in exactly one of these stages. They are the page's tabs,
in this order:

| Stage (tab) | The die waits here until… | Action to move on |
|---|---|---|
| **Awaiting 3D model** | the supplier's 3D model arrives | *3D model received* (date) |
| **3D model received** | the engineer finishes preparation | *Preparation done* (date) |
| **Preparation done** | the simulation run finishes | *Simulation completed* (date) → result OK / Not OK |
| **In-house modification** | the team finishes changing the model in-house | *Modification done* (date) |

Transitions:

- **OK** → the order moves to `PENDING FOR DESIGN APPROVAL` and leaves this page.
- **Not OK + In-house** → the die moves to *In-house modification* in the same
  order status (`UNDER SIMULATION`). *Modification done* closes the round and opens
  the next round **at "3D model received"**: the in-house modified model goes
  straight to preparation (user-confirmed). The next round's model-received date is
  the modification-done date.
- **Not OK + Supplier** → a revision is created through the existing revision
  endpoint with target status `AWAITING FOR DESIGN`. The revision counter
  increments, and the design reminder chases the supplier as usual. The round is
  closed. When the user later clicks "Design Received" on Awaiting Design, the order
  comes back into Simulation as today, and a new round opens at **Awaiting 3D model**
  (user-confirmed). Usually the model comes with the design and the engineer clicks
  *3D model received* straight away, but sometimes it arrives later, which is why the
  stage exists.

The first round of a die opens at **Awaiting 3D model** when it enters Simulation.

The supplier revision's `notes` (required by the endpoint) should be prefilled from
the round: the failure reason plus the engineer's comment, editable before
submitting. *(My call.)*

## Not OK reasons (user-confirmed, fixed list)

1. Uneven exit velocity / flow imbalance
2. Extrusion pressure too high (exceeds press capacity)
3. Die deflection / stress too high
4. Weld seam quality
5. Exit temperature out of range
6. Profile dimension / shape deviation
7. Other

Exactly one reason per Not OK result, plus an optional free-text comment.
"Other" exists so new failures aren't misfiled. Same pattern as
`TRIAL_FAIL_REASONS` in `src/utils/constants.js`.

## Late rule (user target; application is my call)

- The user's target is **simulation completed within 1 day from the date the 3D
  model arrives**.
- A round is **late** when more than 1 **working day** has passed between its
  model-received date and its simulation-completed date. For an open round, that
  means between model-received and today. Sundays are not counted (user-confirmed).
  Use the Work Queue's working-day calendar (`server/services/workQueueCalendar.cjs`:
  Mon–Sat, holidays skipped) so this page and the Work Queue always agree on which
  dies are late. Holidays being skipped too is *my call*, following that calendar.
  Days-on-stage chips and the "model to result" average also count working days.
- Only the *3D model received* and *Preparation done* stages can be late.
  *Awaiting 3D model* and *In-house modification* rows show days waiting but are
  never flagged late. Waiting on the supplier isn't the engineer's delay.
- Every round has its own 1-day clock.
- Use `todayLocal()` / `localDay()` for "today". Never `new Date().toISOString()`;
  the guard test `src/utils/todayUsage.test.js` will fail on it.

## The page

Layout copies `src/pages/SampleFollowupPage.jsx` (classes `sf-*`, theme variables,
banded list, detail pane). It **replaces the current Simulation tab** in Process Flow
(`flow-simulation` in `PROCESS_FLOW_TABS`). Same sidebar entry, same page permission
key, so existing user permissions carry over.

- **Header:** title, a sentence like "x of y dies are past the 1-day simulation
  target", search (die, order no, profile, supplier), Export.
- **Summary strip:**
  - *Where the dies sit*: count per stage, with the late count on the two stages
    that can be late.
  - *Model to result*: average days from model-received to simulation-completed for
    rounds completed in the last 90 days, with the previous 90 days for comparison.
    "—" when there are none.
  - *Top Not OK reason* (last 90 days), "n of m Not OK rounds". Hidden or "—" when
    there are none.
  - Possibly *rounds to pass*. Leave out if it crowds the strip. *(Builder's call.)*
- **Filter bar:** stage tabs with counts (and late counts), Plant filter, Sort
  (most overdue first / newest / by plant).
- **Worklist rows:** die no, profile · supplier · round n, days-on-stage chip (red
  when late), banded like Sample Followup (late first).
- **Detail pane:** order facts at the top. Then every round, newest last, as a row of
  step boxes with dates. A skipped step is shown as skipped: rounds after an in-house
  modification have no "Awaiting 3D model" step. A finished round shows OK or
  Not OK + reason + modification type + comment. The open round shows the button for
  its next step. Each step's date defaults to today, can be back-dated, cannot be in
  the future (same control as Sample Followup's stamp-today buttons).
- **Admin delete:** admins can undo the most recent step entry of a die (to fix a
  mistake). Undoing must not touch revisions already created. If the last action
  created a supplier revision, undo is not offered for it. *(My call.)*
- **Export:** Excel with a *Dies* sheet (one row per die in Simulation, current
  stage, round, days, late) and a *Rounds* sheet (one row per round with all dates,
  result, reason, modification type, comment), using the same `exportToExcel` helper.

## Who can use it

Anyone with access to the `flow-simulation` page, which already includes the
Simulation Engineer role (`simulation_engineer` in `AddUserModal.jsx`). Recording
steps needs no further permission. *(My call; matches how Process Flow buttons work
today.)*

## Existing data (my call)

Dies already in `UNDER SIMULATION` when this ships start at **Round 1**:

- **First pass** (`design_revision_count` is 0) **and** `three_d_model_received_date`
  filled → stage *3D model received* from that date. The old button would have moved
  such a die out of Simulation, so a date on a die still in its first pass was typed
  in by hand and most likely is the real receipt.
- Otherwise → stage *Awaiting 3D model*, no dates. On a die back after a revision,
  the column holds the earlier pass's finish date, so using it would invent a
  receipt. The engineer clicks *3D model received* and back-dates it if needed.
  Days-on-stage for these rows counts from the date the order entered Simulation, as
  the current tab does (`Design Received Date`, or the latest revision's date).

*(My call.)*

Round 1 for these dies must be derivable **without writing rows at deploy time**
(compute it on read, or create the row lazily on the first action), so a deploy
doesn't stamp dates nobody entered.

## Related behaviour that must stay consistent

- **The old button goes.** The "Simulation Complete" action on the Simulation tab
  (`WORKFLOW_STEPS['UNDER SIMULATION']`, FlowPage `handleCompleteStep`) is replaced
  by the page above.

## The 3D Model Received Date (user decision)

Today, despite its name, the order column `three_d_model_received_date` is stamped
by the old "Simulation Complete" button, so it holds the day simulation finished.
The user decided it must hold the **actual 3D model received date**: on the order,
the **first** receipt.

- **Order column:** the *3D model received* action writes
  `three_d_model_received_date` the first time a die gets a model (write-once, the
  same rule as `planReceivedDate` in `server/services/stageCompletion.cjs`).
- **Later receipts:** a receipt in a round started by a supplier revision is also
  written to that revision's `order_revisions.model_received_date`, so Revision
  History's "3D model re-received" shows real receipts. Rounds started by an
  in-house modification write only the round.
- **New order column `simulation_completed_date`**, the date of the latest OK result.
  An OK result sets it and moves the order to Design Approval. Everything that today
  reads `3D Model Received Date` as "when Design Approval started" switches to this
  column: `getStageEntryDate` in `FlowPage.jsx`, `OrdersPage.jsx`, and
  `DieOrderingSystem.jsx` (~line 2718), and the Design Approval fallback in
  `server/services/dailySummaryData.cjs`. The Work Queue's `design_approval` anchor
  uses design-received dates, not this column. Check it and leave it if so. *Builder:
  grep every reader of the column (the list includes import modals, export,
  backup, `orderPresentation`, `orderDetailEdits`) and decide per site whether it means
  "model arrived" (keep) or "simulation done" (switch).*
- **Existing rows:** a one-time migration copies `three_d_model_received_date` into
  `simulation_completed_date` for simulation orders that are already past Simulation,
  so their Design Approval timings don't move. It leaves `three_d_model_received_date`
  as it is. The true receipt dates of old orders are unknown, and clearing them
  would lose data. Old orders therefore keep a finish date in that column. That is a
  known, accepted inaccuracy in historical data, not something to "fix" by guessing.
  *(My call.)*
- `determineStatus` in `DieOrderingSystem.jsx` keys `UNDER SIMULATION` on
  `3D Model Received Date`. With the new meaning, the drawer should treat a die as
  in Simulation when simulation is on and the design is received but there is no
  `simulation_completed_date`. Adjust it, and make sure a die in *Awaiting 3D model*
  isn't pushed to Design Approval by a drawer edit.
- Export and backup gain the new column; labels: "3D Model Received Date" (unchanged)
  and "Simulation Completed Date".

## Other related behaviour

- **Status changes made elsewhere.** `RevisionModal`, the drawer, and import can
  move an order into or out of `UNDER SIMULATION` without this page. Rounds must
  therefore follow the status, not drive it *(my call)*:
  - An order in `UNDER SIMULATION` whose latest round is closed (or that has no
    round) is shown at *Awaiting 3D model* in a new round. The row is created on the
    first action, so re-entry by any route (Design Received, a rejection at Design
    Approval sent back through RevisionModal, a manual status change) works the same.
  - An order that leaves `UNDER SIMULATION` any other way than an OK or Supplier
    result has its open round closed with no result and a note "left Simulation
    (status changed to X)", shown greyed in the history. It is not counted in any
    average or reason figure. This can be derived on read (status is not
    `UNDER SIMULATION`, latest round open), so the other routes need no new hooks;
    the round is formally closed the next time the die re-enters Simulation.
  - The generic revision button is not offered on the new page. *Not OK + Supplier*
    is the way to send a design back from Simulation. The Revision button in the
    drawer stays as it is.
- **Order drawer auto-status.** `determineStatus` in `src/DieOrderingSystem.jsx`
  only returns `UNDER SIMULATION` when `3D Model Received Date` is filled. A die
  sitting in *Awaiting 3D model* has no such date on round 1. Check that editing
  such an order in the drawer does not silently push it to Design Approval, and fix
  if it does.
- **Revision history modal** keeps showing supplier revisions exactly as now; the
  rounds are a separate record.
- **Work Queue** (`server/migrations/20260921_work_queue.sql`, stage `simulation`,
  `days: 2` in `server/services/workQueueStages.cjs`): change the Simulation queue
  item to the same rule. Target 1 day, anchored on the open round's model-received
  date, counted in the rule's working days, and only while the die is in *3D model
  received* or *Preparation done*.
  While in *Awaiting 3D model* or *In-house modification* there should be no overdue
  Simulation item. The work-queue stage function is SQL, so this needs a new
  migration that replaces it. *(My call, so both pages agree. The user approved the
  idea in chat.)* The days live in `work_queue_rules` (seeded 2, admin-editable): the
  migration changes the seed default to 1 and updates existing Simulation rule rows
  **only where they still hold the untouched default of 2**; a value an admin chose is
  left alone. *(My call.)*

## Data (builder's call, with constraints)

A natural shape is one `simulation_rounds` table, one row per round:
`order_id`, `round_no`, `started_from` (`initial` | `supplier` | `in_house`),
`revision_id` (nullable, the revision that started it), the four step dates,
`result`, `fail_reason`, `modification` (`In-house` | `Supplier`), `comments`,
`created_by`/`created_by_name`, timestamps. The current stage is derived from the
latest round, not stored separately.

Constraints whatever the shape: dates are Postgres `DATE` columns (the repo reads
them as raw `YYYY-MM-DD` strings, `server/db.cjs` type parser 1082). Step dates
within a round must not go backwards. `fail_reason` is required when and only
when `result = 'Not OK'`. Creating a supplier revision and closing the round
happen in one transaction.

## Left to the builder

- Exact API routes and file split. Follow the Sample Followup trials pattern
  (`sampleTrialsAPI`, `TrialsSection.jsx`) and keep view rules in a tested
  `src/utils/simulationView.js` like `sampleFollowupView.js`.
- Whether the summary strip shows "rounds to pass".
- Tests with `node:test`, as elsewhere in the repo.

## Calls I made (for the user to check)

1. Late is only counted on *3D model received* and *Preparation done*, in working
   days on the Work Queue calendar (so public holidays are skipped as well as Sundays).
2. Work Queue's Simulation reminder moves to the same 1-working-day rule from model
   received. The default changes from 2 to 1, but a value an admin already set is kept.
3. Existing dies in Simulation: a first-pass die with a 3D model date starts at
   *3D model received*; everything else starts at *Awaiting 3D model*. No history
   invented.
4. A new `simulation_completed_date` keeps Design Approval timings right. Old orders
   keep their existing 3D-model date, which really is a finish date, because the true
   receipt date is unknown.
5. In-house modification is its own stage, and the next round's model-received date
   is the modification-done date.
6. Supplier revision notes are prefilled from the failure reason and comment.
7. Admins can undo the last step, except a step that created a supplier revision.
8. If the status changes outside this page, rounds follow it. The generic Revision
   button is not on the new page.
9. The page replaces the current Simulation tab and keeps its permission key.
