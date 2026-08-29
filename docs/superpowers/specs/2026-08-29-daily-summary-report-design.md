# Daily Summary Report — Design

**Date:** 2026-08-29
**Status:** Approved, not yet implemented

A PDF summarising the previous day's die-order activity, generated and emailed
automatically at 06:00 every morning to a configured recipient list, formatted
so it can be printed and signed off.

## Problem

There is no daily record of what moved. Progress is visible only by opening the
Orders register and reading it, which means nobody outside the immediate team
sees the pipeline, and there is no dated artefact anyone can sign. The counts
that matter are already in the database — nothing new needs to be captured.

## What the report contains

Two blocks, answering two different questions.

**Activity — what moved yesterday.** Ten counts:

| Stage key | Report label | Source column | Filter |
|---|---|---|---|
| `requested` | Die orders requested | `die_requested_date` | — |
| `ordered` | Die orders placed | `ordered_date` | — |
| `design_received` | Designs received | `design_received_date` | — |
| `design_approved` | Designs approved | `design_approved_date` | — |
| `pr_created` | PRs created | `pr_entry` | — |
| `oracle_entry` | Oracle entries done | `oracle_entry` | — |
| `design_to_ems` | Designs to EMS completed | `design_to_ems_date` | — |
| `die_received` | Dies received | `die_received_date` | — |
| `sample_new` | Samples submitted — New | `submission_date` | `type = 'N'` |
| `sample_backup` | Samples submitted — Backup | `submission_date` | `type = 'B'` |
| `sample_other` | Samples submitted — other type | `submission_date` | `type` not in `('N','B')` |

This table is defined once in code as `STAGES` and drives the SQL, the PDF row
order and the email body. Adding a stage means adding one entry.

`sample_other` catches submissions typed `T`, `C` or `H` and is the one row
rendered conditionally — it appears only when its count is non-zero. Everything
else always renders, including zeros.

**Pending — where the pipeline stands now.** One row per pipeline status, with
a count and the age in days of the oldest order sitting in it:

`PENDING FOR ORDERING`, `AWAITING FOR DESIGN`, `UNDER SIMULATION`,
`PENDING FOR DESIGN APPROVAL`, `PENDING FOR PR`, `PENDING FOR ORACLE ENTRY`,
`PENDING FOR DESIGN TO EMS`, `DONE` (In Manufacturing), `DIE RECEIVED`, and
`HOLD` on its own line. `CANCELLED` is excluded.

Statuses come from `VALID_STATUSES` / `STATUS_CONFIG` in `src/utils/constants.js`;
the server keeps its own copy in the service rather than importing across the
frontend boundary, and a test pins the two lists equal so they cannot drift.

Age is measured from the date the order entered its current stage, which is the
date column completed by the *preceding* workflow step:

| Status | Age measured from |
|---|---|
| `PENDING FOR ORDERING` | `die_requested_date` |
| `AWAITING FOR DESIGN` | `ordered_date` |
| `UNDER SIMULATION` | `ordered_date` |
| `PENDING FOR DESIGN APPROVAL` | `design_received_date`, else `three_d_model_received_date` |
| `PENDING FOR PR` | `design_approved_date` |
| `PENDING FOR ORACLE ENTRY` | `pr_entry` |
| `PENDING FOR DESIGN TO EMS` | `oracle_entry` |
| `DONE` | `design_to_ems_date` |
| `DIE RECEIVED` | `die_received_date` |
| `HOLD` | `die_requested_date` |

Falling back to `die_requested_date`, then `created_at`, when the mapped column
is empty or unparseable. Where none is available the cell renders `—` rather
than a fabricated zero.

### Pending is a snapshot, not an as-of-yesterday figure

The pending block is computed at generation time. The activity block covers the
previous day. The two therefore do not reconcile arithmetically, and the PDF
says so under the pending heading. Without that line the report looks internally
inconsistent to anyone who tries to add it up.

## Counting rule: date-on-record, with a catch-up for late entries

The headline counts are **by the date written on the record** — a design
received on the 28th counts on the 28th, whoever keyed it in and whenever. That
keeps the report reconcilable against the Orders register, which is what people
will check it against.

Because dates can be entered late, a **Recorded late** section lists any stage
date earlier than the report date that has never appeared in any previous
report. It shows die number, stage and the date carried, so an entry made four
days after the fact is traceable rather than merely tallied.

### The ledger

```sql
CREATE TABLE IF NOT EXISTS daily_report_ledger (
  order_id    INTEGER NOT NULL REFERENCES die_orders(id) ON DELETE CASCADE,
  stage       TEXT    NOT NULL,
  stage_date  DATE    NOT NULL,
  reported_on DATE    NOT NULL,
  PRIMARY KEY (order_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_daily_report_ledger_reported_on
  ON daily_report_ledger(reported_on);
```

Generating the report for date `D`, in one transaction:

1. Count rows whose parsed stage date equals `D` — the headline numbers.
2. Select rows whose parsed stage date is earlier than `D` and which have no
   ledger row — the *Recorded late* list.
3. Insert every row counted in (1) and (2) with `reported_on = D`.

`ON CONFLICT (order_id, stage) DO NOTHING` makes step 3, and therefore the whole
run, idempotent: re-running for the same day produces identical output and no
duplicate ledger rows.

This approach was chosen over an API-level audit table (blind to the Excel
importers and to direct SQL, so a bulk backfill would report as no activity) and
over Postgres triggers (untestable under `node:test`, and `db.cjs` is a single
template-literal migration where ordering bugs have already cost time). The
ledger sees every write path because it reads the current state of the table
rather than intercepting writes.

### Ledger seeding is part of the migration

The migration that creates the table must immediately populate it with every
existing `(order_id, stage, stage_date)` triple whose date is **strictly before**
the migration date (`stage_date < CURRENT_DATE`), stamped
`reported_on = CURRENT_DATE`. Without this the first report opens with several
years of history filed under *Recorded late*.

The boundary is strict, not inclusive, and that matters: seeding
`stage_date <= CURRENT_DATE` would swallow the migration day itself, so the
first real report — which runs the following morning and covers exactly that
day — would show zeros across every stage.

### Known limitation: corrections are not restated

The ledger key is `(order_id, stage)`, so each stage reports exactly once. If a
date is corrected after it has been reported, the correction is not re-counted
and does not appear anywhere. Catching corrections would require a
diff-and-restate section, which is judged not to earn its place on a daily
operational sheet. Accepted deliberately.

## Data-quality handling

`pr_entry` and `oracle_entry` are used as date fields by `WORKFLOW_STEPS` but are
persisted through `sanitizeString`, not `sanitizeDate`
(`server/routes/orders.cjs:329,332`). They can hold arbitrary text.

A shared `parseStageDate()` accepts `YYYY-MM-DD` and `DD/MM/YYYY` (matching the
existing `sanitizeDate` in `server/routes/backup-requests.cjs:21`) and returns
`null` otherwise. Values that fail to parse are **counted and reported as a
footnote** on the PDF — "3 PR entries could not be read as dates" — so a PR
entry typed as `done` is visible as a data-quality issue instead of silently
vanishing from every report.

The `sample_other` stage above applies the same principle to the `type` column:
a submission typed `T`, `C` or `H` still appears somewhere rather than being
dropped between the New and Backup buckets.

## The PDF

`server/services/dailySummaryPdf.cjs`, built with `pdf-lib`, A4 portrait,
following the conventions established in `supplierReportPdf.cjs`: `MARGIN` 48,
the same navy, and the same `sanitize()` — `StandardFonts` are WinAnsi-encoded
and **throw** on characters outside it, so `—`, `≤` and `·` must be replaced,
not passed through.

The logo is read from `server/assets/company-logo.png`. It must not be read from
`public/` — `Dockerfile.backend` copies only `server/`, so a `public/` path
resolves in dev and silently yields an unbranded PDF in the container.

Layout:

1. **Header** — logo, title, the report date written out (*Thursday, 28 August 2026*),
   and a generated-at line carrying the timezone.
2. **Activity** — the stage rows, label and count, with a total.
3. **Recorded late** — rendered only when non-empty.
4. **Pending at each stage** — stage, count, oldest waiting (days), under the
   snapshot caveat.
5. **Footnotes** — unparseable-date counts, when non-zero.
6. **Sign-off block, on the last page** — three ruled boxes (Prepared by /
   Reviewed by / Approved by), each with blank name, signature and date lines
   for pen. On the last page, not page 1: that placement is the outstanding
   complaint against the supplier report and is not repeated here.

A report with no activity still renders every section, showing zeros. Zeros are
information; a missing email is ambiguous.

## Scheduling and delivery

`server/services/dailySummary.cjs` mirrors `designReminder.cjs`:

- A `setInterval` tick every 60 seconds, started from `server/index.cjs`
  alongside the existing schedulers.
- Runs when the clock has reached the configured time **and**
  `daily_summary_last_run` is not today. Comparing against a `DATE` rather than
  firing on an exact minute means a server that was down at 06:00 still sends
  the report on its next tick instead of skipping the day.
- An in-memory `state` object (`lastRun`, `lastResult`, `error`, `running`)
  exposed to the settings UI, as the other two schedulers do.

`TZ` is already `Asia/Dubai` for the backend in `docker-compose.yml`, so 06:00
means local 06:00. The startup log prints the resolved timezone, matching the
design reminder's existing line.

Five columns added to `reminder_settings` — the table the other two schedulers
already share, so all scheduled mail is configured in one place:

```
daily_summary_enabled   BOOLEAN DEFAULT false
daily_summary_time      TEXT    DEFAULT '06:00'
daily_summary_last_run  DATE
daily_summary_to        TEXT    DEFAULT ''
daily_summary_cc        TEXT    DEFAULT ''
```

The email is sent through the existing `emailService.sendEmail({ attachments })`,
so it is recorded in `email_log` like all other outbound mail. Subject:
`Daily Die Order Summary — 28 Aug 2026`. The body repeats the headline counts as
an HTML table so the report is readable on a phone without opening the
attachment; the PDF is attached as `Daily-Die-Summary-2026-08-28.pdf`.

If `daily_summary_to` is empty the run is skipped with a recorded reason rather
than throwing, and `last_run` is **not** stamped, so configuring recipients
later that day still produces the report.

## User interface

A third panel in Settings → Email, beside the design and FOC reminder panels:
enable toggle, send time, To and CC, last-run status, a **Send now** button, and
a date picker to download any past day's PDF on demand.

Endpoints follow the existing naming in `server/routes/email.cjs`:

- `GET  /api/email/daily-summary-settings`
- `PUT  /api/email/daily-summary-settings`
- `POST /api/email/daily-summary-settings/run-now`
- `GET  /api/email/daily-summary.pdf?date=YYYY-MM-DD`

### What commits to the ledger

The generator takes an explicit `{ commit: boolean }` flag rather than inferring
intent from the caller. The rule is **the ledger records what was emailed**:

| Caller | `commit` | Stamps `last_run` |
|---|---|---|
| Scheduled 06:00 run | `true` | yes |
| **Send now** | `true` | yes |
| `GET daily-summary.pdf` download | `false` | no |

*Send now* is a real send to the real recipient list — the same behaviour as the
existing design and FOC reminder run-now buttons — so it must commit. If it did
not, every stage it reported would surface again the next morning under
*Recorded late*, and recipients would get the same rows twice.

The download endpoint is therefore the only safe way to preview, and it is
preview-only by construction: it renders the identical PDF and writes nothing.
The settings panel labels the two accordingly — *Send now* warns that it mails
the recipient list immediately, *Download* does not.

This is the one failure mode of the design that would be hard to notice and hard
to explain after the fact, so `commit: false` writing nothing is pinned by a
test.

## Modules and boundaries

| File | Responsibility |
|---|---|
| `server/services/dailySummaryData.cjs` | `STAGES`, `parseStageDate`, the SQL, ledger read/write. Returns a plain report object. |
| `server/services/dailySummaryPdf.cjs` | Report object → PDF bytes. No database access. |
| `server/services/dailySummary.cjs` | Settings, scheduler tick, email assembly and send. |
| `server/routes/email.cjs` | The four endpoints above. |
| `src/components/email/DailySummarySettings.jsx` | The settings panel. |

The data module never formats and the PDF module never queries, so the report
shape is a testable interface between them. `dailySummary.cjs` is the only file
that talks to the mailer.

## Testing

`node:test`, mocking the pg pool as `server/services/*.test.cjs` already do.

- `dailySummaryData.test.cjs` — `parseStageDate` across ISO, `DD/MM/YYYY`, junk
  and null; each stage's counting rule including the N/B/other split; the
  late-entry query returning only unledgered rows; idempotence of a repeated
  run; `commit: false` writing nothing; the pending status list matching
  `VALID_STATUSES`; oldest-age falling back cleanly to `—`.
- `dailySummaryPdf.test.cjs` — renders without throwing on a report containing
  `—` and `≤`; produces a non-empty PDF for an all-zero report; the sign-off
  block lands on the last page; a missing logo file degrades to an unbranded PDF
  rather than an exception.
- `dailySummary.test.cjs` — the tick fires only past the configured time, only
  once a day, and not at all when disabled; an empty recipient list skips
  without stamping `last_run`.

Frontend: `npx eslint` on the changed files plus `npm run build`.
`npm run build:check` is not usable — `npm run lint` fails on 77 pre-existing
problems repo-wide and the build step is never reached.

## Out of scope

Per-plant reports (the generator is parameterised by plant so this stays a small
follow-up), weekly or monthly rollups, digital signature stamping, and restating
corrected dates.
