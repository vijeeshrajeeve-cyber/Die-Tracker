# Sample Remark — Design

Date: 2026-09-06
Status: Approved for implementation

## Problem

The Remark column on the Sample Followup page shows, for every die that came
through the order flow, the die order's own `Remark` — the general note typed
on the Add Order form, and the place the PDF import writes its re-order notes.
Editing the cell on the Sample Followup page overwrites that order-level note.

The people working the Sample Followup page need a place for notes about the
sample itself (trial observations, what the corrector asked for, why a sample
is on hold). Today they either overwrite the order remark or have nowhere to
write. The two kinds of note must be kept apart.

## Scope

In scope: a dedicated sample remark for dies sourced from `die_orders`, shown
and edited in the Sample Followup page's Remark column and record modal, and
carried through the die-orders export and the automatic backup.

Out of scope: any change to the die order's `Remark` (it keeps its meaning and
its place on the Add Order form and in PDF import), any change to standalone
`sample_followups` rows (their `remark` column is already sample-specific), and
copying existing order remarks into the new field. The values there today are
order remarks — the user's own description of the problem — so they stay where
they are, and the Sample Followup column starts empty for order-sourced rows.

## The field

A new nullable text column `sample_remark` on `die_orders`, display key
`Sample Remark` on the API, added the same way every other sample-stage column
was: an idempotent `ADD COLUMN IF NOT EXISTS` in `server/db.cjs`, mirrored in
`init.sql`.

The Sample Followup page reads `Sample Remark` when it builds its merged view
from orders, and writes `Sample Remark` — never `Remark` — from the inline cell,
the record modal, and the "clear sample followup" action. The die order's
`Remark` is no longer visible or reachable from that page.

Standalone records are untouched: their `remark` still maps to the same merged
`remark` key, so the column, the export sheet and the modal need no per-source
branching.

## Data flow

```
Sample Followup page ── 'Sample Remark' ──► PATCH /api/orders/:id ──► die_orders.sample_remark
                    ── remark ───────────► PUT  /api/sample-followups/:id ──► sample_followups.remark (unchanged)
Add Order form ────── 'Remark' ──────────► die_orders.remark (unchanged)
```

Inline saves go through the existing `handleInlineFieldSave`, so each edit
lands in `order_changes` under the field name `Sample Remark`, alongside the
audit entries the page already writes for dates and status.

## Touch points

- `server/db.cjs`, `init.sql`: column.
- `server/routes/orders.cjs`: validation, GET mapping, INSERT, PATCH map, PUT.
- `server/routes/export.cjs`, `server/services/autoBackup.cjs`: `sample_remark`
  → `Sample Remark` column lists, so exports and backups carry the field.
- `src/DieOrderingSystem.jsx`: merged view reads `o['Sample Remark']`.
- `src/pages/SampleFollowupPage.jsx`: modal/inline/clear write `Sample Remark`.

## Testing

There is no pure logic here to unit-test; the change is wiring. Verification is
lint on the touched files, a production build, and a smoke test against the
local test stack: rebuild the backend so the migration runs, confirm the column
exists, save a sample remark from the page and confirm `die_orders.remark` is
unchanged while `sample_remark` holds the new text.
