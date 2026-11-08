# Tooling geometry import — runbook

Reads the die shop's drawing archive, finds the pocket (opening) layout of each
insert and bolster, and loads three things: the drawings themselves
(`tooling_drawings`), the extracted openings (`tooling_openings`), and, for GEX-1
inserts, a `size_class` derived from the drawing (`size_class_source = 'drawing'`).
Drawings of toolings the master does not know are imported as `retired` toolings,
so they stay searchable.

Run the four steps in order: **convert, export known toolings, build bundle,
apply**. Run this after the master import (see `docs/tooling-master-import-runbook.md`),
because the bundle builder uses the master's toolings as matching hints.

Steps 1 and 3 run on the PC (they read the archive and AutoCAD). Steps 2 and 4 need
the database, so they run inside the backend container. The server never needs
AutoCAD.

---

## Prerequisites

- AutoCAD 2027 on the PC (`accoreconsole.exe`, the converter's default path).
- The archive: `C:\Users\vijee\Desktop\18.06.2026\New folder\14.Die Toolings`
  (9,538 in-scope drawings: 3,872 DWG, 1,573 DXF, 4,093 PDF).
- The backend image built from this branch, so every script and service is inside
  it. Rebuild from the worktree root:

```bash
docker compose -p die-tracker --env-file <path to .env> build backend
docker compose -p die-tracker -f docker-compose.yml --project-directory <checkout with .env> up -d --wait backend
```

  The `tooling-files` volume (`/app/storage/tooling-files`) is created by the
  compose file. If `/api` answers 502 afterwards, `docker compose restart frontend`.
- In Git Bash, `MSYS_NO_PATHCONV=1` is required in front of every `docker exec`.

## 1. Convert DWG to DXF (PC)

```bash
node server/scripts/convert-dwg-to-dxf.cjs [--archive <root>] [--dxf-dir <dir>] [--accoreconsole <exe>] [--concurrency 3] [--limit N] [--dry-run]
```

Defaults: archive as above, DXF cache `C:\Users\vijee\Desktop\18.06.2026\tooling-dxf`,
three AutoCAD sessions at a time. The DXFs mirror the archive paths. A DXF newer
than its DWG is skipped, so the script is safe to re-run and only converts what is
new. It writes `conversion-report.json` in the cache (`converted`, `skipped`,
`failed`); a failure never changes the exit code. Files go through an ASCII
temp path, so names with non-ASCII characters convert too.

Test-server result: 3,872 DWGs, all converted. The last re-run converted the two
non-ASCII names (`INS 23396 - ıns74415YER.dwg`, `ıns30208-501 - ıns76073.dwg`),
skipped 3,870, failed 0. Every DWG has a DXF.

## 2. Export the known toolings (backend container)

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/export-known-toolings.cjs --out /tmp/known-toolings.json
docker cp die-ordering-backend:/tmp/known-toolings.json "C:\Users\vijee\Desktop\18.06.2026\tooling-bundle\known-toolings.json"
```

Writes `{ exportedAt, toolings: [{ number, kind, plant, size_class, cavities, inventory_dims, status }] }`.
The builder uses it for size hints, cavity counts and number matching, so
re-export it whenever the master changes. Test server: 1,935 toolings.

## 3. Build the bundle (PC)

```bash
node server/scripts/build-tooling-bundle.cjs --out "C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/full-<date>" --known "C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/known-toolings.json" [--archive <root>] [--dxf-dir <dir>] [--limit N] [--only <substring>] [--dry-run] [--force]
```

Defaults: archive and DXF cache as above; `--out` defaults to
`C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/<today>`. It never deletes
anything in `--out` and refuses to run over an existing `manifest.json` unless
`--force`. Use `--limit 25` for a smoke bundle first.

The bundle folder holds `manifest.json`, `toolings.json`, `drawings.json`,
`openings.json`, `hints.json`, `report.json` and `files/` (the DXF/PDF copies; the
original DWG is not copied, its DXF is, and `archive_path` keeps the provenance).

Test-server result (`full-2026-11-08`, about 2 minutes, 2.5 GB):

| | |
|---|---|
| Drawing files in scope | 9,538 |
| Toolings matched | 3,505, of which 2,174 new to the master |
| Files and drawings in bundle | 8,265 |
| Openings extracted | 3,504 |
| Openings by confidence | confirmed 1,315, likely 1,400, uncertain 444, none 345 |
| Skipped | 515: unrecognised 320, press-part 53, scrap 142 |
| Extraction failures | 1 (`35IC1_090082.pdf`, zero bytes) |
| Read failures | 0 |
| Warnings | 340 (mostly "number mismatch: drawing names ...") |

## 4. Apply (backend container)

```bash
docker cp "C:\Users\vijee\Desktop\18.06.2026\tooling-bundle\full-<date>" die-ordering-backend:/tmp/tooling-bundle
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/apply-tooling-bundle.cjs /tmp/tooling-bundle --dry-run
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/apply-tooling-bundle.cjs /tmp/tooling-bundle
```

Always read the dry run first. It runs the whole transaction and rolls back.
The apply is one transaction, copies files only when absent, and never writes
`toolings.status`.

Test-server results:

| Run | toolings inserted / updated | drawings inserted / skipped | openings written | reviewed openings skipped | files copied |
|---|---|---|---|---|---|
| dry run | 2,155 / 1,093 | 8,191 / 74 | 3,504 | 0 | 0 |
| live | 2,155 / 1,093 | 8,191 / 74 | 3,504 | 0 | 8,191 |
| live again | 0 / 0 | 0 / 8,265 | 3,504 | 0 | 0 |

The 74 drawings skipped on the first run were already there from the 25-tooling
smoke apply. The second run is the idempotency check: nothing inserted, nothing
copied, the same openings rewritten.

## Re-running after new drawings arrive

1. Step 1 converts only the new DWGs.
2. Re-export the known toolings if the master changed (step 2).
3. Build a new bundle into a new `--out` (step 3).
4. Dry-run, then apply (step 4). Drawings are keyed by (tooling, sha256), so
   existing ones are skipped. Openings are rewritten from the new bundle **unless
   a person has reviewed them**; reviewed openings are never touched
   (`openingsSkippedReviewed` counts them).

## Verify

Run each through `docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "<query>"`.

```sql
select confidence, extraction_source, count(*) from tooling_openings group by 1,2 order by 1,2;
select plant, kind, status, count(*) filter (where size_class is not null) sized, count(*) total from toolings group by 1,2,3 order by 1,2,3;
select count(*) drawings, count(distinct tooling_id) toolings_with_drawings from tooling_drawings;
select t.number, o.confidence, o.extraction_note from tooling_openings o join toolings t on t.id=o.tooling_id where t.status='active' and o.confidence in ('uncertain','none') order by t.number limit 30;
```

Test-server output after the apply:

| confidence | source | count |
|---|---|---|
| confirmed | dxf | 1,315 |
| likely | dxf | 1,312 |
| likely | pdf-vector | 88 |
| uncertain | dxf | 444 |
| none | dxf | 221 |
| none | pdf-vector | 91 |
| none | pdf-raster | 33 |

| plant | kind | status | sized | total |
|---|---|---|---|---|
| GEX 1 | bolster | active | 14 | 14 |
| GEX 1 | bolster | retired | 154 | 216 |
| GEX 1 | insert | active | 867 | 1,421 |
| GEX 1 | insert | retired | 1,727 | 1,902 |
| GEX 2 | bolster | active | 71 | 79 |
| GEX 2 | bolster | retired | 5 | 6 |
| GEX 2 | insert | active | 420 | 421 |
| GEX 2 | insert | retired | 28 | 50 |

Drawings: 8,265 across 3,505 toolings. Size classes by source: drawing 2,782,
inventory 504, none 823. Retired (drawing-only) toolings: 2,174.

The fourth query's first 30 rows are all `25IC1-...` inserts marked `uncertain`
with "pocket count N disagrees with 1 cavities". The inventory says 1 cavity for
these, the drawing shows several pockets; check which is right before relying on
either.

## Confidence vocabulary

| Level | Meaning | For the finder |
|---|---|---|
| `confirmed` | DXF geometry, pocket count agrees with the inventory cavity count, dimensions agree with any inventory dimensions | Use as exact geometry. |
| `likely` | DXF or vector-PDF geometry, no contradicting hint | Use; show as drawing-derived. |
| `uncertain` | Geometry found but it disagrees with a hint (pocket count, size), or comes from a raster scan (capped here) | Offer only as a candidate with a warning; a person should review. |
| `none` | No usable geometry, or a vector PDF / scan with no scale basis | Never used for matching; the drawing is attached only. |

Raster scans never rise above `uncertain`. A vector PDF with no scale basis is
`none`; it is not scaled from the page size. Coloured strokes on vector PDFs are
dropped.

## Known gaps

- **TIFFs are skipped.** Only DWG, DXF and PDF are read.
- **DWGs without a DXF: none** on the test server (all 3,872 converted). If a
  future DWG fails to convert, it is reported in `conversion-report.json`.
- **Scans without inventory dimensions or a size class stay `none`.** The scale
  of a raster drawing comes from the inventory dimensions.
- **GEX-1 inserts have no size hints** in the 2024 inventory, so their scans cannot
  be scaled. Their size classes come only from DXF/vector drawings (867 of 1,421
  active GEX-1 inserts are sized).
- **The review queue is API-only** until Plan 5 adds the page. Nothing marks
  openings as reviewed in the UI yet, so `openingsSkippedReviewed` is 0.
- **One zero-byte PDF** (`35IC1_090082.pdf`) failed extraction; the drawing is
  still attached.
- **Stale mojibake files in the DXF cache.** The first converter run left two
  files named `Ä±ns...` in the cache root. They mirror no archive path and are
  ignored; they can be deleted by hand.
- **Unrecognised names (320 files)** are skipped. Most frequent stems, candidates
  for matcher follow-ups: `2B-Ins` (8), `2D` (6), `2E-INS` (4), `DRG block.dwg.222x80` (4),
  `P4 (INS-2B)` (4), `2B` (4), `Bol-2 (302 X 175mm )` (3), `Bol-3-B` (3), `2A-INS` (3),
  `2D-Ins` (3), `BOL-6-1-E200x200` (3), `4-6-61-Bol` (3), `6 cav Bol- P-4` (3),
  `Bol-2` (3), `Bol-4-1-B` (3), `BOL-5-1-F` (3), `Bol-5-2-B` (3), `2A` (3), `1234` (2),
  `9029` (2). The full list is `unmatched` in `report.json`.
- **Press-6 insert sheet** (`6.Press 6/Insert/PRESS 6 INSERTS(460 AND 560).xlsx`:
  insert number, size, length, width, cavities, centre gap; 37 rows) is not used
  yet. It is a cheap cross-check for the finder's verification.

Notes for a maintainer: pdf.js operator codes are quadratic curve = 3 and close
path = 4. In DXF, an ELLIPSE is a WCS entity: a mirrored extrusion normal only
reverses its sweep direction, it does not mirror the centre. Other entities use
the OCS and are mirrored.

## Production procedure

1. Back up the database.
2. Rebuild the production backend from this branch and make sure the
   `tooling-files` volume exists and is writable.
3. Run the master import first (`docs/tooling-master-import-runbook.md`), then
   export the known toolings from production (step 2).
4. On the PC, build the bundle (step 3) against the production export.
5. Copy the bundle folder to a path the backend container can read (a mounted
   directory, or `docker cp` to `/tmp/tooling-bundle`).
6. Run `apply-tooling-bundle.cjs <path> --dry-run` and read it. Compare the
   counts with the bundle's `manifest.json`; `openingsSkippedUnknownTooling` and
   `drawingsUnstored` should be 0.
7. Run it live, then the verify queries. A second live run must insert 0
   toolings and 0 drawings and copy 0 files.
