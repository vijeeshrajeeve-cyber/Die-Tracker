# Tooling mass import — runbook

Toolings page → **Import toolings** (tooling reviewers and admins only). Brings in many
toolings at once from a spreadsheet, a pile of drawings, or both. Nothing is written
until the preview has been accepted.

## What goes in

**Tooling list** — Excel or CSV, first sheet. The header row is found in the top 15
rows; it must have a number column. Recognised headers (case and punctuation ignored):

| Field | Headers |
|---|---|
| Number (required) | Number, Tooling No, Tooling Number, Insert No, Bolster No, Insert, Bolster, Code, No |
| Plant | Plant |
| Kind | Kind, Type |
| Size class | Size class, Size, Insert Size, Bolster Size, Dia x Thk |
| Cavities | Cavities, Cavity, Cav, No of Cavities |
| Location | Location, Rack, Store, Storage |
| Notes | Notes, Remarks, Comments |

Other columns are ignored and named in the dialog. The **Template** button downloads a
CSV with the headers.

**Drawings** — `.dxf` or `.pdf`, picked as files or as a folder (sub-folders included;
other file types in the folder are ignored). A `.dwg` is listed as "Convert first":
convert it with `server/scripts/convert-dwg-to-dxf.cjs` or save it as DXF.

## What each row does

| Preview says | Meaning |
|---|---|
| Add | The number is not in the master: a tooling is added (active, source `manual`). |
| Fill blanks | The tooling exists: only its empty size class, cavities, location and notes are filled. |
| No change | Everything in the row is already there. |
| Problem | Not an insert or bolster number, a contradicting kind, a bad size, a missing plant, or a repeat. Not imported. |

**A value already in the master is never overwritten.** Where the sheet disagrees the
preview shows "keeps …" with both values; change it by hand in the tooling drawer if the
sheet is right.

A bolster number does not say its plant. Give a Plant column, or the dialog's "Plant,
when a number does not say" applies.

## How a drawing finds its tooling

1. **File name**, by the drawing-archive rules (`21599-Ins.dxf` → I-21599,
   `14017 Bol(475x220).dxf` → BOL-14017 with size 475X220, `25IC2-090454.pdf`,
   `Bol-4-6-B.pdf`, `9053-Ins.dxf` → I-09053).
2. A name that is **only a number** (`21599.dxf`) is ambiguous. The dialog asks what such
   files are: left out (default), inserts, or bolsters.
3. A name with **no number** ("Look inside") is sent anyway: the drawing is read and, if
   its own text names exactly one tooling, it is filed there. Otherwise it fails with the
   reason.

| Preview says | Meaning |
|---|---|
| Attach | The tooling is in the master (or in the sheet being imported). |
| New tooling | Recognised, but not in the master. Imported only with "Add a tooling for each recognised drawing…" ticked. |
| Look inside | No number in the name; resolved from the drawing's text at import. |
| Left out | Marked scrap, or a press part (ring, key, holder). |
| Convert first | DWG. |

Each stored drawing is read for its opening, exactly as a single upload is. In addition,
a **confirmed or likely** opening fills the tooling's blank size class and cavities. A
reviewed or confirmed opening is never replaced. A drawing whose own text names a
different tooling is stored but graded uncertain, with the note "drawing names …".

## Limits and behaviour

- Rows go to the server 200 at a time, drawings one at a time (50 MB each).
- "Stop after this one" ends the run cleanly; everything done so far stays.
- One failed row or drawing never stops the rest. **Download report** gives a CSV with
  one line per row and per drawing.
- Uncertain and unread openings land in the Review queue as usual.

## Routes

| Route | Body | Answer |
|---|---|---|
| `POST /api/toolings/import/plan` | `{ rows, files (names), defaultPlant, bareNumbers, sheetNumbers }` | `{ rows, files }`, writes nothing |
| `POST /api/toolings/import/rows` | `{ rows, defaultPlant }` (≤ 500) | `{ results }` |
| `POST /api/toolings/import/drawing` | multipart `file`, optional `number`, `defaultPlant`, `bareNumbers`, `createMissing` | `{ number, created, basis, extracted, confidence, openingKept, notes, filled }` |

All three need the tooling review permission.

## Drawing reading changes shipped with this (2026-11-11)

Measured on the 3,292 DXFs of bundle `full-2026-11-08-v3`: confirmed 1393 → 1367,
likely 1015 → 1526, uncertain 795 → 318, none 89 → 81. No opening got worse; the 26 that
left "confirmed" were TALEX inserts whose stored pocket was the recess, not the opening.

- **Reduced drawings are brought to true size.** A drawing that states `SCALE 1:n`
  (n 2–5, label and ratio may be separate texts) is multiplied by n when its rim agrees
  with the stated size at that scale, or — with no size text — when the rim times n is a
  possible tooling diameter. 42 drawings, including the press-4 `P4 (INS-…)` sheets that
  were stored at half size (I-12495, I-11377). Never graded better than likely.
- **Shorter centre lines count.** Down to 40 % of the diameter (was 60 %) when they cross
  on or near the pockets.
- **Pocket-only drawings** (no outer, no size text) whose centre lines cross on the
  pockets grade likely instead of uncertain; the size class is still unknown and they stay
  in the queue for that reason only. Small loops away from the pockets (title-block
  symbols) are dropped.
- **TALEX insert drawings**: the standard recess is not the pocket; the openings inside
  it are. The insert number says how many (25IC2-… → 2, 35IC8A → 8). 197 drawings.
- With a known cavity count, far smaller loops beside the pockets (stamp slots) are
  ignored.
- File names: `Bol-4-6-B`, `BOL-5-1-F-Rev`, `B_2-2-A (475x220)`, `9053-Ins`,
  `Insert 11928 (4 CAV)`, `INST-08022`, `16456 INSERT` are now recognised (35 more archive
  files; no existing match changed).

**The stored openings on a server do not change by themselves.** To apply the new reading
to drawings already imported, follow "When the extraction rules change: reset, rebuild,
re-apply" in `docs/tooling-geometry-import-runbook.md`.

## Known gaps

- No press / "held at" column in the sheet import.
- Bare-number names inside one folder are all treated the same way (one choice per run).
- The dialog was checked in the browser against a stubbed API; the full path against a
  running server has not been exercised yet.
- Still uncertain after these changes (318): outer centred on the drawn loops with no
  centre lines (107), no outer and no centre lines (84), small loops among the pockets
  (110), drawings naming another number (27).
