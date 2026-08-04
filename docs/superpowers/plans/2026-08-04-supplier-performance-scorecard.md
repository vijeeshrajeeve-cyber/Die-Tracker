# Supplier Performance Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-supplier scorecard on the Analytics page that rates performance 0–10 against admin-configurable targets, using only metrics the database can actually supply.

**Architecture:** Scoring lives on the server — a pure model in `supplierPerformance.cjs`, targets in a single-row settings table following the `qdSettings.cjs` pattern, and aggregation SQL over `die_orders` and `quality_discrepancies`. The frontend renders a report from that payload using SVG primitives ported from the Claude Design project. `AnalyticsPage` gains a tab bar with the existing `OverviewTab` and the new `SupplierReportTab`.

**Tech Stack:** Node/Express + `pg`, `node:test` with a hand-rolled fake pool, React with inline styles, dependency-free SVG charts (no recharts in the report — it must print).

**Spec:** `docs/superpowers/specs/2026-08-04-supplier-performance-evaluation-design.md` — this plan covers Phases 2–4. Phase 1 (Overview tab) is already merged.

## Global Constraints

- **Never invent a number.** Die Life and Die Failure have no data source and are omitted entirely — no placeholder cards, no estimated values, no "coming soon" tiles.
- **A metric with no data scores `null`**, is dropped from the weighted mean, and the mean is renormalised over the weights actually present. It must never score 0. JIANGSU and PHOENIX have no trials recorded; rating them "At risk" for uncollected data is the specific failure this prevents.
- **If every metric is null there is no rating** — the report shows "Not enough data", not 0.0.
- QD Rate is labelled **"QD Rate"**, never "Die Failure". It counts discrepancies raised, not dies failing before rated life.
- Weights must total 100%. `ten` must never equal `zero` (division by zero in the score).
- Backend tests: `node:test`, run with `npm test`. Mock the pool as `{ query: async (sql, params) => ... }` — see `server/services/qdSettings.test.cjs`.
- Frontend: no component test framework. Verify with `npm run lint` and `npm run build`.
- Lint baseline on `main` is **77 problems (75 errors, 2 warnings)**. Do not exceed it.
- Schema changes go in `server/db.cjs` as idempotent blocks **and** are mirrored into `init.sql`.
- **`docker compose restart` never picks up a source edit** — always `docker compose build <svc> && docker compose up -d <svc>`.
- When exec'ing psql, pass `-h /var/run/postgresql`, and from Git Bash prefix with `MSYS_NO_PATHCONV=1`.

---

### Task 1: Settings table and service

**Files:**
- Modify: `server/db.cjs` (after the `qd_settings` block, ~line 513), `init.sql`
- Create: `server/services/supplierPerformanceSettings.cjs`
- Test: `server/services/supplierPerformanceSettings.test.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `METRIC_DEFAULTS` — array of metric metadata objects, order significant
  - `getSettings(pool) -> Promise<metrics[]>` — stored tunables merged over `METRIC_DEFAULTS`
  - `saveSettings(pool, metrics) -> Promise<void>` — throws `.status = 400` on bad input
  - `validateMetrics(metrics) -> void` — throws `.status = 400`; exported for direct testing

Only the tunable fields (`ten`, `zero`, `target`, `weight`) are persisted. Labels, units and decimals stay in code — presentation does not belong in the database.

- [ ] **Step 1: Add the table to `init.sql`**

Append after the `correctors` block:

```sql
-- Supplier performance scoring targets and weights. One row; `metrics` is a
-- JSON array of { key, ten, zero, target, weight }. Empty means "use the code
-- defaults" (see server/services/supplierPerformanceSettings.cjs).
CREATE TABLE IF NOT EXISTS supplier_performance_settings (
    id         SERIAL PRIMARY KEY,
    metrics    TEXT DEFAULT '[]',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: Mirror it into `server/db.cjs`**

Add the identical `CREATE TABLE IF NOT EXISTS supplier_performance_settings (...)` statement inside the migration template literal, immediately after the `qd_settings` `ALTER TABLE ... alloy_options` line (~513). The SQL contains no `$$` and no `${`, so paste it verbatim.

- [ ] **Step 3: Write the failing tests**

Create `server/services/supplierPerformanceSettings.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./supplierPerformanceSettings.cjs');

const makePool = (replies = []) => {
  const calls = [];
  let i = 0;
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return replies[i++] || { rows: [] }; } };
};

test('METRIC_DEFAULTS weights total exactly 1', () => {
  const total = s.METRIC_DEFAULTS.filter(m => m.scored).reduce((a, m) => a + m.weight, 0);
  assert.equal(Math.round(total * 1000) / 1000, 1);
});

test('METRIC_DEFAULTS omits die life and die failure', () => {
  const keys = s.METRIC_DEFAULTS.map(m => m.key);
  assert.ok(!keys.includes('dieLife'), 'die life is not tracked and must not appear');
  assert.ok(!keys.includes('dieFailure'), 'die failure is not tracked and must not appear');
});

test('getSettings returns the code defaults when no row exists', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.deepEqual(await s.getSettings(pool), s.METRIC_DEFAULTS);
});

test('getSettings merges stored tunables over the defaults', async () => {
  const pool = makePool([{ rows: [{ metrics: JSON.stringify([{ key: 'designLeadTime', target: 2, ten: 2, zero: 8, weight: 0.2 }]) }] }]);
  const out = await s.getSettings(pool);
  const dlt = out.find(m => m.key === 'designLeadTime');
  assert.equal(dlt.target, 2);
  assert.equal(dlt.zero, 8);
  assert.equal(dlt.label, 'Avg Design Lead Time', 'label comes from code, not the database');
});

test('getSettings falls back to defaults when the stored JSON is junk', async () => {
  const pool = makePool([{ rows: [{ metrics: 'not json' }] }]);
  assert.deepEqual(await s.getSettings(pool), s.METRIC_DEFAULTS);
});

test('validateMetrics rejects weights that do not total 1', () => {
  const bad = s.METRIC_DEFAULTS.map(m => (m.key === 'qdRate' ? { ...m, weight: 0.5 } : m));
  assert.throws(() => s.validateMetrics(bad), (e) => e.status === 400 && /total/i.test(e.message));
});

test('validateMetrics rejects ten equal to zero', () => {
  const bad = s.METRIC_DEFAULTS.map(m => (m.key === 'trialRatio' ? { ...m, ten: 2, zero: 2 } : m));
  assert.throws(() => s.validateMetrics(bad), (e) => e.status === 400);
});

test('validateMetrics accepts the defaults unchanged', () => {
  assert.doesNotThrow(() => s.validateMetrics(s.METRIC_DEFAULTS));
});

test('saveSettings persists only the tunable fields', async () => {
  const pool = makePool([{ rows: [{ id: 1 }] }, { rows: [] }]);
  await s.saveSettings(pool, s.METRIC_DEFAULTS);
  const upd = pool.calls.find(c => /UPDATE supplier_performance_settings/.test(c.sql));
  const stored = JSON.parse(upd.params[0]);
  assert.deepEqual(Object.keys(stored[0]).sort(), ['key', 'target', 'ten', 'weight', 'zero']);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test server/services/supplierPerformanceSettings.test.cjs`
Expected: FAIL — `Cannot find module './supplierPerformanceSettings.cjs'`

- [ ] **Step 5: Write the service**

Create `server/services/supplierPerformanceSettings.cjs`:

```javascript
'use strict';

// Scoring targets and weights for the supplier scorecard.
//
// Die Life and Die Failure are deliberately absent: nothing in the schema
// records tonnage extruded or dies failing before rated life, and 45% of the
// original design's weighting rested on them. Omitted rather than estimated.
// See docs/superpowers/specs/2026-08-04-supplier-performance-evaluation-design.md.
//
// The seed targets come from the observed distribution on real orders, not
// from the design mock. The mock's ≤7 day design-lead-time target sat far
// above actual performance of 1.6–5.2 days, which would have scored every
// supplier 10/10 and made that 20% of the rating carry no information.
const METRIC_DEFAULTS = [
  { key: 'ordersPlaced', label: 'Orders Placed', unit: '', scored: false, decimals: 0,
    blurb: 'Dies ordered in the period' },
  { key: 'designLeadTime', label: 'Avg Design Lead Time', unit: 'days', scored: true,
    lowerBetter: true, ten: 3, zero: 10, target: 3, weight: 0.20, decimals: 1,
    blurb: 'Order placed → design received' },
  { key: 'deliveryLeadTime', label: 'Avg Delivery Lead Time', unit: 'days', scored: true,
    lowerBetter: true, ten: 30, zero: 55, target: 30, weight: 0.30, decimals: 0,
    blurb: 'Order placed → die received on site' },
  { key: 'trialRatio', label: 'Avg Trial Ratio', unit: 'trials/die', scored: true,
    lowerBetter: true, ten: 1.5, zero: 3.0, target: 1.5, weight: 0.20, decimals: 2,
    blurb: 'Trials needed before acceptance' },
  { key: 'qdRate', label: 'QD Rate', unit: '%', scored: true,
    lowerBetter: true, ten: 5, zero: 20, target: 5, weight: 0.20, decimals: 1,
    blurb: 'Discrepancies raised per die received' },
  { key: 'designRevisions', label: 'Design Revisions', unit: 'per die', scored: true,
    lowerBetter: true, ten: 1.0, zero: 3.0, target: 1.0, weight: 0.10, decimals: 2,
    blurb: 'Design revisions before approval' },
];

const TUNABLE = ['ten', 'zero', 'target', 'weight'];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validateMetrics(metrics) {
  if (!Array.isArray(metrics) || !metrics.length) throw fail(400, 'Metrics are required');
  let total = 0;
  for (const m of metrics) {
    const def = METRIC_DEFAULTS.find(d => d.key === m.key);
    if (!def) throw fail(400, `Unknown metric "${m.key}"`);
    if (!def.scored) continue;
    for (const f of TUNABLE) {
      if (!Number.isFinite(Number(m[f]))) throw fail(400, `${def.label}: ${f} must be a number`);
    }
    // A zero-width band divides by zero in scoreMetric.
    if (Number(m.ten) === Number(m.zero)) {
      throw fail(400, `${def.label}: the 10-point and 0-point values must differ`);
    }
    total += Number(m.weight);
  }
  const pct = Math.round(total * 1000) / 1000;
  if (pct !== 1) throw fail(400, `Weights must total 100% (currently ${Math.round(total * 100)}%)`);
}

async function getSettings(pool) {
  const { rows } = await pool.query('SELECT metrics FROM supplier_performance_settings ORDER BY id LIMIT 1');
  let stored = [];
  try {
    const parsed = JSON.parse(rows[0]?.metrics || '[]');
    if (Array.isArray(parsed)) stored = parsed;
  } catch { stored = []; }

  // Presentation fields always come from code; only tunables are read back.
  return METRIC_DEFAULTS.map((def) => {
    const s = stored.find(x => x && x.key === def.key);
    if (!s) return def;
    const merged = { ...def };
    for (const f of TUNABLE) if (Number.isFinite(Number(s[f]))) merged[f] = Number(s[f]);
    return merged;
  });
}

async function saveSettings(pool, metrics) {
  validateMetrics(metrics);
  const slim = metrics
    .filter(m => METRIC_DEFAULTS.find(d => d.key === m.key && d.scored))
    .map(m => ({ key: m.key, ten: Number(m.ten), zero: Number(m.zero), target: Number(m.target), weight: Number(m.weight) }));
  const json = JSON.stringify(slim);
  const existing = await pool.query('SELECT id FROM supplier_performance_settings ORDER BY id LIMIT 1');
  if (existing.rows.length) {
    await pool.query(
      'UPDATE supplier_performance_settings SET metrics = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [json, existing.rows[0].id]);
  } else {
    await pool.query('INSERT INTO supplier_performance_settings (metrics) VALUES ($1)', [json]);
  }
}

module.exports = { METRIC_DEFAULTS, validateMetrics, getSettings, saveSettings };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 9 new tests, no pre-existing test broken.

- [ ] **Step 7: Rebuild the backend and confirm the table exists**

```bash
docker compose build backend && docker compose up -d backend
```

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "\d supplier_performance_settings"
```

Expected: columns `id`, `metrics`, `updated_at`.

- [ ] **Step 8: Commit**

```bash
git add init.sql server/db.cjs server/services/supplierPerformanceSettings.cjs server/services/supplierPerformanceSettings.test.cjs
git commit -m "feat(scorecard): scoring targets table and settings service"
```

---

### Task 2: Scoring model

**Files:**
- Create: `server/services/supplierPerformance.cjs`
- Test: `server/services/supplierPerformance.test.cjs`

**Interfaces:**
- Consumes: `METRIC_DEFAULTS` from Task 1.
- Produces:
  - `scoreMetric(metric, value) -> number | null` — 0–10, `null` when value is `null`/undefined or the metric is unscored
  - `overallRating(metrics, snapshot) -> { score: number, contributing: number } | null` — `null` when nothing scored
  - `ratingBand(score) -> { label, color, bg }`

- [ ] **Step 1: Write the failing tests**

Create `server/services/supplierPerformance.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('./supplierPerformance.cjs');
const { METRIC_DEFAULTS } = require('./supplierPerformanceSettings.cjs');

const metric = (key) => METRIC_DEFAULTS.find(m => m.key === key);

test('scoreMetric: lower-better scores 10 at the target and 0 at the floor', () => {
  const m = metric('deliveryLeadTime'); // ten 30, zero 55
  assert.equal(p.scoreMetric(m, 30), 10);
  assert.equal(p.scoreMetric(m, 55), 0);
  assert.equal(p.scoreMetric(m, 42.5), 5);
});

test('scoreMetric clamps outside the band rather than going negative or past 10', () => {
  const m = metric('deliveryLeadTime');
  assert.equal(p.scoreMetric(m, 5), 10);
  assert.equal(p.scoreMetric(m, 900), 0);
});

test('scoreMetric returns null for a missing value', () => {
  const m = metric('trialRatio');
  assert.equal(p.scoreMetric(m, null), null);
  assert.equal(p.scoreMetric(m, undefined), null);
});

test('scoreMetric returns null for an unscored metric', () => {
  assert.equal(p.scoreMetric(metric('ordersPlaced'), 42), null);
});

test('scoreMetric handles a higher-better metric', () => {
  const m = { key: 'x', scored: true, lowerBetter: false, ten: 100, zero: 0, weight: 1 };
  assert.equal(p.scoreMetric(m, 100), 10);
  assert.equal(p.scoreMetric(m, 0), 0);
  assert.equal(p.scoreMetric(m, 50), 5);
});

test('overallRating renormalises over the weights actually present', () => {
  // Only deliveryLeadTime (weight .30) has data; a perfect score must read 10,
  // not 3, which is what happens if the missing weights are counted as zero.
  const snapshot = { deliveryLeadTime: 30 };
  const out = p.overallRating(METRIC_DEFAULTS, snapshot);
  assert.equal(out.score, 10);
  assert.equal(out.contributing, 1);
});

test('overallRating never treats a missing metric as a zero score', () => {
  // A supplier with no trials recorded must not be dragged down for it.
  const withTrials = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 30, trialRatio: 1.5 });
  const withoutTrials = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 30 });
  assert.equal(withTrials.score, 10);
  assert.equal(withoutTrials.score, 10);
});

test('overallRating weights the contributors correctly', () => {
  // delivery .30 scoring 10, design .20 scoring 0 -> (10*.3 + 0*.2) / .5 = 6
  const out = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 30, designLeadTime: 10 });
  assert.equal(Math.round(out.score * 100) / 100, 6);
  assert.equal(out.contributing, 2);
});

test('overallRating returns null when nothing has data', () => {
  assert.equal(p.overallRating(METRIC_DEFAULTS, {}), null);
  assert.equal(p.overallRating(METRIC_DEFAULTS, { ordersPlaced: 12 }), null);
});

test('ratingBand boundaries', () => {
  assert.equal(p.ratingBand(8.5).label, 'Exceptional');
  assert.equal(p.ratingBand(7.5).label, 'Strong · Preferred');
  assert.equal(p.ratingBand(6.5).label, 'Good · Reliable');
  assert.equal(p.ratingBand(5.5).label, 'Fair · Watch');
  assert.equal(p.ratingBand(4.0).label, 'Marginal · Action needed');
  assert.equal(p.ratingBand(3.9).label, 'At risk');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/supplierPerformance.test.cjs`
Expected: FAIL — `Cannot find module './supplierPerformance.cjs'`

- [ ] **Step 3: Write the scoring model**

Create `server/services/supplierPerformance.cjs`:

```javascript
'use strict';

// Scoring model for the supplier scorecard. Kept separate from the aggregation
// queries so the arithmetic can be tested without a database.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function scoreMetric(metric, value) {
  if (!metric || !metric.scored) return null;
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const frac = metric.lowerBetter
    ? (metric.zero - v) / (metric.zero - metric.ten)
    : (v - metric.zero) / (metric.ten - metric.zero);
  return clamp01(frac) * 10;
}

// Weighted mean over the metrics that actually have data, renormalised by the
// weights present. A metric with no data is excluded — never scored 0. Scoring
// an absence as zero would rate a supplier "At risk" for data nobody collected.
function overallRating(metrics, snapshot) {
  let sum = 0;
  let wsum = 0;
  let contributing = 0;
  for (const m of metrics) {
    if (!m.scored) continue;
    const s = scoreMetric(m, snapshot ? snapshot[m.key] : null);
    if (s === null) continue;
    sum += s * m.weight;
    wsum += m.weight;
    contributing += 1;
  }
  if (!wsum) return null;
  return { score: sum / wsum, contributing };
}

function ratingBand(score) {
  if (score >= 8.5) return { label: 'Exceptional', color: '#16A34A', bg: '#F0FDF4' };
  if (score >= 7.5) return { label: 'Strong · Preferred', color: '#16A34A', bg: '#F0FDF4' };
  if (score >= 6.5) return { label: 'Good · Reliable', color: '#0D9488', bg: '#F0FDFA' };
  if (score >= 5.5) return { label: 'Fair · Watch', color: '#D97706', bg: '#FFFBEB' };
  if (score >= 4.0) return { label: 'Marginal · Action needed', color: '#EA580C', bg: '#FFF7ED' };
  return { label: 'At risk', color: '#DC2626', bg: '#FEF2F2' };
}

module.exports = { scoreMetric, overallRating, ratingBand };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 10 new tests green.

- [ ] **Step 5: Commit**

```bash
git add server/services/supplierPerformance.cjs server/services/supplierPerformance.test.cjs
git commit -m "feat(scorecard): scoring model with renormalising weighted rating"
```

---

### Task 3: Aggregation queries

**Files:**
- Create: `server/services/supplierPerformanceData.cjs`
- Test: `server/services/supplierPerformanceData.test.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure data access).
- Produces:
  - `periodRange({ year, month, frequency }) -> { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }` — `frequency` is `'Monthly' | 'Quarterly' | 'YTD'`
  - `getSnapshot(pool, { supplier, from, to }) -> Promise<{ ordersPlaced, designLeadTime, deliveryLeadTime, trialRatio, qdRate, designRevisions }>` — every value a number or `null`
  - `getMonthlyTrend(pool, { supplier, year, throughMonth }) -> Promise<Array<{ month, ...snapshot }>>` — `month` is `'Jan'`…`'Dec'`
  - `listSuppliers(pool) -> Promise<string[]>`

Orders belong to a period by `ordered_date`, except delivery lead time and QD rate which key off `die_received_date` — a die ordered in March and received in May is May's delivery.

- [ ] **Step 1: Write the failing tests**

Create `server/services/supplierPerformanceData.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./supplierPerformanceData.cjs');

const makePool = (rowsFor) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [pattern, rows] of rowsFor) if (pattern.test(sql)) return { rows };
      return { rows: [] };
    },
  };
};

test('periodRange Monthly covers just that month', () => {
  assert.deepEqual(d.periodRange({ year: 2026, month: 'Feb', frequency: 'Monthly' }),
    { from: '2026-02-01', to: '2026-02-28' });
});

test('periodRange Monthly handles a leap February and a 31-day month', () => {
  assert.equal(d.periodRange({ year: 2024, month: 'Feb', frequency: 'Monthly' }).to, '2024-02-29');
  assert.equal(d.periodRange({ year: 2026, month: 'Jul', frequency: 'Monthly' }).to, '2026-07-31');
});

test('periodRange Quarterly runs from the quarter start to the selected month', () => {
  assert.deepEqual(d.periodRange({ year: 2026, month: 'May', frequency: 'Quarterly' }),
    { from: '2026-04-01', to: '2026-05-31' });
});

test('periodRange YTD runs from January', () => {
  assert.deepEqual(d.periodRange({ year: 2026, month: 'Mar', frequency: 'YTD' }),
    { from: '2026-01-01', to: '2026-03-31' });
});

test('getSnapshot returns nulls rather than zeros when nothing matches', async () => {
  const pool = makePool([[/./, [{}]]]);
  const snap = await d.getSnapshot(pool, { supplier: 'NOBODY', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(snap.designLeadTime, null);
  assert.equal(snap.trialRatio, null);
  assert.equal(snap.qdRate, null);
  assert.equal(snap.ordersPlaced, 0, 'a count of nothing is genuinely zero, not unknown');
});

test('getSnapshot computes QD rate as a percentage of dies received', async () => {
  const pool = makePool([
    [/FROM die_orders[\s\S]*ordered_date BETWEEN/, [{ orders_placed: '10', design_lead_time: '2.5', trial_ratio: '1.5', design_revisions: '0.5' }]],
    [/FROM die_orders[\s\S]*die_received_date BETWEEN/, [{ delivery_lead_time: '25', dies_received: '8' }]],
    [/FROM quality_discrepancies/, [{ qd_count: '2' }]],
  ]);
  const snap = await d.getSnapshot(pool, { supplier: 'PHME', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(snap.qdRate, 25); // 2 of 8
  assert.equal(snap.deliveryLeadTime, 25);
  assert.equal(snap.ordersPlaced, 10);
});

test('getSnapshot leaves QD rate null when no dies were received', async () => {
  const pool = makePool([
    [/FROM die_orders[\s\S]*ordered_date BETWEEN/, [{ orders_placed: '3' }]],
    [/FROM die_orders[\s\S]*die_received_date BETWEEN/, [{ dies_received: '0' }]],
    [/FROM quality_discrepancies/, [{ qd_count: '0' }]],
  ]);
  const snap = await d.getSnapshot(pool, { supplier: 'X', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(snap.qdRate, null, '0 of 0 is unknown, not 0%');
});

test('getSnapshot matches supplier case-insensitively', async () => {
  const pool = makePool([[/./, [{}]]]);
  await d.getSnapshot(pool, { supplier: 'phme', from: '2026-01-01', to: '2026-01-31' });
  assert.ok(pool.calls.every(c => /upper\(btrim/i.test(c.sql)), 'supplier match must be case and space insensitive');
});

test('getMonthlyTrend returns one row per month through the selected one', async () => {
  const pool = makePool([[/./, [{}]]]);
  const trend = await d.getMonthlyTrend(pool, { supplier: 'PHME', year: 2026, throughMonth: 'Mar' });
  assert.deepEqual(trend.map(r => r.month), ['Jan', 'Feb', 'Mar']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/supplierPerformanceData.test.cjs`
Expected: FAIL — `Cannot find module './supplierPerformanceData.cjs'`

- [ ] **Step 3: Write the data service**

Create `server/services/supplierPerformanceData.cjs`:

```javascript
'use strict';

// Aggregation for the supplier scorecard. Separate from the scoring model so
// the arithmetic stays testable without a database and the SQL stays in one
// place.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (year, monthIdx) => new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

function periodRange({ year, month, frequency }) {
  const y = Number(year);
  const idx = MONTHS.indexOf(month);
  if (idx < 0) throw Object.assign(new Error(`Unknown month "${month}"`), { status: 400 });
  let startIdx;
  if (frequency === 'Monthly') startIdx = idx;
  else if (frequency === 'Quarterly') startIdx = idx - (idx % 3);
  else startIdx = 0; // YTD
  return {
    from: `${y}-${pad(startIdx + 1)}-01`,
    to: `${y}-${pad(idx + 1)}-${pad(lastDay(y, idx))}`,
  };
}

// Postgres returns numerics as strings; null must survive as null.
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function getSnapshot(pool, { supplier, from, to }) {
  const args = [supplier, from, to];

  // Ordered-date metrics.
  const ordered = await pool.query(`
    SELECT count(*)                                             AS orders_placed,
           avg(design_received_date - ordered_date)
             FILTER (WHERE design_received_date >= ordered_date) AS design_lead_time,
           avg(NULLIF(no_of_trial, 0))                          AS trial_ratio,
           avg(design_revision_count)                           AS design_revisions
      FROM die_orders
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND ordered_date BETWEEN $2 AND $3`, args);

  // Received-date metrics: a die ordered in March and received in May is May's
  // delivery, so these key off the receipt date rather than the order date.
  const received = await pool.query(`
    SELECT avg(die_received_date - ordered_date)
             FILTER (WHERE die_received_date >= ordered_date)   AS delivery_lead_time,
           count(*)                                             AS dies_received
      FROM die_orders
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND die_received_date BETWEEN $2 AND $3`, args);

  const qd = await pool.query(`
    SELECT count(*) AS qd_count
      FROM quality_discrepancies
     WHERE upper(btrim(supplier)) = upper(btrim($1))
       AND qd_requested_date BETWEEN $2 AND $3`, args);

  const o = ordered.rows[0] || {};
  const r = received.rows[0] || {};
  const diesReceived = num(r.dies_received) || 0;
  const qdCount = num(qd.rows[0]?.qd_count) || 0;

  return {
    ordersPlaced: num(o.orders_placed) || 0,
    designLeadTime: num(o.design_lead_time),
    trialRatio: num(o.trial_ratio),
    designRevisions: num(o.design_revisions),
    deliveryLeadTime: num(r.delivery_lead_time),
    // 0 QDs out of 0 dies is unknown, not a perfect 0%.
    qdRate: diesReceived > 0 ? (qdCount / diesReceived) * 100 : null,
  };
}

// One query set per month. Twelve small queries beat one clever grouped query
// that has to be re-read every time the metric list changes.
async function getMonthlyTrend(pool, { supplier, year, throughMonth }) {
  const last = MONTHS.indexOf(throughMonth);
  const out = [];
  for (let i = 0; i <= last; i += 1) {
    const { from, to } = periodRange({ year, month: MONTHS[i], frequency: 'Monthly' });
    out.push({ month: MONTHS[i], ...(await getSnapshot(pool, { supplier, from, to })) });
  }
  return out;
}

async function listSuppliers(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT btrim(supplier) AS name
      FROM die_orders
     WHERE supplier IS NOT NULL AND btrim(supplier) <> ''
     ORDER BY 1`);
  return rows.map(r => r.name);
}

module.exports = { MONTHS, periodRange, getSnapshot, getMonthlyTrend, listSuppliers };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 9 new tests green.

- [ ] **Step 5: Sanity-check the SQL against the real database**

The unit tests use a fake pool, so they prove the JavaScript but not the SQL. Run one query directly:

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) AS orders_placed, avg(design_received_date - ordered_date) FILTER (WHERE design_received_date >= ordered_date) AS design_lead_time, avg(NULLIF(no_of_trial,0)) AS trial_ratio, avg(design_revision_count) AS design_revisions FROM die_orders WHERE upper(btrim(supplier)) = upper(btrim('PHME')) AND ordered_date BETWEEN '2026-01-01' AND '2026-12-31';"
```

Expected: a row with a plausible design lead time (single-digit days) and trial ratio near 2. A syntax error here means the SQL is wrong even though the tests passed.

- [ ] **Step 6: Commit**

```bash
git add server/services/supplierPerformanceData.cjs server/services/supplierPerformanceData.test.cjs
git commit -m "feat(scorecard): per-supplier aggregation and period ranges"
```

---

### Task 4: Report route

**Files:**
- Create: `server/routes/supplier-performance.cjs`
- Modify: `server/index.cjs` (require near line 17, mount near line 97)

**Interfaces:**
- Consumes: all three services from Tasks 1–3.
- Produces:
  - `GET /api/supplier-performance/suppliers` → `string[]`
  - `GET /api/supplier-performance/settings` → `metrics[]`
  - `PUT /api/supplier-performance/settings` (admin) → `metrics[]`
  - `GET /api/supplier-performance?supplier=&year=&month=&frequency=` → `{ supplier, period: {from,to,label}, metrics, snapshot, scores, rating, trend }`
    where `scores` is `{ [metricKey]: number | null }` and `rating` is `{ score, band, contributing } | null`

- [ ] **Step 1: Write the route**

Create `server/routes/supplier-performance.cjs`:

```javascript
const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');
const settings = require('../services/supplierPerformanceSettings.cjs');
const model = require('../services/supplierPerformance.cjs');
const data = require('../services/supplierPerformanceData.cjs');

const handle = (res, error, fallback) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(fallback, error);
    res.status(500).json({ error: fallback });
};

router.get('/suppliers', authMiddleware, async (req, res) => {
    try {
        res.json(await data.listSuppliers(pool));
    } catch (error) { handle(res, error, 'Failed to fetch suppliers'); }
});

router.get('/settings', authMiddleware, async (req, res) => {
    try {
        res.json(await settings.getSettings(pool));
    } catch (error) { handle(res, error, 'Failed to fetch scoring settings'); }
});

router.put('/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await settings.saveSettings(pool, req.body?.metrics);
        res.json(await settings.getSettings(pool));
    } catch (error) { handle(res, error, 'Failed to save scoring settings'); }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
        const supplier = String(req.query.supplier || '').trim();
        if (!supplier) return res.status(400).json({ error: 'A supplier is required' });
        const year = Number(req.query.year) || new Date().getFullYear();
        const month = String(req.query.month || data.MONTHS[new Date().getMonth()]);
        const frequency = ['Monthly', 'Quarterly', 'YTD'].includes(req.query.frequency)
            ? req.query.frequency : 'Monthly';

        const metrics = await settings.getSettings(pool);
        const { from, to } = data.periodRange({ year, month, frequency });
        const snapshot = await data.getSnapshot(pool, { supplier, from, to });
        const trend = await data.getMonthlyTrend(pool, { supplier, year, throughMonth: month });

        const scores = {};
        for (const m of metrics) scores[m.key] = model.scoreMetric(m, snapshot[m.key]);
        const overall = model.overallRating(metrics, snapshot);

        res.json({
            supplier,
            period: { from, to, frequency, year, month },
            metrics,
            snapshot,
            scores,
            trend,
            rating: overall ? { ...overall, band: model.ratingBand(overall.score) } : null,
        });
    } catch (error) { handle(res, error, 'Failed to build the supplier report'); }
});

module.exports = router;
```

- [ ] **Step 2: Register the route in `server/index.cjs`**

Beside the other master-data requires:

```javascript
const supplierPerformanceRouter = require('./routes/supplier-performance.cjs');
```

Beside the other mounts:

```javascript
app.use('/api/supplier-performance', supplierPerformanceRouter);
```

- [ ] **Step 3: Rebuild and confirm auth is enforced**

```bash
docker compose build backend && docker compose up -d backend
```

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node -e "fetch('http://localhost:3001/api/supplier-performance/suppliers').then(r=>console.log('status',r.status))"
```

Expected: `status 401` — the route is mounted and `authMiddleware` is live.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add server/routes/supplier-performance.cjs server/index.cjs
git commit -m "feat(scorecard): supplier performance report route"
```

---

### Task 5: API client and chart primitives

**Files:**
- Modify: `src/api.js` (append after `correctorsAPI`)
- Create: `src/components/analytics/charts.jsx`

**Interfaces:**
- Consumes: the route from Task 4.
- Produces:
  - `supplierPerformanceAPI.getSuppliers()`, `.getReport({supplier, year, month, frequency})`, `.getSettings()`, `.saveSettings(metrics)`
  - From `charts.jsx`: `RatingGauge({score, band, size})`, `ScoreBar({score, color, height})`, `Sparkline({values, color, width, height})`, `LineChart({series, target, color, formatVal, theme})`, `BarChart({series, color, theme})`
    where `series` is `Array<{month: string, value: number}>`

The primitives are ported from `ui_kits/dieshop/SupplierReportCharts.jsx` in the Claude Design project. Two changes from the originals: ES module exports instead of `window.*` globals, and colours from the `theme` prop instead of `var(--fg)` CSS variables. **The geometry — viewBox sizes, padding, point maths — is copied unchanged; it is already print-correct.**

- [ ] **Step 1: Add the API client**

Append to `src/api.js`:

```javascript
// Supplier performance scorecard
export const supplierPerformanceAPI = {
    getSuppliers: async () => apiRequest('/supplier-performance/suppliers'),

    getReport: async ({ supplier, year, month, frequency }) => {
        const qs = new URLSearchParams({ supplier, year: String(year), month, frequency });
        return apiRequest(`/supplier-performance?${qs}`);
    },

    getSettings: async () => apiRequest('/supplier-performance/settings'),

    saveSettings: async (metrics) => apiRequest('/supplier-performance/settings', {
        method: 'PUT',
        body: JSON.stringify({ metrics }),
    }),
};
```

- [ ] **Step 2: Create the primitives**

Create `src/components/analytics/charts.jsx`:

```jsx
import React from 'react';

// SVG chart primitives for the supplier scorecard, ported from the
// "Die Ordering Design System" Claude Design project
// (ui_kits/dieshop/SupplierReportCharts.jsx). Deliberately dependency-free
// rather than recharts: every one uses viewBox + width:100% so it scales
// cleanly into an A4 print, which the recharts ResponsiveContainer does not.

export function RatingGauge({ score, band, size = 168, theme = {} }) {
  const r = (size - 18) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.max(0, Math.min(1, score / 10));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke={theme.cardBorder || '#334155'} strokeWidth={12} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={band.color} strokeWidth={12}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ - dash}`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span style={{ fontSize: 46, fontWeight: 700, color: theme.text, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{score.toFixed(1)}</span>
          <span style={{ fontSize: 18, fontWeight: 600, color: theme.textDim }}>/10</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: band.color, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>
          {band.label.split(' · ')[0]}
        </span>
      </div>
    </div>
  );
}

export function ScoreBar({ score, color, height = 6, theme = {} }) {
  const pct = Math.max(0, Math.min(100, score * 10));
  return (
    <div style={{ position: 'relative', width: '100%', height, background: theme.inputBg || '#1E293B', borderRadius: 99 }}>
      <div style={{ position: 'absolute', inset: 0, right: 'auto', width: `${pct}%`, background: color, borderRadius: 99 }} />
    </div>
  );
}

export function Sparkline({ values, color, width = 110, height = 30 }) {
  const clean = (values || []).filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const span = (Math.max(...clean) - min) || 1;
  const pad = 3;
  const pts = clean.map((v, i) => [
    pad + (i / (clean.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  const dAttr = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={dAttr} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
    </svg>
  );
}

export function LineChart({ series, target, color, formatVal, theme = {} }) {
  const pts0 = (series || []).filter((s) => Number.isFinite(s.value));
  if (pts0.length < 2) {
    return <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textDim, fontSize: '0.8rem' }}>Not enough data</div>;
  }
  const W = 320, H = 150, padL = 8, padR = 14, padT = 16, padB = 24;
  const values = pts0.map((s) => s.value);
  const all = target != null ? [...values, target] : values;
  let min = Math.min(...all), max = Math.max(...all);
  const range = (max - min) || 1;
  min -= range * 0.18; max += range * 0.18;
  const span = max - min;
  const x = (i) => padL + (i / (pts0.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const pts = pts0.map((s, i) => [x(i), y(s.value)]);
  const lineD = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${pts[pts.length - 1][0].toFixed(1)} ${H - padB} L${pts[0][0].toFixed(1)} ${H - padB} Z`;
  const gid = `sp-grad-${color.replace('#', '')}`;
  const fmt = formatVal || ((v) => v);
  const last = pts[pts.length - 1];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {target != null && (
        <g>
          <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={theme.textDim || '#64748B'} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          <text x={W - padR} y={y(target) - 4} textAnchor="end" fontSize="9" fill={theme.textDim || '#64748B'}>target {fmt(target)}</text>
        </g>
      )}
      <path d={areaD} fill={`url(#${gid})`} />
      <path d={lineD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2.4}
          fill={i === pts.length - 1 ? color : (theme.cardBg || '#0F172A')} stroke={color} strokeWidth="1.5" />
      ))}
      <text x={last[0]} y={Math.max(padT - 4, last[1] - 9)} textAnchor="end" fontSize="11" fontWeight="700" fill={theme.text || '#F1F5F9'}>
        {fmt(pts0[pts0.length - 1].value)}
      </text>
      {pts0.map((s, i) => (
        <text key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize="9" fill={theme.textDim || '#64748B'}>{s.month}</text>
      ))}
    </svg>
  );
}

export function BarChart({ series, color, theme = {} }) {
  const rows = (series || []).filter((s) => Number.isFinite(s.value));
  if (!rows.length) {
    return <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textDim, fontSize: '0.8rem' }}>Not enough data</div>;
  }
  const W = 320, H = 150, padL = 8, padR = 8, padT = 18, padB = 24;
  const max = (Math.max(...rows.map((s) => s.value)) * 1.15) || 1;
  const bw = (W - padL - padR) / rows.length;
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {rows.map((s, i) => {
        const bx = padL + i * bw + bw * 0.2;
        const w = bw * 0.6;
        const top = y(s.value);
        return (
          <g key={i}>
            <rect x={bx} y={top} width={w} height={(H - padB) - top} rx="3" fill={color} opacity={i === rows.length - 1 ? 1 : 0.4} />
            <text x={bx + w / 2} y={top - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill={theme.text || '#F1F5F9'}>{s.value}</text>
            <text x={bx + w / 2} y={H - 7} textAnchor="middle" fontSize="9" fill={theme.textDim || '#64748B'}>{s.month}</text>
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems.

- [ ] **Step 4: Commit**

```bash
git add src/api.js src/components/analytics/charts.jsx
git commit -m "feat(scorecard): API client and SVG chart primitives"
```

---

### Task 6: Rating hero and metric card

**Files:**
- Create: `src/components/analytics/RatingHero.jsx`
- Create: `src/components/analytics/MetricCard.jsx`

**Interfaces:**
- Consumes: `RatingGauge`, `ScoreBar`, `Sparkline` from Task 5; the report payload shape from Task 4.
- Produces:
  - `default RatingHero({ report, theme })`
  - `default MetricCard({ metric, value, score, trend, theme })` where `trend` is `Array<{month, value}>` for that one metric

- [ ] **Step 1: Create `RatingHero.jsx`**

```jsx
import React from 'react';
import { RatingGauge } from './charts';

const fmt = (metric, v) => (v == null ? '—' : Number(v).toFixed(metric.decimals ?? 0));

// The headline: one number, one band, and a sentence saying what to do about it.
export default function RatingHero({ report, theme }) {
  const { rating, metrics, scores } = report;

  // No rating at all is a real state, not an error: it means nothing this
  // supplier does in this period has data behind it. Saying 0.0 would be a lie.
  if (!rating) {
    return (
      <div style={{ padding: 22, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Not enough data to rate this supplier</div>
        <p style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.6, margin: 0 }}>
          No scored metric has a value for this period. Widen the period, or check that
          order dates and receipt dates are recorded for {report.supplier}.
        </p>
      </div>
    );
  }

  const scored = metrics
    .filter((m) => m.scored && scores[m.key] != null)
    .map((m) => ({ m, s: scores[m.key] }))
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  const totalScored = metrics.filter((m) => m.scored).length;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: 22, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, flexWrap: 'wrap' }}>
      <RatingGauge score={rating.score} band={rating.band} theme={theme} />
      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: rating.band.bg, marginBottom: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: rating.band.color }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: rating.band.color }}>{rating.band.label}</span>
        </div>
        <p style={{ fontSize: 14, color: theme.text, lineHeight: 1.6, marginBottom: 4 }}>
          <strong>{report.supplier}</strong> scores <strong>{rating.score.toFixed(1)}/10</strong>.
          {best && <> Strongest area is <strong style={{ color: '#16A34A' }}>{best.m.label}</strong> ({best.s.toFixed(1)}).</>}
          {worst && worst !== best && <> Priority for improvement is <strong style={{ color: rating.band.color }}>{worst.m.label}</strong> ({worst.s.toFixed(1)}).</>}
        </p>
        <div style={{ fontSize: 11, color: theme.textDim, marginTop: 10, lineHeight: 1.5 }}>
          Weighted across {metrics.filter((m) => m.scored).map((m) => `${m.label} (${Math.round(m.weight * 100)}%)`).join(', ')}.
          {rating.contributing < totalScored && (
            <> Only {rating.contributing} of {totalScored} scored metrics have data this period; the rating is renormalised over those.</>
          )}
        </div>
      </div>
    </div>
  );
}

export { fmt };
```

- [ ] **Step 2: Create `MetricCard.jsx`**

```jsx
import React from 'react';
import { ScoreBar, Sparkline } from './charts';

const COLORS = {
  ordersPlaced: '#3B82F6', designLeadTime: '#0EA5E9', deliveryLeadTime: '#6366F1',
  trialRatio: '#8B5CF6', qdRate: '#EF4444', designRevisions: '#F59E0B',
};

const band = (score) => {
  if (score >= 7.5) return '#16A34A';
  if (score >= 6.5) return '#0D9488';
  if (score >= 5.5) return '#D97706';
  if (score >= 4.0) return '#EA580C';
  return '#DC2626';
};

export default function MetricCard({ metric, value, score, trend, theme }) {
  const color = COLORS[metric.key] || '#3B82F6';
  const fmt = (v) => (v == null ? '—' : Number(v).toFixed(metric.decimals ?? 0));
  const onTarget = metric.scored && value != null
    ? (metric.lowerBetter ? value <= metric.target : value >= metric.target)
    : null;
  const spark = (trend || []).map((r) => r.value);

  return (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted }}>{metric.label}</span>
        {score != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: band(score), padding: '2px 7px', borderRadius: 6, border: `1px solid ${band(score)}` }}>
            {score.toFixed(1)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 12 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: value == null ? theme.textDim : theme.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {fmt(value)}
        </span>
        {metric.unit && value != null && <span style={{ fontSize: 12, color: theme.textDim, fontWeight: 500 }}>{metric.unit}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, minHeight: 18 }}>
        {value == null ? (
          // Says why there is no number. An empty card reads as a bug.
          <span style={{ fontSize: 11, color: theme.textDim }}>Not tracked yet — no data this period</span>
        ) : metric.scored ? (
          <span style={{ fontSize: 11, color: onTarget ? '#16A34A' : '#D97706', fontWeight: 600 }}>
            {onTarget ? 'On target' : 'Off target'}
            <span style={{ color: theme.textDim, fontWeight: 400 }}>
              {' '}· target {metric.lowerBetter ? '≤' : '≥'} {fmt(metric.target)}{metric.unit ? ` ${metric.unit}` : ''}
            </span>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: theme.textDim }}>{metric.blurb}</span>
        )}
      </div>

      {score != null && (
        <div style={{ marginTop: 10 }}><ScoreBar score={score} color={band(score)} theme={theme} /></div>
      )}

      <div style={{ marginTop: 10 }}>
        <Sparkline values={spark} color={color} />
      </div>
    </div>
  );
}

export { COLORS, band };
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems.

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/RatingHero.jsx src/components/analytics/MetricCard.jsx
git commit -m "feat(scorecard): rating hero and metric cards"
```

---

### Task 7: Supplier report tab

**Files:**
- Create: `src/pages/analytics/SupplierReportTab.jsx`
- Create: `src/components/analytics/TrendCard.jsx`
- Modify: `src/index.css` (append print rules only)

**Interfaces:**
- Consumes: `supplierPerformanceAPI` (Task 5), `RatingHero` and `MetricCard` (Task 6), `LineChart`/`BarChart` (Task 5).
- Produces: `default SupplierReportTab({ theme })`, `default TrendCard({ metric, trend, theme })`.

- [ ] **Step 1: Create `TrendCard.jsx`**

```jsx
import React from 'react';
import { LineChart, BarChart } from './charts';
import { COLORS } from './MetricCard';

export default function TrendCard({ metric, trend, theme }) {
  const color = COLORS[metric.key] || '#3B82F6';
  const series = (trend || []).map((r) => ({ month: r.month, value: r.value }));
  const fmt = (v) => Number(v).toFixed(metric.decimals ?? 0);
  return (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>{metric.label}</span>
        <span style={{ fontSize: 11, color: theme.textDim, marginLeft: 'auto' }}>{metric.unit || 'count'}</span>
      </div>
      {metric.key === 'ordersPlaced'
        ? <BarChart series={series} color={color} theme={theme} />
        : <LineChart series={series} target={metric.target} color={color} formatVal={fmt} theme={theme} />}
    </div>
  );
}
```

- [ ] **Step 2: Create `SupplierReportTab.jsx`**

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Download } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { MONTHS } from '../../utils/constants';
import RatingHero from '../../components/analytics/RatingHero';
import MetricCard from '../../components/analytics/MetricCard';
import TrendCard from '../../components/analytics/TrendCard';

const FREQUENCIES = ['Monthly', 'Quarterly', 'YTD'];

export default function SupplierReportTab({ theme }) {
  const [suppliers, setSuppliers] = useState([]);
  const [supplier, setSupplier] = useState('');
  const [year] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [frequency, setFrequency] = useState('Monthly');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supplierPerformanceAPI.getSuppliers()
      .then((rows) => { if (!cancelled) { setSuppliers(rows || []); setSupplier((s) => s || (rows || [])[0] || ''); } })
      .catch(() => { if (!cancelled) setError('Could not load the supplier list.'); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    if (!supplier) return;
    setLoading(true); setError('');
    try {
      setReport(await supplierPerformanceAPI.getReport({ supplier, year, month, frequency }));
    } catch (e) {
      setError(e.message || 'Could not build the report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [supplier, year, month, frequency]);

  useEffect(() => { load(); }, [load]);

  const select = { padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', cursor: 'pointer' };
  const label = { fontSize: 9.5, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 };

  const trendFor = (key) => (report?.trend || []).map((r) => ({ month: r.month, value: r[key] }));

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
        <div>
          <label style={label} htmlFor="sr-supplier">Supplier</label>
          <select id="sr-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} style={{ ...select, minWidth: 160 }}>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="sr-month">Month</label>
          <select id="sr-month" value={month} onChange={(e) => setMonth(e.target.value)} style={select}>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="sr-frequency">Frequency</label>
          <select id="sr-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} style={select}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <button onClick={() => window.print()} style={{ marginLeft: 'auto', padding: '9px 16px', background: '#1F6FB0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Download size={15} /> Export PDF
        </button>
      </div>

      {error && <div style={{ padding: 16, borderRadius: 10, border: '1px solid #EF4444', color: '#EF4444', fontSize: '0.85rem', marginBottom: '1.5rem' }}>{error}</div>}
      {loading && <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>Building report…</div>}

      {report && !loading && (
        <div id="supplier-report">
          <RatingHero report={report} theme={theme} />

          <div className="dt-analytics-grid" style={{ marginTop: '1.5rem' }}>
            {report.metrics.map((m) => (
              <MetricCard key={m.key} metric={m} value={report.snapshot[m.key]}
                score={report.scores[m.key]} trend={trendFor(m.key)} theme={theme} />
            ))}
          </div>

          <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '2rem 0 0.75rem' }}>
            Trends · Jan–{month} {year}
          </h2>
          <div className="dt-analytics-grid">
            {report.metrics.map((m) => (
              <TrendCard key={m.key} metric={m} trend={trendFor(m.key)} theme={theme} />
            ))}
          </div>

          <p style={{ fontSize: 11, color: theme.textDim, marginTop: '1.5rem', lineHeight: 1.6 }}>
            Each metric is scored 0–10 against its target band, then combined using the weights above.
            Metrics with no data for the period are excluded from the rating rather than scored zero.
            Die life and die failure are not tracked in this system and are not part of the rating.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Confirm `MONTHS` is exported from constants**

Run: `grep -n "export const MONTHS" src/utils/constants.js`

If there is no match, add it (the Overview tab declares its own local copy):

```javascript
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
```

- [ ] **Step 4: Append print rules to `src/index.css`**

Append at the end. **Do not modify any existing rule, including the font imports at lines 5 and 19.**

```css
/* Supplier report printing. The report is the only page meant to leave the
   app on paper, so print hides the app chrome and drops the dark surfaces
   that would otherwise burn through a cartridge. */
@media print {
  .no-print { display: none !important; }

  #supplier-report {
    color: #000 !important;
    background: #fff !important;
  }

  #supplier-report * {
    background: transparent !important;
    color: #000 !important;
  }

  /* Keep a card from being split across a page break mid-chart. */
  #supplier-report .dt-analytics-grid > * {
    break-inside: avoid;
    page-break-inside: avoid;
    border-color: #999 !important;
  }
}
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems.

- [ ] **Step 6: Commit**

```bash
git add src/pages/analytics/SupplierReportTab.jsx src/components/analytics/TrendCard.jsx src/index.css src/utils/constants.js
git commit -m "feat(scorecard): supplier report tab with trends and print layout"
```

---

### Task 8: Tab bar

**Files:**
- Modify: `src/pages/AnalyticsPage.jsx`

**Interfaces:**
- Consumes: `OverviewTab` (already present), `SupplierReportTab` (Task 7).
- Produces: no new exports.

- [ ] **Step 1: Replace the thin shell with a two-tab shell**

```jsx
import React, { useState } from 'react';
import OverviewTab from './analytics/OverviewTab';
import SupplierReportTab from './analytics/SupplierReportTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'supplier', label: 'Supplier Report' },
];

export default function AnalyticsPage({ data, suppliers, theme }) {
  const [tab, setTab] = useState('overview');

  return (
    <div>
      <div role="tablist" aria-label="Analytics views" className="no-print"
        style={{ display: 'flex', gap: 4, marginBottom: '1.5rem', borderBottom: `1px solid ${theme.cardBorder}` }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${tab === t.id ? '#1F6FB0' : 'transparent'}`,
              color: tab === t.id ? theme.text : theme.textMuted,
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Kept mounted rather than swapped, so switching back does not refetch
          and recompute the whole overview. */}
      <div style={{ display: tab === 'overview' ? 'block' : 'none' }}>
        <OverviewTab data={data} suppliers={suppliers} theme={theme} />
      </div>
      <div style={{ display: tab === 'supplier' ? 'block' : 'none' }}>
        <SupplierReportTab theme={theme} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AnalyticsPage.jsx
git commit -m "feat(scorecard): analytics tab bar"
```

---

### Task 9: Targets settings card

**Files:**
- Create: `src/components/settings/SupplierTargetsCard.jsx`
- Modify: `src/pages/SettingsPage.jsx` (import; render on the `general` tab after `CorrectorsCard`)

**Interfaces:**
- Consumes: `supplierPerformanceAPI.getSettings` / `.saveSettings` from Task 5.
- Produces: `default SupplierTargetsCard({ theme, isAdmin })`.

- [ ] **Step 1: Create the card**

```jsx
import React, { useState, useEffect } from 'react';
import { Target } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Scoring targets for the supplier scorecard. Editable because the right
// threshold is a business judgement, not something the data dictates — the
// seeds are only a starting point taken from observed performance.
export default function SupplierTargetsCard({ theme, isAdmin }) {
  const [metrics, setMetrics] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supplierPerformanceAPI.getSettings()
      .then((rows) => { if (!cancelled) setMetrics(rows || []); })
      .catch(() => { if (!cancelled) setMetrics([]); });
    return () => { cancelled = true; };
  }, []);

  const scored = metrics.filter((m) => m.scored);
  const weightTotal = scored.reduce((a, m) => a + Number(m.weight || 0), 0);
  const weightOk = Math.round(weightTotal * 1000) / 1000 === 1;

  const edit = (key, field, raw) => {
    const v = raw === '' ? '' : Number(raw);
    setMetrics((prev) => prev.map((m) => (m.key === key ? { ...m, [field]: v } : m)));
  };

  const save = async () => {
    setSaving(true);
    try {
      setMetrics(await supplierPerformanceAPI.saveSettings(metrics));
      dialogs.notify('Scoring targets saved.', 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cell = { padding: '8px 10px', fontSize: '0.8rem', color: theme.text };
  const input = { width: 72, padding: '4px 8px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: theme.text, fontSize: '0.75rem' };

  return (
    <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
          <Target size={20} /> Supplier Scoring Targets
        </h3>
        <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
          Drives the rating on the Analytics → Supplier Report tab. &ldquo;10 at&rdquo; scores full marks, &ldquo;0 at&rdquo; scores nothing; weights must total 100%.
        </p>
      </div>

      <div style={{ background: theme.inputBg, borderRadius: '12px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Metric', 'Target', '10 at', '0 at', 'Weight %'].map((h) => (
                <th key={h} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scored.map((m) => (
              <tr key={m.key} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{m.label} <span style={{ color: theme.textDim }}>{m.unit && `(${m.unit})`}</span></td>
                {['target', 'ten', 'zero'].map((f) => (
                  <td key={f} style={cell}>
                    <input type="number" step="any" aria-label={`${m.label} ${f}`} value={m[f]} disabled={!isAdmin}
                      onChange={(e) => edit(m.key, f, e.target.value)} style={input} />
                  </td>
                ))}
                <td style={cell}>
                  <input type="number" step="1" aria-label={`${m.label} weight`} value={Math.round(m.weight * 100)} disabled={!isAdmin}
                    onChange={(e) => edit(m.key, 'weight', Number(e.target.value) / 100)} style={input} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: '1rem' }}>
          <button onClick={save} disabled={saving || !weightOk}
            style={{ padding: '8px 18px', background: weightOk ? BRAND.navy : theme.cardBorder, color: 'white', border: 'none', borderRadius: 8, cursor: weightOk && !saving ? 'pointer' : 'not-allowed', fontSize: '0.85rem' }}>
            Save targets
          </button>
          <span style={{ fontSize: '0.78rem', color: weightOk ? theme.textDim : '#EF4444' }}>
            Weights total {Math.round(weightTotal * 100)}%{weightOk ? '' : ' — must be 100% to save'}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it in Settings**

In `src/pages/SettingsPage.jsx`, import it:

```javascript
import SupplierTargetsCard from '../components/settings/SupplierTargetsCard';
```

Render it immediately after the existing `<CorrectorsCard ... />` on the `general` tab:

```jsx
                <SupplierTargetsCard theme={theme} isAdmin={isAdmin} />
```

`isAdmin` is already computed in that file. No props are needed from `DieOrderingSystem` — the card loads its own settings, like `QDTrackerPage` loads its own masters.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/SupplierTargetsCard.jsx src/pages/SettingsPage.jsx
git commit -m "feat(scorecard): admin card for scoring targets and weights"
```

---

### Task 10: End-to-end verification

**Files:** none modified.

- [ ] **Step 1: Run the full backend suite**

Run: `npm test`
Expected: PASS — 28 new tests across the three services, no pre-existing test broken.

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, 77 problems, build clean.

- [ ] **Step 3: Rebuild the whole stack**

```bash
docker compose build backend frontend && docker compose up -d
```

- [ ] **Step 4: Smoke-test in the browser**

Open the app on port 80, sign in, go to Analytics:

- The **Overview** tab still shows the three sections from the earlier work, unchanged.
- The **Supplier Report** tab loads with a supplier selected and shows a rating out of 10.
- Switching supplier to **PDTMC** and then **PHME** changes the numbers.
- **JIANGSU** (no trials recorded) shows "Not tracked yet — no data this period" on the Trial Ratio card, and its overall rating is **not** dragged to "At risk" by that absence. The hero says how many metrics contributed.
- No card anywhere shows Die Life or Die Failure.
- Setting Frequency to **YTD** widens the numbers versus **Monthly**.
- Settings → Plants & Suppliers shows **Supplier Scoring Targets**; changing a weight so the total is not 100% disables Save and shows the total in red.
- Saving a valid change, then reloading the Supplier Report, moves the scores.
- **Export PDF** opens the print dialog with the toolbar and tab bar hidden.

- [ ] **Step 5: Confirm nothing was written to order data**

The scorecard is read-only over `die_orders` and `quality_discrepancies`.

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) AS orders, count(*) FILTER (WHERE updated_at > now() - interval '1 hour') AS touched_last_hour FROM die_orders;"
```

Expected: `touched_last_hour` is 0 (or only rows you edited by hand during testing).

- [ ] **Step 6: Commit any fixes**

```bash
git status
```

---

## Notes for the implementer

- **Never fill a gap with a plausible number.** If a metric has no data the card says so and the rating renormalises. That behaviour is the point of this feature, not an edge case.
- **Do not add Die Life or Die Failure**, even as disabled placeholders. Nothing in the schema records tonnage or dies failing before rated life.
- QD Rate is discrepancies raised per die received. Do not relabel it "Die Failure" — they are different things and the difference matters to a supplier being rated on it.
- The seed targets are derived from test-server data. Treat them as a starting point; they are editable in Settings precisely so nobody has to trust them.
- Do not modify the font imports or any existing rule in `src/index.css`. Append only.
