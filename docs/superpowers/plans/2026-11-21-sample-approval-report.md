# Sample Approval Followup Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monthly Sample Approval Followup report for the sales team, grouped by customer. It lists the samples still waiting for customer approval and gives last month's approved/rejected counts and average days to approval. It comes as a PDF and an Excel file, can be downloaded from Sample Followup, and can be sent as an optional monthly email. The target (14 days) can be edited by an admin.

**Architecture:** A pure data module builds one `ApprovalReport` object, and both a pdf-lib renderer and an `xlsx` workbook writer render that same object, so the two files can't disagree. A service module owns the settings, a minute-tick monthly scheduler and the email. It reuses the Sample Status foundation (`server/services/sampleStatusReport*.cjs`): a shared row loader extracted from `loadSampleStatus`, the customer fallback, the PDF helpers, and the route and settings patterns.

**Tech Stack:** Node/Express (CJS), Postgres `pg`, pdf-lib, `xlsx` 0.18 (as in `server/services/autoBackup.cjs`), React/Vite (ESM), `node:test`. pdfjs-dist is used in the PDF tests.

**Spec:** `docs/superpowers/specs/2026-11-21-sample-approval-report-design.md`

## Global Constraints

**Names and formats:**
- The PDF title reads exactly `SAMPLE APPROVAL FOLLOWUP`.
- File names are `Sample-Approval-<YYYY-MM>.pdf` and `Sample-Approval-<YYYY-MM>.xlsx`, where `<YYYY-MM>` is the report month (the "last month" section's month).
- The month parameter is `YYYY-MM`. By default it is the calendar month before the report date, and any other shape gets a 400 `month must be YYYY-MM`.

**Which records count:**
- Every section (Waiting, Approved and Rejected) uses `belongsInSampleFollowup` from `server/services/sampleStatusReportData.cjs`: received, and order status not CANCELLED/HOLD.
- Records come from `die_orders` and `sample_followups` only.

**Waiting for approval:**
- **Waiting** = sample status exactly `Sample Submitted`. Rejected and Approved are never waiting.
- **Days waiting** = report date − `submission_date` (the latest submission). Overdue means `daysWaiting > targetDays`.
- Unknown, unreadable, future-dated or negative intervals become `null`. They are shown as `-`, are never overdue and are never counted as 0. There is no clamping to 0.

**Last month:**
- **Approved in month** = status `Approved` and `sample_approval_date` within the month.
- **Days to approval** = approval − submission. A missing or negative interval is left out of the average and counted in footnote `excludedFromAverage`.
- **Average** = arithmetic mean rounded to 1 decimal, or `null` (`-`) when there are no intervals.
- **Rejected in month** = distinct `die_orders` ids with an `order_changes` row where `field_name = 'Sample Status'`, `new_value = 'Rejected'` and `changed_at::date` falls within the month. It is counted per die, not per event.
- A fixed footnote reads: `Rejections are counted where the status change was recorded in the app.`

**Customers:**
- Customers are grouped by key = `customer.trim().replace(/\s+/g,' ').toLowerCase()`. The display name is the most common spelling in the group, with ties going to the row with the highest id.
- A blank customer is shown as `No customer` and sorted last.
- The customer fallback is the existing `withCustomers` (die list by die, then by profile, then the profile master).

**Ordering:**
- Waiting groups: by the longest single wait, descending, with unknown waits last.
- Rows within a group: by days waiting, descending, with null last, then by die number.
- Last month rows: alphabetical by display name, with `No customer` last, followed by the Total row.

**Settings:**
- These live on `reminder_settings`:
  - `approval_report_enabled` BOOLEAN DEFAULT false
  - `approval_report_day` INTEGER DEFAULT 1
  - `approval_report_time` TEXT DEFAULT '08:00'
  - `approval_report_last_month` TEXT
  - `approval_target_days` INTEGER DEFAULT 14
- Allowed values: day must be a whole number from 1 to 28, and target days a whole number from 1 to 90. Anything else gets a 400.

**Email and schedule:**
- The email template is named `Approval Report`, with subject `Sample approval report - {{month}}` and body `The sample approval report for {{month}} is attached.`
- The scheduler sends once per report month, on or after the configured day and time. If the configured day is a Sunday, it sends on the following Monday.
- If the server was down at send time, it sends once later in the same calendar month. `approval_report_last_month` stores the report month that was sent.
- "Send now" never writes `approval_report_last_month`.

**Permissions:**
- PDF and Excel downloads: anyone with Sample Followup page access (the routes live on `server/routes/sample-followups.cjs`).
- The settings routes: admin only.

**Dates:**
- Every "today" uses `todayLocal()`. A guard test bans `new Date().toISOString()`.

## Review Focus

These are the five cases most likely to cause trouble:

1. **A customer spelled differently across dies** ("ABC Ltd", "abc ltd ", "ABC  Ltd"). These must make one group and one Last-month row. Pinned in Task 1.
2. **An approval dated before its submission, a future submission date, or a missing submission date.** They show `-`, are excluded from the average, are footnoted, and are never 0 or overdue. Pinned in Task 1.
3. **A month with no approvals.** The average is `-` (null), never 0, and the sheet and PDF still render. Pinned in Tasks 1, 2 and 3.
4. **The scheduler on a Sunday send day, after a missed send, and at month rollover.** It sends exactly once per report month and never on a Sunday. Pinned in Task 4.
5. **A die rejected twice in the month, or rejected and then approved in the same month.** Rejected counts it once. If it was also approved in the month, it counts in both columns, because each describes an event that happened. Pinned in Task 1.

---

### Task 1: Report data, `server/services/sampleApprovalReportData.cjs`

**Files:**
- Modify: `server/services/sampleStatusReportData.cjs`
  - Extract `loadFollowupRows(db) → Promise<{ rows, trials }>` from `loadSampleStatus`. It covers the three queries, the mapping, the `belongsInSampleFollowup` filter and `withCustomers`.
  - Add `sampleApprovalDate` to both row mappings (`die_orders.sample_approval_date` and `sample_followups.sample_approval_date`, both already columns).
  - Rewrite `loadSampleStatus` to use the new function.
  - Export `loadFollowupRows`.
- Create: `server/services/sampleApprovalReportData.cjs`
- Test: `server/services/sampleApprovalReportData.test.cjs`, plus the existing `server/services/sampleStatusReportData.test.cjs`, which must stay green.

**Interfaces:**
- Consumes: `belongsInSampleFollowup` and the row shape from `sampleStatusReportData.cjs`, which gains `sampleApprovalDate`, plus `todayLocal` from `dates.cjs`.
- Produces:
  - `previousMonth(isoDay) → 'YYYY-MM'`
  - `isMonth(value) → boolean`, for `/^\d{4}-(0[1-9]|1[0-2])$/`
  - `monthLabel('2026-11') → 'November 2026'`
  - `buildSampleApproval({ rows, trials, rejections, reportDate, month, targetDays }) → ApprovalReport`. It is pure. `rejections` is `[{ orderId, date }]`.
  - `ApprovalReport` has this shape:
    - `{ reportDate, month, monthLabel, targetDays, header, waiting, lastMonth, footnotes }`
    - `header`: `{ waiting, overdue, approved, avgDays }`. `avgDays` is a number or null.
    - `waiting`: `[{ customer, count, overdue, oldestDays (number|null), rows: [{ die, plant, press, submittedDate, daysWaiting (number|null), overdue, trialCount, legacyTrialCount (number|null), corrector, remark }] }]`
    - `lastMonth`: `{ rows: [{ customer, approved, rejected, avgDays }], total: { approved, rejected, avgDays } }`
    - `footnotes`: `{ excludedFromAverage, rejectionsNote }`
  - `loadSampleApproval(db, { reportDate = todayLocal(), month = previousMonth(reportDate), targetDays = 14 }) → Promise<ApprovalReport>`. It uses `loadFollowupRows` plus one query:
    ```sql
    SELECT DISTINCT order_id, MIN(changed_at::date) AS date FROM order_changes
     WHERE field_name = 'Sample Status' AND new_value = 'Rejected'
       AND changed_at::date BETWEEN $1 AND $2
     GROUP BY order_id
    ```
    Only ids of rows that passed `belongsInSampleFollowup` are counted.

- [ ] **Step 1: Write failing tests** (one `test()` each, with `reportDate '2026-12-01'`, `month '2026-11'` and `targetDays 14` unless stated otherwise):
  - `waiting lists only Sample Submitted`: of rows Submitted, Rejected, Approved and Pending, only the Submitted one is in `waiting`.
  - `days waiting and overdue`:
    - submitted `2026-11-10` → `daysWaiting 21, overdue true`
    - submitted `2026-11-20` → `11, false`
    - submitted `''` → `null, false`
    - submitted `'2026-12-05'` (future) → `null, false`
  - `the target changes overdue`: the same row with `targetDays 30` gives `overdue false`.
  - `customers group by normalised name`: "ABC Ltd" (id 1), "abc ltd " (id 2) and "ABC  Ltd" (id 3) give one group, displayed as `ABC Ltd`. A blank customer gives `No customer`, sorted last.
  - `groups sort by oldest wait`: the group whose oldest wait is 208 comes before the group with 30, and a group with only unknown waits comes last.
  - `approved last month and average`:
    - approvals in November with intervals 4 and 9 → `approved 2, avgDays 6.5`
    - an approval in October is not counted
    - an approval dated before its submission → counted in `approved`, left out of the average, `excludedFromAverage 1`
  - `a month with no approvals has a null average`: `total.avgDays === null` and `header.avgDays === null`.
  - `rejected counts dies once`:
    - rejections `[{orderId:5,…},{orderId:5,…}]` → `rejected 1`
    - a die both rejected and approved in the month counts in both columns
  - `cancelled orders count nowhere`: a CANCELLED order that is Submitted, Approved in November and rejected in November appears in no section.
  - `previousMonth and isMonth`:
    - `previousMonth('2026-01-15') === '2025-12'`
    - `isMonth('2026-13') === false`
    - `monthLabel('2026-11') === 'November 2026'`
  - `load maps approval dates and queries rejections for the month`: a fake db (match on SQL text) returns canned rows. Assert that the rejection query got `['2026-11-01', '2026-11-30']` and that `sample_approval_date` reached `buildSampleApproval`.
- [ ] **Step 2: Run** `node --test server/services/sampleApprovalReportData.test.cjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Extract `loadFollowupRows` first, then run `node --test server/services/sampleStatusReportData.test.cjs` and expect PASS. Then write the new module. For day arithmetic, read dates by the `YYYY-MM-DD` regex as UTC day numbers, as `dayNumber` in `sampleStatusReportData.cjs` does, but **without** the clamp-to-0 behaviour of `span`.
- [ ] **Step 4: Run** both test files. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(approval-report): report data with waiting list and last-month results`

### Task 2: PDF, `server/services/sampleApprovalReportPdf.cjs`

**Files:**
- Create: `server/services/sampleApprovalReportPdf.cjs`
- Test: `server/services/sampleApprovalReportPdf.test.cjs`

**Interfaces:**
- Consumes:
  - `ApprovalReport` from Task 1.
  - `sanitize`, `fit`, `wrap`, `longDate` and `stamp` from `server/services/trialPlanPdf.cjs`.
  - The page constants, title block and ruled-table style of `server/services/sampleStatusReportPdf.cjs`. Copy only what is needed; do not refactor that file.
- Produces: `generateSampleApprovalPdf(report, { generatedAt: Date, logoBytes?: Uint8Array }) → Promise<Uint8Array>`.

**Layout:** A4 landscape, with a title block on every page.
- **Title block:**
  - `SAMPLE APPROVAL FOLLOWUP`
  - `Report month <monthLabel>`
  - `Issued <stamp>`
  - `Target <N> days`
  - `x of y`
- **Header line:** `Waiting now N - Overdue N - Approved in <Month> N - Avg days to approval X.X|-`
- **Section `WAITING FOR APPROVAL`:**
  - One customer band per group: `<customer>  <count> waiting, <overdue> overdue - oldest <N> d|-`.
  - Then a ruled table with the columns `Die #, Plant, Press, Submitted, Days, Trials, Corrector, Last remark`.
  - The Days cell shows `N`, bold with a red `OVERDUE` when overdue, or `-`. The Last remark cell is wrapped to 2 lines.
  - With no waiting samples, it shows the line `No samples are waiting for approval.`
- **Section `LAST MONTH - <monthLabel>`:**
  - A table with the columns `Customer, Approved, Rejected, Avg days to approval` (`-` when null), then a bold `Total` row.
  - With no rows, it shows `No approvals or rejections in <monthLabel>.`
- **Footnotes:**
  - `rejectionsNote`, always.
  - `<n> approval(s) had no usable submission date and are not in the averages.`, only when n > 0.
- **Page breaks:** headers repeat after a page break, a band is never orphaned, and there is no trailing empty page.

- [ ] **Step 1: Write failing tests**, using the `textOf` helper copied from `sampleStatusReportPdf.test.cjs`:
  - `titled with month and target`: matches `/SAMPLE APPROVAL FOLLOWUP/`, `/Report month November 2026/`, `/Target 14 days/` and `/1 of 1/`.
  - `customer band and overdue`: matches `/ABC Ltd 2 waiting, 1 overdue - oldest 21 d/` and `/OVERDUE/`.
  - `last month table with total and null average`: matches `/Total 2 1 6\.5/`. A report whose total average is null shows `Total 0 0 -`.
  - `footnotes`: always contains the rejections note. The excluded-from-average line appears only when n > 0.
  - `empty report`: with no waiting samples and no last-month rows, the PDF still renders 1 page with both empty-state lines.
  - `many waiting rows paginate`: 70 rows across 3 customers give `numPages >= 2`, every page contains `Die #` or `Customer`, and the last page is not empty.
- [ ] **Step 2: Run** `node --test server/services/sampleApprovalReportPdf.test.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(approval-report): Sample Approval Followup PDF`

### Task 3: Excel, `server/services/sampleApprovalReportXlsx.cjs`

**Files:**
- Create: `server/services/sampleApprovalReportXlsx.cjs`
- Test: `server/services/sampleApprovalReportXlsx.test.cjs`

**Interfaces:**
- Consumes: `ApprovalReport` from Task 1, and the `xlsx` package (`require('xlsx')`, as in `autoBackup.cjs`).
- Produces: `generateSampleApprovalXlsx(report, { generatedAt: Date }) → Buffer`, a `.xlsx` file.

**Sheets:**
- **`Waiting`:** headers `Customer, Die #, Plant, Press, Submitted, Days waiting, Overdue, Trials, Corrector, Last remark`, one row per sample, in group order.
  - `Submitted` is a real date cell (a JS Date with `cellDates: true`, number format `dd-mmm-yyyy`), or blank.
  - `Days waiting` is a number, or blank when null.
  - `Overdue` is `Yes` or `No`.
  - `Trials` is a number: `trialCount`, or `legacyTrialCount` when `trialCount` is 0 and a legacy count is set.
- **`Last month`:** headers `Customer, Approved, Rejected, Avg days to approval`, with the rows and then `Total`. A null average is a blank cell.
- **`About`:** two columns of label and value: Report month, Generated, Target days, Waiting now, Overdue now, plus both footnotes.
- Set `ws['!autofilter']` on both data sheets and `ws['!cols']` widths.
- Freeze the header row with `ws['!views'] = [{ state: 'frozen', ySplit: 1 }]`. If the library version ignores it, leave it in place and note that in the report. Do not add a dependency.

- [ ] **Step 1: Write failing tests**, reading the buffer back with `XLSX.read(buf, { cellDates: true })`:
  - `three sheets in order`: SheetNames is `['Waiting','Last month','About']`.
  - `waiting rows carry real dates and numbers`: the row for `032064-2501` has a Date `Submitted` (2026-04-27), the number 208 for Days waiting, and `Yes` for Overdue. A row with unknown days has a blank Days cell, not 0.
  - `last month has a total row and blank null averages`.
  - `autofilter on both data sheets`: `'!autofilter'` is set on Waiting and Last month.
  - `same numbers as the PDF report object`: the Waiting row count equals `report.header.waiting`, and the Last month Total equals `report.lastMonth.total`.
- [ ] **Step 2: Run** `node --test server/services/sampleApprovalReportXlsx.test.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(approval-report): Excel workbook`

### Task 4: Service, monthly schedule, settings, routes

**Files:**
- Create: `server/services/sampleApprovalReport.cjs`
- Test: `server/services/sampleApprovalReport.test.cjs`
- Modify: `server/db.cjs`
  - Add the five `approval_*` columns from Global Constraints next to the `sample_status_*` columns (~line 895), using `ADD COLUMN IF NOT EXISTS`.
  - Seed the `Approval Report` template next to `Sample Status` (~line 1442), with category `approval_report`, `ON CONFLICT (name) DO NOTHING`.
- Modify: `server/index.cjs`, starting `scheduleApprovalReport()` beside `scheduleSampleStatus`.
- Modify: `server/routes/email.cjs`, adding a `// ── Sample approval report` block after the sample-status block.
- Modify: `server/routes/sample-followups.cjs`, adding `GET /approval-report.pdf` and `GET /approval-report.xlsx` next to `/status-report.pdf`, before `/:id`.

**Interfaces:**
- Consumes:
  - `loadSampleApproval`, `previousMonth`, `isMonth`, `monthLabel` (Task 1)
  - `generateSampleApprovalPdf` (Task 2) and `generateSampleApprovalXlsx` (Task 3)
  - The `_deps` test seam, `readLogo`, the template lookup and the mailer call as in `server/services/sampleStatusReport.cjs`
- Produces:
  - `sendMonthFor(month, day, now) → 'YYYY-MM-DD'`: the send date in the calendar month after `month`, with Sunday moved to Monday. For example `('2026-10', 1)` gives `'2026-11-02'`, because 1 Nov 2026 is a Sunday.
  - `isDue({ enabled, day, time, lastMonth }, now) → boolean`. Let `M = previousMonth(todayLocal(now))`. It is true only when all of these hold:
    - enabled
    - `lastMonth !== M`
    - today ≥ `sendMonthFor(M, day)`
    - today is in the same calendar month as that send date
    - when today equals the send date, the local HH:MM is at least `time`
  - `renderFor({ month, kind: 'pdf'|'xlsx', reportDate? }) → Promise<{ report, bytes }>`. It reads the target from settings.
  - `fileName(month, kind) → 'Sample-Approval-<month>.<pdf|xlsx>'`
  - `sendApprovalReport({ now?, stamp?: boolean }) → Promise<{ status: 'sent'|'skipped', message }>`.
    - It reports month `previousMonth(todayLocal(now))` and attaches both files.
    - The body repeats the header numbers in plain words, HTML-escaped. Use ASCII separators or `&middot;`, never raw non-ASCII.
    - If To is empty, the result is `skipped` with the message `No recipients set for "Approval Report" in Settings, so the report was not emailed`.
    - Only `stamp: true` (the tick) writes `approval_report_last_month`, and it does so on both the sent and the skipped path. A mail error throws and writes nothing.
  - `getApprovalReportSettings()`, `updateApprovalReportSettings({ enabled, day, time, targetDays })`, `getApprovalReportState()`, `scheduleApprovalReport()`.
- **Routes:**
  - `GET /api/email/approval-report-settings` (admin) → `{ settings, state }`.
  - `PUT` the same path (admin), with body `{ enabled?, day?, time?, targetDays? }`. Validation: HH:MM as in the daily-summary route, day an integer 1–28, targetDays an integer 1–90, and 400 otherwise with a specific message.
  - `POST /api/email/approval-report-settings/run-now` (admin) → `{ message, summary }`. It never stamps.
  - `GET /api/sample-followups/approval-report.pdf?month=YYYY-MM` and `.xlsx`:
    - A missing month means `previousMonth(todayLocal())`. A bad month gets a 400 `month must be YYYY-MM`.
    - The Content-Type for the Excel is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
    - Content-Disposition uses `fileName`.
    - The download records nothing.

- [ ] **Step 1: Write failing tests:**
  - `sendMonthFor moves Sunday to Monday`:
    - `('2026-10', 1)` → `'2026-11-02'`
    - `('2026-11', 1)` → `'2026-12-01'`
    - `('2026-11', 28)` → `'2026-12-28'`
  - `isDue sends once per month`. With day 1 and time 08:00:
    - Tue 1 Dec 2026 07:59 → false
    - 08:00 → true
    - with `lastMonth '2026-11'` → false
    - Thu 10 Dec with `lastMonth '2026-10'` → true (catch-up)
    - 1 Jan 2027 with `lastMonth '2026-11'` → true for M = '2026-12'
    - disabled → false
  - `isDue never fires on the Sunday`: Sunday 1 Nov 2026 at 09:00 → false. Monday 2 Nov at 08:00 → true.
  - `run-now does not stamp, the tick does`: using `_deps` stubs, `sendApprovalReport()` never issues an UPDATE of `approval_report_last_month`, on either the sent or the skipped path. `sendApprovalReport({ stamp: true })` does, on both paths.
  - `email carries both files`: one send with two attachments named `Sample-Approval-2026-11.pdf` and `Sample-Approval-2026-11.xlsx`. The body contains `Waiting now` and no raw non-ASCII bytes (`/[^\x00-\x7F]/` does not match).
  - `settings validation`: `updateApprovalReportSettings` rejects day 29, targetDays 0 and targetDays 91, as a thrown 400-type error or a route-level check. Test whichever layer owns the rule.
- [ ] **Step 2: Run** `node --test server/services/sampleApprovalReport.test.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, db.cjs, index.cjs and the routes.
- [ ] **Step 4: Run** `npm test`. Expected: all pass. Then run `iconv -f utf-8 -t utf-8 <each changed file> >/dev/null` and expect every file to be valid UTF-8.
- [ ] **Step 5: Commit**: `feat(approval-report): monthly email, settings, target and download routes`

### Task 5: Frontend, Approval report menu and settings row

**Files:**
- Modify: `src/api.js`
  - Add `sampleFollowupsAPI.approvalReport(month, kind) → Blob`, using the blob pattern of `statusReportPdf`.
  - Add `emailAPI.getApprovalReportSettings()`, `updateApprovalReportSettings(s)` and `runApprovalReportNow()`.
- Modify: `src/pages/SampleFollowupPage.jsx`. Add an `Approval report` header button (lucide `FileSpreadsheet`) after `Sample Status PDF`. It opens a small popover containing:
  - `<input type="month">`, defaulting to the previous month computed from `todayLocal()`
  - a hint line, `Waiting list is as of today; the month sets the "Last month" section.`
  - **Download PDF** and **Download Excel** buttons
- The popover's behaviour:
  - Each download uses a busy state and a ref guard as in `handleStatusPdf` (cf0ff47), showing `Preparing…` while it works.
  - The saved file is named by `Sample-Approval-<month>.<ext>`.
  - On error, a toast reads `Approval report failed: <message>`.
  - The popover closes on Escape and on an outside click.
- Create: `src/components/email/ApprovalReportSettings.jsx`, modelled on `src/components/email/SampleStatusSettings.jsx`. It has:
  - a toggle
  - Day of month (a number input, 1–28)
  - Time (default 08:00)
  - Target days (a number input, 1–90, default 14)
  - Save and Send now, where a skipped result shows the warning toast
  - help text: `Recipients are set on the "Approval Report" email template. Sent once a month; a Sunday moves to Monday.`
- Modify: `src/components/email/EmailSettings.jsx`, rendering `<ApprovalReportSettings …/>` after `SampleStatusSettings` with the same props.

- [ ] **Step 1: Implement** the API functions, the menu and popover, the settings component and its mount.
- [ ] **Step 2: Run** `npm test`, `npx eslint` on the changed files, and `npm run build`. Expected: tests pass, eslint finds nothing in the changed files, and the build succeeds with only the existing chunk-size warning.
- [ ] **Step 3: Commit**: `feat(approval-report): download menu and email settings`
- The controller does the browser check (scratch DB and scratch backend on :3001, with vite run from the worktree on :5174) during final verification.
