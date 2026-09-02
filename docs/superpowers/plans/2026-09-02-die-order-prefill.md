# Die Order PDF Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefill `DIE SIZE`, `SOLID`/`HOLLOW`, `BOLSTER No` and `SUPPLIER` in the Generate Die Order PDF modal from the most recent matching die order and the imported die list, writing into blank fields only.

**Architecture:** A server service module owns both lookups and is called by a new read-only endpoint and by the existing PDF generator. A pure client module owns the merge, so it can be tested outside React. The modal calls the endpoint beside the existing frozen-design match and hands both results to the merge function.

**Tech Stack:** Node 20 + Express + `pg` (CommonJS, `.cjs`), React 18 + Vite (ESM, `.jsx`/`.js`), Postgres 15, `node:test` for all tests.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-02-die-order-prefill-design.md`. Read it before starting.
- Backend files are CommonJS `.cjs` with `'use strict';` at the top. Frontend files are ESM.
- Tests run with `npm test`, which globs `server/**/*.test.cjs` and `src/**/*.test.js`.
- Backend tests mock the pg client — never connect to a real database in a test.
- `npm run lint` fails on 77 pre-existing problems repo-wide. Verify your own diff with `npx eslint <files>` instead, and confirm it introduces no new errors.
- **`docker compose restart` never picks up a source edit.** Both Dockerfiles COPY source into the image. Use `docker compose build <svc> && docker compose up -d <svc>`.
- The local Docker stack is a **TEST server**, not production. Never present counts queried there as facts about real data.
- Never run an unscoped `DELETE FROM <table>`. Delete only rows you created, by the exact keys you created them with.
- Authority order for every field: **request → frozen design → most recent order → die list**. A field that already holds a value is never overwritten.
- Existing files preserve CRLF line endings. Do not reformat whole files.

---

### Task 1: Extract die-list field mapping into a testable module and compose `die_size` as `<diam>X<thickness>`

The import currently stores `die_size` as `DiesDIAM` alone (`250`), but orders and frozen designs record `250X160`. The mapping helpers live inline in a route file with no test, so move them to a service first.

**Files:**
- Create: `server/services/dieListImport.cjs`
- Create: `server/services/dieListImport.test.cjs`
- Modify: `server/routes/existing-data.cjs` (remove the inline helpers, require the module)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `server/services/dieListImport.cjs` exporting
  `normalizeKey(key) → string`,
  `getField(row, aliases) → any|null`,
  `extractProfile(dieNo) → string|null`,
  `composeDieSize(row) → string|null`,
  and the alias constants `DIE_NO_ALIASES`, `PROFILE_ALIASES`, `CUSTOMER_ALIASES`, `PRESS_ALIASES`, `DIE_SIZE_ALIASES`, `DIE_DIAM_ALIASES`, `THICKNESS_ALIASES` (all `string[]`).

- [ ] **Step 1: Write the failing test**

Create `server/services/dieListImport.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./dieListImport.cjs');

// Verbatim column spelling from the GEX-01 die-management export.
const GEX_ROW = {
  IDDie: '29663_401', IDProfile: '29663', IDCustomer1: 'Gulf Extrusions Co .(L.L.C)',
  DiesDIAM: 250, Thickness: 160, PressPrimary: 'M_PRESS.4', DieType: 'Hollow',
};

test('normalizeKey collapses case and punctuation', () => {
  assert.equal(m.normalizeKey('Die No'), 'dieno');
  assert.equal(m.normalizeKey('die_no'), 'dieno');
  assert.equal(m.normalizeKey('DiesDIAM'), 'diesdiam');
  assert.equal(m.normalizeKey(null), '');
});

test('getField finds a value by any alias and skips blanks', () => {
  assert.equal(m.getField(GEX_ROW, m.DIE_NO_ALIASES), '29663_401');
  assert.equal(m.getField(GEX_ROW, m.PRESS_ALIASES), 'M_PRESS.4');
  assert.equal(m.getField({ IDDie: '   ' }, m.DIE_NO_ALIASES), null);
  assert.equal(m.getField({}, m.DIE_NO_ALIASES), null);
});

// Orders and frozen designs record die size as "250X160". Storing the bare
// diameter puts a "250" in front of the supplier on the generated PDF.
test('composeDieSize joins diameter and thickness', () => {
  assert.equal(m.composeDieSize(GEX_ROW), '250X160');
});

test('composeDieSize falls back to the diameter alone when thickness is missing', () => {
  assert.equal(m.composeDieSize({ DiesDIAM: 250 }), '250');
  assert.equal(m.composeDieSize({ DiesDIAM: 250, Thickness: '' }), '250');
});

test('composeDieSize prefers an explicit die size column when there is no diameter', () => {
  assert.equal(m.composeDieSize({ 'Die Size': '355x200' }), '355x200');
});

test('composeDieSize returns null when the row carries no size at all', () => {
  assert.equal(m.composeDieSize({ IDDie: '29663_401' }), null);
});

test('extractProfile takes the part before the dash and strips leading zeros', () => {
  assert.equal(m.extractProfile('01001-401'), '1001');
  assert.equal(m.extractProfile(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 dieListImport`
Expected: FAIL with `Cannot find module './dieListImport.cjs'`

- [ ] **Step 3: Write the module**

Create `server/services/dieListImport.cjs`:

```javascript
'use strict';

// Column aliases per field. normalizeKey() strips case and punctuation, so
// 'Die No', 'die_no' and 'DIE NO' collapse to one key — only genuinely
// different words need listing. The ID*/*Primary spellings are what the
// plants' own die-management system exports (e.g. the GEX-01 die list).
const DIE_NO_ALIASES = ['die no', 'die_no', 'die', 'die number', 'die number/name', 'die number name', 'iddie', 'die id'];
const PROFILE_ALIASES = ['profile', 'profile number', 'profile_number', 'idprofile', 'profile id'];
const CUSTOMER_ALIASES = ['customer', 'customer name', 'customer_name', 'party', 'client', 'idcustomer1', 'idcustomer'];
const PRESS_ALIASES = ['press', 'press name', 'press code', 'machine', 'pressprimary', 'primary press'];
const DIE_SIZE_ALIASES = ['die size', 'die_size', 'size', 'section size', 'profile size'];
const DIE_DIAM_ALIASES = ['diesdiam', 'die diam', 'die diameter', 'diameter'];
const THICKNESS_ALIASES = ['thickness', 'die thickness'];

const normalizeKey = (key) => String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const clean = (value, max = 500) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text.substring(0, max) : null;
};

const getField = (row, aliases) => {
    const normalized = {};
    Object.entries(row || {}).forEach(([key, value]) => {
        normalized[normalizeKey(key)] = value;
    });

    for (const alias of aliases) {
        const value = normalized[normalizeKey(alias)];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
            return value;
        }
    }
    return null;
};

const extractProfile = (dieNo) => {
    const text = clean(dieNo);
    if (!text) return null;
    return text.split('-')[0].replace(/^0+/, '') || null;
};

// Orders and frozen designs record die size as "<diameter>X<thickness>" (e.g.
// 250X160 — the most common value across 659 orders is exactly the 250 + 160
// pair). Storing the diameter alone makes the order-PDF prefill stamp a bare
// "250" where every other order says 250X160.
const composeDieSize = (row) => {
    const diam = clean(getField(row, DIE_DIAM_ALIASES), 100);
    const thickness = clean(getField(row, THICKNESS_ALIASES), 100);
    if (diam && thickness) return `${diam}X${thickness}`;
    return clean(getField(row, DIE_SIZE_ALIASES), 200) || diam;
};

module.exports = {
    normalizeKey, clean, getField, extractProfile, composeDieSize,
    DIE_NO_ALIASES, PROFILE_ALIASES, CUSTOMER_ALIASES, PRESS_ALIASES,
    DIE_SIZE_ALIASES, DIE_DIAM_ALIASES, THICKNESS_ALIASES,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `fail 0`

- [ ] **Step 5: Point the route at the module**

In `server/routes/existing-data.cjs`, delete the inline `clean`, `normalizeKey`, `getField`, `extractProfile` definitions and the seven alias constants, and replace them with:

```javascript
const {
    clean, getField, extractProfile, composeDieSize,
    DIE_NO_ALIASES, PROFILE_ALIASES, CUSTOMER_ALIASES, PRESS_ALIASES,
} = require('../services/dieListImport.cjs');
```

Then in the `/die-details/import` handler replace this line:

```javascript
            const dieSize = clean(getField(row, DIE_SIZE_ALIASES));
```

with:

```javascript
            const dieSize = composeDieSize(row);
```

Leave `insertRows`, `INSERT_BATCH` and both route bodies otherwise unchanged.

- [ ] **Step 6: Verify the route still parses and the suite passes**

Run: `node --check server/routes/existing-data.cjs && npm test 2>&1 | tail -6`
Expected: no syntax error; `fail 0`

- [ ] **Step 7: Commit**

```bash
git add server/services/dieListImport.cjs server/services/dieListImport.test.cjs server/routes/existing-data.cjs
git commit -m "refactor(die-list): extract import field mapping, compose die_size as <diam>X<thickness>"
```

- [ ] **Step 8: Rebuild the backend and re-import GEX 01**

```bash
docker compose build backend && docker compose up -d backend
```

Then in the browser, go to **Settings → Existing Data → Die Details**, select plant **GEX 01**, choose the plant's die list workbook, and click Import. It replaces the plant's rows and takes about 10 seconds.

Confirm the new shape:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT die_no, die_size FROM existing_die_details WHERE die_no IN ('01001_401','29663_401') ORDER BY die_no;"
```

Expected: `01001_401 | 250X160` and `29663_401 | 250X160`.

---

### Task 2: Server lookup module

**Files:**
- Create: `server/services/dieOrderPrefill.cjs`
- Create: `server/services/dieOrderPrefill.test.cjs`

**Interfaces:**
- Consumes: `normalizePlant` from `server/services/frozenDesigns.cjs` (already exported there).
- Produces: `server/services/dieOrderPrefill.cjs` exporting
  `pressNumber(raw) → number|null`,
  `stripProfile(raw) → string`,
  `findDieListMatch(client, { plant, profile, press, cavity }) → Promise<{die_no, plant, die_size, die_type, bolster_no, supplier}|null>`,
  `findRecentOrderMatch(client, { plant, profile, press }) → Promise<{die_no, plant, die_size, supplier, ordered_date}|null>`.

- [ ] **Step 1: Write the failing test**

Create `server/services/dieOrderPrefill.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('./dieOrderPrefill.cjs');

// Mock client that records queries and returns canned rows by matcher.
function makeClient(handlers = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const h of handlers) {
        if (h.match(sql)) return h.result(params);
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const dieListRows = (rows) => ({
  match: (sql) => sql.includes('existing_die_details'),
  result: () => ({ rows, rowCount: rows.length }),
});
const orderRows = (rows) => ({
  match: (sql) => sql.includes('die_orders'),
  result: () => ({ rows, rowCount: rows.length }),
});

// The die list writes 'M_PRESS.2'; requests and the presses master say 'PRESS 2'.
test('pressNumber reads the trailing integer from either spelling', () => {
  assert.equal(p.pressNumber('M_PRESS.2'), 2);
  assert.equal(p.pressNumber('PRESS 2'), 2);
  assert.equal(p.pressNumber('press 10'), 10);
  assert.equal(p.pressNumber(''), null);
  assert.equal(p.pressNumber(null), null);
});

// extractProfileFromDie strips leading zeros ('1001'), but the die list stores
// IDProfile verbatim ('01001') for 6,280 of 44,669 dies.
test('stripProfile removes leading zeros from both spellings', () => {
  assert.equal(p.stripProfile('01001'), '1001');
  assert.equal(p.stripProfile('1001'), '1001');
  assert.equal(p.stripProfile('29663'), '29663');
  assert.equal(p.stripProfile(null), '');
});

test('findDieListMatch returns the first row and passes the stripped profile', async () => {
  const client = makeClient([dieListRows([
    { die_no: '29663_213', plant: 'GEX 01', die_size: '355X200', die_type: 'Hollow', bolster_no: 'BOL-2-2-A', supplier: 'PDTMC' },
  ])]);
  const match = await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.equal(match.die_no, '29663_213');
  assert.equal(match.die_size, '355X200');
  assert.deepEqual(client.calls[0].params, ['29663', 2, '2']);
});

test('findDieListMatch keeps only rows whose plant matches after normalisation', async () => {
  const client = makeClient([dieListRows([
    { die_no: '29663_299', plant: 'GEX 02', die_size: '999X999', die_type: 'Solid', bolster_no: null, supplier: null },
    { die_no: '29663_213', plant: 'GEX 1', die_size: '355X200', die_type: 'Hollow', bolster_no: 'BOL-2-2-A', supplier: 'PDTMC' },
  ])]);
  const match = await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.equal(match.die_no, '29663_213');
});

test('findDieListMatch returns null when the key is incomplete', async () => {
  const client = makeClient([dieListRows([{ die_no: 'x' }])]);
  assert.equal(await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: '' }), null);
  assert.equal(await p.findDieListMatch(client, { plant: 'GEX 01', profile: '', press: 'PRESS 2', cavity: 2 }), null);
  assert.equal(client.calls.length, 0, 'must not query on an incomplete key');
});

test('findDieListMatch returns null when nothing matches', async () => {
  const client = makeClient([dieListRows([])]);
  assert.equal(await p.findDieListMatch(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 1 }), null);
});

// die_orders.press is set on 6 of 659 rows, so press comes from the die_no suffix.
test('findRecentOrderMatch queries by stripped profile and derived press', async () => {
  const client = makeClient([orderRows([
    { die_no: '18114-407', plant: 'GEX 1', die_size: '450x250', supplier: 'COMPES', ordered_date: '2026-05-26' },
  ])]);
  const match = await p.findRecentOrderMatch(client, { plant: 'GEX 01', profile: '018114', press: 'PRESS 4' });
  assert.equal(match.die_no, '18114-407');
  assert.equal(match.supplier, 'COMPES');
  assert.deepEqual(client.calls[0].params, ['18114', 4]);
});

test('findRecentOrderMatch skips orders from another plant', async () => {
  const client = makeClient([orderRows([
    { die_no: '18114-407', plant: 'GEX 2', die_size: '999x999', supplier: 'WEFA', ordered_date: '2026-05-26' },
    { die_no: '18114-408', plant: 'GEX 1', die_size: '450x250', supplier: 'COMPES', ordered_date: '2026-01-02' },
  ])]);
  const match = await p.findRecentOrderMatch(client, { plant: 'GEX 01', profile: '18114', press: 'PRESS 4' });
  assert.equal(match.die_no, '18114-408');
});

test('findRecentOrderMatch returns null without a usable press', async () => {
  const client = makeClient([orderRows([{ die_no: 'x' }])]);
  assert.equal(await p.findRecentOrderMatch(client, { plant: 'GEX 01', profile: '18114', press: '' }), null);
  assert.equal(client.calls.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 dieOrderPrefill`
Expected: FAIL with `Cannot find module './dieOrderPrefill.cjs'`

- [ ] **Step 3: Write the module**

Create `server/services/dieOrderPrefill.cjs`:

```javascript
'use strict';
const { normalizePlant } = require('./frozenDesigns.cjs');

// The die list writes press as 'M_PRESS.2'; requests and the presses master say
// 'PRESS 2'. The trailing integer is all the two spellings share.
function pressNumber(raw) {
  const m = String(raw == null ? '' : raw).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

// extractProfileFromDie hands us a zero-stripped profile ('1001'), but the die
// list stores IDProfile verbatim ('01001') for 6,280 of 44,669 dies. Stripping
// both sides is lossless: all 20,916 distinct profiles stay distinct.
function stripProfile(raw) {
  return String(raw == null ? '' : raw).trim().replace(/^0+/, '');
}

// Plant is filtered in JS rather than SQL so the tested normalizePlant helper
// stays the single definition of 'GEX 01' === 'GEX 1'. A profile+press+cavity
// group holds a handful of dies, so the LIMIT is never the binding constraint.
function pickForPlant(rows, plant) {
  const want = normalizePlant(plant);
  if (!want) return rows[0] || null;
  return rows.find((r) => normalizePlant(r.plant) === want) || null;
}

async function findDieListMatch(client, { plant, profile, press, cavity }) {
  const prof = stripProfile(profile);
  const pressNo = pressNumber(press);
  const cav = (cavity === null || cavity === undefined || cavity === '' || !Number.isFinite(Number(cavity)))
    ? null
    : String(Math.round(Number(cavity)));
  if (!prof || pressNo === null || cav === null) return null;

  const { rows } = await client.query(
    `SELECT die_no, plant, die_size,
            raw_data->>'DieType'      AS die_type,
            raw_data->>'IDBolster'    AS bolster_no,
            raw_data->>'NameSupplier' AS supplier
     FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND NULLIF(regexp_replace(press, '\\D', '', 'g'), '')::int = $2
       AND raw_data->>'NumHoles' = $3
     ORDER BY NULLIF(split_part(die_no, '_', 2), '')::int DESC NULLS LAST
     LIMIT 50`,
    [prof, pressNo, cav]
  );
  return pickForPlant(rows, plant);
}

// die_orders.press is populated on 6 of 659 rows and die_orders.cavity on 7, so
// press is derived from the die_no suffix instead ('18114-407' -> press 4). That
// rule was verified against the die list, where both are known: it holds for
// 43,662 of 44,667 dies. The 3-digit guard excludes GEX 2's 4-digit '-2502'
// suffixes, which encode the P25/P35 press codes rather than a press number.
async function findRecentOrderMatch(client, { plant, profile, press }) {
  const prof = stripProfile(profile);
  const pressNo = pressNumber(press);
  if (!prof || pressNo === null) return null;

  const { rows } = await client.query(
    `SELECT die_no, plant, die_size, supplier, ordered_date
     FROM die_orders
     WHERE ordered_date IS NOT NULL
       AND regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND split_part(die_no, '-', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '-', 2), 1)::int = $2
     ORDER BY ordered_date DESC
     LIMIT 50`,
    [prof, pressNo]
  );
  return pickForPlant(rows, plant);
}

module.exports = { pressNumber, stripProfile, findDieListMatch, findRecentOrderMatch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `fail 0`

- [ ] **Step 5: Add the supporting index**

`existing_die_details` is indexed on `plant` and `die_no` but not `profile_number`, which every lookup filters on. Add it to both schema files.

In `init.sql`, after the line `CREATE INDEX IF NOT EXISTS idx_existing_die_details_die_no ON existing_die_details(die_no);` add:

```sql
CREATE INDEX IF NOT EXISTS idx_existing_die_details_profile ON existing_die_details(profile_number);
```

In `server/db.cjs`, find the matching `CREATE INDEX IF NOT EXISTS idx_existing_die_details_die_no` line inside the migration template literal and add the same statement immediately after it.

- [ ] **Step 6: Commit**

```bash
git add server/services/dieOrderPrefill.cjs server/services/dieOrderPrefill.test.cjs init.sql server/db.cjs
git commit -m "feat(die-order-prefill): server lookup for recent order and die list match"
```

---

### Task 3: Endpoint and API client

**Files:**
- Modify: `server/routes/existing-data.cjs` (add one route)
- Modify: `src/api.js` (add `existingDataAPI.matchDie`)
- Modify: `src/api.test.js` (add two tests)

**Interfaces:**
- Consumes: `findDieListMatch`, `findRecentOrderMatch` from Task 2.
- Produces: `GET /api/existing-data/die-match?plant=&profile=&press=&cavity=` returning `{ order, dieList }` where each is the row object from Task 2 or `null`; and `existingDataAPI.matchDie({ plant, profile, press, cavity }) → Promise<{order, dieList}>`.

- [ ] **Step 1: Write the failing test**

Append to `src/api.test.js`:

```javascript
test('matchDie sends the whole key as query parameters', async () => {
  let seenUrl = null;
  globalThis.fetch = async (url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ order: null, dieList: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  await existingDataAPI.matchDie({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.match(seenUrl, /\/existing-data\/die-match\?/);
  assert.match(seenUrl, /plant=GEX\+01/);
  assert.match(seenUrl, /profile=29663/);
  assert.match(seenUrl, /press=PRESS\+2/);
  assert.match(seenUrl, /cavity=2/);
});

test('matchDie passes both null sources through unchanged', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ order: null, dieList: null }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  const result = await existingDataAPI.matchDie({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 });
  assert.equal(result.order, null);
  assert.equal(result.dieList, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -B2 -A4 matchDie`
Expected: FAIL with `existingDataAPI.matchDie is not a function`

- [ ] **Step 3: Add the API client function**

In `src/api.js`, inside the `existingDataAPI` object, add after `getMeta`:

```javascript
    matchDie: async ({ plant, profile, press, cavity }) => {
        const query = new URLSearchParams({
            plant: plant ?? '', profile: profile ?? '',
            press: press ?? '', cavity: cavity ?? '',
        });
        return apiRequest(`/existing-data/die-match?${query}`);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `fail 0`

- [ ] **Step 5: Add the endpoint**

In `server/routes/existing-data.cjs`, add this require near the top, beside the existing ones:

```javascript
const { findDieListMatch, findRecentOrderMatch } = require('../services/dieOrderPrefill.cjs');
```

Then add this route immediately after the `/meta` route:

```javascript
// Prefill source for the Generate Die Order PDF modal. Reports what each source
// found without merging them — only the client knows which fields the user has
// already filled, and blank-only merging is the whole point.
router.get('/die-match', authMiddleware, async (req, res) => {
    const key = {
        plant: req.query.plant,
        profile: req.query.profile,
        press: req.query.press,
        cavity: req.query.cavity,
    };
    try {
        const [order, dieList] = await Promise.all([
            findRecentOrderMatch(pool, key),
            findDieListMatch(pool, key),
        ]);
        res.json({ order, dieList });
    } catch (error) {
        console.error('Die match lookup error:', error);
        res.status(500).json({ error: 'Die match lookup failed' });
    }
});
```

- [ ] **Step 6: Verify against the test stack**

```bash
node --check server/routes/existing-data.cjs && docker compose build backend && docker compose up -d backend
```

Then confirm the query runs against real data. Write `/tmp/check-match.cjs` inside the container:

```javascript
const { pool } = require('/app/server/db.cjs');
const p = require('/app/server/services/dieOrderPrefill.cjs');
(async () => {
  console.log('die list:', await p.findDieListMatch(pool, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2', cavity: 2 }));
  console.log('order:', await p.findRecentOrderMatch(pool, { plant: 'GEX 01', profile: '18114', press: 'PRESS 4' }));
  await pool.end();
})();
```

Run it:

```bash
docker cp /tmp/check-match.cjs die-ordering-backend:/tmp/check-match.cjs && MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node /tmp/check-match.cjs
```

Expected: the die-list line shows `die_no: '29663_213'`, `die_size: '355X200'`, `die_type: 'Hollow'`, `bolster_no: 'BOL-2-2-A'`. The order line shows a row or `null`.

- [ ] **Step 7: Commit**

```bash
git add server/routes/existing-data.cjs src/api.js src/api.test.js
git commit -m "feat(die-order-prefill): add GET /existing-data/die-match endpoint"
```

---

### Task 4: Client merge module

**Files:**
- Create: `src/utils/dieOrderPrefill.js`
- Create: `src/utils/dieOrderPrefill.test.js`

**Interfaces:**
- Consumes: the `{ order, dieList }` shape from Task 3.
- Produces: `src/utils/dieOrderPrefill.js` exporting
  `SUPPLIER_ALIASES` (object),
  `canonicalSupplier(raw, supplierNames) → string|null`,
  `applyPrefill(values, { order, dieList }, { supplierNames }) → { values, sources }`
  where `sources` maps a field name to a human label such as `'order 18114-407'`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/dieOrderPrefill.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrefill, canonicalSupplier } from './dieOrderPrefill.js';

const SUPPLIERS = ['ADEX', 'ALMAX', 'COMES', 'COMPES', 'EKSTEK', 'JIANGSU', 'PDTMC', 'PHME', 'PHOENIX', 'WEFA'];

const BLANK = {
  SUPPLIER: '', DIE_SIZE: '', SOLID: false, HOLLOW: false, BOLSTER_NO: '',
};
const ORDER = { die_no: '18114-407', die_size: '450x250', supplier: 'COMPES', ordered_date: '2026-05-26' };
const DIE_LIST = { die_no: '29663_213', die_size: '355X200', die_type: 'Hollow', bolster_no: 'BOL-2-2-A', supplier: 'PDTMC' };

test('a recent order supplies die size and supplier ahead of the die list', () => {
  const { values, sources } = applyPrefill(BLANK, { order: ORDER, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.DIE_SIZE, '450x250');
  assert.equal(values.SUPPLIER, 'COMPES');
  assert.equal(sources.DIE_SIZE, 'order 18114-407');
  assert.equal(sources.SUPPLIER, 'order 18114-407');
});

test('the die list supplies solid/hollow and bolster, which no order records', () => {
  const { values, sources } = applyPrefill(BLANK, { order: ORDER, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.HOLLOW, true);
  assert.equal(values.SOLID, false);
  assert.equal(values.BOLSTER_NO, 'BOL-2-2-A');
  assert.equal(sources.BOLSTER_NO, 'die list 29663_213');
});

test('the die list fills die size and supplier when there is no order', () => {
  const { values } = applyPrefill(BLANK, { order: null, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.DIE_SIZE, '355X200');
  assert.equal(values.SUPPLIER, 'PDTMC');
});

// The frozen design has already written into values by the time this runs.
test('a field that already holds a value is never overwritten', () => {
  const filled = { ...BLANK, DIE_SIZE: '320X160', SUPPLIER: 'WEFA' };
  const { values, sources } = applyPrefill(filled, { order: ORDER, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.DIE_SIZE, '320X160');
  assert.equal(values.SUPPLIER, 'WEFA');
  assert.equal(sources.DIE_SIZE, undefined);
  assert.equal(sources.SUPPLIER, undefined);
});

// The list holds 'Hollow' (27,113), 'SOLID' (10,527) and 'Solid' (7,027).
test('die type is read case-insensitively', () => {
  assert.equal(applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, die_type: 'SOLID' } }, { supplierNames: SUPPLIERS }).values.SOLID, true);
  assert.equal(applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, die_type: 'Solid' } }, { supplierNames: SUPPLIERS }).values.SOLID, true);
  assert.equal(applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, die_type: 'Hollow' } }, { supplierNames: SUPPLIERS }).values.HOLLOW, true);
});

test('neither checkbox is touched when one is already ticked', () => {
  const ticked = { ...BLANK, SOLID: true };
  const { values } = applyPrefill(ticked, { order: null, dieList: DIE_LIST }, { supplierNames: SUPPLIERS });
  assert.equal(values.SOLID, true);
  assert.equal(values.HOLLOW, false);
});

test('an empty bolster leaves the field blank rather than writing an empty string', () => {
  const { values, sources } = applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, bolster_no: '' } }, { supplierNames: SUPPLIERS });
  assert.equal(values.BOLSTER_NO, '');
  assert.equal(sources.BOLSTER_NO, undefined);
});

test('supplier aliases resolve the two Phoenix spellings', () => {
  assert.equal(canonicalSupplier('PHOEINIX', SUPPLIERS), 'PHOENIX');
  assert.equal(canonicalSupplier('Phoenix Middle East', SUPPLIERS), 'PHME');
  assert.equal(canonicalSupplier('pdtmc', SUPPLIERS), 'PDTMC');
});

// MODE OF SHIPMENT is derived from the matched supplier record, so a name that
// is not in the master would strand it blank.
test('a supplier absent from the master is not filled at all', () => {
  assert.equal(canonicalSupplier('EROGA', SUPPLIERS), null);
  const { values, sources } = applyPrefill(BLANK, { order: null, dieList: { ...DIE_LIST, supplier: 'EROGA' } }, { supplierNames: SUPPLIERS });
  assert.equal(values.SUPPLIER, '');
  assert.equal(sources.SUPPLIER, undefined);
});

test('no sources at all leaves every value untouched', () => {
  const { values, sources } = applyPrefill(BLANK, { order: null, dieList: null }, { supplierNames: SUPPLIERS });
  assert.deepEqual(values, BLANK);
  assert.deepEqual(sources, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 dieOrderPrefill`
Expected: FAIL with `Cannot find module` for `./dieOrderPrefill.js`

- [ ] **Step 3: Write the module**

Create `src/utils/dieOrderPrefill.js`:

```javascript
// Prefill for the Generate Die Order PDF modal. Kept out of BackupDieRequests.jsx
// (1,453 lines, no component test framework) so the merge rules can be tested.

// Only 38.8% of dies name a supplier that matches the master exactly; these two
// aliases cover a further 8,873 dies, lifting coverage to 58.7%. Follows the
// SUPPLIER_ALIASES precedent in components/modals/PDFImportModal.jsx.
export const SUPPLIER_ALIASES = {
  'PHOEINIX': 'PHOENIX',
  'PHOENIX MIDDLE EAST': 'PHME',
};

// MODE OF SHIPMENT is derived from the matched supplier record, so a name that
// is not in the master is worse than no name at all — return null and leave the
// field blank rather than stranding the shipment mode.
export const canonicalSupplier = (raw, supplierNames) => {
  const key = String(raw ?? '').trim().toUpperCase();
  if (!key) return null;
  const aliased = SUPPLIER_ALIASES[key] || key;
  return (supplierNames || []).find((n) => String(n).trim().toUpperCase() === aliased) || null;
};

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

export const applyPrefill = (values, { order, dieList } = {}, { supplierNames = [] } = {}) => {
  const next = { ...values };
  const sources = {};
  const label = (row, kind) => `${kind} ${row.die_no}`;

  // DIE SIZE and SUPPLIER: a recent purchase outranks the historical die list.
  // Whatever the request or the frozen design already wrote stays put.
  for (const [row, kind] of [[order, 'order'], [dieList, 'die list']]) {
    if (!row) continue;

    if (isBlank(next.DIE_SIZE) && !isBlank(row.die_size)) {
      next.DIE_SIZE = String(row.die_size).trim();
      sources.DIE_SIZE = label(row, kind);
    }

    if (isBlank(next.SUPPLIER)) {
      const supplier = canonicalSupplier(row.supplier, supplierNames);
      if (supplier) {
        next.SUPPLIER = supplier;
        sources.SUPPLIER = label(row, kind);
      }
    }
  }

  if (!dieList) return { values: next, sources };

  // Orders record no die type and no bolster, so these two are die-list only.
  if (!next.SOLID && !next.HOLLOW) {
    const type = String(dieList.die_type ?? '').trim().toUpperCase();
    if (type === 'SOLID' || type === 'HOLLOW') {
      next[type] = true;
      sources[type] = label(dieList, 'die list');
    }
  }

  if (isBlank(next.BOLSTER_NO) && !isBlank(dieList.bolster_no)) {
    next.BOLSTER_NO = String(dieList.bolster_no).trim();
    sources.BOLSTER_NO = label(dieList, 'die list');
  }

  return { values: next, sources };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/utils/dieOrderPrefill.js src/utils/dieOrderPrefill.test.js
git commit -m "feat(die-order-prefill): pure merge module for order and die-list sources"
```

---

### Task 5: Wire the modal to the lookup and show provenance

**Files:**
- Modify: `src/components/backup/BackupDieRequests.jsx` (imports, `openOrderModal`, four field blocks)

**Interfaces:**
- Consumes: `existingDataAPI.matchDie` (Task 3) and `applyPrefill` (Task 4).
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Add the imports**

In `src/components/backup/BackupDieRequests.jsx`, add `existingDataAPI` to the existing `../../api` import, and add:

```javascript
import { applyPrefill } from '../../utils/dieOrderPrefill';
```

- [ ] **Step 2: Add the provenance state**

Beside `const [orderValues, setOrderValues] = useState(null);` (line 95) add:

```javascript
  const [orderSources, setOrderSources] = useState({});
```

- [ ] **Step 3: Call the lookup in `openOrderModal`**

In `openOrderModal`, replace the whole `setOrderValues({ ... }); setShowOrderModal(true);` tail — from `const src = frozen?.source_order || {};` down to `setShowOrderModal(true);` — with:

```javascript
    const src = frozen?.source_order || {};
    const initialSupplier = frozen?.supplier || src.supplier || '';
    const matchedSupplier = suppliers.find((s) => s.name === initialSupplier);
    const baseValues = {
      SUPPLIER: initialSupplier,
      DATE: getTodayDateString(),
      DIE_SIZE: frozen?.die_size || src.die_size || '',
      NO_OF_CAV: request['Cavity'] ? String(request['Cavity']) : (src.cavity ? String(src.cavity) : ''),
      PRESS: request['Press'] || src.press || '',
      SOLID: false,
      HOLLOW: false,
      BOLSTER_NO: '',
      INSERT_NO: '',
      BOLSTER_SIZE: '',
      INSERT_SIZE: '',
      DELIVERY_DATE: request['Requested Date'] || '',
      THREE_D_MODULE: false,
      REASON: '',
      SHIPMENT: matchedSupplier?.shipment_mode || src.shipment_type || '',
      PROFILE_WEIGHT_PCT: '',
      FINISH_MILL: false,
      FINISH_ANODIZING: false,
      FINISH_POWDER: false,
      PENDING_ORDER_KG: '0',
    };

    // History fills only what the request and the frozen design left blank.
    let match = { order: null, dieList: null };
    try {
      match = await existingDataAPI.matchDie({
        plant: request['Plant'],
        profile: extractProfileFromDie(request['DIE NO']),
        press: baseValues.PRESS,
        cavity: baseValues.NO_OF_CAV,
      });
    } catch { /* lookup failed — open the modal with what we already have */ }

    const { values, sources } = applyPrefill(baseValues, match, {
      supplierNames: suppliers.map((s) => s.name),
    });

    // MODE OF SHIPMENT follows whichever supplier ended up selected.
    if (values.SUPPLIER !== baseValues.SUPPLIER) {
      const filledSupplier = suppliers.find((s) => s.name === values.SUPPLIER);
      values.SHIPMENT = filledSupplier?.shipment_mode || values.SHIPMENT;
    }

    setOrderValues(values);
    setOrderSources(sources);
    setShowOrderModal(true);
```

- [ ] **Step 4: Add the hint renderer**

Directly above the `return (` of the component body, add:

```javascript
  // Names where an auto-filled value came from, so the person generating a
  // supplier-facing PDF can see which numbers are history rather than input.
  const renderSourceHint = (field) => (
    orderSources[field]
      ? <span style={{ fontSize: '0.7rem', color: theme.textMuted, marginLeft: '8px' }}>from {orderSources[field]}</span>
      : null
  );
```

- [ ] **Step 5: Show the hint on the four fields**

In the order modal JSX, append `{renderSourceHint('<FIELD>')}` inside the closing `</label>` of each of these four labels:

- the `SUPPLIER` label → `{renderSourceHint('SUPPLIER')}`
- the `DIE SIZE` label (`htmlFor="backupdierequests-die-size"`) → `{renderSourceHint('DIE_SIZE')}`
- the `BOLSTER No` label (`htmlFor="backupdierequests-bolster-no"`) → `{renderSourceHint('BOLSTER_NO')}`
- the `SOLID` label → `{renderSourceHint('SOLID')}`, and the `HOLLOW` label → `{renderSourceHint('HOLLOW')}`

- [ ] **Step 6: Verify lint and build**

Run: `npx eslint src/components/backup/BackupDieRequests.jsx src/utils/dieOrderPrefill.js && npm run build 2>&1 | tail -4`
Expected: no new eslint errors beyond the file's pre-existing ones; build succeeds.

- [ ] **Step 7: Verify in the browser**

```bash
docker compose build frontend && docker compose up -d frontend
```

Open the app, go to **Backup Die Requests**, and click Generate Die Order PDF on a request whose profile exists in the die list. Confirm `DIE SIZE` reads like `355X200`, one of SOLID/HOLLOW is ticked, and each filled field carries a `from …` hint. Then edit a value and reopen a *different* request to confirm nothing you typed leaks across.

- [ ] **Step 8: Commit**

```bash
git add src/components/backup/BackupDieRequests.jsx
git commit -m "feat(die-order-prefill): prefill the order modal from history with visible provenance"
```

---

### Task 6: Route the PDF generator through the shared lookup

`backup-requests.cjs` has its own `die_size` query that reads the column directly. Now that the modal fills `DIE_SIZE` from the same data, two code paths could disagree about one die.

**Files:**
- Modify: `server/routes/backup-requests.cjs:265-280`

**Interfaces:**
- Consumes: `findDieListMatch`, `findRecentOrderMatch` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Replace the private query**

In `server/routes/backup-requests.cjs`, add near the other requires:

```javascript
const { findDieListMatch, findRecentOrderMatch } = require('../services/dieOrderPrefill.cjs');
const { extractProfileFromDie } = require('../services/frozenDesigns.cjs');
```

Then replace the whole `if (!values.DIE_SIZE && backupRequest.die_no) { ... }` block with:

```javascript
        // Fill DIE_SIZE from history when the form left it blank, through the
        // same lookup the modal uses so the PDF cannot disagree with the form.
        if (!values.DIE_SIZE && backupRequest.die_no) {
            try {
                const key = {
                    plant: backupRequest.plant,
                    profile: extractProfileFromDie(backupRequest.die_no),
                    press: backupRequest.press,
                    cavity: backupRequest.cavity,
                };
                const order = await findRecentOrderMatch(pool, key);
                const dieList = order ? null : await findDieListMatch(pool, key);
                const dieSize = order?.die_size || dieList?.die_size;
                if (dieSize) values.DIE_SIZE = String(dieSize).slice(0, 200);
            } catch (lookupErr) {
                console.error('Die size lookup failed (continuing without it):', lookupErr);
            }
        }
```

- [ ] **Step 2: Verify it parses and the suite passes**

Run: `node --check server/routes/backup-requests.cjs && npm test 2>&1 | tail -6`
Expected: no syntax error; `fail 0`

- [ ] **Step 3: Verify end to end**

```bash
docker compose build backend && docker compose up -d backend
```

Generate a die order PDF from a request whose `DIE SIZE` you deliberately clear before submitting, and confirm the stamped value reads `250X160` rather than `250`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/backup-requests.cjs
git commit -m "refactor(die-order-prefill): PDF generator uses the shared die match lookup"
```

---

## Verification checklist

- [ ] `npm test` reports `fail 0` (417 tests before this work, plus the new ones)
- [ ] `npx eslint` on every changed file adds no errors beyond the pre-existing ones
- [ ] `npm run build` succeeds
- [ ] GEX 01 re-imported: `SELECT die_size FROM existing_die_details WHERE die_no = '29663_401'` returns `250X160`
- [ ] Opening the modal for a profile in the die list fills DIE SIZE, SOLID/HOLLOW and BOLSTER No, each with a `from …` hint
- [ ] Opening it for a profile with no history leaves those fields blank and shows no hint
- [ ] A frozen design's DIE SIZE and SUPPLIER survive untouched
