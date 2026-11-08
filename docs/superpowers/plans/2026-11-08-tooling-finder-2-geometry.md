# Tooling Finder, Plan 2 of 5: Geometry Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill `tooling_openings` (outer outline + pocket polygons in millimetres, with a confidence) and derive the missing GEX-1 size classes from the drawing archive, by converting DWGs to DXF on the user's PC, extracting openings from DXF, vector-PDF and scanned-PDF drawings into an import bundle, and loading that bundle server-side with the drawings stored under a new storage root.

**Architecture:** Pure modules under `server/services/` do the work and are unit-tested on real fixtures copied from the archive: a DXF reader (entities → polyline chains + texts), a geometry module (chain loops, classify outer vs pockets, confidence), one extractor per source (`dxf`, `pdf-vector`, `pdf-raster`) that all return the same `ExtractionResult`, an archive matcher (file name → tooling number, kind, plant, size hint), and a bundle builder/applier with injected IO. Four scripts under `server/scripts/` drive them: `convert-dwg-to-dxf` (PC, spawns AutoCAD's `accoreconsole.exe`), `export-known-toolings` (server → JSON hints), `build-tooling-bundle` (PC: walk → match → copy → extract → JSON), `apply-tooling-bundle` (server: idempotent load). The read API grows a drawings list, a file download and a review-queue listing; nothing in this plan builds UI or the finder.

**Tech Stack:** Node 20 CommonJS (`.cjs`), Express, Postgres via `pg`, `pdfjs-dist` 5.4 legacy build (already a dependency; loaded with `await import('pdfjs-dist/legacy/build/pdf.mjs')` as `server/services/jFileTemplate.cjs` and `supplierReportPdf.test.cjs` already do), `node:test` + `node:assert/strict`, route tests via `server/routes/testSupport.cjs`. **No new npm dependencies**: the DXF reader, geometry and raster tracer are written here; PDF pages are never rendered (vector paths come from the operator list, scans from the decoded image object), so no canvas package is needed.

**Spec:** `docs/superpowers/specs/2026-11-07-tooling-finder-design.md` — read it first; this plan implements its "Tooling master" size-class paragraph, the `tooling_openings` half of part 1, and part 8 "Import and extraction pipeline" (`attach-tooling-drawings` + `extract-openings` are folded into one bundle builder; `apply-tooling-bundle` is the server side). Plan 1 (`docs/superpowers/plans/2026-11-07-tooling-finder-1-master.md`, merged to `main` as `4f08298`) created the tables and normalisers this plan consumes.

**Plan series:** 1 master data (done) · **2 this plan** · 3 profile library · 4 the finder · 5 UI (Tooling page with the review queue, New die order form, upload).

**Branch:** start from `main` (`4f08298`) in a fresh worktree via superpowers:using-git-worktrees at `.claude/worktrees/tooling-finder-2`, branch `feat/tooling-finder-2-geometry`. The main checkout sits on `feat/sample-followup-mass-update` with unrelated uncommitted work; do not build on it. This plan exists only as an untracked file in that checkout: copy it into the worktree and commit it in Task 1.

## What the archive survey found (facts the tasks rely on)

- **Dieshop inserts** (`Toolings/Dieshop - Insert Drawings/AutoCad/**/<5 digits>.dwg`, 2,888 files, 2,687 unique die numbers; 916 of them are live GEX-1 inserts in the master). Converted DXFs are in mm (`$INSUNITS` 4), everything sits on layer `Layer3`: a drawing frame (closed 4-vertex LWPOLYLINE, e.g. 280 × 195), title-block cells, an outer `CIRCLE` (r 87.5 → Ø175; r 110 → Ø220), the pocket as **one open `LWPOLYLINE` with bulges whose first and last vertices coincide** (gap 0.000), centre lines (two `LINE`s through the circle centre), sometimes a bolt hole (`CIRCLE` r 5) and a keyway loop touching the outer (24 × 14 closed polyline at the rim). Title block `TEXT` values: `Insert No.`, `Insert Size`, `Press `, `Drawn By` labels and values `21599`, `Ø175 x 80 `, `3`, `Jonimar`, a date. There is **no side view**, so thickness comes only from the size text.
- **Bolster DXFs** (`Toolings/Toolings/BOLSTER/`, 254 DXF + 186 DWG + 78 PDF): often **no outer circle at all**; the pocket is `LINE`s + `ARC`s (14017: rounded rectangle 250 × 150, corner r 15, exactly the inventory dims `a_len` 250 / `b_wid` 150), plus crossing centre lines and `DIMENSION`s. Text: `MTEXT "BOL-14017\P475X220"`, i.e. the number and the size class.
- **Supplier DXFs** (Italian/Dutch, e.g. `INS-30610.1.460x150.P6.dxf`, `16021-Bol.dxf`): numeric layer names, `INSERT` block references, `HATCH`, `POINT`, `SOLID`; size class in the **file name** (`460x150`) or text (`�475 x 220`, `BOLSTER DIA.475xH.220`).
- **Vector PDFs with text** (root `BOL-27080.pdf`, `INS-*.pdf`, TALEX): two views (hatched side section + top view), outer circle, pockets, bolt holes, a key slot at the rim, dimension lines, and an **orange profile overlay** drawn inside the pocket. Text layer carries `Ø475x220 BOLSTER` and `BOL-27080`. pdfjs 5 `constructPath` args are `[paintOp, [Float32Array data], minMax]` where `data` is a flat stream of `op, coords…` with ops `0` moveTo (x y), `1` lineTo (x y), `2` curveTo (x1 y1 x2 y2 x3 y3), `3` closePath; coordinates are in the current user space, so the CTM from `transform`/`save`/`restore` must be tracked.
- **Dieshop PDFs** (`PDF & Tiff/**/<die>.pdf`, 2,888): vector, **no text layer**, and the same drawings as the DWGs — only useful when a DWG is missing. The 2,891 TIFFs are scans of the same drawings: **skipped**.
- **Scanned bolster PDFs** (e.g. `BOLSTER/15109-Bol1.pdf`): one RGB image XObject (1275 × 1760, letter at 150 dpi), hand-drawn **blue-ink** pocket (obround 115 × 350) with handwritten dimensions, no outer circle. Scale can only come from the inventory dims (`BOL-15109` a_len 350) or a drawn outer.
- **TALEX (GEX-2)** stems: `35IC1-120021`, `35IC1_026904 (1)`, `INS-35IC1-013010`, `25B2C1A` (master has these as `BOL-25B2C1A`, category `BOLSTER HOLDER`), `TLX-35B2C1A-051033.1.600x370.P2`.
- **`accoreconsole.exe`** (`C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe`) converts one DWG in about 2–3 s with a CRLF script `FILEDIA` / `0` / `_.DXFOUT` / `"<out.dxf>"` / `16` / `_.QUIT` / `Y`, invoked as `accoreconsole.exe /i "<dwg>" /s "<script>" /l en-US`. Exit code 0 and the DXF present mean success.
- Master state (test server): GEX-1 inserts 1,421 with **0 size classes**; GEX-1 bolsters 14 (all with `inventory_dims`); GEX-2 inserts 421 (420 sized), bolsters 79 (70 sized).

## Global Constraints

- Server code is CommonJS in `server/**/*.cjs`; tests `*.test.cjs` beside the module, run by `npm test`. No Jest/Vitest. ESM-only packages (`pdfjs-dist`) are loaded with `await import()` inside async functions.
- Every schema change is written **twice**: `init.sql` and the migration in `server/db.cjs`; new tables as `CREATE TABLE IF NOT EXISTS` in both; new columns on an existing table are added to the `CREATE TABLE` text in **both** files **and** as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `db.cjs` only. `server/services/toolingSchema.test.cjs` must keep passing and must cover every tooling table.
- Geometry unit is **millimetres**. A polygon is `Array<[x, y]>` with no repeated closing point; orientation is not significant. Coordinates are translated so the **outer outline's bounding-box centre is (0, 0)**; when the outer is synthesised, the joint bounding box of the pockets is centred instead.
- Arcs, bulges and Bézier curves are flattened with a maximum chord deviation of **0.1 mm** and at least **8 segments per quarter circle**.
- Chaining tolerances: endpoints within **0.5 mm** join silently; gaps up to **3 mm** are bridged and noted (raised from 2 mm after the corpus diagnostic in Task 9b); larger gaps are never bridged (the chain stays open and is not a loop).
- Confidence vocabulary is the table's: `confirmed` / `likely` / `uncertain` / `none`. Raster (`pdf-raster`) results are never better than `uncertain`. Nothing is guessed: when the scale cannot be established the result is `none` with a note, not a scaled guess.
- Canonical tooling numbers, size classes and plants come from Plan 1's helpers: `parseToolingNumber`, `normalizeSizeClass`, `resolveToolingRef` (`server/services/toolingNumbers.cjs`), `normalizePlant` (`server/services/frozenDesigns.cjs`). Press names are `PRESS n`.
- Toolings created from drawings alone are inserted with `status = 'retired'`, `source = 'drawing-archive'`; the apply step **never changes `status`**, never overwrites a non-NULL `size_class` or `cavities`, and never overwrites a `tooling_openings` row whose `reviewed_at` is set.
- Scripts are idempotent, take `--dry-run`, print what they will change before changing it, and never run an unscoped `DELETE`.
- Stored drawing files live under `TOOLING_FILES_ROOT` (default `/app/storage/tooling-files`) at `<sanitised number>/<sha256 first 8>_<sanitised original name>`; paths are checked with the same `isInsideRoot` rule as `server/services/orderFiles.cjs`.
- Commit after every task; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A DXF saved in inches (`$INSUNITS` 1) must come out in mm — Task 3 test `an inch drawing is scaled to millimetres`.
2. A pocket drawn as loose `LINE`/`ARC` runs with 0.3 mm end gaps must become one closed loop, while a 15 mm gap must leave the chain open and the result `none`, never a silently closed pocket — Task 2 tests `joins segments whose ends are within 0.5 mm` and `does not bridge a 15 mm gap`.
3. Bolt holes (Ø10 circles) and rim keyways must not count as pockets — Task 3 tests on the 21599 and 09658 fixtures.
4. A coloured profile overlay inside a vector-PDF pocket must not become a second pocket — Task 6 test `coloured strokes are not geometry`.
5. Re-applying a bundle after the die shop confirmed an opening must leave that opening untouched — Task 9 test `a reviewed opening is never overwritten`.

---

### Task 1: Fixtures, plan commit, DXF reader

**Files:**
- Create: `server/services/dxfReader.cjs`
- Create: `server/services/fixtures/tooling/dieshop-21599.dxf`, `dieshop-09658.dxf`, `bolster-14017.dxf`, `bolster-BOL-27080.pdf`, `bolster-15109-scan.pdf`
- Test: `server/services/dxfReader.test.cjs`
- Commit also: this plan (`docs/superpowers/plans/2026-11-08-tooling-finder-2-geometry.md`)

**Interfaces:**
- Produces:
  - `parseDxf(text: string) → { header: { insunits: number|null }, blocks: Map<string, RawEntity[]>, entities: RawEntity[] }` — `RawEntity = { type: string, layer: string, groups: Array<[code: number, value: string]> }` in file order; only sections `HEADER`, `BLOCKS` (keyed by block name, group 2) and `ENTITIES` are kept.
  - `flattenDxf(dxf, { chordTolerance = 0.1 } = {}) → { chains: Chain[], texts: Text[], unitScale: number }` — `Chain = { layer: string, points: Array<[x, y]>, closed: boolean, source: 'LINE'|'ARC'|'CIRCLE'|'LWPOLYLINE'|'POLYLINE'|'ELLIPSE'|'SPLINE' }`, `Text = { layer: string, value: string, x: number, y: number }`. Handles `LINE`, `ARC` (50/51 degrees, counter-clockwise), `CIRCLE` (closed), `LWPOLYLINE` (70 bit 1 closed, per-vertex bulge 42), `POLYLINE` + `VERTEX` … `SEQEND`, `ELLIPSE` (11/21 major axis, 40 ratio, 41/42 parameters), `SPLINE` (degree 71, knots 40, control points 10/20, weights 41 — de Boor evaluation, 16 samples per knot span), `INSERT` (expands the block's entities with 10/20 insertion, 41/42 scale, 50 rotation, recursively), `TEXT`/`MTEXT` (group 1 plus `3` continuation chunks for MTEXT). Everything else (`DIMENSION`, `HATCH`, `LEADER`, `POINT`, `SOLID`, `IMAGE`, `ATTRIB`, `VIEWPORT`) is ignored. `unitScale` is `25.4` when `insunits === 1`, `1` otherwise (0/absent/4 all mean mm here; `2` feet → 304.8).
  - `plainText(value: string) → string` — strips MTEXT formatting (`{\fTimes New Roman|b0|…;…}` wrappers, `\P` → space, `\W…;`, `\p…;`, `^M`), maps `%%C`/`%%c` → `Ø`, `%%D` → `°`, `%%P` → `±`, and collapses whitespace.

- [ ] **Step 1: Create the worktree and commit the plan**

From the main checkout root: `superpowers:using-git-worktrees` → `.claude/worktrees/tooling-finder-2` on branch `feat/tooling-finder-2-geometry` from `main`. Copy this plan in and `git add docs/superpowers/plans/2026-11-08-tooling-finder-2-geometry.md`. Run `npm install` in the worktree if `node_modules` is missing, then `npm test` to confirm the 1070-pass baseline.

- [ ] **Step 2: Copy the fixtures**

Archive root `A = C:\Users\vijee\Desktop\18.06.2026\New folder\14.Die Toolings`:
- `bolster-14017.dxf` ← `A\Toolings\Toolings\BOLSTER\**\14017 Bol(475x220).dxf` (find it with `Get-ChildItem -Recurse -Filter "14017 Bol(475x220).dxf"`).
- `bolster-BOL-27080.pdf` ← `A\BOL-27080.pdf` (133 KB).
- `bolster-15109-scan.pdf` ← `A\Toolings\Toolings\BOLSTER\**\15109-Bol1.pdf` (56 KB).
- `dieshop-21599.dxf`, `dieshop-09658.dxf`: converted copies exist at `C:\Users\vijee\AppData\Local\Temp\claude\7190430abec70768\aaba689e-9d4d-4f6c-83c8-f4577366726e\scratchpad\dxfprobe\21599.dxf` and `09658.dxf`. If that folder is gone, regenerate from `A\Toolings\Dieshop - Insert Drawings\AutoCad\**\21599.dwg` / `09658.dwg` with the PowerShell recipe below (it is also what Task 7 automates):

```powershell
$dxf = "<absolute out path>\21599.dxf"; $scr = "<absolute out path>\todxf.scr"
[IO.File]::WriteAllText($scr, (@("FILEDIA","0","_.DXFOUT","`"$dxf`"","16","_.QUIT","Y") -join "`r`n") + "`r`n", [Text.Encoding]::ASCII)
& "C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe" /i "<dwg path>" /s $scr /l en-US
```

- [ ] **Step 3: Write the failing tests**

```js
// server/services/dxfReader.test.cjs
const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'tooling', n), 'utf8');

test('parses the Dieshop fixture into header, blocks and entities', () => {
  const dxf = parseDxf(fixture('dieshop-21599.dxf'));
  assert.equal(dxf.header.insunits, 4);
  const byType = {}; for (const e of dxf.entities) byType[e.type] = (byType[e.type] || 0) + 1;
  assert.equal(byType.CIRCLE, 2); assert.equal(byType.LWPOLYLINE, 5); assert.equal(byType.TEXT, 13); assert.equal(byType.MTEXT, 1);
  assert.ok(dxf.blocks.size >= 1);
});

test('flattens the Dieshop fixture: circles closed, the pocket polyline keeps its bulge arcs, texts are plain', () => {
  const { chains, texts, unitScale } = flattenDxf(parseDxf(fixture('dieshop-21599.dxf')));
  assert.equal(unitScale, 1);
  const circles = chains.filter((c) => c.source === 'CIRCLE');
  assert.equal(circles.length, 2);
  assert.ok(circles.every((c) => c.closed && c.points.length >= 32));
  const pocket = chains.find((c) => c.source === 'LWPOLYLINE' && c.points.length > 30); // 26 vertices + 18 bulges flattened
  assert.ok(pocket, 'the bulged polyline was flattened into many points');
  assert.ok(texts.some((t) => t.value === 'Ø175 x 80'));
  assert.ok(texts.some((t) => t.value === '21599'));
});

test('flattens the bolster fixture: six lines and four quarter arcs, MTEXT split on \\P', () => {
  const { chains, texts } = flattenDxf(parseDxf(fixture('bolster-14017.dxf')));
  assert.equal(chains.filter((c) => c.source === 'LINE').length, 6);
  assert.equal(chains.filter((c) => c.source === 'ARC').length, 4);
  const arc = chains.find((c) => c.source === 'ARC');
  assert.ok(arc.points.length >= 8);
  const r = Math.hypot(arc.points[0][0] - -110, arc.points[0][1] - -60); // first arc centre (-110,-60) r 15
  assert.ok(Math.abs(r - 15) < 1e-6);
  assert.ok(texts.some((t) => t.value === 'BOL-14017 475X220'));
});

test('expands INSERT block references with translation, scale and rotation', () => {
  const text = dxfOf({ blocks: { SQ: [line(0, 0, 10, 0), line(10, 0, 10, 10)] }, entities: [insert('SQ', 100, 50, 2, 90)] });
  const { chains } = flattenDxf(parseDxf(text));
  assert.equal(chains.length, 2);
  // (10,0) scaled ×2 then rotated 90° → (0,20), translated → (100,70)
  assert.deepEqual(chains[0].points[1].map((v) => Math.round(v)), [100, 70]);
});

test('arcs flatten within 0.1 mm chord deviation and 8 segments per quadrant', () => {
  const { chains } = flattenDxf(parseDxf(dxfOf({ entities: [arc(0, 0, 100, 0, 90)] })));
  assert.ok(chains[0].points.length >= 9);
  for (let i = 1; i < chains[0].points.length; i++) {
    const [ax, ay] = chains[0].points[i - 1], [bx, by] = chains[0].points[i];
    const mid = Math.hypot((ax + bx) / 2, (ay + by) / 2);
    assert.ok(100 - mid <= 0.1 + 1e-9);
  }
});

test('inch drawings report unitScale 25.4', () => {
  assert.equal(flattenDxf(parseDxf(dxfOf({ insunits: 1, entities: [line(0, 0, 1, 0)] }))).unitScale, 25.4);
});

test('plainText strips MTEXT codes and maps %% symbols', () => {
  assert.equal(plainText('{\\fTimes New Roman|b0|i0|c0|p18;ALL DIMENSIONS ARE IN MM.}'), 'ALL DIMENSIONS ARE IN MM.');
  assert.equal(plainText('%%C300X100 INSERT'), 'Ø300X100 INSERT');
  assert.equal(plainText('{\\W0.83;\\p;BOLSTER DIA.475xH.220^M\\P\\p;\\P}'), 'BOLSTER DIA.475xH.220');
});
```

The DXF builders live in `server/services/fixtures/tooling/dxfBuilders.cjs` (Task 3 reuses them): `dxfOf({ insunits = 4, blocks = {}, entities }) → string` (minimal group-code text: `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC…`, a BLOCKS section per named block, an ENTITIES section), `line(x1, y1, x2, y2)`, `arc(cx, cy, r, startDeg, endDeg)`, `circleEntity(cx, cy, r)`, `lwpolyline(points, { closed = false, bulges = [] } = {})`, `insert(blockName, x, y, scale = 1, rotationDeg = 0)`, `rectLines(w, h, cx = 0, cy = 0) → entity[]` (four `line`s), `text(value, x, y)`. Each builder returns the entity's group-code text (or an array of them) and `dxfOf` concatenates.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test server/services/dxfReader.test.cjs`
Expected: FAIL — `Cannot find module './dxfReader.cjs'`.

- [ ] **Step 5: Implement `server/services/dxfReader.cjs`**

Read group-code pairs line by line (tolerate `\r\n`); `0` starts an entity, `SECTION`/`2` names a section, `BLOCK`/`2` names a block, `ENDBLK`/`ENDSEC` close. Bulge `b` between vertices P1 and P2 is an arc with included angle `4·atan(b)`; a zero bulge is a straight segment. Segment count for an arc of sweep θ (radians) and radius r: `max(ceil(θ / (π/16)), ceil(θ / (2·acos(1 − 0.1 / r))))`. Block expansion applies scale, then rotation, then translation, to every point (nested INSERTs recurse with the composed transform; guard depth 8). Spline: when control points and knots are present evaluate the B-spline; when only fit points are present (group 11/21) use them as the polyline.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test server/services/dxfReader.test.cjs`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-11-08-tooling-finder-2-geometry.md server/services/dxfReader.cjs server/services/dxfReader.test.cjs server/services/fixtures/tooling/
git commit -m "feat(tooling): DXF reader with block expansion and arc flattening; archive fixtures"
```

---

### Task 2: Opening geometry — loops, classification, confidence

**Files:**
- Create: `server/services/openingGeometry.cjs`
- Test: `server/services/openingGeometry.test.cjs`

**Interfaces:**
- Consumes: `Chain` from Task 1.
- Produces:
  - `chainLoops(chains, { joinTol = 0.5, bridgeTol = 3 } = {}) → { loops: Loop[], open: Chain[], bridged: number }` — `Loop = { points: Array<[x, y]>, layer: string, bridgedGaps: number, sources: string[] }`. Already-closed chains are loops as they are; open chains are joined end-to-end (either end, reversing as needed) while an endpoint lies within `joinTol`; a remaining gap ≤ `bridgeTol` between the two free ends of a chain closes it and counts in `bridgedGaps`; anything else stays in `open`.
  - `polygonArea(points) → number` (absolute), `centroid(points) → [x, y]`, `bbox(points) → { minX, minY, maxX, maxY, width, height, cx, cy }`, `pointInPolygon(p, points) → boolean`, `polygonContains(outer, inner) → boolean` (every vertex of `inner` inside `outer`).
  - `circleFit(points) → { cx, cy, r, maxDeviation }` (algebraic least squares; `maxDeviation` = max |dist − r|), `isCircleLike(points) → boolean` when `maxDeviation ≤ max(1, 0.01·r)`.
  - `classifyLoops(loops, { expectedOuterDiameter = null } = {}) → { outer: Loop|null, outerSynthesised: boolean, pockets: Loop[], ignored: Array<{ loop, reason }> }`. Rules, in order: (1) the outer is the **largest circle-like loop with diameter ≥ 100 mm**; when `expectedOuterDiameter` is given, the circle-like loop whose diameter is closest to it wins and only if within 10 % (a drawing frame or title block is never the outer, even though it is the largest loop); (2) when no circle-like loop qualifies: with `expectedOuterDiameter` given, the outer is a synthesised 64-point circle of that diameter centred on the joint bbox centre of all loops (`outerSynthesised: true`); with none given, the largest loop is the outer only if there are **at least two loops** and it contains every other loop, else `outer: null` (a lone loop is a pocket); (3) loops not inside the outer → `ignored` (`'outside-outer'`; a loop is inside when every vertex is inside the outer polygon or within 0.5 mm of its boundary, so flattening error on the rim never pushes a keyway outside); (4) circle-like loops with diameter ≤ 30 mm → `'fastener-hole'`; (5) loops with any vertex farther than `0.9 × outerRadius` from the outer centre → `'rim-notch'`; (6) loops contained by another remaining loop → `'nested'`; (7) loops with area < 50 mm² → `'tiny'`; the rest are pockets, sorted by area descending.
  - `pocketGapMm(pockets) → number|null` — `null` for fewer than two pockets, else the smallest centroid-to-centroid distance.
  - `normaliseFrame({ outer, pockets }) → { outer, pockets }` — translates all points so the outer bbox centre is (0, 0) (pockets' joint bbox centre when `outer` is null).
  - `gradeConfidence({ outer, outerSynthesised, pockets, bridged, source, statedDiameter, knownCavities, scaleBasis }) → { confidence, notes: string[] }` with the rules in Step 3.

- [ ] **Step 1: Write the failing tests**

```js
test('joins segments whose ends are within 0.5 mm into one closed loop', () => {
  const sq = [seg(0, 0, 10, 0), seg(10.3, 0, 10, 10), seg(10, 10.2, 0, 10), seg(0, 10, 0, 0.4)];
  const { loops, open, bridged } = chainLoops(sq);
  assert.equal(loops.length, 1); assert.equal(open.length, 0); assert.equal(bridged, 0);
  assert.ok(Math.abs(polygonArea(loops[0].points) - 100) < 5);
});
test('bridges a 1.5 mm gap and counts it', () => {
  const { loops, bridged } = chainLoops([seg(0, 0, 10, 0), seg(10, 0, 10, 10), seg(10, 10, 0, 10), seg(0, 10, 0, 1.5)]);
  assert.equal(loops.length, 1); assert.equal(bridged, 1); assert.equal(loops[0].bridgedGaps, 1);
});
test('does not bridge a 15 mm gap', () => {
  const { loops, open } = chainLoops([seg(0, 0, 100, 0), seg(100, 0, 100, 100), seg(100, 100, 0, 100), seg(0, 100, 0, 15)]);
  assert.equal(loops.length, 0); assert.equal(open.length, 1);
});
test('a circle is circle-like, a rounded rectangle is not', () => {
  assert.equal(isCircleLike(circle(0, 0, 87.5, 64)), true);
  assert.equal(isCircleLike(roundedRect(250, 150, 15)), false);
});
test('classifies outer, pocket, fastener hole and rim notch; the larger drawing frame is not the outer', () => {
  const loops = [loop(circle(0, 0, 110)), loop(circle(0, 75, 5)), loop(roundedRect(60, 100, 5)), loop(translate(rect(24, 14), 98, 0)), loop(translate(rect(390, 280), 40, 30))];
  const r = classifyLoops(loops, { expectedOuterDiameter: 220 });
  assert.equal(r.outer, loops[0]); assert.equal(r.outerSynthesised, false);
  assert.deepEqual(r.pockets, [loops[2]]);
  assert.deepEqual(r.ignored.map((i) => i.reason).sort(), ['fastener-hole', 'outside-outer', 'rim-notch']);
  assert.equal(classifyLoops(loops).outer, loops[0], 'without an expected diameter the circle still wins over the frame');
});
test('a single open chain whose own ends meet closes on itself (the Dieshop pocket polyline)', () => {
  const pts = circle(0, 0, 25, 40); // open chain, first and last points 0.0 apart once repeated
  const { loops } = chainLoops([{ layer: 'Layer3', points: [...pts, pts[0]], closed: false, source: 'LWPOLYLINE' }]);
  assert.equal(loops.length, 1); assert.equal(loops[0].points.length, 40);
});
test('synthesises the outer from the expected diameter when none is drawn', () => {
  const r = classifyLoops([loop(roundedRect(250, 150, 15))], { expectedOuterDiameter: 475 });
  assert.equal(r.outerSynthesised, true);
  assert.ok(Math.abs(circleFit(r.outer.points).r - 237.5) < 0.01);
  assert.equal(r.pockets.length, 1);
});
test('a loop inside a pocket is nested, not a second pocket', () => {
  const r = classifyLoops([loop(circle(0, 0, 110)), loop(rect(80, 80)), loop(rect(20, 20))]);
  assert.equal(r.pockets.length, 1); assert.equal(r.ignored[0].reason, 'nested');
});
test('pocket gap is the nearest centroid distance; null for one pocket', () => {
  assert.equal(pocketGapMm([loop(rect(10, 10))]), null);
  assert.ok(Math.abs(pocketGapMm([loop(translate(rect(10, 10), -28, 0)), loop(translate(rect(10, 10), 28, 0))]) - 56) < 1e-9);
});
test('normaliseFrame centres the outer bbox at the origin', () => {
  const { outer } = normaliseFrame({ outer: loop(circle(1140.9, 8380.4, 87.5)), pockets: [] });
  const b = bbox(outer.points); assert.ok(Math.abs(b.cx) < 1e-6 && Math.abs(b.cy) < 1e-6);
});
test('grades confidence', () => {
  const base = { outer: loop(circle(0, 0, 87.5)), outerSynthesised: false, pockets: [loop(rect(50, 50))], bridged: 0, source: 'dxf', statedDiameter: 175, knownCavities: 1, scaleBasis: 'native-mm' };
  assert.equal(gradeConfidence(base).confidence, 'confirmed');
  assert.equal(gradeConfidence({ ...base, statedDiameter: null }).confidence, 'likely');
  assert.equal(gradeConfidence({ ...base, bridged: 1 }).confidence, 'likely');
  assert.equal(gradeConfidence({ ...base, outerSynthesised: true }).confidence, 'likely');
  assert.equal(gradeConfidence({ ...base, knownCavities: 2 }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, statedDiameter: 190 }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, outer: null, outerSynthesised: false }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, source: 'pdf-raster', scaleBasis: 'inventory-dims' }).confidence, 'uncertain');
  assert.equal(gradeConfidence({ ...base, source: 'pdf-vector', scaleBasis: 'text-diameter' }).confidence, 'likely', 'a drawing scaled from its own size text cannot confirm that size');
  assert.equal(gradeConfidence({ ...base, pockets: [] }).confidence, 'none');
  assert.equal(gradeConfidence({ ...base, scaleBasis: null }).confidence, 'none');
});
```

Test helpers (`seg`, `circle(cx, cy, r, n = 64)`, `rect(w, h)`, `roundedRect(w, h, r)`, `translate`, `loop(points)`) live in the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/openingGeometry.test.cjs` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `server/services/openingGeometry.cjs`**

`gradeConfidence` rules, evaluated in this order: no `scaleBasis` or no pockets → `none`; `source === 'pdf-raster'` → `uncertain`; `outer` null and not synthesised → `uncertain` (`'no outer outline'`); `knownCavities` set and ≠ `pockets.length` → `uncertain`; `statedDiameter` set, outer drawn, scale native, and |fitted diameter − stated| > 2 → `uncertain` (`'outer disagrees with stated size'`); `bridged > 0`, or `outerSynthesised`, or `statedDiameter == null`, or `scaleBasis` not native (`text-diameter`, `hint-diameter`, `inventory-dims` — the scale was derived from the very size it would confirm) → `likely`; otherwise `confirmed`. Every downgrade pushes a human-readable note. `chainLoops`: a single open chain whose two ends lie within `joinTol` of each other closes on itself (the repeated end point is dropped).

- [ ] **Step 4: Run the tests to verify they pass** — Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/openingGeometry.cjs server/services/openingGeometry.test.cjs
git commit -m "feat(tooling): opening geometry — loop chaining, outer/pocket classification, confidence grading"
```

---

### Task 3: DXF extractor and size class from the drawing

**Files:**
- Create: `server/services/dxfOpenings.cjs`
- Test: `server/services/dxfOpenings.test.cjs`

**Interfaces:**
- Consumes: Task 1 `parseDxf`/`flattenDxf`/`plainText`; Task 2 everything; Plan 1 `parseToolingNumber`, `normalizeSizeClass`.
- Produces:
  - `ExtractionResult = { source: 'dxf'|'pdf-vector'|'pdf-raster', outer: Array<[x,y]>|null, outerSynthesised: boolean, pockets: Array<Array<[x,y]>>, pocketGapMm: number|null, cavities: number|null, sizeClass: string|null, sizeClassSource: 'drawing-text'|'drawing-outline'|'hint'|null, sizeClassConfidence: 'confirmed'|'likely'|'uncertain'|null, scaleBasis: 'native-mm'|'native-inch'|'text-diameter'|'hint-diameter'|'inventory-dims'|null, confidence, numbersInDrawing: string[], texts: string[], notes: string[] }` — the contract all three extractors and the bundle share.
  - `sizeFromTexts(texts: string[]) → { sizeClass: string, diameter: number, thickness: number, raw: string } | null` — first text matching `/(?:Ø|DIA\.?|DIAMETER)?\s*(\d{2,4}(?:\.\d+)?)\s*[xX×]\s*(?:H\.?\s*)?(\d{2,4}(?:\.\d+)?)/` where the first number is ≥ 100 and > the second; `sizeClass` is `normalizeSizeClass(\`${d}X${t}\`)`.
  - `numbersFromTexts(texts) → string[]` — canonical numbers from `parseToolingNumber` on each text and on bare 5-digit tokens (`21599` → `I-21599`), de-duplicated.
  - `extractFromDxf(text: string, hints = { sizeClass: null, cavities: null, inventoryDims: null }) → ExtractionResult`.

- [ ] **Step 1: Write the failing tests**

```js
test('Dieshop 21599: Ø175 outer, one pocket, bolt hole ignored, size 175X80 confirmed', () => {
  const r = extractFromDxf(fixture('dieshop-21599.dxf'));
  assert.equal(r.source, 'dxf'); assert.equal(r.scaleBasis, 'native-mm');
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 175) < 0.1);
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 51.5) < 0.5 && Math.abs(b.height - 52.0) < 0.5);
  assert.equal(r.cavities, 1); assert.equal(r.pocketGapMm, null);
  assert.equal(r.sizeClass, '175X80'); assert.equal(r.sizeClassSource, 'drawing-text'); assert.equal(r.sizeClassConfidence, 'confirmed');
  assert.equal(r.confidence, 'confirmed');
  assert.ok(r.numbersInDrawing.includes('I-21599'));
  const ob = bbox(r.outer); assert.ok(Math.abs(ob.cx) < 1e-6 && Math.abs(ob.cy) < 1e-6);
});
test('Dieshop 09658: Ø220, the rim keyway is not a pocket', () => {
  const r = extractFromDxf(fixture('dieshop-09658.dxf'));
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 62.5) < 0.5 && Math.abs(b.height - 105.9) < 0.5);
  assert.equal(r.sizeClass, '220X80'); assert.equal(r.confidence, 'confirmed');
});
test('bolster 14017: no outer drawn, size from MTEXT, outer synthesised, pocket 250x150', () => {
  const r = extractFromDxf(fixture('bolster-14017.dxf'), { inventoryDims: { a_len: 250, b_wid: 150 } });
  assert.equal(r.outerSynthesised, true);
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 475) < 0.01);
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); assert.ok(Math.abs(b.width - 250) < 0.1 && Math.abs(b.height - 150) < 0.1);
  assert.equal(r.sizeClass, '475X220'); assert.equal(r.sizeClassSource, 'drawing-text');
  assert.equal(r.confidence, 'likely');
  assert.ok(r.numbersInDrawing.includes('BOL-14017'));
  assert.ok(r.notes.some((n) => /inventory dims agree/.test(n)));
});
test('a size hint is used when the drawing has no size text, and reported as hint', () => {
  const r = extractFromDxf(dxfOf({ entities: [...rectLines(250, 150), ...rectLines(2000, 1500)] }), { sizeClass: '475X220' });
  // no circle-like loop → the 475 circle is synthesised at the loops' joint centre; the 2000x1500 frame is 'outside-outer'
  assert.equal(r.sizeClass, '475X220'); assert.equal(r.sizeClassSource, 'hint'); assert.equal(r.outerSynthesised, true);
  assert.equal(r.pockets.length, 1); assert.equal(r.confidence, 'likely');
});
test('an inch drawing is scaled to millimetres', () => {
  const r = extractFromDxf(dxfOf({ insunits: 1, entities: [circleEntity(0, 0, 3.4449), ...rectLines(1, 1)] })); // Ø6.89" = 175 mm
  assert.equal(r.scaleBasis, 'native-inch');
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 175) < 0.1);
  assert.ok(Math.abs(bbox(r.pockets[0]).width - 25.4) < 0.01);
});
test('outline-only size class: outer diameter known, thickness unknown → no size class, note', () => {
  const r = extractFromDxf(dxfOf({ entities: [circleEntity(0, 0, 87.5), ...rectLines(50, 50)] }));
  assert.equal(r.sizeClass, null); assert.equal(r.sizeClassSource, null);
  assert.equal(r.confidence, 'likely');
  assert.ok(r.notes.some((n) => /thickness/.test(n)));
});
test('pocket count disagreeing with the known cavities is uncertain', () => {
  const r = extractFromDxf(fixture('dieshop-21599.dxf'), { cavities: 2 });
  assert.equal(r.confidence, 'uncertain');
});
test('no closed pocket → none', () => {
  const r = extractFromDxf(dxfOf({ entities: [circleEntity(0, 0, 87.5), line(0, 0, 10, 10)] }));
  assert.equal(r.confidence, 'none'); assert.deepEqual(r.pockets, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `server/services/dxfOpenings.cjs`**

Pipeline: `flattenDxf` → multiply all points by `unitScale` (`scaleBasis` `native-inch` when 25.4) → `chainLoops` → stated size: `sizeFromTexts(texts.map(plainText))`, else a size from `hints.sizeClass` (`'hint'`); `expectedOuterDiameter` = stated diameter → `classifyLoops` → `pocketGapMm` → `normaliseFrame` → `gradeConfidence` with `knownCavities = hints.cavities`. Size class decisions: text present and outer drawn and agree within 2 mm → `confirmed`; text present, outer synthesised or absent → `likely`; text present but disagree → `uncertain` (keep the text's value, note it); no text but hint → source `hint`, confidence `likely`, and the hint diameter is still checked against a drawn outer (disagreement → `uncertain`); outline only (no text, no hint) → `sizeClass null` with note `'outer diameter <d> mm found; thickness unknown — size class needs the die shop'`. Inventory dims hint: when `hints.inventoryDims` is given and the largest pocket's bbox long/short sides are within 2 mm of `a_len`/`b_wid`, note `'inventory dims agree'`; when they disagree by more than 2 mm, downgrade to `uncertain` with a note. `cavities` = pocket count (null when none).

- [ ] **Step 4: Run the tests to verify they pass** — Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/dxfOpenings.cjs server/services/dxfOpenings.test.cjs
git commit -m "feat(tooling): DXF opening extractor with size class from title-block text"
```

---

### Task 4: Schema — `tooling_drawings`, opening columns, storage helpers, Docker volume

**Files:**
- Modify: `init.sql` (after `toolings`, before `tooling_openings`), `server/db.cjs` (same spot in the migration, plus two `ALTER TABLE`s)
- Modify: `server/services/toolingSchema.test.cjs`
- Create: `server/services/toolingDrawings.cjs`
- Test: `server/services/toolingDrawings.test.cjs`
- Modify: `Dockerfile.backend` (mkdir), `docker-compose.yml` (env + volume)

**Interfaces:**
- Produces:
  - Table `tooling_drawings`: `id SERIAL PRIMARY KEY`, `tooling_id INTEGER NOT NULL REFERENCES toolings(id) ON DELETE CASCADE`, `file_path TEXT NOT NULL` (relative to the root), `original_name TEXT NOT NULL`, `archive_path TEXT` (where it came from, informational), `format TEXT NOT NULL CHECK (format IN ('dxf', 'dwg', 'pdf', 'tif'))`, `match_basis TEXT NOT NULL` (`'filename-die' | 'filename-code' | 'title-block' | 'manual'`), `sha256 TEXT NOT NULL`, `byte_size INTEGER NOT NULL`, `is_primary BOOLEAN NOT NULL DEFAULT FALSE`, `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `UNIQUE (tooling_id, sha256)`.
  - `tooling_openings` gains `drawing_id INTEGER REFERENCES tooling_drawings(id) ON DELETE SET NULL` and `extraction_note TEXT` (the extractor's notes joined with `; `).
  - `server/services/toolingDrawings.cjs`: `getRoot()` (`TOOLING_FILES_ROOT || '/app/storage/tooling-files'`), `storedRelativePath({ number, sha256, originalName }) → string` (`<sanitizeSegment(number)>/<sha256.slice(0,8)>_<sanitizeFilename(originalName)>`), `absolutePath(root, relative) → string` (throws when outside the root), `formatOf(fileName) → 'dxf'|'dwg'|'pdf'|'tif'|null`, `sha256Of(buffer) → string`. Reuse `sanitizeFilename`, `sanitizeSegment`, `isInsideRoot` exported by `orderFiles.cjs`.

- [ ] **Step 1: Write the failing tests**

Extend `toolingSchema.test.cjs`: add `'tooling_drawings'` to the table loop; add `test('tooling_openings carries drawing_id and extraction_note in both files and as ALTERs')` asserting both `columnsOf(initSql, 'tooling_openings')` and `columnsOf(dbCjs, 'tooling_openings')` include a column starting `drawing_id INTEGER REFERENCES tooling_drawings(id)` and one equal to `extraction_note TEXT`, and that `dbCjs` contains `ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS drawing_id` and `… extraction_note`; add `test('tooling_drawings is created before tooling_openings in both files')` comparing `indexOf`.

```js
// toolingDrawings.test.cjs
test('stored path is number/sha8_name with unsafe characters replaced', () => {
  assert.equal(storedRelativePath({ number: 'BOL-4-6-A', sha256: 'abcdef0123456789', originalName: '14017 Bol(475x220).dxf' }), 'BOL-4-6-A/abcdef01_14017_Bol_475x220_.dxf');
});
test('absolutePath refuses to leave the root', () => {
  assert.throws(() => absolutePath('/root/tooling-files', '../etc/passwd'), /outside/);
  assert.equal(path.basename(absolutePath('/root/tooling-files', 'I-21599/abc_x.dxf')), 'abc_x.dxf');
});
test('formatOf is case-insensitive and null for unknown types', () => {
  assert.equal(formatOf('A.DXF'), 'dxf'); assert.equal(formatOf('a.tif'), 'tif'); assert.equal(formatOf('a.bak'), null);
});
test('getRoot honours TOOLING_FILES_ROOT', () => { process.env.TOOLING_FILES_ROOT = '/x'; assert.equal(getRoot(), '/x'); delete process.env.TOOLING_FILES_ROOT; assert.equal(getRoot(), '/app/storage/tooling-files'); });
```

- [ ] **Step 2: Run to verify failure** — `node --test server/services/toolingSchema.test.cjs server/services/toolingDrawings.test.cjs` — Expected: FAIL.

- [ ] **Step 3: Write the SQL in both files, the ALTERs in `db.cjs`, and the helper module**

In `init.sql` insert the `CREATE TABLE IF NOT EXISTS tooling_drawings (…)` block (with `CREATE INDEX IF NOT EXISTS idx_tooling_drawings_tooling ON tooling_drawings (tooling_id);`) between `toolings` and `tooling_openings`, and add the two columns to `tooling_openings` after `drawing_file`. Mirror exactly in `db.cjs`, then add after the `tooling_openings` block:

```sql
ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS drawing_id INTEGER REFERENCES tooling_drawings(id) ON DELETE SET NULL;
ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS extraction_note TEXT;
```

`Dockerfile.backend`: add `/app/storage/tooling-files` to the `mkdir -p` line. `docker-compose.yml`: `TOOLING_FILES_ROOT: /app/storage/tooling-files` in the backend environment, `- tooling_files_data:/app/storage/tooling-files` in its volumes, `tooling_files_data:` in the top-level `volumes:`.

- [ ] **Step 4: Run the tests** — Expected: PASS. Then rebuild the test server backend from the worktree and confirm the migration applied:

```bash
docker compose -p die-tracker --env-file ../../../.env build backend
docker compose --project-directory ../../.. up -d --wait backend
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "\d tooling_drawings" -c "\d tooling_openings"
```

Expected: both tables shown, `tooling_openings` lists `drawing_id` and `extraction_note`. (The compose change adds a volume; `up -d` recreates the backend container with it mounted. If the implementer has no `.env` access, hand this step to the controller as in Plan 1.)

- [ ] **Step 5: Commit**

```bash
git add init.sql server/db.cjs server/services/toolingSchema.test.cjs server/services/toolingDrawings.cjs server/services/toolingDrawings.test.cjs Dockerfile.backend docker-compose.yml
git commit -m "feat(tooling): tooling_drawings table, opening drawing link and note, tooling-files storage root"
```

---

### Task 5: Archive matcher — scoped folders and file-name rules

**Files:**
- Create: `server/services/archiveMatcher.cjs`
- Test: `server/services/archiveMatcher.test.cjs`

**Interfaces:**
- Consumes: Plan 1 `parseToolingNumber`, `normalizeSizeClass`, `pressFromGex2Location`.
- Produces:
  - `SCOPED_FOLDERS: Array<{ prefix: string, plant: 'GEX 1'|'GEX 2', kindHint: 'insert'|'bolster'|null }>` — relative, forward-slash, case-insensitive prefix match: `Toolings/Dieshop - Insert Drawings/AutoCad` (GEX 1, insert), `Toolings/Dieshop - Insert Drawings/PDF & Tiff` (GEX 1, insert), `Toolings/Toolings/BOLSTER` (GEX 1, bolster), `Toolings/Bolsters` (GEX 1, bolster), `Toolings/Press-6` (GEX 1, insert), `Toolings/INS- copies` (GEX 1, null), `14.Insert Details` (GEX 1, insert), `1.Press 1/Insert`, `1.Press 1/Bolsters`, `2.Press 2/Insert`, `2.Press 2/Bloster`, `3.Press 3/Inserts`, `3.Press 3/Bolsters`, `4.Press 4/Insert`, `4.Press 4/Bolsters`, `5.Press 5/Insert`, `5.Press 5/Bolsters`, `6.Press 6/Insert`, `6.Press 6/Bolster` (GEX 1, kind by folder), `10.TALEX tooling/25 MN/Inserts 25MN`, `10.TALEX tooling/25 MN/Bolsters 25MN`, `10.TALEX tooling/35 MN/Inserts`, `10.TALEX tooling/35 MN/Bolsters  35MN` (GEX 2, kind by folder; note the double space), `7.Press-7-ND`, `8.Press-8-ND` (GEX 2, null), and `''` (root-level files only, depth 0; GEX 1 unless the code says GEX 2, kind null).
  - `listArchiveDrawings(root, fsLike = fs) → ArchiveFile[]` — walks only the scoped folders (root files at depth 0 only); `ArchiveFile = { absPath, relPath, stem, ext: 'dxf'|'dwg'|'pdf', plant, kindHint }`; skips `.bak`, `.dwl*`, `.tif`, `Thumbs.db`, names starting `~$`.
  - `interpretStem(stem: string, { plant, kindHint }) → Match | { skip: string }` — `Match = { toolingNumber: string, kind: 'insert'|'bolster', plant, basis: 'filename-die'|'filename-code', sizeClass: string|null, press: string|null, variant: string|null }`. Rules in Step 3.
  - `groupByTooling(files: Array<ArchiveFile & Match>) → Map<number, { match, files: ArchiveFile[], primary: ArchiveFile }>` — primary preference: `dxf` over `dwg` over `pdf`; among DXFs prefer a stem without `_FIN`/`FIN_`; among equals the shortest stem.

- [ ] **Step 1: Write the failing tests** (a table test over real stems from the survey)

```js
const G1I = { plant: 'GEX 1', kindHint: 'insert' }, G1B = { plant: 'GEX 1', kindHint: 'bolster' }, G2 = { plant: 'GEX 2', kindHint: null }, ROOT = { plant: 'GEX 1', kindHint: null };
const CASES = [
  ['21599', G1I, { toolingNumber: 'I-21599', kind: 'insert', basis: 'filename-die' }],
  ['13126(OK)', G1I, { toolingNumber: 'I-13126' }], ['13137-OK', G1I, { toolingNumber: 'I-13137' }],
  ['13126A(SCRAP)', G1I, { skip: 'scrap' }], ['13477-SCRAP', G1I, { skip: 'scrap' }], ['15027(SCRAP)', G1I, { skip: 'scrap' }],
  ['01049B', G1I, { skip: 'unrecognised' }], ['2C', G1I, { skip: 'unrecognised' }],
  ['05043-INS', G1I, { toolingNumber: 'I-05043' }], ['Ins-12495', G1I, { toolingNumber: 'I-12495' }], ['INS-14172', G1I, { toolingNumber: 'I-14172' }],
  ['11377-8-Ins', G1I, { toolingNumber: 'I-11377' }], ['13126_4-Ins', G1I, { toolingNumber: 'I-13126' }], ['P4 (INS-05006)', G1I, { toolingNumber: 'I-05006', press: 'PRESS 4' }],
  ['13072-Bol', G1I, { toolingNumber: 'BOL-13072', kind: 'bolster', basis: 'filename-code' }],
  ['14017 Bol(475x220)', G1B, { toolingNumber: 'BOL-14017', sizeClass: '475X220' }], ['16021-Bol', G1B, { toolingNumber: 'BOL-16021' }],
  ['6-1-C Bol(700x196)', G1B, { toolingNumber: 'BOL-6-1-C', sizeClass: '700X196' }], ['Bol.7-2-B', G1B, { toolingNumber: 'BOL-7-2-B' }],
  ['OP-PR4 (4-6-B)', G1B, { toolingNumber: 'BOL-4-6-B', press: 'PRESS 4' }], ['pr-5-005 (5-1-b) rev01', G1B, { toolingNumber: 'BOL-5-1-B', press: 'PRESS 5' }],
  ['(2-1-H) Bol(475x220)', G1B, { toolingNumber: 'BOL-2-1-H' }], ['12047-220 -Ins Bol', G1B, { toolingNumber: 'BOL-12047' }],
  ['bol101', G1B, { toolingNumber: 'BOL-101' }], ['301-A- Bol', G1B, { toolingNumber: 'BOL-301-A' }],
  ['i-15160', G1B, { toolingNumber: 'I-15160', kind: 'insert' }],
  ['BO_17928', G1B, { toolingNumber: 'BOL-17928' }], ['BOLS_27363_FIN', ROOT, { toolingNumber: 'BOL-27363', variant: 'FIN' }],
  ['BO-700x196_PR-6-006', G1B, { skip: 'press-part' }], ['700x200- Sub- Bol for P-2 dies (PR-6-013).', G1B, { skip: 'press-part' }],
  ['15109-Bol1', G1B, { toolingNumber: 'BOL-15109' }], ['21471-1', G1B, { toolingNumber: 'BOL-21471' }],
  ['I-05038', ROOT, { toolingNumber: 'I-05038' }], ['INS_26882', ROOT, { toolingNumber: 'I-26882' }], ['B_27297', ROOT, { toolingNumber: 'BOL-27297' }],
  ['GEX-INS-32117.1.460x150', ROOT, { toolingNumber: 'I-32117', sizeClass: '460X150' }], ['INS-30610.1.460x150.P6', ROOT, { toolingNumber: 'I-30610', sizeClass: '460X150', press: 'PRESS 6' }],
  ['35IC1-120021', G2, { toolingNumber: '35IC1-120021', kind: 'insert', plant: 'GEX 2' }], ['35IC1_026904 (1)', G2, { toolingNumber: '35IC1-026904' }],
  ['INS-35IC1-013010', G2, { toolingNumber: '35IC1-013010' }], ['35IC1A', G2, { toolingNumber: '35IC1A' }],
  ['25B2C1A', G2, { toolingNumber: 'BOL-25B2C1A', kind: 'bolster' }], ['TLX-35B2C1A-051033.1.600x370.P2', G2, { toolingNumber: 'BOL-35B2C1A', sizeClass: '600X370' }],
  ['25IC1-027847', ROOT, { toolingNumber: '25IC1-027847', plant: 'GEX 2' }],
  ['Die Rings Inventory-P4', ROOT, { skip: 'press-part' }], ['EYEBOLTM16.', ROOT, { skip: 'press-part' }], ['Nitrex Testing Coins', ROOT, { skip: 'unrecognised' }],
];
for (const [stem, ctx, expected] of CASES) test(`interprets "${stem}"`, () => {
  const got = interpretStem(stem, ctx);
  for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, k);
});
test('walks only the scoped folders and skips backups, tiffs and lock files', () => { /* fake fsLike tree with one file in each of: AutoCad/PRESS 3/21599.dwg, AutoCad/x.bak, PDF & Tiff/21599.tif, 9. Press-9/x.dwg, root/I-05038.dxf, root/~$x.xlsx, 0.Gulfex/x.dwg → expect 2 files */ });
test('groups files per tooling and picks the DXF without FIN as primary', () => { /* BOLS_27363.dxf, BOLS_27363_FIN.dxf, BOLS_27712.pdf for the same number → primary BOLS_27363.dxf */ });
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement `server/services/archiveMatcher.cjs`**

`interpretStem` pipeline: (a) uppercase, replace `_` with `-`, strip `[n]`, `(n)`, `(OK)`, `-OK`, `%20`, trailing dots, `REV\d*`, `MODEL`, `ABSOLUTE`, `(A)`, `-A` *only when it follows a size*; (b) `SCRAP` anywhere → `{ skip: 'scrap' }`; (c) stems whose code is a press part (`PR-\d-\d{3}`, `PA-\d-\d{3}`, `BO-\d{3}X\d{2,3}`, `SUB-?BOL`, `HOLDER`, `BOLT`, `EYEBOLT`, `RING`, `PLATEN`, `FIXTURE`, `KEY`, `PIN`) **and no bolster code in parentheses** → `{ skip: 'press-part' }`; (d) size `(\d{3,4})\s*X\s*(\d{2,3})` → `sizeClass`; press `\bP-?(\d)\b` or `PR-?(\d)\b` or `PRESS\s*(\d)` → `PRESS n`; variant `FIN`/`FINITURA` → `variant`; (e) tooling code, first match wins: TALEX `\b(25|35)(IC\d{1,2}[A-Z]?|B\d+C\d+[A-Z]?)(?:-?(\d{5,6}))?\b` → `parseToolingNumber` of `${p}${code}${n ? '-' + n : ''}` for `IC` codes; `B…C…` codes → `BOL-${p}${code}` kind bolster; bolster code in parentheses or after `BOL`/`B`: `\b(\d-\d-[A-Z])\b` → `BOL-<code>`; `BOL\w*[-. ]*(\d{3,5})` or `(\d{3,5})[-\s]*(?:INS\s+)?BOL` → `BOL-<n>`; `(?:^|\b)(?:INS|I)[-\s]*(\d{5})\b` → `I-<5>`; `\bI-(\d{5})\b`; bare `^\d{5}` at the start, not directly followed by a letter (`01049B` is a variant nobody can resolve), with `kindHint === 'insert'` → `I-<5>`; bare `^\d{3,5}` (same letter rule) with `kindHint === 'bolster'` → `BOL-<n>`; `(\d{3})-([A-Z])` with bolster hint → `BOL-<n>-<L>`; anything else → `{ skip: 'unrecognised' }`. The code decides `kind`; `kindHint` only disambiguates bare numbers. `plant` is `GEX 2` for TALEX codes, else the folder's. `basis` is `filename-die` for `I-<die>` and `<press>IC<cav>-<die>` numbers, `filename-code` otherwise.

- [ ] **Step 4: Run the tests** — Expected: PASS (all table cases + 2).

- [ ] **Step 5: Commit**

```bash
git add server/services/archiveMatcher.cjs server/services/archiveMatcher.test.cjs
git commit -m "feat(tooling): archive matcher — scoped folders and drawing file-name rules"
```

---

### Task 6: Vector-PDF and scanned-PDF extractors with a raster tracer

**Files:**
- Create: `server/services/rasterTrace.cjs`, `server/services/pdfOpenings.cjs`
- Test: `server/services/rasterTrace.test.cjs`, `server/services/pdfOpenings.test.cjs`

**Interfaces:**
- Consumes: Task 2 geometry, Task 3 `sizeFromTexts`, `numbersFromTexts`, `ExtractionResult`.
- Produces:
  - `rasterTrace.cjs`: `toGray({ data, width, height, kind }) → Uint8Array` (pdfjs `ImageKind` 1 = 1-bpp grey, 2 = RGB, 3 = RGBA); `otsuThreshold(gray) → number`; `inkMask(gray, threshold) → Uint8Array` (1 = darker than threshold); `closeMask(mask, w, h, size = 3)`; `enclosedRegions(mask, w, h) → Array<{ area, bbox, labels }>` (flood-fill white from the border; every white region not reached is enclosed; 4-connected); `traceBoundary(regionMask, w, h) → Array<[x, y]>` (Moore-neighbour tracing, clockwise); `simplify(points, epsilon = 1) → Array<[x, y]>` (Douglas–Peucker); `traceLoops(image, { minAreaFraction = 0.002 } = {}) → { loops: Array<Array<[x, y]>> (px), width, height }` — one loop per enclosed region with area ≥ `minAreaFraction × width × height`, largest first.
  - `pdfOpenings.cjs`: `classifyPdf(buffer) → Promise<{ kind: 'vector'|'scan'|'empty', pageSize: [w, h], strokedPaths: number, imageCount: number }>` (`scan` when the page has ≤ 5 stroked paths and ≥ 1 image XObject); `extractFromVectorPdf(buffer, hints) → Promise<ExtractionResult>` (`source 'pdf-vector'`); `extractFromScannedPdf(buffer, hints) → Promise<ExtractionResult>` (`source 'pdf-raster'`); `extractFromPdf(buffer, hints) → Promise<ExtractionResult>` dispatching on `classifyPdf`. `hints` as in Task 3 plus `inventoryDims`.

- [ ] **Step 1: Write the failing tests**

```js
// rasterTrace.test.cjs — synthetic RGB images drawn in the test (helper paints lines/circles into a Uint8ClampedArray)
test('traces a drawn rounded rectangle as one enclosed loop with the right size', () => {
  const img = canvasRgb(400, 300); strokeRect(img, 100, 75, 200, 150, 2); // 2 px pen
  const { loops } = traceLoops(img);
  assert.equal(loops.length, 1);
  const b = bbox(loops[0]); assert.ok(Math.abs(b.width - 198) <= 3 && Math.abs(b.height - 148) <= 3);
});
test('a 1 px pen gap is sealed by closing; a 10 px gap is not an enclosed region', () => { /* two images, expect 1 and 0 loops */ });
test('nested loops come back largest first', () => { /* circle Ø200 containing a 60x40 rect → 2 loops, loops[0] is the circle */ });
test('otsu separates blue ink from paper', () => { /* grey 250 paper with blue (60,60,200) strokes → threshold between the two grey levels */ });

// pdfOpenings.test.cjs
test('classifies the vector bolster drawing and the scan', async () => {
  assert.equal((await classifyPdf(fixture('bolster-BOL-27080.pdf'))).kind, 'vector');
  assert.equal((await classifyPdf(fixture('bolster-15109-scan.pdf'))).kind, 'scan');
});
test('BOL-27080: scale from the Ø475x220 text, outer Ø475 ± 2, two pockets, coloured overlay and key slot ignored', async () => {
  const r = await extractFromVectorPdf(fixture('bolster-BOL-27080.pdf'), { cavities: 2 });
  assert.equal(r.source, 'pdf-vector'); assert.equal(r.scaleBasis, 'text-diameter');
  assert.equal(r.sizeClass, '475X220'); assert.equal(r.sizeClassSource, 'drawing-text');
  assert.ok(Math.abs(circleFit(r.outer).r * 2 - 475) < 2);
  assert.equal(r.pockets.length, 2);
  const joint = bbox(r.pockets.flat()); assert.ok(Math.abs(joint.width - 282.4) < 4, `joint width ${joint.width}`);
  assert.ok(r.pocketGapMm > 100 && r.pocketGapMm < 200);
  assert.ok(r.numbersInDrawing.includes('BOL-27080'));
  assert.equal(r.confidence, 'likely'); // scaled from its own size text, so never 'confirmed'; the side section's loops are outside the outer and ignored
});
test('coloured strokes are not geometry', async () => {
  // a vector PDF built with pdf-lib in the test: black circle Ø300 + black rect pocket 100x50 + orange rect 80x30 inside it → 1 pocket
  const r = await extractFromVectorPdf(await syntheticVectorPdf(), { sizeClass: '300X100' });
  assert.equal(r.pockets.length, 1);
});
test('a vector PDF without size text or hint has no scale → none', async () => {
  const r = await extractFromVectorPdf(await syntheticVectorPdf({ withText: false }), {});
  assert.equal(r.confidence, 'none'); assert.equal(r.scaleBasis, null); assert.ok(r.notes.some((n) => /scale/.test(n)));
});
test('15109 scan: pocket traced, scaled from inventory dims, uncertain', async () => {
  const r = await extractFromScannedPdf(fixture('bolster-15109-scan.pdf'), { sizeClass: '475X220', inventoryDims: { a_len: 350, b_wid: 110 } });
  assert.equal(r.source, 'pdf-raster'); assert.equal(r.scaleBasis, 'inventory-dims');
  assert.equal(r.pockets.length, 1);
  const b = bbox(r.pockets[0]); const long = Math.max(b.width, b.height), short = Math.min(b.width, b.height);
  assert.ok(Math.abs(long - 350) < 1); assert.ok(short > 100 && short < 125);
  assert.equal(r.outerSynthesised, true); assert.equal(r.confidence, 'uncertain');
});
test('a scan with no size hint and no drawn outer is none', async () => {
  const r = await extractFromScannedPdf(fixture('bolster-15109-scan.pdf'), {});
  assert.equal(r.confidence, 'none');
});
```

`syntheticVectorPdf` uses `pdf-lib` (already a dependency) to draw the shapes with `drawCircle`/`drawRectangle` (`borderColor` black vs `rgb(1, 0.5, 0)`), and `drawText('Ø300x100 INSERT')` when `withText`.

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement**

`extractFromVectorPdf`: `getDocument({ data, isEvalSupported: false, useSystemFonts: false })`, page 1, `getOperatorList()`; walk ops with a graphics-state stack (`save`/`restore`), `transform` (post-multiply), `setStrokeRGBColor`/`setStrokeGray`/`setStrokeCMYKColor` → current stroke colour; `constructPath` args `[paintOp, [data], minMax]`: decode `data` (ops 0/1/2/3 as in the survey), transform points by the CTM, flatten curves with 16 segments, and keep a chain only when `paintOp` strokes (`stroke`, `closeStroke`, `fillStroke`, `closeFillStroke`, `eoFillStroke`, `closeEOFillStroke`) **and** the stroke colour is dark and unsaturated (max channel < 0.63 and max − min < 0.25, the `inkMask` rule); also drop sub-paths of fewer than 2 points. Text via `getTextContent()` → `sizeFromTexts`/`numbersFromTexts`. Scale: `sizeFromTexts` diameter (`text-diameter`) else `hints.sizeClass` diameter (`hint-diameter`): first pass — `chainLoops` in PDF units with `joinTol 0.5, bridgeTol 2` (points, roughly 0.35–0.7 mm at the usual plot scales), pick the largest circle-like loop, `mmPerUnit = diameter / (2·r)`; then scale the **raw chains** and run `chainLoops` again in mm with the standard tolerances, so the 0.5 mm / 2 mm rules mean millimetres; when no circle-like loop exists but `hints.inventoryDims`, scale the largest loop's long side to `a_len` (`inventory-dims`); when nothing applies → `scaleBasis null`, `confidence 'none'`, note `'scale unknown: no size text, size class or inventory dims'`, and still return the unscaled loops count in notes. Then scale everything, flip y if the CTM is y-up (pdf user space is y-up; keep as is — orientation is not significant), `classifyLoops` with `expectedOuterDiameter`, frame, grade.

`extractFromScannedPdf`: operator list → first `paintImageXObject` name → `page.objs.get(name)` (wrap the callback form in a Promise) → `toGray` → `otsuThreshold` → `inkMask` → `closeMask(3)` → `traceLoops` → `simplify(1)`; scale: a circle-like loop with px diameter ≥ 40% of the image's short side and a known diameter (text is not available on scans, so `hints.sizeClass`) → `hint-diameter`; else `inventoryDims.a_len` on the largest loop's long side → `inventory-dims`; else none. Pixel y grows downward, so negate y before classifying. `source 'pdf-raster'` so the grade caps at `uncertain`.

- [ ] **Step 4: Run the tests** — Expected: PASS (4 + 7). Confirm the whole suite still runs under 60 s (`npm test`); pdfjs loads once per test file.

- [ ] **Step 5: Commit**

```bash
git add server/services/rasterTrace.cjs server/services/pdfOpenings.cjs server/services/rasterTrace.test.cjs server/services/pdfOpenings.test.cjs
git commit -m "feat(tooling): vector-PDF and scanned-PDF opening extractors with a raster tracer"
```

---

### Task 7: DWG → DXF converter script and known-toolings export

**Files:**
- Create: `server/services/dwgConvert.cjs`, `server/scripts/convert-dwg-to-dxf.cjs`, `server/scripts/export-known-toolings.cjs`
- Test: `server/services/dwgConvert.test.cjs`

**Interfaces:**
- Consumes: Task 5 `listArchiveDrawings`.
- Produces:
  - `dwgConvert.cjs`: `DEFAULT_ACCORECONSOLE = 'C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe'`; `dxfPathFor(file: ArchiveFile, dxfRoot) → string` (`<dxfRoot>/<relPath with .dwg → .dxf>`); `planConversions(files, dxfRoot, statLike) → { todo: ArchiveFile[], done: number }` (skip when the DXF exists and is newer than the DWG); `scriptText(dxfPath) → string` (CRLF: `FILEDIA`, `0`, `_.DXFOUT`, `"<dxfPath>"`, `16`, `_.QUIT`, `Y`, trailing CRLF); `convertOne(file, dxfRoot, { exe, spawn, timeoutMs = 120000, fsLike }) → Promise<{ ok: boolean, seconds: number, error?: string }>` (writes the `.scr` beside the DXF, spawns `exe ['/i', dwg, '/s', scr, '/l', 'en-US']`, kills on timeout, success = exit 0 and DXF exists with size > 0; deletes the `.scr` afterwards); `convertAll(files, dxfRoot, { concurrency = 3, onProgress, ...opts }) → Promise<{ converted, failed: Array<{ relPath, error }>, skipped }>`.
  - `scripts/convert-dwg-to-dxf.cjs --archive <root> --dxf-dir <dir> [--accoreconsole <exe>] [--concurrency 3] [--limit N] [--dry-run]`; prints the plan (counts per scoped folder), then converts with a progress line every 25 files, and writes `<dxf-dir>/conversion-report.json` (`{ startedAt, finishedAt, converted, skipped, failed[] }`).
  - `scripts/export-known-toolings.cjs [--out <file>]` (server-side, needs the DB): writes `{ exportedAt, toolings: Array<{ number, kind, plant, size_class, cavities, inventory_dims, status }> }` — the hints file the bundle builder reads.

- [ ] **Step 1: Write the failing tests**

```js
test('scriptText is CRLF and ends with QUIT then Y', () => {
  assert.equal(scriptText('C:\\out\\a.dxf'), 'FILEDIA\r\n0\r\n_.DXFOUT\r\n"C:\\out\\a.dxf"\r\n16\r\n_.QUIT\r\nY\r\n');
});
test('planConversions skips DXFs newer than their DWG', () => { /* statLike returns mtimes; 2 files, one up to date → todo 1, done 1 */ });
test('convertOne reports ok only when the exit code is 0 and the DXF appeared', async () => { /* fake spawn that writes the dxf and exits 0 → ok; exits 0 without file → !ok; exit 1 → !ok with error */ });
test('convertOne kills a hung process after the timeout', async () => { /* fake spawn never exits; timeoutMs 10 → !ok, error /timeout/ */ });
test('convertAll runs at most `concurrency` at once and collects failures', async () => { /* 7 files, concurrency 3, fake spawn tracks peak concurrency = 3, one fails → failed.length 1 */ });
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement the module and both scripts**

`convertOne` uses `child_process.spawn` with `windowsHide: true`; stdout is discarded. The script resolves `--archive` default to `C:\Users\vijee\Desktop\18.06.2026\New folder\14.Die Toolings` and `--dxf-dir` default to `C:\Users\vijee\Desktop\18.06.2026\tooling-dxf` (outside the archive and the repo). `export-known-toolings.cjs` follows the Plan 1 script shape (`require('../db.cjs')` only when running) and prints the count written.

- [ ] **Step 4: Run the tests, then a real smoke run**

`node --test server/services/dwgConvert.test.cjs` → PASS (5). Then on the PC: `node server/scripts/convert-dwg-to-dxf.cjs --limit 5` → expected: 5 DXFs appear under the dxf dir mirroring the archive paths, `conversion-report.json` says `converted: 5, failed: []`; run again → `skipped: 5`. (The full run of ~3,500 scoped DWGs takes about 1.5–3 hours at concurrency 3; the controller starts it in the background after this task and lets it run while Tasks 8–10 proceed.)

- [ ] **Step 5: Commit**

```bash
git add server/services/dwgConvert.cjs server/services/dwgConvert.test.cjs server/scripts/convert-dwg-to-dxf.cjs server/scripts/export-known-toolings.cjs
git commit -m "feat(tooling): DWG to DXF conversion via accoreconsole, known-toolings export"
```

---

### Task 8: Bundle builder (PC side)

**Files:**
- Create: `server/services/toolingBundle.cjs` (build half), `server/scripts/build-tooling-bundle.cjs`
- Test: `server/services/toolingBundle.test.cjs`

**Interfaces:**
- Consumes: Task 5 `listArchiveDrawings`, `interpretStem`, `groupByTooling`; Task 7 `dxfPathFor`; Task 3 `extractFromDxf`; Task 6 `extractFromPdf`; Task 4 `storedRelativePath`, `sha256Of`, `formatOf`; Plan 1 `normalizeSizeClass`.
- Produces:
  - Bundle layout: `<out>/manifest.json` `{ version: 1, createdAt, archiveRoot, dxfRoot, counts: { files, toolingsNew, drawings, openings, skipped } }`, `toolings.json` (new toolings only: `{ number, kind, plant, size_class, size_class_source: 'drawing'|null, size_class_confidence, cavities, source: 'drawing-archive', status: 'retired', notes }`), `drawings.json` (`{ toolingNumber, bundleFile: 'files/<relative stored path>', originalName, archivePath, format, matchBasis, sha256, byteSize, isPrimary }`), `openings.json` (`{ toolingNumber, drawingSha256, extraction: ExtractionResult }`), `hints.json` (per known tooling what was passed), `report.json` (`{ skipped: Array<{ relPath, reason }>, unmatched: string[], extractionFailures: Array<{ toolingNumber, file, error }>, byConfidence: { confirmed, likely, uncertain, none } }`), `files/…`.
  - `buildBundle({ files: Array<ArchiveFile>, known: KnownMap, io: { readFile, copyFile, dxfFor }, extractors: { dxf, pdf }, limit = null, onProgress }) → Promise<{ toolings, drawings, openings, report }>` — pure apart from the injected IO; `KnownMap = Map<number, { kind, plant, size_class, cavities, inventory_dims, status }>` built from the export JSON (`knownFromExport(json)`).
  - `scripts/build-tooling-bundle.cjs --archive <root> --dxf-dir <dir> --out <bundleDir> [--known <known-toolings.json>] [--limit N] [--only <substring>] [--dry-run]`.

- [ ] **Step 1: Write the failing tests** (a fake archive of 6 files: a live Dieshop DWG with a converted DXF, a scrap DWG, a bolster DXF whose number is known, a root PDF for an unknown GEX-2 insert, a Dieshop PDF whose DWG exists, a `.bak`)

```js
test('matches, groups, copies and extracts; known toolings are hinted, unknown ones become retired toolings', async () => {
  const r = await buildBundle({ files, known, io, extractors: { dxf: fakeDxf, pdf: fakePdf } });
  assert.deepEqual(r.toolings.map((t) => [t.number, t.status, t.source]), [['25IC1-027847', 'retired', 'drawing-archive']]);
  assert.equal(r.drawings.filter((d) => d.toolingNumber === 'I-21599').length, 2);           // the DWG's converted DXF and the Dieshop PDF; the DWG itself is not stored
  assert.equal(r.drawings.find((d) => d.toolingNumber === 'I-21599' && d.isPrimary).format, 'dxf');
  assert.deepEqual(fakeDxf.calls.find((c) => c.number === 'BOL-14017').hints, { sizeClass: '475X220', cavities: null, inventoryDims: { a_len: 250, b_wid: 150 } });
  assert.equal(r.openings.length, 3);
  assert.deepEqual(r.report.skipped.map((s) => s.reason).sort(), ['scrap']);
  assert.ok(io.copied.every((p) => p.startsWith('files/')));
});
test('the Dieshop PDF is attached but the DXF is extracted when both exist', async () => { /* openings for I-21599: one, extraction.source 'dxf' */ });
test('a DWG with no converted DXF is attached as dwg and reported, not extracted', async () => { /* report.extractionFailures has reason /no DXF/ */ });
test('a new tooling takes its size class and cavities from the extraction, with the drawing confidence', async () => { /* 25IC1-027847 → size_class from fakePdf result, size_class_source 'drawing' */ });
test('limit stops after N toolings and the report says so', async () => { /* limit 1 → 1 tooling processed, report.limited true */ });
test('hints never leak between toolings', async () => { /* the unknown tooling gets { sizeClass: null, cavities: null, inventoryDims: null } */ });
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement**

Per group (tooling): hints from `known` (`sizeClass`, `cavities`, `inventoryDims`; for a GEX-2 insert with a `<press>IC<n>` number, `cavities` also from `parseToolingNumber(...).cavities` when the master has none); choose the extraction file = `primary` (Task 5 order) with a DWG replaced by its converted DXF (`io.dxfFor(file)` → path or null; a DWG without a DXF is attached with `format 'dwg'` and reported `'no DXF — run convert-dwg-to-dxf'`); for every file in the group: `sha256Of`, `storedRelativePath`, copy to `files/<rel>` (the DWG itself is **not** copied — only its DXF, with `originalName` = the DWG's name and `.dxf`, `archivePath` = the DWG's archive path), push a drawing row; run the extractor on the primary (DXF → `extractFromDxf(text, hints)`, PDF → `extractFromPdf(buffer, hints)`); push `{ toolingNumber, drawingSha256: <primary's sha>, extraction }`; for an unknown number push a new tooling with `size_class` = `extraction.sizeClass` (source `'drawing'`, confidence from the extraction) or the file-name size (source `'drawing'`, confidence `'likely'`), `cavities` = `extraction.cavities`, `notes` = `'from drawing archive: ' + archivePath`. Errors thrown by an extractor are caught per tooling and reported, never fatal. The script writes the four JSON files after processing and prints the report summary (`byConfidence`, skipped reasons, unmatched count, top 20 unmatched stems). `--dry-run` matches and groups but neither copies nor extracts.

- [ ] **Step 4: Run the tests, then a real smoke run on 25 toolings**

`node --test server/services/toolingBundle.test.cjs` → PASS (6). Then on the PC, with the known export from the test server (Task 7 script run inside the backend container and copied out):

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/export-known-toolings.cjs --out /tmp/known-toolings.json
docker cp die-ordering-backend:/tmp/known-toolings.json "C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/known-toolings.json"
node server/scripts/build-tooling-bundle.cjs --out "C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/smoke" --known "C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/known-toolings.json" --limit 25
```

Expected: `manifest.json` with 25 toolings' worth of drawings, `report.json` `byConfidence` with at least one `confirmed` (Dieshop inserts), and `files/` populated. Record the counts in the task report.

- [ ] **Step 5: Commit**

```bash
git add server/services/toolingBundle.cjs server/services/toolingBundle.test.cjs server/scripts/build-tooling-bundle.cjs
git commit -m "feat(tooling): import bundle builder — match archive drawings, copy, extract openings"
```

---

### Task 9: Bundle applier (server side)

**Files:**
- Modify: `server/services/toolingBundle.cjs` (apply half)
- Create: `server/scripts/apply-tooling-bundle.cjs`
- Test: `server/services/toolingBundle.test.cjs` (extend)

**Interfaces:**
- Consumes: Task 4 `getRoot`, `absolutePath`; bundle JSON shapes from Task 8.
- Produces:
  - `readBundle(dir, fsLike) → Bundle` (validates `manifest.version === 1`, throws otherwise).
  - `applyBundle(client, bundle, { root, io: { copyFile, mkdirp, exists }, dryRun = false, log }) → Promise<{ toolingsInserted, toolingsUpdated, drawingsInserted, drawingsSkipped, openingsWritten, openingsSkippedReviewed, openingsSkippedUnknownTooling, filesCopied }>` — statements:
    - new toolings (`toolings.json`): `INSERT … ON CONFLICT (number) DO UPDATE SET size_class = COALESCE(toolings.size_class, EXCLUDED.size_class), size_class_source = CASE WHEN toolings.size_class IS NULL AND EXCLUDED.size_class IS NOT NULL THEN EXCLUDED.size_class_source ELSE toolings.size_class_source END, size_class_confidence = (same CASE), cavities = COALESCE(toolings.cavities, EXCLUDED.cavities), updated_at = CURRENT_TIMESTAMP` — **status, kind, plant, source, held_presses untouched**.
    - known toolings: for every `openings.json` entry whose `extraction.sizeClass` or `extraction.cavities` is set, `UPDATE toolings SET size_class = COALESCE(size_class, $2), size_class_source = CASE WHEN size_class IS NULL AND $2 IS NOT NULL THEN 'drawing' ELSE size_class_source END, size_class_confidence = CASE WHEN size_class IS NULL AND $2 IS NOT NULL THEN $3 ELSE size_class_confidence END, cavities = COALESCE(cavities, $4), updated_at = CURRENT_TIMESTAMP WHERE number = $1` (counted in `toolingsUpdated` only when `rowCount` is 1 and something was NULL before — read the row first in the same transaction).
    - drawings: `INSERT … ON CONFLICT (tooling_id, sha256) DO NOTHING`, then `UPDATE tooling_drawings SET is_primary = (sha256 = $primary) WHERE tooling_id = $id`; files copied only when `!exists(abs)`.
    - openings: `INSERT INTO tooling_openings (tooling_id, outer_outline, pockets, pocket_gap_mm, extraction_source, confidence, drawing_file, drawing_id, extraction_note) VALUES (…) ON CONFLICT (tooling_id) DO UPDATE SET … , updated_at = CURRENT_TIMESTAMP WHERE tooling_openings.reviewed_at IS NULL` — the `WHERE` is what protects reviewed rows; count them via `rowCount`.
    - everything in one transaction; `dryRun` runs the reads, prints the counts it would write and rolls back.
  - `scripts/apply-tooling-bundle.cjs <bundleDir> [--dry-run]`.

- [ ] **Step 1: Write the failing tests** (fake client recording SQL + params, as in `dieToolingLinks.test.cjs`)

```js
test('inserts new toolings as retired without touching status on conflict', async () => { /* SQL for toolings contains "ON CONFLICT (number) DO UPDATE" and does not mention "status =" in the SET list; params include 'retired' */ });
test('a known tooling with no size class receives the drawing-derived one via COALESCE', async () => { /* an openings entry for I-21599 with sizeClass '175X80' → an UPDATE toolings … WHERE number = $1 whose SET has COALESCE(size_class, $2) and never mentions status; params [ 'I-21599', '175X80', 'confirmed', 1 ] */ });
test('drawings are keyed by tooling and sha; files are copied once', async () => { /* exists() true for one file → filesCopied 1 of 2, drawingsSkipped 1 */ });
test('a reviewed opening is never overwritten', async () => { /* fake client returns rowCount 0 for the opening upsert → openingsSkippedReviewed 1; SQL has "WHERE tooling_openings.reviewed_at IS NULL" */ });
test('an opening for a number the master does not have is skipped and counted', async () => { /* tooling lookup returns no row → openingsSkippedUnknownTooling 1 */ });
test('dry run rolls back and copies nothing', async () => { /* last statement ROLLBACK, filesCopied 0 */ });
test('readBundle rejects another version', () => { assert.throws(() => readBundle('/b', fsWith({ 'manifest.json': '{"version":2}' })), /version/); });
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement** the apply half and the script (reads `getRoot()`, resolves the bundle dir, `pool.connect`, prints the counts, `--dry-run` default-safe messaging as Plan 1's scripts).

- [ ] **Step 4: Run the tests, then apply the smoke bundle on the test server**

```bash
docker cp "C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/smoke" die-ordering-backend:/tmp/tooling-bundle-smoke
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/apply-tooling-bundle.cjs /tmp/tooling-bundle-smoke --dry-run
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/apply-tooling-bundle.cjs /tmp/tooling-bundle-smoke
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/apply-tooling-bundle.cjs /tmp/tooling-bundle-smoke   # second run: 0 inserts
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "select confidence, count(*) from tooling_openings group by 1" -c "select count(*) from tooling_drawings" -c "select status, count(*) from toolings group by 1"
```

Expected: first live run inserts drawings and openings; second run reports 0 drawings inserted and the same openings rewritten (none reviewed yet); files exist under `/app/storage/tooling-files/<number>/`.

- [ ] **Step 5: Commit**

```bash
git add server/services/toolingBundle.cjs server/services/toolingBundle.test.cjs server/scripts/apply-tooling-bundle.cjs
git commit -m "feat(tooling): apply-tooling-bundle — idempotent load of drawings and openings, reviewed rows protected"
```

---

### Task 10: Read API — drawings on the detail, file download, review queue; client

**Files:**
- Modify: `server/routes/toolings.cjs`, `server/routes/toolings.test.cjs`
- Modify: `src/api.js` (`toolingsAPI`), `src/api.test.js`

**Interfaces:**
- Produces:
  - `GET /api/toolings/:number` now also returns `drawings: Array<{ id, original_name, format, match_basis, is_primary, byte_size, created_at }>` (ordered primary first, then name) and `opening` includes `drawing_id`, `extraction_note`.
  - `GET /api/toolings/:number/drawings/:id/file` → `res.download(abs, original_name)`; 404 when the drawing does not belong to that tooling; 500 never leaks the path.
  - `GET /api/toolings/review-queue?plant=&kind=&limit=&offset=` → `{ items: Array<{ number, kind, plant, size_class, status, opening_confidence, extraction_source, drawing_count, reason }>, total }` where `reason` is `'unverified'` (status), `'no-opening'`, `'no-pockets'` (confidence none), `'uncertain'`, `'no-size-class'` — toolings with `status IN ('active','unverified')` having at least one of those; ordered by reason priority in that list, then number; `limit` default 50 max 200. Registered **before** `/:number`.
  - `toolingsAPI.reviewQueue(params)` (same query-string cleaning as `list`), `toolingsAPI.downloadDrawing(number, id) → Promise<Blob>` — a `fetch` to `${API_BASE_URL}/toolings/<enc>/drawings/<id>/file` with the bearer header, returning `response.blob()`, exactly as `ordersAPI`'s order-file download does (`src/api.js` around line 305); throws on a non-OK status.

- [ ] **Step 1: Write the failing tests** (extend the fake db in `toolings.test.cjs`; it matches on SQL fragments, so query `tooling_drawings` in its own statement)

```js
test('detail lists drawings primary first', async () => { /* fake returns 2 drawing rows → res.body.drawings[0].is_primary === true */ });
test('download streams the stored file for its own tooling only', async () => { /* temp root with a file; GET …/drawings/7/file → 200 and Content-Disposition attachment; GET with a drawing row belonging to another tooling → 404 */ });
test('download refuses a stored path outside the root', async () => { /* row file_path '../x' → 500/404, no file read */ });
test('review queue orders unverified, no-opening, none, uncertain, no-size-class', async () => { /* SQL contains the CASE ordering; items carry reason */ });
test('review queue registers before the number route', async () => { /* GET /api/toolings/review-queue is not a 404 */ });
// src/api.test.js
test('toolingsAPI.reviewQueue and downloadDrawing hit the right paths', …); // fetch stub records URL + Authorization header; downloadDrawing resolves to the stubbed blob
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.

- [ ] **Step 3: Implement** in `toolings.cjs` (`toolingDrawings.getRoot`/`absolutePath` for the download) and `src/api.js`.

- [ ] **Step 4: Run the tests** — `node --test server/routes/toolings.test.cjs src/api.test.js` → PASS. Rebuild the test-server backend from the worktree and smoke-check with a 10-minute admin JWT minted inside the container (Plan 1 recipe): detail of a tooling from the smoke bundle shows `drawings` and the download returns the DXF bytes; `review-queue` returns items.

- [ ] **Step 5: Commit**

```bash
git add server/routes/toolings.cjs server/routes/toolings.test.cjs src/api.js src/api.test.js
git commit -m "feat(tooling): drawings on the detail, drawing download, review-queue listing"
```

---

### Task 11: Full import on the test server and the runbook

**Files:**
- Create: `docs/tooling-geometry-import-runbook.md`
- Modify: `docs/tooling-master-import-runbook.md` (one "Next: geometry" pointer line)

- [ ] **Step 1: Finish the DWG conversion** started after Task 7 (check `conversion-report.json`; rerun the script to pick up failures — it skips what is done).

- [ ] **Step 2: Build the full bundle** on the PC with the known export, no `--limit`; record `report.json` counts (files, toolings new, by confidence, skipped by reason, unmatched count, extraction failures).

- [ ] **Step 3: Apply on the test server** (`docker cp` the bundle to `/tmp/tooling-bundle`, `--dry-run`, then live, then live again for idempotency). Verification queries:

```sql
select confidence, extraction_source, count(*) from tooling_openings group by 1,2 order by 1,2;
select plant, kind, status, count(*) filter (where size_class is not null) sized, count(*) total from toolings group by 1,2,3 order by 1,2,3;
select count(*) drawings, count(distinct tooling_id) toolings_with_drawings from tooling_drawings;
select t.number, o.confidence, o.extraction_note from tooling_openings o join toolings t on t.id=o.tooling_id where t.status='active' and o.confidence in ('uncertain','none') order by t.number limit 30;
```

Expected shape (not exact numbers): GEX-1 live inserts gain several hundred size classes with `size_class_source='drawing'`; a few hundred `confirmed` openings from Dieshop DXFs; the 14 GEX-1 bolsters get openings (`likely` from DXF or `uncertain` from scans); retired drawing-only toolings appear in the hundreds.

- [ ] **Step 4: Write the runbook**: prerequisites (AutoCAD 2027 on the PC, archive path, `.env` recipe for rebuilding the backend from the worktree), the four commands in order with their defaults, where the DXF cache and bundle live, how to re-run after new drawings arrive (conversion skips done files; bundle rebuild; apply is idempotent and never touches reviewed openings), the verification queries, the confidence vocabulary and what each means for the finder, known gaps (TIFFs skipped; DWGs without a DXF; scans without inventory dims stay `none`; the review queue is only an API until Plan 5), and the production procedure (bundle folder copied to a path mounted into the backend, `--dry-run` first). Numbers in the runbook come from Step 3's actual output.

- [ ] **Step 5: Run the whole suite, commit**

```bash
npm test
git add docs/tooling-geometry-import-runbook.md docs/tooling-master-import-runbook.md
git commit -m "docs(tooling): geometry import runbook with test-server results"
```

---

## Self-review notes

- Spec coverage for this plan's slice: `tooling_openings` content and confidence (Tasks 2, 3, 6, 9); GEX-1 size class from the drawing with confidence, no guess (Task 3 outline-only rule, Task 9 COALESCE); drawings attached with match basis and stored under a new root with a Docker volume (Tasks 4, 8, 9; deploy note); `attach-tooling-drawings` + `extract-openings` (Task 8, one script), `apply-tooling-bundle` (Task 9), DWG→DXF via `accoreconsole` with the `_.QUIT` / `Y` ending (Task 7); DXF first, then vector PDF, then scans — all three ship (Tasks 3, 6; the bundle processes DXF primaries first by Task 5's primary order); drawing-only toolings imported as `retired` (Task 8); review-queue data (Task 10) for the Plan 5 page; server never needs AutoCAD (conversion is PC-side; a DWG without a DXF is stored and reported).
- Deliberately out of scope here: the Tooling page, upload and confirm endpoints (Plan 5); profile shapes (Plan 3); the finder (Plan 4); the Press-6 insert sheet as a cross-check (`6.Press 6/Insert/PRESS 6 INSERTS(460 AND 560).xlsx`: INSERT NUMBER, SIZE, LENGTH, WIDTH, NO OF CAV, CENTER GAP, 37 rows) — a cheap follow-up for Plan 4's verification, noted in the runbook's gaps.
- My calls to check while reading: the original DWG is not copied into app storage (its DXF is; `archive_path` keeps the provenance) — saves about 1 GB; TIFFs are skipped; raster results cap at `uncertain`; a vector PDF with no scale basis is `none`, not scaled by the page size; coloured strokes are dropped on vector PDFs; the review queue is read-only until Plan 5.
