# Corrector Master List — Design

**Date:** 2026-08-04
**Status:** Approved, ready for planning

## Problem

`Corrector` is a free-text field in five places across the app. Nothing constrains
what gets typed, so the same person is recorded under different spellings and
non-names get stored outright. On the test server the `quality_discrepancies`
table already holds `abcd`, `1234` and `vijeesh` alongside the real names, and
the QD modal's own placeholder reads `e.g. Sijith` while every stored row says
`Sujith` — the typo risk is built into the hint text.

Because corrector is a reporting dimension (it is exported to Excel, printed on
the QD PDF, and searched on the Sample Followup page), every spelling variant
silently splits one person's work across two buckets.

## Goal

Replace free-text corrector entry with a selection from an admin-maintained
master list, so a corrector name can only ever be one of a known set of values.

## Non-goals

- Rewriting corrector values already stored. History stays as it is.
- Constraining the importers (`PDFImportModal`, the sample-followup Excel
  importer). They carry whatever the source document says. Deciding whether bad
  import values should be rejected or mapped is a separate piece of work.
- Linking correctors to application user accounts. A corrector is a name on a
  list, not a login.

## Decisions

| Question | Decision |
|---|---|
| Where does the list live? | DB table with admin CRUD in Settings, matching `plants` / `suppliers` / `presses` |
| How strict is the field? | Dropdown only on all five entry points. The Settings card is the single place a name is ever typed, and only an admin can reach it |
| Existing non-matching values? | Left stored and displayed as-is; corrected when someone next edits the record |
| Plant-specific? | Yes. Each corrector belongs to a plant, and the dropdown filters by it |
| Seed data | Kailash, Jaypee, Raheem, Sujith, Dinesh — all on GEX 2 |

## Data model

```sql
CREATE TABLE IF NOT EXISTS correctors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    plant TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, plant)
);
```

Seeded with the five known names on `GEX 2`.

**The three existing `corrector TEXT` columns are left untouched — no foreign
key is introduced.** `die_orders.corrector`, `sample_followups.corrector` and
`quality_discrepancies.corrector` continue to store a plain name string.

This is deliberate. An FK would require rewriting every historical row, which is
explicitly out of scope, and the QD PDF, the email templates and the Excel
exports all consume the name as a string today. The master list therefore
governs *what can be entered* while storage stays denormalised. The safety comes
from closing the input path, not from a database constraint.

`UNIQUE (name, plant)` lets a corrector who covers two plants exist as two rows.
That avoids a join table for a case that may never arise, and can be revisited
if multi-plant coverage becomes common.

Migration goes into `server/db.cjs` as an idempotent `DO $$ ... IF NOT EXISTS`
block alongside the existing ones, and is mirrored into `init.sql` for fresh
installs.

## Backend

**`server/routes/correctors.cjs`**, modelled on `server/routes/suppliers.cjs`:

| Route | Auth | Behaviour |
|---|---|---|
| `GET /` | any authenticated user | Returns correctors ordered by name. `?plant=X` filters to that plant; `?includeInactive=true` returns deactivated rows for the Settings screen |
| `POST /` | admin | Creates a corrector. Name is trimmed and required; blank is rejected with 400. A duplicate `(name, plant)` is rejected with 409 |
| `PUT /:id` | admin | Renames, moves plant, or toggles `is_active` |
| `DELETE /:id` | admin | **Deactivates — sets `is_active = false`.** Never removes the row |

`DELETE` is a soft delete because historical dies reference the name. Hard
deletion would leave records pointing at a corrector who no longer appears
anywhere, and would make a departure silently rewrite the past.

Registered in `server/index.cjs` as `app.use('/api/correctors', correctorsRouter)`,
next to the other master-data routes.

Names are stored trimmed but **not** upper-cased. `suppliers` upper-cases because
supplier codes are uniformly capitalised; these are people's names and should
display as written.

## Frontend

### `correctorsAPI`

Added to `src/api.js` following the `suppliersAPI` shape: `getAll(params)`,
`create`, `update`, `delete`.

### `CorrectorSelect` component

One shared component in `src/components/ui/`, used by all five call sites:

```
<CorrectorSelect value={...} onChange={...} plant={...} required={...} />
```

A single component means the filtering and fallback rules cannot drift apart
between pages as the app changes.

Two behaviours matter:

**Empty-plant fallback.** If the given plant has no active correctors, the
component shows the full active list instead of an empty menu. Without this the
first GEX 01 die receipt would be hard-blocked, since no GEX 01 correctors are
recorded. An empty dropdown on a required field is a dead end for the user, and
"eliminate manual entry risk" must not become "cannot record the die at all".

**Unrecognised stored values are preserved.** When the current value is not in
the list — a legacy typo, or a deactivated corrector — it is shown as a pinned
option labelled `<value> — not in list`. Nothing is silently blanked or
rewritten on open, and the correct name sits directly below it in the same menu.
This is what makes "fix on next edit" work in practice.

### Call sites

Each of these swaps its free-text input for `CorrectorSelect`:

| Page | Location | Plant source |
|---|---|---|
| Die Receiving modal | `src/pages/FlowPage.jsx:449` | the order's `Plant` |
| Order create/edit form | `src/DieOrderingSystem.jsx:607` | `form.Plant` |
| Die detail inline edit | `src/DieOrderingSystem.jsx:1334` | the order's `Plant` |
| Sample Followup edit form | `src/pages/SampleFollowupPage.jsx:499` | `form.plant` |
| Raise / Edit QD modal | `src/components/qd/RaiseQDModal.jsx:368` | the modal's selected `plant` |

The `e.g. Sijith` placeholder disappears with the input it belongs to.

The corrector list is fetched once where the other master data is already loaded
(`DieOrderingSystem.jsx`, alongside `suppliers`, `plants` and `presses`) and
passed down, rather than each call site fetching independently.

### Settings

A new admin-only **Correctors** card on the `Plants & Suppliers` tab: list
grouped by plant, add, rename, change plant, deactivate and reactivate.

`SettingsPage.jsx` is already 1055 lines, and the suppliers card alone spans
roughly 80 of them inline. The Correctors card is therefore built as its own
component (`src/components/settings/CorrectorsCard.jsx`) rather than pasted into
the page. This keeps the new code reviewable on its own and stops the settings
page growing another block. No existing cards are moved — that would be
unrelated churn.

## Error handling

- Blank or whitespace-only name → 400, surfaced in the Settings card.
- Duplicate `(name, plant)` → 409 with a message naming the clash.
- Deactivating a corrector never fails on account of existing references; the
  stored strings are independent of the row.
- If `GET /api/correctors` fails, `CorrectorSelect` renders disabled with an
  error note rather than silently appearing as an empty list — an empty dropdown
  and a failed fetch must not look identical to the user.

## Testing

**Backend** — `server/services/correctors.test.cjs` using `node:test` with a
mocked pg pool, matching the existing service tests:

- blank name rejected
- name trimmed on create, capitalisation preserved
- duplicate `(name, plant)` rejected
- `?plant=` filters; absent plant returns all
- `DELETE` sets `is_active = false` and leaves the row present
- inactive correctors excluded from the default `GET`

**Frontend** — no component test framework exists, so verification is
`npm run lint` + `npm run build`, followed by a browser smoke test of all five
fields against the rebuilt stack: dropdown populated, plant filtering correct,
GEX 01 fallback shows the full list, and a legacy `abcd` value still displays on
open.

## Rollout

`docker compose build backend frontend && docker compose up -d` — a plain
`docker compose restart` does not pick up source edits, so the migration would
silently not apply.
