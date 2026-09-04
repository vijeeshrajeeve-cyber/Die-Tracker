# Sample Trial Recording — Design

Date: 2026-09-04
Status: Approved for planning

## Problem

Sample Followup records how many trials a die went through — a single integer,
`No of Trial`, typed by hand into the row. The number survives; everything that
would make it useful does not. Which trial failed, when it ran, why it failed,
what the corrector observed: none of it is captured anywhere.

That costs twice. Day to day, nobody can answer "what happened on trial 3?"
without asking the person who ran it. Over a year, there is no way to see that
one supplier's dies keep failing on dimension while another's keep choking —
the evidence exists only in people's memory, so it never reaches a supplier
review.

This design records each trial as its own fact: when it ran, whether it passed,
why it failed if it did, and any comment worth keeping.

## Scope

In scope: logging trials against a Sample Followup record, a fixed failure-reason
vocabulary, deriving the trial count from the log, and exporting trial history.

Out of scope: changing the Sample Status workflow (a failed trial does **not**
automatically move a record to Rejected — status stays a human decision), trial
analytics or charts, and any link between these trials and the FOC trial rounds
in QD Tracker. Those are separate features against separate records; conflating
them would be wrong.

## Data model

One new table. Each trial is a row.

```sql
CREATE TABLE IF NOT EXISTS sample_trials (
    id                 SERIAL PRIMARY KEY,
    die_order_id       INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
    sample_followup_id INTEGER REFERENCES sample_followups(id) ON DELETE CASCADE,
    trial_no           INTEGER NOT NULL,
    trial_date         DATE NOT NULL,
    result             TEXT NOT NULL CHECK (result IN ('OK', 'Not OK')),
    fail_reason        TEXT,
    comments           TEXT,
    created_by         INTEGER REFERENCES users(id),
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Exactly one parent. A trial belongs to one die, never to none or both.
    CONSTRAINT sample_trials_one_parent CHECK (
        (die_order_id IS NULL) <> (sample_followup_id IS NULL)
    ),

    -- A reason is required precisely when the trial failed, and meaningless
    -- when it passed. Enforced here so no code path can store a half-state.
    CONSTRAINT sample_trials_reason_matches_result CHECK (
        (result = 'Not OK' AND fail_reason IS NOT NULL)
        OR (result = 'OK' AND fail_reason IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_trials_order_no
    ON sample_trials(die_order_id, trial_no) WHERE die_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_trials_sf_no
    ON sample_trials(sample_followup_id, trial_no) WHERE sample_followup_id IS NOT NULL;
```

### Why two parent columns

Sample Followup rows are a merge of two tables, done in `DieOrderingSystem.jsx`:
dies that came through the order flow live in `die_orders`, and records added by
hand on the page live in `sample_followups`. A trial therefore has two possible
parents.

The alternative — one generic `parent_id` plus a `parent_type` string — was
rejected. Postgres cannot enforce a foreign key on it, so nothing stops a trial
pointing at a die that no longer exists, and cascade deletion has to be
hand-written in application code and remembered forever. Two real foreign keys
plus a check constraint give the database the whole rule.

### Migration

Idempotent DDL in `server/db.cjs`, following the pattern already used there for
every other schema change. No data migration: no existing trial rows are
invented (see below).

## Trial count becomes derived

`No of Trial` stops being an input and becomes read-only text.

193 existing followup records carry a typed-in count with no trial detail behind
it. Those numbers are not discarded, and equally they are **not** turned into
fabricated trial rows — a row claiming a trial happened on an unknown date with
an unknown result is worse than no row, and the same no-fabricated-numbers rule
already applies in QD Tracker.

The displayed count is therefore:

- **any trials logged** → the live count, shown normally
- **no trials logged** → the old typed number, shown greyed out as legacy data

Once someone logs the first real trial for a die, the legacy number stops being
shown for that die. The underlying `no_of_trial` column is left in place and is
no longer written to by the UI.

## Failure reasons

A fixed list in code, one reason per trial, required when the result is Not OK:

1. Shape
2. Dimension Out of Spec
3. Aesthetic Out of Spec
4. Die Choked
5. Manufacturing issue
6. Other

`Other` exists so a novel failure is never mis-filed under a reason that does not
fit; the person explains in Comments. If `Other` starts appearing often, that is
the signal the list needs a new entry.

Defined as a single exported constant shared by the frontend dropdown and the
backend validator, so the two can never disagree about what is allowed.

## User interface

The eye icon on a Sample Followup row already opens that record. It gains a
**Trials** section below the existing fields.

**The list** — one line per trial: `#`, Date, Result, Reason, Comments. Newest
last, in trial order. Empty state: "No trials logged yet."

**Add Trial** — Date, Result, Reason, Comments.

- Date will not accept a future date. A trial is something that happened; a
  future date is a typo.
- Reason appears only when Result is Not OK, and is required then.
- Comments is optional free text.

**Trials save immediately on add**, not when the record's Save button is pressed
— they are their own records with their own endpoint. The section is labelled so
this is visible rather than surprising.

**On an unsaved new record** the section shows "Save the record first to log
trials", because there is no parent row to attach a trial to yet.

**Permissions** — anyone who can edit a followup can add a trial; only an admin
can delete one. This matches how delete already works on this page, and reflects
that a trial is a record of something that happened: removing it should be
deliberate.

**"Clear sample followup data" does not delete trials.** On an order-sourced row
the delete button clears the sample fields and keeps the underlying die order.
Trial history survives that, for the same reason trials are admin-only to
delete: the dates and failures still happened. Deleting the die order itself
still cascades the trials away, as it should. The confirmation wording is
updated to say so, since it currently promises that "trial fields are reset".

## API

A new `server/routes/sample-trials.cjs`, mounted at `/api/sample-trials`:

- `GET /` — every trial, for the page to group by parent
- `POST /` — create; server assigns `trial_no` as the parent's current max + 1
- `PUT /:id` — edit date, result, reason, comments
- `DELETE /:id` — admin only

Fetching all trials in one call mirrors how standalone followups are already
fetched wholesale. At this volume anything cleverer is not worth the complexity.

`trial_no` is assigned server-side, never accepted from the client, so two
people adding a trial at once cannot both claim the same number.

Validation lives in a `server/services/sampleTrials.cjs` module holding the pure
logic — reason vocabulary, the reason-matches-result rule, the future-date rule,
next trial number — with the route staying thin. This follows `qdFocRounds.cjs`,
the closest existing precedent, and makes the rules testable without a database.

## Export

The Sample Followup Excel export keeps its current columns and its current
sheet unchanged. A second sheet, **Trials**, is added: Die, Profile, Plant,
Supplier, Trial No, Trial Date, Result, Reason, Comments — one row per trial
across everything currently filtered on screen, so the export matches what the
user is looking at.

## Testing

`node --test`, per the project's existing setup, against
`server/services/sampleTrials.test.cjs`:

- a Not OK trial without a reason is rejected
- an OK trial carrying a reason is rejected
- a reason outside the fixed list is rejected
- a future trial date is rejected; today is accepted
- next trial number is max + 1, and 1 for a die with no trials
- the derived count prefers logged trials and falls back to the legacy number
  only when there are none

## Risks

**Trials save on add, the rest of the record on Save.** Two save models in one
modal can confuse. Mitigated by labelling, not by deferring trial saves — a
child record queued in memory until the parent is saved is a worse trade.

**The legacy count fallback is a transitional state.** For a while some rows show
a real count and some show a greyed-out legacy number. This is honest about what
is known and what is not, and resolves itself as trials get logged.
