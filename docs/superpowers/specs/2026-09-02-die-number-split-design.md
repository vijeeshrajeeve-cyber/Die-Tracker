# Splitting DIE NO into Profile + Die No, with an auto-proposed number

**Date:** 2026-09-02
**Status:** Design approved, not yet implemented
**Follows:** `2026-09-02-die-order-prefill-design.md` — reuses the service and helpers built there.

## Problem

The New Backup Request modal has one free-text `DIE NO` field. The person
raising a request has to know the plant's die-numbering convention, look up
what the last die on that press was, and type the whole thing by hand. Nothing
in the form helps, and nothing catches a number that collides with a die the
app cannot see.

Meanwhile the app already holds everything needed to propose the number:
44,669 dies in `existing_die_details`, 659 purchases in `die_orders`, and the
backup requests themselves.

## The numbering convention

A die number is `<profile>-<press number><2-digit sequence>`. Every backup
request follows it:

| die_no | plant | press | reads as |
|---|---|---|---|
| `13794-525` | GEX 01 | PRESS 5 | press 5, seq 25 |
| `29663-252` | GEX 01 | PRESS 2 | press 2, seq 52 |
| `013012-705` | GEX 2 | PRESS 7 | press 7, seq 05 |
| `051150-817` | GEX 2 | PRESS 8 | press 8, seq 17 |

The die list uses the same shape with an underscore (`29663_213`), and the rule
holds for 43,662 of its 44,667 dies (97.7%).

**GEX 2 has migrated to this rule.** It previously used the press *code* digits
(`-2502` for P25, `-3503` for P35). Those 171 orders ran 2026-01-07 to
2026-03-25. GEX 2 has 37 press-number orders; the 24 of them carrying an
`ordered_date` run 2026-02-10 to 2026-04-13, and all ten most recent GEX 2
orders use the new form. One rule now covers both plants.

## Goals

Split the input into Profile and Die No, propose the next die number from
Plant + Profile + Press, and stop a number that collides with any die the
system knows about.

## Non-goals

Validating Profile against the `profiles` master. That table holds **4 rows**
against 20,916 distinct profiles in the die list, so any validation against it
would reject almost every real profile. Profile stays free text.

## Storage

`die_no` stays **one column** holding `29663-253`. Only the input splits.

The column is read by `extractProfileFromDie`, the frozen-design match,
`dieOrderPrefill`, the order PDF, the J-file template, the QD link and the
duplicate check. Splitting it into `profile_number` + `die_suffix` would ripple
through all of them and require a data migration, for no behaviour the split
input does not already deliver. The form composes `profile.trim() + '-' +
suffix.trim()` on save.

## The number rule

```
next = highest existing suffix for (plant, profile, press) + 1
```

Highest is taken across all three sources, whichever is greatest:

| Source | Suffix from |
|---|---|
| `existing_die_details` | `split_part(die_no, '_', 2)` |
| `die_orders` | `split_part(die_no, '-', 2)` |
| `backup_die_requests` | `split_part(die_no, '-', 2)` |

For profile 29663 on press 2 that is die list 213, orders 213, requests **252**
— so the proposal is `29663-253`. The sequence is not dense: someone entered
252 by hand, skipping 214–251. Taking the maximum across all three is what
stops the proposal landing on a number that already exists somewhere.

**No history at all** → `<press number>01`, e.g. `29663-801` for press 8.

**Legacy 4-digit GEX 2 suffixes are excluded** from the calculation. Under the
current rule `-3503` reads as press 3, which it is not. They are historical
records, not part of the live sequence. A `^[0-9]{3}$` guard on the suffix
excludes them, matching the guard already used by `findRecentOrderMatch`.

The proposed number is always editable, and always re-checked for duplicates on
save.

## Architecture

### Server module

New `server/services/dieNumber.cjs`:

```js
nextDieNumber(client, { plant, profile, press })
  → { dieNo: '29663-253', basis: { source: 'backup request', die_no: '29663-252' } | null }
```

`basis` names what set the ceiling so the UI can say where the number came
from; it is `null` for a profile with no history, where the number is the
`<press>01` fallback.

It reuses `pressNumber` and `stripProfile` from `dieOrderPrefill.cjs` rather
than redefining them, and `normalizePlant` from `frozenDesigns.cjs` for the
`GEX 01` / `GEX 2` mismatch — backup requests store both spellings.

A second export closes the duplicate hole:

```js
dieNoExistsInDieList(client, dieNo) → Promise<boolean>
```

### Endpoint

`GET /api/backup-requests/next-die-number?plant=&profile=&press=`, behind the
same auth as the rest of that router. It lives with the resource it serves
rather than beside `/existing-data/die-match`, because it reads
`backup_die_requests`, which is not existing-data.

### Client

The modal gains a `Profile` field and renames `DIE NO` to `Die No`, holding the
suffix alone. When Plant, Profile and Press are all set and Die No is **blank**,
the form fetches the proposal and fills it, showing the basis beneath
(`next after 29663-252`) or `no history — first die on this press`.

Editing an existing request never triggers the lookup: the number already
exists, and overwriting it would orphan the die's history.

## Two fixes that fall out

**The duplicate check gains the die list.** `getDuplicateDieWarning` checks
backup requests and die orders in client memory. It cannot check 44,669 dies,
so `POST /api/backup-requests` gains a server-side check calling
`dieNoExistsInDieList` and returning **409** with a message naming the
conflicting die. The client surfaces that alongside its existing warning.

**Customer lookup gains a fallback.** `GET /api/profiles/lookup` queries only
the 4-row `profiles` table, so it 404s for essentially every real profile. It
gains a fallback to `existing_die_details.customer`, taking coverage from 4
profiles to 20,916. The client call moves from the die field's blur to the
profile field's blur as part of the split.

## Testing

**Server** (`server/services/dieNumber.test.cjs`, mocked pool):

- highest wins across the three sources, including when the ceiling is a
  backup request rather than a die (the real 29663 case: 213/213/252 → 253)
- `<press>01` when no source has anything
- 4-digit legacy suffixes are excluded from the maximum
- plant normalisation: a `GEX 2` request matches a `GEX 02` die
- an unusable press or empty profile returns null without querying
- `dieNoExistsInDieList` is true for a die list entry and false otherwise

**Client** (`src/utils/dieNumber.test.js`):

- compose: profile `29663` + suffix `253` → `29663-253`, trimming both
- the proposal is written only into a blank field
- an existing request never triggers a fetch

## Risks

- **The `<press>01` fallback assumes a fresh profile starts at 01.** No data
  confirms this — every profile in the die list already has history. It is
  editable and duplicate-checked, so a wrong guess is visible and correctable.
- **The 97.7% suffix rule leaves ~1,000 dies** whose first digit does not match
  their recorded press. For those the proposal could sit on the wrong press's
  sequence. The duplicate check still prevents an actual collision.
- **Legacy GEX 2 numbers do not participate.** A press-8 proposal of `-803`
  will not collide with the historical `-3503`, because duplicates compare the
  full string. If the plant considers those the same sequence, the rule needs
  revisiting.
