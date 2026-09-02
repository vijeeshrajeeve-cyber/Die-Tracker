# Die Number Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the New Backup Request `DIE NO` field into Profile + Die No, and propose the next die number from Plant + Profile + Press.

**Architecture:** A server service computes the next number from the highest existing suffix across the die list, orders and backup requests. A read-only endpoint serves it to the form; a pure client module owns composing and splitting the two inputs. Two adjacent fixes ride along: the create route gains a die-list duplicate check, and the profile lookup gains a die-list fallback.

**Tech Stack:** Node 20 + Express + `pg` (CommonJS, `.cjs`), React 18 + Vite (ESM), Postgres 15, `node:test`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-02-die-number-split-design.md`. Read it before starting.
- Builds on `docs/superpowers/specs/2026-09-02-die-order-prefill-design.md` — `pressNumber` and `stripProfile` already exist in `server/services/dieOrderPrefill.cjs`, `normalizePlant` in `server/services/frozenDesigns.cjs`. Reuse them; do not redefine.
- A die number is `<profile>-<press number><2-digit sequence>`. Only 3-digit suffixes belong to the live sequence; GEX 2's legacy 4-digit numbers (`-3503`) encode the P35 press code and are excluded.
- `die_no` stays **one column**. Only the input splits; the form composes `profile + '-' + suffix` on save.
- Backend files are CommonJS `.cjs` with `'use strict';`. Frontend files are ESM.
- Tests run with `npm test`, globbing `server/**/*.test.cjs` and `src/**/*.test.js`. Backend tests mock the pg client — never connect to a real database in a test.
- `npm run lint` fails on pre-existing problems repo-wide. Verify your own diff with `npx eslint <files>` and confirm no new errors.
- **`docker compose restart` never picks up a source edit.** Use `docker compose build <svc> && docker compose up -d <svc>`.
- The local Docker stack is a **TEST server**. Never present counts queried there as facts about real data.
- Never run an unscoped `DELETE FROM <table>`.

---

### Task 1: Die number service

**Files:**
- Create: `server/services/dieNumber.cjs`
- Create: `server/services/dieNumber.test.cjs`

**Interfaces:**
- Consumes: `pressNumber(raw) → number|null` and `stripProfile(raw) → string` from `server/services/dieOrderPrefill.cjs`; `normalizePlant(raw) → string` from `server/services/frozenDesigns.cjs`.
- Produces: `server/services/dieNumber.cjs` exporting
  `parseSuffix(dieNo) → number|null`,
  `nextDieNumber(client, { plant, profile, press }) → Promise<{dieNo: string, basis: {source: string, die_no: string}|null}|null>`,
  `dieNoExistsInDieList(client, dieNo) → Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `server/services/dieNumber.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./dieNumber.cjs');

// Mock client that answers each table with canned rows.
function makeClient({ dies = [], orders = [], requests = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('existing_die_details')) return { rows: dies, rowCount: dies.length };
      if (sql.includes('die_orders')) return { rows: orders, rowCount: orders.length };
      if (sql.includes('backup_die_requests')) return { rows: requests, rowCount: requests.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

test('parseSuffix reads a 3-digit suffix from either separator', () => {
  assert.equal(d.parseSuffix('29663-253'), 253);
  assert.equal(d.parseSuffix('29663_213'), 213);
  assert.equal(d.parseSuffix('013012-705'), 705);
});

// GEX 2's legacy numbers encode the P25/P35 press code, not a press number.
test('parseSuffix rejects legacy 4-digit and unparseable suffixes', () => {
  assert.equal(d.parseSuffix('001005-2502'), null);
  assert.equal(d.parseSuffix('120494-3503'), null);
  assert.equal(d.parseSuffix('30491-601 DP'), null);
  assert.equal(d.parseSuffix('INS-12297'), null);
  assert.equal(d.parseSuffix('29663'), null);
  assert.equal(d.parseSuffix(null), null);
});

// The real profile 29663 case: die list 213, orders 213, requests 252.
test('the highest suffix wins across all three sources', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01' }],
    orders: [{ die_no: '29663-213', plant: 'GEX 1' }],
    requests: [{ die_no: '29663-252', plant: 'GEX 01' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-253');
  assert.deepEqual(result.basis, { source: 'backup request', die_no: '29663-252' });
});

test('the die list can set the ceiling when it is highest', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01' }],
    orders: [{ die_no: '29663-204', plant: 'GEX 1' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-214');
  assert.deepEqual(result.basis, { source: 'die', die_no: '29663_213' });
});

// A profile that has never run on this press starts the sequence at 01.
test('no history gives <press>01 and a null basis', async () => {
  const client = makeClient({});
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '51150', press: 'PRESS 8' });
  assert.equal(result.dieNo, '51150-801');
  assert.equal(result.basis, null);
});

test('legacy 4-digit numbers do not raise the ceiling', async () => {
  const client = makeClient({
    orders: [{ die_no: '120494-3503', plant: 'GEX 2' }, { die_no: '120494-802', plant: 'GEX 2' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '120494', press: 'PRESS 8' });
  assert.equal(result.dieNo, '120494-803');
});

// Requests store 'GEX 01' and 'GEX 2'; the die list stores 'GEX 01'.
test('plant comparison ignores zero padding', async () => {
  const client = makeClient({
    dies: [{ die_no: '29663_213', plant: 'GEX 01' }],
    requests: [{ die_no: '29663-299', plant: 'GEX 02' }],
  });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-300', 'only the GEX 2 row counts');
});

test('a leading-zero profile is stripped in both the query and the result', async () => {
  const client = makeClient({ requests: [{ die_no: '013012-705', plant: 'GEX 2' }] });
  const result = await d.nextDieNumber(client, { plant: 'GEX 2', profile: '013012', press: 'PRESS 7' });
  assert.equal(result.dieNo, '13012-706');
  assert.equal(client.calls[0].params[0], '13012');
});

test('an unusable press or empty profile returns null without querying', async () => {
  const client = makeClient({});
  assert.equal(await d.nextDieNumber(client, { plant: 'GEX 01', profile: '29663', press: '' }), null);
  assert.equal(await d.nextDieNumber(client, { plant: 'GEX 01', profile: '', press: 'PRESS 2' }), null);
  assert.equal(client.calls.length, 0);
});

// Requests write '29663-213'; the die list stores '29663_213' and may pad the
// profile. Both have to be recognised as the same physical die.
test('dieNoExistsInDieList matches across separator and zero padding', async () => {
  const client = makeClient({ dies: [{ die_no: '29663_213' }] });
  assert.equal(await d.dieNoExistsInDieList(client, '29663-213'), true);
  assert.deepEqual(client.calls[0].params, ['29663', '213']);
});

test('dieNoExistsInDieList is false for an unknown die and for junk input', async () => {
  const client = makeClient({ dies: [] });
  assert.equal(await d.dieNoExistsInDieList(client, '29663-999'), false);
  assert.equal(await d.dieNoExistsInDieList(client, ''), false);
  assert.equal(await d.dieNoExistsInDieList(client, 'INS-12297'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 dieNumber`
Expected: FAIL with `Cannot find module './dieNumber.cjs'`

- [ ] **Step 3: Write the module**

Create `server/services/dieNumber.cjs`:

```javascript
'use strict';
const { pressNumber, stripProfile } = require('./dieOrderPrefill.cjs');
const { normalizePlant } = require('./frozenDesigns.cjs');

// A die number is <profile>-<press number><2-digit sequence>: 29663-253 is
// press 2, sequence 53. The die list writes the same shape with an underscore
// (29663_213). Only 3-digit suffixes belong to the live sequence — GEX 2's
// legacy numbers (-3503) encode the P35 press code, not a press number, and
// that convention was retired in March 2026.
function parseSuffix(dieNo) {
  const parts = String(dieNo == null ? '' : dieNo).trim().split(/[-_]/);
  if (parts.length < 2) return null;
  return /^[0-9]{3}$/.test(parts[1]) ? Number(parts[1]) : null;
}

// Every candidate die for this profile and press, from all three places a die
// number can already exist. Plant is filtered in JS so the tested
// normalizePlant stays the single definition of 'GEX 01' === 'GEX 2'.
async function collectCandidates(client, prof, pressNo) {
  const dies = await client.query(
    `SELECT die_no, plant FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND split_part(die_no, '_', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '_', 2), 1)::int = $2`,
    [prof, pressNo]
  );
  const orders = await client.query(
    `SELECT die_no, plant FROM die_orders
     WHERE regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND split_part(die_no, '-', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '-', 2), 1)::int = $2`,
    [prof, pressNo]
  );
  const requests = await client.query(
    `SELECT die_no, plant FROM backup_die_requests
     WHERE regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND split_part(die_no, '-', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '-', 2), 1)::int = $2`,
    [prof, pressNo]
  );
  return [
    ...dies.rows.map((r) => ({ ...r, source: 'die' })),
    ...orders.rows.map((r) => ({ ...r, source: 'order' })),
    ...requests.rows.map((r) => ({ ...r, source: 'backup request' })),
  ];
}

async function nextDieNumber(client, { plant, profile, press }) {
  const prof = stripProfile(profile);
  const pressNo = pressNumber(press);
  if (!prof || pressNo === null) return null;

  const want = normalizePlant(plant);
  const rows = (await collectCandidates(client, prof, pressNo))
    .filter((r) => !want || normalizePlant(r.plant) === want);

  let highest = null;
  let basis = null;
  for (const row of rows) {
    const suffix = parseSuffix(row.die_no);
    if (suffix === null) continue;
    if (highest === null || suffix > highest) {
      highest = suffix;
      basis = { source: row.source, die_no: row.die_no };
    }
  }

  // A profile with no history on this press starts the sequence at 01.
  const next = highest === null ? (pressNo * 100) + 1 : highest + 1;
  return { dieNo: `${prof}-${next}`, basis };
}

// The client-side duplicate check can hold every request and order in memory
// but not 44,669 dies, so this is the one check that has to be server-side.
async function dieNoExistsInDieList(client, dieNo) {
  const suffix = parseSuffix(dieNo);
  const prof = stripProfile(String(dieNo == null ? '' : dieNo).split(/[-_]/)[0]);
  if (!prof || suffix === null) return false;

  const { rows } = await client.query(
    `SELECT 1 FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND split_part(die_no, '_', 2) = $2
     LIMIT 1`,
    [prof, String(suffix)]
  );
  return rows.length > 0;
}

module.exports = { parseSuffix, nextDieNumber, dieNoExistsInDieList };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/services/dieNumber.cjs server/services/dieNumber.test.cjs
git commit -m "feat(die-number): service computing the next die number from three sources"
```

---

### Task 2: Endpoint and API client

**Files:**
- Modify: `server/routes/backup-requests.cjs` (add one route)
- Modify: `src/api.js` (add `backupRequestsAPI.nextDieNumber`)
- Modify: `src/api.test.js` (add two tests)

**Interfaces:**
- Consumes: `nextDieNumber` from Task 1.
- Produces: `GET /api/backup-requests/next-die-number?plant=&profile=&press=` returning `{ dieNo, basis }` or `{ dieNo: null, basis: null }`; and `backupRequestsAPI.nextDieNumber({ plant, profile, press }) → Promise<{dieNo, basis}>`.

- [ ] **Step 1: Write the failing test**

Append to `src/api.test.js`. It already imports `assert`, `test` and the APIs; add `backupRequestsAPI` to the existing import line from `./api.js`.

```javascript
test('nextDieNumber sends plant, profile and press as query parameters', async () => {
  let seenUrl = null;
  globalThis.fetch = async (url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ dieNo: '29663-253', basis: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  await backupRequestsAPI.nextDieNumber({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.match(seenUrl, /\/backup-requests\/next-die-number\?/);
  assert.match(seenUrl, /plant=GEX\+01/);
  assert.match(seenUrl, /profile=29663/);
  assert.match(seenUrl, /press=PRESS\+2/);
});

test('nextDieNumber returns the proposal and its basis', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ dieNo: '29663-253', basis: { source: 'backup request', die_no: '29663-252' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  const result = await backupRequestsAPI.nextDieNumber({ plant: 'GEX 01', profile: '29663', press: 'PRESS 2' });
  assert.equal(result.dieNo, '29663-253');
  assert.equal(result.basis.die_no, '29663-252');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 nextDieNumber`
Expected: FAIL with `backupRequestsAPI.nextDieNumber is not a function`

- [ ] **Step 3: Add the API client function**

In `src/api.js`, inside the `backupRequestsAPI` object, add:

```javascript
    nextDieNumber: async ({ plant, profile, press }) => {
        const query = new URLSearchParams({
            plant: plant ?? '', profile: profile ?? '', press: press ?? '',
        });
        return apiRequest(`/backup-requests/next-die-number?${query}`);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `fail 0`

- [ ] **Step 5: Add the endpoint**

In `server/routes/backup-requests.cjs`, add beside the other requires:

```javascript
const { nextDieNumber, dieNoExistsInDieList } = require('../services/dieNumber.cjs');
```

Then add this route immediately **before** `router.post('/', requestValidation, ...)`, so the literal path is matched before any parameterised route:

```javascript
// Proposes the next die number for the New Backup Request form: the highest
// suffix already used for this plant + profile + press, plus one.
router.get('/next-die-number', async (req, res) => {
    try {
        const result = await nextDieNumber(pool, {
            plant: req.query.plant,
            profile: req.query.profile,
            press: req.query.press,
        });
        res.json(result || { dieNo: null, basis: null });
    } catch (error) {
        console.error('Next die number lookup error:', error);
        res.status(500).json({ error: 'Next die number lookup failed' });
    }
});
```

- [ ] **Step 6: Verify against the test stack**

```bash
node --check server/routes/backup-requests.cjs && docker compose build backend && docker compose up -d backend
```

Confirm the route is registered and auth-gated (this router's auth is applied at mount time in `server/index.cjs`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost/api/backup-requests/next-die-number?plant=GEX%2001&profile=29663&press=PRESS%202"
```

Expected: `401` — the route exists and requires a token. A `404` means it was added after a conflicting route.

Then check the computation against real data:

```bash
cat > /tmp/check-next.cjs <<'EOF'
const { pool } = require('/app/server/db.cjs');
const d = require('/app/server/services/dieNumber.cjs');
(async () => {
  console.log(await d.nextDieNumber(pool, { plant: 'GEX 01', profile: '29663', press: 'PRESS 2' }));
  console.log('29663-213 in die list:', await d.dieNoExistsInDieList(pool, '29663-213'));
  console.log('29663-999 in die list:', await d.dieNoExistsInDieList(pool, '29663-999'));
  await pool.end();
})();
EOF
docker cp /tmp/check-next.cjs die-ordering-backend:/tmp/check-next.cjs && MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node /tmp/check-next.cjs
```

Expected: `{ dieNo: '29663-253', basis: { source: 'backup request', die_no: '29663-252' } }`, then `true`, then `false`.

- [ ] **Step 7: Commit**

```bash
git add server/routes/backup-requests.cjs src/api.js src/api.test.js
git commit -m "feat(die-number): add GET /backup-requests/next-die-number"
```

---

### Task 3: Block die numbers that already exist as physical dies

**Files:**
- Modify: `server/routes/backup-requests.cjs` (the `router.post('/')` handler)

**Interfaces:**
- Consumes: `dieNoExistsInDieList` from Task 1 (already required by Task 2).
- Produces: `POST /api/backup-requests` returns **409** `{ error }` when the die number matches a row in `existing_die_details`.

- [ ] **Step 1: Add the check**

In `server/routes/backup-requests.cjs`, inside `router.post('/', requestValidation, handleValidationErrors, async (req, res) => {`, immediately after `const data = req.body;` add:

```javascript
        // The client blocks duplicates against requests and orders, which it
        // holds in memory. It cannot hold 44,669 rows of existing_die_details,
        // so a number that collides with a physical die is caught here.
        const dieNo = data['DIE NO'];
        if (dieNo && await dieNoExistsInDieList(pool, dieNo)) {
            return res.status(409).json({
                error: `Die ${dieNo} already exists in the die list for this plant. Choose a different die number.`,
            });
        }
```

- [ ] **Step 2: Verify it parses and the suite still passes**

Run: `node --check server/routes/backup-requests.cjs && npm test 2>&1 | tail -6`
Expected: no syntax error; `fail 0`

- [ ] **Step 3: Verify the conflict end to end**

```bash
docker compose build backend && docker compose up -d backend
```

`29663-213` exists in the die list as `29663_213`, so creating a request for it must be refused. Confirm no such request exists first, then check nothing was written:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) FROM backup_die_requests WHERE die_no = '29663-213';"
```

Expected: `0` both before and after any attempt. The 409 path is exercised by the browser check in Task 6.

- [ ] **Step 4: Commit**

```bash
git add server/routes/backup-requests.cjs
git commit -m "fix(backup-requests): reject a die number that already exists in the die list"
```

---

### Task 4: Profile lookup falls back to the die list

`GET /api/profiles/lookup` queries only the `profiles` table, which holds 4 rows against 20,916 distinct profiles in the die list. It 404s for essentially every real profile.

**Files:**
- Modify: `server/routes/profiles.cjs:26-43`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET /api/profiles/lookup` additionally returns `{ profile_number, customer_name, source: 'die list' }` when the master misses but the die list has a customer. Master hits keep their existing shape plus `source: 'profiles'`.

- [ ] **Step 1: Add the fallback**

In `server/routes/profiles.cjs`, replace the body of the `/lookup` route's `if (result.rows.length === 0) { ... }` block:

```javascript
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found', profile_number: profile });
        }
        res.json(result.rows[0]);
```

with:

```javascript
        if (result.rows.length > 0) {
            return res.json({ ...result.rows[0], source: 'profiles' });
        }

        // The profiles master is nearly empty (4 rows against 20,916 profiles
        // in the die list), so fall back to the customer recorded against the
        // plant's own dies before giving up.
        const fromDieList = await pool.query(
            `SELECT customer FROM existing_die_details
             WHERE regexp_replace(profile_number, '^0+', '') = $1
               AND customer IS NOT NULL AND customer <> ''
             ORDER BY updated_at DESC NULLS LAST
             LIMIT 1`,
            [profile]
        );
        if (fromDieList.rows.length > 0) {
            return res.json({
                profile_number: profile,
                customer_name: fromDieList.rows[0].customer,
                source: 'die list',
            });
        }

        return res.status(404).json({ error: 'Profile not found', profile_number: profile });
```

- [ ] **Step 2: Verify it parses and rebuild**

Run: `node --check server/routes/profiles.cjs && docker compose build backend && docker compose up -d backend`
Expected: no syntax error; backend starts.

- [ ] **Step 3: Verify the fallback resolves a real profile**

```bash
cat > /tmp/check-profile.cjs <<'EOF'
const { pool } = require('/app/server/db.cjs');
(async () => {
  const master = await pool.query('SELECT count(*)::int c FROM profiles');
  const hit = await pool.query(
    `SELECT customer FROM existing_die_details
     WHERE regexp_replace(profile_number,'^0+','') = '29663'
       AND customer IS NOT NULL AND customer <> ''
     ORDER BY updated_at DESC NULLS LAST LIMIT 1`);
  console.log('profiles master rows:', master.rows[0].c);
  console.log('29663 customer from die list:', hit.rows[0]?.customer);
  await pool.end();
})();
EOF
docker cp /tmp/check-profile.cjs die-ordering-backend:/tmp/check-profile.cjs && MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node /tmp/check-profile.cjs
```

Expected: the master row count, then a real customer name for profile 29663 — proving the fallback has data the master does not.

- [ ] **Step 4: Commit**

```bash
git add server/routes/profiles.cjs
git commit -m "fix(profiles): fall back to the die list when the profile master misses"
```

---

### Task 5: Client compose/split module

**Files:**
- Create: `src/utils/dieNumber.js`
- Create: `src/utils/dieNumber.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `src/utils/dieNumber.js` exporting
  `composeDieNo(profile, suffix) → string`,
  `splitDieNo(dieNo) → { profile: string, suffix: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/dieNumber.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDieNo, splitDieNo } from './dieNumber.js';

test('composeDieNo joins the two inputs with a dash', () => {
  assert.equal(composeDieNo('29663', '253'), '29663-253');
  assert.equal(composeDieNo('  29663 ', ' 253 '), '29663-253');
  assert.equal(composeDieNo('013012', '705'), '013012-705');
});

test('composeDieNo returns an empty string when either half is missing', () => {
  assert.equal(composeDieNo('29663', ''), '');
  assert.equal(composeDieNo('', '253'), '');
  assert.equal(composeDieNo(null, undefined), '');
});

// Editing an existing request has to populate both fields from one stored value.
test('splitDieNo divides an existing die number at the first dash', () => {
  assert.deepEqual(splitDieNo('29663-253'), { profile: '29663', suffix: '253' });
  assert.deepEqual(splitDieNo('013012-705'), { profile: '013012', suffix: '705' });
});

test('splitDieNo keeps everything after the first dash together', () => {
  assert.deepEqual(splitDieNo('30491-601 DP'), { profile: '30491', suffix: '601 DP' });
});

test('splitDieNo puts a value with no dash in the profile half', () => {
  assert.deepEqual(splitDieNo('29663'), { profile: '29663', suffix: '' });
  assert.deepEqual(splitDieNo(''), { profile: '', suffix: '' });
  assert.deepEqual(splitDieNo(null), { profile: '', suffix: '' });
});

test('compose and split round-trip', () => {
  const { profile, suffix } = splitDieNo('29663-253');
  assert.equal(composeDieNo(profile, suffix), '29663-253');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 "dieNumber.js"`
Expected: FAIL with `Cannot find module` for `./dieNumber.js`

- [ ] **Step 3: Write the module**

Create `src/utils/dieNumber.js`:

```javascript
// The New Backup Request form takes the profile and the suffix separately, but
// die_no is stored as one value ('29663-253') and read that way by
// extractProfileFromDie, the frozen-design match, dieOrderPrefill, the order
// PDF, the J-file and the duplicate check.

export const composeDieNo = (profile, suffix) => {
  const p = String(profile ?? '').trim();
  const s = String(suffix ?? '').trim();
  return p && s ? `${p}-${s}` : '';
};

// Splits at the FIRST dash so an odd stored value like '30491-601 DP' keeps its
// trailing text in the suffix rather than being silently truncated.
export const splitDieNo = (dieNo) => {
  const raw = String(dieNo ?? '').trim();
  const at = raw.indexOf('-');
  if (at < 0) return { profile: raw, suffix: '' };
  return { profile: raw.slice(0, at), suffix: raw.slice(at + 1) };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/utils/dieNumber.js src/utils/dieNumber.test.js
git commit -m "feat(die-number): compose/split helpers for the split die number input"
```

---

### Task 6: Split the field in the New Backup Request modal

**Files:**
- Modify: `src/components/backup/BackupDieRequests.jsx`

**Interfaces:**
- Consumes: `backupRequestsAPI.nextDieNumber` (Task 2), `composeDieNo` and `splitDieNo` (Task 5).
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Add the imports and form fields**

Add to the existing `../../utils/dieOrderPrefill` import line area:

```javascript
import { composeDieNo, splitDieNo } from '../../utils/dieNumber';
```

In `EMPTY_FORM`, replace `'DIE NO': '',` with:

```javascript
  'Profile': '',
  'Die Suffix': '',
```

`'DIE NO'` stays out of `EMPTY_FORM` — it is composed on save, never held in form state.

- [ ] **Step 2: Add the proposal state**

Beside the other modal state declarations, add:

```javascript
  const [dieNoBasis, setDieNoBasis] = useState(null);
```

- [ ] **Step 3: Populate both fields when editing**

In `openEditModal`, replace this line:

```javascript
      'DIE NO': request['DIE NO'] || '',
```

with:

```javascript
      'Profile': splitDieNo(request['DIE NO']).profile,
      'Die Suffix': splitDieNo(request['DIE NO']).suffix,
```

Also add `setDieNoBasis(null);` immediately after `setEditingRequest(request);`, so a basis left over from a previous new-request session does not show on an edit.

- [ ] **Step 4: Fetch the proposal when plant, profile and press are all set**

Add this effect beside the other `useEffect` calls:

```javascript
  // Propose the next die number once the key is complete, but only for a new
  // request and only into an empty field — an existing request's number is
  // already issued, and overwriting it would orphan the die's history.
  useEffect(() => {
    if (editingRequest) return;
    const profile = (formData['Profile'] || '').trim();
    const press = (formData['Press'] || '').trim();
    const plant = (formData['Plant'] || '').trim();
    if (!profile || !press || !plant) return;
    if ((formData['Die Suffix'] || '').trim()) return;

    let cancelled = false;
    backupRequestsAPI.nextDieNumber({ plant, profile, press })
      .then((result) => {
        if (cancelled || !result?.dieNo) return;
        setFormData((prev) => (
          (prev['Die Suffix'] || '').trim()
            ? prev
            : { ...prev, 'Die Suffix': splitDieNo(result.dieNo).suffix }
        ));
        setDieNoBasis(result.basis);
      })
      .catch((err) => console.error('Next die number lookup failed:', err));
    return () => { cancelled = true; };
  }, [formData['Plant'], formData['Profile'], formData['Press'], editingRequest]);
```

- [ ] **Step 5: Replace the DIE NO input with two fields**

Replace the whole `{/* DIE NO */}` block (the `<div>` containing the `backupdierequests-die-no` input and the `dieWarning` panel) with:

```jsx
              {/* PROFILE */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-profile">PROFILE</label>
                <input id="backupdierequests-profile"
                  type="text"
                  value={formData['Profile']}
                  onChange={(e) => { setFormData({ ...formData, 'Profile': e.target.value }); if (dieWarning) setDieWarning(''); }}
                  onBlur={handleProfileBlur}
                  style={inputStyle}
                  placeholder="e.g. 29663"
                />
              </div>

              {/* DIE NO */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-die-no">
                  DIE NO
                  {dieNoBasis === null && (formData['Die Suffix'] || '').trim() && (
                    <span style={{ fontSize: '0.7rem', color: theme.textMuted, marginLeft: '8px' }}>
                      first die on this press
                    </span>
                  )}
                  {dieNoBasis && (
                    <span style={{ fontSize: '0.7rem', color: theme.textMuted, marginLeft: '8px' }}>
                      next after {dieNoBasis.die_no}
                    </span>
                  )}
                </label>
                <input id="backupdierequests-die-no"
                  type="text"
                  value={formData['Die Suffix']}
                  onChange={(e) => { setFormData({ ...formData, 'Die Suffix': e.target.value }); if (dieWarning) setDieWarning(''); }}
                  onBlur={() => checkDuplicateDie(composeDieNo(formData['Profile'], formData['Die Suffix']))}
                  style={{
                    ...inputStyle,
                    border: dieWarning ? '1px solid #F59E0B' : inputStyle.border,
                  }}
                  placeholder="e.g. 253"
                />
                {dieWarning && (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    marginTop: '8px', padding: '8px 12px', borderRadius: '8px',
                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
                    color: '#F59E0B', fontSize: '0.78rem', lineHeight: 1.35,
                  }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>{dieWarning}</span>
                  </div>
                )}
              </div>
```

- [ ] **Step 6: Move the customer lookup to the profile field**

Replace `handleDieBlur` with:

```javascript
  const handleProfileBlur = async () => {
    const profile = (formData['Profile'] || '').trim();
    const existingCustomer = (formData['Customer'] || '').trim();

    checkDuplicateDie(composeDieNo(profile, formData['Die Suffix']));

    if (!profile || existingCustomer) return;
    try {
      const result = await profilesAPI.lookup(profile);
      if (result?.customer_name) {
        setFormData(prev => ({ ...prev, 'Customer': result.customer_name }));
      }
    } catch (e) {
      console.error('Profile lookup failed:', e);
    }
  };
```

- [ ] **Step 7: Compose on save**

In `handleSave`, replace this line:

```javascript
    const die = (formData['DIE NO'] || '').trim();
```

with:

```javascript
    const die = composeDieNo(formData['Profile'], formData['Die Suffix']);
```

Then replace the payload line:

```javascript
      const payload = { ...formData, 'Customer': customer };
```

with:

```javascript
      // formData now carries Profile and Die Suffix; the API and the database
      // still take one composed die_no.
      const payload = { ...formData, 'Customer': customer, 'DIE NO': die };
```

No new error handling is needed for Task 3's 409. `apiRequest` throws
`new Error(data?.detail || data?.error || ...)`, and `handleSave` already ends
with `catch (error) { dialogs.notify(error.message, 'error'); }`, so the
die-list conflict message reaches the user as it stands.

- [ ] **Step 8: Verify lint, tests and build**

Run: `npx eslint src/components/backup/BackupDieRequests.jsx src/utils/dieNumber.js && npm test 2>&1 | tail -5 && npm run build 2>&1 | grep -E "built in|error"`
Expected: no new eslint errors; `fail 0`; build succeeds.

- [ ] **Step 9: Verify in the browser**

```bash
docker compose build frontend && docker compose up -d frontend
```

Open **Backup Die Requests → New Backup Request**. Then:

1. Choose Plant `GEX 01`, type Profile `29663`, choose Press `PRESS 2`. DIE NO should fill with `253` and the label should read `next after 29663-252`. Customer should fill from the die list.
2. Change Press to `PRESS 6`. The proposal should change to that press's sequence.
3. Type a Profile that has no dies. DIE NO should read `<press>01` and the label `first die on this press`.
4. Overwrite DIE NO with `213` and blur. The duplicate warning should appear, and saving should be refused with the die-list conflict message.

- [ ] **Step 10: Commit**

```bash
git add src/components/backup/BackupDieRequests.jsx
git commit -m "feat(die-number): split DIE NO into Profile and Die No with an auto-proposed number"
```

---

## Verification checklist

- [ ] `npm test` reports `fail 0`
- [ ] `npx eslint` on every changed file adds no errors beyond the pre-existing ones
- [ ] `npm run build` succeeds
- [ ] `nextDieNumber` for GEX 01 / 29663 / PRESS 2 returns `29663-253` with basis `29663-252`
- [ ] `dieNoExistsInDieList('29663-213')` is `true`, `('29663-999')` is `false`
- [ ] Profile lookup returns a customer for 29663 via the die-list fallback
- [ ] The modal fills DIE NO and Customer from Plant + Profile + Press, and shows the basis
- [ ] Editing an existing request populates both fields and does not re-propose

## Known limitations

- **Sequences above 99 break the rule.** `29663-299` + 1 gives `300`, which reads as press 3. No profile is near that today (the highest observed is 52), and the proposal is editable and duplicate-checked, but the rule has no answer for it.
- **Presses numbered 10 or above** would produce a 4-digit `<press>01` fallback that collides with the retired GEX 2 convention. Both plants use single-digit presses today.
