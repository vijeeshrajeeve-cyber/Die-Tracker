# Oracle die entry: die type, tooling skip, batch autofill

Date: 2026-10-24. Source: screen recording of Dinesh creating die 30713-201 in
Oracle EBS PIM (ebsapps.gulfex.com, GEX PIM Engineer → Create Item), plus the
user's answers in the design conversation.

## Why

Once a day, after the day's design approvals, Dinesh creates every die waiting
at the tracker's Oracle Entry stage as an item in Oracle, so Sales can quote
against it. One die takes ~3m45s: three Oracle screens plus a New Item Request,
with repeated switching to the tracker drawer to read values. Nearly every value
is already in the tracker; the rest are fixed defaults. The work is retyping.

## What gets built

### 1. Die type (Hollow / Solid) on orders

- New column `die_orders.die_type` (`'HOLLOW' | 'SOLID' | NULL`), API key
  `Die Type`. Editable in the order drawer like the other details (goes through
  `PATCH /orders/:id/details`, logged, needs the edit permission).
- **PDF import captures it.** The GEX order form prints
  `SOLID - <mark>   HOLLOW - <mark>` with the mark (`OK`, `ok`, `YES`) after
  exactly one label. Seen in the 15 sample PDFs:
  `SOLID - HOLLOW - OK`, `SOLID - OK HOLLOW -`, `SOLID - YES HOLLOW -`. Read it
  by position: a mark between the SOLID and HOLLOW labels → SOLID, a mark after
  HOLLOW → HOLLOW. No mark, or marks on both → leave blank. Format B PDFs (labels
  are graphics, values only) leave it blank: a bare `OK` there cannot say which
  box it belongs to. Fill-blanks-only rule for existing dies still applies.
- **Existing orders (one-time backfill, user decision):** where `die_type` is
  NULL and the order is not a tooling (`type <> 'T'`):
  `mandrels_per_cavity > 0` → HOLLOW, else SOLID. Stored, not recomputed, so a
  later drawer correction sticks. Runs once as an idempotent migration.
- Toolings keep `die_type` NULL.

### 2. Toolings skip Oracle Entry (user decision)

Toolings (TYPE `T`) are not separate Oracle assets.
- Completing PR on a tooling moves it straight to `PENDING FOR DESIGN TO EMS`.
- The drawer's automatic status rule (`determineStatus`) skips Oracle Entry for
  toolings the same way, so an edit never drags one back.
- `oracle_entry` stays empty for toolings, so the daily summary's "Oracle
  entries done" never counts them. Design to EMS ages a tooling from `pr_entry`
  when `oracle_entry` is empty (daily summary and the stage-date lookups).
- Toolings already sitting in Oracle Entry are moved by the user by hand. No
  data migration.

### 3. Oracle batch autofill

**In the tracker (Oracle Entry page):**
- Each row gets a checkbox (all dies ticked by default; toolings never appear
  once part 2 ships, and are excluded from the batch regardless).
- A **Copy batch for Oracle** button copies the ticked dies as one text block
  (JSON with a short prefix so the bookmarklet can recognise it).
- A **Set up Fill die** link opens a small panel with the draggable bookmarklet
  and three lines of instructions.
- A die whose type came from the mandrel backfill is not distinguishable later
  (it is stored). Dies with a blank die type are flagged in the batch and the
  bookmarklet will not fill Die Type / Die Life for them.

**Per-die values (fixed defaults confirmed by the user):**

| Oracle field | Value |
|---|---|
| Item Catalog Category | `GEX.DIE`; Number Of Items `1` |
| Item Description | `Die` |
| Profile ID / Die Index | die number split on the last `-` (`30713-201` → `30713`, `201`) |
| Die Status | `Active`, Reason `Die available` (Sales needs Active to quote; MES owns real status) |
| Number of cavities | Cavity |
| Die Diameter / Die Thickness | from Die Size `320X160` (mm) |
| Die Suppliers | tracker supplier, matched to Oracle's option text (alias list, e.g. PHME → Phoenix Middle East) |
| Die Type | `Hollow` / `Solid` |
| Die Life | Hollow `55`, Solid `50` (mT) |
| Dies available on presses | Priority `1`, Press = tracker press without `P` (`P2` → `2`), Remark `.` |
| Ordered Date | tracker Ordered date as `dd-Mon-yyyy` |
| Main / Secondary Corrector | `IMRAN` (MES updates later) |

**In Oracle (the "Fill die" bookmarklet):**
- First click (or no batch stored): a prompt box; Dinesh pastes the batch
  (Ctrl+V, Enter). Stored in Oracle-origin `localStorage` with a pointer to the
  current die. (Oracle is plain http, so a page cannot read the clipboard
  itself; one paste per batch is the workaround.)
- Each click recognises the screen by its heading and fills that screen only:
  Create Item → Enter Number/Description → Update GEX. New Item Request has
  nothing to fill.
- On Update GEX the die is identified from the page header
  (`Item: GEX.DIE_30713_201`), not the pointer, so a mismatch cannot fill the
  wrong die. On Create Item, if the current die already reached Update GEX, the
  pointer moves to the next die.
- After filling, a small floating panel shows: die N of M, what was filled, and
  any field it could not find or match (e.g. supplier not in Oracle's list).
  Buttons: Previous, Next, New batch, Close.
- It never clicks Finish, Apply, Submit or any Oracle button. Dinesh reviews and
  presses them himself.
- Fields are found by their visible label text, not Oracle's internal ids.

## Non-goals

- No Oracle credentials, no server-to-Oracle connection, no automatic submit.
- No NIR-number capture in v1 (the Oracle item code is derivable from the die
  number, so it is shown, not stored).
- No batch spreadsheet import into Oracle, no read-back from Oracle (later).
- No change to toolings' data beyond the status flow.

## Constraints / risks

- The bookmarklet is built from screenshots of the recording; Oracle's real
  HTML has not been inspected. It must degrade to "could not find X" rather
  than fill the wrong field, and needs one live run with Dinesh before relying
  on it.
- Oracle runs in Incognito in the recording; bookmarks work there, extensions
  do not by default — hence a bookmarklet.
- Oracle's supplier option texts are unknown except "Phoenix Middle East".

## Left to the builder

Exact layout of the panel and checkboxes; the batch text format; how the
bookmarklet is minified/embedded.
