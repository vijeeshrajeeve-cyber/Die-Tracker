# QD "Any Delay Observed" — Yes/No with details — design

**Date:** 2026-07-27
**Status:** Approved

## Problem

`any_delay_observed` is a free-text box in the Production parameters grid of the
Raise/Edit QD form ([RaiseQDModal.jsx](../../../src/components/qd/RaiseQDModal.jsx)),
stored as TEXT per billet in `qd_billet_parameters`.

Two problems with it as it stands:

1. **It is really a yes/no question asked with a text box.** Every value in the
   database today is `YES` or `NO` — users are hand-typing the answer, with no
   agreed casing and no way to filter on it later.
2. **When the answer is yes, there is nowhere to say what the delay was.** The
   single box holds the answer or the explanation, never both.

It is also never printed. The PDF's Production Parameters table
([qdPdf.cjs](../../../server/services/qdPdf.cjs) `pcols`) ends at "Ram", so the
answer is captured and then seen only by someone reopening the form.

## Decisions

Settled before design (user choices):

1. **A new column for the details.** `any_delay_observed` keeps holding only the
   answer; the explanation goes in its own column. Reusing one column to hold
   `"Yes - <details>"` would make the answer unfilterable and force the edit form
   to parse its own output back apart.
2. **Per billet, as today.** 1st Billet and Last Billet each get their own answer
   and their own details. The field stays in `qd_billet_parameters`; nothing about
   how the data is keyed changes, and the four existing values keep their meaning.
3. **It starts printing on the QD PDF.** Details nobody downstream can read are
   not worth typing.
4. **No backfill and no normalising UPDATE.** Existing `YES`/`NO` values are read
   case-insensitively by the form; canonical `Yes`/`No` is written from now on.

## Data model

One new column on `qd_billet_parameters`:

| Column              | Type | Null     | Notes                                            |
| ------------------- | ---- | -------- | ------------------------------------------------ |
| `any_delay_details` | TEXT | nullable | The explanation. Meaningful only when `any_delay_observed` is `Yes`. |

`any_delay_observed` is unchanged (TEXT, nullable) and from now on holds exactly
`Yes`, `No`, or NULL.

Added as an idempotent `DO $$ ... IF NOT EXISTS ... ALTER TABLE` block in
[server/db.cjs](../../../server/db.cjs) alongside the other QD migrations, and
mirrored into [init.sql](../../../init.sql) for fresh installs.

Nullable, with no `CHECK` constraint on `any_delay_observed`. The four rows that
predate this feature hold `YES`/`NO` in the wrong casing, and a constraint would
reject them on the next save of an unrelated field.

## Server

`BILLET_COLS` in
[qualityDiscrepancies.cjs](../../../server/services/qualityDiscrepancies.cjs)
gains `any_delay_details`. That single array drives the INSERT column list, the
`ON CONFLICT DO UPDATE` set, and `hasAnyValue`, so persistence and load need no
other change.

`hasAnyValue` then treats a row carrying only details as non-empty, which is
correct: the row must survive to be corrected, not be silently deleted.

No route changes. `POST /` and the edit PUT already forward the whole `billets`
object to `saveBilletParameters`.

## Form

In [RaiseQDModal.jsx](../../../src/components/qd/RaiseQDModal.jsx):

- The `BILLET_FIELDS` entry for `any_delay_observed` is marked as a yes/no field
  so the grid renderer special-cases it instead of rendering `<input>`.
- The grid is `repeat(auto-fit, minmax(130px, 1fr))`. A 130px cell cannot hold a
  Yes/No control plus a details box, so this field spans the full row with
  `gridColumn: '1 / -1'`.
- The control is the existing `yesNo` pill toggle already used for Manufacturing
  Defect and Die Performance in the Discrepancy section. Radio inputs would be
  the only ones in the form; the pill toggle keeps one Yes/No idiom throughout.
- Reading an existing value compares case-insensitively so the legacy `YES`/`NO`
  rows show as selected. Writing always stores `Yes` or `No`.
- Answering **Yes** reveals a details textarea bound to `any_delay_details`.
- Answering **No**, or clearing the answer, clears the details, so an explanation
  cannot survive under a "No".

Both the raise and edit paths use this same component, so both get the control.

## PDF

The Production Parameters table is nine fixed-width columns across 535pt; a tenth
would squeeze all of them below legibility. Instead, one wrapped line is drawn
directly under the table using the existing `drawWrapped` helper:

```
Delay observed — 1st billet: No · Last billet: Yes — press held 20 min for billet change
```

- A billet with no answer is omitted from the line.
- If neither billet has an answer, the line is not drawn at all and `y` is
  untouched, so PDFs for existing QDs are byte-comparable to what they are today.
- Details are appended after the answer only when the answer is `Yes`.

## Testing

- `server/services/qualityDiscrepancies.test.cjs` — extend the existing billet
  tests: `any_delay_details` round-trips through save/load, and a billet carrying
  only details is not deleted as empty.
- `server/services/qdPdf.test.cjs` — the delay line renders when either billet has
  an answer; nothing is drawn when neither does.
- Frontend has no component test framework (see the project's dev-workflow notes):
  verify with `npm run lint` and `npm run build`, then exercise the real form in
  the browser — set Yes on one billet with details, No on the other, save, reopen
  the draft, and confirm the values survive and the PDF line reads correctly.

## Out of scope

- No delay column on the QD Tracker table and none in the CSV export.
- No filtering or KPI by delay.
- No backfill or re-casing of the four existing `YES`/`NO` values.
