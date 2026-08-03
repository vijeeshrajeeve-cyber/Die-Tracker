# Sample Followup Excel backfill — design

**Date:** 2026-08-03
**Status:** approved for planning

## Problem

The Sample Followup page is effectively empty. Only 2 die orders qualify to appear on
it, and the `sample_followups` table has 0 rows. Meanwhile sample progress for the last
nine months has been tracked by hand in an Excel sheet (224 rows, 2025-10-24 →
2026-07-31).

This is a **one-time backfill**. Once the historical data is in, the app becomes the
system of record and the sheet is retired. Nothing about this work ships to the running
application.

## Goals

- Bring the sample data the team already recorded in Excel into `die_orders`, so the
  Sample Followup page reflects reality.
- Never destroy data a person entered in the app.
- Produce a reviewable account of exactly what changed, and what did not.

## Non-goals

- No UI, no API route, no schema migration, no ongoing import capability.
- No creation of die orders that do not already exist (see Decision 2).
- No editing of order fields outside the five sample fields.

## Source data

`Sample.xlsx`, single sheet `Sample Followup`, 224 data rows, 9 columns:

| Column | Notes |
|---|---|
| `Die` | Die number. Two formats: `027048-2502` and `030625-701`. No duplicates in the sheet. |
| `Plant` | Always `GEX 2`. Not imported — cross-check only. |
| `Supplier` | 10 distinct values. Not imported — cross-check only. |
| `Die Received Date` | Excel serial. Present on all 224 rows. |
| `Ascona Ref` | Always `Yes`. Not imported. |
| `Submission Date` | Excel serial. Present on 223 rows; one row holds `0`. |
| `Sample Approval Date` | Excel serial. Blank on 9 rows. |
| `No. of Trial` | Integer 0–7. |
| `Corrector` | 5 distinct names; some carry trailing spaces. |

### Match analysis against the test database

> **These figures come from the local test server, not production.** They were
> gathered on 2026-08-03 to design and rehearse the import. The match rate, the
> unmatched list, and the status observations below are properties of that
> snapshot. Re-derive them from a production dry run before drawing any
> conclusion about production data. See `import-reports/README.md`.

Run 2026-08-03 against 659 die orders (644 distinct die numbers):

- **192 of 224 sheet rows match** a die order on die number.
- **32 do not match.** Predominantly the short-suffix family (`007122-703`,
  `030620-701`, `032068-701`). 18 of the 32 share a prefix with some order in the
  database under a different suffix.
- **All 192 matched orders have all five sample fields empty.** The import therefore
  only ever fills blanks; it will not overwrite a single existing value.
- 7 sheet dies match two orders each. In every case the newer order is `CANCELLED` and
  the older is `DONE`.

## Mechanism

A standalone Node script following the existing `server/scripts/import-qd-sheet.cjs`
pattern — same `xlsx` dependency, same `--dry-run` flag:

```
node server/scripts/import-sample-followup-sheet.cjs <sheet.xlsx> [--dry-run]
```

Run once from the server host. No application code is modified.

## Matching

Compare sheet `Die` against `die_orders.die_no` on a normalized form: trimmed,
uppercased, all whitespace removed.

**Orders with `status = 'CANCELLED'` are excluded from matching.** This is not a
tie-break heuristic but a correctness rule: all 7 duplicate cases pair a live `DONE`
order against a cancelled re-order, and the sample data belongs to the live one.
Excluding cancelled orders resolves every ambiguity (0 dies left matching more than one
order) and independently reduces sheet-vs-app supplier disagreements from 8 to 1.

If a die still matches more than one live order after that exclusion, the script
**skips the row and reports it** rather than guessing. If a die matches only cancelled
orders, it is likewise skipped and reported.

Dies with no match are skipped and listed (Decision 2).

## Write rules

| Sheet column | `die_orders` column |
|---|---|
| Die Received Date | `die_received_date` |
| Submission Date | `submission_date` |
| Sample Approval Date | `sample_approval_date` |
| No. of Trial | `no_of_trial` |
| Corrector | `corrector` |

**A value in the sheet overwrites the app; a blank sheet cell changes nothing.** A blank
cell is omitted from the `UPDATE` altogether — the column is not named in the statement,
so it is neither set to `''` nor to `NULL`. This matters: despite what `init.sql` says,
the live database has
`die_received_date`, `submission_date`, and `sample_approval_date` as `date` columns,
where `''` raises `invalid input syntax for type date`.

Dates accept Excel serials and typed text (`12/03/2026`, `2026-03-12`), normalized to
`YYYY-MM-DD` to match what `sanitizeDate` in `server/routes/orders.cjs` produces.
Non-positive or unparseable serials are treated as blank. Corrector values are trimmed.

`plant`, `supplier`, `ascona_reference`, `press`, `customer_name`, `remark`, and all
ordering-stage dates are untouched.

`delay` needs no write: the page computes Delay Days at render from received and
submission dates (`src/pages/SampleFollowupPage.jsx:401`).

### Status derivation

The sheet has no status column. `sample_status` is derived from the dates in play —
approval date present → `Approved`; else submission date present → `Sample Submitted`;
else left unchanged. The derivation only ever *upgrades*: it will never downgrade or
clear a status a person set by hand.

## Report

`--dry-run` writes nothing and prints the full plan — per die, the before → after for
each field — plus five summary lists:

1. **Matched and changed**, with counts per field.
2. **Matched but already identical** (no-op rows).
3. **Not found in the app** — the 32 dies, listed in full for manual follow-up.
4. **Ambiguous** — dies matching several live orders, or only cancelled ones.
5. **Data warnings** — unparseable dates, and sheet-vs-app disagreements on plant or
   supplier (reported, never written; currently just `018114-802`, sheet `COMPES` vs app
   `PDTMC`).

The live run prints the same report and writes it to a timestamped file.

The script is idempotent: a second run over the same sheet computes the same values and
reports every row as a no-op.

## Safety

- All updates run inside **one transaction**; any error rolls back the whole import
  rather than leaving it half-applied.
- A `pg_dump` of the database is taken **before** the live run.
- The script never issues `DELETE`, and never issues an unscoped `UPDATE` — every
  statement is keyed to a specific order id.

## Expected outcome

The Sample Followup page goes from 2 rows to ~194. All 192 matched orders gain a die
received date, which is what makes them appear on the page
(`src/DieOrderingSystem.jsx:1755`). The 32 unmatched dies remain absent and must be
handled separately if wanted.

## Testing

Unit tests in `node:test` (this project's runner) over the pure functions:

- **Date parsing** — Excel serial, `DD/MM/YYYY` text, ISO text, blank, `0`, negative,
  non-numeric garbage.
- **Die normalization** — case, leading/trailing space, internal space.
- **Status derivation** — approval wins over submission; neither present leaves status
  untouched; an existing hand-set status is never downgraded.
- **Blank-cell rule** — a blank sheet cell produces no field in the update payload.
- **Order selection** — cancelled orders excluded; single live order chosen; several
  live orders reported as ambiguous rather than picked.

End-to-end verification is the dry run against the real sheet, whose expected shape is
known: 192 matched, 32 not found, 0 ambiguous, 1 supplier warning.

## Decisions

1. **Existing orders are updated in place; no new die orders are created.** (User, C.)
2. **Dies not found in the app are skipped and reported, not created as standalone
   `sample_followups` records.** (User, A.) The user judged these 32 dies not worth
   tracking. Consequence: the page will hold 192 of the sheet's 224 rows.
3. **Sheet wins where it has a value; blank cells leave the app alone.** (User, A.)
   Moot in practice for this sheet, since all matched orders are empty.
4. **`sample_status` is derived from dates**, upgrade-only. (User.)
5. **Cancelled orders are excluded from matching.** Derived from the data, and it
   supersedes an earlier "most recent order wins" proposal, which the data showed to be
   wrong in all 7 duplicate cases.
