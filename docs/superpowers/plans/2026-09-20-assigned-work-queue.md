# Assigned work queue — implementation plan

Date: 20 September 2026  
Status: implementation-ready proposal; no application changes made  
Product contract: [feature description](../specs/2026-09-20-assigned-work-queue-design.md)  
Review: [review pack](../../assigned-work-queue-review.md), [interactive mockup](../../mockups/assigned-work-queue.html)

## 1. Delivery approach

Build a persistent coordination layer around the current workflows. The source record owns stage transitions; the queue owns assignment, deadline snapshots, pauses, notes and delivery history. Both must be synchronized in one database transaction. A reconciler repairs omissions and reports inconsistencies; it is not the normal source of stage events.

Release A delivers calendars/rules, order and sample synchronization, a server-paginated queue and an in-app pilot. Release B adds QD ownership/FOC adapters, durable internal reminders/escalations and old-alert cutover. Do not enable production notifications before backfill and pilot review.

Retain React, Express, PostgreSQL and the existing deployment shape. New behavior belongs in small services, route modules, hooks and components. Do not place the feature inside the 3,360-line DieOrderingSystem component beyond routing and shared refresh wiring.

## 2. Current integration map

| Area | Existing code to inspect/modify | Why |
|---|---|---|
| App routing and data ownership | src/DieOrderingSystem.jsx, src/components/layout/Sidebar.jsx, src/utils/constants.js | Add Work queue, source deep-link dispatch and small integration props. |
| Queue client | src/api.js, src/hooks/useQdQueue.js | Add a distinct workQueueAPI; prevent duplicate QD polling/counting during cutover. |
| Order transitions | server/routes/orders.cjs: POST, PATCH, PUT, DELETE, revisions, complete-stage | All write paths must synchronize work; received-date revision semantics must survive. |
| Order stage UI | src/pages/FlowPage.jsx, src/pages/OrdersPage.jsx | Source actions remain here; surface owner/deadline badges without deriving timers independently. |
| Sample sources | server/routes/sample-followups.cjs, server/routes/sample-trials.cjs, src/pages/SampleFollowupPage.jsx | Two parent types; trial result changes do not themselves change sample status. |
| Historical sample importer | server/scripts/import-sample-followup-sheet.cjs, server/services/sampleFollowupImport.cjs | Script updates die_orders directly and must not bypass queue synchronization. |
| QD actions | server/routes/quality-discrepancies.cjs, server/services/qualityDiscrepancies.cjs, qdFocRounds.cjs, qdSettings.cjs | Reuse named approvers, author rework, round semantics and existing action guards. |
| QD import / undo | server/services/qdImport.cjs, server/scripts/import-qd-sheet.cjs | Repeated historical data and removed imports must not leave live tasks. |
| Authentication and user changes | server/routes/auth.cjs, server/routes/users.cjs | Current permissions are read from DB per request; add page ID/grants and handle user deletion/access changes. |
| Settings and scheduler | src/pages/SettingsPage.jsx, server/index.cjs, server/db.cjs | Add rule/calendar setup and a stoppable scheduled worker. |
| Existing reminders | designReminder.cjs, focReminder.cjs, dailySummary.cjs; TopBar.jsx | Preserve supplier chasers and reconcile overlapping internal badges/reminders. |

Order imports currently reach normal order writes through frontend import logic; verify all call chains in usePIImport, PDFImportModal and DieOrderingSystem. Do not assume a bulk-order endpoint exists. The existing-data die-master/production imports replace snapshot tables; those imported-row IDs are not queue sources.

## 3. Domain modules to introduce

| Proposed file | Responsibility |
|---|---|
| server/services/workQueueStages.cjs | Enumerate supported stages, source adapters, stage prerequisites and source action descriptors. |
| server/services/workQueueCalendar.cjs | Strict local-date validation, whole-day arithmetic and pause-credit calculations; no database initialization side effects. |
| server/services/workQueueDeadlines.cjs | Resolve policy/calendar version, timestamp cutoff, baseline/override/ETA rules and classification. |
| server/services/workQueuePermissions.cjs | Source read eligibility, assignee eligibility, coordinator grants and action capabilities. |
| server/services/workQueueSync.cjs | Transaction-bound transitions, occurrence identity, source tombstones and reconciliation. |
| server/services/workQueueRepository.cjs | Parameterized list/detail/count queries and optimistic coordination mutations. |
| server/services/workQueueNotifications.cjs | Durable notification creation, claiming, retries and delivery status. |
| server/routes/work-queue.cjs | Authenticated queue, item, directory, notes and coordination endpoints. |
| server/routes/work-queue-settings.cjs | Admin calendars/rules/grants, validation and impact previews. |
| server/scripts/backfill-work-queue.cjs | Dry-run reports and resumable current-item backfill. |
| server/scripts/reconcile-work-queue.cjs | Dry-run or repair mode for missing/stale source associations. |

Services accept a transaction client and injected clock where needed. Pure stage/calendar functions must be importable in node:test without opening PostgreSQL connections. Keep the frontend stage labels aligned through a contract test; do not import React modules into the backend.

## 4. Schema design

Use additive, versioned SQL applied through the current database initialization/migration-marker mechanism. Keep schema changes in a dedicated server/migrations/20260920_work_queue.sql file and a small loader so the new schema is not another large inline block in db.cjs. Confirm fresh-install and existing-install paths both apply it once.

### Proposed tables

| Table | Key fields and constraints |
|---|---|
| work_queue_grants | user_id FK; nullable plant_id FK meaning all plants; can_manage boolean; actor/time. Explicit uniqueness for both global and plant-specific grants. No grant replaces source permissions. |
| work_calendars | Stable calendar ID and name; plant binding. |
| work_calendar_versions | calendar_id, version, IANA timezone, weekday array, excluded dates with labels, cutoff local time, created_by/at; immutable after activation. |
| work_stage_rules | Rule identity: plant_id nullable for global fallback and stage_key; active version reference. Explicit global uniqueness, since NULL does not behave like a normal equality value in a unique key. |
| work_rule_versions | rule_id, version, duration_days, day_mode, deadline_basis (duration/eta), calendar_version_id, default_owner_id, escalation_owner_id, notification settings, actor/time; immutable. |
| work_subjects | subject_kind, original_source_id, one live FK to die_orders/sample_followups/quality_discrepancies, source snapshot, deleted_at; UNIQUE(subject_kind, original_source_id). |
| work_items | subject_id FK, stage_key, occurrence_no, source_transition_key, optional FOC round reference/original round ID, owner_id FK nullable, owner_mode, lifecycle_state, entered_local_date, entered_at nullable, entry_evidence, recorded_at, rule/calendar snapshot, baseline_due_at, effective_due_at, deadline_revision, first_breached_at, completed_at, closed_reason, row_version. |
| work_item_events | item_id FK, kind, actor_id nullable, actor/source snapshot, before/after JSON, reason, recorded_at, effective_date nullable, event_key unique. Append-only from the application. |
| work_item_pauses | item_id FK, started_at, resumed_at nullable, reason, credited_local_dates, actor; one open pause per item. |
| work_item_snoozes | item_id FK, user_id FK, until_at; UNIQUE(item_id,user_id). Personal reminder only. |
| work_notification_outbox | item_id FK, occurrence/deadline revision, recipient ID, channel, kind, digest date nullable, available_at, lease fields, attempts, delivery state, provider result/message ID, delivered_at, unique deduplication key. |
| work_queue_runs | backfill/reconcile/worker run ID, plant scope, mode, cutoff, counters, error summary, start/end times. |
| work_queue_rollout | plant scope and explicit switches for UI/source synchronization/notification types, notification_go_live_at. Default notifications off. |

Live work_subjects must have exactly one non-null source FK matching subject_kind. Use ON DELETE RESTRICT so a forgotten delete integration fails rather than creating dangling work. The supported source-delete transaction first closes outstanding items, records a source-deleted event, preserves an authorized snapshot, clears the live FK and marks the subject tombstoned, then performs the source delete. A tombstoned subject may have zero live FKs; a live one may not. Existing deleted source history must be accessed through separately authorized history, never included in normal live-source counts.

Use a partial unique index on subject_id for active/paused work items in version one. Each supported subject has one actionable lane at a time: an order progresses into its sample stages, and a QD progresses through approval/rework/FOC states. Related orders and QDs have separate subjects. Preserve historical occurrences with UNIQUE(subject_id, occurrence_no); enforce source_transition_key uniqueness per subject.

For optional round/user references, retain original IDs/display snapshots before clearing a deleted reference. Do not cascade-delete audit history. Removing a user or access entitlement makes their current non-derived tasks unassigned through an audited synchronization path; QD-derived ownership follows its source semantics and surfaces missing-owner setup instead of inventing an approver.

### Indexes and query constraints

- Active item indexes on owner_id + effective_due_at + id and subject/plant + stage + effective_due_at + id.
- Source FKs and subject kind/original ID lookup indexes.
- Events by item_id + recorded_at + id; active pauses by item_id.
- Outbox by state + available_at, with unique notification deduplication key.
- Rule lookup by plant and stage. Calendar/rule versions referenced by tasks are immutable.
- Validate duration bounds, enum values, local dates, source-kind/FK correspondence and nonnegative attempts in the database as well as the API.

## 5. Time and deadline contract

Implement the feature description's exact whole-day semantics, with a clock passed into classifiers and tests. Separate local dates from instants. Date arithmetic operates on strict YYYY-MM-DD values and weekdays, not subtraction of 24-hour timestamp intervals across DST changes.

Resolve a named plant timezone and local cutoff to a UTC instant through a dedicated helper, using PostgreSQL timezone support or a deliberately selected timezone implementation. Round-trip validate the local date/time. For a nonexistent or ambiguous cutoff on a DST transition, return a setup exception rather than silently choosing an offset; document the supported resolution policy before permitting such rules. Ordinary 17:00 cutoffs in Dubai have no such ambiguity.

Baseline due_at is immutable. Effective due_at can change by an audited coordinator override, a validated source ETA change, an explicit source-date correction review, or eligible pause credit. Record deadline_revision for each effective deadline change; notifications bind to that revision. First breach must be derivable/recordable when a late item closes even if the periodic worker was down at the breach time.

Pause calculation takes the union of eligible full local dates strictly between pause and resume boundaries. Preserve the original policy/calendar snapshot. Exclude date-only partial boundaries; same-day credit is zero. Resuming an already-overdue item does not remove its earlier breach. ETA-driven tasks retain the supplier promise regardless of pause.

Keep source effective dates and recorded-at timestamps separately. Historic/imported dates may describe when business activity happened, but do not fabricate precise event times. Separate observed live-event performance from inferred historical performance in metrics.

## 6. Source adapters and transition safety

### Transaction sequence

For each source mutation:

1. Authenticate, load current permissions and authorize the source action.
2. Begin a transaction and lock the source row before reading its effective current state.
3. Apply the existing source validation and mutation, including revision/approval/FOC invariants.
4. Resolve before/after actionable stage with the adapter. Record a stable transition key only when the business occurrence changes.
5. Complete, cancel or supersede the old item and create the new occurrence as needed; copy the selected policy snapshot and eligible owner.
6. Append activity and notification intents in the same transaction. Historical import/backfill context suppresses notification intents.
7. Commit, return source result and queue refresh metadata; send mail asynchronously after commit.

Pass the same client through nested services. Do not open another transaction inside a source transaction or run synchronization on the global pool while the source write is uncommitted. A queue failure must roll back the participating source mutation when synchronization is enabled; otherwise the promised atomicity does not exist. Feature-off legacy writes remain supported for rollback, and catch-up reconciliation runs before re-enabling synchronization.

### Mutation coverage checklist

| Path | Required handling |
|---|---|
| Order POST | Create its current supported stage only; missing/bad prerequisites become setup issues. |
| Order PATCH / PUT | Lock/read before state; detect stage/date/ETA/sample changes; ordinary edits do not reopen tasks. Require expected source version for newly introduced workflow-changing calls, or revalidate expected stage under the lock. |
| Order revision POST | New occurrence even when returning to a previously visited stage; use revision number/event identity. Preserve first-received milestone semantics. |
| Order complete-stage PATCH | Honor initial receipt versus revision re-receipt, then synchronize the actual resulting stage. |
| Order receipt / valid trial exemption | Close manufacturing, create only the applicable sample stage; Approved/Not required leaves no sample item. |
| Order cancellation / deletion | Close current tasks and obsolete pending notifications; deletion uses the subject tombstone sequence. |
| Standalone sample POST/PUT/DELETE | Same source adapter contract, without colliding with order IDs. No inferred die number for profile-only records. |
| Sample trial writes/deletes | Refresh displayed context if useful; do not reset the parent deadline because a trial failed or was edited. |
| Sample import script | Use the same transaction client for its direct die_orders updates and synchronize changed source IDs with import context. |
| QD submit/approve/send-back | Preserve requireApprover, named approver, creator ownership, immutable approved document and source transition checks. |
| QD detail/status/FOC trial updates | Re-evaluate effective round and prerequisite approval state, not just top-level status. |
| QD import/undo and sheet script | No task for terminal/reference imports; create only current applicable work; undo tombstones the subject. |
| User deletion/access change | Re-evaluate current ownership and pending deliveries, without changing source approval authority. |
| Existing-data imports | No tasks linked to replaceable die-master/production rows. |

Source hold preserves the current stage item and pauses it. Unknown legacy prior stage is a setup condition. Removal of queue pause is rejected while source hold remains. Rejected sample requires explicit source state handling; a failed trial result is never treated as a rejection transition. If a source permits an explicit re-entry/resubmission without changing its visible stage label, add an occurrence event to that action rather than inferring it from an updated_at timestamp.

## 7. Authorization design

Extract a reusable current-page-access predicate from auth.cjs or move it to a small shared authorization module; keep existing behavior and its legacy process-flow alias. Add work-queue to CONTROLLABLE_PAGES, PAGE_TITLES and the server VALID_PAGE_IDS list. Admin/full-access behavior remains consistent with existing code.

For a queue read, require Work queue access AND existing source-record access. For a coordination mutation, also require ownership for permitted personal actions or an admin/coordinator grant covering the subject's plant. A coordination grant does not permit viewing a source record or performing its workflow action by itself. Return item capability flags from the server; UI hiding is not authorization.

For approval items reuse both QD eligibility and assigned-approver checks. My work uses listMyQueue-equivalent membership; an admin's power to intervene does not put everyone else's approvals in their personal work. SentBack remains tied to created_by. Legacy null approvers remain visible to eligible approvers and count once in Team/Unassigned.

Assignee lookup must not use usersAPI.getAll from the user-facing queue. Introduce a minimal directory endpoint filtered by stage/action eligibility. Current corrector master names do not map automatically to user accounts. Validate defaults at creation and reassignment, and validate recipients again just before notification delivery.

## 8. API contract

All proposed endpoints are under /api/work-queue and return structured validation errors. Register literal paths before parameterized item paths. Use parameters for all filters and allowlist sortable fields.

| Method / path | Contract |
|---|---|
| GET /items | scope=mine/team/unassigned; optional plantId, stage, bucket, ownerId, urgency, q; limit default50/max100; opaque cursor. Return items, counts, asOf, nextCursor and capabilities. |
| GET /items/:id | Item snapshot, source action descriptor, deadline basis, current capability flags and recent history. Return 404 for nonexistent/inaccessible item. |
| GET /items/:id/events | Authorized cursor-paginated history. |
| GET /assignees | subjectId/stage-scoped minimal eligible users. |
| POST /items/:id/assignment | ownerId nullable, expectedVersion, requestId; returns current item/version. No source-derived owner changes. |
| POST /items/:id/notes | note, expectedVersion, requestId; trimmed/length-limited. |
| POST /items/:id/deadline | dueLocalDate, reason, expectedVersion, requestId; cutoff/timezone from snapshot; duration-based items only. |
| POST /items/:id/pause | reason, expectedVersion, requestId. |
| POST /items/:id/resume-preview | Returns pause credit and proposed due date, bound to current version and clock. |
| POST /items/:id/resume | reason, preview token, expectedVersion, requestId; revalidate before commit. |
| POST /items/:id/snooze | untilAt, expectedVersion, requestId; caller's personal reminder only, bounded future time. |
| GET/POST /settings/calendars | Admin calendar/version listing and validated version creation. |
| GET/POST /settings/rules | Admin rule/version listing and validated version creation; default future-only. |
| GET/PUT /settings/grants | Admin coordination grants, audit before/after. |
| POST /settings/recalculate-preview | Rule version + filter; returns affected item IDs/versions and old/new deadlines, exclusions and immutable preview token. |
| POST /settings/recalculate-apply | Preview token + reason + requestId; reject stale items/changed policies rather than applying to a different set. |

There is deliberately no generic POST /complete. A source action descriptor contains an allowlisted source kind, ID, target tab and action name. The client opens the current source screen; source endpoints still perform completion and authorization.

### Example list item

```json
{
  "id": 1042,
  "version": 3,
  "source": { "kind": "order", "id": 184, "label": "DO-260184" },
  "stage": "design_approval",
  "occurrence": 2,
  "plant": { "id": 1, "name": "GEX 1" },
  "dieNo": "30601-201",
  "owner": { "id": 7, "displayName": "Aisha Rahman", "mode": "rule" },
  "deadline": {
    "baselineAt": "2026-09-19T13:00:00Z",
    "effectiveAt": "2026-09-19T13:00:00Z",
    "localDate": "2026-09-19",
    "timezone": "Asia/Dubai",
    "state": "overdue",
    "basis": "working_days",
    "targetDays": 1,
    "calendarVersion": 1,
    "revision": 1
  },
  "capabilities": { "assign": true, "overrideDeadline": true, "pause": true, "openSource": true },
  "sourceAction": { "tab": "flow-design-approval", "kind": "order", "id": 184 }
}
```

Counts must use an authorized base query, not client-loaded order arrays. Compute list rows, scope totals and bucket totals in a consistent query/transaction snapshot. Cursor ordering includes bucket rank, due date, urgency and item ID, with the classification asOf included in the cursor. Validate cursor/filter compatibility; reapply current authorization on every request. Advertise that live modifications can move items between pages and provide a refresh action.

Coordination mutations use UPDATE ... WHERE id = ... AND row_version = expectedVersion under a transaction. Zero affected rows after authorization returns 409 with a safe refresh hint. Store successful request IDs with the event result so retries return the prior result rather than duplicating a note or assignment notice. A stale bulk-recalculation preview returns an explicit conflict list; it must not partially recalculate silently.

## 9. Frontend decomposition

| Proposed file | UI responsibility |
|---|---|
| src/pages/WorkQueuePage.jsx | Scope/filter state, server results, selection and refresh. |
| src/hooks/useWorkQueue.js | Fetch/cancellation, pagination, errors, stale state, focus refresh and 60-second polling while visible. |
| src/components/work-queue/QueueScopes.jsx | My work / Team / Unassigned controls. |
| src/components/work-queue/DeadlineFilters.jsx | Bucket counts using server data. |
| src/components/work-queue/WorkQueueTable.jsx | Semantic table, source identity, owner and deadline; narrow contained scrolling. |
| src/components/work-queue/WorkItemDetail.jsx | Source link, deadline explanation, coordination actions and history. |
| src/components/work-queue/AssignmentForm.jsx | Eligible owner choice and optimistic concurrency handling. |
| src/components/work-queue/DeadlineChangeForm.jsx | Reason-required override/preview. |
| src/components/work-queue/WorkActivity.jsx | Event list and note editor. |
| src/components/settings/WorkQueueSettings.jsx | Calendar/rule/grant sections and calculation preview. |
| src/utils/workQueueView.js | Display-only formatting; no competing deadline calculations. |
| src/styles/work-queue.css | Existing theme integration, accessible statuses and responsive layout. |

Use current DialogProvider, DatePickerField, brand tokens and focus/dismiss hooks where appropriate. The design artifact uses synthetic data and independent styles; translate it into the app components rather than pasting the standalone wrapper into React.

Add source-by-ID retrieval where missing. The current app loads only the first batch capped at 5,000 orders, so a queue link cannot assume its source is already present. The dispatcher fetches/authorizes the record, opens the correct existing screen/modal and preserves a route back to the queue. Handle standalone sample IDs explicitly. Do not introduce a full routing rewrite just to support this feature.

Closing detail returns keyboard focus to the triggering row. Permission loss removes sensitive cached content. A failed refresh keeps the last good list with a visible stale/error indicator; it must not show an empty successful queue. Row mutations update/refetch authoritative counts. Conflicts show current values and retain the user's unsaved reason for review.

## 10. Notification worker and coexistence

Use a durable outbox and a worker started/stopped by server/index.cjs, consistent with the single-server deployment. Claim rows transactionally using a lease and row locking; expired leases are reclaimable. Do not hold a database transaction while SMTP runs. Recheck source state, task revision, recipient access, snooze and rollout settings before sending.

Suggested retry schedule: 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then visible failed state for coordinator/admin review. Make these operational settings rather than assumptions in UI copy. Keep a stable message identifier where the transport supports it; an ambiguous remote acceptance remains an at-least-once case.

At due revision changes, obsolete queued notifications are suppressed; old delivered entries remain history. Assignment notifies the new owner once. Personal snooze changes only that recipient's personal reminder; it cannot silence coordinator escalations. Daily digests use one recipient/date key and group all currently authorized eligible items at send time.

| Existing channel | Initial treatment | Cutover gate |
|---|---|---|
| Supplier design reminders | Keep existing service responsible | New queue never sends a second supplier chaser. |
| Supplier overdue FOC reminders | Keep existing service responsible | Same separation by recipient/purpose. |
| Internal received-FOC trial reminders | Keep during pilot, suppress new equivalent delivery | Migrate a pilot plant/type only after matching counts and delivery tests. |
| QD submit/approval/send-back messages | Preserve existing workflow notifications | New assignment/reminder events must not duplicate the same immediate notification. |
| TopBar QD and late-order badges | Keep until queue coverage is enabled | Switch matching categories to one server summary; do not add old and new counts together. |
| Daily summary PDF | Keep stage reporting unchanged | Optional queue section is separate from original movement counts. |

## 11. Backfill, reconciliation and rollback

The backfill CLI defaults to --dry-run and requires explicit plant scope for the first pilot. Emit counts and row-level reasons for proposed tasks, unmatched plants, invalid dates, unknown statuses, missing policies/owners/ETAs and terminal records excluded. A live run records its batch ID and suppresses task-event email; no original source status or milestone is rewritten.

Entry evidence priority: authoritative new event; latest applicable revision re-receipt for a revisited stage; valid mapped milestone; unknown. Do not use first-ever design_received_date as the entry of a later revision approval. Do not invent prior stage events from current status. Missing entry evidence remains Needs setup and can be repaired deliberately.

Checkpoint by stable source ID; acquire a per-plant run lock, process bounded batches, and lock each source as it is synchronized. Live writes use the same lock order. An interrupted run resumes; reruns do not create new occurrences for unchanged source states. Unknown stages go into the run report/setup queue rather than being silently dropped.

Reconciliation compares current source state with its current task using the same adapter. It may repair a missing current occurrence or close an obsolete one with a reconciliation event. It must not replace manual owners, overrides, policy snapshots or reconstructed historical dates. Changes that lack sufficient event evidence are reported for review. Direct database changes while synchronization was disabled are detected when it is re-enabled.

Rollback order: disable new notifications, disable/hide the new page, return overlapping badges/reminders to legacy handling, optionally disable source synchronization after preserving its state. Retain additive tables and audit records. Do not undo genuine order approvals or other source changes. Before re-enabling, reconcile changes made through the legacy path.

Existing automatic Excel order exports are not a full backup of new queue tables. Verify the deployment's PostgreSQL backup/restore process covers them before rollout; do not silently claim the order-export backup is sufficient.

## 12. Work packages and release gates

| Package | Concrete tasks | Depends on | Exit gate |
|---|---|---|---|
| P0 — contract and baseline | Review stage mapping, permissions, target/calendar choices; inventory every source write path; record existing test/lint/build results. | None | Approved configuration choices for pilot; fixtures cover real source shapes. |
| P1 — persistence and pure rules | Add additive schema, source subjects, calendar/stage/deadline modules, strict validation, policy snapshots, indexes and unit tests. | P0 | Fresh/existing migration paths pass; date/occurrence invariants verified. |
| P2 — order/sample integration | Transactional route refactors, revision/receipt/sample synchronization, import script integration, deletion/access handling, dry-run backfill and reconciliation. | P1 | Every order/sample mutation path has integration coverage; rerun produces zero duplicates. |
| P3 — queue API and UI | Authorized queries/counts/cursors, directory, assignment/notes/deadlines/pauses, concurrency, source-ID dispatcher and accessible page. | P2 | Pilot walkthrough and over-5,000-record tests pass; no new lint errors in changed scope. |
| P4 — settings and in-app pilot | Rule/calendar/grant admin screens; future-only policy versions; recalculation previews; monitored backfill and source parity review. | P3 | Release A usable with notifications off; owners/deadlines reviewed and unknown records visible. |
| P5 — QD adapters | Named/legacy approval and creator rework; current FOC round synchronization; QD import/undo; badge parity tests. | P2, P3 | Existing approval tests pass; personal membership and FOC history match source workflow. |
| P6 — durable reminders | Outbox worker, digest, retry/status, recipient recheck, personal snooze and selective legacy cutover. | P4, P5 | Restart, stale-task, duplicate-worker and SMTP-failure cases pass; no pilot notification flood. |
| P7 — rollout | Complete browser/role walkthrough, restore rehearsal, observability, pilot acceptance, then expand plants. | P6 | Release B acceptance criteria met; rollback verified and operating notes handed over. |

After P1, frontend work with agreed fixtures and backend transaction work can proceed independently. QD integration may proceed alongside settings work once source contracts are stable. Do not parallelize edits to the same large root component or shared route modules without clear ownership.

A calendar/date engine, transaction refactors and QD compatibility make this more than a small UI addition. Estimate delivery after P0 using the chosen source coverage and rule complexity; these work packages are dependencies and acceptance gates, not promised dates.

## 13. Verification plan

### Meaningful automated tests

- Calendar: leap dates, invalid dates, nonworking entry date, holidays, end-of-year, zero/negative duration rejection, working versus calendar day behavior, exact cutoff, Dubai UTC mapping and a DST-observing timezone.
- Deadline: missing rule/ETA/entry evidence; explicit weekend ETA retained; override baseline preserved; policies future-only; source date correction requires review; breached-before-pause history preserved.
- Pause: same-day zero credit, both boundaries excluded, holiday/weekend exclusion, overlapping periods unioned, source hold prevents queue-only resume, ETA never shifted.
- Adapter: each order status, simulation enabled/disabled, revisions and re-receipts, receipt/exemption, both sample parent types, approved/rejected/hold/unknown states, failed trial alone, cancellation and deletion.
- QD: named approver, eligible legacy unassigned, admin intervention versus personal membership, author-only returned work, Draft excluded, terminal/imported QDs, each FOC round transition and failed replacement trial.
- Transactions: rollback after injected sync failure; simultaneous source writes; duplicate request IDs; competing assignment/deadline mutations; deletion versus notification send; stale recalculation preview.
- Queries: user with Work queue only sees no source data; grants without source access confer nothing; restricted page access, revoked access and cross-plant coordination limits; counts/list parity; pagination with >5,000 sources.
- Backfill: dry-run writes nothing; restart/resume/rerun idempotency; old revision dates not reused; unknown records surfaced; concurrent normal writes; no historical notification intents.
- Notifications: worker restart/lease expiry, two workers, outdated deadline revision, completed source, missing email, SMTP error/ambiguous result, access revoked before delivery, snooze scope, digest grouping and legacy duplicate suppression.

Use node:test for pure services and a disposable PostgreSQL test database for transaction/FK/query cases. Existing mocked service tests alone cannot prove atomicity, uniqueness or database authorization. Never point integration tests or backfill experiments at production.

### Browser acceptance

Walk through My work/Team/Unassigned as an ordinary user, coordinator and administrator. Change an owner; verify the deadline is unchanged. Attempt a deadline change without a reason. Open an inaccessible/deleted/stale item. Follow a queue link to an order outside the app's first 5,000 rows. Complete a source stage and verify old/new task counts. Test source-derived QD owner controls. Confirm keyboard focus, table readability, empty/error/loading states and reduced motion.

The design mockup has already been checked for representative local interactions. It does not verify these production API/security behaviors; those tests belong to implementation.

### Repository baseline

The preceding review ran npm test: 595 passing tests; npm run build: successful with existing bundle warnings; npm run lint: 72 errors and two warnings. Re-establish that baseline before implementation. Run the full existing tests and production build for each release gate; use targeted lint on changed/new code and track the unrelated existing failures explicitly. Do not expand this feature into an unsolicited repository-wide lint cleanup.

## 14. Completion criteria

All AC-01 through AC-15 from the feature description are met for the released scope, corresponding backend and browser checks pass, documentation identifies active plant rules and notification owners, and current queue counts match source records. The final release includes QD adapters and durable escalation, not only the order/sample pilot.

No production configuration, assignment, email or source workflow is changed by this planning pack. Implementation begins as a separate coding step against these reviewed artifacts.
