# Tooling Finder, Plan 1 of 5: Tooling Master Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the tooling master, the combination chart, and the die-to-tooling links into the app's database, fed from the inventory workbooks and the die lists, with a read API, so the geometry, similarity, finder and UI plans have real rows to work against.

**Architecture:** Pure parsing and classification live in `server/services/tooling*.cjs` and are unit-tested with fixtures copied from the real workbooks; one-off scripts under `server/scripts/` read the workbooks with the repo's `xlsx` and upsert through those services; the die list import route and the order creation route each gain one call that records links. A new `server/routes/toolings.cjs` exposes read-only endpoints. Nothing in this plan touches drawings, geometry or the UI beyond a client API object.

**Tech Stack:** Node 20 CommonJS (`.cjs`), Express, Postgres via `pg`, `xlsx` (SheetJS, already a dependency), `node:test` + `node:assert/strict`, route tests via `server/routes/testSupport.cjs` (`installFakeDb`, `listen`, `request`).

**Spec:** `docs/superpowers/specs/2026-11-07-tooling-finder-design.md` — read it first; this plan implements its sections "Tooling master", "Combination chart", "Die → tooling links" and the data-source facts, and lays the tables the other plans extend.

**Plan series** (each plan ships working, tested software on its own):
1. **This plan** — tables, number and size normalisers, inventory + chart imports, die-list and order-PDF links, read API.
2. Geometry extraction — DWG→DXF conversion, DXF/vector-PDF/scanned-PDF opening extraction, size-class derivation for GEX-1 inserts, the import bundle and `apply-tooling-bundle`, drawing storage.
3. Profile library — image-check workbook import, true-size outline from order PDFs and profile drawings, shape signatures and nearest-neighbour search.
4. The finder — narrowing, 5 mm offset overlay with rotation search, ranking, the finder endpoint.
5. UI — top-bar **New die order** button and modal, Find tooling panel (also on the backup form), Tooling page with review queue, `new_die_order_forms`.

**Branch:** start from `main` (`d328577`) in a fresh worktree via superpowers:using-git-worktrees, branch `feat/tooling-finder-1-master`. The current checkout's branch `feat/sample-followup-mass-update` carries unrelated uncommitted work; do not build on it. The spec and this plan exist only as untracked files in that checkout, so copy both into the worktree first (`docs/superpowers/specs/2026-11-07-tooling-finder-design.md`, `docs/superpowers/plans/2026-11-07-tooling-finder-1-master.md`) and commit them in Task 1.

## Global Constraints

- Server code is CommonJS in `server/**/*.cjs`; tests are `*.test.cjs` beside the module and run with `npm test` (`node --test "server/**/*.test.cjs" "src/**/*.test.js"`). No Jest/Vitest.
- Every new table is written **twice**: in `init.sql` (fresh installs) and as `CREATE TABLE IF NOT EXISTS` inside the big migration query in `server/db.cjs` (existing installs), with identical columns.
- Press names are the canonical `press_name` from the `presses` master: `PRESS 2`, `PRESS 4`, `PRESS 5`, `PRESS 6` (GEX 1), `PRESS 7` (code `P25`), `PRESS 8` (code `P35`), `PRESS 9` (GEX 2). Chart press numbers map `n → 'PRESS n'`.
- Plant values are stored as `GEX 1` / `GEX 2` (the `die_orders` vocabulary). Compare plants only through `normalizePlant` from `server/services/frozenDesigns.cjs` (`'GEX 01' → 'GEX 1'`), because `existing_die_details` mixes `GEX 01` and `GEX 2`.
- Size classes are stored normalised: uppercase `X`, no spaces, no `∅`/`Ø`/`DIA` prefix, decimals kept (`302.5X145`), `NO` and blank become `null`. Sizes mean diameter × thickness.
- Canonical tooling numbers: GEX-2 inserts as printed (`25IC2-110634`, `35IC1-120021`, `25IC2E`); GEX-1 inserts `I-` + five digits zero-padded (`I-05043`); bolsters `BOL-` + the rest uppercased (`BOL-4-6-A`, `BOL-15109`, `BOL-2-1-C`).
- Scripts never run an unscoped `DELETE`; they replace only rows carrying their own `source` / `source_sheet`, print a dry-run summary with `--dry-run`, and are idempotent.
- Import scripts never change `toolings.status` of a row that already exists (a retired tooling stays retired).
- Press 9 is excluded everywhere in this plan (chart rows with press 9 are skipped; nothing else references it).
- Commit after every task; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A bare number in the die list's `IDBolster` (`15109`, `302`) that matches both an insert `I-15109` and a bolster `BOL-15109` must link as `unknown`, never guessed — Task 5 test `resolves a bare number to unknown when both kinds exist`.
2. The all-presses chart sheet has no usable rows for presses 7 and 8 (press 7 is blank, press 8 has one die size and no sizes); a GEX-2 lookup must answer `no_chart`, not `not_allowed` — Task 3 test `answers no_chart for a press with no rows`.
3. A GEX-1 insert listed in two press blocks of the 2024 inventory must become one tooling with two held presses, not two rows — Task 4 test `merges one insert listed under two presses`.
4. Re-running the inventory import must not resurrect a retired tooling or wipe a size class the die shop corrected — Task 4 test `upsert never writes status and keeps an existing size class`.
5. Order creation with an `Insert No` whose value is not a recognisable tooling number (free text like `old`) must create the order and record an `unknown` link rather than fail — Task 6 test `an unrecognised insert number still creates the order`.

---

### Task 1: Tooling number, size class and reference normalisers

**Files:**
- Create: `server/services/toolingNumbers.cjs`
- Test: `server/services/toolingNumbers.test.cjs`
- Commit also: `docs/superpowers/specs/2026-11-07-tooling-finder-design.md`, this plan

**Interfaces:**
- Produces:
  - `parseToolingNumber(raw: string) → { kind: 'insert'|'bolster'|'unknown', canonical: string|null, plant: 'GEX 1'|'GEX 2'|null, cavities: number|null, madeForDie: string|null, raw: string }`
  - `normalizeSizeClass(raw: unknown) → string|null`
  - `resolveToolingRef(raw: string, known: { inserts: Set<string>, bolsters: Set<string> }) → { kind: 'insert'|'bolster'|'unknown', toolingNumber: string|null, raw: string }`
  - `pressFromGex2Location(raw: string) → 'PRESS 7'|'PRESS 8'|null` (`25MN`/`P25` → PRESS 7, `35MN`/`P35` → PRESS 8)

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./toolingNumbers.cjs');

test('GEX-2 insert numbers carry plant, cavities and the die they were made for', () => {
  assert.deepEqual(m.parseToolingNumber('25IC2-110634'), { kind: 'insert', canonical: '25IC2-110634', plant: 'GEX 2', cavities: 2, madeForDie: '110634', raw: '25IC2-110634' });
  assert.equal(m.parseToolingNumber('35IC1-120021').cavities, 1);
  assert.equal(m.parseToolingNumber('35IC4-090462').cavities, 4);
  assert.deepEqual(m.parseToolingNumber(' 25IC2E ').canonical, '25IC2E');
  assert.equal(m.parseToolingNumber('25IC2E').madeForDie, null);
});

test('GEX-1 insert numbers normalise to I- plus five digits', () => {
  assert.equal(m.parseToolingNumber('I-05043').canonical, 'I-05043');
  assert.equal(m.parseToolingNumber('i-5043').canonical, 'I-05043', 'padded to five digits');
  assert.equal(m.parseToolingNumber('I 5043').canonical, 'I-05043');
  assert.equal(m.parseToolingNumber('05043').kind, 'unknown', 'a bare number is not assumed to be an insert');
  assert.equal(m.parseToolingNumber('I-12495').canonical, 'I-12495');
  assert.equal(m.parseToolingNumber('I-12495').madeForDie, '12495');
  assert.equal(m.parseToolingNumber('I-12495').plant, 'GEX 1');
  assert.equal(m.parseToolingNumber('I-2D').canonical, 'I-2D');
});

test('bolster codes normalise to BOL- prefix', () => {
  assert.equal(m.parseToolingNumber('BOL-4-6-A').canonical, 'BOL-4-6-A');
  assert.equal(m.parseToolingNumber('B-6-1-C').canonical, 'BOL-6-1-C');
  assert.equal(m.parseToolingNumber('bol 2-1-c').canonical, 'BOL-2-1-C');
  assert.equal(m.parseToolingNumber('BOL-4-6-A').kind, 'bolster');
});

test('bare numbers and free text are unknown but keep the raw value', () => {
  assert.deepEqual(m.parseToolingNumber('15109'), { kind: 'unknown', canonical: null, plant: null, cavities: null, madeForDie: null, raw: '15109' });
  assert.equal(m.parseToolingNumber('2(=)').kind, 'unknown');
  assert.equal(m.parseToolingNumber('').kind, 'unknown');
  assert.equal(m.parseToolingNumber(null).raw, '');
});

test('size classes are uppercase X, no prefix, decimals kept, NO is null', () => {
  assert.equal(m.normalizeSizeClass('460x150'), '460X150');
  assert.equal(m.normalizeSizeClass(' 302.5 X 145 '), '302.5X145');
  assert.equal(m.normalizeSizeClass('∅355x200'), '355X200');
  assert.equal(m.normalizeSizeClass('Dia475X280'), '475X280');
  assert.equal(m.normalizeSizeClass('NO'), null);
  assert.equal(m.normalizeSizeClass(''), null);
  assert.equal(m.normalizeSizeClass(undefined), null);
  assert.equal(m.normalizeSizeClass('RING SIZE DIE'), 'RING SIZE DIE');
});

test('bare numbers resolve against the known master, unknown when ambiguous', () => {
  const known = { inserts: new Set(['I-15109', 'I-05043']), bolsters: new Set(['BOL-15109', 'BOL-302']) };
  assert.deepEqual(m.resolveToolingRef('302', known), { kind: 'bolster', toolingNumber: 'BOL-302', raw: '302' });
  assert.deepEqual(m.resolveToolingRef('5043', known), { kind: 'insert', toolingNumber: 'I-05043', raw: '5043' });
  assert.deepEqual(m.resolveToolingRef('15109', known), { kind: 'unknown', toolingNumber: null, raw: '15109' });
  assert.deepEqual(m.resolveToolingRef('I-12495', known), { kind: 'insert', toolingNumber: 'I-12495', raw: 'I-12495' });
  assert.deepEqual(m.resolveToolingRef('2(=)', known), { kind: 'unknown', toolingNumber: null, raw: '2(=)' });
});

test('GEX-2 inventory locations map to press names', () => {
  assert.equal(m.pressFromGex2Location('25MN'), 'PRESS 7');
  assert.equal(m.pressFromGex2Location('P35'), 'PRESS 8');
  assert.equal(m.pressFromGex2Location(''), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/toolingNumbers.test.cjs`
Expected: FAIL, `Cannot find module './toolingNumbers.cjs'`

- [ ] **Step 3: Implement `server/services/toolingNumbers.cjs`**

Export the four functions above. Rules the tests pin: GEX-2 pattern `^(25|35)IC(\d+)(E)?(?:-(\d+))?$` after trimming and uppercasing (plant from the tonnage prefix, cavities from the digits after `IC`, made-for die from the suffix); GEX-1 insert `^I[-\s]?(\d{1,5})$` → `I-` + padStart 5, also `^I-(\w+)$` kept as-is (`I-2D`); bolster `^(BOL|B)[-\s]*(.+)$` → `BOL-` + rest uppercased with runs of spaces collapsed to `-`; everything else `unknown`. `resolveToolingRef`: a parse that yields insert/bolster is returned when its canonical is in the matching set, or even when not (the die list may name a tooling the inventory lacks — keep it, it becomes `unverified` later); a bare number is tried as `I-<padded>` and `BOL-<n>` and returned only when exactly one set has it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/toolingNumbers.test.cjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add server/services/toolingNumbers.cjs server/services/toolingNumbers.test.cjs docs/superpowers/specs/2026-11-07-tooling-finder-design.md docs/superpowers/plans/2026-11-07-tooling-finder-1-master.md
git commit -m "feat(tooling): number, size-class and reference normalisers; tooling finder spec and plan 1"
```

---

### Task 2: Schema — toolings, openings, combinations, links

**Files:**
- Modify: `init.sql` (append after `existing_die_details`, line ~411)
- Modify: `server/db.cjs` (add `CREATE TABLE IF NOT EXISTS` blocks inside the migration query, after `existing_die_details` at line ~983)
- Test: `server/services/toolingSchema.test.cjs`

**Interfaces:**
- Produces these tables (later tasks and plans rely on the exact column names):

```sql
CREATE TABLE IF NOT EXISTS toolings (
    id SERIAL PRIMARY KEY,
    number TEXT UNIQUE NOT NULL,                 -- canonical, see toolingNumbers.cjs
    kind TEXT NOT NULL CHECK (kind IN ('insert', 'bolster')),
    plant TEXT NOT NULL,                         -- 'GEX 1' | 'GEX 2'
    held_presses TEXT[] NOT NULL DEFAULT '{}',   -- canonical press names; a location, not a gate
    size_class TEXT,                             -- normalised, diameter X thickness
    size_class_source TEXT,                      -- 'inventory' | 'drawing' | 'manual'
    size_class_confidence TEXT,                  -- 'confirmed' | 'likely' | 'uncertain'
    cavities INTEGER,
    category TEXT,                               -- inventory block title, e.g. 'INSERT (TWO CAVITY)', 'BOLSTER HOLDER'
    location TEXT,                               -- rack / press as written in the inventory
    made_for_die TEXT,
    inventory_dims JSONB,                        -- e.g. {"a_len": 350, "b_wid": 110} from the bolster sheet
    source TEXT NOT NULL,                        -- 'inventory-2025' | 'inventory-2024-12' | 'bolster-inventory-p2-p6' | 'order-form' | 'manual'
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'unverified')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_toolings_plant_kind ON toolings (plant, kind);

CREATE TABLE IF NOT EXISTS tooling_openings (
    id SERIAL PRIMARY KEY,
    tooling_id INTEGER NOT NULL UNIQUE REFERENCES toolings(id) ON DELETE CASCADE,
    outer_outline JSONB,                         -- [[x,y],...] mm
    pockets JSONB,                               -- [[[x,y],...], ...] mm, one per cavity
    pocket_gap_mm NUMERIC,
    extraction_source TEXT,                      -- 'dxf' | 'pdf-vector' | 'pdf-raster' | 'manual'
    confidence TEXT NOT NULL DEFAULT 'none' CHECK (confidence IN ('confirmed', 'likely', 'uncertain', 'none')),
    drawing_file TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tooling_combinations (
    id SERIAL PRIMARY KEY,
    press TEXT NOT NULL,                         -- canonical press name
    die_size TEXT NOT NULL,                      -- normalised
    insert_size TEXT,                            -- normalised or NULL for 'NO'
    bolster_size TEXT,
    sub_bolster_size TEXT,
    die_ring_size TEXT,
    total_stack TEXT,
    insert_holder TEXT,
    baffle_ring TEXT,
    bolster_holder TEXT,
    remark TEXT,
    source_sheet TEXT NOT NULL,                  -- '2014/14 Inch' | 'manual'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tooling_combinations_press_size ON tooling_combinations (press, die_size);

CREATE TABLE IF NOT EXISTS die_tooling_links (
    id SERIAL PRIMARY KEY,
    die_no TEXT NOT NULL,
    plant TEXT,
    tooling_number TEXT,                         -- canonical; NULL when kind = 'unknown'
    kind TEXT NOT NULL CHECK (kind IN ('insert', 'bolster', 'unknown')),
    raw_value TEXT,                              -- what the source actually said
    source TEXT NOT NULL,                        -- 'die-list' | 'order-pdf' | 'new-order-form' | 'manual'
    seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_die_tooling_links_die ON die_tooling_links (die_no);
CREATE INDEX IF NOT EXISTS idx_die_tooling_links_tooling ON die_tooling_links (tooling_number);
```

- [ ] **Step 1: Write the failing parity test**

```js
'use strict';
// init.sql serves fresh installs, db.cjs migrates existing ones; the tooling
// tables must be defined identically in both or the test server and a fresh
// install drift apart.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const initSql = fs.readFileSync(path.join(__dirname, '..', '..', 'init.sql'), 'utf8');
const dbCjs = fs.readFileSync(path.join(__dirname, '..', 'db.cjs'), 'utf8');

const columnsOf = (text, table) => {
  const m = text.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\);`));
  assert.ok(m, `${table} is defined`);
  return m[1].split('\n').map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean)
    .map((l) => l.replace(/,$/, '').replace(/\s+/g, ' '));
};

for (const table of ['toolings', 'tooling_openings', 'tooling_combinations', 'die_tooling_links']) {
  test(`${table} has the same columns in init.sql and db.cjs`, () => {
    assert.deepEqual(columnsOf(dbCjs, table), columnsOf(initSql, table));
  });
}

test('toolings.status and die_tooling_links.kind are constrained', () => {
  const cols = columnsOf(initSql, 'toolings');
  assert.ok(cols.some((c) => c.startsWith('status TEXT NOT NULL DEFAULT \'active\' CHECK')));
  assert.ok(columnsOf(initSql, 'die_tooling_links').some((c) => c.includes("CHECK (kind IN ('insert', 'bolster', 'unknown'))")));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/services/toolingSchema.test.cjs`
Expected: FAIL, `toolings is defined` assertion

- [ ] **Step 3: Add the four tables and three indexes to `init.sql` and `server/db.cjs`**

Paste the SQL from Interfaces into both files, same text, same column order and comments. In `db.cjs` it goes inside the existing template-literal migration query next to `existing_die_details`.

- [ ] **Step 4: Run the test and the full suite**

Run: `node --test server/services/toolingSchema.test.cjs && npm test`
Expected: PASS; the full suite's pass count is unchanged apart from the new tests.

- [ ] **Step 5: Apply to the test server and check the tables exist**

Run: `docker compose build backend && docker compose up -d --wait backend` then
`MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -At -c "\dt tooling*" -c "\dt die_tooling_links"`
Expected: the four tables listed. (If the frontend's nginx 502s afterwards, restart the frontend — the backend IP moved; see `dev-workflow` memory.)

- [ ] **Step 6: Commit**

```bash
git add init.sql server/db.cjs server/services/toolingSchema.test.cjs
git commit -m "feat(tooling): toolings, openings, combinations and die-tooling-links tables"
```

---

### Task 3: Combination chart parser, gate-two lookup, import script

**Files:**
- Create: `server/services/toolingChart.cjs`
- Create: `server/scripts/import-tooling-chart.cjs`
- Test: `server/services/toolingChart.test.cjs`

**Interfaces:**
- Consumes: `normalizeSizeClass` (Task 1)
- Produces:
  - `parseChartRows(rows: any[][], { sourceSheet: string, excludePresses?: number[] }) → ChartRow[]` where `ChartRow = { press, die_size, insert_size, bolster_size, sub_bolster_size, die_ring_size, total_stack, insert_holder, baffle_ring, bolster_holder, remark, source_sheet }`
  - `chartVerdict(rows: ChartRow[], { press: string, dieSize: string, kind: 'insert'|'bolster', sizeClass: string|null }) → { verdict: 'allowed'|'not_allowed'|'no_chart', rows: ChartRow[] }` — `rows` are the matching chart rows (empty unless `allowed`)
  - `buildChartReplace(rows: ChartRow[], sourceSheet) → { statements: Array<{ sql: string, params: any[] }> }` — a scoped delete of that `source_sheet` followed by inserts

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./toolingChart.cjs');

// Header and rows copied from the 2014 workbook, sheet "14 Inch".
const HEADER = ['Press ', 'Die size', 'Insert size', 'Bolster size', 'Sub bolster size', 'Die ring size', 'Total stack', 'Insert Holder', 'Baffle ring', 'Bol Holder'];
const ROWS = [
  HEADER,
  [1, '150X120', '175X80', 'NO', 'NO', '302.5X145', '302.5X305', '302.5X160', 'YES', ''],
  [6, '355X200', '460X150', '700X196', '700X254', '750X250', '700X700', '700X196', 'YES', ''],
  [6, '355X200', 'NO', '700X196', '700X254', '700X250', '700X700', 'NO', 'YES', ''],
  [6, '475X280', 'NO', '475X220', '700x200', 'RING SIZE DIE', '700X700', 'NO', 'YES', ''],
  [7, '', '', '', '', '', '', '', '', ''],
  [8, '280X160', '', '', '', '', '', '', '', ''],
  [9, '355X200', '460X150', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
];

test('parses rows into canonical press names and normalised sizes, skipping blanks and press 9', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: '2014/14 Inch', excludePresses: [9] });
  assert.equal(rows.length, 4, 'press 7 blank row, press 8 size-only row and press 9 are skipped');
  assert.deepEqual(rows[0], {
    press: 'PRESS 1', die_size: '150X120', insert_size: '175X80', bolster_size: null, sub_bolster_size: null,
    die_ring_size: '302.5X145', total_stack: '302.5X305', insert_holder: '302.5X160', baffle_ring: 'YES',
    bolster_holder: null, remark: null, source_sheet: '2014/14 Inch',
  });
  assert.equal(rows[3].sub_bolster_size, '700X200', 'lowercase x normalised');
});

test('a row with a die size but no insert and no bolster size is kept out', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: 's' });
  assert.ok(!rows.some((r) => r.press === 'PRESS 8'));
});

test('verdict is allowed when a row for press and die size carries the size class', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: 's', excludePresses: [9] });
  const r = m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355x200', kind: 'insert', sizeClass: '460x150' });
  assert.equal(r.verdict, 'allowed');
  assert.equal(r.rows.length, 1);
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355X200', kind: 'bolster', sizeClass: '700X196' }).verdict, 'allowed');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355X200', kind: 'insert', sizeClass: '300X100' }).verdict, 'not_allowed');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '999X999', kind: 'insert', sizeClass: '460X150' }).verdict, 'not_allowed');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 6', dieSize: '355X200', kind: 'insert', sizeClass: null }).verdict, 'not_allowed');
});

test('answers no_chart for a press with no rows', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: 's', excludePresses: [9] });
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 7', dieSize: '250X140', kind: 'insert', sizeClass: '300X100' }).verdict, 'no_chart');
  assert.equal(m.chartVerdict(rows, { press: 'PRESS 8', dieSize: '280X160', kind: 'insert', sizeClass: '300X100' }).verdict, 'no_chart');
});

test('replace statements delete only the same source sheet, then insert', () => {
  const rows = m.parseChartRows(ROWS, { sourceSheet: '2014/14 Inch', excludePresses: [9] });
  const { statements } = m.buildChartReplace(rows, '2014/14 Inch');
  assert.match(statements[0].sql, /DELETE FROM tooling_combinations WHERE source_sheet = \$1/);
  assert.deepEqual(statements[0].params, ['2014/14 Inch']);
  assert.equal(statements.length, 1 + rows.length);
  assert.match(statements[1].sql, /INSERT INTO tooling_combinations/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/toolingChart.test.cjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `server/services/toolingChart.cjs`**

Header detection: the first row whose first cell trims to `Press`; columns by header text (trim, lowercase, collapse spaces) so column order can shift. A data row needs an integer press and a non-empty die size, and at least one of insert size / bolster size after normalisation. `chartVerdict`: `no_chart` when no parsed row has that press at all; otherwise filter by press and normalised die size and compare the kind's size column to the normalised size class.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/toolingChart.test.cjs`
Expected: PASS, 5 tests

- [ ] **Step 5: Write `server/scripts/import-tooling-chart.cjs`**

Usage: `node server/scripts/import-tooling-chart.cjs <workbook.xlsx> [--sheet "14 Inch"] [--dry-run]`. Reads the sheet with `XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })`, calls `parseChartRows` with `sourceSheet: '2014/14 Inch'` and `excludePresses: [9]`, prints per-press row counts and the list of skipped rows (press + reason), then, unless `--dry-run`, runs `buildChartReplace` statements inside one transaction on `pool` from `../db.cjs`. Follow the shape of `server/scripts/import-sample-followup-sheet.cjs` (path first, flags after, report to stdout).

- [ ] **Step 6: Dry-run against the real workbook, then import on the test server**

Run (Git Bash):
```bash
node server/scripts/import-tooling-chart.cjs "C:/Users/vijee/Desktop/18.06.2026/New folder/14.Die Toolings/Tooling stack combination for all Presses-Updated_16_April_2014.xlsx" --dry-run
```
Expected: about 88 rows across presses 1–6 (10/27/6/13/13/19), presses 7 and 8 reported as skipped (no sizes), press 9 excluded. Then run without `--dry-run` with `DATABASE_URL`/`PG*` pointing at the test server (the backend container is simplest: copy the script and workbook in with `docker cp`, run `docker exec die-ordering-backend node /tmp/import-tooling-chart.cjs /tmp/chart.xlsx`, prefixing `MSYS_NO_PATHCONV=1`), and confirm `SELECT press, count(*) FROM tooling_combinations GROUP BY 1`.

- [ ] **Step 7: Commit**

```bash
git add server/services/toolingChart.cjs server/services/toolingChart.test.cjs server/scripts/import-tooling-chart.cjs
git commit -m "feat(tooling): combination chart parser, gate-two verdict and import script"
```

---

### Task 4: Inventory parsers and import script

**Files:**
- Create: `server/services/toolingInventory.cjs`
- Create: `server/scripts/import-tooling-inventory.cjs`
- Test: `server/services/toolingInventory.test.cjs`

**Interfaces:**
- Consumes: `parseToolingNumber`, `normalizeSizeClass`, `pressFromGex2Location` (Task 1)
- Produces:
  - `parseGex2InventorySheet(rows: any[][], { sheetName: string }) → ToolingRow[]` — reads every block whose header cell is `Insert No` or `Bolster No`; skips `Ring No` blocks and blocks whose title contains `INSERT HOLDER`
  - `parseGex1InsertSheet(rows: any[][]) → ToolingRow[]` — the four side-by-side `SN / Insert number / Press -N` blocks, merged by canonical number
  - `parseGex1BolsterSheet(rows: any[][]) → ToolingRow[]` — the `PRESS / BOL NO. / BOL SIZE / A(LEN) / B(WED)` blocks (both halves of the row)
  - `ToolingRow = { number, kind, plant, held_presses: string[], size_class, size_class_source: 'inventory'|null, size_class_confidence: 'confirmed'|null, cavities, category, location, made_for_die, inventory_dims, source }`
  - `buildToolingUpsert(row: ToolingRow) → { sql: string, params: any[] }` — `INSERT … ON CONFLICT (number) DO UPDATE` that merges `held_presses` (union), fills `size_class` only when the existing one is NULL, updates `location`, `category`, `cavities`, `inventory_dims`, `updated_at`, and **never** sets `status`
  - `mergeToolingRows(rows: ToolingRow[]) → ToolingRow[]` — one row per number, `held_presses` unioned

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./toolingInventory.cjs');

// Trimmed copies of the real sheets.
const GEX2_35 = [
  ['35MN PRESS INSERT  ( SINGLE CAVITY ) ', '', '', '', '', '35MN PRESS INSERT  ( TWO CAVITY ) ', '', '', '', '', '35MN PRESS INSERT  HOLDER ', '', '', '', '', '35MN PRESS BOLSTER  HOLDER ', '', '', '', '', '35MN PRESS RING ', '', '', '', ''],
  ['Sr.No', 'Insert No', 'Size', 'Location', '', 'Sr.No', 'Insert No', 'Size', 'Location', '', 'Sr.No', 'Insert No', 'Size', 'Location', '', 'Sr.No', 'Bolster No', 'Size', 'Location', '', 'Sr.No', 'Ring No', 'Size', 'Qty', 'Location'],
  [1, '35IC1-120021', '300X100', 'P35', '', 1, '35IC2-200025', '300X100', 'P35', '', 1, '35IH-001', '600X420', 'P35', '', 1, '35B-101', '600X420', 'P35', '', 1, '35R1', '280X185', 1, 'P35'],
  [2, '35IC1-025576', '460x150', 'P35', '', 2, '35IC2E', '300X100', 'P35', '', '', '', '', '', '', 2, '35B-102', '', 'P35', '', '', '', '', '', ''],
];

test('GEX-2 sheet yields inserts and bolsters with press from the location, holders and rings skipped', () => {
  const rows = m.parseGex2InventorySheet(GEX2_35, { sheetName: '35MN PRESS ' });
  const numbers = rows.map((r) => r.number).sort();
  assert.deepEqual(numbers, ['35B-101', '35B-102', '35IC1-025576', '35IC1-120021', '35IC2-200025', '35IC2E'].map((n) => n.startsWith('35B') ? `BOL-${n}` : n).sort());
  const one = rows.find((r) => r.number === '35IC1-025576');
  assert.equal(one.kind, 'insert');
  assert.equal(one.plant, 'GEX 2');
  assert.deepEqual(one.held_presses, ['PRESS 8']);
  assert.equal(one.size_class, '460X150');
  assert.equal(one.size_class_source, 'inventory');
  assert.equal(one.size_class_confidence, 'confirmed');
  assert.equal(one.cavities, 1);
  assert.equal(one.category, 'INSERT (SINGLE CAVITY)');
  assert.equal(one.made_for_die, '025576');
  assert.equal(one.source, 'inventory-2025');
  const two = rows.find((r) => r.number === '35IC2-200025');
  assert.equal(two.cavities, 2);
  const bol = rows.find((r) => r.number === 'BOL-35B-102');
  assert.equal(bol.kind, 'bolster');
  assert.equal(bol.size_class, null);
  assert.equal(bol.category, 'BOLSTER HOLDER');
});

const GEX1_INSERTS = [
  ['SN', 'Insert number', 'Press -2', '', 'SN', 'Insert number', 'Press -4', '', 'SN', 'Insert number', 'Press -5', '', 'SN', 'Insert number', 'Press -6'],
  [1, 13212, 'Press-2', '', 1, 12540, 'Press-4', '', 1, 13212, 'Press-5', '', 1, 18573, 'Press-6'],
  [2, '05043', 'Press-2', '', '', '', '', '', 2, '05043', 'Press-5', '', '', '', ''],
];

test('merges one insert listed under two presses', () => {
  const rows = m.parseGex1InsertSheet(GEX1_INSERTS);
  assert.equal(rows.length, 4);
  const a = rows.find((r) => r.number === 'I-13212');
  assert.deepEqual(a.held_presses, ['PRESS 2', 'PRESS 5']);
  assert.equal(a.plant, 'GEX 1');
  assert.equal(a.kind, 'insert');
  assert.equal(a.size_class, null, 'the 2024 inventory has no size column');
  assert.equal(a.size_class_source, null);
  assert.equal(a.source, 'inventory-2024-12');
  assert.deepEqual(rows.find((r) => r.number === 'I-05043').held_presses, ['PRESS 2', 'PRESS 5']);
  assert.equal(rows.find((r) => r.number === 'I-18573').held_presses[0], 'PRESS 6');
});

const GEX1_BOLSTERS = [
  ['BOLSTER FOR  P2 AND P6', '', '', '', '', '', '', '', '', '', ''],
  ['PRESS', 'BOL NO.', 'BOL SIZE', 'A(LEN)', 'B(WED)', '', 'PRESS', 'BOL NO.', 'BOL SIZE', 'A(LEN)', 'B(WED)'],
  [6, 15109, '475X220', 350, 110, '', 2, 506, '475X220', 188, 88],
  [6, '2-1-C', '475X220', 150, 150, '', '', '', '', '', ''],
];

test('GEX-1 bolster sheet yields bolsters with inventory dimensions', () => {
  const rows = m.parseGex1BolsterSheet(GEX1_BOLSTERS);
  assert.deepEqual(rows.map((r) => r.number).sort(), ['BOL-15109', 'BOL-2-1-C', 'BOL-506']);
  const b = rows.find((r) => r.number === 'BOL-15109');
  assert.equal(b.kind, 'bolster');
  assert.deepEqual(b.held_presses, ['PRESS 6']);
  assert.equal(b.size_class, '475X220');
  assert.deepEqual(b.inventory_dims, { a_len: 350, b_wid: 110 });
  assert.equal(b.source, 'bolster-inventory-p2-p6');
});

test('upsert never writes status and keeps an existing size class', () => {
  const [row] = m.parseGex1BolsterSheet(GEX1_BOLSTERS);
  const { sql, params } = m.buildToolingUpsert(row);
  assert.match(sql, /INSERT INTO toolings/);
  assert.match(sql, /ON CONFLICT \(number\) DO UPDATE SET/);
  const updateClause = sql.split('DO UPDATE SET')[1];
  assert.ok(!/\bstatus\b/.test(updateClause), 'status is not touched on update');
  assert.match(updateClause, /size_class = COALESCE\(toolings\.size_class, EXCLUDED\.size_class\)/);
  assert.match(updateClause, /held_presses = \(SELECT ARRAY\(SELECT DISTINCT unnest\(toolings\.held_presses \|\| EXCLUDED\.held_presses\)\)\)/);
  assert.equal(params[0], 'BOL-15109');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/toolingInventory.test.cjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `server/services/toolingInventory.cjs`**

GEX-2 blocks: walk the header row (row index 1) for cells equal to `Insert No` / `Bolster No`; the block title is the nearest non-empty cell at or left of that column in row 0, with the leading `NNMN PRESS` removed, whitespace collapsed to single spaces, spaces just inside the parentheses dropped, and the result trimmed (`'35MN PRESS INSERT  ( SINGLE CAVITY ) '` → `INSERT (SINGLE CAVITY)`, `'35MN PRESS BOLSTER  HOLDER '` → `BOLSTER HOLDER`); `Size` is the next column, `Location` the one after. Bolster numbers go through `parseToolingNumber`; a GEX-2 bolster number that does not parse as a bolster is still stored as `BOL-<raw>` with kind `bolster` because the block says so. Plant is `GEX 2`; held press from `pressFromGex2Location(location)`, falling back to the sheet name (`25MN` → PRESS 7, `35MN` → PRESS 8). GEX-1 inserts: blocks every 4 columns starting at 0; held press from the `Press -N` header → `PRESS N`; the sheet lists bare numbers, so build `'I-' + String(cell).padStart(5, '0')` and pass that through `parseToolingNumber` (`13212` → `I-13212`, `05043` → `I-05043`); a cell that does not yield an insert is reported as skipped. GEX-1 bolsters: two blocks at columns 0 and 6; press from the `PRESS` cell → `PRESS N`; `inventory_dims` only when both A and B are numbers. All three parsers end with `mergeToolingRows`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/toolingInventory.test.cjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Write `server/scripts/import-tooling-inventory.cjs`**

Usage: `node server/scripts/import-tooling-inventory.cjs --gex2 <Tooling Inventory-2025.xlsx> --gex1-inserts <Tooling inventory-27.12 2024.xlsx> --gex1-bolsters <Bolster Inventory(P2-P6).xlsx> [--dry-run]`. Any subset of the three flags may be given. Sheets: GEX-2 `35MN PRESS ` (trailing space) and `25MN PRESS`; GEX-1 inserts `Tooling inventoy 27.12.2024` (sic); GEX-1 bolsters `ALL BOLSTER`. Prints per source: parsed, new, updated (by comparing `SELECT number FROM toolings` beforehand), and the rows it skipped with the raw cell. Runs all upserts in one transaction. Never deletes.

- [ ] **Step 6: Dry-run, then import on the test server**

Run the dry run against the three real files under `C:/Users/vijee/Desktop/18.06.2026/New folder/14.Die Toolings/` (paths in the spec's data table). Expected order of magnitude: GEX-2 about 445 inserts + 85 bolsters; GEX-1 about 700 inserts, fewer unique after merging; GEX-1 bolsters about 80. Then import on the test server the same way as Task 3 Step 6 and check `SELECT plant, kind, count(*) FROM toolings GROUP BY 1, 2`.

- [ ] **Step 7: Commit**

```bash
git add server/services/toolingInventory.cjs server/services/toolingInventory.test.cjs server/scripts/import-tooling-inventory.cjs
git commit -m "feat(tooling): inventory parsers for both plants and the import script"
```

---

### Task 5: Die list → die_tooling_links (import route + backfill script)

**Files:**
- Create: `server/services/dieToolingLinks.cjs`
- Create: `server/scripts/backfill-die-tooling-links.cjs`
- Modify: `server/routes/existing-data.cjs:95-150` (die-details import handler)
- Test: `server/services/dieToolingLinks.test.cjs`

**Interfaces:**
- Consumes: `resolveToolingRef` (Task 1), `normalizePlant` (`server/services/frozenDesigns.cjs`)
- Produces:
  - `loadKnownToolings(client) → Promise<{ inserts: Set<string>, bolsters: Set<string> }>` (`SELECT number, kind FROM toolings`)
  - `linksFromDieList(rows: Array<{ dieNo: string, plant: string, bolsterNo: string|null }>, known) → LinkRow[]` where `LinkRow = { die_no, plant, tooling_number, kind, raw_value, source: 'die-list' }`; rows with empty `bolsterNo` produce nothing; `plant` is passed through `normalizePlant`
  - `replaceDieListLinks(client, plant, links: LinkRow[]) → Promise<number>` — `DELETE FROM die_tooling_links WHERE source = 'die-list' AND plant = $1` then multi-row insert; returns inserted count

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./dieToolingLinks.cjs');

const known = { inserts: new Set(['I-12495', 'I-15109']), bolsters: new Set(['BOL-4-6-A', 'BOL-15109', 'BOL-302']) };

test('die list values become typed links, plant normalised, blanks dropped', () => {
  const links = m.linksFromDieList([
    { dieNo: '22413_401', plant: 'GEX 01', bolsterNo: 'I-12495' },
    { dieNo: '27324_401', plant: 'GEX 01', bolsterNo: 'BOL-4-6-A' },
    { dieNo: '19882_601', plant: 'GEX 01', bolsterNo: 'B-6-1-C' },
    { dieNo: '17940_601', plant: 'GEX 01', bolsterNo: '302' },
    { dieNo: '10772_404', plant: 'GEX 01', bolsterNo: '2(=)' },
    { dieNo: '12555_101', plant: 'GEX 01', bolsterNo: null },
  ], known);
  assert.equal(links.length, 5);
  assert.deepEqual(links[0], { die_no: '22413_401', plant: 'GEX 1', tooling_number: 'I-12495', kind: 'insert', raw_value: 'I-12495', source: 'die-list' });
  assert.equal(links[1].tooling_number, 'BOL-4-6-A');
  assert.equal(links[2].tooling_number, 'BOL-6-1-C', 'a bolster the master does not list is still a typed link');
  assert.deepEqual(links[3], { die_no: '17940_601', plant: 'GEX 1', tooling_number: 'BOL-302', kind: 'bolster', raw_value: '302', source: 'die-list' });
  assert.deepEqual(links[4], { die_no: '10772_404', plant: 'GEX 1', tooling_number: null, kind: 'unknown', raw_value: '2(=)', source: 'die-list' });
});

test('resolves a bare number to unknown when both kinds exist', () => {
  const [link] = m.linksFromDieList([{ dieNo: '14516_202', plant: 'GEX 1', bolsterNo: '15109' }], known);
  assert.equal(link.kind, 'unknown');
  assert.equal(link.tooling_number, null);
  assert.equal(link.raw_value, '15109');
});

test('replaceDieListLinks deletes only this plant and source, then inserts', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: params?.length ? 1 : 0, rows: [] }; } };
  const n = await m.replaceDieListLinks(client, 'GEX 1', [
    { die_no: 'a', plant: 'GEX 1', tooling_number: 'I-12495', kind: 'insert', raw_value: 'I-12495', source: 'die-list' },
  ]);
  assert.match(calls[0].sql, /DELETE FROM die_tooling_links WHERE source = 'die-list' AND plant = \$1/);
  assert.deepEqual(calls[0].params, ['GEX 1']);
  assert.match(calls[1].sql, /INSERT INTO die_tooling_links/);
  assert.equal(n, 1);
});

test('no links means delete only, insert count zero', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 0, rows: [] }; } };
  assert.equal(await m.replaceDieListLinks(client, 'GEX 2', []), 0);
  assert.equal(calls.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/dieToolingLinks.test.cjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `server/services/dieToolingLinks.cjs`**

`linksFromDieList` maps each row through `resolveToolingRef(bolsterNo, known)`; `replaceDieListLinks` builds one multi-row `INSERT` (6 columns per row, `$n` placeholders) after the scoped delete.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/dieToolingLinks.test.cjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Wire the die-details import route**

In `server/routes/existing-data.cjs`, inside the die-details import transaction after `insertRows(client, 'existing_die_details', …)`: when `replace` is true, call `loadKnownToolings(client)`, build `linksFromDieList` from the mapped rows (`m.dieNo`, `plant`, `m.bolsterNo`) and call `replaceDieListLinks(client, normalizePlant(plant), links)`; when `replace` is false (a later chunk of the same sheet), insert the chunk's links without deleting (export an `insertDieListLinks(client, links)` for this, same insert statement). Add `linksWritten` to the JSON response.

- [ ] **Step 6: Write `server/scripts/backfill-die-tooling-links.cjs`**

Usage: `node server/scripts/backfill-die-tooling-links.cjs [--plant "GEX 1"] [--dry-run]`. Reads `SELECT die_no, plant, bolster_no FROM existing_die_details WHERE bolster_no IS NOT NULL`, groups by `normalizePlant(plant)`, and for each plant calls `replaceDieListLinks`. Prints per plant: rows read, links by kind (`insert` / `bolster` / `unknown`), and the 20 most frequent `unknown` raw values so the die shop can see what the field contains.

- [ ] **Step 7: Run the backfill on the test server**

Run the script against the test server (as in Task 3 Step 6) with `--dry-run`, then live. Expected on the test snapshot: GEX 1 about 20,500 links, mostly `insert`; GEX 2 none (its export lacks the column). Verify: `SELECT plant, kind, count(*) FROM die_tooling_links GROUP BY 1, 2`.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test`
Expected: PASS

```bash
git add server/services/dieToolingLinks.cjs server/services/dieToolingLinks.test.cjs server/scripts/backfill-die-tooling-links.cjs server/routes/existing-data.cjs
git commit -m "feat(tooling): die list IDBolster becomes die-tooling links on import, plus backfill"
```

---

### Task 6: Order creation records the form's insert and bolster numbers

**Files:**
- Modify: `src/components/modals/PDFImportModal.jsx:658-700` (the `mainOrder` object)
- Modify: `server/routes/orders.cjs:251-300` (`orderValidation`) and `:340-410` (`POST /`)
- Modify: `server/services/dieToolingLinks.cjs` (add `recordOrderToolingLinks`)
- Test: `server/services/dieToolingLinks.test.cjs` (extend), `server/routes/orders.test.cjs` (extend)

**Interfaces:**
- Consumes: `resolveToolingRef`, `loadKnownToolings` (Tasks 1, 5)
- Produces:
  - `recordOrderToolingLinks(client, { dieNo, plant, insertNo, bolsterNo }) → Promise<LinkRow[]>` — resolves each non-empty value, deletes existing `source = 'order-pdf'` links for that `die_no`, inserts the new ones, returns them
  - The `POST /api/orders` body accepts two optional string fields `Insert No` and `Bolster No`; the PDF importer sends the numbers it already extracts on the **main** order (sub-orders unchanged)

- [ ] **Step 1: Write the failing service test**

Add to `server/services/dieToolingLinks.test.cjs`:

```js
test('order links replace the die\'s order-pdf links and type each value', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM toolings/.test(sql)) return { rows: [{ number: 'I-05138', kind: 'insert' }] };
    return { rowCount: 1, rows: [] };
  } };
  const links = await m.recordOrderToolingLinks(client, { dieNo: '30725-201', plant: 'GEX 2', insertNo: 'I-05138', bolsterNo: 'old' });
  assert.deepEqual(links.map((l) => [l.kind, l.tooling_number, l.raw_value]), [['insert', 'I-05138', 'I-05138'], ['unknown', null, 'old']]);
  assert.ok(calls.some((c) => /DELETE FROM die_tooling_links WHERE source = 'order-pdf' AND die_no = \$1/.test(c.sql)));
  assert.ok(calls.every((c) => !/DELETE FROM die_tooling_links WHERE source = 'order-pdf'\s*$/.test(c.sql)), 'never an unscoped delete');
});

test('order links with neither number do nothing', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; } };
  assert.deepEqual(await m.recordOrderToolingLinks(client, { dieNo: 'x', plant: 'GEX 1', insertNo: '', bolsterNo: null }), []);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/services/dieToolingLinks.test.cjs`
Expected: FAIL, `m.recordOrderToolingLinks is not a function`

- [ ] **Step 3: Implement `recordOrderToolingLinks` in `server/services/dieToolingLinks.cjs`**

Source `'order-pdf'`; plant through `normalizePlant`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/services/dieToolingLinks.test.cjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Write the failing route test**

Look at how `server/routes/orders.test.cjs` builds its fake db and a creator token, and add one test in the same style:

```js
test('an unrecognised insert number still creates the order and records an unknown link', async () => {
  // fake db: INSERT INTO die_orders → { rows: [{ id: 501 }] }; SELECT number, kind FROM toolings → []; everything else → { rows: [], rowCount: 0 }
  const seen = [];
  // … install the fake so every query is pushed to `seen` …
  const res = await request(base, '/api/orders', { token, body: { Plant: 'GEX 2', 'DIE NO': '30725-201', 'Insert No': 'old', 'Bolster No': 'B-12345', STATUS: 'PENDING FOR ORDERING' } });
  assert.equal(res.status, 201);
  const linkInsert = seen.find((q) => /INSERT INTO die_tooling_links/.test(q.sql));
  assert.ok(linkInsert, 'links were written');
  assert.ok(linkInsert.params.includes('BOL-12345'));
  assert.ok(linkInsert.params.includes('old'));
});
```

- [ ] **Step 6: Run to verify failure**

Run: `node --test server/routes/orders.test.cjs`
Expected: the new test FAILS (`links were written`)

- [ ] **Step 7: Accept and record the fields in `server/routes/orders.cjs`**

Add `body('Insert No').optional().customSanitizer(sanitizeString)` and `body('Bolster No').optional().customSanitizer(sanitizeString)` to `orderValidation`. In `POST /`, after the `INSERT INTO die_orders … RETURNING id` resolves, call `recordOrderToolingLinks(pool, { dieNo: order['DIE NO'], plant: order['Plant'], insertNo: order['Insert No'], bolsterNo: order['Bolster No'] })` wrapped in `try/catch` that logs and continues (a link failure must never fail order creation). Do not add the fields to `PUT /:id`.

- [ ] **Step 8: Send the numbers from the PDF importer**

In `src/components/modals/PDFImportModal.jsx`, add to `mainOrder` (line ~658): `'Insert No': insertNo || null, 'Bolster No': bolsterNo || null`. Leave `createSubOrder` as it is. Check that the import preview's "fields" table ignores unknown keys (grep for where `mainOrder` keys are rendered) and that nothing strips them before `ordersAPI.create`.

- [ ] **Step 9: Run tests, lint the touched files, build**

Run: `npm test && npx eslint src/components/modals/PDFImportModal.jsx server/routes/orders.cjs server/services/dieToolingLinks.cjs && npm run build`
Expected: tests PASS, no new lint errors, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add server/routes/orders.cjs server/routes/orders.test.cjs server/services/dieToolingLinks.cjs server/services/dieToolingLinks.test.cjs src/components/modals/PDFImportModal.jsx
git commit -m "feat(tooling): imported order PDFs record their insert and bolster numbers as links"
```

---

### Task 7: Read API and client

**Files:**
- Create: `server/routes/toolings.cjs`
- Modify: `server/index.cjs:~112` (register `app.use('/api/toolings', authMiddleware, toolingsRouter)`)
- Modify: `src/api.js` (add `toolingsAPI` after `frozenDesignsAPI`)
- Test: `server/routes/toolings.test.cjs`, `src/api.test.js` (extend)

**Interfaces:**
- Consumes: `chartVerdict`, `parseChartRows` shape (Task 3); tables (Task 2)
- Produces:
  - `GET /api/toolings?plant=&kind=&press=&sizeClass=&status=&q=&limit=&offset=` → `{ items: Tooling[], total: number }`; `Tooling` is the row plus `opening_confidence` (from `tooling_openings`, `'none'` when no row) and `linked_dies: number` (count of `die_tooling_links` rows for the number). Defaults: `status=active`, `limit=50` (max 200). `press` matches `held_presses @> ARRAY[$press]`. `q` is a case-insensitive substring on `number`.
  - `GET /api/toolings/combinations?press=&dieSize=` → `{ press, dieSize, rows: ChartRow[], insertSizes: string[], bolsterSizes: string[], verdictBasis: 'chart'|'no_chart' }`
  - `GET /api/toolings/:number` → `{ tooling, opening: ToolingOpening|null, links: Array<{ die_no, plant, source, seen_at, die: { die_size, press, cavity, die_status } | null }> }` with `die` taken from `existing_die_details` by `die_no`; 404 when unknown
  - Client: `toolingsAPI.list(params)`, `toolingsAPI.get(number)`, `toolingsAPI.combinations({ press, dieSize })` in `src/api.js`, built like `frozenDesignsAPI.list`

- [ ] **Step 1: Write the failing route tests**

```js
'use strict';
process.env.JWT_SECRET = 'toolings-test-secret-at-least-32-characters-long';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

const TOOLING = { id: 1, number: '25IC2-110634', kind: 'insert', plant: 'GEX 2', held_presses: ['PRESS 7'], size_class: '460X150', cavities: 2, status: 'active' };
const queries = [];
installFakeDb(async (sql, params = []) => {
  queries.push({ sql, params });
  if (/SELECT count\(\*\)/i.test(sql)) return { rows: [{ count: '1' }] };
  if (/FROM toolings t/.test(sql) && /WHERE t\.number = \$1/.test(sql)) {
    return params[0] === '25IC2-110634' ? { rows: [{ ...TOOLING, opening_confidence: 'none' }] } : { rows: [] };
  }
  if (/FROM toolings t/.test(sql)) return { rows: [{ ...TOOLING, opening_confidence: 'none', linked_dies: 2 }] };
  if (/FROM tooling_openings/.test(sql)) return { rows: [] };
  if (/FROM die_tooling_links/.test(sql)) return { rows: [{ die_no: '110634-2501', plant: 'GEX 2', source: 'die-list', seen_at: '2026-11-07', die_size: '250X140', press: 'PRESS 7', cavity: 2, die_status: 'AVAILABLE' }] };
  if (/FROM tooling_combinations/.test(sql)) return { rows: params[0] === 'PRESS 7' ? [] : [{ press: 'PRESS 6', die_size: '355X200', insert_size: '460X150', bolster_size: '700X196' }, { press: 'PRESS 6', die_size: '355X200', insert_size: '300X100', bolster_size: null }] };
  throw new Error(`unexpected query ${sql}`);
});

const router = require('./toolings.cjs');
const app = express();
app.use(express.json());
app.use('/api/toolings', router);
let base; let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(async () => { await close(); });

test('list returns items with opening confidence and link counts', async () => {
  const res = await request(base, '/api/toolings?plant=GEX%202&kind=insert&press=PRESS%207');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].number, '25IC2-110634');
  assert.equal(res.body.items[0].opening_confidence, 'none');
  assert.equal(res.body.items[0].linked_dies, 2);
  const listQuery = queries.find((q) => /FROM toolings t/.test(q.sql) && !/t\.number = \$1/.test(q.sql));
  assert.ok(listQuery.params.includes('active'), 'status defaults to active');
  assert.ok(listQuery.params.includes('PRESS 7'));
});

test('detail joins the opening and the linked dies', async () => {
  const res = await request(base, '/api/toolings/25IC2-110634');
  assert.equal(res.status, 200);
  assert.equal(res.body.tooling.number, '25IC2-110634');
  assert.equal(res.body.opening, null);
  assert.equal(res.body.links[0].die.die_size, '250X140');
});

test('detail is 404 for an unknown number', async () => {
  const res = await request(base, '/api/toolings/NOPE');
  assert.equal(res.status, 404);
});

test('combinations lists allowed sizes for a press and die size, and says when there is no chart', async () => {
  const ok = await request(base, '/api/toolings/combinations?press=PRESS%206&dieSize=355x200');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.insertSizes, ['300X100', '460X150']);
  assert.deepEqual(ok.body.bolsterSizes, ['700X196']);
  assert.equal(ok.body.verdictBasis, 'chart');
  const none = await request(base, '/api/toolings/combinations?press=PRESS%207&dieSize=250X140');
  assert.equal(none.body.verdictBasis, 'no_chart');
  assert.deepEqual(none.body.rows, []);
});

test('combinations requires press and dieSize', async () => {
  const res = await request(base, '/api/toolings/combinations?press=PRESS%206');
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/routes/toolings.test.cjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `server/routes/toolings.cjs`**

Follow `server/routes/frozen-designs.cjs` for shape. The list query selects from `toolings t LEFT JOIN tooling_openings o ON o.tooling_id = t.id` with `COALESCE(o.confidence, 'none') AS opening_confidence` and a correlated `(SELECT count(*) FROM die_tooling_links l WHERE l.tooling_number = t.number)::int AS linked_dies`, filters built from the present query params only, `ORDER BY t.number`, plus a separate `SELECT count(*)` with the same `WHERE`. The combinations route normalises `press` with `resolvePress`-style tolerance (accept `PRESS 6`, `P6`, `6`: use `canonicalPress`/`resolvePress` from `server/services/dieListImport.cjs` with `loadPresses` from `frozenDesigns.cjs`, or the plain name when it already starts with `PRESS `) and `dieSize` with `normalizeSizeClass`; `verdictBasis` is `no_chart` when the press has no rows at all (query without the die size filter). Register the `/combinations` route **before** `/:number`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/routes/toolings.test.cjs`
Expected: PASS, 5 tests

- [ ] **Step 5: Register the router in `server/index.cjs`**

Next to the frozen-designs line: `app.use('/api/toolings', authMiddleware, toolingsRouter);` — auth only; page access is added in Plan 5 when the Tooling page exists.

- [ ] **Step 6: Add the client API and its test**

In `src/api.js` after `frozenDesignsAPI`:

```js
export const toolingsAPI = {
    list: async (params = {}) => { /* same query-string builder as frozenDesignsAPI.list, path /toolings */ },
    get: async (number) => apiRequest(`/toolings/${encodeURIComponent(number)}`),
    combinations: async ({ press, dieSize }) => apiRequest(`/toolings/combinations?${new URLSearchParams({ press, dieSize })}`),
};
```

In `src/api.test.js`, import `toolingsAPI` and add:

```js
test('toolingsAPI.get encodes the tooling number and list drops empty params', async () => {
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('{"items":[],"total":0}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  await toolingsAPI.get('BOL-4-6-A');
  await toolingsAPI.list({ plant: 'GEX 2', kind: '', press: undefined });
  assert.ok(urls[0].endsWith('/toolings/BOL-4-6-A'));
  assert.ok(urls[1].endsWith('/toolings?plant=GEX+2'));
});
```

- [ ] **Step 7: Run everything**

Run: `npm test && npx eslint server/routes/toolings.cjs src/api.js && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 8: Smoke-test on the test server**

Rebuild backend (`docker compose build backend && docker compose up -d --wait backend`, restart frontend if the IP moved), then from inside the backend container call the API with an admin token obtained the way other smoke checks in `dev-workflow` memory do, or simply sign in on the test server UI and open `/api/toolings?plant=GEX%202&limit=5` in the same browser session. Expected: JSON with the inserts imported in Task 4.

- [ ] **Step 9: Commit**

```bash
git add server/routes/toolings.cjs server/routes/toolings.test.cjs server/index.cjs src/api.js src/api.test.js
git commit -m "feat(tooling): read API for toolings, chart combinations and links; client toolingsAPI"
```

---

### Task 8: Runbook and hand-off notes

**Files:**
- Create: `docs/tooling-master-import-runbook.md`

- [ ] **Step 1: Write the runbook**

Short, in the style of `docs/sample-followup-import-runbook.md`: the three scripts (chart, inventory, backfill) with their exact commands and the real file paths, the order to run them (chart, inventory, backfill), what each prints, how to copy script + workbook into the backend container for the test server, the facts the operator must know (the 2024 inventory has no sizes, so GEX-1 inserts have `size_class NULL` until Plan 2; the all-presses chart sheet has no rows for presses 7 and 8, so every GEX-2 lookup answers `no_chart` until rows are added by hand; Press 9 is excluded), and the queries to verify counts afterwards.

- [ ] **Step 2: Commit**

```bash
git add docs/tooling-master-import-runbook.md
git commit -m "docs(tooling): import runbook for the tooling master"
```

---

## Self-review notes

- Spec coverage for this plan's slice: tooling master rows and scope rule (Task 4; `retired`/`unverified` statuses exist, nothing sets them yet — Plans 2 and 5), size-class rules (Tasks 1, 4; drawing-derived sizes are Plan 2), combination chart and gate two (Task 3), die → tooling links from die lists (Task 5) and order PDFs (Task 6), number normaliser shared by inventory and `IDBolster` (Task 1), no unscoped deletes and dry runs (Tasks 3–5), read API (Task 7). `tooling_openings` is created here (Task 2) and only read (Task 7); it is filled by Plan 2.
- Open fact for the user, surfaced in the runbook and the hand-off: the all-presses chart sheet carries no usable rows for presses 7 and 8, so GEX-2 has no gate-two data until someone supplies it.
