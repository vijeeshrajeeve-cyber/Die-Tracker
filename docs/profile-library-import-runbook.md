# Profile library import — runbook

Loads the extrusion profile shapes into `profile_shapes`, the library the tooling
finder searches for similar profiles and, where the size is known, fits into a
tooling. Two paths fill it:

- **The image-check workbook** (one-time seed, this runbook's two steps): every
  picture in the `GEX1` and `GEX2` sheets is traced into an outline, its holes and
  a 24-number signature (`source = 'image-check-xlsx'`). GEX-1 shapes are true-sized
  from the die list's CCD.
- **Every order-PDF import** (ongoing, nothing to run): the profile picture the PDF
  import already cuts from page 1 is traced the same way (`source = 'order-pdf'`),
  true-sized from the drawing's stated scale when another number backs it.

Run the two steps in order: **build bundle, apply**. Step 1 runs on the PC (it reads
the 167 MB workbook). Step 2 needs the database, so it runs inside the backend
container. The geometry import (`docs/tooling-geometry-import-runbook.md`) is
independent of this one; either can go first.

---

## Prerequisites

- **The workbook:** `C:\Users\vijee\Desktop\18.06.2026\Dies List ExtractedNew - Image Check - Final 30.10.2026.xlsx`
  (167 MB, 19,954 media files). Only the `GEX1` and `GEX2` sheets are read; the two
  GEX1 copies, `Summary`, `Sheet1`, `GEX1 Profiles` and `GEX2 Profiles` are ignored
  (the `Profiles` sheets have no pictures).
- **`@napi-rs/canvas` 0.1.100** as a direct dependency (`package.json`), installed by
  `npm install` on the PC. The builder decodes the GIF/PNG pictures with it. The
  same top-level copy serves `pdfjs-dist`; `pdf-parse` (dev only) keeps its own
  pinned 0.1.80.
- **The backend image built from this branch**, so the apply script, the
  `profile_shapes` table and the `/api/profile-shapes` routes are inside it. The
  Alpine image loads the native canvas build (`linux-x64-musl`); the order-PDF path
  does not need it (it decodes the posted PNG with a pure-JS decoder, see below).
  Rebuild as in the geometry runbook:

```bash
docker compose -p die-tracker --env-file <path to .env> build backend
docker compose -p die-tracker -f docker-compose.yml --project-directory <checkout with .env> up -d --wait backend
```

  If `/api` answers 502 afterwards, `docker compose restart frontend`.
- **The die list imported** (`existing_die_details`) for both plants. The apply
  reads each die's `cavity`, `die_type` and `raw_data->>'ProfileCCD'` from it.
- **The `tooling-files` volume** (`/app/storage/tooling-files`, `TOOLING_FILES_ROOT`).
  Pictures are stored under it at `profiles/<sha256 first 2>/<sha256>.<gif|png>`.
- In Git Bash, `MSYS_NO_PATHCONV=1` is required in front of every `docker exec`.

## 1. Build the bundle (PC)

```bash
node server/scripts/build-profile-bundle.cjs [--workbook <xlsx>] [--out <bundleDir>] [--sheet GEX1|GEX2] [--limit N] [--dry-run] [--force]
```

Defaults: the workbook above; `--out`
`C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/profiles-<today>`; both sheets; no
limit. It never deletes anything in `--out` and refuses to run over an existing
`manifest.json` unless `--force`. `--dry-run` reads and traces everything and
writes nothing. Use `--limit 200` for a smoke bundle first (4.6 s).

Each distinct picture is decoded and traced once, however many dies share it, and
copied once. The bundle folder holds `shapes.ndjson` (one shape per line, one line
per die picture, appended as the shapes are traced), `report.json`,
`files/profiles/<sha2>/<sha>.<gif|png>` and, written last, `manifest.json`
(`version: 2`); the build is complete when `manifest.json` exists. The applier
refuses a version-1 bundle (a single `shapes.json`): rebuild it.

Test-server result (`profiles-full-2026-11-08`, about 24 minutes, 271 MB, 19,939
picture files, `shapes.ndjson` 78 MB):

| | GEX1 | GEX2 | total |
|---|---|---|---|
| Data rows seen | 25,094 | 5,662 | 30,756 |
| Rows with a picture | 24,963 | 1,521 | 26,484 |
| Rows without a picture | 131 | 4,138 (+3 blank IDDie) | 4,269 |
| Picture anchors | 24,969 | 1,525 | 26,494 |
| Shapes written | 24,408 | 1,506 | 25,914 |
| Flagged `needs_review` | 229 | 7 | 236 |

- Pictures decoded: 19,939; shared by more than one die: 3,943.
- Traced to no shape (not written, `nullShape`): 580, so 26,494 − 580 = 25,914 shapes.
- `needsReview` counters: verdictMismatch 173, noteMismatch 221, noImage 125,
  blankOrUnclear 11, nullShape 580. The note counters count sheet rows, picture or
  not; 236 written shapes carry a flag.
- `styles`: silhouette 25,903, outline 11. `styleResolvedBy`: geometry 18,423,
  verdict 7,490, default 1.
- Errors: 3, all `blank IDDie` (GEX2 rows 4568, 4737, 4836).

GEX1 took about 18 minutes and GEX2 about 6: GEX2 has far fewer pictures, but its
large scans are slow to trace (see Known gaps).

## 2. Apply (backend container)

```bash
docker cp "C:\Users\vijee\Desktop\18.06.2026\tooling-bundle\profiles-<date>" die-ordering-backend:/tmp/profile-bundle
MSYS_NO_PATHCONV=1 docker exec -w /app die-ordering-backend node server/scripts/apply-profile-bundle.cjs /tmp/profile-bundle --dry-run
MSYS_NO_PATHCONV=1 docker exec -w /app die-ordering-backend node server/scripts/apply-profile-bundle.cjs /tmp/profile-bundle
```

The `docker cp` of the 19,939-file folder took 12 s on the test server.

Always read the dry run first. It runs the whole transaction and rolls back, and
prints a `would copy <path>` line for every picture not yet stored (one per
picture on a first apply, so redirect it to a file). The result is a JSON block:
`inserted`, `updated`, `unchanged`, `skippedReviewed`, `filesCopied`, `trueSized`,
`dieListMisses`.

What the apply does, per shape (one transaction):

- Looks the die up in the die list (plant spellings `GEX 1`/`GEX 01`, `GEX 2`).
  A miss is counted in `dieListMisses` and the shape is still written, without
  true size or cavities.
- **True size:** when the die list's `ProfileCCD` is a number of at least 20 mm, the
  unit outline is scaled so its minimal enclosing circle measures that CCD
  (`true_size_source = 'ccd-scaled'`, `true_size_confidence = 'likely'`). Below
  20 mm (die list placeholders) or blank: `true_size = false`, mm columns NULL. GEX 2
  has no CCD in the die list, so none of its workbook shapes is true-sized.
- Upserts on `(die_no, plant, source, source_ref)`; `source_ref` is the picture's
  cell (`GEX1!E1234`, `#2` for a row's second picture). A row identical in every
  derived column is counted `unchanged` and not written.
- Copies the picture into storage only when it is not there yet.

The applier reads `shapes.ndjson` line by line and keeps only counters and the list
of pictures still to copy, so it runs inside the stock 512 MB backend container:
peak container memory during the full live apply was 140 MiB (sampled every ~2 s
with `docker stats`). A line that is not JSON fails the whole transaction with its
line number.

Test-server results, 2026-11-08 (the 200-shape smoke bundle had been applied
before, so its rows count as `unchanged`):

| Run | inserted | updated | unchanged | skippedReviewed | filesCopied | trueSized | dieListMisses | time |
|---|---|---|---|---|---|---|---|---|
| dry run | 25,714 | 0 | 200 | 0 | 0 (19,383 `would copy`) | 20,725 | 177 | 54 s |
| live | 25,714 | 0 | 200 | 0 | 19,383 | 20,725 | 177 | 56 s |
| live again | 0 | 0 | 25,914 | 0 | 0 | 20,725 | 177 | 25 s |

`trueSized` counts every true-size shape in the bundle, written or unchanged.

## Re-running

The apply is idempotent: a second run with the same bundle writes nothing
(`unchanged` = every shape, `filesCopied` 0). A new bundle (say, after the workbook
is corrected) updates only the rows whose shape, flags or die-list values changed.

**A person's review is kept.** A row with `reviewed_at IS NOT NULL` is never
rewritten by any import, workbook or order PDF: the upsert is guarded by
`WHERE profile_shapes.reviewed_at IS NULL`, and such rows are counted in
`skippedReviewed`. Clearing `needs_review` is therefore permanent; a re-import
never flips it back.

Nothing is ever deleted by the scripts. A die whose picture disappears from a newer
workbook keeps its old row.

## The order-PDF path (no command)

`POST /api/orders/:id/profile-image` (the PDF import's profile capture) now also
records a shape, `source = 'order-pdf'`, `source_ref` = the order id, `image_path` =
the stored PNG's path under the order-files root. The PDF import posts the PNG
(rendered at 200 dpi) with the drawing's meta: every `SCALE a:b` on the sheet (main
view scale first), the title block's CCD and perimeters, the row's die size and
cavities.

When it is true size (`true_size_source = 'pdf-scale'`):

- **`confirmed`**: a reference CCD exists (the drawing's own stated CCD first, else
  the die list's; values under 20 mm are ignored) and one of the stated scales puts
  the traced outline's CCD within 3 % of it (the closest wins).
- **`likely`**: there is no reference CCD, and the main scale makes the profile fit
  the die with at least 40 mm to spare (traced CCD ≤ die diameter − 40).
- **Otherwise not true size**: a reference CCD that no scale agrees with, no stated
  scale, no die size: `true_size = false`, mm columns NULL. Never a guessed scale.

A shape failure never fails the upload. The shape is recorded after the upload's
transaction commits, in its own try/catch; the response is still `201`, with
`shape: { ok: false, error }` instead of `{ ok: true, trueSize, holeCount }`, and
the PNG is kept. Pictures crossed by dimension lines, typically thin-walled line
drawings, often trace to no profile at all (`no profile found in the picture`):
one of the three stored order PNGs on the test server did.

The posted bytes are decoded with `server/services/pngDecode.cjs` (pure JS, 40 MP
cap), not `@napi-rs/canvas`: the canvas decoder crashes the Node process on a
corrupt PNG with a valid signature.

For a die with several rows, the API lists the newest first and `hasTrueSize`
tells whether any is true-sized; the fit (Plan 4) takes the newest true-size row.

## Verify

Run each through `MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "<query>"`.

```sql
select plant, source, true_size, needs_review, count(*) from profile_shapes group by 1,2,3,4 order by 1,2,3,4;
select plant, count(*) filter (where true_size) sized, count(*) total, round(avg(ccd_mm) filter (where true_size)) avg_ccd from profile_shapes group by 1;
select hole_count, count(*) from profile_shapes group by 1 order by 1;
select die_no, review_reason from profile_shapes where needs_review and plant = 'GEX 1' limit 20;
```

Test-server output after the live apply (2026-11-08; the two `order-pdf` rows are
from the Task 6 smoke):

| plant | source | true_size | needs_review | count |
|---|---|---|---|---|
| GEX 1 | image-check-xlsx | f | f | 3,647 |
| GEX 1 | image-check-xlsx | f | t | 36 |
| GEX 1 | image-check-xlsx | t | f | 20,532 |
| GEX 1 | image-check-xlsx | t | t | 193 |
| GEX 2 | image-check-xlsx | f | f | 1,499 |
| GEX 2 | image-check-xlsx | f | t | 7 |
| GEX 2 | order-pdf | t | f | 2 |

| plant | sized | total | avg_ccd |
|---|---|---|---|
| GEX 1 | 20,725 | 24,408 | 122 |
| GEX 2 | 2 | 1,508 | 60 |

GEX 1: 20,725 of 24,408 workbook shapes (84.9 %) are true-sized. The 3,683 that
are not: die list CCD blank 2,106, CCD under 20 mm 1,404, no die list row 173.
Median true-size CCD 86 mm.

Hole counts: 0 → 11,135; 1 → 10,942; 2 → 2,133; 3 → 846; 4 → 332; 5 → 275;
6 → 74; 7 → 61; 8 → 15; 9 → 33; 10 → 11; 11 → 10; 12 → 8; 13 → 26; 14 → 8;
16 → 1; 17 → 4; 19 → 2.

The fourth query's rows are almost all the sheet's own notes, and most agree with
the tracer, e.g. `26572_401`: "Mismatch: image shows SOLID profile (no closed
cavity); image shows a solid section but the sheet says hollow". A few carry only
the note (`28792_401`: "Mismatch: image shows HOLLOW profile (closed cavity)").

Also worth running:

```sql
select profile_number, die_no from profile_shapes where plant = 'GEX 2' limit 5;
select count(*) from profile_shapes where true_size and ccd_mm > 400;
```

GEX 2 profile numbers keep their leading zero (`090019` / `090019-2501`): the
workbook stores them as text. 76 GEX 2 rows (sheet rows ~896–967) have a
five-digit profile number one zero short of the die number (`28144` /
`028144-201`, `09090` / `009090-401`); that is how the sheet spells them.

Similarity spot-check, `GET /api/profile-shapes/<die>/similar?plant=GEX%201&limit=8`,
pictures compared through the image route:

| Query | Top 3 | Warm time | Verdict |
|---|---|---|---|
| `17740_502` (4 holes) | `17740_501` (d 0), `17737_201` (0.039), `16675_202` (0.067) | 30–33 ms | Same design family: the sister die, then two near-identical four-chamber profiles. |
| `22575_401` (solid, aspect 4.5) | `24807_601` (0.077), `22497_401` (0.083), `23620_501` (0.083) | 45–50 ms | Coarse family only: long flat solid bars with steps or lugs; none is the same design. |
| `11088_102` (solid, aspect 19) | `25455_201` (0.031), `25047_601` (0.032), `21933_201` (0.044) | 46–50 ms | Coarse family only: very long thin strips; details (lips, taper, serrations) differ. |

The first request after a restart loads the plant's index (313 ms here); later
requests stay under 50 ms.

## Review vocabulary

| Column | Values | Meaning |
|---|---|---|
| `needs_review` | true / false | The shape is in doubt. Flagged rows are stored and returned by `GET /:dieNo`, but never appear in similarity results. |
| `review_reason` | text, reasons joined with `; ` | Why: the sheet's `Image Check` note (`Mismatch: ...`, `No image in Column E`, `Image blank/unclear - cannot verify`), and/or the tracer's own reason (`image shows a hollow section but the sheet says solid`, `image shows a solid section but the sheet says hollow`). |
| `reviewed_by`, `reviewed_at` | user, time | Set when a person clears the flag (Plan 5's review queue). Once set, no import touches the row. |
| `true_size` | true / false | `outer_mm`, `holes_mm` and `ccd_mm` hold a real-size outline. False means the mm columns are NULL; only the unit-frame shape is known. |
| `true_size_source` | `ccd-scaled`, `pdf-scale`, `drawing`, `manual` | Where the size came from: the die list's CCD (workbook shapes), the order drawing's stated scale, a vector drawing (Plan 5), a person. |
| `true_size_confidence` | `confirmed`, `likely`, `uncertain` | `confirmed`: two independent numbers agree (a stated scale and a CCD, within 3 %). `likely`: one number, nothing contradicting it (every `ccd-scaled` row; an order PDF sized from its main scale alone). |
| `style` | `silhouette`, `outline` (`vector` reserved) | How the picture draws the section: filled, or as a line drawing. In an outline picture the holes are the regions at even nesting depth. |

**The inspector's verdict resolves ambiguous pictures.** A thin-walled section with
one big enclosed region looks the same as an outline drawing of a solid. When the
geometry cannot tell (`styleResolvedBy` in the build report), the sheet's verdict
(GEX1 column F, else the die type in column C) decides: hollow → `silhouette` with
that one hole, solid → `outline` with no holes. With no verdict the default is
`outline`. A verdict that contradicts what the geometry clearly shows flags the
row instead.

## Known gaps

- **GEX 2 has no CCD in the die list**, so none of its 1,506 workbook shapes is
  true-sized. GEX 2 shapes become true-sized only as order PDFs arrive (each one
  records an `order-pdf` row; the newest true-size row wins).
- **GEX 1 shapes without a usable CCD** (3,683): blank 2,106, under 20 mm 1,404, die
  not in the die list 173.
- **Implausible die-list CCDs are taken as given.** 558 true-sized shapes have a CCD
  over 400 mm and 38 over 1,000 mm (`07078_301`: 11,785 mm), larger than any die.
  They are `likely`, not checked against the die size.
- **Outline-style hollow pictures are the weakest.** A thin-walled section with one
  large enclosed region cannot be told from an outline drawing by geometry; the
  sheet's verdict decides (7,490 pictures were resolved that way). With no verdict
  the default is `outline` (1 picture). Only 11 shapes came out `outline`.
- **Pictures crossed by dimension lines** are traced as one shape and the largest
  closed shape is kept, so they can come out wrong or as nothing. 580 workbook
  pictures traced to no shape and are not in the library (the build does not break
  down why). Order PDFs whose profile picture carries dimension lines often fail
  the same way (the upload is kept).
- **Rows without pictures:** 131 in GEX1 (the sheet's 125 "No image in Column E"
  rows plus in-cell pictures) and 4,138 in GEX2 (`Image not found`). 14 rows (GEX1
  13756, 14309, 15111, 15253, 15382, 15956, 16327, plus an in-cell picture at I15955;
  GEX2 127, 134, 884, 944, 948, 962, 991) hold a "Place in Cell" picture stored
  under `xl/richData`, which the reader does not follow. One GEX2 anchor (row 1084)
  has no image data.
- **The `GEX1 Profiles` and `GEX2 Profiles` sheets are ignored** (no pictures), as
  are the two GEX1 copies, `Summary` and `Sheet1`.
- **About 106 GEX2 pictures are large scans** (8 MP or more, most 5975×2619, about
  15 MP) and take 2–7 s each to trace, against ~20 ms for a normal picture. They
  account for most of the GEX2 build time.
- **The similarity is shape-only.** Mirror images and rotations are equal by design,
  hole count must match exactly, and for plain solid bars the nearest neighbours
  share the proportions rather than the design (see the spot-check).
- **The review queue is API-only** until Plan 5; nothing sets `reviewed_at` yet, so
  `skippedReviewed` is 0.

## Production procedure

1. Back up the database.
2. Rebuild the production backend from this branch. The `profile_shapes` table is
   created by the migration at start-up; make sure the `tooling-files` volume exists
   and is writable.
3. Import (or re-import) the die list for both plants first: the apply reads the
   CCD and cavities from it, and a die missing from it gets no true size.
4. On the PC, build the bundle (step 1) into a new `--out`. The bundle does not
   depend on the database, so the test server's bundle can be reused if the
   workbook has not changed.
5. Copy the bundle folder into the backend container (`docker cp ... /tmp/profile-bundle`,
   or a mounted directory).
6. Run `apply-profile-bundle.cjs <path> --dry-run` and read it. The bundle must be
   version 2 (`shapes.ndjson`); a version-1 bundle is refused. `inserted` should
   equal the manifest's `counts.shapes` on an empty table; check `dieListMisses`.
7. Run it live, then the verify queries. A second live run must report
   `unchanged` = every shape, `inserted` 0, `updated` 0, `filesCopied` 0.
8. Remove the bundle from the container (`docker exec die-ordering-backend rm -rf /tmp/profile-bundle`).

**Rollback.** The workbook rows are separable by source:

```sql
DELETE FROM profile_shapes WHERE source = 'image-check-xlsx';
```

Always scoped by `source`; never run an unscoped `DELETE` on `profile_shapes` (it
would also remove the order-PDF shapes, which are recorded live and cannot be
rebuilt from a bundle). Rows a person has reviewed are deleted by this too; add
`AND reviewed_at IS NULL` to keep them. The stored pictures under
`profiles/` can stay (they are content-addressed and harmless).

## API (for Plans 4 and 5)

All behind the normal login (`authMiddleware`), mounted at `/api/profile-shapes`.
`plant` is required and normalised by `normalizePlant` (`GEX 1`, `gex 01` → `GEX 1`; `GEX1` without the space is not recognised).

| Route | Answers |
|---|---|
| `GET /:dieNo?plant=` | `{ shapes, hasTrueSize }`: every stored row for the die, newest first, without `signature`. 404 when the die has none. |
| `GET /:dieNo/similar?plant=&limit=` | `{ items }`: the nearest dies by signature, same hole count only, excluding the die itself and every `needs_review` row; one item per die (its best row). The query is the die's newest row. `limit` 1–100, default 20. Item: `{ die_no, profile_number, distance, cavityMatch, trueSize, shapeId }`; `cavityMatch` is null when either cavity count is unknown. |
| `POST /similar` | Body `{ plant, outer, holes?, cavities?, limit? }` (polygons as `[x, y]` arrays, any scale). `{ items, signature }`. 400 on a bad polygon. |
| `GET /:dieNo/image/:shapeId?plant=` | The stored picture (`image/gif` or `image/png`). Order-PDF rows read from the order-files root, the rest from the tooling-files root; 404 when missing. |

The similarity index is held in memory per plant and reloaded only when the plant's
row count or newest `updated_at` changes, so a fresh import is picked up on the
next request.

Client: `profileShapesAPI.forDie(dieNo, plant)`, `.similar(dieNo, { plant, limit })`,
`.similarTo({ plant, outer, holes, cavities, limit })` in `src/api.js`.
