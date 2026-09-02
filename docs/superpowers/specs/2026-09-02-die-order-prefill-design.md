# Die Order PDF prefill from purchase history and the die list

**Date:** 2026-09-02
**Status:** Design approved, not yet implemented

## Problem

The *Generate Die Order PDF* modal (`BackupDieRequests.jsx`) opens with most of its
fields blank. Today it prefills only from a matching frozen design: `SUPPLIER`,
`DIE_SIZE`, `NO_OF_CAV`, `PRESS`, `DELIVERY_DATE` and `SHIPMENT`. Everything
else — `SOLID`/`HOLLOW`, `BOLSTER_NO`, `INSERT_NO`, sizes, finish, reason — is
typed by hand for every order, even though the plant has ordered dies for the
same profile and press many times before.

Two sources already in the database can answer most of it:

- `die_orders` — 659 real purchases, every one carrying `die_size` and `supplier`.
- `existing_die_details` — 44,669 dies for GEX 01 imported from the plant's own
  die-management export, carrying die size, cavity, Solid/Hollow and bolster.

## Goals

Fill `DIE SIZE`, `SOLID`/`HOLLOW`, `BOLSTER No` and `SUPPLIER` when history
supports a value, leave them blank when it does not, and never overwrite what a
person or a frozen design already put there.

## Non-goals

`INSERT No`, `INSERT SIZE`, `BOLSTER SIZE`, `PROFILE WEIGHT %`,
`PENDING ORDER (KG)`, `REASON`, `FINISH` and `3D MODULE` are out of scope. The
evidence for excluding each is in "Fields with no reliable source" below.

## Authority order

For every field, the first source that yields a value wins, and a field that
already holds a value is never touched:

```
request  →  frozen design  →  most recent order  →  die list
```

A frozen design is a deliberate engineering decision and outranks a past
purchase. The die list is the fallback for what no order records.

| Field | Order | Die list |
|---|---|---|
| `DIE_SIZE` | ✅ `die_size` | ✅ `DiesDIAM` × `Thickness` |
| `SUPPLIER` | ✅ `supplier` | ✅ `NameSupplier` (aliased) |
| `SOLID` / `HOLLOW` | ❌ | ✅ `DieType` |
| `BOLSTER_NO` | ❌ | ✅ `IDBolster` |

`die_orders.type` holds the *order* type (B/N/T/C/H — Backup, New, Trial,
Correction), not the profile's Solid/Hollow character, and there is no bolster
column. That is why the last two rows fall to the die list alone.

## Matching

### Die list

Key: **plant + profile + press + cavity**, all four supplied by the caller.
Cavity is an input, not something the lookup derives — a person who typed
1 cavity gets no match rather than being silently corrected to 2.

```sql
SELECT die_no, die_size,
       raw_data->>'DieType'      AS die_type,
       raw_data->>'IDBolster'    AS bolster_no,
       raw_data->>'NameSupplier' AS supplier
FROM existing_die_details
WHERE plant = $1
  AND profile_number = $2
  AND NULLIF(regexp_replace(press, '\D', '', 'g'), '')::int = $3
  AND raw_data->>'NumHoles' = $4
ORDER BY split_part(die_no, '_', 2)::int DESC
LIMIT 1
```

**Newest die wins** when several match. All 44,669 `die_no` values match
`digits_digits`, so the suffix sort is total.

**All values come from one die.** Bolster is populated for only 46% of dies;
sourcing each field from the newest die that happens to have it would pair a
2019 bolster with a 2025 die size — a combination that never existed. If the
newest match has no bolster, `BOLSTER No` stays blank.

### Orders

Key: **plant + profile + press**. Cavity is omitted because `die_orders.cavity`
is set on 7 of 659 rows. This costs little: 97.9% of profile+press groups in the
die list have exactly one distinct cavity value, so press alone is nearly as
discriminating.

`die_orders.press` is populated on 6 of 659 rows and cannot be used. Press is
instead derived from the first digit of the `die_no` suffix (`18114-407` →
press 4). That rule was verified against the die list, where both values are
known: it holds for **43,662 of 44,667 dies (97.7%)**. All 380 parseable GEX 1
orders use the 3-digit convention.

**Most recent `ordered_date` wins**, with no age cutoff. Orders with a null
`ordered_date` (29 of 659) are excluded, since they cannot be ranked.

GEX 2 orders are excluded from the derived-press rule for now: 171 of its 208
parseable orders use a 4-digit suffix (`-2502`, `-3508`) that appears to encode
the `P25`/`P35` press codes rather than a press number. GEX 2 has no die list
imported, so nothing depends on resolving this yet.

### Vocabulary normalisation

Three mismatches the lookup must absorb:

- **Plant.** `die_orders` says `GEX 1`; `existing_die_details` and `presses` say
  `GEX 01`. Normalise both sides (the frontend already has `normalizePlantName`
  for this; the server needs the equivalent).
- **Press.** The die list says `M_PRESS.2`; the app says `PRESS 2`. Compare on
  the trailing integer.
- **Die type.** The list holds `Hollow` (27,113), `SOLID` (10,527) and `Solid`
  (7,027). Compare case-insensitively.

### Supplier canonicalisation

Only 17,350 of 44,669 dies (38.8%) name a supplier that matches the master
exactly. The two Phoenix aliases below cover a further 8,873, lifting coverage
to 58.7%. Fill `SUPPLIER` only when the name resolves to a master record;
otherwise leave it blank, so `MODE OF SHIPMENT` (derived from the supplier
record) is never stranded.

| Die list name | Canonical |
|---|---|
| `PHOEINIX` | `PHOENIX` |
| `Phoenix Middle East` | `PHME` |
| `PDTMC`, `ADEX`, `COMPES`, … | exact match |
| anything else | no fill |

This follows the existing `SUPPLIER_ALIASES` precedent in
`PDFImportModal.jsx:27` (`GIANSUN → JIANGSU`).

## Architecture

### Endpoint

`GET /api/existing-data/die-match?plant=&profile=&press=&cavity=`, behind
`authMiddleware` — the same access level as the frozen-design match it sits
beside. Returns:

```json
{ "order":    { "die_no": "18114-407", "die_size": "450x250", "supplier": "COMPES",
                "ordered_date": "2026-05-26" },
  "dieList":  { "die_no": "29663_213", "die_size": "355X200", "die_type": "Hollow",
                "bolster_no": "BOL-2-2-A", "supplier": "PDTMC" } }
```

Either key may be `null`. The endpoint reports what each source found and does
not merge; merging is the client's job, because only the client knows which
fields the user has already filled.

### Server module

A new `server/services/dieOrderPrefill.cjs` owns both queries and the
normalisation helpers. Both the new endpoint and
`backup-requests.cjs:265` call it — that file's private `die_size` query is
deleted. Today it reads `existing_die_details.die_size` directly, which after
the import change below would stamp a bare `250` onto a PDF where every other
order says `250X160`. Routing both paths through one module is what stops the
modal and the generated PDF disagreeing about the same die.

### Client module

The merge goes in a new `src/utils/dieOrderPrefill.js` as a pure function:

```js
applyPrefill(currentValues, { frozen, order, dieList }, { suppliers }) → newValues
```

It is not inlined into `BackupDieRequests.jsx`, which is already 1,453 lines and
has no test framework. As a plain module it is testable under `node:test`, which
`npm test` already globs for `src/**/*.test.js`.

`openOrderModal` calls `existingDataAPI.matchDie(...)` alongside the existing
`frozenDesignsAPI.match(...)`, then hands both results to `applyPrefill`.

### Provenance in the UI

Each auto-filled field carries a small hint naming its source — `from order
18114-407` or `from die list 29663_213`. The house rule against presenting
unverified numbers as fact applies here: the person generating a supplier-facing
PDF should be able to see which values came from history and check them.

## Import change

`existing_die_details.die_size` currently stores `DiesDIAM` alone (`250`).
Orders and frozen designs record die size as `DiesDIAM × Thickness` (`250X160`) —
the most common value across orders, 106 of them, is exactly the 250 + 160 pair.

Change the import mapping in `server/routes/existing-data.cjs` to compose
`<DiesDIAM>X<Thickness>`, then re-import GEX 01's 44,669 rows through the
Settings → Existing Data upload. That takes about 10 seconds and replaces the
plant's rows.

## Fields with no reliable source

| Field | Why not |
|---|---|
| `INSERT No` | `IDBacker` is empty for all 44,669 dies |
| `INSERT SIZE`, `BOLSTER SIZE` | not present in the die-management export |
| `PROFILE WEIGHT %` | `WeightReal` and `WeightTheoretical` are populated (44,667 dies) but no confirmed formula — their ratio is a guess |
| `PENDING ORDER (KG)` | `PendingExt.` is populated for 5,955 dies (13%); its unit and meaning are unconfirmed |
| `REASON` | requests store free text (`"FBHBHF"`); the modal uses a fixed dropdown |
| `FINISH`, `3D MODULE` | nothing in either source corresponds |

## Testing

**Server** (`server/services/dieOrderPrefill.test.cjs`, mocked pool as in the
other service tests):

- press normalisation both ways (`PRESS 2` ↔ `M_PRESS.2`), and a die whose press
  is blank
- plant normalisation (`GEX 1` ↔ `GEX 01`)
- newest-die pick across several matching suffixes
- newest-order pick by `ordered_date`, ignoring rows with a null date
- press derived from an order's `die_no` suffix, and a `die_no` that will not parse
- no match returns null rather than throwing

**Client** (`src/utils/dieOrderPrefill.test.js`):

- blanks-only: a field holding a value is untouched by every source
- authority order: frozen design beats order beats die list
- `SOLID`/`HOLLOW` set from `Hollow`, `SOLID` and `Solid`, and left alone when
  either box is already checked
- supplier aliasing, and no fill for a name absent from the master
- a die-list match with an empty bolster leaves `BOLSTER No` blank

**API** (`src/api.test.js`): `matchDie` builds the right query string and passes
a null match through as null.

## Risks

- **The suffix→press rule is inferred, not documented.** It holds for 97.7% of
  the die list, but the remaining 2.3% (about 1,000 dies) would match the wrong
  press. Blanks-only merging and the visible provenance hint limit the damage to
  a wrong value the user can see and correct.
- **GEX 2 is unresolved.** Its mixed suffix convention needs the plant's own
  numbering rule before orders there can be matched by derived press.
- **Re-import is destructive per plant.** The import replaces all rows for the
  selected plant, so a failed re-import leaves GEX 01 empty until it is rerun.
