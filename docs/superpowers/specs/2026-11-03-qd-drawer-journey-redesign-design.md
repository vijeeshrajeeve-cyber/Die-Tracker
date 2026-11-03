# QD drawer redesign: journey strip, tabs, cancel, number on approval

Date: 2026-11-03. Status: reviewed; awaiting the user's sign-off.

Builds on the phase-1 approval redesign (merged to local main `0108d85`): state-driven
step card, server-side approval gates, submit rule, pre-approve checks, Approve & next.

## Intent

The QD details drawer (`src/components/qd/QDDetailPanel.jsx`) is used mostly to find out
where a QD is stuck and to chase the next party. Today it is one long scroll: header,
action buttons, twelve equal fact cards, a FOC block, the issue text with file chips, and
the activity log. Dates that say "late" are buried among the cards.

Three changes, agreed with the user:

1. **Journey strip + tabs.** The dates become a horizontal progress line under the header
   so lateness is the first thing seen; the rest splits into five tabs.
2. **Cancel a QD** that has not been approved, with a reason, as a new approval state.
3. **QD number issued on approval, not on submit.** A number then means "an approved
   discrepancy exists"; a cancelled QD never holds one, so cancellation cannot leave a gap.

## Goals

- Someone opening a QD sees within a second which stop it is at and whether it is late.
- The phase-1 rules (submit checklist, approval gates, checks, Approve & next) are kept
  exactly; this is a re-layout plus two small workflow additions.
- Unwanted Draft / Pending / SentBack QDs can be taken out of the queues without deleting
  anything.
- Numbers run without gaps except where a real, approved QD is later Rejected.

## Non-goals

- No change to the PDF form layout or template (only the QD No box reads differently for
  an unnumbered QD, see below).
- No change to statuses (`Open … Closed`), FOC rounds data, trial recording, emails or the
  Purchase email body.
- No "un-cancel" button. The data allows it (state can be set back by an admin in SQL);
  nothing in the UI offers it.
- No renumbering of existing QDs.
- Phases 2-4 of the earlier plan (Approvals tab, raise composer, section-tagged
  send-backs, change view) stay unbuilt. The Cancelled state is pulled forward from
  phase 4; the rest is not.

## Anti-goals (would make this a failure)

- A QD number printed on any document, or shown in the register, for a QD that is not
  Approved.
- Two QDs approved at once getting the same number (today's `UNIQUE` on `qd_no` is the
  last line of defence; the lock must make it unreachable in practice).
- Cancelled QDs counting in KPIs, the approval queue, the Work Queue or the Alerts bell.
- Any existing Pending or SentBack QD losing its number or becoming unapprovable.

## Vocabulary

- *Approval state* (`approval_state`): Draft, Pending, Approved, SentBack, **Cancelled** (new).
- *Status* (`status`): the existing eight values; only meaningful once Approved.
- *Stop*: one node on the journey strip.
- *Round*: one FOC replacement attempt (`qd_foc_rounds`), as today.

## The drawer

Width, overlay, slide-in and the header stay as today. Header: `QD <no>` or
`QD · unnumbered` (see numbering), status chip, approval-state chip, Imported chip, die
line (`Die <no> · supplier · plant · Raised <date> · by <corrector>`), close button.

### Journey strip

A horizontal row of stops directly under the header, one line, each stop a dot with a
label above and a date (or lag) below. Stops, in order:

1. **Raised** — `raised_date`.
2. **Approved** — `approved_at` date. While Pending: shows "with <approver name>" and the
   days since `submitted_at`; red when that is more than 3 days (builder's call on the
   exact threshold; use the same one the Alerts bell uses if it has one). While Draft or
   SentBack: shows "not submitted" / "sent back <date>".
3. **To Purchase** — `sent_to_purchase_date`.
4. **To supplier** — `sent_to_supplier_date`.
5. **Supplier reply** — supplier ETA (`eta_date`). Red with "N days past ETA" when the
   ETA has passed and the status is still `Sent to Supplier` / `Open`; green with the
   acceptance date once `supplier_acceptance` is set.
6. **FOC received** — only when `qd.foc` has rounds. Shows the latest round's promised
   ETA until received (red with days overdue, reusing `foc.daysOverdue`), then the
   received date.
7. **Trial** — only with FOC rounds. Shows "awaiting trial · N days in plant"
   (`foc.daysIdle`), then `Pass`/`Fail` with the date. A later attempt shows
   "attempt 2" under the label and the latest round's dates.
8. **Closed** — `closed_at`; label reads "Rejected" when status is Rejected.

Rules:
- Exactly one stop is *current*: the first stop whose date is missing (for FOC, the
  first incomplete step of the latest round). Current stop is highlighted; stops before
  it are filled; stops after it are dim.
- Settled QDs (status Closed / Rejected / Reference, or `closed_at` set) have **no**
  current stop: every stop is drawn filled, with "—" where a date is missing.
- Legacy and imported rows (author's call, no backfill): an Approved QD with null
  `approved_at` counts the Approved stop as done, dated by `sent_to_purchase_date`,
  else `raised_date`, shown as "approved" with "—" for the date. Any earlier stop with a
  missing date on an Approved QD is drawn filled with "—"; the current stop is the first
  missing date *after* Approved. `To Purchase` is always done on approval today
  (`approveQD` stamps it), which is intended; it stays a stop because the date matters.
- A stop is *late* (red) by the rules above and nowhere else; no new settings.
- Cancelled QDs show the strip greyed with a crossed-out final stop
  "Cancelled · <date>" and the reason underneath; no stop is current.
- The strip is read-only. Dates are edited in the tabs.
- On narrow widths (< 640px) the strip wraps to two rows; it never scrolls horizontally.

### Action row

Directly under the strip. Keeps every phase-1 block and its rules, unchanged in
behaviour:

- Draft / SentBack, raiser: "Finish and submit" / "Fix and resubmit" card with the
  missing list, Edit QD, approver select, Submit (disabled until complete).
- Pending, eligible approver: "Your decision" card with checks, Approve & next, Send back.
- Pending, others: "Awaiting approval from <name>" notice.
- Approved: Email supplier (primary while status is Open), Send reminder (unless closed),
  Resend to Purchase (approvers), Status select, "Next: QD …" at the right end.
- Any state: Preview QD form, Download QD PDF at the right end; Undo import for admins on
  imported QDs.

New in the row:

- **Record trial** when `foc.state === 'awaiting-trial'`, opening the existing
  `FocTrialModal` (a failed trial still asks where the QD goes next).
- **Cancel QD**, a quiet text link at the far right, when the state is Draft, Pending or
  SentBack and the user may cancel (below).

### Tabs

Five tabs below the action row. **Issue** opens first in every state (user's decision).
The selected tab is remembered per drawer open only, not across QDs.

- **Issue** — Quality issue (`issue_detail || issue_summary`), Manufacturing defect, Die
  performance, Recommended action, Outcome sought, Input at failure, Billet readings,
  Corrector. Editable in place only while Draft / SentBack, as today's fact cards.
- **Photos** — the profile image first, then every attached picture as a thumbnail grid
  (3 per row at full width); click opens the full image in a lightbox; PDFs and the
  Original QD form as a file chip under the grid. "Add file" lives here and keeps today's
  rule (any state; the builder may leave the known gap that approved QDs still accept
  files).
- **Supplier & FOC** — Supplier acceptance, Action taken, Supplier comments, Received by
  (supplier), ETA from supplier, QD requested / Sent to purchase / Sent to supplier dates
  with their existing "Nd after …" hints. Editable only when Approved (progress fields),
  as today. Below: the FOC rounds table from `FocRounds.jsx` (Round / Promised /
  Received / Trial / notes) with its banner; the banner's Record trial button is removed
  because it now lives in the action row.
- **Die** — die no, profile number, plant, supplier, die type if available on the row,
  and an "Open die order" button when `die_order_id` is set. Author's call: the button
  calls an `onOpenOrder(dieOrderId)` callback threaded from `DieOrderingSystem` through
  `QDTrackerPage`, which does what the search palette's `openSearchOrder` does (fetch
  or upsert the order into `data`, then `setSelectedOrder`), so the app-level order
  drawer opens with the normal edit-permission rules. The QD drawer closes first. No
  read-only order view local to the QD page.
- **Activity** — the existing timeline and the note composer, unchanged.

Sent-back reason banner: shown above the tabs while SentBack, as today.

## Cancel a QD

- Allowed states: Draft, Pending, SentBack. Approved QDs cannot be cancelled; an approved
  QD that should be withdrawn is set to status `Rejected` with a note, as today.
- Who: the raiser (`created_by`), any eligible approver (per `qdSettings.isApprover`), or
  an admin. Builder's call: a plain user who is neither cannot cancel someone else's QD.
- Flow: "Cancel QD" opens a small modal: one required reason line, a sentence saying the
  QD will leave the approval queue and that nothing is deleted, Cancel QD (danger) /
  Keep. No second confirm.
- Server: `POST /api/quality-discrepancies/:id/cancel { reason }` → sets
  `approval_state='Cancelled'`, `cancelled_by`, `cancelled_at`, `cancel_reason`; adds an
  activity row "cancelled QD — <reason>" (icon `undo`, tone `bad`). 400 without a reason,
  409 for an Approved (or already Cancelled) QD, 403 for a user who may not.
- Effect everywhere:
  - Register (`GET /`): cancelled rows are excluded by default; a "Show cancelled"
    toggle on the QD Tracker page includes them (query `cancelled=1`), rendered dim with
    a Cancelled chip. They never count in KPIs or supplier rollups.
  - Approval queue, Alerts bell (`listMyQueue`), Drafts view, FOC reminders,
    universal search: excluded. Search may still find a cancelled QD by die number when
    the user is its raiser or an admin (builder's call; excluding entirely is acceptable).
  - Work Queue: `work_queue_classify` (or whatever the SQL function in
    `server/migrations/20260921_work_queue.sql` is called) must return
    `terminal: 'cancelled'` for `approval_state = 'Cancelled'`, like Draft does today, in
    a new migration. Without it the row would surface as "Unknown QD Approval State".
  - Drawer: strip greyed with the Cancelled stop; action row shows only Preview /
    Download; tabs read-only; Edit, Submit, Add file, status changes all refused by the
    server (409) as for non-editable states.
  - Pending QD raised by someone else and cancelled by an approver: the raiser gets the
    same notification path a send-back gets (whatever that is today; if send-back has
    none, cancel has none).
- Numbered Pending / SentBack QDs from before this change (submit used to issue the
  number) **keep their number when cancelled** (user's decision, 2026-11-03). The
  cancelled row shows it under "Show cancelled" and the number is a permanent gap, like a
  Rejected QD's. Cancel never clears `qd_no`.
- `APPROVAL_STATES`, `nextApprovalState` and the frontend badge map
  (`src/utils/constants.js`) gain Cancelled. `EDITABLE_APPROVAL_STATES` does not.

## QD number issued on approval

Today `POST /:id/submit` computes `nextQdNo(client, supplier)` and
`submitForApproval` stores it; the number appears on Pending QDs. Change:

- `submitForApproval` no longer takes or stores a number. `qd_no` stays `NULL` through
  Draft, Pending and SentBack. (`qd_no` is already nullable; the `UNIQUE` constraint stays.)
- `approveQD` (inside the existing transaction in `POST /:id/approve`) computes the
  number with `nextQdNo` **if `qd_no` is null** and writes it with the approval. The
  number is computed under a per-prefix advisory lock
  (`pg_advisory_xact_lock(hashtext('<year><code>'))`) so two approvers cannot read the
  same max; the 23505 → 409 "please retry" handling moves from the submit route to the
  approve route. The year in the number is the approval year.
- Approve's activity row reads "approved QD 2026PD-07"; submit's reads "submitted QD
  against die <die_no> for approval to <name>".
- Existing rows: Pending and SentBack QDs that already carry a number keep it;
  `approveQD` only assigns when null. Nothing is backfilled or renumbered.
- Everywhere an unnumbered QD is shown: `qd_no || <fallback>` where the fallback is
  "Unnumbered" in registers and chips, `QD · unnumbered` in the drawer header,
  "Draft QD" stays for Drafts in the search palette (existing). Lists that sort by
  `qd_no` put unnumbered rows last. The approval queue banner and the Alerts bell show
  die number + "raised <date> by <name>" instead of the number.
- PDF: `qdPdf.cjs` prints "Not yet numbered" in the QD No box when `qd_no` is null. This
  can only happen in the in-app preview and Download, because the Purchase email and the
  supplier email already require Approved.
- `QD requested` date and `sent_to_purchase_date` behaviour are unchanged.
- The "Next: QD …" button and Approve & next show the die number for an unnumbered next
  QD.
- Tests: `qualityDiscrepancies.test.cjs` submit tests drop `newQdNo`; new tests: approve
  assigns a number when null, keeps an existing one, submit leaves `qd_no` null; route
  test for the 23505 path on approve; cancel route tests (400/403/409/200); work-queue
  classification of Cancelled if the SQL functions are unit-tested anywhere (if not, a
  manual check on the test server is enough).

## Constraints

- Frontend: React, inline styles with the `theme` object and existing helpers
  (`secondaryBtn`, `primaryBtn`, `stepCard`, `sectionLabel` patterns) in
  `QDDetailPanel.jsx`; icons from `lucide-react`. Keep the file's comment style.
- Backend: `.cjs`, Express, `pg`; tests with `node:test` and the fake DB in
  `testSupport.cjs`. Schema changes go in `server/db.cjs` ensure-column blocks
  (`cancelled_by INTEGER`, `cancelled_at TIMESTAMPTZ`, `cancel_reason TEXT`) plus a new
  SQL migration file for the Work Queue function.
- Repo files are CRLF.
- Behaviour on the test server is checked by the scratch-stack recipe in memory
  (`qd-approval-ux-phase1`): throwaway DB, backend image with `server/` mounted, `vite
  preview`.
- Commit and merge only when the user says so; GitHub push is blocked.

## Left to the builder

- Exact visual treatment of the strip (dot sizes, colours from the theme, how "late" red
  and "done" green are drawn), tab control styling, lightbox implementation (a simple
  fixed overlay is fine; no new dependency).
- Where the "Show cancelled" toggle sits on the QD Tracker page.
- Whether `FocRounds.jsx` is reused inside the Supplier & FOC tab or inlined.
- Whether the journey strip is its own component (`QdJourneyStrip.jsx`) — recommended.
- Component split of the tabs.
- The Pending lateness threshold on the Approved stop (default 3 days).
- How the order drawer and QD drawer coexist when "Open die order" is clicked.

## Done looks like

- All `node --test` suites pass, including the new ones.
- On the scratch stack: a Draft shows the strip with Raised only, Cancel works with a
  reason and the QD disappears from the register until "Show cancelled"; a Pending QD
  shows no number anywhere, approving it issues the next number for its prefix and the
  Purchase email carries it; a FOC QD shows the FOC and Trial stops and Record trial in
  the action row; the Work Queue shows no row for a cancelled QD.
- The register, Alerts bell and search palette render unnumbered QDs without "null" or
  blank labels.
