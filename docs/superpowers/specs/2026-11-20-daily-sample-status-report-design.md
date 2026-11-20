# Daily Sample Status Report — design

Date: 2026-11-20 · Status: draft, awaiting approval

## Intent

Replace the hand-kept Excel "SAMPLE STAUTUS" sheet (example: `Sample_Status_19.12.2021.pdf`)
with a report the app produces from its own data. That sheet lists every die still in trial,
one row per die, grouped by plant. A green cell marks a die whose **sample was submitted
today**. Its problems:

- The day counts are wrong. "Delayed days" shows ~1800–1990, because it counts from today's
  date in 2026. "Since last extrusion" shows 46346, which is a blank cell read as a date.
- The Feedback column holds pasted history, including a whole email signature, so
  three dies fill a page.
- It has no summary, no sort order and a trailing empty page, and the title is misspelled.

The app already holds everything the sheet holds, in structured form: press, customer, die
type, supplier, received date, corrector, plant, sample status, submission date, and
each trial with its date, OK / Not OK result, reason and comment (`sample_trials`).

## Goals

- A one-click PDF, **Sample Status**, that reads in one pass: what is in trial, what is late,
  what happened at the last trial, and what was submitted today.
- An optional daily email of the same PDF to a configured list.
- Numbers that are right, or blank when they are unknown, never invented. This is the
  no-fabricated-numbers rule used across the app.

## Non-goals

- No new data entry. The report only reads what Sample Followup and the trial log already hold.
- No full trial history in the report. That stays in the Sample Followup detail pane.
- No change to the Daily Summary Report or the Trial Schedule PDF.
- No Excel version.

## Anti-goals

- No pasted text walls. A long comment is cut short, never allowed to grow a row to half a page.
- A blank date is never read as day 0 or as 1900.

## Approach (chosen: 1)

1. **New standalone report (chosen).** The server builds the PDF in the Trial Schedule's
   style. It has a Download button in Sample Followup, plus an optional scheduled email
   with its own recipients. It reuses the scheduler pattern from `dailySummary.cjs` and the
   PDF conventions from `trialPlanPdf.cjs`, and keeps the report focused on samples.
2. A section inside the Daily Summary Report. Rejected: that report counts order activity
   for another audience, still ships disabled, and a long die list would bury its counts.
3. An Excel export from the Sample Followup list. Rejected: it would be the old sheet with
   correct numbers, with no summary, grouping or sign-off.

## What is on the list

A die is listed only if it **has been received in the plant** (it has a received date) and
**its order is not Cancelled or on Hold**. It must also meet one of these:

- its sample status is **Pending, On hold or Rejected** (in trial or awaiting re-trial), or
- its **submission date is the report date**. These rows are shown green, "Submitted today".

Approved dies are never listed. Sample Submitted dies are listed only on their submission
day. Rows come from both sources Sample Followup merges: `die_orders` and hand-added
`sample_followups`. Hand-added rows have no order, so only the received rule applies to them.

**The same rule applies to the Sample Followup page (user decision, 2026-11-20).** "Unless a
die is received in the plant it should not appear in Sample Followup." Today the merge in
`src/DieOrderingSystem.jsx` (around lines 2137–2160) also lets in order rows that have only a
sample status or a `DIE RECEIVED` status, and it never checks for Cancelled or Hold. Both
places change, so the page and the report always show the same dies. The filter should live
in one shared, tested function. Dies already Approved before an order was cancelled drop off
the page too. That is accepted.

Rejected dies stay on the list (user agreed with option 1 as proposed), because the app
already treats Rejected as "expects a re-trial".

## Layout (A4 landscape, Trial Schedule styling)

```
[logo]  SAMPLE STATUS                        Report date 20 Nov 2026 · Issued 18:00
-----------------------------------------------------------------------------------
GEX 1   In trial 14 · Late (>7 d) 9 · Submitted today 2 · Trials yesterday 3 (1 OK / 2 Not OK)
GEX 2   In trial 12 · Late 7 · Submitted today 0 · Trials yesterday 2 (0 OK / 2 Not OK)
-----------------------------------------------------------------------------------
GEX 2 · P35
Die #        Customer         Type    Supplier   Received  Days  Last trial        Trials  Corrector  Latest result
520009-3505  SUSPA GmbH       Backup  ME PHOEN.  06 Sep    75 ● 12 Nov (8 d ago)   4     Kailash    T4 Not OK · Dimension Out of Spec · "…"
051033-3504  Refco Metal LLC  Backup  ALMAX      15 Dec     5   —                   0     Raheem     No trial yet
■ 027027-501 RR Busduct ...   New     Phoenix    20 Nov     0   ...                 1     Raghu      Submitted today
```

- **Order:** grouped by plant, then press. Within a press, late dies come first, oldest
  first. Submitted-today rows sit at the end of their press.
- **Days:** for Pending and On hold dies, the days from receipt to the report date. This is
  the same rule as `enrichSample` in `src/utils/sampleFollowupView.js`. Late means more than
  `SUBMISSION_TARGET_DAYS` = 7, and late dies are marked and counted. **Rejected dies** show
  "Rejected · N d" instead, where N is the days since `submission_date`, i.e. how long the die
  has waited for a re-trial (my call). `enrichSample` would freeze the number at
  receipt-to-first-submission, so a die rejected months ago would look fresh. Rejected dies
  count under "In trial" and sort by that wait. They are not counted as late, because the
  7-day rule is about first submission. Submitted-today rows show receipt to submission.
- **Last trial:** the date of the latest `sample_trials` row and how many days ago it ran.
  It shows "—" when the die has had no trial.
- **Trials:** a count of trial rows. Legacy typed-in counts appear greyed, as they do on
  the page.
- **Latest result:** the latest trial's number, result, reason and comment, cut short to
  about 2 lines. With no trial, it falls back to `sample_remark`, also cut short.
- Ruled table, header repeated on each page, page "x of y", and no empty pages.

## Delivery

- **Download:** a "Sample Status PDF" button in Sample Followup, using the current plant
  filter (All or one plant). It is a preview only and records nothing.
- **Daily email:** settings for enabled (off by default), send time, and working days. Recipients
  come from an email template named `Sample Status`, edited in Settings like `Trial Plan - GEX 1`.
  No recipients means the email is skipped and the skip is logged. A "Send now" button
  is included. The email carries both plants in one PDF.
- **Default send time 18:00** (my call). "Submitted today" only means something near the
  end of the day; a 06:00 send would always show no submissions.

## Calls made without the user (correct if wrong)

- One PDF for both plants, with one recipient list, as in the old sheet. The trial plans
  have one list per plant.
- Default email time 18:00, sent Monday to Saturday, matching the trial plans' working days.
- The summary counts **"Trials today"**: trials dated on the report date, split OK / Not OK.
  At an 18:00 send, that is the day's work. (Settled while writing the plan; the summary
  sketch above says "yesterday" and should be read as "today".)
- No ledger or "recorded late" logic as in the Daily Summary. This is a snapshot, not a
  count of events.

## Left to the builder

- Code layout, following `dailySummary{,Data,Pdf}.cjs`: a pure data module with
  `node:test` tests, a PDF module, and a scheduler and route in `server/routes/email.cjs`.
- Settings columns on `reminder_settings` in `db.cjs`, like the `daily_summary_*` columns.
- The exact column widths and the truncation length.
