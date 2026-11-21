# Sample Approval Followup Report — design

Date: 2026-11-21 · Status: draft, awaiting approval

## Intent

The sales team chases customers to approve submitted samples. Today, nothing shows them which samples are waiting on which customer, or how long each customer takes. This report gives them that, shared **monthly**, as a **PDF and an Excel file** carrying the same numbers. It is built on the same foundation as the Sample Status report (`server/services/sampleStatusReport*.cjs`, merged 2026-11-20).

## Goals

- **Waiting list:** grouped by customer, every sample still waiting for the customer's approval, with how long it has waited. Anything past the target is marked overdue.
- **Last month's results**, per customer: approved count, rejected count, and average days from submission to approval. This lets sales show a customer their own track record, and lets management see the trend.
- **An approval target, 14 days by default, editable by an admin** in Settings.
- **Downloadable at any time** from Sample Followup (PDF and Excel), plus an optional monthly email with both files attached.

## Non-goals

- No new data entry: no "chased on" log and no customer contact fields.
- No emails to customers. It goes to the internal list only.
- No change to the Sample Status report.

## Anti-goals

- **No invented numbers.** A sample with no submission date has an unknown wait. It shows "-" and is never counted as 0 or as overdue. An average with no samples behind it shows "-", not 0.
- **The PDF and Excel never disagree.** Both are rendered from one report object.

## Approach (chosen: 1)

1. **A new report on the Sample Status foundation (chosen).** One data module feeds a pdf-lib PDF and an Excel workbook built with `xlsx`, the library `server/services/autoBackup.cjs` already uses. There is a service with a monthly scheduler and email, download routes, and a Settings row.
2. An approval section in the Sample Status report. Rejected: that report is daily, grouped by plant, and goes to a different audience.
3. A browser-side Excel via the existing Export dialog. Rejected: it cannot be attached to the monthly email, and its numbers could drift from the PDF's.

Known limit: the community `xlsx` build writes no colours or bold. The Excel is plain columns with filters and frozen headers, and "Overdue" is a Yes/No column. The PDF carries the formatting.

## What is in it

**Waiting for approval** (a snapshot taken when the report is generated):
- **Which dies:** the same listing rule as Sample Followup (`belongsInSampleFollowup`: received, order not CANCELLED/HOLD), **and** sample status = `Sample Submitted`. Rejected samples are back in trial, not with the customer, so they are excluded. Approved samples are also excluded.
- **Days waiting:** report date − `submission_date`. Overdue when greater than the target. A missing or unreadable submission date shows "-" and is not overdue.
- **Columns:** Die #, Plant, Press, Submitted, Days waiting (with OVERDUE), Trials (from `sample_trials`, legacy count greyed as in Sample Status), Corrector, Last remark (`sample_remark`, cut to 2 lines).
- **Customer:** `customer_name`, with the same fallback as Sample Status (existing_die_details by die, then by profile, then profiles). Blank becomes "No customer", listed last.
- **Order:**
  - Customers with the longest single wait first.
  - Within a customer, samples by days waiting, longest first.
  - Unknown waits last.

**Last month** (the calendar month before the report month), per customer:
- **Approved:** dies whose `sample_approval_date` falls in the month and whose status is Approved.
- **Average days to approval:** `sample_approval_date − submission_date` over those dies. Dies with no submission date are left out of the average, and their count is footnoted.
- **Rejected:** dies whose sample status was changed to `Rejected` during the month, according to the change log (`order_changes`, field `Sample Status`, new value `Rejected`). *My call:* there is no rejection date column, and the change log is the only dated record. Rejections recorded outside the app (imports, direct SQL) are not counted, and the report says so in a footnote.
- **Totals row** across all customers.

**Header numbers:**
- Waiting now.
- Overdue now.
- Approved last month.
- Average days to approval last month.
- Target (N days).

## Layout

**PDF:** A4 landscape in the Sample Status / Trial Schedule styling, with a title block and page "x of y" on every page.

```
SAMPLE APPROVAL FOLLOWUP            Report month: November 2026 · Issued 1 Dec 2026, 08:00 · Target 14 days
Waiting now 4 · Overdue 4 · Approved in November 12 · Avg days to approval 8.1
──────────────────────────────────────────────────────────────
WAITING FOR APPROVAL
Customer B (2 waiting, 2 overdue · oldest 208 d)
 Die #         Plant  Press   Submitted    Days       Trials  Corrector  Last remark
 032064-2501   GEX 2  P25     27 Apr 2026  208 OVERDUE  3     Sujith     ...
 ...
LAST MONTH — November 2026
 Customer      Approved  Rejected  Avg days to approval
 Customer A        5         1          6.2
 ...  Total       12         2          8.1
```

**Excel** (`Sample-Approval-<YYYY-MM>.xlsx`):
- **Sheet "Waiting":** one row per sample. Columns: Customer, Die #, Plant, Press, Submitted (a real date cell), Days waiting (number, blank when unknown), Overdue (Yes/No), Trials, Corrector, Last remark.
- **Sheet "Last month":** one row per customer. Columns: Customer, Approved, Rejected, Avg days to approval (blank when none), plus a Total row.
- **Sheet "About":** report month, generated time, target, and the two footnotes.
- Autofilter and frozen header row on both data sheets.

## Delivery

- **Sample Followup header:** an "Approval report" button opens a small menu: month picker (defaults to last month), plus **PDF** and **Excel**. Both use the busy-state pattern from the Sample Status button (cf0ff47), so a second click is ignored. My call: a menu rather than two more header buttons keeps the header from crowding. The waiting list is always "as of now". The month picker only changes the "Last month" section, and the report header says so.
- **Settings → Email:** a "Sample approval report" row with:
  - on/off (off by default)
  - day of month (default 1) and time (default 08:00), *my call*. If that day is a Sunday, it sends on Monday.
  - **target days** (default 14, whole numbers 1–90, admin only)
  - Send now (never marks the month as sent, as in the Sample Status fix)
  - Recipients come from the email template **"Approval Report"**. With no recipients it is skipped, and the skip message is shown.
- **The monthly email** covers the month just ended, with the PDF and Excel attached. The body repeats the header numbers.

## Settings storage

`reminder_settings` gets `approval_report_enabled` (false), `approval_report_day` (1), `approval_report_time` ('08:00'), `approval_report_last_month` (TEXT 'YYYY-MM', the last month sent), and `approval_target_days` (14). `db.cjs` seeds the email template "Approval Report".

## Calls settled after the builder check (correct if wrong)

1. **Which records count.** The report uses exactly the rows Sample Followup shows: `die_orders` plus hand-added `sample_followups`, both through `belongsInSampleFollowup`. `existing_die_details` is the die list, not Sample Followup, so it is out. The rule applies to Waiting, Approved and Rejected alike, so cancelled and held orders never appear in any section.
2. **Rejected is counted per die,** not per event. A die rejected twice in a month counts once. The change log only covers `die_orders`, and hand-added rows have no log. The footnote says rejections are counted only where the app recorded the status change.
3. **Resubmission.** A resubmission stamps a new `submission_date` (the Today button overwrites it). So days waiting and days to approval are measured from the **latest** submission: how long the customer has had the sample they are being asked to approve. Rework time before that is not counted.
4. **Odd intervals are not clamped to 0.** An approval dated before its submission, or a submission dated in the future, shows "-", is left out of the average and is footnoted, the same as a missing submission date.
5. **Customer grouping** uses a key that is trimmed, with spaces collapsed and case ignored. The section shows the most common spelling, and ties go to the latest record.
6. **Monthly scheduler.**
   - The day of month is limited to 1–28.
   - If the server is down at send time, the report goes once on the next tick of the same month, never twice; `approval_report_last_month` prevents repeats.
   - A day that falls on a Sunday moves to Monday.
7. **Permissions.**
   - Downloading the PDF or Excel: anyone with Sample Followup access, as for Sample Status.
   - The Settings row (on/off, day, time, target, Send now): admin only.

## Left to the builder

- Module names, following `sampleStatusReport{,Data,Pdf}.cjs`, plus an `…Xlsx.cjs` module.
- Column widths and the truncation length.
- Whether the target is also shown on the Sample Followup page. Not required.
