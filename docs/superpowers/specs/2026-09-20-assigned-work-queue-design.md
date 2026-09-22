# Assigned work queue and stage deadlines

Date: 20 September 2026  
Status: proposed feature for review; not implemented  
Related: [review pack](../../assigned-work-queue-review.md), [interactive mockup](../../mockups/assigned-work-queue.html), [implementation plan](../plans/2026-09-20-assigned-work-queue.md)

## 1. Purpose

Give every actionable order, sample and quality stage a clear next action, an accountable owner and an explainable deadline. A user opens Work queue and can immediately see what they need to do today, what is already late and what cannot proceed because an owner or date is missing.

The queue is a view of existing business workflows with additional coordination data. Completing an item means completing the underlying workflow action. Assignment must never confer authority to approve a design or QD.

### Example

A supplier design arrives on Friday 18 September. The order enters Design approval. A rule assigns Aisha and sets the deadline to Saturday 19 September at 17:00 using a one-working-day target and a Monday–Saturday calendar. On Monday 21 September the item is overdue. Aisha opens it, sees the drawing and revision history through the existing form, and performs the approval there. The approval completes that occurrence and creates the Pending PR occurrence with its own owner and deadline.

Changing Aisha to Omar would not restart the timer. Returning the design for revision creates a new occurrence of the appropriate design stage while preserving the earlier occurrence and its outcome.

## 2. What exists today

| Existing capability | Relevant code | Opportunity |
|---|---|---|
| Order stages and completion actions | [FlowPage.jsx](../../../src/pages/FlowPage.jsx), [constants.js](../../../src/utils/constants.js) | Add ownership and explicit targets without creating a second workflow. |
| Stage age badges | FlowPage.jsx, getStageEntryDate / DaysBadge | Current age coloring uses a fixed threshold; expose deadline state separately from elapsed age. |
| Sample followup and trial results | [SampleFollowupPage.jsx](../../../src/pages/SampleFollowupPage.jsx), [sampleTrials.cjs](../../../server/services/sampleTrials.cjs) | Both order-backed and standalone records need accountable submission/approval work. |
| Personal QD approval and send-back queues | [useQdQueue.js](../../../src/hooks/useQdQueue.js), [qualityDiscrepancies.cjs](../../../server/services/qualityDiscrepancies.cjs) | Integrate their existing ownership and eligibility rules. |
| Design chasing, FOC chasing and daily reports | server/services/designReminder.cjs, focReminder.cjs, dailySummary.cjs | Add internal coordination and escalation without duplicate supplier emails. |
| Users with page access and four roles | server/routes/auth.cjs, server/routes/users.cjs | Add a scoped coordination capability, not an assumed existing manager role. |

## 3. Outcomes and scope

The completed feature provides:

- A Work queue entry in navigation with My work, Team and Unassigned views.
- A named owner or an explicitly unassigned state for every current supported work item.
- Configurable stage targets, working calendars, holidays and cutoff times by plant.
- Consistent deadline states in the queue, item detail and selected existing workflow views.
- Assignment, notes, pause/resume, deadline override and history for eligible coordination tasks.
- Internal reminders and escalation with delivery history and retry support.
- A current-item backfill and a pilot rollout that does not create historical reminder floods.

Delivery is phased. Release A covers order and sample stages with in-app coordination. Release B adds QD adapters and durable internal reminders/escalations. The full feature includes both; the initial pilot is not represented as the whole feature being complete.

### Excluded from this feature

General project task creation, trial slot scheduling, production capacity planning, supplier accounts, predictive ETAs, performance-based employee ranking, automatic approvals, automatic purchasing, recurring arbitrary tasks and mobile offline operation. Hour-level SLA arithmetic is deferred; version one uses explicit dates and whole-day targets.

## 4. Users and permissions

| Actor | Can do |
|---|---|
| Ordinary authenticated user with Work queue access | View items whose underlying records they may already view; see My work; add a note to their own eligible item; snooze their own reminder; follow permitted source actions. |
| Queue coordinator | Above, plus assign/reassign, pause/resume and override calculated deadlines for eligible items in explicitly granted plant scopes. |
| Administrator | Configure queue access, plant coordination grants, calendars, rules, backfill and notification rollout; access retains existing admin semantics. |
| QD approver or returned-QD author | Receive the same approval/rework items they receive today; act through the existing QD checks. |

Queue coordinator is a new capability attached to a user, not a fifth role. The current roles remain admin, user, die_designer and simulation_engineer. The existing application does not have general plant-level data isolation. A plant coordination grant restricts coordination mutations; it must not silently redefine existing record visibility or grant visibility by itself.

The work-queue page grant is necessary but insufficient to read a source record. Search, counts, exports if later added, notifications, item details and assignee choices apply the same source access filters server-side. A user who loses access stops seeing the item immediately on the next authenticated request. Assignment must never bypass QD approver eligibility or other source action checks.

Eligible assignee choices expose only an ID, display name and eligibility explanation. They do not expose the admin users endpoint, private profile data or email configuration. Correctors are currently a separate master list; do not assume a corrector name identifies a login account. Default owners must be explicitly selected from eligible application users.

## 5. Work item model

A work item is one occurrence of one stage on one source record. It contains:

- Source kind and persistent source ID, stage key and occurrence number.
- Plant, die/profile reference and the source title needed for navigation.
- Owner and assignment origin: rule, manual or source-derived.
- Stage entry date/time, recorded-at time and entry evidence: direct event, imported milestone, inferred history or unknown.
- Deadline policy snapshot, baseline due date, effective due date and local timezone/cutoff.
- Work state: active, paused, completed, cancelled or superseded.
- Deadline state, computed for the current time; first breach time retained after later changes.
- Revision number for concurrent edits and append-only activity records.

An order can have historical occurrences, but only one active or paused occurrence for its current order/sample lane. A QD is a separate source and can remain active alongside the related order. FOC round identity is included so replacement round two does not reuse round one's task.

No queue operation directly sets a source status to complete. Source mutation and corresponding queue transitions must succeed together.

## 6. Stage coverage and suggested starting targets

These are proposed setup values, not approved service commitments. Review them per plant before activating reminders. Internal task owners remain accountable for following up even when the next response is due from a supplier or customer.

| Stage / work item | Opens when | Completes when | Suggested target |
|---|---|---|---|
| Pending order | Order enters PENDING FOR ORDERING | Order is placed through existing action | 1 working day |
| Awaiting design | Order enters AWAITING FOR DESIGN | Design receipt is recorded | 3 working days |
| Simulation | Order enters UNDER SIMULATION | Required 3D/simulation receipt completes | 2 working days |
| Design approval | Order enters PENDING FOR DESIGN APPROVAL | Approval is recorded or revision is requested | 1 working day |
| Pending PR | Order enters PENDING FOR PR | PR completion is recorded | 1 working day |
| Oracle entry | Order enters PENDING FOR ORACLE ENTRY | Oracle entry is recorded | 1 working day |
| Design to EMS | Order enters PENDING FOR DESIGN TO EMS | Sending to EMS is recorded | 1 working day |
| Manufacturing / receipt followup | Order enters DONE without a die receipt date | Die receipt is recorded | Explicit supplier ETA |
| Sample submission | Die has been received and sample still needs submission | Submission, approval or valid trial exemption is recorded | 7 working days |
| Sample approval | Sample submitted and not approved/exempt | Approval or explicit supported return to another stage | 3 working days |
| QD approval | QD is submitted to Pending approval | Approved or sent back through QD actions | 2 working days |
| QD returned for correction | QD enters SentBack | Author resubmits through the QD workflow | 2 working days |
| FOC replacement receipt | A current FOC round awaits physical receipt | Receipt for that round is recorded | Explicit round ETA |
| FOC trial followup | Replacement received and current round untrialled | Trial result advances the round | 3 working days |

Rules are resolved by exact plant + stage, then an explicitly configured global fallback. If neither exists, show Needs setup; do not choose an arbitrary duration. Default owner is resolved from the same rule and validated at task creation. An unavailable or ineligible default owner leaves the item Unassigned with the reason visible.

### Samples

Both sample data sources are in scope: fields on die_orders and standalone sample_followups. Their database IDs must remain distinct, including when the die/profile text happens to match. A standalone record with only a profile shows that profile and a source badge rather than an invented die number.

Approved and valid Not required records create no current sample work. The existing skip-trial rules for Tooling/Backup remain authoritative. Recording a failed trial changes trial history, not sample stage or deadline. A Rejected sample remains actionable with an explanation on its current occurrence; rejection alone must not reset the deadline. A supported explicit resubmission/return action may create a new occurrence, with both events retained. Unknown or contradictory sample data is surfaced for reconciliation.

### Quality discrepancies

Pending approval uses assigned_approver; SentBack uses created_by. Those owners are read-only in the work queue. My work membership must match existing isInApprovalQueue and isSentBackToMe behavior, rather than using an admin's broader ability to act as a definition of personal work.

Legacy Pending QDs without a named approver may appear in eligible approvers' My work and in Unassigned. They carry a visible “Eligible approver queue” explanation. Team counts count the source occurrence once, not once per eligible approver.

Unsubmitted QD drafts stay in the existing Drafts view. Closed/Rejected/Reference QDs create no open FOC work. FOC history and its current round decide which receipt/trial task is active; top-level status text alone is insufficient. A failed FOC trial can open the next replacement round only when the existing workflow actually records it.

## 7. Deadline rules

### Plant calendar

Each calendar has an IANA timezone, working weekdays, excluded dates, a local deadline cutoff and a version. The review examples use Monday–Saturday, Asia/Dubai and 17:00. These assumptions remain configurable and are not approved plant policy.

Targets are positive whole numbers. “Working days” excludes nonworking weekdays and configured holidays. “Calendar days” counts every date. At least one working weekday is required for a working-day rule. Holiday descriptions are entered by the administrator; no public holiday calendar is assumed automatically.

### Calculation

1. Determine the stage's local entry date from a valid source event or an explicitly identified backfill milestone.
2. Do not count the entry date, even when the entry occurred early in the morning or on a nonworking date.
3. Advance by the configured number of eligible dates.
4. Apply the plant's local cutoff on the resulting date and store the resolved UTC timestamp plus its local basis.

Example: entry Monday 21 September, three working days, Mon–Sat calendar gives Thursday 24 September at 17:00. Excluding Wednesday 23 September moves it to Friday 25 September. This example closure is fictional. A calendar-day rule remains due Thursday 24 September.

The deadline is overdue only when current time is later than due_at; equality is still on time. Date-only source milestones are legitimate for whole-day targets. Do not invent an entry time from midnight UTC or rely on a browser's timezone.

Supplier ETA deadlines use the explicitly promised local calendar date at cutoff. If it falls on a nonworking date, retain the promise and label “Outside working calendar”; do not silently roll it forward. ETA changes come through the source workflow and are audited in the work item.

### Baseline, changes and historical accuracy

The policy/calendar version and initial due date are snapshotted for each occurrence. Editing a rule applies only to future occurrences. Reassignment, notes, urgency changes, retrying an API request and ordinary field edits do not restart an occurrence.

A coordinator can override a calculated deadline with a reason. Show original and revised dates, actor and reason. Earlier breaches remain recorded. A bulk policy application to open items requires an impact preview showing old/new deadlines and affected records, followed by an explicit reason; source-linked ETAs are excluded.

Correcting a source milestone prompts an explicit deadline review; ordinary reconciliation does not silently erase an override or historical breach. A revision/re-entry is a new occurrence, not an edit to old history. Unknown or invalid legacy dates produce Needs setup; the feature never labels an item on time merely because it lacks a usable date.

## 8. Waiting, pause and snooze

| Action | Changes deadline? | Effect |
|---|---|---|
| Add “Waiting for supplier/customer/press” note | No | Records the dependency and next follow-up. Item remains active. |
| Reassign | No | Transfers accountability with an audit entry. |
| Snooze my reminder | No | Defers this user's personal reminder. Does not hide the item, clear overdue, or silence coordinator escalation. |
| Pause | Can affect future whole-day credit | Coordinator-only, reason required, displayed in Paused and history. |
| Override due date | Yes | Coordinator-only for calculated deadlines, reason required; baseline retained. |

Version one pauses use whole-day accounting. A complete eligible date strictly after the pause-start local date and strictly before the resume local date may be credited. Neither boundary date is credited. Same-day pause/resume adds zero. Overlapping pause intervals must never double-count a date. On resume, show a preview of credited dates and the resulting effective deadline; an explicit ETA is never shifted by a pause.

A breach before pause stays recorded, and pause cannot make an already-late historical occurrence count as on time. If the source enters HOLD/On hold, pause its existing occurrence and retain its prior stage. A legacy hold with no reliable prior stage goes to Needs setup. Removing a queue pause must not override an underlying source hold.

## 9. Queue interaction design

### Navigation and scopes

Work queue sits near Dashboard and Orders. My work is the default. Team means all source-authorized items available to the viewer, not every record in the company. Unassigned shows actionable items without a valid owner. Administrators can coordinate through Team without all team items appearing in their personal queue.

Queue scope counts apply source authorization. Deadline bucket counts also apply current search/plant/stage filters, but ignore the currently selected deadline bucket so users can compare categories. Displayed rows apply all filters. Return counts and rows using a consistent query snapshot.

### Deadline buckets

| Bucket | Meaning |
|---|---|
| Overdue | Active, valid deadline earlier than current time. |
| Due today | Active, due on current plant-local date and not yet overdue. |
| Upcoming | Active, valid future local due date. |
| Needs setup | Missing usable stage entry, rule/calendar, required ETA or irreconcilable source data. |
| Paused | Currently paused. Show earlier breach as a separate label where applicable. |

Unassigned is orthogonal: an unassigned item can still be overdue. Pause takes display precedence; data issues remain visible on the item even if paused. Completed/cancelled/superseded items appear in history, outside the default active buckets.

Columns: die/profile and plant; next action and source; owner; deadline state and local date; Open. Optional filters include supplier, stage, owner and urgency. The initial version needs search, plant, scope and deadline bucket. Default sort: overdue, due today, needs setup, upcoming, paused; within each, due date ascending, urgency descending, stable ID.

### Work item detail

Show source reference, stage occurrence, owner, deadline basis, current/original due dates, waiting note, pause state, and activity. The primary action opens the existing source form. Coordination actions are secondary and rendered only when permitted. A reason is required for deadline changes and pause/resume. After a concurrent edit, reload current values and let the user review their intended change rather than overwriting another person's work.

Use a side drawer on wide app screens; an expanded detail region or full-width panel is appropriate for narrower screens. The embedded mockup uses the expanded region to keep fields readable. Closing restores focus to the originating item. Source navigation uses a stable source kind and ID, including for standalone samples, and must open a specific record even when it is outside the initially loaded 5,000 orders.

### Settings

Administration includes plant calendars, rule targets/default owners, escalation contacts, queue coordination grants and rollout controls. Show a calculation preview before saving rules. Calendar/rule changes visibly state whether they apply only to future entries. Missing contacts or invalid owners appear as setup warnings; a failed email is not shown as a successful notification.

## 10. Notifications and escalation

Proposed defaults: owner reminder on the due date at 08:00 local; coordinator escalation at 08:00 on the next working date after a breach. If a due date is nonworking, schedule its owner reminder on the preceding working date. Catch up a missed reminder once after downtime, unless the item is already closed, access has changed, a newer occurrence superseded it or the reminder is no longer relevant.

One escalation level is sufficient for version one. After the first escalation, include continued overdue items in one daily coordinator digest rather than sending repeated per-item emails. Assignment changes notify the new owner once. No automatic supplier message is added by this feature; existing design and FOC chasing keep responsibility for supplier communication.

Use a persistent delivery record keyed by occurrence, deadline revision, recipient, channel and notification type. Internal in-app notifications can be deduplicated exactly. Email uses retries and at-least-once delivery; an ambiguous SMTP outcome can still produce a duplicate and must not be advertised as exactly-once.

When integrating existing alerts, migrate one alert type at a time. Do not count a QD once through the old personal queue and again through the new queue badge. Existing daily stage summaries remain valid; optionally add a compact overdue/unassigned work section after the new data is proven.

## 11. Backfill and rollout

1. Add schema and rules with notifications disabled.
2. Preview current work for one plant; report unknown statuses, missing dates, mismatched plant names and ineligible owners.
3. Use documented stage-entry evidence. Do not reconstruct a complete event history from current statuses or treat all old tasks as created today.
4. Create only current actionable occurrences, marking inferred/imported dates. Record the backfill batch and suppress event-driven email for it.
5. Review counts against orders, standalone samples and existing QD queues. Rerunning the backfill must not create duplicates.
6. Enable in-app queue for the pilot, then internal notifications with an administrator-selected go-live time. Send one reviewed backlog digest rather than historical alerts individually.
7. Expand to other plants after the pilot gates pass. Rollback hides the new UI and disables its worker; it does not revert source workflow changes or delete history.

## 12. Acceptance criteria

| ID | Acceptance condition |
|---|---|
| AC-01 | A supported source stage transition creates exactly one current occurrence and completes/supersedes the previous one transactionally. |
| AC-02 | Retried writes, import reruns and reconciliation do not duplicate items or assignment notifications. |
| AC-03 | My work, Team, Unassigned, search and counts reveal no records outside the viewer's existing source access. |
| AC-04 | Assignment grants no approval authority; QD personal membership matches existing named/legacy approver and author rules. |
| AC-05 | Reassignment retains deadline and history; removing an owner or their source access exposes the item for reassignment. |
| AC-06 | Whole working-day, calendar-day, timezone, cutoff and holiday examples pass boundary tests, including a DST-observing timezone. |
| AC-07 | Missing/invalid dates, absent rules and missing ETAs remain visibly unresolved, not falsely green. |
| AC-08 | Rule edits leave existing occurrences unchanged; recalculation and overrides preserve the baseline and require a reason. |
| AC-09 | Pause credit counts only eligible full dates and never erases an earlier breach; snooze/waiting do not change deadlines. |
| AC-10 | Both sample source types, valid trial exemptions, revisions, cancellation, hold, rejection and FOC round changes behave as specified. |
| AC-11 | Two simultaneous editors cannot silently overwrite assignment/deadline changes. |
| AC-12 | Queue pages and item links work beyond 5,000 source records; counts come from the database. |
| AC-13 | Notifications survive worker restart, suppress obsolete deliveries and expose delivery failures without undoing source actions. |
| AC-14 | The UI supports keyboard navigation, labeled fields, focus return, readable status labels and a narrow layout. |
| AC-15 | Pilot backfill is repeatable, auditable and free of automatic historical email floods. |

## 13. Measuring usefulness

Establish a pilot baseline before setting numeric goals. Track the proportion of actionable items with valid owners/deadlines, time spent unassigned, overdue open-item age, on-time completion by stage, and escalation delivery failures. Separate imported/inferred entries from observed new events. Report initial-baseline and revised-deadline performance separately so deadline extensions cannot inflate the on-time result.

Use these measures to improve stage rules and workload distribution. They are not an employee ranking system.

## 14. Decisions to settle during implementation

Working week and closure dates per plant; target durations; default owners and backups; which users receive coordination grants; reminder times and recipients; pilot plant; exact source permissions required for each action. These are configuration decisions. The mockup uses explicit proposed values so review can proceed without treating assumptions as authorization to enable production notifications.
