# Assigned work queue: implementation and rollout

The implementation adds **Work Queue** beside Dashboard. My work, Team and Unassigned share server-side search, plant filtering, deadline buckets and pagination. A detail drawer provides assignment, audited deadline changes, pause/resume previews, follow-up notes, personal reminder snooze and source navigation. Source workflows remain responsible for completing stages.

## Installation

Deploy the updated backend and frontend together using the project's existing deployment process. Backend startup installs the idempotent queue schema and triggers after the existing source tables. Installation does not backfill existing records or enable notifications. The running production containers have not been redeployed as part of this implementation.

1. Grant **Work Queue** page access to restricted users who need it. Admins and unrestricted users already have access. Source-page permissions still apply.
2. Open **Work Queue → Deadline rules**. Review the global calendar (initially Monday–Saturday, Asia/Dubai, 17:00), plant overrides, stage targets, owners and escalation recipients. Correctors are not automatically mapped to login users.
3. Add plant coordinators as needed. Coordination grants never confer source visibility or QD approval authority.
4. Select a pilot plant and **Preview current work**, then apply its backfill. Review Unassigned and Needs setup; repair source dates and supplier ETAs in their original workflows.
5. Review the reminder readiness checkbox before enabling internal notifications. Missing email addresses still allow in-app notifications. Outgoing mail uses the application's existing email configuration.

## Deadline behavior

- Stage-entry day is excluded. Working deadlines skip saved nonworking days and holidays; calendar-day rules count all dates.
- Each occurrence keeps its calendar and rule snapshot. Reassignment and notes do not restart time. Source ETA changes preserve the original deadline.
- Pauses credit complete eligible local dates strictly between pause and resume. Overlapping credits are deduplicated. Supplier ETAs never shift automatically; source holds must be released in the source.
- Manual deadline changes require a reason. Original deadlines and recorded breaches remain available in history.
- Rule edits affect future occurrences. **Preview deadline changes** explicitly recalculates existing active, dated work; applying requires a reason and unchanged item/rule/calendar versions. Earned pause credits are retained. Paused items, supplier ETAs and unresolved source-data exceptions are excluded. Recalculation is limited to 2,000 active items per selected scope; use plant scopes for larger queues.

## Synchronization and notifications

Deferred PostgreSQL triggers synchronize order, sample, revision, QD and FOC changes in the source transaction, including direct import scripts. The final transaction state determines the active occurrence. Typed source foreign keys and deletion tombstones preserve history. This replaces the plan's proposed separate source registry and per-route synchronization calls.

Owner access changes are rechecked when user permissions or QD approver settings change. A named but ineligible QD approver remains named and needs setup; it does not turn into a shared approval. Ordinary ineligible owners become unassigned.

The minute worker uses a durable outbox, per-message leases, delivery-time access checks, retry backoff and an idempotent inbox. Daily reminder keys do not change when a note increments the item version. Snooze affects personal reminders; coordinator escalation continues. Enabling starts a new notification horizon: deadlines already overdue before enablement do not generate a backlog flood. Existing QD submission messages remain authoritative; managed FOC work is omitted from the older internal FOC digest, while supplier chasers continue.

SMTP delivery is at least once: a crash after SMTP acceptance but before acknowledgement can resend an email. Expired daily reminders are cancelled on recovery. Keep mail disabled during initial policy review. `DISABLE_SCHEDULED_JOBS=true` disables all app schedulers for isolated development/testing.

## Validation

Tests cover calendar boundaries and DST, source permissions, QD ownership, atomic synchronization and rollback, revisions and FOC rounds, source deletion, concurrent version conflicts, request replay, pause credits, policy preview invalidation, notification retries and 5,001-record pagination/source lookup. Browser smoke checks cover queue navigation, assignment, notes, pause/resume, source opening, settings and the narrow drawer.

Run `npm test`, `npm run build`, and targeted ESLint for the changed queue files. PostgreSQL suites are opt-in: set `WORK_QUEUE_TEST_DATABASE_URL` and `WORK_QUEUE_API_TEST_DATABASE_URL` to **isolated databases with the existing application schema initialized**. Never point these test variables at production. Without these variables, database suites are skipped; pure tests still run.

The project had existing full-repository lint failures before this feature. Queue files are checked separately. Production build retains the existing bundle-size and import-splitting warnings.
