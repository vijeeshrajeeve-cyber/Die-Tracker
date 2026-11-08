# Tooling Finder, Plan 3 of 5: Profile Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every known die a profile shape — outer outline, holes, a rotation/scale-invariant signature and, where it can be known, the true-size outline in millimetres — seeded from the image-check workbook and extended by every die-order PDF import, with a nearest-shapes lookup the finder (Plan 4) and the UI (Plan 5) will call.

**Architecture:** Pure modules under `server/services/`: a shape-geometry module (contour normalisation and signature), a raster-to-shape module built on Plan 2's `rasterTrace.cjs` (silhouette vs outline style, hole depth), a minimal zip reader for the 167 MB workbook, and a similarity service with an in-memory signature cache. One PC-side script builds a profile bundle from the workbook (pictures decoded with `@napi-rs/canvas`), one server-side script applies it (idempotent, true size from the die list's `ProfileCCD`). The existing order-PDF import posts its profile PNG today; the server now also traces it into a shape, scaled by the drawing's stated scale and checked against the die list. A read API exposes a die's shapes and its nearest neighbours.

**Tech Stack:** Node 20 CommonJS (`.cjs`), Express 5, Postgres via `pg`, `node:test`. **One new direct dependency:** `@napi-rs/canvas@0.1.80` (already present in `node_modules` as pdfjs-dist's optional dependency; promoted to a direct dependency because the server decodes PNG/GIF with it — it ships a `linux-x64-musl` build for the Alpine image). Nothing else new.

**Spec:** `docs/superpowers/specs/2026-11-07-tooling-finder-design.md` — read it first; this plan implements part 3 "Profile library", the `import-profile-images` and order-PDF lines of part 8, and the "Signature" / "Image-check pictures with dimension lines" / "Similarity N" calls. Plans 1–2 (merged to `main`, head `2b153e2`) provide the tables, normalisers and the raster tracer this plan reuses. Plan 4 consumes `profile_shapes.outer_mm`/`holes_mm` and `nearestShapes`; Plan 5 draws the pictures and the similar-profiles strip.

**Branch:** start from `main` (`2b153e2`) in a fresh worktree via superpowers:using-git-worktrees at `.claude/worktrees/tooling-finder-3`, branch `feat/tooling-finder-3-profiles`. The main checkout sits on `feat/sample-followup-mass-update` with unrelated uncommitted work; this plan exists only as an untracked file there — copy it into the worktree and commit it in Task 1. From a worktree the test-server stack is driven with `docker compose -p die-tracker --env-file ../../../.env build backend` and `docker compose -p die-tracker -f docker-compose.yml --project-directory ../../.. up -d --wait backend`.

## What the survey found (facts the tasks rely on)

- **Workbook** `C:\Users\vijee\Desktop\18.06.2026\Dies List ExtractedNew - Image Check - Final 30.10.2026.xlsx` (167 MB, 19,954 media files: 19,803 GIF, 151 PNG). Sheets: `GEX1` (sheet1, drawing1), two identical GEX1 copies (ignore), `Summary`, `GEX2` (sheet5, drawing4), `Sheet1`, `GEX1 Profiles`, `GEX2 Profiles` (no pictures: ignore). `GEX1` columns: A `IDProfile` (`12555`), B `IDDie` (`12555_101` — the same `NNNNN_NNN` spelling as `existing_die_details.die_no` for GEX 1; 24,419 of 25,094 rows in that form, the rest `NNNNN_NNNN` / `NNNNNN_NNN(N)`), C `IDDieType` (`Hollow` 14,390 / `SOLID` 6,427 / `Solid` 4,277), E picture, F inspector's verdict (`Hollow`/`SOLID`/`Solid`/`solid`; one junk `;+A2567;`), G `Image Check` note (357 filled: `Mismatch: image shows SOLID profile (no closed cavity)` 188, `Mismatch: image shows HOLLOW profile (closed cavity)` 33, `No image in Column E` 125, `Image blank - cannot verify` 8, `Image unclear - cannot verify` 3), H inspector name. `GEX2` columns: A `IDProfile` (`090019`), B `IDDie` (`090019-2501`; 4,032 rows `NNNNNN-NNNN`, 1,626 `NNNNNN-NNN`), C type, D `IDStatus`, E `Image not found` text for 4,232 rows (pictures on 1,526), F inspector; no verdict or note column.
- **Pictures** are `twoCellAnchor`s in `xl/drawings/drawingN.xml` (`<xdr:from><xdr:row>` zero-based → sheet row + 1; name `GEX1_ProfileImage_<row>`; `<a:blip r:embed="rIdN">` → `xl/drawings/_rels/drawingN.xml.rels` → `../media/imageM.gif`). GEX1: 24,969 anchors over 18,702 distinct media (3,767 pictures are shared by several dies), 6 rows with two pictures, 2 anchors spanning two rows; GEX2: 1,526 anchors, 1,274 media. Typical picture 917 × 456 px (p10 552 × 305, p90 1,213 × 629), ~5.6 KB GIF. Content: a **filled dark silhouette** of the section (walls filled, hollows white) or a **thin-stroke outline** of a solid section; not to scale.
- **Die list** (`existing_die_details`, test server): GEX 01 44,669 rows, `raw_data->>'ProfileCCD'` numeric on 42,141 (94 %), `ProfileExternalPerimeter` 23,768, `ProfileInternalPerimeter` 28,350, `cavity` on 44,651; `die_type` values `Hollow`/`SOLID`/`Solid`/`Backup`/`New`/`HOLLOW`; GEX 2 7,099 rows, no CCD/perimeters, `die_no` like `090600-2501` (5,525 in `NNNNNN-NNNN`). Plant spellings `GEX 01`/`GEX 2` — compare through `normalizePlant`.
- **Die-order PDFs** (15 samples at `C:\Users\vijee\Desktop\New die ordering_for_GEX-1_and_GEX-2-Fast_track_die_\` — the folder name carries an odd character; find files with `find "C:/Users/vijee/Desktop" -maxdepth 2 -iname '*.pdf' | grep -E '/[0-9]{5,6}_[0-9]{3}_?\.pdf$'`): A4 (595 × 842 pt), 2 pages. Page 1 text carries `SCALE 1:1` for the main view plus detail scales (`Scale 3:1`, `SCALE 3:2`, `SCALE 2:1`, `SCALE 3:4`, `Scale 4:1`), title-block labels `External perimeter`, `Total internal perimeter`, `CCD`, `No. of cavities`, `Weight kg/m`, `Area` whose values are blank (`-`) on these fast-track forms, and the order form (`DIE SIZE - DIA320X160`, `No OF CAV - 2`, `INSERT No, - 25IC2-030724`). The client import (`src/components/modals/PDFImportModal.jsx`) already renders page 1 at 200 DPI, cuts the profile pixels (`src/utils/profileImage.js` `extractProfile` → `captureProfileImage`) and posts the PNG to `POST /api/orders/:id/profile-image` (`server/routes/orders.cjs` ~:650-735, `src/hooks/usePIImport.js:139`), where it is stored in `die_order_files` slot `profile_image`. The modal already parses die size, cavities (`No OF CAV - 2`), press, die type, insert/bolster numbers from text lines (`{ y, text, items:[{text,x}] }`).
- **Reusable from Plan 2:** `server/services/rasterTrace.cjs` (`toGray`, `otsuThreshold`, `inkMask`, `closeMask`, `enclosedRegions`, `traceBoundary`, `simplify`, `traceLoops`), `server/services/openingGeometry.cjs` (`polygonArea`, `centroid`, `bbox`, `pointInPolygon`, `polygonContains`, `chainLoops`), `server/services/toolingDrawings.cjs` (`getRoot`, `absolutePath`, `sha256Of`), the schema parity test `server/services/toolingSchema.test.cjs` (CRLF-safe since `2b153e2`), Plan 2's script shapes (`flag('--name')`, `--dry-run`, one transaction, `pool.end()`), and the bundle pattern (PC builds a folder of JSON + files; `docker cp` + server-side apply).

## Global Constraints

- Server code is CommonJS in `server/**/*.cjs`; tests `*.test.cjs` beside the module, run by `npm test`. Client code is ESM under `src/`. No new npm dependencies beyond `@napi-rs/canvas@0.1.80` as a direct dependency.
- Every schema change is written **twice**: `init.sql` and the migration in `server/db.cjs`; new tables as `CREATE TABLE IF NOT EXISTS` in both; `server/services/toolingSchema.test.cjs` must cover the new table.
- A polygon is `Array<[x, y]>` with no repeated closing point. **Unit frame:** translate the shape so its outer centroid is (0, 0) and scale so the outer's root-mean-square radius is 1; y grows upward (image rows are negated). **Millimetre frame:** same orientation, centred the same way, scaled to true size; `ccd_mm` is the diameter of the outer's minimal enclosing circle.
- The signature is `Array<number>` of fixed length **24**: 20 normalised Fourier magnitudes of the centroid-distance function over the outer outline resampled to 128 points by arc length, then aspect ratio (√(λ₁/λ₂) of the outline's covariance, capped at 10 and divided by 10), solidity (outer area ÷ convex-hull area), hole-area fraction (Σ hole areas ÷ outer area), and `min(holeCount, 8) / 8`. It is rotation-, scale-, translation- and start-point-invariant; mirror images are equal by design (similarity is shape only).
- Similarity distance is Euclidean over the signature; candidates must have the **same hole count**; results sort by distance ascending; cavity count is reported as `cavityMatch: boolean`, never used as a filter. Rows with `needs_review = true` never appear in similarity results.
- Confidence/provenance vocabulary for true size: `true_size_source` ∈ `pdf-scale` | `ccd-scaled` | `drawing` | `manual`; `true_size_confidence` ∈ `confirmed` | `likely` | `uncertain`. A shape without a defensible scale has `true_size = false` and NULL mm columns — never a guessed scale.
- Plant values stored as `GEX 1` / `GEX 2`; die list rows are matched through `normalizePlant` from `server/services/frozenDesigns.cjs`.
- Scripts are idempotent, take `--dry-run`, print what they will change first, and never run an unscoped `DELETE`. Re-running an import never flips `needs_review` back to false on a row a person has cleared (`reviewed_at IS NOT NULL`).
- Stored picture files live under `TOOLING_FILES_ROOT` at `profiles/<sha256 first 2>/<sha256>.<gif|png>`; paths are checked with `toolingDrawings.absolutePath`.
- Commit after every task; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A thin-outline picture of a **solid** section encloses one big white region that is metal, not a hole; it must not be counted as a hole and must not be flagged against a `Solid` verdict — Task 2 test `outline-style solid section has no holes`.
2. A picture shared by several dies (3,767 cases) must yield identical rows for each die and be decoded once — Task 4 test `a shared picture is decoded once and attached to every die`.
3. A die-order PDF whose main view is `SCALE 1:1` but whose detail views say `Scale 3:1` must take the main scale, and when the die list's CCD disagrees with every candidate scale the row is `true_size = false` — Task 6 tests `the main view scale wins over detail scales` and `no scale agrees with the die list CCD → not true size`.
4. A workbook row whose note says `Image unclear` or `Mismatch` is imported with `needs_review = true` and excluded from similarity — Task 4 test `review notes set needs_review` and Task 7 test `needs_review rows are never returned`.
5. Re-applying the bundle after a person cleared a review flag must not re-flag the row — Task 5 test `a reviewed row keeps its cleared flag`.

---

### Task 1: Shape geometry and signature

**Files:**
- Create: `server/services/profileShape.cjs`
- Test: `server/services/profileShape.test.cjs`
- Commit also: this plan

**Interfaces:**
- Consumes: `polygonArea`, `centroid`, `bbox` from `openingGeometry.cjs`.
- Produces:
  - `resampleByArcLength(points, n = 128) → Array<[x, y]>`.
  - `convexHull(points) → Array<[x, y]>` (monotone chain).
  - `minEnclosingCircle(points) → { cx, cy, r }` (Welzl or the iterative shrink; exact to 1e-6 on the tests).
  - `toUnitFrame({ outer, holes }) → { outer, holes, centroid: [cx, cy], scale: number }` (centroid at origin, RMS radius 1; `scale` = the divisor applied, in input units per unit).
  - `signatureOf({ outer, holes }) → number[24]` per the Global Constraints; `holes` may be `[]`.
  - `signatureDistance(a, b) → number` (Euclidean; throws when lengths differ).
  - `shapeStats({ outer, holes }) → { area, holeArea, solidity, aspectRatio, holeCount, ccd }` in the input's units.

- [ ] **Step 1: Create the worktree, copy and stage this plan** (as in Plans 1–2). Run `npm test` for the baseline (1278 pass / 2 skipped on `2b153e2`).

- [ ] **Step 2: Write the failing tests**

```js
const sq = (s, cx = 0, cy = 0) => [[cx - s/2, cy - s/2], [cx + s/2, cy - s/2], [cx + s/2, cy + s/2], [cx - s/2, cy + s/2]];
const rot = (pts, deg) => { const a = deg * Math.PI / 180; return pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]); };
const circle = (r, n = 96) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]);
const lShape = (s) => [[0,0],[s,0],[s,s*0.3],[s*0.3,s*0.3],[s*0.3,s],[0,s]];

test('resampling keeps the perimeter and spaces points evenly', () => {
  const pts = resampleByArcLength(sq(10), 40);
  assert.equal(pts.length, 40);
  const d = pts.map((p, i) => Math.hypot(p[0] - pts[(i + 1) % 40][0], p[1] - pts[(i + 1) % 40][1]));
  assert.ok(Math.max(...d) - Math.min(...d) < 1e-9);
});
test('minimal enclosing circle of a square is its circumcircle', () => {
  const c = minEnclosingCircle(sq(10)); assert.ok(Math.abs(c.r - Math.SQRT2 * 5) < 1e-6 && Math.abs(c.cx) < 1e-9);
});
test('unit frame centres on the centroid and normalises RMS radius to 1', () => {
  const u = toUnitFrame({ outer: sq(10, 100, -40), holes: [] });
  const c = centroid(u.outer); assert.ok(Math.abs(c[0]) < 1e-9 && Math.abs(c[1]) < 1e-9);
  const rms = Math.sqrt(u.outer.reduce((s, [x, y]) => s + x * x + y * y, 0) / u.outer.length); assert.ok(Math.abs(rms - 1) < 1e-9);
  assert.deepEqual(u.centroid.map(Math.round), [100, -40]);
});
test('signature is invariant to rotation, scale, translation and start point', () => {
  const a = signatureOf({ outer: lShape(10), holes: [] });
  const moved = rot(lShape(30), 37).map(([x, y]) => [x + 500, y - 200]);
  const rolled = [...moved.slice(2), ...moved.slice(0, 2)];
  const b = signatureOf({ outer: rolled, holes: [] });
  assert.equal(a.length, 24); assert.ok(signatureDistance(a, b) < 0.02, `distance ${signatureDistance(a, b)}`);
});
test('mirror images are equal by design', () => {
  const a = signatureOf({ outer: lShape(10), holes: [] }); const b = signatureOf({ outer: lShape(10).map(([x, y]) => [-x, y]), holes: [] });
  assert.ok(signatureDistance(a, b) < 0.02);
});
test('different shapes are far apart', () => {
  const d1 = signatureDistance(signatureOf({ outer: sq(10), holes: [] }), signatureOf({ outer: circle(5), holes: [] }));
  const d2 = signatureDistance(signatureOf({ outer: lShape(10), holes: [] }), signatureOf({ outer: sq(10), holes: [] }));
  assert.ok(d1 > 0.1 && d2 > 0.1, `${d1} ${d2}`);
});
test('holes change the last three signature terms only', () => {
  const a = signatureOf({ outer: sq(10), holes: [] }); const b = signatureOf({ outer: sq(10), holes: [sq(4)] });
  assert.deepEqual(a.slice(0, 21), b.slice(0, 21)); assert.ok(b[22] > a[22] && b[23] > a[23]);
});
test('shapeStats: area, solidity, aspect ratio, hole count, ccd', () => {
  const s = shapeStats({ outer: lShape(10), holes: [sq(1, 1, 1)] });
  assert.ok(Math.abs(s.area - 51) < 1e-9); assert.equal(s.holeCount, 1); assert.ok(s.solidity < 1 && s.solidity > 0.5);
  assert.ok(Math.abs(s.ccd - Math.hypot(10, 10)) < 1e-6); assert.ok(s.aspectRatio >= 1);
});
```

- [ ] **Step 3: Run** `node --test server/services/profileShape.test.cjs` → FAIL (module not found).

- [ ] **Step 4: Implement `server/services/profileShape.cjs`.** Fourier terms: `r_i = |p_i − centroid|` over the 128 resampled points, `R_k = |Σ r_i e^{−2πi k i/128}|` for k = 1…20, divided by `R_0 = Σ r_i`; sign conventions do not matter. The aspect ratio uses the 2 × 2 covariance of the resampled points (eigenvalues λ₁ ≥ λ₂, ratio √(λ₁/λ₂)). `solidity` and `holeArea` use `polygonArea` from Plan 2.

- [ ] **Step 5: Run** the tests → PASS (8). **Step 6: Commit** `feat(profiles): shape normalisation, Fourier signature and stats` (plus the plan file).

---

### Task 2: Raster picture → shape

**Files:**
- Create: `server/services/profileRaster.cjs`
- Create fixtures: `server/services/fixtures/profiles/gex1-row16262-hollow.gif`, `gex1-row18681-hollow.gif`, `gex1-row2069-solid-outline.gif` (copy from the scratchpad `C:\Users\vijee\AppData\Local\Temp\claude\7190430abec70768\aaba689e-9d4d-4f6c-83c8-f4577366726e\scratchpad\imgcheck\row16262_image13050.gif`, `row18681_image14919.gif`, `row2069_image1593.gif`; if gone, re-extract `xl/media/image13050.gif`, `image14919.gif`, `image1593.gif` from the workbook zip)
- Modify: `package.json` (`@napi-rs/canvas` `0.1.80` under `dependencies`; run `npm install` — no download expected)
- Test: `server/services/profileRaster.test.cjs`

**Interfaces:**
- Consumes: `rasterTrace.cjs` (`toGray`, `otsuThreshold`, `inkMask`, `closeMask`, `enclosedRegions`, `traceBoundary`, `simplify`), Task 1.
- Produces:
  - `decodeImage(buffer) → Promise<{ data: Uint8ClampedArray (RGBA), width, height }>` via `@napi-rs/canvas` `loadImage`, drawn onto a canvas pre-filled white (GIF transparency becomes white) and read back with `getImageData` (GIF and PNG).
  - `shapeFromImage(image, { expectHollow = null } = {}) → { outer: Array<[x,y]> (px, y up), holes: Array<Array<[x,y]>>, style: 'silhouette'|'outline', inkFraction: number, strokeWidthPx: number, holeCount: number, needsReview: boolean, reviewReason: string|null, pxBbox: {width,height} } | null` (null when no ink component of at least 2 % of the image area exists).

- [ ] **Step 1: Write the failing tests**

```js
const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'profiles', n));
test('silhouette hollow section: one closed cavity, style silhouette, no review flag', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row16262-hollow.gif')), { expectHollow: true });
  assert.equal(r.style, 'silhouette'); assert.equal(r.holeCount, 1); assert.equal(r.needsReview, false);
  const b = bbox(r.outer); assert.ok(b.height > b.width && b.height > 300, `${b.width}x${b.height}`); // 902x501 picture, the section stands upright
});
test('silhouette multi-cavity section keeps every closed cavity', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row18681-hollow.gif')), { expectHollow: true });
  assert.equal(r.style, 'silhouette'); assert.ok(r.holeCount >= 2); assert.equal(r.needsReview, false);
});
test('outline-style solid section has no holes', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row2069-solid-outline.gif')), { expectHollow: false });
  assert.equal(r.style, 'outline'); assert.equal(r.holeCount, 0); assert.equal(r.needsReview, false);
});
test('verdict disagreement sets needsReview with a reason', async () => {
  const r = shapeFromImage(await decodeImage(fixture('gex1-row16262-hollow.gif')), { expectHollow: false });
  assert.equal(r.needsReview, true); assert.match(r.reviewReason, /hollow|cavity/i);
});
test('synthetic silhouette ring: outer is the outside boundary, one hole, y grows upward', () => {
  const img = ring(200, 200, 80, 40); // helper paints a filled annulus
  const r = shapeFromImage(img);
  assert.equal(r.holeCount, 1); assert.ok(Math.abs(bbox(r.outer).width - 160) <= 3); assert.ok(Math.abs(bbox(r.holes[0]).width - 80) <= 3);
  assert.ok(r.outer.some(([, y]) => y < 0) && r.outer.every(([, y]) => y <= 0)); // pixel rows negated
});
test('synthetic outline square with an inner outline square is a hollow drawn in outline style', () => {
  const img = strokedSquares(300, 300, 200, 120, 3); // two concentric 3 px strokes
  const r = shapeFromImage(img, { expectHollow: true });
  assert.equal(r.style, 'outline'); assert.equal(r.holeCount, 1); assert.equal(r.needsReview, false);
});
test('blank or near-blank image returns null', () => { assert.equal(shapeFromImage(white(100, 60)), null); });
```

- [ ] **Step 2: Run** → FAIL. 

- [ ] **Step 3: Implement.** Pipeline: `toGray` (RGBA → grey; alpha-blend on white first, GIF transparency is common) → `otsuThreshold` → `inkMask` → `closeMask(3)` → connected components of ink (reuse Plan 2's labelling in `enclosedRegions` or a small 8-connected labeller here) → the largest ink component whose bbox is under 95 % of the image in both dimensions (a picture border is dropped) → **outer** = `traceBoundary` of the component's filled silhouette (component ∪ all white regions it encloses), `simplify(1)`; **enclosed white regions** inside it with area ≥ 1 % of the outer area → candidate holes, each with its nesting depth (1 = directly inside the ink component). **Style:** `strokeWidthPx` = median over ink pixels of the distance to the nearest non-ink pixel (two erosion passes suffice: count how many 3 × 3 erosions remove half the ink; width ≈ 2 × passes + 1); `inkFraction` = ink pixels ÷ outer area; `style = 'outline'` when `strokeWidthPx ≤ 0.04 × min(outer bbox side)` **and** the largest enclosed white region ≥ 50 % of the outer area, else `'silhouette'`. **Holes:** silhouette → regions at depth 1; outline → regions at even depth (2, 4…), their boundaries traced on the enclosing stroke's inner edge. **Review rule** (`expectHollow` given): `needsReview = (holeCount > 0) !== expectHollow` with `reviewReason` `'image shows a hollow section but the sheet says solid'` or the converse; also `needsReview` when `inkFraction < 0.02` (`'image nearly blank'`). Return `null` when no component passes.

- [ ] **Step 4: Run** → PASS (7). Add the `@napi-rs/canvas` dependency line and confirm `npm ls @napi-rs/canvas` shows it as direct. **Step 5: Commit** `feat(profiles): raster picture to shape — silhouette and outline styles, holes, review rule`.

---

### Task 3: Schema — `profile_shapes`, storage path helper, zip reader

**Files:**
- Modify: `init.sql` (after `die_tooling_links`), `server/db.cjs` (same place), `server/services/toolingSchema.test.cjs` (add `profile_shapes` to the table loop + one constraint test)
- Create: `server/services/zipReader.cjs`, `server/services/zipReader.test.cjs`
- Modify: `server/services/toolingDrawings.cjs` (add `profileImagePath(sha256, ext)`), its test

**Interfaces:**
- Produces:
  - Table `profile_shapes`: `id SERIAL PRIMARY KEY`, `die_no TEXT NOT NULL`, `plant TEXT NOT NULL`, `profile_number TEXT`, `source TEXT NOT NULL CHECK (source IN ('image-check-xlsx', 'order-pdf', 'profile-drawing', 'manual'))`, `source_ref TEXT` (xlsx `GEX1!E1234`, order id, file sha), `image_sha TEXT`, `image_path TEXT`, `style TEXT` (`silhouette`/`outline`/`vector`), `outer_unit JSONB NOT NULL`, `holes_unit JSONB NOT NULL DEFAULT '[]'`, `signature JSONB NOT NULL`, `hole_count INTEGER NOT NULL`, `cavities INTEGER`, `die_type TEXT`, `aspect_ratio NUMERIC`, `solidity NUMERIC`, `true_size BOOLEAN NOT NULL DEFAULT FALSE`, `outer_mm JSONB`, `holes_mm JSONB`, `ccd_mm NUMERIC`, `true_size_source TEXT`, `true_size_confidence TEXT`, `needs_review BOOLEAN NOT NULL DEFAULT FALSE`, `review_reason TEXT`, `reviewed_by INTEGER REFERENCES users(id)`, `reviewed_at TIMESTAMP`, `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `UNIQUE (die_no, plant, source, source_ref)`; indexes on `(plant, die_no)` and `(plant, hole_count)`.
  - `zipReader.cjs`: `listEntries(buffer) → Array<{ name, method: 0|8, compressedSize, size, localHeaderOffset }>` (central directory, no ZIP64 — the workbook has 20k entries and is under 4 GB), `readEntry(buffer, entry) → Buffer` (stored or `zlib.inflateRawSync`), `openZip(filePath) → { entries: Map<name, entry>, read(name) → Buffer }` reading the file once into memory.
  - `toolingDrawings.profileImagePath(sha256, ext) → 'profiles/<sha[0..2]>/<sha>.<ext>'`.

- [ ] **Step 1: Failing tests.** Schema test additions as in Plan 2's pattern (`for (const table of [..., 'profile_shapes'])`; a test that `profile_shapes` has the `source` CHECK and the UNIQUE line). Zip tests: build a zip in the test with two entries (one stored, one deflated via `zlib.deflateRawSync`) by writing local headers, central directory and end record by hand (a 40-line helper), then `listEntries` → both names with the right `method`/`size`, `readEntry` → original bytes; `openZip` on a temp file → `read('b.txt')`. Path helper test: `profileImagePath('abcdef…', 'gif') === 'profiles/ab/abcdef….gif'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (SQL in both files; `zipReader.cjs` with `Buffer.readUInt32LE` parsing: EOCD signature `0x06054b50`, central dir `0x02014b50`, local header `0x04034b50`; names decoded UTF-8; refuse ZIP64 markers with a clear error). **Step 4: Run** → PASS; rebuild the test-server backend from the worktree and confirm `\d profile_shapes`. **Step 5: Commit** `feat(profiles): profile_shapes table, zip reader, profile image path`.

---

### Task 4: Image-check workbook → profile bundle (PC side)

**Files:**
- Create: `server/services/imageCheckWorkbook.cjs`, `server/services/profileBundle.cjs` (build half), `server/scripts/build-profile-bundle.cjs`
- Test: `server/services/imageCheckWorkbook.test.cjs`, `server/services/profileBundle.test.cjs`

**Interfaces:**
- Consumes: Task 3 `openZip`; Task 2 `decodeImage`, `shapeFromImage`; Task 1 `toUnitFrame`, `signatureOf`, `shapeStats`; `sha256Of`, `profileImagePath`.
- Produces:
  - `imageCheckWorkbook.cjs`: `readSheetIndex(zip) → Map<sheetName, { sheetPath, drawingPath|null }>` (via `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/_rels/sheetN.xml.rels`); `readSharedStrings(zip) → string[]`; `readRows(zip, sheetPath, sharedStrings) → Iterable<{ row: number, cells: Record<col, string> }>` (regex over `<row>`…`</row>`, shared-string and inline-string cells resolved, numbers as text); `readPictureAnchors(zip, drawingPath) → Array<{ row: number (1-based sheet row), mediaPath: 'xl/media/imageN.gif', name }>`; `parseGex1Row(cells) → { profileNumber, dieNo, dieType, verdict, note }`, `parseGex2Row(cells) → { profileNumber, dieNo, dieType, status }`; `reviewFromNote(note) → { needsReview: boolean, reason: string|null }` (`Mismatch…` → true with the note; `No image…`/`blank`/`unclear` → true; empty → false).
  - `profileBundle.cjs`: `buildProfileBundle({ zip, sheets: ['GEX1', 'GEX2'], io: { copyBytes(bundleRelPath, buffer), writeJson(name, obj) }, decode = decodeImage, limit = null, onProgress }) → Promise<{ shapes: ShapeRow[], report }>`; `ShapeRow = { die_no, plant, profile_number, source: 'image-check-xlsx', source_ref: 'GEX1!E<row>', image_sha, image_file: 'files/profiles/<..>.gif', style, outer_unit, holes_unit, signature, hole_count, die_type, aspect_ratio, solidity, needs_review, review_reason }`; `report = { rowsSeen, rowsWithPicture, rowsWithoutPicture, picturesDecoded, picturesShared, shapesWritten, needsReview: { verdictMismatch, noteMismatch, noImage, blankOrUnclear, nullShape }, errors: [{ row, error }] }`.
  - Script `build-profile-bundle.cjs --workbook <xlsx> --out <dir> [--sheet GEX1|GEX2] [--limit N] [--dry-run] [--force]` (defaults: the workbook path above; out `C:\Users\vijee\Desktop\18.06.2026\tooling-bundle\profiles-<yyyy-mm-dd>`; refuses an existing `manifest.json` without `--force`), writing `manifest.json { version: 1, kind: 'profile-shapes', createdAt, counts }`, `shapes.json`, `report.json`, `files/profiles/…`.

- [ ] **Step 1: Failing tests.** Workbook tests on a **synthetic xlsx** built in the test with the Task 3 zip helper (workbook.xml with sheets `GEX1`/`GEX2`, rels, a sharedStrings part, a sheet with 4 rows incl. one shared-string cell and one inline string, a drawing with two anchors on rows 2 and 3 pointing at two media entries, one media reused on row 4): `readSheetIndex` maps names → paths, `readRows` yields 4 rows with resolved strings, `readPictureAnchors` returns rows 2, 3, 4 with the right media paths, `parseGex1Row` on `{A:'12555',B:'12555_101',C:'Hollow',F:'Hollow',G:''}` and `reviewFromNote` on the five note shapes. Bundle tests with a fake `zip` (the synthetic one) and a fake `decode` returning the ring image from Task 2's helper: `a shared picture is decoded once and attached to every die` (decode called once for the reused media; two rows share `image_sha` and identical `signature`), `review notes set needs_review`, `rows without a picture are reported not written`, `a row whose verdict disagrees with the traced shape is flagged`, `limit stops after N pictures`, `GEX2 rows carry plant GEX 2 and no verdict`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Row → plant from the sheet (`GEX1` → `GEX 1`); `expectHollow` from the verdict (F) when present else `IDDieType` (C), case-insensitive, `HOLOW`/`SOLD` typos tolerated by prefix; a row with two pictures writes two rows (`source_ref` includes the anchor index: `GEX1!E1234#2`); decode errors are caught per picture and reported. **Step 4: Run** → PASS, then a real smoke: `node server/scripts/build-profile-bundle.cjs --limit 200 --out "C:/Users/vijee/Desktop/18.06.2026/tooling-bundle/profiles-smoke"` — expect ~200 shapes, a handful flagged; paste the report into the task report. **Step 5: Commit** `feat(profiles): image-check workbook reader and profile bundle builder`.

---

### Task 5: Apply the profile bundle (server side) with CCD-scaled true size

**Files:**
- Modify: `server/services/profileBundle.cjs` (apply half), `server/services/profileBundle.test.cjs`
- Create: `server/scripts/apply-profile-bundle.cjs`

**Interfaces:**
- Consumes: Task 1 `minEnclosingCircle`, `shapeStats`; `normalizePlant`; `toolingDrawings.getRoot/absolutePath`.
- Produces:
  - `readProfileBundle(dir, fsLike) → { manifest, shapes, report }` (version 1, kind `profile-shapes`).
  - `trueSizeFromCcd({ outer_unit, holes_unit }, ccdMm) → { outer_mm, holes_mm, ccd_mm, source: 'ccd-scaled', confidence: 'likely' }` — scale factor = `ccdMm / minEnclosingCircle(outer_unit).diameter`.
  - `applyProfileBundle(client, bundle, { root, io: { copyFile, mkdirp, exists }, dryRun = false, log }) → { inserted, updated, unchanged, skippedReviewed, filesCopied, trueSized, dieListMisses }`. Per shape: look up the die list row `SELECT cavity, die_type, profile_number, raw_data->>'ProfileCCD' AS ccd FROM existing_die_details WHERE die_no = $1 AND plant = ANY($2)` (`$2` = the stored spellings for the plant: `['GEX 1','GEX 01']` / `['GEX 2']`); `cavities` = die list cavity when present; `image_path` = the bundle's `image_file` without its `files/` prefix (so it equals `profileImagePath(sha, ext)`); when the die list CCD is numeric and ≥ 20, fill the mm columns with `trueSizeFromCcd`; upsert on `(die_no, plant, source, source_ref)` with `ON CONFLICT DO UPDATE SET … WHERE profile_shapes.reviewed_at IS NULL` (a cleared row is left alone and counted `skippedReviewed`); copy the picture to `absolutePath(root, image_path)` when missing; one transaction; dry run rolls back.
  - Script `apply-profile-bundle.cjs <bundleDir> [--dry-run]`.

- [ ] **Step 1: Failing tests** (fake client as in Plan 2): `inserts a shape and fills true size from the die list CCD` (params carry `outer_mm`, `ccd_mm` 123.4, `true_size true`, `source 'ccd-scaled'`); `a GEX 2 shape without CCD stays not true size`; `a reviewed row keeps its cleared flag` (`rowCount 0` → `skippedReviewed`); `dry run rolls back and copies nothing`; `die list miss is counted and the row still inserted`; `trueSizeFromCcd scales so the enclosing circle equals the CCD` (unit ring → 200 mm → `ccd_mm` 200 ± 1e-6).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; apply the smoke bundle on the test server (`docker cp` → `/tmp/profile-smoke`; dry run, live, live again → `unchanged` equals the shape count); verify `select true_size, needs_review, count(*) from profile_shapes group by 1,2`. **Step 5: Commit** `feat(profiles): apply-profile-bundle — idempotent upsert, CCD-scaled true size`.

---

### Task 6: Order-PDF profiles — shape from the posted PNG, true size from the stated scale

**Files:**
- Create: `server/services/orderProfileShape.cjs`, `server/services/orderProfileShape.test.cjs`
- Modify: `server/routes/orders.cjs` (the `POST /:id/profile-image` handler), `server/routes/orders.files.test.cjs`
- Modify: `src/utils/pdfImportFields.js` (+ test), `src/components/modals/PDFImportModal.jsx`, `src/hooks/usePIImport.js`, `src/api.js` (`uploadProfileImage` gains an optional `meta` object sent as form fields), `src/api.test.js`

**Interfaces:**
- Produces (client): `readScales(lines) → number[]` — every `SCALE a:b` / `Scale a:b` on page 1 as the ratio `b / a` (drawing mm per sheet mm: `1:1 → 1`, `3:1 → 1/3`, `3:2 → 2/3`), **main scale first** (the one written in capitals `SCALE` with the lowest y on the page, i.e. the title block; fall back to the first found); `readTitleBlockNumbers(lines) → { ccd, externalPerimeter, internalPerimeter }` (the number that follows the label on the same line, else null). `uploadProfileImage(id, blob, fileName, meta)` appends `renderDpi`, `scales` (JSON), `ccdStated`, `externalPerimeter`, `internalPerimeter`, `cavities`, `dieSize` as text fields.
- Produces (server): `orderProfileShape.cjs`: `shapeFromProfilePng(buffer, meta) → Promise<ShapeRowFields>` where `ShapeRowFields = { style, outer_unit, holes_unit, signature, hole_count, aspect_ratio, solidity, true_size, outer_mm, holes_mm, ccd_mm, true_size_source, true_size_confidence, needs_review, review_reason }`; `chooseScale({ pxCcd, renderDpi, scales, dieListCcd, dieSize }) → { mmPerPx, scale, source, confidence } | null` — `mmPerPx(scale) = 25.4 / renderDpi × scale`; candidates = `scales`; with a die-list CCD: the candidate whose `pxCcd × mmPerPx` is within 3 % of it → `confirmed`; none within 3 % → null; without a die-list CCD: the main scale when the resulting CCD is at least 40 mm smaller than the die diameter parsed from `dieSize` (`DIA320X160` → 320) → `likely`, else null. `recordOrderProfileShape(client, { orderId, dieNo, plant, profileNumber, imageSha, imagePath, fields }) → Promise<void>` upserting `profile_shapes` with `source 'order-pdf'`, `source_ref = String(orderId)`.
- Route: after the PNG is stored, call `shapeFromProfilePng` and `recordOrderProfileShape` in a try/catch (a shape failure never fails the upload; it logs and the response gains `shape: { ok: false, error }` or `shape: { ok: true, trueSize, holeCount }`).

- [ ] **Step 1: Failing tests.** Client: `readScales` on the lines of the 030724 sample (`SCALE 1:1`, `Scale 3:1`, `SCALE 3:2`) → `[1, 1/3, 2/3]` with 1 first (`the main view scale wins over detail scales`); `readTitleBlockNumbers` on `'CCD 183.2 No. of cavities 2'` → `ccd 183.2` and on the blank form → all null; `uploadProfileImage` form fields present. Server: `chooseScale` — `no scale agrees with the die list CCD → not true size` (pxCcd 1000, dpi 200, scales [1, 2/3], dieListCcd 90 → null; 127 → confirmed with scale 1); `without a die-list CCD the main scale is likely when it fits the die` (pxCcd 1000 → 127 mm vs DIA320 → likely; vs DIA150 → null); `shapeFromProfilePng` on a PNG of the Task 2 ring (encode with `@napi-rs/canvas` in the test) → `hole_count 1`, `outer_unit` RMS radius 1, `signature.length 24`, `true_size true` with meta `{ renderDpi: 200, scales: [1], dieListCcd: null, dieSize: 'DIA320X160' }`; route test: posting a PNG now writes a `profile_shapes` row (fake db sees `INSERT INTO profile_shapes`) and a thrown shape error still returns 200 with `shape.ok false`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** The route reads the die list CCD with the same query as Task 5 for `dieListCcd`; `cavities` from `meta.cavities` else the order's; `die_type` from the order when present. **Step 4: Run** → PASS; smoke on the Vite dev server is Plan 5's job — here, smoke the route on the test server by re-posting one stored profile PNG (`/app/storage/order-files/120658-803/666/profile_image/…png`) through the API with a 10-minute admin JWT minted inside the container and `renderDpi=200&scales=[1]&dieSize=DIA320X160`, then `select die_no, true_size, hole_count, ccd_mm from profile_shapes where source='order-pdf'`. **Step 5: Commit** `feat(profiles): order-PDF profile shape from the posted PNG, true size from the stated scale`.

---

### Task 7: Similarity service and read API

**Files:**
- Create: `server/services/profileSimilarity.cjs`, `server/services/profileSimilarity.test.cjs`, `server/routes/profile-shapes.cjs`, `server/routes/profile-shapes.test.cjs`
- Modify: `server/index.cjs` (mount `/api/profile-shapes` behind `authMiddleware`), `src/api.js` (`profileShapesAPI { forDie, similar, similarTo }`), `src/api.test.js`

**Interfaces:**
- Produces:
  - `profileSimilarity.cjs`: `loadIndex(client, { plant }) → Index` (`SELECT id, die_no, plant, profile_number, signature, hole_count, cavities, true_size, updated_at FROM profile_shapes WHERE plant = $1 AND needs_review = false`), cached per plant in module memory and refreshed when `SELECT max(updated_at), count(*)` differs from the cached stamp (cheap check per request); `nearest(index, { signature, holeCount, cavities = null, limit = 20, excludeDieNo = null }) → Array<{ die_no, profile_number, distance, cavityMatch, trueSize, shapeId }>` (same `hole_count` only; distance ascending; one entry per `die_no` — the best of its rows); `invalidate(plant)`.
  - Routes (all auth): `GET /api/profile-shapes/:dieNo?plant=` → `{ shapes: Array<row without signature>, hasTrueSize }`; `GET /api/profile-shapes/:dieNo/similar?plant=&limit=` → `{ items }` using the die's newest row's signature; `POST /api/profile-shapes/similar` body `{ plant, outer, holes?, cavities?, limit? }` (unit or any-frame polygon; the server normalises and signs it) → `{ items, signature }`; `GET /api/profile-shapes/:dieNo/image/:shapeId` → `res.download` of the stored picture (404 outside root or missing). Register the literal `/similar` POST before the `/:dieNo` routes.
  - Client: `profileShapesAPI.forDie(dieNo, plant)`, `.similar(dieNo, { plant, limit })`, `.similarTo({ plant, outer, holes, cavities, limit })`.

- [ ] **Step 1: Failing tests.** Service: `nearest returns same-hole-count shapes by ascending distance, one per die` (index of 6 fake rows: two rows for one die, the better one wins), `needs_review rows are never returned` (the loader query carries `needs_review = false` and a flagged row injected into the fake result is still filtered), `cavityMatch is reported, not filtered`, `the cache refreshes when the stamp changes` (fake client counts queries). Routes (fake db + `listen/request`): `forDie strips the signature`, `similar uses the newest row`, `POST similar normalises an arbitrary-frame polygon` (a 10× scaled, translated square gives the same signature as the unit square), `image download refuses a path outside the root`, `POST /similar is reachable (not swallowed by /:dieNo)`. Client test: paths and bodies.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; rebuild the backend and smoke `GET /api/profile-shapes/<a smoke die>/similar?plant=GEX%201&limit=5` with the admin JWT. **Step 5: Commit** `feat(profiles): similarity index and profile-shapes API`.

---

### Task 8: Full import on the test server and the runbook

**Files:**
- Create: `docs/profile-library-import-runbook.md`
- Modify: `docs/tooling-geometry-import-runbook.md` (one "Next: profiles" pointer line)

- [ ] **Step 1:** Build the full bundle (`build-profile-bundle.cjs` with defaults, no limit; expect ~26,500 shapes from 19,976 pictures, several minutes; background and wait). Record the report: rows seen per sheet, pictures decoded, shared, shapes written, `needsReview` breakdown, errors.
- [ ] **Step 2:** `docker cp` to `/tmp/profile-bundle`; `apply-profile-bundle.cjs --dry-run`, live, live again (idempotent: second run `unchanged` = all). Verification queries:

```sql
select plant, source, true_size, needs_review, count(*) from profile_shapes group by 1,2,3,4 order by 1,2,3,4;
select plant, count(*) filter (where true_size) sized, count(*) total, round(avg(ccd_mm) filter (where true_size)) avg_ccd from profile_shapes group by 1;
select hole_count, count(*) from profile_shapes group by 1 order by 1;
select die_no, review_reason from profile_shapes where needs_review and plant = 'GEX 1' limit 20;
```

Expected shape: GEX 1 ~25,000 shapes, ~94 % true-sized from CCD, a few hundred `needs_review` (the sheet's 357 notes plus trace disagreements); GEX 2 ~1,500 shapes, none true-sized.

- [ ] **Step 3:** Spot-check similarity: pick three GEX 1 dies with distinctive shapes and call `GET /api/profile-shapes/<die>/similar?plant=GEX%201&limit=8`; record whether the top results look like the query (compare their pictures with the image route). Record the request time (expect well under 300 ms warm).
- [ ] **Step 4:** Write the runbook: prerequisites (`@napi-rs/canvas`, the workbook path), the two commands with defaults and the `docker cp` step, re-run behaviour (idempotent; a cleared review flag is kept), the order-PDF path (what the import now stores and when it is true size), verification queries, the review vocabulary, known gaps (GEX 2 has no CCD so nothing is true-sized until order PDFs arrive; outline-style hollow pictures are the weakest; pictures with dimension lines; the 125 rows without pictures; the `Profiles` sheets ignored), and the production procedure. Add the pointer line to the geometry runbook.
- [ ] **Step 5:** `npm test`, commit `docs(profiles): profile library import runbook with test-server results`.

---

## Self-review notes

- Spec coverage for this plan's slice: `profile_shapes` with die/profile number, plant, unit-frame outline(s), signature, hole and cavity counts, true-size flag + mm outline, source and `needs_review` (Task 3); seeded by the image-check import (Tasks 4–5) and extended by every order-PDF import (Task 6); newest true-size row wins for fit (Task 7's `forDie` orders rows newest first and exposes `hasTrueSize`; Plan 4 picks the newest `true_size` row); all rows feed similarity except `needs_review` (Task 7); `import-profile-images` (Task 4 + 5 as a bundle, same pattern as Plan 2); "Image-check pictures with dimension lines: trace all, keep the largest closed shape, flag when solidity/hole count disagrees with the verdict" (Task 2's largest-component rule and review rule); "Similarity N: the API returns 20" (Task 7 default limit); signature "rotation-, scale- and translation-invariant and cheap against ~30,000 shapes" (Task 1 + the in-memory index).
- Deliberately out of scope: the `profile-drawing` source (a drawing picked in the new form) — the table and services accept it, Plan 5 produces it; the UI strip and pictures (Plan 5); the fit route and overlay (Plan 4); clearing `needs_review` (Plan 5's review queue; the columns exist).
- My calls to check while reading: the signature descriptor (Fourier magnitudes of the centroid-distance function + four shape terms) and the 3 % CCD agreement rule; `@napi-rs/canvas` promoted to a direct dependency; the minimal zip reader instead of SheetJS for the 167 MB workbook; true size for GEX-1 workbook shapes from the die list CCD at `likely`; the outline-style hole rule (even nesting depth); the `Profiles` sheets ignored (no pictures); pictures stored under the tooling storage root.
