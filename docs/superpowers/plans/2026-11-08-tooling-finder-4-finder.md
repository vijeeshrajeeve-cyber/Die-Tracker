# Tooling Finder, Plan 4 of 5: The Finder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a new die's true-size profile, press, die size, plant and cavity count, return the ranked list of in-scope inserts and bolsters whose every pocket the profile fits with at least 5 mm clearance and whose size the combination chart allows — plus the similar-profile dies and their toolings — through one API that Plan 5's form will call.

**Architecture:** Two pure modules under `server/services/`: `fitGeometry.cjs` (place one polygon inside another: signed-distance grid for the search, exact segment distances for the verdict, rotation + translation search) and `toolingFinder.cjs` (candidate index cached per plant, narrowing by scope/cavities/geometry confidence/chart/cheap size pre-filters, fit per tooling across all its pockets, ranking, enrichment). One orchestration function wires them to the database and to Plan 3's similarity index, exposed as `POST /api/toolings/find`. A backfill script gives orders that already had a profile picture their shape row (a Plan 3 gap), and a corpus check runs the fit over every die → insert link the die lists already know, which is the finder's acceptance test on real data.

**Tech Stack:** Node 20 CommonJS (`.cjs`), Express 5, Postgres via `pg`, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-tooling-finder-design.md` — part 5 "The finder" is this plan's slice; "My calls" (rotation, clearance cap, plant separation, mixed ranking, unknown numbers) and "Left to the builder" (offset/containment/rotation search) bind it.

## What Plans 1–3 give the finder (facts the tasks rely on)

- **`toolings`** (`number`, `kind` insert|bolster, `plant` `GEX 1`|`GEX 2`, `held_presses TEXT[]` canonical `PRESS n`, `size_class` `DDDXTTT` or NULL, `size_class_confidence`, `cavities`, `location`, `status` active|retired|unverified) and **`tooling_openings`** (`tooling_id` UNIQUE, `outer_outline` JSONB, `pockets` JSONB `[[[x,y],…],…]` in **mm, outer bbox centre at (0,0), y up**, `pocket_gap_mm`, `confidence` confirmed|likely|uncertain|none, `extraction_meta`). Test server, active with confidence ≠ none: GEX 1 1,007 inserts (602 one-cavity, 96 two, 22 four, 278 cavities NULL) + 6 bolsters; GEX 2 196 inserts + 49 bolsters. Pockets average 95 points (max 1,128).
- **`tooling_combinations`** (`press` canonical, `die_size` normalised e.g. `250X160`, `insert_size`, `bolster_size`, companions, `remark`); `toolingChart.chartVerdict(rows, { press, dieSize, kind, sizeClass }) → { verdict: 'allowed'|'not_allowed'|'no_chart', rows }` (HOLD rows never allowed; `no_chart` when the press has no rows at all — GEX 2 presses 7/8 today). `toolingNumbers.normalizeSizeClass(raw)`. `server/routes/toolings.cjs` has `normalizePress(raw)` (async, uses the presses master; `P5`/`5`/`PRESS 5` → `PRESS 5`) and mounts `GET /`, `/combinations`, `/review-queue`, `/:number`, `/:number/drawings/:id/file`; client `toolingsAPI` in `src/api.js` ~:974.
- **`die_tooling_links`** (`die_no`, `plant`, `tooling_number`, `kind`, `source`); 10,538 dies linked to active toolings on the test server. **3,932 distinct (die, insert) pairs** have a true-size profile on the die side and a confirmed/likely opening on the insert side (confirmed 248 dies, likely 3,684, uncertain 1,830) — the corpus for Task 5. In a random sample of those pairs the die list's cavity count often differs from the insert's pocket count (e.g. a 4-cavity die linked to a 1-pocket insert): the check must report cavity agreement separately from fit.
- **`profile_shapes`** (`die_no`, `plant`, `outer_unit`/`holes_unit`, `signature` 24 numbers, `hole_count`, `cavities`, `true_size`, `outer_mm`/`holes_mm` in **mm, outer centroid at (0,0), y up**, `ccd_mm`, `true_size_source`/`_confidence`, `needs_review`); GEX 1 20,939 true-sized rows (avg 74 points), GEX 2 none from the workbook and 2 from order PDFs. `profileShape.cjs`: `toUnitFrame`, `signatureOf({ outer, holes })`, `shapeStats` (`area, holeArea, solidity, aspectRatio, holeCount, ccd`), `minEnclosingCircle`, `resampleByArcLength`, `convexHull`. `profileSimilarity.cjs`: `loadIndex(client, { plant })` (cached by stamp), `nearest(index, { signature, holeCount, cavities, limit, excludeDieNo }) → [{ die_no, profile_number, distance, cavityMatch, trueSize, shapeId }]`. `openingGeometry.cjs`: `polygonArea`, `centroid`, `bbox` (`{ minX, minY, maxX, maxY, width, height, cx, cy }`), `pointInPolygon`, `polygonContains`.
- **Order-PDF path** (Plan 3 Task 6): `orderProfileShape.cjs` exports `chooseScale`, `dieDiameterOf`, `shapeFromProfilePng(buffer, meta)`, `metaFromForm`, `readDieListCcd(client, dieNo, plant)`, `recordOrderProfileShape(client, { orderId, dieNo, plant, profileNumber, imageSha, imagePath, dieType, cavities, fields })`. The route only traces a *new* picture: an order that already had one answers `{ kept: true }` and gets no shape row. Stored pictures: `die_order_files` slot `profile_image`, `stored_path` relative to `orderFiles.getRoot()`; the client renders at `PROFILE_RENDER_DPI = 200` (`src/utils/profileImage.js:16`); all 15 sample drawings state `SCALE 1:1` for the main view. Test server has 4 stored pictures; production has more.
- Scripts follow Plan 2/3: `flag('--name')`, `--dry-run`, one transaction, `pool` opened after validation, `pool.end()` in `finally`, a JSON result printed last. Test-server recipe: rebuild `docker compose -p die-tracker --env-file ../../../.env build backend`, up `docker compose -p die-tracker -f docker-compose.yml --project-directory ../../.. up -d --wait backend`, scripts via `MSYS_NO_PATHCONV=1 docker exec -w /app die-ordering-backend node server/scripts/<script>`, psql via `MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering`, API smoke with a 10-minute admin JWT minted inside the container (`jsonwebtoken` + `process.env.JWT_SECRET`; never print it).

## Global Constraints

- Server code is CommonJS in `server/**/*.cjs`; tests `*.test.cjs` beside the module, run by `npm test` (baseline on main 8f5ad81: 1393 pass / 2 skipped). Client code ESM under `src/`. **No new npm dependencies.**
- Polygons are `Array<[x, y]>` in millimetres with no repeated closing point, y up. Pockets are in the tooling frame (outer bbox centre at (0,0)); profiles are in the profile frame (outer centroid at (0,0)). A **placement** is `{ theta, tx, ty }`: the profile rotated by `theta` radians about its own origin, then translated by `(tx, ty)` into the pocket frame. **Any rotation is allowed; mirroring is not.**
- **Gate one:** a profile fits a pocket when every point of the resampled profile outline lies inside the pocket polygon at a distance ≥ **5 mm** (`MIN_CLEARANCE_MM = 5`) from the pocket boundary. **Clearance** = the largest such minimum distance over all placements searched; reported exactly (segment distances), never from the grid alone. Clearance above **50 mm** is reported as `clearance: 50, clearanceCapped: true` and ranks last among passes.
- **Gate two:** `chartVerdict` over the press's `tooling_combinations` rows with the tooling's `kind` and `size_class`; `allowed` passes; `not_allowed` fails (reason `chart`); a NULL `size_class` fails with reason `no-size-class`; `no_chart` (press has no rows) neither passes nor fails: candidates are still fitted and every result carries `chartVerdict: 'no_chart'` so the UI can warn.
- **Narrowing** (in this order, each rejection counted by reason): same `plant`; `status = 'active'`; `cavities` equal to the query's (NULL cavities rejected, reason `cavities-unknown`); opening `confidence ≠ 'none'` and pockets present; gate two; cheap size pre-filters: pocket area ≥ profile area + 5 × profile perimeter + 25π, and pocket bbox diagonal ≥ profile CCD + 10 (each pocket).
- **Ranking:** passes sort by clearance ascending (capped last), then total pocket area ascending, then confidence confirmed < likely < uncertain, then `number`.
- **Held press is not a gate:** every candidate reports `needsTransfer`: `true` when `held_presses` is non-empty and does not contain the query press, `false` when it does, `null` when `held_presses` is empty (location unknown).
- Plant separation: GEX 1 toolings are never candidates for GEX 2 queries and vice versa.
- Scripts are idempotent, take `--dry-run`, print what they will do first, never run an unscoped `DELETE`, never touch `toolings.status` or review fields.
- Commit after every task; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A profile that fits only when rotated (a 120 × 40 bar in a 60 × 140 pocket) must be found with ≈ 10 mm clearance — Task 1 test `a bar that only fits rotated is placed at 90°`.
2. Pockets are not centred on the origin (a two-cavity insert's pockets sit at ± gap/2) — the search must start from the pocket, not from (0,0) — Task 1 test `a pocket away from the origin is found` and Task 2 test `two-cavity insert: both pockets must fit and the clearance is the smaller`.
3. GEX 2 presses 7/8 have no chart rows: the finder must still fit and flag `no_chart`, not return an empty list silently — Task 3 test `no chart rows: candidates are fitted and flagged no_chart`.
4. An insert held at another press is suggested with `needsTransfer: true`, never dropped — Task 3 test `held at another press is a note, not a gate`.
5. A tooling with a NULL size class never passes gate two silently — Task 2 test `NULL size class fails gate two with reason no-size-class`.

---

### Task 1: Fit geometry — place one polygon inside another

**Files:**
- Create: `server/services/fitGeometry.cjs`, `server/services/fitGeometry.test.cjs`
- Commit also: this plan

**Interfaces:**
- Consumes: `pointInPolygon`, `bbox`, `centroid`, `polygonArea` from `openingGeometry.cjs`. (`profileShape.resampleByArcLength` is not reused: it drops vertices, and corners are exactly the points that touch a pocket wall first.)
- Produces:
  - `resampleClosed(points, stepMm = 2) → Array<[x, y]>` — every original vertex kept, extra points inserted so no two consecutive points are more than `stepMm` apart.
  - `boundaryDistance(p, polygon) → number` — min distance from `p` to the polygon's segments (unsigned).
  - `signedDistanceGrid(polygon, { cellMm = 2, marginMm = 6 }) → { x0, y0, cell, nx, ny, data: Float32Array }` — `data[j * nx + i]` = +distance inside, −distance outside, for the cell centre `(x0 + i·cell, y0 + j·cell)`; the grid covers the polygon bbox plus `marginMm`.
  - `sampleGrid(grid, x, y) → number` — bilinear; `-Infinity` outside the grid.
  - `transformPoints(points, { theta, tx, ty }) → Array<[x, y]>`.
  - `gridClearance(points, grid) → number` — min of `sampleGrid` over the points.
  - `exactClearance(points, polygon) → number` — `-boundaryDistance` of the worst outside point when any point is outside (negative), else the min `boundaryDistance` (positive).
  - `bestPlacement(profilePts, pocket, { minClearance = 5, angleStepDeg = 10, cellMm = 2, maxEvaluations = 4000, grid = null }) → { clearance, placement: { theta, tx, ty }, evaluations } | null` — null when no placement reaches `minClearance`. The `clearance` returned is the exact one at the returned placement. `grid` is an optional pre-built `signedDistanceGrid(pocket)`; when absent one is built inside (Task 2 caches grids per pocket and passes them in).

- [ ] **Step 1: Write the failing tests**

```js
const circle = (r, n = 90, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
const rect = (w, h, cx = 0, cy = 0) => [[cx - w/2, cy - h/2], [cx + w/2, cy - h/2], [cx + w/2, cy + h/2], [cx - w/2, cy + h/2]];
const lShape = (s) => [[0,0],[s,0],[s,s*0.3],[s*0.3,s*0.3],[s*0.3,s],[0,s]].map(([x, y]) => [x - s*0.35, y - s*0.35]);

test('resampleClosed keeps vertices and caps the spacing', () => {
  const pts = resampleClosed(rect(100, 40), 2);
  assert.ok(pts.some(([x, y]) => x === 50 && y === 20));
  for (let i = 0; i < pts.length; i++) { const [a, b] = [pts[i], pts[(i + 1) % pts.length]]; assert.ok(Math.hypot(a[0]-b[0], a[1]-b[1]) <= 2 + 1e-9); }
});
test('signed distance grid is positive inside, negative outside, ~0 on the edge', () => {
  const g = signedDistanceGrid(circle(50), { cellMm: 2 });
  assert.ok(Math.abs(sampleGrid(g, 0, 0) - 50) < 1.5); assert.ok(sampleGrid(g, 60, 0) < -8); assert.ok(Math.abs(sampleGrid(g, 50, 0)) < 1.5);
});
test('exactClearance: inside gives the wall distance, outside is negative', () => {
  assert.ok(Math.abs(exactClearance(circle(40), circle(50)) - 10) < 0.1);
  assert.ok(exactClearance(circle(60), circle(50)) < 0);
});
test('a circle in a circle: clearance is the radius gap at any angle', () => {
  const r = bestPlacement(resampleClosed(circle(40)), circle(50));
  assert.ok(Math.abs(r.clearance - 10) < 0.2, String(r.clearance)); assert.ok(Math.hypot(r.placement.tx, r.placement.ty) < 0.5);
});
test('a square in a circle: clearance is (D − diagonal) / 2', () => {
  const r = bestPlacement(resampleClosed(rect(60, 60)), circle(50));
  assert.ok(Math.abs(r.clearance - (50 - 30 * Math.SQRT2)) < 0.3, String(r.clearance));
});
test('a bar that only fits rotated is placed at 90°', () => {
  const r = bestPlacement(resampleClosed(rect(120, 40)), rect(60, 140));
  assert.ok(r, 'must fit'); assert.ok(Math.abs(r.clearance - 10) < 0.3, String(r.clearance));
  const deg = ((r.placement.theta * 180 / Math.PI) % 180 + 180) % 180; assert.ok(Math.abs(deg - 90) < 3, String(deg));
});
test('a pocket away from the origin is found', () => {
  const r = bestPlacement(resampleClosed(circle(30)), circle(40, 90, 200, -50));
  assert.ok(r); assert.ok(Math.abs(r.placement.tx - 200) < 0.5 && Math.abs(r.placement.ty + 50) < 0.5); assert.ok(Math.abs(r.clearance - 10) < 0.2);
});
test('too big or too tight returns null', () => {
  assert.equal(bestPlacement(resampleClosed(circle(48)), circle(50)), null);   // 2 mm < 5 mm
  assert.equal(bestPlacement(resampleClosed(lShape(120)), circle(50)), null);
});
test('a tight non-convex fit: the L-shape in a slightly larger L-shaped pocket', () => {
  // The pocket's arms are 30 mm wide; at 0.6 the profile's arms are 18 mm, so the best clearance is 6 mm.
  const pocket = lShape(100); const profile = resampleClosed(lShape(100).map(([x, y]) => [x * 0.6, y * 0.6]));
  const r = bestPlacement(profile, pocket); assert.ok(r, 'fits'); assert.ok(r.clearance >= 5 && r.clearance < 8, String(r.clearance));
});
test('speed: 150-point profile against a 100-point pocket under 60 ms', () => {
  const profile = resampleClosed(lShape(60), 2); const pocket = circle(60, 100);
  const t0 = performance.now(); bestPlacement(profile, pocket); assert.ok(performance.now() - t0 < 60);
});
```

- [ ] **Step 2: Run** `node --test server/services/fitGeometry.test.cjs` → FAIL (module not found).

- [ ] **Step 3: Implement.** Search in `bestPlacement`: build the grid once; start translations = the grid's maximum cell (deepest point of the pocket) and the pocket centroid; for each angle `0, angleStepDeg, …, 360−step` evaluate `gridClearance` at both starts, keep the best 3 (angle, start) seeds; refine each seed by pattern search over `(tx, ty, theta)` with steps starting at `(4 mm, 4 mm, 4°)` halving down to `(0.25 mm, 0.25 mm, 0.25°)`, maximising `gridClearance` (accept moves that improve by > 1e-6); stop at `maxEvaluations`; take the best seed's placement, compute `exactClearance` there, return null when below `minClearance`. The grid's bilinear value is within ≈ `cellMm / 2` of the truth, so the exact pass at the end is what decides. Resampling step 2 mm keeps a 300 mm perimeter at 150 points.

- [ ] **Step 4: Run** → PASS (10). **Step 5: Commit** `feat(finder): fit geometry — signed-distance search with exact clearance` (plus the plan file).

---

### Task 2: Candidate index, narrowing, fit per tooling, ranking

**Files:**
- Create: `server/services/toolingFinder.cjs`, `server/services/toolingFinder.test.cjs`

**Interfaces:**
- Consumes: Task 1; `chartVerdict` from `toolingChart.cjs`; `shapeStats`, `minEnclosingCircle` from `profileShape.cjs`; `polygonArea`, `bbox` from `openingGeometry.cjs`.
- Produces:
  - `MIN_CLEARANCE_MM = 5`, `CLEARANCE_CAP_MM = 50`, `MAX_FITTED = 400`.
  - `profileStats(outerMm) → { area, perimeter, ccd, bbox }`.
  - `pocketStats(pocket) → { area, perimeter, bbox, diag }` (computed once per cached pocket).
  - `CANDIDATE_SQL` and `loadCandidates(client, { plant }) → Promise<Candidate[]>` — `SELECT t.id, t.number, t.kind, t.plant, t.held_presses, t.size_class, t.size_class_confidence, t.cavities, t.location, t.status, o.pockets, o.confidence, o.pocket_gap_mm FROM toolings t JOIN tooling_openings o ON o.tooling_id = t.id WHERE t.plant = $1 AND t.status = 'active' AND o.confidence <> 'none' AND o.pockets IS NOT NULL`, cached per plant in module memory with a stamp (`SELECT max(GREATEST(t.updated_at, o.updated_at)), count(*) …` same filter), each candidate carrying parsed pockets, their `pocketStats`, and a lazily built grid per pocket (`candidate.grids[i]`, built on first fit, kept with the cache and dropped when the stamp changes; a `Float32Array` at 2 mm cells is ≈ 4 B per cell, a 300 mm pocket ≈ 90 KB, all GEX 1 pockets ≈ 40 MB); `invalidate(plant)`.
  - `narrow(candidates, query, chartRows) → { kept: Candidate[], rejected: Record<reason, number> }` with `query = { plant, press, dieSize, cavities, profile: { area, perimeter, ccd } }`; reasons `cavities`, `cavities-unknown`, `no-size-class`, `chart`, `size-prefilter`; each kept candidate gains `chart: { verdict, rows }` and `needsTransfer: boolean|null`. `kept` is sorted by total pocket area ascending and cut at `MAX_FITTED` (`truncated: true` reported when cut).
  - `candidateFromRow(row) → Candidate` — parses the `pockets` JSON (string or object), computes `pocketStats` per pocket and sets `grids: []`; `loadCandidates` uses it, and Task 5's corpus check calls it on its own SQL rows.
  - `fitCandidate(candidate, profilePts, opts) → { clearance, clearanceCapped, placements: Array<{ pocketIndex, theta, tx, ty, clearance }> } | { reason: 'no-fit', pocketIndex }` — every pocket must fit; `clearance` = min over pockets; capped at 50; builds and stores `candidate.grids[i]` on first use and passes it to `bestPlacement`.
  - `rankCandidates(fitted) → fitted sorted` per the Global Constraints.
  - `confidenceRank = { confirmed: 0, likely: 1, uncertain: 2 }`.

- [ ] **Step 1: Failing tests** (fake candidates built in the test from the synthetic shapes of Task 1; fake client for `loadCandidates` returning rows with JSON pockets and recording queries):
  - `loadCandidates parses pockets, computes pocketStats and caches by stamp` (second call with the same stamp runs only the stamp query).
  - `narrow rejects by cavities, unknown cavities, NULL size class, chart, size pre-filter — and counts each` (six candidates, one per fate plus one kept).
  - `NULL size class fails gate two with reason no-size-class`.
  - `no_chart keeps candidates and marks the verdict` (empty chart rows for the press → all kept with `chart.verdict 'no_chart'`).
  - `needsTransfer is true when the press is not among held_presses, null when held_presses is empty`.
  - `two-cavity insert: both pockets must fit and the clearance is the smaller` (pockets circle(45) at (−60, 0) and circle(50) at (+60, 0); profile circle(35) → clearance 10, placements for both pockets with tx ≈ ∓60).
  - `a profile that fits one pocket but not the other is no-fit`.
  - `rankCandidates: clearance ascending, capped last, then pocket area, then confidence`.
  - `narrow cuts at MAX_FITTED smallest pockets and reports truncated`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(finder): candidate index, narrowing, per-tooling fit and ranking`.

---

### Task 3: `findToolings` orchestration, similar profiles, route and client

**Files:**
- Modify: `server/services/toolingFinder.cjs` (+ test) — add `findToolings`
- Modify: `server/routes/toolings.cjs` (+ `server/routes/toolings.find.test.cjs` new), `src/api.js` (`toolingsAPI.find`), `src/api.test.js`

**Interfaces:**
- Consumes: Task 2; `loadIndex`, `nearest` from `profileSimilarity.cjs`; `signatureOf`, `toUnitFrame` from `profileShape.cjs`; `normalizePlant` from `frozenDesigns.cjs`; the route file's `normalizePress`.
- Produces:
  - `findToolings(client, { plant, press, dieSize, cavities, profile, dieNo, limit = 20, similarLimit = 20 }) → Promise<FinderResult>` where `profile = { outer: Array<[x,y]> mm, holes?: Array<polygon> }` **or** `dieNo` (the die's newest `true_size` row supplies `outer_mm`/`holes_mm`; 404-style error `no true-size profile for die` when none). Steps: normalise plant/press/die size; resample the profile (2 mm); `profileStats`; chart rows for the press (`SELECT * FROM tooling_combinations WHERE press = $1`); `loadCandidates`; `narrow`; `fitCandidate` for each kept candidate (sequential, timing recorded); `rankCandidates`; enrich the top `limit` with linked dies (`SELECT tooling_number, die_no, plant, source FROM die_tooling_links WHERE tooling_number = ANY($1) ORDER BY die_no`) and the chart row companions; similar profiles: `signatureOf({ outer, holes })` → `nearest(index, { signature, holeCount: holes.length, cavities, limit: similarLimit })` → for each neighbour die its linked toolings (`WHERE die_no = ANY($1) AND plant = $2`) each annotated `{ number, kind, sizeClass, inScope: status active & same plant, hasGeometry: confidence ≠ none, chartVerdict, reason: null | 'not-in-scope' | 'no-geometry' | 'chart' | 'cavities' }`.
  - `FinderResult = { query: { plant, press, dieSize, cavities, profile: { points, area, perimeter, ccd, holeCount } }, chart: { basis: 'chart'|'no_chart', rowsForDieSize }, candidates: Array<{ number, kind, sizeClass, sizeClassConfidence, cavities, heldPresses, needsTransfer, location, confidence, clearance, clearanceCapped, placements, chart: { verdict, rows }, linkedDies: Array<{ dieNo, source }>, pockets }>, rejected: Record<reason, number>, fitted: number, truncated: boolean, similar: Array<{ dieNo, profileNumber, distance, cavityMatch, trueSize, shapeId, toolings: [...] }>, timings: { narrowMs, fitMs, totalMs } }`. `pockets` (the candidate's polygons) are returned so the UI can draw the overlay without a second call.
  - Route `POST /api/toolings/find` (registered before `/:number`; `authMiddleware` only, like the rest of the router): body `{ plant, press, dieSize, cavities, profile?, dieNo?, limit? }` → 400 when `plant`/`press`/`dieSize`/`cavities` missing or `cavities` not a positive integer, or neither `profile` (outer ≥ 3 numeric pairs) nor `dieNo` given; 404 when `dieNo` has no true-size profile; 200 `FinderResult`; 500 JSON on error.
  - Client `toolingsAPI.find(body) → FinderResult` (`POST /toolings/find`).

- [ ] **Step 1: Failing tests.** Service (fake client scripted per SQL prefix): `fits a profile by polygon and returns ranked candidates with links and placements`; `resolves the profile from a die's newest true-size row`; `no chart rows: candidates are fitted and flagged no_chart`; `held at another press is a note, not a gate`; `similar dies carry their toolings with scope and chart reasons` (a neighbour's retired tooling → `not-in-scope`, one with no opening → `no-geometry`); `timings and rejected counts are reported`. Route (fake pool + `listen`/`fetch`): 400 cases, 404 for an unknown die, 200 shape, and that `POST /find` is not swallowed by `/:number`. Client: path and body.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(finder): findToolings with similar profiles, POST /api/toolings/find and client`.

---

### Task 4: Backfill profile shapes for orders that already had a picture

**Files:**
- Modify: `server/services/orderProfileShape.cjs` (+ test) — add `backfillOrderProfileShapes`
- Create: `server/scripts/backfill-order-profile-shapes.cjs`

**Interfaces:**
- Consumes: `shapeFromProfilePng`, `readDieListCcd`, `recordOrderProfileShape` (same file); `orderFiles.getRoot`, `orderFiles.isInsideRoot`; `sha256Of`.
- Produces:
  - `backfillOrderProfileShapes(client, { root, io: { readFile, exists }, dryRun = false, limit = null, log }) → { scanned, traced, trueSized, skippedExisting, failed: Array<{ orderId, dieNo, error }> }` — rows from `SELECT f.id, f.order_id, f.stored_path, o.die_no, o.plant, o.die_size, o.die_type FROM die_order_files f JOIN die_orders o ON o.id = f.order_id WHERE f.slot = 'profile_image' AND f.replaced_at IS NULL AND NOT EXISTS (SELECT 1 FROM profile_shapes p WHERE p.source = 'order-pdf' AND p.source_ref = f.order_id::text) ORDER BY f.id`; per row: path inside the root (else `failed`), `shapeFromProfilePng(buffer, { renderDpi: 200, scales: [1], ccdStated: null, dieListCcd: await readDieListCcd(...), dieSize, dieType })`, `recordOrderProfileShape` with `cavities` = the die list's `cavity` when numeric; failures caught per row; one transaction; dry run rolls back.
  - Script `backfill-order-profile-shapes.cjs [--dry-run] [--limit N]` printing the result JSON.

- [ ] **Step 1: Failing tests** (fake client + fake io; a real ring PNG encoded with `@napi-rs/canvas` as in Plan 3's test): `traces pictures without a shape row and records them`; `orders that already have an order-pdf row are skipped`; `an unreadable picture is reported, not fatal`; `dry run rolls back`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; rebuild the backend and run the script on the test server (dry run, then live; 4 pictures expected) and `select die_no, true_size, true_size_confidence, round(ccd_mm) from profile_shapes where source = 'order-pdf'`. **Step 5: Commit** `feat(profiles): backfill order-PDF profile shapes for orders that already had a picture`.

---

### Task 5: Corpus check against the die-list links, test-server smoke, runbook

**Files:**
- Create: `server/scripts/check-finder-fit.cjs`, `docs/tooling-finder-runbook.md`
- Modify: `docs/profile-library-import-runbook.md` (one "Next: finder" pointer line)

- [ ] **Step 1: Write `check-finder-fit.cjs --plant "GEX 1" [--confidence confirmed,likely] [--limit N] [--out report.json]`.** For every distinct (die, tooling) pair from `die_tooling_links` where the die has a `true_size` `profile_shapes` row (newest) and the tooling is active with an opening of the requested confidence: run `fitCandidate` (Task 2; **no gates** — this measures geometry only) and record `{ dieNo, tooling, kind, confidence, dieCavities, toolingCavities, pockets, clearance | null, reason, ms }`. Print and write a report: pairs checked; pass rate (clearance ≥ 5) overall and per confidence; clearance percentiles (p10 / p50 / p90) of passes; cavity agreement (die list `cavities` = tooling `cavities`) and the pass rate within the agreeing pairs; failures by `reason` (`no-fit` with the worst pocket's exact clearance bucketed: < 0 outside, 0–5 too tight); mean/max ms per fit; the 20 worst confirmed-pair failures (die, tooling, clearance) for a human look. Read-only on the database (one `SELECT`, no writes).
- [ ] **Step 2: Run it on the test server** inside the container for GEX 1 (3,932 pairs; expect a few minutes — background it) and GEX 2. Record the numbers in the runbook. **Interpretation rule:** this is validation, not tuning. If the pass rate for *confirmed* openings with agreeing cavity counts is below 70 %, inspect the 20 worst pairs (export the die's `outer_mm` and the pocket to the scratchpad and plot both with a 20-line `@napi-rs/canvas` script) and report the dominant cause — a scale mismatch, a y-flip between frames, mirrored pictures, or loose die-list links — **before** changing any constant; a ruling on the cause belongs to the controller. Record the cause analysis either way.
- [ ] **Step 3: Smoke the route.** With a 10-minute admin JWT minted inside the container, `POST /api/toolings/find` for three real GEX 1 dies (`dieNo` form; press/die size from the die list; cavities from the die list) and one GEX 2 die; record status, candidate count, the top three candidates with clearances, `rejected` counts, `similar.length` and `timings` (target `totalMs` < 2,000 warm; if higher, record where the time goes — `fitMs` vs `narrowMs` — and the candidate count fitted).
- [ ] **Step 4: Write `docs/tooling-finder-runbook.md`:** the API contract (request, response, errors) for Plan 5; the algorithm in a page (frames, resampling step, grid cell, angle step, pattern-search steps, exact verification, clearance cap, ranking, gates, `no_chart` behaviour, `needsTransfer`); the tuning constants and what each costs; the corpus-check results and cause analysis; the backfill script; known gaps (cavity counts disagree between the die list and the toolings — the user's "cavities must match" gate uses the order's count; GEX 2 presses 7/8 have no chart rows; candidates are capped at 400 smallest pockets; `uncertain` openings are suggested but ranked last; mirror fits are not searched; bolsters rank below inserts by design). Add the pointer line to the profile runbook.
- [ ] **Step 5:** `npm test`, commit `docs(finder): corpus check against die-list links, route smoke and runbook`.

---

## Self-review notes

- Spec part 5 coverage: narrow (plant, active/in-scope, both kinds, cavities equal, confidence ≠ none, gate two, bbox/CCD pre-filter) — Task 2; overlay with rotations and translations, 5 mm offset, clearance recorded, every pocket for multi-pocket — Tasks 1–2; rank by clearance then area then confidence — Task 2; return number, kind, size class, cavities, clearance, chart verdict + companions, location, linked dies, confidence, placement — Task 3; similar profiles with linked toolings, in-scope and gate-two flags, greyed-with-reason never dropped — Task 3. "My calls": any rotation / no mirror (Global Constraints), 50 mm cap (Task 2), plant separation (SQL), mixed ranking (Task 2), similarity N = 20 (Task 3). Deliberately out of scope: the New die order form and the Find tooling panel (Plan 5), `new_die_order_forms`, the Tooling page and review queue UI (Plan 5), unknown typed numbers becoming `unverified` (Plan 5's form).
- Step scan: each test block carries its assertions; each code step names the exact signature; the only algorithm body given is the search strategy in Task 1 Step 3 because the signature does not determine it.
- Type consistency: `bestPlacement` returns `{ clearance, placement: { theta, tx, ty }, evaluations }` (Task 1) and `fitCandidate` flattens placements per pocket as `{ pocketIndex, theta, tx, ty, clearance }` (Task 2) — both named in the Interfaces blocks; `chart.verdict` strings are `chartVerdict`'s; `needsTransfer` is `boolean|null` everywhere.
- Review Focus: five items, each pinned to a named test in Tasks 1–3.
- Proportion: five tasks; the plan is shorter than the code it describes.
- My calls to check while reading: `no_chart` candidates are fitted and flagged rather than rejected; `needsTransfer: null` when the held presses are unknown; the 400-candidate cap by smallest pocket area; the 2 mm resampling step and 2 mm grid cell with exact verification; the backfill assumes the drawing's main view was 1:1 (what every sample states) and keeps the live path's confidence rule; the corpus check's 70 % threshold is a trigger for analysis, not a target to tune to.
