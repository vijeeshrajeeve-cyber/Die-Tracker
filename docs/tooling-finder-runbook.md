# Tooling finder — runbook

Answers "which of this plant's inserts and bolsters can take this profile?". The
finder takes a true-size profile (posted as a polygon, or read from a die's
`profile_shapes` row), narrows the plant's toolings by the cheap gates, fits the
profile into every pocket of each remaining tooling at any rotation, and ranks the
ones that fit. It also lists the dies with the most similar profiles and the
toolings they run with.

Nothing here needs to be run to use it: `POST /api/toolings/find` is live once the
backend is built from this branch. This runbook covers the contract (for Plan 5),
the algorithm, the tuning constants, the corpus check that measures it against the
die list, and the order-picture backfill.

It reads what the two imports load: openings from
`docs/tooling-geometry-import-runbook.md`, profiles from
`docs/profile-library-import-runbook.md`, and the chart rows and links from
`docs/tooling-master-import-runbook.md`.

---

## Prerequisites

- The backend image built from this branch (rebuild as in the geometry runbook):

```bash
docker compose -p die-tracker --env-file <path to .env> build backend
docker compose -p die-tracker -f docker-compose.yml --project-directory <checkout with .env> up -d --wait backend
```

  If `/api` answers 502 afterwards, `docker compose restart frontend`.
- The geometry import applied (`tooling_openings`), the profile library applied
  (`profile_shapes`), the master import applied (`toolings`, `tooling_combinations`,
  `die_tooling_links`).
- In Git Bash, `MSYS_NO_PATHCONV=1` is required in front of every `docker exec`.

## API: `POST /api/toolings/find`

Behind the normal login (`authMiddleware`; a user with `password_must_change` gets
403). Client: `toolingsAPI.find(body)` in `src/api.js`.

### Request

```json
{
  "plant": "GEX 1",
  "press": "PRESS 2",
  "dieSize": "250X160",
  "cavities": 2,
  "dieNo": "02061_201",
  "profile": { "outer": [[x, y], ...], "holes": [[[x, y], ...], ...] },
  "minClearance": 5,
  "limit": 20
}
```

| Field | Rule |
|---|---|
| `plant` | Required; `normalizePlant` (`gex 01` → `GEX 1`). |
| `press` | Required; resolved by the presses master (`normalizePress`: `P25` → `PRESS 25`, `P7` → `PRESS 7`). |
| `dieSize` | Required; `normalizeSizeClass` (`250x200` → `250X200`). |
| `cavities` | Required positive integer (an integer string such as `"2"` is accepted). The order's count, not the die list's. |
| `profile` | Optional: `outer` of at least 3 finite `[x, y]` pairs in mm (any position; it is recentred on its centroid), `holes` optional polygons. At most 5,000 points in the outer and in each hole (`MAX_PROFILE_POINTS`). Wins over `dieNo` for the shape. |
| `dieNo` | Used when `profile` is absent: the die's newest `true_size` `profile_shapes` row for the plant. Given with a `profile` (a drawn shape for a known die, e.g. a backup die), it is not read for the shape and only keeps that die out of its own similar list (as it always is). |
| `minClearance` | Optional number of mm, 0–10 (a numeric string is accepted), default 5 (`MIN_CLEARANCE_MM`). It is the fit gate and drives the size pre-filter; echoed as `query.minClearance`. |
| `limit` | Candidates returned, clamped to 1–50, default 20. The similar list is always 20. |

### Response (200)

```json
{
  "query": { "plant": "GEX 1", "press": "PRESS 25", "dieSize": "250X200", "cavities": 1, "minClearance": 5,
             "profile": { "points": [[35,0],[34.9,2.4],"..."], "area": 3842.8, "perimeter": 219.9, "ccd": 70, "holeCount": 0 } },
  "chart": { "basis": "chart", "rowsForDieSize": [{ "press": "PRESS 25", "die_size": "250X200", "insert_size": "300X100", "...": "..." }] },
  "candidates": [{
    "number": "SNUG", "kind": "insert", "sizeClass": "300X100", "sizeClassConfidence": "confirmed", "cavities": 1,
    "heldPresses": ["PRESS 25"], "needsTransfer": false, "location": "RACK 1", "confidence": "confirmed",
    "clearance": 10.0, "clearanceCapped": false,
    "placements": [{ "pocketIndex": 0, "tx": 0, "ty": 0, "theta": 0, "clearance": 10.0 }],
    "chart": { "verdict": "allowed", "rows": [{ "...": "chart row" }] },
    "linkedDies": [{ "dieNo": "D-1", "source": "die-list" }],
    "pockets": [[[45,0],"..."]]
  }],
  "rejected": { "cavities": 1, "cavities-unknown": 0, "pocket-count": 0, "no-size-class": 0, "chart": 0, "size-prefilter": 1, "no-fit": 1 },
  "fitted": 3, "truncated": false,
  "similar": [{ "dieNo": "N-1", "profileNumber": "P-1", "distance": 0.0, "cavityMatch": true, "trueSize": true, "shapeId": 11,
    "toolings": [{ "number": "GOOD", "kind": "insert", "sizeClass": "300X100", "inScope": true, "hasGeometry": true, "chartVerdict": "allowed", "reason": null }] }],
  "timings": { "narrowMs": 0, "fitMs": 12, "totalMs": 14 }
}
```

- `query.profile.points` is the recentred outer (centroid at the origin), the frame
  the placements refer to.
- `chart.basis` is `no_chart` when the press has no `tooling_combinations` rows
  (GEX 2 presses 7 and 8); then every candidate's `chart.verdict` is `no_chart`.
- `candidates[].placements`: one per pocket, `{ pocketIndex, theta (radians, [0, 2π)), tx, ty, clearance }`:
  the profile rotated by `theta` about its origin, then moved by `(tx, ty)` into the
  pocket frame (the tooling's outer bbox centre at (0, 0)). `pockets` are in the same
  frame, so a viewer can draw both.
- `clearance` is the smallest pocket's exact clearance in mm, capped at 50
  (`clearanceCapped: true` above that).
- `needsTransfer`: `true` when the tooling is held at other presses only, `false`
  when it is held at the query press, `null` when its held presses are unknown.
- `rejected` counts each narrowing reason and `no-fit`, every key always present.
  The vocabulary, in gate order: `cavities` (the tooling's count differs from the
  query's), `cavities-unknown` (the tooling's count is NULL), `pocket-count` (the
  tooling's stored pockets differ from its own cavities), `no-size-class` (NULL size
  class under a press with chart rows), `chart` (`not_allowed`), `size-prefilter`,
  `no-fit`. `fitted` is how many candidates were fitted; `truncated` says the fit
  list was cut at 400.
- `similar[].toolings[].reason`: why that tooling is not a candidate here, the first
  that applies: `not-in-scope` (retired, unknown, other plant), `no-geometry`
  (opening confidence `none`, no opening, or an opening with NULL pockets),
  `cavities` (different or unknown), `chart`; `null` when none applies (it is then a
  candidate, or failed only the fit). `cavityMatch` is `null` when either count is
  unknown.
- `timings` are integer ms; `narrowMs` is the narrowing only, `totalMs` includes the
  candidate load, the chart query, the links and the similar list.

### Errors

| Status | Body | When |
|---|---|---|
| 400 | `{ error: '<field> is required' }` | `plant`, `press` or `dieSize` missing, or `dieSize` not parseable |
| 400 | `{ error: 'cavities must be a positive integer' }` | |
| 400 | `{ error: 'profile.outer must be at least 3 [x, y] number pairs' }` / `profile.holes ...` | bad polygon, or a non-finite coordinate (e.g. `1e999`) |
| 400 | `{ error: 'profile has too many points (max 5000)' }` | the outer or any hole has more than 5,000 points |
| 400 | `{ error: 'minClearance must be a number from 0 to 10' }` | |
| 400 | `{ error: 'profile or dieNo is required' }` | neither given |
| 400 | `{ error: 'press is not recognised' }` | the press does not resolve to `PRESS n` |
| 401 | `{ error: 'No token provided' }` / `'Invalid or expired token'` | |
| 404 | `{ error: 'no true-size profile for die <dieNo>' }` | the die has no true-size row for the plant |
| 500 | `{ error: 'Finder failed' }` | anything else (logged) |

## The algorithm in a page

Code: `server/services/toolingFinder.cjs` (candidates, narrowing, ranking,
`findToolings`) and `server/services/fitGeometry.cjs` (the fit).

1. **Frames.** Millimetres, y up, no repeated closing point. Pockets are stored in
   the tooling frame (outer bbox centre at the origin); the profile is recentred so
   its outer centroid is at the origin. A placement rotates the profile about the
   origin by `theta`, then translates it by `(tx, ty)`. **Mirroring is never tried.**
2. **Candidates.** One query per plant loads every `active` tooling with an opening
   of confidence other than `none` and pockets present; it is cached per plant and
   reloaded only when the newest `updated_at` or the row count changes. The pocket
   grids built by the fit live on the cached candidates, so a repeat query reuses
   them. A row is skipped, with a `tooling finder: …` warning in the backend log once
   per load, when its pockets are unreadable (bad JSON, a pocket that is not at least
   3 finite `[x, y]` points), empty, or have a bbox side over 1,000 mm
   (`MAX_POCKET_MM`, a units error). On the test server GEX 1 skips I-16974, I-28820
   and I-25551 (oversize); GEX 2 skips none.
3. **Narrowing**, in this order, each rejection counted: cavities equal to the
   query's (`cavities`; NULL is `cavities-unknown`); the stored pocket count equal to
   the tooling's cavities (`pocket-count`: a two-cavity profile needs a two-pocket
   tooling); gate two, `chartVerdict` on the press's chart rows with the tooling's
   kind and size class (`not_allowed` → `chart`; a NULL size class →
   `no-size-class` only when the press has chart rows); the size pre-filter on every
   pocket, with `c` = `minClearance`: area ≥ profile area + c × **hull** perimeter +
   πc², and bbox diagonal ≥ profile CCD + 2c (`size-prefilter`). The hull perimeter,
   not the outline's: where two walls of the profile are closer than 2c their grown
   bands overlap, so the outline perimeter (exact only for a convex shape) overstates
   the area needed and rejected pockets the profile fits (a 100 × 50 heat sink with 20
   fins needed 11,779 mm² by the outline, 4,164 by the hull, and fits a 120 × 70
   pocket). What passes is sorted by total pocket area and cut at 400 (`truncated`).
4. **Fit (gate one)**, per pocket, every pocket must pass:
   - the profile outline is resampled at **2 mm** (every vertex kept);
   - the pocket gets a signed-distance grid at a **2 mm** cell with a 6 mm margin;
   - **angle sweep** every **10°** (36 angles) from two starts, the deepest grid cell
     and the pocket centroid; the best 3 (angle, start) seeds are kept;
   - each seed is refined by a **pattern search** over (tx, ty, θ) with ±x, ±y, the
     four diagonals and ±θ, steps **4 mm / 4° halving to 0.25 mm / 0.25°**, all
     grid look-ups capped at **4,000 evaluations** per pocket;
   - **exact verification**: each refined seed is measured with segment distances in
     both directions (profile points to pocket edges, pocket vertices to profile
     edges); the best exact value wins. The grid never decides.
   - The pocket passes when that exact clearance is ≥ `minClearance` (default **5 mm**).
5. **Clearance** of a tooling = the smallest pocket's clearance; above **50 mm** it is
   reported as 50 with `clearanceCapped: true`.
6. **Ranking:** uncapped before capped, then clearance ascending (tightest fit
   first, least wasted metal), then total pocket area, then confidence
   (confirmed < likely < uncertain), then number. The list is cut at `limit`.
7. **`no_chart`:** a press with no chart rows (GEX 2 presses 7/8) neither passes nor
   fails gate two: candidates are fitted and flagged `no_chart` for the UI to warn.
8. **`needsTransfer`** is a note, not a gate (see the response).
9. **Similar profiles:** the 20 nearest dies by signature in the plant's profile
   index (same hole count), excluding the queried die (also when a polygon was
   posted with a `dieNo`), each with the toolings it is linked to and the reason each
   is not a candidate.

**Precision.** Clearances within about 0.5 mm of each other are search noise, not a
real difference: the pattern search stops at a 0.25° step, and 0.25° on a 300 mm
bar moves its end by about 0.65 mm (and the translation step stops at 0.25 mm). The
exact check measures the placement found, not the best one possible, so a pair at
4.8 mm may fit at 5.1 with a finer search, and two candidates 0.3 mm apart rank in
an order that means nothing.

## Tuning constants

| Constant | Value | Where | What it costs |
|---|---|---|---|
| `MIN_CLEARANCE_MM` | 5 | `toolingFinder.cjs`, `DEFAULTS.minClearance` | The default gate; a request can set `minClearance` 0–10. On GEX 1, 354 of the 1,206 failing die-list pairs fit at 0–5 mm (157 at ≥ 3 mm, 292 at ≥ 1 mm): pockets cut to follow the profile closely. Lowering it admits those; it also drives the pre-filter. |
| `CLEARANCE_CAP_MM` | 50 | `toolingFinder.cjs` | Display and ranking only: 56 of 2,726 GEX 1 passes were capped. |
| `MAX_POCKET_MM` | 1,000 | `toolingFinder.cjs` | A candidate with any pocket bbox side above it is skipped at load (a units error: a 7,620 mm inch drawing built a 14.5 M-cell grid, 2.3 s and 58 MB kept for the process lifetime). No real pocket comes near it. |
| `MAX_PROFILE_POINTS` | 5,000 | `routes/toolings.cjs` | Cap on a posted outer and each hole. Fit time is linear in the points: 10,000 points cost about 41 ms per pocket, 16 s over 400 candidates on the event loop. Stored profiles average 74 points. |
| `MAX_FITTED` | 400 | `toolingFinder.cjs` | Bounds the fit time (≈ 1.2 ms per candidate warm, measured: 400 fitted in 486 ms). Cuts by smallest total pocket area, so a large-pocket candidate can be dropped before it is fitted (die `28318_401`: `truncated`, 400 fitted, 309 passed). |
| resample step | 2 mm | `DEFAULTS.resampleStepMm`, `findToolings` | Points per profile (≈ perimeter / 2); time is linear in it. Coarser steps can miss a pocket spike between samples. |
| grid cell | 2 mm | `DEFAULTS.cellMm` | Grid build ∝ (pocket area / cell²) × pocket vertices, once per pocket per cache load. A pocket drawn in inches as mm (5,334 × 1,397 mm) took 2.3 s. The search is only as good as ±half a cell; the exact check removes that error from the result. |
| angle step | 10° | `DEFAULTS.angleStepDeg` | 72 sweep evaluations per pocket (36 angles × 2 starts). |
| pattern-search steps | 4 → 0.25 mm and 4° → 0.25° | `DEFAULTS.startStep`, `endStep` | Refinement rounds; the final step bounds how close to the best placement the result can get. |
| `maxEvaluations` | 4,000 | `DEFAULTS.maxEvaluations` | Hard per-pocket cap on grid look-up passes (sweep + refinement). Measured fixtures used 222–542. |
| seeds | 3 | `DEFAULTS.seeds` | Seeds refined and exact-checked per pocket. |

**Timing measured on the test server:** mean 2.48 ms per tooling fit over 3,932
GEX 1 die-list pairs (median 1.82 ms, 99th percentile 13.6 ms, max 48.3 ms; the
first fit of a tooling includes its grid build). Route `totalMs` warm: 51–536 ms; cold
(grids being built): 55–1,620 ms. See the smoke below.

## Corpus check: the die list's own links

```bash
MSYS_NO_PATHCONV=1 docker exec -w /app die-ordering-backend node server/scripts/check-finder-fit.cjs --plant "GEX 1" [--confidence confirmed,likely] [--limit N] [--out /tmp/finder-check-gex1.json]
MSYS_NO_PATHCONV=1 docker cp die-ordering-backend:/tmp/finder-check-gex1.json <scratch folder>
```

Read-only (one `SELECT`). For every distinct (die, tooling) pair in
`die_tooling_links` where the die has a true-size profile in the plant and the
tooling is `active` with an opening of the requested confidences (default
`confirmed,likely`), it runs the finder's own fit (`fitCandidate`, **no cavity,
chart or size gate**) and records `{ dieNo, tooling, kind, confidence, dieCavities,
toolingCavities, pockets, clearance, rawClearance, reason, ms }`. For a failure it
also measures every pocket with the gate off and keeps the worst
(`exactClearance`, `worstPocket`). Each pair also records whether the two cheap
gates the check skips would have passed it: `passesSizePrefilter` (the finder's
hull-based pre-filter at 5 mm) and `pocketCountMatches` (`pockets === toolingCavities`;
`null` when the tooling's cavities are unknown). The summary's `gates` counts how many
*fitting* pairs each gate would remove (`sizePrefilterRejectsFits`,
`pocketCountRejectsFits`; these should be 0) and how many non-fitting pairs it
pre-rejects (`…RejectsNonFits`). A tooling whose pockets cannot be read is skipped
with a warning (`unreadableToolings`). It prints progress every 500 pairs and a
summary, and `--out` writes `{ summary, records }`. The profile is recentred as
`findToolings` does (two lines replicated in the script; the finder's helper is
not exported).

The pairs are the die shop's real choices, so a pair that does not fit is either a
finder problem or a data problem; the check is for telling which, not a target to
tune to.

### Results, test server, 2026-11-08 (re-run after the final-review fixes)

GEX 1, `confirmed,likely` (21 s wall). The pass rates are unchanged by the fixes
(the check applies no gate):

| | Pairs | Pass (≥ 5 mm) | Rate |
|---|---|---|---|
| All | 3,932 | 2,726 | 69.3 % |
| confirmed openings | 248 | 160 | 64.5 % |
| likely openings | 3,684 | 2,566 | 69.7 % |
| cavities agree (die list = tooling) | 3,570 | 2,524 | 70.7 % |
| cavities disagree | 362 | 203 | 56.1 % |
| **confirmed and cavities agree** | **155** | **122** | **78.7 %** |
| all, without I-12495 and I-11377 (see below) | 3,331 | 2,684 | 80.6 % |

- Every pair is an insert (no bolster has a confirmed or likely opening with a
  die-list link to a true-size profile). Both cavity counts are known for every pair.
- Clearance of passes: p10 7.83, p50 14.85, p90 27.08 mm; 56 capped at 50.
- Failures: 1,206, all `no-fit`: 852 outside the pocket (worst pocket < 0), 354 too
  tight (0–5 mm). Spread: below −20 mm 312, −20 to −10 68, −10 to −5 142, −5 to 0
  330, 0 to 2.5 161, 2.5 to 5 193.
- Time per fit: mean 2.49 ms, max 40.7 ms (first run 2.48 / 48.3).
- **Gates the check skips:** the hull-based size pre-filter would remove **0** of the
  2,726 fitting pairs and pre-reject 610 of the 1,206 non-fitting ones; the
  pocket-count gate would remove **0** fitting pairs and pre-reject 0 (every GEX 1
  confirmed/likely tooling with known cavities stores exactly that many pockets).
  No tooling's pockets were unreadable.
- By die cavities: 1 → 80.0 %, 2 → 80.6 %, 3 → 96.8 % (31), 4 → 51.8 %, 6 → 44.5 %,
  8 → 32.8 % (61). The low 4- and 6-cavity rates are almost all I-12495 and I-11377;
  without them, 4-pocket toolings pass 79.1 % and 6-pocket 81.6 %.

GEX 1, `uncertain` (for comparison): 1,830 pairs, 835 pass (45.6 %; inserts 46 %,
bolsters 19 of 58). Cavities unknown for every pair (an `uncertain` opening never
writes `cavities`). Mean 4.56 ms per fit, max 2,279 ms (see Known gaps: inch
drawings).

GEX 2: **0 pairs.** Only 4 GEX 2 dies have a true-size profile (order PDFs) and none
of them has a die-list link; GEX 2's 114 links are to dies without one.

### Cause analysis

The 70 % trigger (confirmed openings with agreeing cavities) is not hit: 78.7 %. The
failures were looked at anyway, by plotting the profile and the pockets on one
picture at the same scale (profile at the origin, its best gate-off placement in
each pocket, a 5 mm ring around it), and by refitting every failing pair with one
change at a time (diagnostic scripts, nothing changed in the finder). Overlays were
drawn for 26 pairs (the 20 worst confirmed-agreeing failures plus 6 from I-12495 and
I-11377); the six looked at closely were `28470_501`/I-09655, `17024_501`/I-05041,
`26461_501`/I-12495, `25193_401`/I-11377, `12298_166`/I-12298 and
`21494_405`/I-21494.

| Refit of the 1,206 failures | Now pass |
|---|---|
| profile mirrored (x → −x) | 29 |
| profile scaled 0.95 / 0.90 / 0.80 | 97 / 159 / 290 |
| gate at 3 / 1 / 0 mm | 157 / 292 / 354 |

1. **Two drawings not at 1:1 (46 % of the failures).** I-12495 (438 pairs, 42 pass)
   and I-11377 (163 pairs, 0 pass) account for 559 of the 1,206 failures. Both come
   from the same CAD template (identical `extraction_meta.offset`, drawn outer
   Ø110): I-12495 has four 38.5 × 35 mm pockets, I-11377 six 23 × 16 mm pockets, while
   their dies' profiles have a median CCD of 50 and 32 mm. Scaling the pockets by 2
   lifts I-12495 to 266 passes and I-11377 to 88 (109 at 300/110). I-11377's note
   already says "drawn rim Ø110 disagrees with the stated Ø300"; I-12495 has no
   stated size. The 1:n rule in the geometry import only fires on a clean 2–5×
   ratio with a stated size, so neither was capped. A geometry-import fix, not a
   finder one.
2. **Profile-following pockets cut closer than 5 mm (354 failures, 29 %).** Pictures
   such as `12298_166` in I-12298 (1.27 mm) and `21494_405` in I-21494 (−1.09 mm)
   show the pocket tracing the profile's own outline a few millimetres out. The fit finds the
   same orientation as the pocket, so the frames agree; only the 5 mm rule fails it.
3. **Profile larger than the pocket (the rest, about 380 outside without the two
   drawings).** `28470_501` in I-09655 (−17.98 mm: a 112.5 × 59.6 profile against a
   139.3 × 53.8 pocket), `17024_501` in I-05041 (−12.75: an 89.5 × 98.4 profile, CCD
   131, against two 105 × 65 pockets; the same insert takes `02061_201` with 16.76),
   `01029_401` in I-11377 (CCD 488 against a Ø110 insert). These are loose die-list
   links or a die-list CCD that overstates the profile (workbook shapes are sized
   from it); scaling by 0.8 rescues 290.
4. **Not a frame error.** Mirroring rescues 29 of 1,206 and the overlays of the
   form-following pockets line up unmirrored, so there is no y-flip between the
   profile and tooling frames.

## Route smoke, test server, 2026-11-08

Admin token minted inside the container (10 minutes, never printed); each body sent
twice, cold then warm, after a backend restart. Press, die size and cavities from
the die list (GEX 1) or the die's order (GEX 2, not in the die list).

| Die | Query | Status | Candidates (fitted) | Top three (clearance mm) | Die's own insert | `rejected` | similar | totalMs cold / warm |
|---|---|---|---|---|---|---|---|---|
| `02061_201` | PRESS 2, 250X160, 2 cav, CCD 64 | 200 | 20 of 73 passes (88) | I-14886 5.21, I-17190 5.33, I-14139 5.45 (all likely, allowed) | I-05041: #67 of 73, 16.76 (outside the top 20) | cavities 633, cavities-unknown 284, no-size-class 3, chart 5, size-prefilter 0, no-fit 15 | 20 | 941 / 174 (fit 383 / 120) |
| `28318_401` | PRESS 4, 250X160, 1 cav, CCD 80, 4 holes | 200 | 20 of 309 passes (400, truncated) | I-23254 5.05, I-13753 5.09, I-21684 5.11 (likely, allowed) | I-13440: #237 of 309, 14.47 | cavities 127, cavities-unknown 284, no-size-class 3, chart 36, size-prefilter 4, no-fit 91 | 20 | 1,620 / 536 (fit 1,574 / 486) |
| `05031_214` | PRESS 2, 355X200, 3 cav, CCD 71, 1 hole | 200 | 1 (2) | I-15803 12.81 (confirmed, allowed, 3 placements) | I-15803: #1, 12.81 | cavities 727, cavities-unknown 284, no-fit 1, rest 0 | 20 | 55 / 66 |
| `012987-702` (GEX 2) | P7 → PRESS 7, 280X160, 2 cav, CCD 74.6 | 200, `chart.basis: no_chart` | 17 (17) | 25IC2-019480 5.98, 35IC2D 14.9 (likely), 35IC2C 50 capped (uncertain); all `no_chart` | none linked | cavities 184, cavities-unknown 15, size-prefilter 42, rest 0 | 20 | 259 / 51 |

After the final-review fixes (backend rebuilt, same bodies):

| Die | Query | Status | Candidates (fitted) | `rejected` | totalMs cold / warm |
|---|---|---|---|---|---|
| `02061_201` | as above | 200 | 20 (88); top three unchanged (I-14886 5.21, I-17190 5.33, I-14139 5.45) | cavities 633, cavities-unknown 281, **pocket-count 0**, no-size-class 3, chart 5, size-prefilter 0, no-fit 15 | 951 / 208 |
| `02061_201` | + `minClearance: 3` | 200, `query.minClearance` 3 | 20 (88); top I-12984 3.17, I-23807 3.21, I-17239 3.99 | as above, no-fit 8 | — / 179 |
| `02061_201` | + `minClearance: 11` | 400 `minClearance must be a number from 0 to 10` | | | |
| `012987-702` (GEX 2) | as above | 200, `no_chart` | **2** (2): 25IC2-019480 5.98, 35IC2D 14.9 | cavities 184, cavities-unknown 15, **pocket-count 56**, size-prefilter 1, rest 0 | — / 104 |

`cavities-unknown` fell from 284 to 281 because the three oversize GEX 1 toolings are
now skipped at load. On GEX 2 the pocket-count gate removes 56 two-cavity toolings
(35IC2C among them) and the list drops from 17 to 2; see Known gaps.

Every warm `totalMs` is under the 2,000 ms target; the slowest is the 400-candidate
query (486 ms of fit). The die's own insert is always a passing candidate, but the
tightest-first ranking puts the inserts the shop actually uses behind tighter
fits (#67 and #237); the rank is by design (least wasted metal).

## Backfill: profile shapes for orders that already had a picture

Orders whose profile picture was captured before the order-PDF path recorded shapes
have no `order-pdf` row. One script traces them:

```bash
MSYS_NO_PATHCONV=1 docker exec -w /app die-ordering-backend node server/scripts/backfill-order-profile-shapes.cjs --dry-run [--limit N]
MSYS_NO_PATHCONV=1 docker exec -w /app die-ordering-backend node server/scripts/backfill-order-profile-shapes.cjs [--limit N]
```

One transaction (the dry run traces everything and rolls back), one savepoint per
order so a database error on one row cannot abort the rest; it prints the result
JSON last (`scanned`, `traced`, `trueSized`, `skippedExisting`, `failed`). It sizes
the shape with the live path's rule (the drawing's main view taken as 1:1 when
nothing contradicts it, as every sample states). Test server: dry run and live both
scanned 2, traced 2, true-sized 2, skipped 2 existing, failed none; afterwards GEX 2
has 4 `order-pdf` rows (027340-702, 012987-702, 005192-802, 026004-802).

## Known gaps

- **Cavity counts disagree between the die list and the toolings** in 362 of 3,932
  GEX 1 pairs. The finder's cavities gate uses the order's count, so a tooling whose
  stored count is wrong is rejected (`cavities`) even when it would fit.
- **The pocket-count gate empties much of GEX 2.** 138 of GEX 2's 243 candidates
  with known cavities store a different number of pockets, all `uncertain` openings
  (1 cavity with 2–6 pockets: 78; 2 cavities with 1 pocket: 15, with 3–6: 41; a few
  4- and 8-cavity). They are rejected `pocket-count` until the geometry import
  extracts the right pockets (or the cavities are corrected). GEX 1 has none.
- **GEX 2 presses 7/8 have no chart rows**: every candidate is `no_chart`.
- **GEX 2 profiles are almost all unsized** (4 true-size shapes), so a GEX 2 query by
  `dieNo` usually 404s and the corpus check has nothing to measure; a posted polygon
  works.
- **Candidates are capped at 400 smallest pockets** (`truncated`); larger-pocket
  toolings beyond the cap are never fitted.
- **`uncertain` openings are suggested but ranked last on ties**; their pass rate on
  the die-list pairs is 45.6 %.
- **Mirror fits are not searched** (29 of 1,206 failures would fit mirrored).
- **Bolsters rank below inserts only through clearance and area**, by design: a
  bolster's large pocket gives a large clearance, so it sorts after the inserts.
- **Drawings not at 1:1 that the import did not catch**: I-12495 and I-11377 (likely,
  outer Ø110, half size or less). They are fitted as stored and fail most of their
  own dies.
- **Inch drawings read as mm**: I-25551 and I-28820 (uncertain, outer 7,619.8 mm =
  300 in) carry 5 m pockets; their grid build took 2.3 s and 1.9 s. They, and
  I-16974, are now skipped at load by `MAX_POCKET_MM` (1,000 mm) with a log warning,
  whatever their cavities; the geometry import should rescale them.
- **The size pre-filter's hull bound is not a proven lower bound** for every
  non-convex shape (a wide, deep notch bridged by the hull can make it slightly too
  strict); on the GEX 1 corpus it removes no fitting pair.
- **Form-following pockets cut closer than 5 mm** fail the gate (354 die-list pairs).
- **Tightest-first ranking hides the shop's usual insert** (#67 and #237 in the
  smoke); Plan 5 may want to surface the die's linked toolings separately.

## For Plan 5 (the Find tooling panel)

- Post `{ plant, press, dieSize, cavities, profile | dieNo, minClearance? }`; cavities
  come from the order form, not the die list. Send `dieNo` with a drawn `profile`
  when the die is known, so it stays out of its own similar list.
- Show `chart.basis === 'no_chart'` and per-candidate `chart.verdict === 'no_chart'`
  as a warning ("press has no chart; size not checked"), not an error.
- `needsTransfer: true` → "held at another press"; `null` → "location unknown".
- `clearanceCapped: true` → show "≥ 50 mm", not 50.
- `placements` (one per pocket, `theta` in radians) with `pockets` and
  `query.profile.points` are enough to draw the overlay.
- `similar[].cavityMatch` is `null` when either count is unknown; show it as unknown,
  not as a mismatch.
- `similar[].toolings[].reason` greys a tooling with its reason; never hide it.
- `confidence: 'uncertain'` candidates need a warning; `rejected` and `truncated`
  explain an empty or short list.
- A `dieNo` with no true-size profile answers 404; offer to post a polygon instead.

## Production procedure

1. Back up the database.
2. Rebuild the production backend from this branch.
3. Make sure the master, geometry and profile imports have been applied (their
   runbooks), then run the backfill dry run, read it, and run it live.
4. Run the corpus check for each plant and compare with the numbers above; a pass
   rate far below them points at the imports, not the finder.
5. Smoke `POST /api/toolings/find` for one known die per plant.
