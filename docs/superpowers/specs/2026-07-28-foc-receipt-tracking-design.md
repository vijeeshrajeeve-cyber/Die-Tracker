# FOC receipt & trial tracking — design

**Date:** 2026-07-28
**Status:** implemented

## Problem

The QD Tracker could show what a supplier had *promised* against an accepted
free-of-charge replacement, but not what had *arrived*.

- `FOC Accepted` required an ETA and stayed open, and `etaDisplay()` printed
  `Overdue` once that ETA passed — so an outstanding promise was visible.
- Nothing recorded the replacement landing. `die_received_date` is Part A of the
  QD form (when the *original* die was received, captured at raise time).
- The only exit from `FOC Accepted` was a manual jump to `Closed`, which
  collapsed "the die arrived" and "the claim is signed off" into one event and
  lost the arrival date entirely.
- The "FOC recovered" KPI counted QDs *accepted* this FY and labelled them
  "dies + mandrels this FY" — it reported promises as recoveries.

So a die could sit on the shop floor, untrialled, while the tracker showed it as
still at the supplier, and nobody was told.

## Decisions taken

1. **Arrival is not closure.** A received replacement is trialled before the QD
   can close.
2. **A QD loops.** When a replacement fails its trial the *same* QD goes back
   for another one, so one QD can hold several receipt-and-trial rounds.
3. **A failed trial does not auto-transition.** The user picks the QD's next
   status and gives a reason, recorded together with the verdict.
4. **Scope:** on-screen panel + supplier chaser + internal chaser.

Decision 2 rules out storing receipts as columns on `quality_discrepancies` —
round 2 would overwrite round 1 and destroy the evidence of a supplier who has
sent two bad dies against one claim.

## Data model

New status **`FOC Received`** between `FOC Accepted` and `Rejected`, meaning
*in plant, not yet trialled*. Because `NOT_OPEN_STATUSES` is a subtraction list
it counts as open automatically, and `SETTLED_STATUSES` is untouched so it does
not stamp `closed_at` or skew average resolution.

New table `qd_foc_rounds` (one row per attempt), cascading from the QD and
unique on `(qd_id, round_no)`:

| column | meaning |
| --- | --- |
| `promised_eta` | the date the supplier committed to |
| `accepted_at` | when the FOC was accepted |
| `received_date`, `received_by` | when it physically arrived, and who logged it |
| `trial_date`, `trial_result`, `trial_notes` | the verdict — `Pass` or `Fail`, DB-constrained |

`qdFocRounds.cjs` owns rounds and knows nothing about status vocabulary;
`qualityDiscrepancies.cjs` owns statuses and requires it (never the reverse).

## Lifecycle

| Transition | Rule |
| --- | --- |
| → `FOC Accepted` | ETA mandatory (pre-existing). Opens a round; re-accepting with a revised date moves the open round's ETA rather than opening a phantom one. |
| → `FOC Received` | `receivedDate` mandatory. Refused unless a round is awaiting delivery, so the status can never mean "a die arrived against nothing". |
| Record trial | `POST /:id/foc-trial`. Closes the open round. Refused before receipt, or dated before it. |
| Trial = `Fail` | `nextStatus` + `reason` required in the same request. Picking `FOC Accepted` fires the existing ETA rule and opens the next round. |
| Trial = `Pass` | QD stays put, flagged *ready to close*; closure is a deliberate step. |

Every one of these throws inside the route's transaction, so an impossible move
rolls the status change back with it.

## What is visible

- **`FocPendingPanel`** on the QD tab, above the filter bar: *awaiting receipt*
  (with signed days-overdue, worst first) and *in plant, awaiting trial* (with
  days idle, longest first). A count of zero is shown, not hidden — it is itself
  the answer to "what is pending".
- **`FocRounds`** in the QD detail panel: one line per attempt, plus a plain
  statement of what is outstanding now, and a *Record trial* button when one is
  due. Renders nothing when no FOC was ever accepted.
- Receipt is also reachable from the ordinary status dropdown, through the same
  server path — there is no second way for the data to get in.
- CSV export gains `FOC attempts`, `FOC promised`, `FOC received`, `FOC trial`.
- **KPI corrected:** `focRecovered` now counts rounds that were received *and*
  passed, within the FY. New tiles' worth of counts (`focAwaitingReceipt`,
  `focOverdue`, `focAwaitingTrial`) feed the panel.

## Chasers

`focReminder.cjs`, following the `designReminder.cjs` pattern (per-minute tick,
once-a-day at a configured time, `last_run` compared by day so a run missed
while the server was down goes out on the next tick).

- **Supplier** — one mail per supplier listing replacements past the ETA *they*
  gave, with the attempt number so a repeat failure is not glossed over.
- **Internal** — one mail to the configured owner covering both buckets. A day
  with nothing outstanding sends nothing.

Both skip settled QDs (`Closed`/`Rejected`/`Reference`) and drafts, and read
only the newest round. Configured in Email Settings; both need SMTP enabled, and
the internal one refuses to be turned on without a recipient.

## Migration

QDs already on `FOC Accepted` get a backfilled round 1 carrying `eta_date`.
Everything else stays NULL — `accepted_at`, the arrival and the trial were never
recorded, and inventing them would put dates in the tracker that nothing on the
shop floor ever produced. Idempotent via `NOT EXISTS`, so it is safe on every
startup. Verified against the live database in a rolled-back transaction: the
DDL applies cleanly and backfills 0 rows, since no QD is currently at
`FOC Accepted`.

## Testing

36 new tests (`qdFocRounds.test.cjs`, `focReminder.test.cjs`) plus updated
`qualityDiscrepancies.test.cjs` — 193 passing. They cover the round lifecycle
and its refusals, the loop, signed overdue arithmetic, the pending buckets and
their sorting, the chaser SQL guards, and HTML escaping in both mail bodies.
