# Design enhancement tracking — design

Date: 2026-11-15

## Intent

Some die orders are placed to fix a known problem with the existing dies of a
profile (poor die life, low productivity, low recovery). Today the app cannot
tell these orders apart from routine ones, and nothing records what the
situation was before the change, so nobody can later say whether the new design
actually worked.

This feature lets a user mark a die order as a **Design enhancement**, forces
the "before" picture to be recorded at that moment, carries an Enhancement tag
with the order through every stage, records the measured results when the die
is trialled, and stores a verdict: did the project achieve its goals or not.
The stored data feeds a period report and a monthly summary in Analytics.

## Goals

- Mark an order as a Design enhancement from the new-order form or the drawer.
- Require, at marking time: the current issue, die failure % of the existing
  dies, current productivity, current recovery, and a target for each number.
- Keep those values in the database unchanged for later comparison.
- Switch Simulation required on automatically.
- Show an "Enhancement" tag wherever the order appears.
- Force the die through trials on arrival and record productivity and recovery
  per trial.
- Store a trial verdict, and — only when the user asked for it — a later die
  failure % assessment and a final verdict.
- Produce a report of enhancement projects for a chosen period, and a monthly
  graph and summary in Analytics.

## Non-goals

- Calculating baseline or actual numbers from production data. The app holds no
  per-die failure %, productivity or recovery; every number is typed by a user.
- Changing how routine (non-enhancement) orders, trials or simulation behave.
- Enhancement tracking for Sample Followup rows that have no die order.
- Email notifications or scheduled sending of the report.

## Anti-goals

- A fabricated or defaulted number. A blank value stays blank and is shown as
  "not recorded"; it is never shown as 0.
- A baseline that can be quietly rewritten after results are known.
- A success rate that counts cancelled or still-open projects.

## How the relevant parts work today

- `die_orders.simulation_enabled` (INTEGER 0/1) is the Simulation flag. It is
  set in the drawer (`OrderDetailModal` in `src/DieOrderingSystem.jsx`) and by
  PDF import; the new-order form (`AddOrderModal`) has no switch for it.
  Skip simulation (`server/services/simulation.cjs`) exists and stays usable.
- Priority labels come from one shared component,
  `src/components/DieAttentionLabels.jsx`, used on Orders, Flow, In
  Manufacturing, Dashboard and the receipt dialog. The drawer header has its own
  pills.
- Trials are rows in `sample_trials` (`die_order_id` or `sample_followup_id`,
  `trial_no`, `trial_date`, `result` OK / Not OK, `fail_reason`, `comments`).
  Rules are in `server/services/sampleTrials.cjs`; the UI is
  `src/components/sample/TrialsSection.jsx` inside the Sample Followup detail.
- "Skip trial" at receipt is in `src/utils/dieReceivance.js` and
  `DieReceivanceModal.jsx` (Tooling and Backup dies only).
- Existing dies of a profile are found by profile number parsed from `die_no`
  (`server/services/dieNumber.cjs`, `server/services/jFileData.cjs`).
- Schema changes are idempotent SQL in `server/db.cjs`, mirrored in `init.sql`.
  Field changes are logged to `order_changes` through `insertChangeLog`.
- Order editing is gated by `canEditOrderDetails`
  (`server/services/orderDetailEdits.cjs`); admin checks use `adminMiddleware`.
- Analytics charts use recharts. A server-rendered report PDF already exists for
  supplier die life.

## Approaches

1. **Columns on `die_orders`.** Simplest to query, but adds about 20 columns to
   an already wide table and mixes project results into the order row.
2. **A flag on the order plus one enhancement record per order (chosen).** The
   flag keeps the tag and filters cheap everywhere; a separate table holds the
   baseline, targets, results and verdicts; trial rows get two number fields.
3. **A generic metrics table** (one row per metric with baseline, target,
   actual). Flexible for future measures but makes the report and graph harder
   for no present gain.

Approach 2 was chosen by Claude; the user left the how open.

## Decided by the user

- Marking an order requires the current issue, die failure % of existing dies,
  productivity and recovery (current values).
- Simulation is enabled automatically when an order is marked.
- A tag identifies the order as an Enhancement through every stage.
- The die must go through trials on arrival; results are recorded against the
  original values and the project is marked a success or a failure.
- The verdict is two-step — a trial verdict, then a later die failure %
  assessment — but only for projects where the user chose, when marking the
  order, that a die failure % assessment is required.
- A report of enhancement projects for a selected period.
- A monthly graph or summary on the Analytics page.

## Claude's calls (open to correction)

- **Targets.** A target is recorded beside each current value, because
  "achieved the goals" needs a goal. Targets for productivity and recovery are
  required; the failure % target is required only when the failure assessment
  is required.
- **Units.** Productivity in kg/h, recovery and failure in %.
- **Direction.** Productivity and recovery: higher is better. Failure %: lower
  is better. A target is met when the actual is equal to or better than it.
- **Suggested verdict.** The app suggests a verdict from the numbers (all
  targets met → Achieved; some → Partly achieved; none → Not achieved). The
  user confirms or overrides it and must add a remark when overriding.
- **Which trial counts.** The trial verdict uses the numbers of the latest
  trial with result OK. If the sample is rejected with no OK trial, the
  suggestion is Not achieved.
- **Life review date.** When the trial verdict is saved on a project that needs
  the failure assessment, the user sets a review due date, pre-filled to six
  months after the sample approval date. Due and overdue reviews appear in the
  Work Queue.
- **Report period.** A project belongs to a period by the date its final
  verdict was given ("completed"). The report also lists, separately, projects
  started in the period and projects still open at its end.
- **Report formats.** A PDF for sharing and an Excel file for working with the
  numbers.
- **Removing the flag.** Allowed, with a reason, until the first trial is
  recorded; after that, admins only. Removal is logged and deletes the record.
- **Baseline lock.** Baseline and targets can be edited by order editors until
  the die is received; after that, admins only. Every edit is logged.
- **When an order can be marked.** Any time before the die is received (status
  before DIE RECEIVED). After receipt, admins only, so that in-flight projects
  can still be brought in. If the order is already past the simulation stage
  (PENDING FOR DESIGN APPROVAL or later), marking sets the Enhancement flag but
  leaves Simulation required and the status as they are. A late-marked order
  whose trial was skipped or whose OK trials have no numbers simply has no
  trial numbers; an admin can add them to the trial rows.
- **Trials are enforced.** On an enhancement order, Sample Status cannot be set
  to Approved until at least one OK trial with productivity and recovery
  exists. The server rejects it with a clear message. Imports that would set
  Approved on such an order leave the status unchanged and report the row.
- **Rejected samples.** If the sample is Rejected, the trial verdict is final
  even when a failure assessment was required; there is no life review.
- **Verdict numbers are a snapshot.** Saving a verdict copies the trial numbers
  into the enhancement record. Later trial edits or new trials do not change a
  saved verdict; an admin can redo the verdict, which takes a fresh snapshot.
- **Missing numbers.** A suggested verdict counts only the targets that exist.
  Averages skip projects with a missing value; nothing is treated as zero.

## Data

**`die_orders`**: new column `design_enhancement INTEGER DEFAULT 0`, exposed to
the client as `designEnhancement` (boolean), the same way as
`simulation_enabled`.

**New table `design_enhancements`**, one row per marked order
(`die_order_id` unique, cascade on order delete):

| Group | Fields |
|---|---|
| Baseline | `current_issue` (text), `baseline_failure_pct`, `baseline_productivity_kgh`, `baseline_recovery_pct`, `reference_dies` (text, optional — which existing dies the numbers describe) |
| Targets | `target_failure_pct` (nullable), `target_productivity_kgh`, `target_recovery_pct` |
| Options | `failure_assessment_required` (boolean) |
| Trial result | `trial_productivity_kgh`, `trial_recovery_pct`, `trial_verdict`, `trial_verdict_remark`, `trial_verdict_by`, `trial_verdict_date`, `source_trial_id` |
| Life review | `life_review_due_date`, `actual_failure_pct`, `life_review_remark`, `life_review_by`, `life_review_date` |
| Final | `final_verdict`, `final_verdict_remark`, `final_verdict_by`, `final_verdict_date` |
| Audit | `created_by`, `created_at`, `updated_at` |

Verdict vocabulary: `Achieved`, `Partly achieved`, `Not achieved`.

**`sample_trials`**: two nullable columns, `productivity_kgh` and
`recovery_pct`. They are offered only for trials whose parent die order is an
enhancement, and are required there when the result is OK.

**Project state** is derived, not stored:

| State | Rule |
|---|---|
| Open | marked, no trial verdict yet |
| Awaiting life review | trial verdict given, failure assessment required, sample not Rejected, no final verdict |
| Completed | final verdict given |
| Cancelled | the order is CANCELLED |

When no failure assessment is required, saving the trial verdict also writes it
as the final verdict. When one is required, the final verdict is given at the
life review and is suggested from all three numbers together.

A design revision of the order does not reset the enhancement record.

## Workflow

1. **Mark.** A "Design enhancement" switch in the new-order form and in the
   drawer. Turning it on opens a form:

   ```
   Design enhancement
   Current issue            [ free text, required                    ]
   Existing dies referred   [ optional ]   Active dies of this profile: 1234-201, 1234-202
                              Current      Target
   Productivity (kg/h)      [        ]    [        ]
   Recovery (%)             [        ]    [        ]
   [x] Die failure % assessment required
   Die failure (%)          [        ]    [        ]
   ```

   The current failure % is always required; its target only when the box is
   ticked. Saving sets `design_enhancement = 1` and `simulation_enabled = 1` and
   logs both. The list of active dies is informational.

2. **Simulation.** The order follows the normal simulation path. Skip
   simulation still works with its reason. Turning Simulation required off on
   an enhancement order is not allowed while the flag is on.

3. **Tag.** An "Enhancement" label next to Top urgent / Special follow-up in
   `DieAttentionLabels`, in the drawer header pills, the Work Queue, the search
   palette and Sample Followup rows; a filter on the Orders page; a column in
   the Excel/CSV export and the backup.

4. **Receipt.** The Skip trial checkbox is hidden for enhancement orders, with
   a one-line note saying why.

5. **Trials.** In the Sample Followup trial entry, an enhancement die also asks
   for productivity and recovery. The trial list shows them beside the current
   and target values.

6. **Trial verdict.** A panel in the drawer and the Sample Followup detail
   shows current, target and actual for each number, the suggested verdict, and
   a save action. It becomes available once the sample is Approved or Rejected.
   If the failure assessment is required, saving asks for the review due date.

7. **Life review.** When due, the project appears in the Work Queue. The user
   enters the actual die failure % and a remark, and confirms the final verdict.

8. **Cancelled orders** show as Cancelled in every enhancement view and are
   left out of success rates.

## Permissions

- Marking, editing the baseline before receipt, and removing the flag before
  the first trial: users who can edit order details.
- Trial numbers and the trial verdict: users with access to the Sample Followup
  page (the existing gate for recording trials). Other users see the verdict
  panel in the drawer read-only.
- Life review and final verdict: the same users as the trial verdict.
- Baseline edits after receipt, flag removal after the first trial, and
  changing a saved verdict: admins only, with a reason, logged to
  `order_changes`.

## Report and Analytics

**Analytics → Enhancements** (a new section beside the existing ones, with the
same Year / period filter):

- Summary figures: projects started, completed, success rate (Achieved ÷
  completed), awaiting life review, open.
- Monthly chart: per month, bars for started and for completed split by
  verdict (Achieved / Partly achieved / Not achieved).
- Average change on completed projects: productivity, recovery and failure %,
  actual against baseline.
- A table of projects: die no, profile, supplier, current issue, baseline →
  target → actual for each number, verdict, state. Clicking a row opens the
  order drawer.

**Report.** From that section, "Enhancement report" takes a from/to date and
produces a PDF and an Excel file with the summary figures, the monthly chart
(PDF only) and the project table, in three groups: completed in the period,
started in the period, still open at the end of the period.

## Left to the builder

- Exact component split, endpoint names and SQL.
- How the PDF is rendered, following the existing supplier die-life report.
- Wording of validation messages and empty states.
- Test layout, following the existing `node:test` suites.
