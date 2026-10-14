# Universal Search (Ctrl+K palette) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Ctrl+K / ⌘K palette, reachable from every page, that searches die orders and Quality Discrepancies on the server and opens the chosen record in place.

**Architecture:** A pure ranking service (`server/services/search.cjs`) plus a thin Express route (`server/routes/search.cjs`) that queries `die_orders` and `quality_discrepancies` with escaped `ILIKE`, enforces page access per group and the QD draft rule, and caps each group at 8. A second route, `GET /api/search/qd/:id`, returns one full, decorated QD so the QD Tracker can open a record that isn't in its own list. On the client, a `SearchPalette` modal (built on the existing `useDialog` hook) calls `searchAPI` and hands results to the existing open paths: `selectedOrder` → `OrderDetailModal`, and `focusQdId` / `focusQdRecord` → QD Tracker.

**Tech Stack:** Node/Express 5 (CommonJS `.cjs`), PostgreSQL via `pg`, React 18 + Vite, `node:test` for server and plain-JS client tests, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-10-14-universal-search-design.md`

## Global Constraints

- Minimum query length: **2** characters after trimming (server returns `400` below it; client sends no request below it).
- Debounce: **200 ms**.
- Each result group returns at most **8** items plus the true `total`.
- SQL candidate set: **200** rows per group, ordered exact → prefix → contains → newest.
- User input is passed only as a bound parameter, with `\`, `%`, `_` escaped. It is never interpolated into SQL.
- Orders group visible only if `canReadSource(user, 'order')`; QD group only if `canReadSource(user, 'qd')` (both from `server/services/workQueuePermissions.cjs`). A group the user can't read is **omitted** from the response, not returned empty.
- A QD with `approval_state = 'Draft'` is visible only to its creator (`created_by === req.user.id`).
- Order match fields: `die_no, order_no, supplier, customer_name, pr_number`. QD match fields: `qd_no, die_no, supplier, profile_number, issue_summary`.
- The existing top-bar search box and its page-filter behaviour stay **unchanged**.
- Tests: `npm test` (runs `server/**/*.test.cjs` and `src/**/*.test.js`). Lint: `npm run lint`. Build: `npm run build`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An exact die no that is older than 200 newer partial matches** (e.g. `30` matches thousands of orders, but `30` is also someone's exact order no). Expected: the exact match still ranks first. Pinned by the SQL `ORDER BY` rank clause test in Task 2.
2. **Queries containing `%`, `_` or `\`** (die nos like `30533_201` are real). Expected: matched literally, never as wildcards. Pinned in Tasks 1 and 2.
3. **A user whose page access is only `process-flow`.** Expected: they still see the orders group (the `flow-*` → `process-flow` rule). Pinned in Task 2.
4. **Typing fast, so an older response arrives after a newer one.** Expected: only the latest query's results show. Handled with `AbortController`; the abort error must not show "Search failed". Pinned in Task 4 (`isAbort`) and checked in Task 6.
5. **Opening an order beyond the 5000-row register cap, or your own Draft QD.** Expected: it still opens. The order is upserted into `data`; the QD comes from `/api/search/qd/:id` and is passed as `focusQdRecord`. Pinned in Tasks 3 and 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/services/search.cjs` (create) | Pure: query normalising, LIKE escaping, SQL match/rank clauses, JS ranking + cap |
| `server/services/search.test.cjs` (create) | Unit tests for the above |
| `server/routes/search.cjs` (create) | `GET /` (grouped search) and `GET /qd/:id` (full QD record) |
| `server/routes/search.test.cjs` (create) | Route tests with the fake DB from `testSupport.cjs` |
| `server/index.cjs` (modify) | Mount `/api/search` behind `authMiddleware` |
| `src/api.js` (modify) | `searchAPI.query(q, { signal })`, `searchAPI.qd(id)` |
| `src/api.test.js` (modify) | URL encoding tests for `searchAPI` |
| `src/utils/searchPalette.js` (create) | Pure client helpers: shortcut check, flatten, keyboard index, abort check |
| `src/utils/searchPalette.test.js` (create) | Unit tests for the above |
| `src/components/search/SearchPalette.jsx` (create) | The modal UI |
| `src/components/layout/TopBar.jsx` (modify) | "Search ⌘K" button |
| `src/DieOrderingSystem.jsx` (modify) | Palette state, global shortcut, open-result wiring |

---

### Task 1: Ranking service

**Files:**
- Create: `server/services/search.cjs`
- Test: `server/services/search.test.cjs`

**Interfaces:**
- Produces:
  - `MIN_QUERY_LENGTH = 2`, `RESULT_CAP = 8`, `CANDIDATE_LIMIT = 200`
  - `ORDER_SEARCH`, `QD_SEARCH`: `{ fields: string[], primary: string[], dateField: string }`
  - `normaliseQuery(raw: unknown): string | null` (trimmed, or `null` if under 2 chars)
  - `escapeLike(q: string): string`
  - `containsPattern(q): string` → `%<escaped>%`; `prefixPattern(q): string` → `<escaped>%`
  - `matchClause(fields: string[]): string` → `(a ILIKE $1 OR b ILIKE $1 …)`
  - `rankClause(config): string` → `CASE WHEN <exact on primary, $2> THEN 0 WHEN <prefix on fields, $3> THEN 1 ELSE 2 END`
  - `rankRows(rows: object[], q: string, config): Array<{ row, matchedField }>` (sorted, capped at 8)

- [ ] **Step 1: Write the failing tests**

```js
// server/services/search.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('./search.cjs');

test('normaliseQuery trims and rejects anything under two characters', () => {
  assert.equal(search.normaliseQuery('  D-12 '), 'D-12');
  assert.equal(search.normaliseQuery(' a '), null);
  assert.equal(search.normaliseQuery('   '), null);
  assert.equal(search.normaliseQuery(undefined), null);
  assert.equal(search.normaliseQuery(['ab']), null);
});

test('LIKE metacharacters are escaped so die nos like 30533_201 match literally', () => {
  assert.equal(search.escapeLike('30533_201'), '30533\\_201');
  assert.equal(search.escapeLike('50%\\x'), '50\\%\\\\x');
  assert.equal(search.containsPattern('a_b'), '%a\\_b%');
  assert.equal(search.prefixPattern('a%b'), 'a\\%b%');
});

test('matchClause and rankClause only ever reference bound parameters', () => {
  assert.equal(search.matchClause(['die_no', 'order_no']), '(die_no ILIKE $1 OR order_no ILIKE $1)');
  assert.equal(
    search.rankClause({ fields: ['die_no', 'supplier'], primary: ['die_no'] }),
    'CASE WHEN lower(die_no) = $2 THEN 0 WHEN die_no ILIKE $3 OR supplier ILIKE $3 THEN 1 ELSE 2 END',
  );
});

const order = (id, fields, created_at = '2026-01-01') => ({ id, created_at, ...fields });

test('exact beats prefix beats contains, regardless of age', () => {
  const rows = [
    order(1, { die_no: 'X-D12-9' }, '2026-09-01'),  // contains
    order(2, { die_no: 'D12-77' }, '2026-08-01'),   // prefix
    order(3, { order_no: 'd12' }, '2025-01-01'),    // exact on a primary field, oldest
  ];
  const ranked = search.rankRows(rows, 'D12', search.ORDER_SEARCH);
  assert.deepEqual(ranked.map(r => r.row.id), [3, 2, 1]);
  assert.deepEqual(ranked.map(r => r.matchedField), ['order_no', 'die_no', 'die_no']);
});

test('an exact match on a non-primary field only counts as a prefix match', () => {
  const rows = [order(1, { supplier: 'ALPHA' }, '2026-09-01'), order(2, { die_no: 'ALPHA' }, '2025-01-01')];
  assert.deepEqual(search.rankRows(rows, 'alpha', search.ORDER_SEARCH).map(r => r.row.id), [2, 1]);
});

test('ties break newest first, then by id', () => {
  const rows = [
    order(1, { supplier: 'BETA' }, '2026-01-01'),
    order(2, { supplier: 'BETA' }, '2026-05-01'),
    order(3, { supplier: 'BETA' }, '2026-05-01'),
  ];
  assert.deepEqual(search.rankRows(rows, 'bet', search.ORDER_SEARCH).map(r => r.row.id), [3, 2, 1]);
});

test('null fields and unparseable dates do not throw', () => {
  const rows = [order(1, { die_no: null, supplier: 'GAMMA' }, null), order(2, { die_no: 'GAMMA-1' }, 'not a date')];
  assert.deepEqual(search.rankRows(rows, 'gamma', search.ORDER_SEARCH).map(r => r.row.id), [2, 1]);
});

test('rows that do not actually match are dropped, and the result is capped at 8', () => {
  const rows = Array.from({ length: 12 }, (_, i) => order(i + 1, { die_no: `D-${i}` }));
  rows.push(order(99, { die_no: 'ZZZ' }));
  const ranked = search.rankRows(rows, 'D-', search.ORDER_SEARCH);
  assert.equal(ranked.length, search.RESULT_CAP);
  assert.ok(ranked.every(r => r.row.id !== 99));
});

test('QD ranking uses qd_no / die_no as primary and raised_date for recency', () => {
  const rows = [
    { id: 1, qd_no: 'QD-25-031', raised_date: new Date('2025-03-01') },
    { id: 2, issue_summary: 'crack near qd-25-031 mark', raised_date: new Date('2026-03-01') },
  ];
  assert.deepEqual(search.rankRows(rows, 'qd-25-031', search.QD_SEARCH).map(r => r.row.id), [1, 2]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/search.test.cjs`
Expected: FAIL with `Cannot find module './search.cjs'`.

- [ ] **Step 3: Write the implementation**

```js
// server/services/search.cjs
'use strict';
// Universal search: the pure half. The route owns the queries; this owns what
// counts as a match, how matches rank, and the SQL fragments both share, so
// the database's candidate order and the final order can't drift apart.

const MIN_QUERY_LENGTH = 2;
const RESULT_CAP = 8;
// Candidates fetched per group before ranking. The SQL orders them exact →
// prefix → contains first, so an exact code is never lost behind 200 newer
// partial matches.
const CANDIDATE_LIMIT = 200;

const ORDER_SEARCH = {
  fields: ['die_no', 'order_no', 'supplier', 'customer_name', 'pr_number'],
  primary: ['die_no', 'order_no'],
  dateField: 'created_at',
};

const QD_SEARCH = {
  fields: ['qd_no', 'die_no', 'supplier', 'profile_number', 'issue_summary'],
  primary: ['qd_no', 'die_no'],
  dateField: 'raised_date',
};

function normaliseQuery(raw) {
  const q = typeof raw === 'string' ? raw.trim() : '';
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

// Backslash is Postgres's default LIKE escape, so escaping it first keeps a
// typed "\" from swallowing the next character.
const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
const containsPattern = (q) => `%${escapeLike(q)}%`;
const prefixPattern = (q) => `${escapeLike(q)}%`;

const matchClause = (fields) => `(${fields.map((f) => `${f} ILIKE $1`).join(' OR ')})`;

// $2 is the lower-cased query, $3 the prefix pattern.
const rankClause = ({ fields, primary }) => {
  const exact = primary.map((f) => `lower(${f}) = $2`).join(' OR ');
  const prefix = fields.map((f) => `${f} ILIKE $3`).join(' OR ');
  return `CASE WHEN ${exact} THEN 0 WHEN ${prefix} THEN 1 ELSE 2 END`;
};

const text = (v) => (v == null ? '' : String(v).toLowerCase());
const time = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

function scoreRow(row, needle, { fields, primary }) {
  const exact = primary.find((f) => text(row[f]) === needle);
  if (exact) return { score: 0, matchedField: exact };
  const prefix = fields.find((f) => text(row[f]).startsWith(needle));
  if (prefix) return { score: 1, matchedField: prefix };
  const contains = fields.find((f) => text(row[f]).includes(needle));
  if (contains) return { score: 2, matchedField: contains };
  return null;
}

function rankRows(rows, q, config) {
  const needle = q.toLowerCase();
  return (rows || [])
    .map((row) => ({ row, hit: scoreRow(row, needle, config) }))
    .filter((entry) => entry.hit)
    .sort((a, b) => a.hit.score - b.hit.score
      || time(b.row[config.dateField]) - time(a.row[config.dateField])
      || (b.row.id ?? 0) - (a.row.id ?? 0))
    .slice(0, RESULT_CAP)
    .map(({ row, hit }) => ({ row, matchedField: hit.matchedField }));
}

module.exports = {
  MIN_QUERY_LENGTH, RESULT_CAP, CANDIDATE_LIMIT, ORDER_SEARCH, QD_SEARCH,
  normaliseQuery, escapeLike, containsPattern, prefixPattern, matchClause, rankClause, rankRows,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/search.test.cjs`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/search.cjs server/services/search.test.cjs
git commit -m "feat(search): ranking and SQL clause helpers for universal search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /api/search` route

**Files:**
- Create: `server/routes/search.cjs`
- Test: `server/routes/search.test.cjs`
- Modify: `server/index.cjs` (require near the other routers at line ~11–30; mount next to `/api/quality-discrepancies` at line ~110)

**Interfaces:**
- Consumes: everything Task 1 produces; `canReadSource(user, 'order' | 'qd')` from `server/services/workQueuePermissions.cjs`; `presentOrder(row)` from `server/services/orderPresentation.cjs`.
- Produces: `GET /api/search?q=` →
  `{ orders?: { items: Array<PresentedOrder & { matchedField }>, total: number }, qds?: { items: Array<{ id, qd_no, die_no, supplier, plant, status, approval_state, raised_date, matchedField }>, total: number } }`.
  `400 { error }` for a short query.

SQL parameter layout (both groups): `$1` contains pattern, `$2` lower-cased query, `$3` prefix pattern; the QD group adds `$4` = `req.user.id`. COUNT queries use only `$1` (plus `$2` = user id for QDs).

- [ ] **Step 1: Write the failing tests**

```js
// server/routes/search.test.cjs
'use strict';
process.env.JWT_SECRET = 'search-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let orderRows = [];
let qdRows = [];
let totals = { orders: 0, qds: 0 };
let failQueries = false;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim().replace(/\s+/g, ' ');
  log.push({ q, params });
  if (failQueries) throw new Error('database unavailable');
  if (q.startsWith('SELECT * FROM die_orders WHERE')) return { rows: orderRows };
  if (q.startsWith('SELECT COUNT(*)::int AS total FROM die_orders')) return { rows: [{ total: totals.orders }] };
  if (q.startsWith('SELECT * FROM quality_discrepancies WHERE (')) return { rows: qdRows };
  if (q.startsWith('SELECT COUNT(*)::int AS total FROM quality_discrepancies')) return { rows: [{ total: totals.qds }] };
  throw new Error(`search test: unexpected query ${q}`);
});

const searchRouter = require('./search.cjs');

const ADMIN = { id: 1, username: 'admin', role: 'admin' };
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/search', searchRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  log = [];
  currentUser = ADMIN;
  orderRows = [];
  qdRows = [];
  totals = { orders: 0, qds: 0 };
  failQueries = false;
});

const find = (q) => request(base, `/api/search?q=${encodeURIComponent(q)}`);

test('a query under two characters is refused without touching the database', async () => {
  for (const q of ['', 'a', '   ', ' b ']) {
    const { status } = await find(q);
    assert.equal(status, 400);
  }
  assert.equal(log.length, 0);
});

test('input reaches SQL only as escaped bound parameters', async () => {
  await find("30533_201' OR 1=1 --");
  const select = log.find(({ q }) => q.startsWith('SELECT * FROM die_orders'));
  assert.ok(!select.q.includes('30533'), 'query text must not contain user input');
  assert.equal(select.params[0], "%30533\\_201' OR 1=1 --%");
  assert.equal(select.params[1], "30533_201' or 1=1 --");
  assert.equal(select.params[2], "30533\\_201' OR 1=1 --%");
});

test('candidates are ordered exact-then-prefix in SQL so an old exact code is not cut off', async () => {
  await find('30');
  const select = log.find(({ q }) => q.startsWith('SELECT * FROM die_orders'));
  assert.match(select.q, /ORDER BY CASE WHEN lower\(die_no\) = \$2 OR lower\(order_no\) = \$2 THEN 0 .* END, created_at DESC LIMIT 200$/);
});

test('orders come back presented, ranked, capped, with the true total', async () => {
  orderRows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, die_no: `D-${i}`, order_no: `O-${i}`, supplier: 'ALPHA', created_at: `2026-01-${String(i + 1).padStart(2, '0')}` }));
  totals.orders = 37;
  const { status, body } = await find('D-');
  assert.equal(status, 200);
  assert.equal(body.orders.total, 37);
  assert.equal(body.orders.items.length, 8);
  assert.equal(body.orders.items[0]['DIE NO'], 'D-9');
  assert.equal(body.orders.items[0].matchedField, 'die_no');
});

test('QD rows are trimmed to the list shape and drafts are scoped to the creator in SQL', async () => {
  currentUser = { id: 42, username: 'raiser', role: 'user', pageAccess: ['qd-tracker'] };
  qdRows = [{ id: 5, qd_no: 'QD-25-031', die_no: 'D-1', supplier: 'ALPHA', plant: 'GEX 1', status: 'Open', approval_state: 'Approved', raised_date: '2025-03-01', issue_detail: 'long text', created_by: 7 }];
  totals.qds = 1;
  const { body } = await find('QD-25');
  assert.deepEqual(body.qds.items[0], {
    id: 5, qd_no: 'QD-25-031', die_no: 'D-1', supplier: 'ALPHA', plant: 'GEX 1',
    status: 'Open', approval_state: 'Approved', raised_date: '2025-03-01', matchedField: 'qd_no',
  });
  const select = log.find(({ q }) => q.startsWith('SELECT * FROM quality_discrepancies'));
  assert.match(select.q, /AND \(approval_state <> 'Draft' OR created_by = \$4\)/);
  assert.equal(select.params[3], 42);
  const count = log.find(({ q }) => q.startsWith('SELECT COUNT(*)::int AS total FROM quality_discrepancies'));
  assert.match(count.q, /created_by = \$2/);
  assert.equal(count.params[1], 42);
});

test('a group the user cannot open is omitted, not returned empty', async () => {
  currentUser = { id: 3, username: 'qd-only', role: 'user', pageAccess: ['qd-tracker'] };
  const qdOnly = await find('D-1');
  assert.equal('orders' in qdOnly.body, false);
  assert.ok(qdOnly.body.qds);
  assert.ok(!log.some(({ q }) => q.includes('FROM die_orders')));

  log = [];
  currentUser = { id: 4, username: 'orders-only', role: 'user', pageAccess: ['orders'] };
  const ordersOnly = await find('D-1');
  assert.equal('qds' in ordersOnly.body, false);
  assert.ok(ordersOnly.body.orders);
  assert.ok(!log.some(({ q }) => q.includes('FROM quality_discrepancies')));
});

test('process-flow access alone still unlocks the orders group', async () => {
  currentUser = { id: 6, username: 'flow', role: 'user', pageAccess: ['process-flow'] };
  const { body } = await find('D-1');
  assert.ok(body.orders);
  assert.equal('qds' in body, false);
});

test('a database failure is a 500, not a crash', async () => {
  failQueries = true;
  const { status, body } = await find('D-1');
  assert.equal(status, 500);
  assert.equal(body.error, 'Internal server error');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/routes/search.test.cjs`
Expected: FAIL with `Cannot find module './search.cjs'`.

- [ ] **Step 3: Write the route**

```js
// server/routes/search.cjs
'use strict';
// Universal search (the Ctrl+K palette). Mounted behind authMiddleware only:
// a user may read one group and not the other, so access is decided per group
// here, with the same rules /api/orders and /api/quality-discrepancies use.
const express = require('express');
const { pool } = require('../db.cjs');
const search = require('../services/search.cjs');
const { canReadSource } = require('../services/workQueuePermissions.cjs');
const { presentOrder } = require('../services/orderPresentation.cjs');

const router = express.Router();

const ORDER_MATCH = search.matchClause(search.ORDER_SEARCH.fields);
const ORDER_RANK = search.rankClause(search.ORDER_SEARCH);
const QD_MATCH = search.matchClause(search.QD_SEARCH.fields);
const QD_RANK = search.rankClause(search.QD_SEARCH);

const presentQd = (row) => ({
  id: row.id, qd_no: row.qd_no, die_no: row.die_no, supplier: row.supplier, plant: row.plant,
  status: row.status, approval_state: row.approval_state, raised_date: row.raised_date,
});

async function findOrders(q) {
  const pattern = search.containsPattern(q);
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT * FROM die_orders WHERE ${ORDER_MATCH}
       ORDER BY ${ORDER_RANK}, created_at DESC LIMIT ${search.CANDIDATE_LIMIT}`,
      [pattern, q.toLowerCase(), search.prefixPattern(q)],
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM die_orders WHERE ${ORDER_MATCH}`, [pattern]),
  ]);
  return {
    items: search.rankRows(rows.rows, q, search.ORDER_SEARCH)
      .map(({ row, matchedField }) => ({ ...presentOrder(row), matchedField })),
    total: count.rows[0].total,
  };
}

// A draft QD belongs to whoever is writing it, the same rule as the tracker's
// excludeDrafts / onlyDrafts split.
async function findQds(q, userId) {
  const pattern = search.containsPattern(q);
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT * FROM quality_discrepancies WHERE ${QD_MATCH}
       AND (approval_state <> 'Draft' OR created_by = $4)
       ORDER BY ${QD_RANK}, raised_date DESC, id DESC LIMIT ${search.CANDIDATE_LIMIT}`,
      [pattern, q.toLowerCase(), search.prefixPattern(q), userId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM quality_discrepancies WHERE ${QD_MATCH}
       AND (approval_state <> 'Draft' OR created_by = $2)`,
      [pattern, userId],
    ),
  ]);
  return {
    items: search.rankRows(rows.rows, q, search.QD_SEARCH)
      .map(({ row, matchedField }) => ({ ...presentQd(row), matchedField })),
    total: count.rows[0].total,
  };
}

// GET /api/search?q=
router.get('/', async (req, res) => {
  const q = search.normaliseQuery(req.query.q);
  if (!q) return res.status(400).json({ error: `Type at least ${search.MIN_QUERY_LENGTH} characters` });
  try {
    const [orders, qds] = await Promise.all([
      canReadSource(req.user, 'order') ? findOrders(q) : null,
      canReadSource(req.user, 'qd') ? findQds(q, req.user.id) : null,
    ]);
    res.json({ ...(orders && { orders }), ...(qds && { qds }) });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

> Note for the implementer: the fake DB in the test normalises whitespace, so the multi-line template SQL above still matches the `startsWith` checks.

- [ ] **Step 4: Mount the route in `server/index.cjs`**

Add next to the other router requires:

```js
const searchRouter = require('./routes/search.cjs');
```

Add directly after the `/api/quality-discrepancies` mount:

```js
// Per-group page access is checked inside the router: a user may read orders
// but not QDs, or the reverse.
app.use('/api/search', authMiddleware, searchRouter);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test server/routes/search.test.cjs server/services/search.test.cjs`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/search.cjs server/routes/search.test.cjs server/index.cjs
git commit -m "feat(search): GET /api/search across die orders and QDs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/search/qd/:id` (full QD for the drawer)

The search list returns a slim QD row. The QD Tracker only shows what is in its own list, which excludes drafts unless "Drafts" is on. So opening a result needs the same full, decorated record the Work Queue fetches (`server/routes/work-queue.cjs:37-42`).

**Files:**
- Modify: `server/routes/search.cjs`
- Test: `server/routes/search.test.cjs`

**Interfaces:**
- Consumes: `qd.listQDs(client, id)` and `qd.canActOnApproval(user, record)` from `server/services/qualityDiscrepancies.cjs`; `qdSettings.getQdSettings(pool)` and `qdSettings.isApprover(user, ids)` from `server/services/qdSettings.cjs`.
- Produces: `GET /api/search/qd/:id` → the `listQDs` record plus `can_approve: boolean` and `assigned_approver_name: string | null`. `403` without QD access, `400` for a non-integer id, `404` when it is missing or is someone else's Draft.

- [ ] **Step 1: Extend the fake DB and add failing tests**

In `server/routes/search.test.cjs`, add `let qdById = null;` beside the other fixtures, reset it in `beforeEach` (`qdById = null;`), and add these branches to the fake directly after the `failQueries` line:

```js
  if (/^SELECT \* FROM quality_discrepancies WHERE \(\$1::integer IS NULL OR id=\$1\)/.test(q)) return { rows: qdById ? [qdById] : [] };
  if (q.startsWith('SELECT * FROM qd_settings')) return { rows: [{ approver_user_ids: JSON.stringify([1]) }] };
  if (q.startsWith('SELECT username FROM users WHERE id=$1')) return { rows: [{ username: 'approver' }] };
  // listQDs' child tables (files, activity, billets, FOC rounds): none here.
  if (/FROM (quality_discrepancy_files|quality_discrepancy_activity|qd_billet_parameters|qd_foc_rounds)/.test(q)) return { rows: [] };
```

The `/^SELECT \* FROM quality_discrepancies WHERE \(\$1::integer/` branch must come **before** the existing `startsWith('SELECT * FROM quality_discrepancies WHERE (')` branch, because both match.

(Confirmed: `listBilletParameters` reads `qd_billet_parameters`, and `qdFocRounds.listRounds` reads `qd_foc_rounds`.)

Then add the tests:

```js
const openQd = (id) => request(base, `/api/search/qd/${id}`);

test('the QD record endpoint returns the decorated record', async () => {
  qdById = { id: 5, qd_no: 'QD-25-031', approval_state: 'Approved', created_by: 7, assigned_approver: 1, raised_date: '2025-03-01' };
  const { status, body } = await openQd(5);
  assert.equal(status, 200);
  assert.equal(body.id, 5);
  assert.equal(body.assigned_approver_name, 'approver');
  assert.equal(typeof body.can_approve, 'boolean');
});

test('someone else\'s draft is a 404; your own draft opens', async () => {
  qdById = { id: 9, qd_no: null, approval_state: 'Draft', created_by: 7, assigned_approver: null };
  currentUser = { id: 42, username: 'other', role: 'user', pageAccess: ['qd-tracker'] };
  assert.equal((await openQd(9)).status, 404);
  currentUser = { id: 7, username: 'raiser', role: 'user', pageAccess: ['qd-tracker'] };
  const mine = await openQd(9);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.assigned_approver_name, null);
});

test('the QD record endpoint refuses users without QD access and bad ids', async () => {
  currentUser = { id: 4, username: 'orders-only', role: 'user', pageAccess: ['orders'] };
  assert.equal((await openQd(5)).status, 403);
  currentUser = ADMIN;
  assert.equal((await openQd('abc')).status, 400);
  assert.equal((await openQd(0)).status, 400);
  assert.equal((await openQd(123)).status, 404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/routes/search.test.cjs`
Expected: the three new tests FAIL with status `404` (no route yet), or with an unexpected-query error.

- [ ] **Step 3: Implement**

Add these requires at the top of `server/routes/search.cjs`:

```js
const qd = require('../services/qualityDiscrepancies.cjs');
const qdSettings = require('../services/qdSettings.cjs');
```

Add above `module.exports`:

```js
// GET /api/search/qd/:id — the full QD a search result opens. The tracker's own
// list leaves out drafts and anything outside its filters, so the drawer is
// handed this record directly, the same way the Work Queue does it.
router.get('/qd/:id', async (req, res) => {
  if (!canReadSource(req.user, 'qd')) return res.status(403).json({ error: 'Page access required' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid QD id' });
  try {
    const record = (await qd.listQDs(pool, id))[0];
    if (!record || (record.approval_state === 'Draft' && record.created_by !== req.user.id)) {
      return res.status(404).json({ error: 'QD not found' });
    }
    const settings = await qdSettings.getQdSettings(pool);
    record.can_approve = qdSettings.isApprover(req.user, settings.approverUserIds) && qd.canActOnApproval(req.user, record);
    record.assigned_approver_name = record.assigned_approver
      ? (await pool.query('SELECT username FROM users WHERE id=$1', [record.assigned_approver])).rows[0]?.username || null
      : null;
    res.json(record);
  } catch (error) {
    console.error('Search QD record error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/routes/search.test.cjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/search.cjs server/routes/search.test.cjs
git commit -m "feat(search): full QD record endpoint for opening search results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Client API and pure palette helpers

**Files:**
- Modify: `src/api.js` (add `searchAPI` after `qualityDiscrepanciesAPI`, around line 1111)
- Modify: `src/api.test.js`
- Create: `src/utils/searchPalette.js`
- Test: `src/utils/searchPalette.test.js`

**Interfaces:**
- Produces:
  - `searchAPI.query(q: string, { signal }?: { signal?: AbortSignal }): Promise<SearchResults>`
  - `searchAPI.qd(id: number): Promise<QdRecord>`
  - From `src/utils/searchPalette.js`: `MIN_QUERY_LENGTH = 2`, `DEBOUNCE_MS = 200`, `GROUP_LABELS = { order: 'Die orders', qd: 'Quality Discrepancies' }`, `shouldSearch(q): boolean`, `isSearchShortcut(event): boolean`, `flattenResults(results): Array<{ kind: 'order' | 'qd', item }>`, `moveIndex(current, delta, length): number`, `isAbort(error): boolean`, `shortcutLabel(platform?: string): string`.

- [ ] **Step 1: Write the failing tests**

Append to `src/api.test.js`, and add `searchAPI` to the destructured `await import('./api.js')` at the top:

```js
test('searchAPI.query encodes the query and passes the abort signal through', async () => {
  let seen;
  globalThis.fetch = async (url, options) => { seen = { url, options }; return new Response('{"orders":{"items":[],"total":0}}', { status: 200 }); };
  const controller = new AbortController();
  const body = await searchAPI.query('QD-25/031 & 50%', { signal: controller.signal });
  assert.equal(seen.url, '/api/search?q=QD-25%2F031%20%26%2050%25');
  assert.equal(seen.options.signal, controller.signal);
  assert.deepEqual(body, { orders: { items: [], total: 0 } });
});

test('searchAPI.qd fetches one QD by id', async () => {
  let seenUrl;
  globalThis.fetch = async (url) => { seenUrl = url; return new Response('{"id":5}', { status: 200 }); };
  assert.equal((await searchAPI.qd(5)).id, 5);
  assert.equal(seenUrl, '/api/search/qd/5');
});
```

Create `src/utils/searchPalette.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSearch, isSearchShortcut, flattenResults, moveIndex, isAbort, shortcutLabel,
} from './searchPalette.js';

test('shouldSearch needs two non-space characters', () => {
  assert.equal(shouldSearch('ab'), true);
  assert.equal(shouldSearch(' a '), false);
  assert.equal(shouldSearch(''), false);
  assert.equal(shouldSearch(null), false);
});

test('Ctrl+K and Cmd+K open the palette; other combinations do not', () => {
  const key = (props) => ({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...props });
  assert.equal(isSearchShortcut(key({ ctrlKey: true })), true);
  assert.equal(isSearchShortcut(key({ metaKey: true })), true);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, key: 'K' })), true); // caps lock
  assert.equal(isSearchShortcut(key({})), false);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, shiftKey: true })), false);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, altKey: true })), false);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, key: 'j' })), false);
});

test('flattenResults lists orders before QDs and tolerates missing groups', () => {
  const flat = flattenResults({ orders: { items: [{ id: 1 }], total: 1 }, qds: { items: [{ id: 2 }, { id: 3 }], total: 2 } });
  assert.deepEqual(flat.map(r => `${r.kind}:${r.item.id}`), ['order:1', 'qd:2', 'qd:3']);
  assert.deepEqual(flattenResults({ qds: { items: [{ id: 2 }], total: 1 } }).map(r => r.kind), ['qd']);
  assert.deepEqual(flattenResults(null), []);
});

test('moveIndex wraps both ways and starts at the right end', () => {
  assert.equal(moveIndex(-1, 1, 3), 0);
  assert.equal(moveIndex(-1, -1, 3), 2);
  assert.equal(moveIndex(2, 1, 3), 0);
  assert.equal(moveIndex(0, -1, 3), 2);
  assert.equal(moveIndex(1, 1, 0), -1);
});

test('isAbort recognises a cancelled fetch only', () => {
  assert.equal(isAbort(new DOMException('aborted', 'AbortError')), true);
  assert.equal(isAbort(new Error('Search failed')), false);
  assert.equal(isAbort(undefined), false);
});

test('shortcutLabel shows ⌘K on Mac and Ctrl K elsewhere', () => {
  assert.equal(shortcutLabel('MacIntel'), '⌘K');
  assert.equal(shortcutLabel('Win32'), 'Ctrl K');
  assert.equal(shortcutLabel(undefined), 'Ctrl K');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/api.test.js src/utils/searchPalette.test.js`
Expected: FAIL (`searchAPI` is undefined; `./searchPalette.js` not found).

- [ ] **Step 3: Implement**

Add to `src/api.js` after the `qualityDiscrepanciesAPI` block:

```js
// Universal search (Ctrl+K palette). The signal lets the palette cancel a
// query the user has already typed past.
export const searchAPI = {
    query: (q, { signal } = {}) => apiRequest(`/search?q=${encodeURIComponent(q)}`, { signal }),
    qd: (id) => apiRequest(`/search/qd/${encodeURIComponent(id)}`),
};
```

Create `src/utils/searchPalette.js`:

```js
// Pure helpers for the Ctrl+K search palette, kept out of the component so
// they can be tested under plain node.

export const MIN_QUERY_LENGTH = 2;
export const DEBOUNCE_MS = 200;
export const GROUP_LABELS = { order: 'Die orders', qd: 'Quality Discrepancies' };

export const shouldSearch = (q) => (q || '').trim().length >= MIN_QUERY_LENGTH;

// Shift and Alt are left alone so Ctrl+Shift+K (browser devtools) still works.
export const isSearchShortcut = (event) => (event.ctrlKey || event.metaKey)
  && !event.altKey && !event.shiftKey && (event.key === 'k' || event.key === 'K');

// One list in display order, so arrow keys move across both groups.
export const flattenResults = (results) => [
  ...(results?.orders?.items || []).map((item) => ({ kind: 'order', item })),
  ...(results?.qds?.items || []).map((item) => ({ kind: 'qd', item })),
];

export const moveIndex = (current, delta, length) => {
  if (!length) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
};

export const isAbort = (error) => error?.name === 'AbortError';

export const shortcutLabel = (platform = globalThis.navigator?.platform) =>
  (/mac/i.test(platform || '') ? '⌘K' : 'Ctrl K');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/api.test.js src/utils/searchPalette.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.js src/api.test.js src/utils/searchPalette.js src/utils/searchPalette.test.js
git commit -m "feat(search): client API and palette helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `SearchPalette` component

**Files:**
- Create: `src/components/search/SearchPalette.jsx`

**Interfaces:**
- Consumes: `searchAPI.query` (Task 4); `shouldSearch`, `flattenResults`, `moveIndex`, `isAbort`, `DEBOUNCE_MS`, `GROUP_LABELS` (Task 4); `useDialog` (`src/hooks/useDialog.js`, default export, `useDialog({ open, onClose }) → ref`); `StatusPill` (`src/components/ui/StatusPill.jsx`, props `{ status, theme }`).
- Produces: `export default function SearchPalette({ open, onClose, theme, onOpenOrder, onOpenQd })`.
  - `onOpenOrder(order)` receives a presented order.
  - `onOpenQd(qdListItem)` receives `{ id, … }` and returns a Promise. The palette shows "Opening…" while it is pending and an error line if it rejects.

This component has no unit test, because the repo doesn't render JSX under `node:test`. It is verified in the browser in Task 6. Its logic sits in the Task 4 helpers, which are tested.

- [ ] **Step 1: Write the component**

```jsx
// src/components/search/SearchPalette.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Package, AlertTriangle } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import StatusPill from '../ui/StatusPill';
import { searchAPI } from '../../api';
import {
  shouldSearch, flattenResults, moveIndex, isAbort, DEBOUNCE_MS, GROUP_LABELS,
} from '../../utils/searchPalette';

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function SearchPalette({ open, onClose, theme, onOpenOrder, onOpenQd }) {
  const dialogRef = useDialog({ open, onClose });
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [active, setActive] = useState(-1);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const listRef = useRef(null);

  // Fresh palette every time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery(''); setResults(null); setStatus('idle'); setActive(-1); setOpening(false); setOpenError('');
  }, [open]);

  // Debounced search; aborting the previous request keeps a slow, older
  // answer from replacing a newer one.
  useEffect(() => {
    if (!open || !shouldSearch(query)) { setResults(null); setStatus('idle'); return undefined; }
    const controller = new AbortController();
    setStatus('loading');
    const timer = setTimeout(() => {
      searchAPI.query(query.trim(), { signal: controller.signal })
        .then((body) => { setResults(body); setStatus('done'); setActive(flattenResults(body).length ? 0 : -1); })
        .catch((error) => { if (!isAbort(error)) setStatus('error'); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  const flat = useMemo(() => flattenResults(results), [results]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = async (entry) => {
    if (!entry || opening) return;
    setOpenError('');
    if (entry.kind === 'order') { onOpenOrder(entry.item); onClose(); return; }
    setOpening(true);
    try {
      await onOpenQd(entry.item);
      onClose();
    } catch (error) {
      setOpenError(error?.message || 'Could not open that QD');
    } finally {
      setOpening(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => moveIndex(i, 1, flat.length)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => moveIndex(i, -1, flat.length)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(flat[active]); }
  };

  if (!open) return null;

  const muted = { color: theme.textMuted, fontSize: '0.8rem' };
  const groups = [
    { kind: 'order', group: results?.orders, Icon: Package },
    { kind: 'qd', group: results?.qds, Icon: AlertTriangle },
  ].filter(({ group }) => group && group.items.length);

  let index = -1;
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 16px 16px' }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}
        style={{ width: '100%', maxWidth: 640, background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, boxShadow: theme.shadowLg, overflow: 'hidden', color: theme.text }}>
        <h2 id={titleId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${theme.cardBorder}` }}>
          <Search size={18} style={{ color: theme.textDim, flexShrink: 0 }} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded={flat.length > 0} aria-controls={`${titleId}-list`}
            aria-activedescendant={active >= 0 ? `${titleId}-opt-${active}` : undefined}
            aria-label="Search die orders and QDs" placeholder="Search die no, order no, QD no, supplier…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: theme.text, fontSize: '1rem' }} />
          <kbd style={{ ...muted, border: `1px solid ${theme.cardBorder}`, borderRadius: 6, padding: '2px 6px' }}>Esc</kbd>
        </div>

        <div ref={listRef} id={`${titleId}-list`} role="listbox" style={{ maxHeight: '55vh', overflowY: 'auto', padding: '6px 0' }}>
          {status === 'idle' && <p style={{ ...muted, padding: '14px 16px' }}>Type at least 2 characters to search die orders and Quality Discrepancies.</p>}
          {status === 'loading' && !results && <p style={{ ...muted, padding: '14px 16px' }}>Searching…</p>}
          {status === 'error' && <p role="alert" style={{ padding: '14px 16px', color: '#ef4444', fontSize: '0.85rem' }}>Search failed — try again.</p>}
          {status === 'done' && flat.length === 0 && <p style={{ ...muted, padding: '14px 16px' }}>No matches for “{query.trim()}”.</p>}

          {groups.map(({ kind, group, Icon }) => (
            <div key={kind} role="group" aria-label={GROUP_LABELS[kind]}>
              <div style={{ ...muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 16px 4px' }}>{GROUP_LABELS[kind]}</div>
              {group.items.map((item) => {
                index += 1;
                const i = index;
                const isActive = i === active;
                return (
                  <div key={`${kind}-${item.id}`} id={`${titleId}-opt-${i}`} data-index={i} role="option" aria-selected={isActive}
                    onMouseMove={() => setActive(i)} onClick={() => choose({ kind, item })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer', background: isActive ? theme.rowHover : 'transparent' }}>
                    <Icon size={16} style={{ color: theme.textDim, flexShrink: 0 }} />
                    {kind === 'order' ? (
                      <>
                        <span style={{ fontWeight: 600 }}>{item['DIE NO'] || '—'}</span>
                        <span style={muted}>{item['Order No'] || 'No order no'}</span>
                        <span style={{ ...muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.Supplier || ''}</span>
                        {item.STATUS && <StatusPill status={item.STATUS} theme={theme} />}
                      </>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600 }}>{item.qd_no || (item.approval_state === 'Draft' ? 'Draft QD' : `QD #${item.id}`)}</span>
                        <span style={muted}>{item.die_no}</span>
                        <span style={{ ...muted, flex: 1 }}>{formatDate(item.raised_date)}</span>
                        <span style={{ ...muted, fontWeight: 600 }}>{item.approval_state === 'Draft' ? 'Draft' : item.status}</span>
                      </>
                    )}
                  </div>
                );
              })}
              {group.total > group.items.length && (
                <div style={{ ...muted, padding: '4px 16px 8px' }}>Showing {group.items.length} of {group.total} — type more to narrow it down.</div>
              )}
            </div>
          ))}
        </div>

        {(opening || openError) && (
          <div role={openError ? 'alert' : 'status'} style={{ padding: '10px 16px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.85rem', color: openError ? '#ef4444' : theme.textMuted }}>
            {openError || 'Opening…'}
          </div>
        )}
      </div>
    </div>
  );
}
```

`presentOrder` uses the keys `'DIE NO'`, `'Order No'`, `Supplier` and `STATUS` (`server/services/orderPresentation.cjs`).

- [ ] **Step 2: Lint**

Run: `npx eslint src/components/search/SearchPalette.jsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/search/SearchPalette.jsx
git commit -m "feat(search): SearchPalette modal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire into the app, verify in the browser

**Files:**
- Modify: `src/DieOrderingSystem.jsx`
  - state near `focusQdId` (~line 2048)
  - shortcut effect beside it
  - `<SearchPalette>` render beside `OrderDetailModal` (~line 3382)
  - `TopBar` props (~line 3167)
- Modify: `src/components/layout/TopBar.jsx` (button after the search input, ~line 133)

**Interfaces:**
- Consumes: `SearchPalette` (Task 5); `searchAPI.qd` and `isSearchShortcut`, `shortcutLabel` (Task 4); existing `setSelectedOrder`, `setData`, `setFocusQdId`, `setFocusQdRecord`, `setActiveTab`, `hasPageAccess`.
- Produces: the `TopBar` prop `onOpenSearch: () => void`.

- [ ] **Step 1: Add palette state, the global shortcut and the open handlers in `DieOrderingSystem.jsx`**

Imports at the top of the file:

```js
import SearchPalette from './components/search/SearchPalette';
import { searchAPI } from './api';           // merge into the existing './api' import if there is one
import { isSearchShortcut } from './utils/searchPalette';
```

Directly after the `focusSampleId` state (~line 2050):

```js
  // Universal search (Ctrl+K). Separate from the top-bar box, which still
  // filters the current page.
  const [showSearch, setShowSearch] = useState(false);
  useEffect(() => {
    if (!isLoggedIn || forcePasswordChange) return undefined;
    const onKeyDown = (event) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault(); // otherwise Chrome focuses its own address bar search
      setShowSearch(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isLoggedIn, forcePasswordChange]);

  // Upserted into `data` (like openQueueSource) so an order past the register's
  // 5000-row cap still opens, and OrderDetailModal's onUpdate finds it.
  // matchedField is search metadata and stays out of the register.
  const openSearchOrder = ({ matchedField: _matchedField, ...order }) => {
    setData(previous => [...previous.filter(row => row.id !== order.id), order]);
    setSelectedOrder(order);
  };

  const openSearchQd = async (item) => {
    const record = await searchAPI.qd(item.id);
    setFocusQdRecord(record);
    setFocusQdId(record.id);
    setActiveTab('qd-tracker');
  };
```

`_matchedField` passes lint: `eslint.config.js` ignores unused vars that match `^[A-Z_]`.

Render it next to the `OrderDetailModal` line (~3382):

```jsx
        <SearchPalette open={showSearch} onClose={() => setShowSearch(false)} theme={theme}
          onOpenOrder={openSearchOrder} onOpenQd={openSearchQd} />
```

Pass the opener to `TopBar` (~line 3167):

```jsx
          onOpenSearch={() => setShowSearch(true)}
```

- [ ] **Step 2: Add the button in `TopBar.jsx`**

Add `onOpenSearch` to the destructured props, then add an import:

```js
import { shortcutLabel } from '../../utils/searchPalette';
```

Directly after the closing `</div>` of the existing search-bar wrapper (the `position: 'relative', flex: 1, maxWidth: '400px'` div):

```jsx
                {onOpenSearch && (
                    <button type="button" onClick={onOpenSearch} aria-label="Search all die orders and QDs"
                        title="Search all die orders and QDs"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '50px', color: theme.textMuted, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <Search size={16} />
                        Search all
                        <kbd style={{ fontSize: '0.75rem', border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', padding: '1px 6px' }}>{shortcutLabel()}</kbd>
                    </button>
                )}
```

`Search` is already imported in `TopBar.jsx`.

- [ ] **Step 3: Run the full test suite, lint and build**

Run: `npm test`
Expected: all tests PASS, including the new search tests.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Browser verification on the local stack**

Use the project's normal run route (see the `dev-workflow` memory: the local stack is a TEST server; sign in with the test user from that memory and its seed). In the built-in browser:

1. On the **Dashboard**, press Ctrl+K. The palette opens with the input focused. Press Esc and it closes, with focus back on the page.
2. Click **Search all** in the top bar. The palette opens.
3. Type a real die no. The **Die orders** group appears, with the exact match first. Press Enter and the order detail modal opens. It is view-only because you're not on the Orders tab.
4. Type a real QD no and press Enter. The app switches to the **QD Tracker** with that QD's drawer open.
5. Type `30533_201` (or any die no with `_`). Only literal matches appear.
6. Type a single character. You see the "Type at least 2 characters" hint and no request in `read_network_requests`.
7. Type quickly, then check `read_network_requests`: earlier `/api/search` requests are cancelled, and no "Search failed" message flashes.
8. Check `read_console_messages` for errors.
9. Repeat step 1 in dark mode and at mobile width (`resize_window` preset `mobile`). The palette fits with 16px gutters and no horizontal scroll. Reset with preset `desktop` afterwards.
10. Take a screenshot of the palette with both groups showing, as proof.

- [ ] **Step 5: Commit**

```bash
git add src/DieOrderingSystem.jsx src/components/layout/TopBar.jsx
git commit -m "feat(search): Ctrl+K universal search palette wired into the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deploy note

No database migration. The new route is plain Express behind the existing nginx `/api` proxy, so a rebuild of the backend and frontend images is enough.
