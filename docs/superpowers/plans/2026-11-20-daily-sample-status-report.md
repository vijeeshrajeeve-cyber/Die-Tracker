# Daily Sample Status Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-kept "SAMPLE STAUTUS" Excel sheet with a server-built Sample Status PDF. Users download it from Sample Followup, and it can also go out as a scheduled daily email. Sample Followup itself only lists dies that have been received and whose order is not Cancelled or on Hold.

**Architecture:** A pure data module turns rows (orders, standalone followups, trials) into a report object grouped by plant and press. A pdf-lib module renders that object in the Trial Schedule's style. A service module owns settings, the minute-tick scheduler and the mail. The listing rule exists twice, once ESM for the page and once CJS for the server, and both are tested on the same cases, following the `today.js` / `dates.cjs` pattern.

**Tech Stack:** Node/Express (CJS), Postgres via `pg`, pdf-lib + pdfjs-dist (tests), React/Vite (ESM), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-20-daily-sample-status-report-design.md`

## Global Constraints

- PDF title reads exactly `SAMPLE STATUS`. The download file is `Sample-Status-<YYYY-MM-DD>.pdf` (with `-<plant without spaces>` before `.pdf` when one plant is chosen).
- Listing rule:
  - `die_received_date` is non-blank.
  - The order `status` is not `CANCELLED` or `HOLD` (compare in upper case and trimmed; standalone rows have no order).
  - The sample status is one of `Pending`, `On hold`, `Rejected` (blank counts as `Pending`), OR `submission_date` equals the report date.
  - `Approved` is never listed.
- Late = Pending/On hold with days received→report date `> 7` (`SUBMISSION_TARGET_DAYS`). Rejected rows are never late.
- Rejected rows: days = report date − `submission_date`, shown `Rejected · N d`.
- Unknown or unreadable dates show `—` in the UI and `-` in the PDF (WinAnsi). A missing date is never shown as 0.
- Plants are grouped with `plantKey` / `plantName` semantics (`GEX 01`, `GEX_02`, `gex1` → `GEX 1` / `GEX 2`). A blank plant goes last as `No plant`, and a blank press goes last within its plant as `No press`.
- Email: recipients come from email template `Sample Status` (To/Cc). The scheduler is off by default (`sample_status_enabled = false`), the default time is `18:00`, and it runs Monday–Saturday only (never on a Sunday).
- The summary's trial counts are for trials dated **on the report date** ("Trials today"), split OK / Not OK. This settles the spec's open "trials yesterday" wording: at 18:00, today is the meaningful day.
- Every "today" uses `todayLocal()` (`server/services/dates.cjs` / `src/utils/today.js`). Never use `new Date().toISOString()`, because a guard test bans it.

## Review Focus

1. **A received date typed as text that is not a date** (e.g. `received`, `12/11`). The row is still listed (it is non-blank), Days shows `-`, and it is not late. Pinned in Task 2.
2. **Plant spellings `GEX 01` / `GEX_02` / blank across the same report.** These merge into GEX 1 / GEX 2, and a blank plant gets its own last group rather than vanishing. Pinned in Task 2.
3. **A long comment, or one with characters pdf-lib's WinAnsi fonts cannot draw** (e.g. `→`, emoji, the email-signature paste in the old sheet). It is cut to two lines and the PDF still renders. Pinned in Task 3.
4. **A day with nothing in trial.** The PDF still renders one page with zero counts and the line `No dies in trial.` The email is still sent. Pinned in Tasks 3 and 4.
5. **The server is down at 18:00, or it is Sunday.** The report goes on the next tick after the time on a working day, never twice in one day, and never on Sunday. Pinned in Task 4.

---

### Task 1: One listing rule for the Sample Followup page

**Files:**
- Modify: `src/utils/sampleFollowupView.js` (add export)
- Modify: `src/DieOrderingSystem.jsx:2137-2183` (the `sampleFollowups` useMemo)
- Test: `src/utils/sampleFollowupView.test.js`

**Interfaces:**
- Produces: `export const belongsInSampleFollowup = ({ receivedDate, orderStatus }) => boolean`. It returns true when `receivedDate` is non-blank after trim and `String(orderStatus||'').trim().toUpperCase()` is neither `CANCELLED` nor `HOLD`. Task 2 mirrors it in CJS.

- [ ] **Step 1: Write the failing test** `test('only received dies on live orders belong in Sample Followup', …)`, asserting:
  - `{receivedDate:'2026-11-01', orderStatus:'DIE RECEIVED'}` → true
  - `{receivedDate:'', orderStatus:'DIE RECEIVED'}` → false
  - `{receivedDate:'  ', orderStatus:null}` → false
  - `{receivedDate:'2026-11-01', orderStatus:'CANCELLED'}` → false
  - `{receivedDate:'2026-11-01', orderStatus:' hold '}` → false
  - `{receivedDate:'received', orderStatus:undefined}` → true (text that is not a date still counts as received)
- [ ] **Step 2: Run** `node --test src/utils/sampleFollowupView.test.js`. Expected: FAIL, `belongsInSampleFollowup is not a function`.
- [ ] **Step 3: Implement** `belongsInSampleFollowup` in `src/utils/sampleFollowupView.js`.
- [ ] **Step 4: Apply it in `DieOrderingSystem.jsx`.**
  - Replace the `fromOrders` filter `o['Die Received Date'] || o['Sample Status'] || o.STATUS === 'DIE RECEIVED'` with `belongsInSampleFollowup({ receivedDate: o['Die Received Date'], orderStatus: o.STATUS })`.
  - Add `.filter(sf => belongsInSampleFollowup({ receivedDate: sf.die_received_date }))` to `fromStandalone`.
  - Update the comment above the memo to state the rule and that the report uses the same one.
- [ ] **Step 5: Run** `npm test`. Expected: all pass (the `todayUsage` guard included).
- [ ] **Step 6: Commit**: `feat(sample-followup): list only received dies on live orders`

### Task 2: Report data — `server/services/sampleStatusReportData.cjs`

**Files:**
- Create: `server/services/sampleStatusReportData.cjs`
- Test: `server/services/sampleStatusReportData.test.cjs`

**Interfaces:**
- Consumes: `plantName` from `server/services/trialPlans.cjs`, and `todayLocal` from `server/services/dates.cjs` (only in `loadSampleStatus`).
- Produces:
  - `belongsInSampleFollowup({ receivedDate, orderStatus }) → boolean`, the same cases as Task 1.
  - `buildSampleStatus({ rows, trials, reportDate, plant }) → Report`. It is pure.
    - `rows`: `{ source:'order'|'standalone', id, die, plant, press, customer, dieType, supplier, receivedDate, submissionDate, status, orderStatus, corrector, legacyTrials, remark }`.
    - `trials`: `{ source, parentId, trialNo, trialDate, result, failReason, comments }`.
    - `plant`: `'All'` or a plant name.
  - `Report = { reportDate, plantFilter, totals: Counts, plants: [{ plant, counts: Counts, presses: [{ press, rows: Row[] }] }] }`.
    - `Counts = { inTrial, late, submittedToday, trialsToday, trialsOk, trialsNotOk }`.
    - `inTrial` = listed rows that are not submitted today.
  - `Row = { die, customer, dieType, supplier, receivedDate, status, days (number|null), late (bool), rejectedWait (number|null), submittedToday (bool), lastTrialDate, daysSinceTrial (number|null), trialCount, legacyTrialCount (number|null, set only when there are no trial rows and legacyTrials>0), corrector, latest: string }`.
  - `latest` is built as follows:
    - From the latest trial: `T<no> <OK|Not OK>` + ` · <failReason>` + ` · <comments>`, each part only when present.
    - Else `sample_remark` / standalone remark.
    - Else `No trial yet`.
    - Submitted-today rows use `Submitted today`.
  - `loadSampleStatus(db, { reportDate, plant }) → Promise<Report>`. It runs three queries:
    - `die_orders`: the columns above, plus `status AS order_status`, `die_type`, `no_of_trial`, `sample_remark`.
    - `sample_followups`: no order status; `profile` is the die and `remark` is the remark.
    - `sample_trials`, for either parent.
  - It then filters with `belongsInSampleFollowup` and passes everything to `buildSampleStatus`.

Ordering inside a press:
1. Late rows, by days descending.
2. Other Pending/On hold rows, by days descending, with null days last.
3. Rejected rows, by `rejectedWait` descending.
4. Submitted-today rows.

Presses sort numerically by name (`localeCompare` with `numeric: true`). Plants sort `GEX 1`, `GEX 2`, …, then `No plant`.

- [ ] **Step 1: Write failing tests** (one `test()` each, `reportDate = '2026-11-20'`):
  - `listing follows the rule`:
    - Approved is never listed.
    - Sample Submitted is listed only when `submissionDate === reportDate`.
    - Blank status is treated as Pending.
    - CANCELLED and HOLD orders are excluded.
    - A blank received date is excluded.
  - `days and late`:
    - received `2026-11-10`, Pending → `days 10, late true`.
    - received `2026-11-15` → `days 5, late false`.
    - received `received` → `days null, late false`, and the row is listed.
  - `rejected rows count their wait since submission and are never late`: Rejected, received `2026-09-01`, submitted `2026-11-08` → `rejectedWait 12, late false`, counted in `inTrial`.
  - `latest trial line`:
    - Trials 1 (`2026-11-10`, Not OK, Shape) and 3 (`2026-11-18`, Not OK, `Dimension Out of Spec`, comments `wall thin`) → `latest === 'T3 Not OK · Dimension Out of Spec · wall thin'`, `lastTrialDate '2026-11-18'`, `daysSinceTrial 2`, `trialCount 2`.
    - No trials and `legacyTrials 4` → `trialCount 0, legacyTrialCount 4`.
    - No trials and no remark → `latest 'No trial yet'`.
  - `plants and presses group and order`:
    - Rows with plants `GEX 01`, `GEX_02`, `GEX 2` and `''` → plants `['GEX 1','GEX 2','No plant']`.
    - A blank press → `'No press'`, sorted last.
    - The in-press order is late, then other waiting, then Rejected, then submitted today.
  - `counts per plant and in total`: trials dated the report date are counted OK / Not OK per plant. `totals` is the sum of the plants.
  - `plant filter keeps one plant`: `plant: 'GEX 2'` → `plants.length === 1`.
  - `mirrors the page's rule`: the same six cases as Task 1, run against the CJS `belongsInSampleFollowup`.
- [ ] **Step 2: Run** `node --test server/services/sampleStatusReportData.test.cjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the module. For day arithmetic, read dates with the `YYYY-MM-DD` regex the same way `dayNumber` in `src/utils/sampleFollowupView.js` does (UTC day numbers, clamp negatives to 0). `loadSampleStatus` defaults `reportDate` to `todayLocal()`.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sample-status): report data with listing rule, ages and latest trial`

### Task 3: PDF — `server/services/sampleStatusReportPdf.cjs`

**Files:**
- Create: `server/services/sampleStatusReportPdf.cjs`
- Test: `server/services/sampleStatusReportPdf.test.cjs`

**Interfaces:**
- Consumes: `Report` from Task 2, and `sanitize`, `fit`, `wrap` from `server/services/trialPlanPdf.cjs`.
- Produces: `generateSampleStatusPdf(report, { generatedAt: Date, logoBytes?: Uint8Array }) → Promise<Uint8Array>`.

Layout (A4 landscape, the margins, ink colours and Helvetica of `trialPlanPdf.cjs`):
- **Title block on every page:** logo if given, `SAMPLE STATUS`, `Report date <long date>`, `Issued <dd Mon yyyy, HH:MM>`, and `x of y`.
- **First page:** one summary line per plant: `<plant>  In trial N · Late N · Submitted today N · Trials today N (N OK / N Not OK)`.
- **Body:** a band per plant, then a band per press, each with a ruled table. Columns: `Die #, Customer, Type, Supplier, Received, Days, Last trial, Trials, Corrector, Latest result`.
- **Cells:**
  - Days shows `N` (bold with `LATE` after it when late), `Rejected - N d`, or `-`.
  - Last trial shows `dd Mon (N d ago)` or `-`.
  - Trials shows a count; a legacy count shows as `(N)` in MUTED.
  - Latest result is wrapped to at most 2 lines.
- **Submitted-today rows:** filled light green, `rgb(0.85, 0.94, 0.86)`.
- The table header repeats after a page break. No page is added unless a row needs it.
- With no plants, or no rows at all, it prints `No dies in trial.` under the summary.

- [ ] **Step 1: Write failing tests**, using the `textOf` helper copied from `trialPlanPdf.test.cjs`:
  - `titled and dated`: page 1 matches `/SAMPLE STATUS/`, `/Report date Friday, 20 November 2026/`, and `/1 of 1/`.
  - `summary per plant`: matches `/GEX 1 In trial 2 - Late 1 - Submitted today 1 - Trials today 1 \(0 OK \/ 1 Not OK\)/`. Check the separator `sanitize` produces for `·` (it maps to `-`).
  - `rows show late, rejected and submitted today`: the text contains `LATE`, `Rejected - 12 d` and `Submitted today`.
  - `long or undrawable comments are cut and do not break rendering`: a comment of 600 chars containing `→` and an emoji still renders, and the 600-char tail does not appear in the text.
  - `many rows paginate with repeated headers and no empty page`: 60 rows give `numPages >= 2`, every page contains `Die #`, and the last page contains a row.
  - `empty report`: `plants: []` gives one page containing `No dies in trial.`
- [ ] **Step 2: Run** `node --test server/services/sampleStatusReportPdf.test.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `generateSampleStatusPdf`.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sample-status): Sample Status PDF`

### Task 4: Service, schedule, settings, routes

**Files:**
- Create: `server/services/sampleStatusReport.cjs`
- Test: `server/services/sampleStatusReport.test.cjs`
- Modify: `server/db.cjs`
  - Next to the `daily_summary_*` columns (~line 888), add `sample_status_enabled BOOLEAN DEFAULT false`, `sample_status_time TEXT DEFAULT '18:00'` and `sample_status_last_run DATE` to `reminder_settings`.
  - Next to the Trial Plan templates (~line 1433), seed `('Sample Status', 'Sample status - {{date}}', 'The sample status for {{date}} is attached.', 'sample_status') ON CONFLICT (name) DO NOTHING`.
- Modify: `server/index.cjs:249`, to call `require('./services/sampleStatusReport.cjs').scheduleSampleStatus()`.
- Modify: `server/routes/email.cjs`, adding a `// ── Sample status` block after the daily summary routes.
- Modify: `server/routes/sample-followups.cjs`, adding `GET /status-report.pdf` before any `/:id` route.

**Interfaces:**
- Consumes: `loadSampleStatus` (Task 2), `generateSampleStatusPdf` (Task 3), `emailService.applyTemplate` / the send call used in `server/services/trialPlanPublish.cjs:105-125`, and `readLogo` as in `dailySummary.cjs`.
- Produces:
  - `isDue({ enabled, time, lastRun }, now) → boolean`. Same as `dailySummary.isDue`, except the default time is `'18:00'` and it returns false when `now` is a Sunday.
  - `renderPdfFor({ reportDate, plant }) → Promise<{ report, bytes }>`.
  - `sendSampleStatus({ now }?) → Promise<{ status: 'sent'|'skipped', message }>`.
    - It loads the `Sample Status` template. Empty To → `skipped` with the message `No recipients set for "Sample Status" in Settings, so the report was not emailed`.
    - It sends the PDF for All plants and sets `sample_status_last_run`. A mail error throws.
  - `getSampleStatusSettings()`, `updateSampleStatusSettings({ enabled, time })`, `getSampleStatusState()`, `scheduleSampleStatus()`.
- Routes:
  - `GET /api/email/sample-status-settings`, admin only → `{ settings, state }`.
  - `PUT /api/email/sample-status-settings`, admin only. It takes `{ enabled?: boolean, time?: 'HH:MM' }`; anything else → 400 with the same messages the daily-summary route uses.
  - `POST /api/email/sample-status-settings/run-now`, admin only → `{ message, summary }`.
  - `GET /api/sample-followups/status-report.pdf?date=YYYY-MM-DD&plant=All|<plant>`. It is open to anyone with Sample Followup page access, because the router is already mounted behind that page check. A bad date → 400 `date must be YYYY-MM-DD`. A missing date → today. It sets the filename from Global Constraints and records nothing.

- [ ] **Step 1: Write failing tests** for `isDue`:
  - Off → false.
  - Friday 17:59 → false; Friday 18:00 → true.
  - `lastRun` today → false; `lastRun` yesterday at 21:00 → true (catch-up).
  - Sunday 19:00 → false; Monday 18:00 with `lastRun` Saturday → true.
- [ ] Also write failing tests for `sendSampleStatus` with an injected template row and mailer, following how `trialPlanPublish` tests stub them (if they inject nothing, export an `_deps` object for tests):
  - Empty To → `skipped` and no send.
  - With recipients, one send carries one attachment named `Sample-Status-2026-11-20.pdf`.
- [ ] **Step 2: Run** `node --test server/services/sampleStatusReport.test.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, the db.cjs columns and template, the scheduler start in index.cjs, and the routes.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit**: `feat(sample-status): daily email, settings and PDF download route`

### Task 5: Frontend — Download button and settings panel

**Files:**
- Modify: `src/api.js`
  - Add to `sampleFollowupsAPI`: `statusReportPdf(date, plant) → Blob`, the same fetch/blob pattern as `downloadDailySummaryPdf` at `src/api.js:815`.
  - Add to the email API object: `getSampleStatusSettings()`, `updateSampleStatusSettings(settings)`, `runSampleStatusNow()`.
- Modify: `src/pages/SampleFollowupPage.jsx:445`. Add a `Sample Status PDF` header button (lucide `FileText`) beside Export.
  - It downloads `statusReportPdf(todayLocal(), plantFilter)`, using the page's current plant filter (`'All'` when none).
  - Name the file as in Global Constraints and save it with an object URL, as `TrialPlanTab.jsx:613-618` does.
  - On error, show a toast: `Sample Status PDF failed: <message>`.
- Create: `src/components/email/SampleStatusSettings.jsx`, modelled on `DailySummarySettings.jsx`, using `AutomationRow`, `ToggleSwitch` and `settingsStyles.js`.
  - Controls: an enable toggle, a time input (default 18:00), and a `Send now` button.
  - Status: the last run / last result line from `state`.
  - Help text: `Recipients are set on the "Sample Status" email template. Sent Monday to Saturday.`
- Modify: `src/components/email/EmailSettings.jsx:324`. Render `<SampleStatusSettings …/>` after `DailySummarySettings`, with the same props.

- [ ] **Step 1: Implement** the API functions, the button, the settings component and its mount.
- [ ] **Step 2: Run** `npm test` and `npm run build`. Expected: tests pass, build succeeds with no new warnings.
- [ ] **Step 3: Browser check.** Use the scratch-stack recipe in memory `trial-scheduling` (own random JWT_SECRET, scratch admin with `password_must_change=false`).
  - Sample Followup no longer shows a CANCELLED/HOLD or unreceived die. Compare the row count before and after against a direct SQL count of the rule.
  - The `Sample Status PDF` button downloads a PDF, and opening it shows the summary and plant/press bands.
  - Settings → Email shows the Sample Status row, and toggling it and saving the time persists after a reload.
  - Take screenshots as proof.
- [ ] **Step 4: Commit**: `feat(sample-status): download button and email settings`
