# Tooling finder — design

Date: 2026-11-07
Status: agreed with the user in chat; awaiting their review of this document.

## Why

Every new die order needs an insert or a bolster. Today the person preparing the
order searches the tooling archive by hand: open insert drawings, compare the
profile against the opening, check the stack combination chart for the press and
die size, and only then write the insert or bolster number on the die order form.
In the user's words this is "fully done manually and consumes most time while
processing new die ordering". When no existing tooling is found, a new one is
bought, so misses cost money as well as time.

The feature finds reusable toolings automatically, two ways:

1. **Fit route.** Place the new profile's outline inside each candidate insert or
   bolster opening and keep the ones it passes through with at least 5 mm to
   spare, then keep only those the combination chart allows for the target press
   and die size.
2. **Similarity route.** Find existing dies whose profile shape is similar to the
   new one and read off the tooling they run in today.

The result is written into the die order form the app generates.

## Goals

- A **New die order** button on the top bar that opens a *Prepare New Die Order
  PDF* form: pick the profile drawing PDF, fill the order details, generate the
  order form PDF stamped onto the drawing (the same mechanism the Backup Die
  Requests page uses today).
- Inside that form, a **Find tooling** panel that lists candidate inserts and
  bolsters ranked best-first, with a small overlay of the profile in the opening,
  the clearance achieved, the chart verdict, the rack location, which dies run in
  it today, and the confidence of its opening geometry. *Use this* fills INSERT No
  / INSERT SIZE or BOLSTER No / BOLSTER SIZE. Mockup chosen by the user (option A):
  `.superpowers/brainstorm/375-1794074743/content/finder-placement.html`.
- A **similar profiles** strip under the candidates: the nearest existing dies by
  shape, each with its current tooling and whether that tooling is in scope.
- A **tooling master** built as part of this project from the inventory
  workbooks, the drawing archive and the combination charts, with a review queue
  for openings the extraction is not sure about.
- A **profile library** of every existing die's shape, seeded from the user's
  image-check workbook and grown by every order PDF the app imports.
- A record of which tooling each die runs in, built from the die lists and kept
  current by the forms the app generates and the order PDFs it imports, so reuse
  can be reported later.

## Non-goals

- **Generating a new die order PDF does not create a die order in the app.**
  The PDF still goes out and comes back through the existing Import PDF step.
  The user named this as "scope for future development".
- No change to how backup die requests work, beyond their form gaining the same
  Find tooling panel (see "My calls").
- No automatic decision. The finder suggests and ranks; a person picks.
- No tooling outside the current inventory. Toolings not in the inventory
  workbooks and not added since are not searched, even if a drawing exists.
- No die rings, baffle rings, holders or sub-bolsters as search results. They
  appear only as the chart's companions to an allowed insert or bolster size.
- No change to the Oracle die entry, QD, Frozen Designs or Sample Followup
  features.

## Anti-goals (would make this a failure even if it works)

- **A false fit.** Suggesting a tooling the profile does not pass through with
  5 mm clearance, because the opening geometry was wrong or the profile was read
  at the wrong scale. Every suggestion must show where its geometry came from and
  how sure the extraction was; uncertain geometry must be visibly marked and must
  never outrank confirmed geometry.
- **A chart violation.** Suggesting a tooling the stack combination chart does
  not allow for that press and die size.
- **Fabricated geometry.** A tooling whose opening could not be extracted gets no
  opening, not a guessed rectangle from its size class. It is shown as "opening
  not known" and excluded from the fit route until the die shop supplies it.
- **Silent scale errors.** A profile outline whose true size could not be
  established (no CCD, no stated scale, no perimeter) is used for the similarity
  route only, never for the fit route.
- **Losing the manual path.** The insert and bolster fields stay plain text the
  person can type into, with or without running the finder.

## Vocabulary

| Term | Meaning here |
|---|---|
| Tooling | An insert or a bolster. The things the finder returns. |
| Insert | The plate with the profile-shaped opening that sits in an insert holder or bolster. Numbers such as `25IC1-120021`, `35IC2-051150` (GEX-2: press tonnage, `IC` + cavity count, die it was first made for) and `I-12495` (GEX-1: `I-` + die it was first made for). |
| Bolster | The larger backing plate with its own opening. Numbers such as `BOL-4-6-A`, `B-6-1-C`. Dies without an insert run directly in a bolster, so bolster openings are matched the same way. |
| Opening / pocket | The through-hole in an insert or bolster. A two-cavity insert has two pockets. |
| Combination chart | Press + die size → allowed insert size, bolster size, sub-bolster, die ring, insert holder, baffle ring. Two workbooks: the 2014 sheet for presses 1–6 and the Oct 2026 sheet for Press 9. |
| Profile | The extruded section's outline, as drawn on the die order PDF or the profile drawing. |
| CCD | Circumscribed circle diameter of the profile. Stated on GEX drawings and in the GEX-1 die list (`ProfileCCD`). |
| Clearance | After the best placement of the profile inside a pocket, the smallest distance from the profile outline to the pocket wall. Must be ≥ 5 mm. |

## What the user decided

These came from the user and are not open:

1. **Inputs** for a new die: profile shape (from the drawing), profile size, die
   size, CCD, press, number of cavities.
2. **Gate one is a true shape check**: place the profile outline on top of the
   insert or bolster opening and require at least 5 mm clearance all round.
   Overall size and CCD are used only to narrow the search before the overlay.
3. **Gate two is the combination chart**: the tooling's size must be allowed for
   the target press and die size.
4. **Cavities must match**: a two-cavity profile needs a two-pocket tooling, and
   the profile must fit each pocket.
5. **Scope**: only toolings in the current inventory, plus anything added after
   the inventory date.
6. **Output**: the matching insert or bolster number is entered into the die order
   form the app generates. The user chose a new top-bar button for preparing new
   die order PDFs, with the finder inside that form (option A in the mockup).
7. **Ranking**: when several toolings pass both gates, choose "the one which
   provides better support", i.e. the opening that hugs the profile most closely.
8. **"Similar" means shape**, regardless of customer or section family.
9. **Tooling details come from the drawings**: the master must be built from the
   archive as part of this project, "as of today everything is in the drawing".
10. **Backfill sources**: the image-check workbook for profile shapes; the die
    lists for die → tooling. The GEX-2 export will be widened to carry the same
    `IDBolster` column as GEX-1.
11. **No order creation** from the new form (future scope).
12. **Sizes** such as `460x150` are diameter × thickness, for inserts and bolsters.
13. **One tooling per die.** A die runs either in an insert or directly in a
    bolster, so the finder returns one ranked list mixing both kinds, and *Use
    this* fills one pair of fields (insert number + size, or bolster number +
    size). The other pair stays as it was.
14. **Combination chart**: use the sheet that lists all presses (`14 Inch` in the
    2014 workbook). Ignore Press 9 for now: skip the P9 workbook and any Press 9
    rows.
15. **The press an insert is held for is not a gate.** An insert held at Press 2
    whose size the chart allows for Press 6 is still suggested, marked "held at
    Press 2, needs transfer".
16. **Extraction coverage**: include as much as possible. DXF, vector PDF and
    scanned-PDF tracing are all in scope for the first release; what cannot be
    extracted goes to the review queue, not out of scope.

## The data

### Archive (read-only input, outside the repo)

Root: `C:\Users\vijee\Desktop\18.06.2026\New folder\14.Die Toolings` (about
19,400 files). The parts this project reads:

| Source | What it gives | Format notes |
|---|---|---|
| `Tooling Inventory-2025.xlsx`, sheets `35MN PRESS` and `25MN PRESS` | GEX-2 inventory: Sr.No, Insert No, Size, Location, grouped by category (inserts, bolsters, holders, rings). Ring sheets: Ring No, Suitable Die Size, Qty. | Category is a heading row above its block, not a column. |
| `Tooling inventory-27.12 2024.xlsx`, sheet `Tooling inventoy 27.12.2024` | GEX-1 insert inventory, about 700 inserts: SN, Insert number, and a column per press (2, 4, 5, 6) marking where it is held. | Press columns, not a single press field. |
| `Tooling stack combination for all Presses-Updated_16_April_2014.xlsx` (Sheet1, Sheet2, `14 Inch`) and `9. Press-9 (14 Inch )/DIe stack/Tooling stack combination for P9 01-Oct -2026.xlsx` | The combination chart: Press, Die size, Insert size, Bolster size, Sub bolster size, Die ring size, Total stack, Insert Holder, Baffle ring, Bol Holder, Remark. | One row per press + die size + stack option. |
| `6.Press 6/Insert/PRESS 6 INSERTS(460 AND 560).xlsx` | INSERT NUMBER, SIZE, LENGTH, WIDTH, NO OF CAV, CENTER GAP. | The only structured opening dimensions; a cross-check for extracted geometry. |
| `6.Press 6/Bolster/Bolster Inventory(P2-P6).xlsx` | PRESS, BOL NO., BOL SIZE, A(LEN), B(WED). | Same, for GEX-1 bolsters. |
| `Toolings/Dieshop - Insert Drawings/AutoCad/**/<dieno>.dwg` | 2,888 DWGs (2,687 unique die numbers). The primary opening geometry. | Converted to DXF with AutoCAD 2027 `accoreconsole.exe` (see "Extraction"). Units mm (`INSUNITS` 4). Openings are closed `LWPOLYLINE`s or loose `LINE`/`ARC` runs that need chaining; layer names vary by drawing supplier. |
| `Toolings/Dieshop - Insert Drawings/PDF & Tiff/**/<dieno>.pdf` | Vector PDFs with a title block (Insert No, Size, Press, Drawn by, Date) but **no text layer**. | Opening paths extracted with pdfjs-dist; scale fixed from the known outer size of the insert. |
| `Toolings/Toolings/BOLSTER/` | 291 unique bolsters; many are scanned PDFs. | Raster tracing, scale from the known outer diameter (NPE-analyzer style). |
| `14.Insert Details/{PDF,DXF}`, `10.TALEX tooling/{25 MN,35 MN}/...`, `1.Press 1` … `6.Press 6` | Further insert and bolster drawings, some as DXF/STP already. | Same extractors; the folder tells the press. |

### The image-check workbook

`C:\Users\vijee\Desktop\18.06.2026\Dies List ExtractedNew - Image Check - Final 30.10.2026.xlsx`
(167 MB). Sheets `GEX1` and `GEX2` hold one row per die: IDProfile, IDDie,
IDDieType, a picture in column E, the inspector's type verdict (F), and a check
note (G). Pictures are `twoCellAnchor` drawings anchored to their row (GEX-1:
24,969 pictures for 25,094 dies, six rows with two pictures, 125 with none;
GEX-2: 1,526 pictures for 5,662 dies). Pictures are GIF or PNG, mostly clean
black silhouettes or outlines on white, a minority crops of scanned drawings with
dimension lines. They are **not to scale**: good for shape similarity, not for
the 5 mm check. Rows whose check note says mismatch, blank or unclear are
imported with a `needs_review` flag and excluded from similarity results until
cleared.

### The die lists (already in the app)

`existing_die_details` keeps every export column in `raw_data`. The GEX-1 export
has `IDBolster`, filled for a little under half the dies (3,464 distinct values on
the test server). It is a free-text tooling field: mostly `I-<die>` insert
numbers, with `BOL-…` / `B-…` bolster codes, bare numbers and oddities such as
`2(=)` mixed in. The GEX-1 export also has `ProfileCCD`,
`ProfileExternalPerimeter` and `ProfileInternalPerimeter`, which give a true
size for most GEX-1 shapes. The GEX-2 export has none of these today; the user
will widen it to include `IDBolster` under the same name.

### Die order PDFs (already imported by the app)

Vector PDFs with a text layer. Page 1 carries the profile drawing with CCD,
external and internal perimeter, cavity count and a stated scale, plus the
stamped order form whose fields include `INSERT No` and `BOLSTER No` (the Sept
2026 forms print `INSERT No, - I-05138`). The app already cuts the profile
image in pixels (`src/utils/profileImage.js`); this project adds the outline at
true scale.

## The parts

### 1. Tooling master

A `toolings` table: number, kind (insert / bolster), plant, press(es) it is held
for (a location, not a gate: see user decision 15), size class (`460x150`,
`300X100`…) with its own source and confidence, cavity count
(from the number's `IC2`/`IC4` or the drawing), location, source (`inventory-2025`,
`inventory-2024-12`, `order-form`, `manual`), status (`active`, `retired`,
`unverified`), and the drawing files attached to it.

A `tooling_openings` table: one row per tooling, holding the outer outline and
the list of pocket outlines in millimetres (closed polygons, arcs flattened), the
pocket centre gap for multi-cavity inserts, the extraction source (`dxf`,
`pdf-vector`, `pdf-raster`, `manual`), a confidence (`confirmed`, `likely`,
`uncertain`, `none`), and review fields (who confirmed, when, note).

Size class: the GEX-2 inventory states it per insert. The GEX-1 inventory
(`27.12 2024`) has **no size column**, only SN, bare insert number (strings with
leading zeros such as `05043`) and a column per press. For GEX-1 inserts the size
class comes from the drawing: the title block text where the DWG has it as text
entities, otherwise the outer diameter from the extracted outline paired with the
thickness from the drawing's side view or title block. Each derived size class
carries a confidence; a GEX-1 insert with no derivable size class fails gate two
and sits in the review queue until the die shop fills it in (my call).

Numbers are normalised once, in one shared helper: GEX-1 bare `05043` and die-list
`I-05043` are the same insert; `BOL-4-6-A` and `B-4-6-A` are the same bolster
(builder confirms the latter against the inventory).

Scope rule: a tooling is searchable when its status is `active` and it came from
an inventory workbook or was added later. Toolings that exist only as drawings
are imported as `retired` so the drawing is not lost but they are never
suggested.

### 2. Combination chart

A `tooling_combinations` table: press, die size, insert size, bolster size,
sub-bolster, die ring, insert holder, baffle ring, bolster holder, remark,
source sheet. Gate two is a lookup: a tooling passes when a row exists for the
order's press and die size whose insert size (for inserts) or bolster size (for
bolsters) equals the tooling's size class, after normalising `x`/`X`, `∅`/`Dia`
prefixes and spacing. Die size on the order is the `250X140` form the app
already uses.

Source: only the `14 Inch` sheet of the 2014 workbook, Press 9 rows excluded.
The other two sheets of that workbook and the whole P9 workbook are not
imported (user decision 14). The 2024 free-text note on Sheet1 about
`Dia355X240` / `Dia475X280` is not a chart row and is not imported; if that
combination is real it is added through the Tooling page (my call).

### 3. Profile library

A `profile_shapes` table: die number (or profile number when the row comes from
the `Profiles` sheets), plant, outline polygon(s) normalised to a unit frame, a
rotation- and scale-invariant **shape signature**, hole count, cavity count,
true-size flag with the mm outline when known, source (`image-check-xlsx`,
`order-pdf`, `profile-drawing`), and `needs_review`.

Seeded by the image-check import; extended by every order PDF import and by every
drawing picked in the new form. One die can have several rows over time; the
newest true-size row wins for the fit route and all rows feed similarity.

### 4. Die → tooling links

A `die_tooling_links` table: die number, tooling number, kind, source
(`die-list`, `order-pdf`, `new-order-form`, `manual`), seen-at date. The die list
import gains a classifier for `IDBolster` values; order PDF import records the
`INSERT No` / `BOLSTER No` fields it already parses; the new form records what
the person chose. Unclassifiable die-list values are kept as raw text on the link
with kind `unknown`.

### 5. The finder

Input: a profile (true-size outline, cavity count, CCD), press, die size, plant.

1. **Narrow.** Candidate toolings = active, in-scope, same plant, both kinds
   (inserts and bolsters together, user decision 13), cavity count equal to the
   order's, opening confidence not `none`, whose size class passes
   gate two for the press and die size (the press it is held at does not
   filter; a different held press adds a "needs transfer" note), and whose pocket bounding box is at least
   profile bbox + 10 mm in some orientation (a cheap pre-filter; CCD + 10 mm must
   also fit the pocket's inscribed region).
2. **Overlay.** For each candidate pocket, search rotations (full 360°, see "My
   calls") and translations for a placement where the profile offset outward by
   5 mm lies entirely inside the pocket polygon. Record the achieved clearance
   (largest offset that still fits, capped at a sensible maximum). For multi-pocket
   inserts the same profile must fit every pocket.
3. **Rank.** Passing candidates sort by clearance ascending (closest to 5 mm
   first, "better support"), then by pocket area ascending, then confirmed
   geometry before likely before uncertain.
4. **Return** the ranked list with, per candidate: number, kind, size class,
   cavity count, clearance, chart verdict (and the chart row's companions), rack
   location, dies currently linked to it, geometry confidence, and the placement
   (rotation, offset) so the UI can draw the overlay.

Also returned: the **similar profiles** list from the signature index (nearest
N by signature distance, hole count equal, cavity count equal preferred), each
with its linked toolings and whether each is in scope and passes gate two. A
tooling that appears in the similar list but fails a gate is shown greyed with
the reason, as in the mockup, never silently dropped.

### 6. Prepare New Die Order PDF

Top bar gains a **New die order** button beside Import PDF. It opens a modal
modelled on the Backup Die Requests "Generate Die Order PDF" modal and sharing
its generator (`server/services/dieOrderTemplate.cjs`) and prefill rules:

1. Pick the profile drawing PDF (same picker and in-place overwrite behaviour as
   the backup modal).
2. The app reads the drawing: profile outline at true scale (from the stated
   scale, or CCD, or perimeter, in that order of trust), CCD, perimeters, cavity
   count where printed. Fields that can be read are prefilled and marked with a
   source hint, as the backup form does today.
3. The person fills or corrects plant, die number, profile, customer, press, die
   size, cavities, supplier, solid/hollow, dates.
4. **Find tooling** runs the finder and shows the panel. *Use this* fills the
   insert number and size for an insert, or the bolster number and size for a
   bolster, and leaves the other pair untouched. The fields stay editable.
5. **Generate** stamps the form onto the drawing and saves the PDF as the backup
   flow does. The app also stores a `new_die_order_forms` row: die number, plant,
   the form values, the chosen tooling and whether it came from the finder, the
   candidates shown, the profile outline, who generated it and when. This is what
   later reuse reporting and the future "create the order from here" build on.

### 7. Tooling page

A new sidebar page, admin and die-shop roles (see "My calls"), modelled on the
Frozen Designs registry: a list of toolings with filters (plant, press, kind, size
class, status, confidence), a detail drawer showing the drawing, the extracted
opening drawn over it, linked dies, and edit controls (confirm / correct / mark
`none`, retire, change location). A **Review queue** tab lists openings with
confidence `uncertain` or `none` and image-check rows flagged `needs_review`.
Manual **Add tooling** for anything bought after the inventory date, with drawing
upload that runs the extractor.

### 8. Import and extraction pipeline

Run once as scripts under `server/scripts/`, re-runnable and idempotent, each
writing a summary of what it did and what it could not do:

- `import-tooling-inventory` — both inventory workbooks → `toolings`.
- `import-combination-chart` — both chart workbooks → `tooling_combinations`.
- `attach-tooling-drawings` — walk the archive, match files to tooling numbers
  (by die number embedded in the insert number, by bolster code, by title block
  text where present), copy them into the app's storage, record the match basis.
- `extract-openings` — per attached drawing: DXF → chain loops → classify outer
  vs pockets → confidence by loop closure, layer hints, agreement with the size
  class and the Press-6 / bolster dimension sheets; vector PDF → pdfjs paths,
  scaled from the outer size; scanned PDF → raster trace. Anything the extractor
  is not sure about lands in the review queue rather than being guessed.
- `import-profile-images` — the image-check workbook → `profile_shapes`.
- die list import — extended in place to classify `IDBolster` → `die_tooling_links`.
- order PDF import — extended in place to add the true-size outline and the
  tooling link.

**How the archive reaches the server (my call).** The archive and AutoCAD live
on the user's PC; the app runs in Docker. The attach and extract steps therefore
run on the PC as Node scripts reading the archive path directly, and write an
**import bundle**: a folder with the drawing files to store plus JSON for
toolings, openings, links and shapes. A server-side script
(`apply-tooling-bundle`) reads a bundle from a mounted path and loads it,
idempotently, printing a dry-run summary first. No bulk-upload screen is built.
Later single additions go through the Tooling page upload, whose extractor runs
server-side on DXF and PDF (so the server never needs AutoCAD; a DWG uploaded
there is stored but marked "convert to DXF first").

Extraction order inside the first release: DXF first (largest and most
reliable), then vector PDF, then scanned-PDF tracing. All three ship; the order
only governs which review-queue entries appear first (user decision 16).

DWG → DXF conversion uses the installed AutoCAD 2027 core console
(`accoreconsole.exe /i <dwg> /s <script>`), driven from PowerShell with a CRLF
script that ends in `_.QUIT` then `Y` (not `_.Y`, which hangs). This is a
one-time offline step on the user's machine; the app never calls AutoCAD.

## My calls (the user has not confirmed these; check while reading)

- **Rotation**: any in-plane angle is allowed when fitting; mirroring is not.
- **Clearance cap**: clearance is reported up to 50 mm; beyond that it is shown as
  "> 50 mm" and ranks last among passes.
- **Backup form**: the Backup Die Requests "Generate Die Order PDF" modal gets the
  same Find tooling panel, because it is the same component. For a backup die the
  panel also shows the die's current tooling from the die list at the top.
- **Unknown tooling numbers**: a number typed into either form that the master
  does not know is added as `unverified`, no geometry, and appears in the review
  queue. It is not suggested by the finder until confirmed.
- **Who reviews**: admins and a new `die_shop` role flag (or reuse of the existing
  edit-permission switch, builder's choice) can confirm geometry and add or retire
  toolings. Everyone who can generate a die order PDF can run the finder.
- **Similarity N**: the strip shows the 8 nearest dies; the API returns 20.
- **Signature**: a turning-function or Fourier descriptor over the resampled outer
  outline, plus hole count, aspect ratio, solidity and cavity count. Builder picks
  the exact descriptor; it must be rotation-, scale- and translation-invariant and
  cheap enough to compare against ~30,000 shapes per request without a GPU.
- **Image-check pictures with dimension lines**: trace all, keep the largest closed
  shape, flag as `needs_review` when the trace's solidity or hole count disagrees
  with the die type verdict in the sheet.
- **Where files live**: tooling drawings and the generated form PDFs go in a new
  storage root alongside `order-files`, with the same path-safety helpers and a
  Docker volume (deploy note).
- **Plant separation**: GEX-1 toolings are never suggested for GEX-2 orders or
  vice versa, because the presses differ; the chart enforces this anyway.
- **GEX-1 size class from the drawing**, with confidence; no derivable size class
  means review queue, not a guess (see "Tooling master").
- **2024 chart note** on Sheet1 is not imported; add through the Tooling page if
  real.
- **Import bundle** produced on the PC and applied server-side, instead of a bulk
  upload screen (see "Import and extraction pipeline").
- **Mixed ranking**: inserts and bolsters share one list sorted by clearance. A
  bolster will usually rank below a well-fitting insert because its opening is
  larger; that is the intended "better support" order, not a defect. The panel
  shows the kind on every row so the person can still pick a bolster deliberately.

## Left to the builder

- Exact polygon offset, containment and rotation-search implementation (coarse
  angle sweep then local refinement is fine); how arcs are flattened; tolerance.
- DXF loop chaining rules and the per-supplier layer heuristics; what "likely" vs
  "uncertain" means in numbers.
- Table and column names beyond those sketched here; indexes; the `init.sql` +
  `db.cjs` migration pair as the repo does elsewhere.
- API shapes under `/api/toolings/…` and the finder endpoint.
- How the overlay is drawn in the panel (SVG from the returned polygons is
  expected).
- Test strategy: node:test on the pure geometry and classifiers with fixture DXFs
  and PDFs drawn from the archive; no browser test framework exists.
- Whether extraction scripts run in Node only or shell out to Python for raster
  tracing (no Python geometry libraries are installed today; Node with pdfjs-dist
  and xlsx is already in the repo).

## Deploy notes

- New Docker volume for tooling drawings and generated forms; nginx body cap for
  drawing uploads as done for order files.
- The one-time imports run against production by the user after review on the
  test server; the scripts must print what they will change before they change it.
- The local Docker stack is a **test server**; counts in this document from it
  are not facts about production.

## Open questions already answered in chat

- Insert number for an existing die lives in the die list (`IDBolster`).
- GEX-2 export can be widened to carry `IDBolster` under the same name.
- Several passing toolings: pick the one giving better support (closest fit).
- Finder placement: inside the new die order form (option A).
- New form does not create the order (future scope).
- Sizes are diameter × thickness.
- One tooling per die: inserts and bolsters in one list; one pair of fields filled.
- Chart: the all-presses sheet only; Press 9 ignored for now.
- Held press is not a gate; cross-press suggestions carry a transfer note.
- Extraction: include as much as possible; all three extractors in the first release.
