# Corrector Master List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text Corrector entry on Die Receiving, Sample Followup and QD with a plant-filtered dropdown backed by an admin-maintained master table.

**Architecture:** A new `correctors` master table follows the existing `plants` / `suppliers` / `presses` pattern — migration in `server/db.cjs` mirrored to `init.sql`, a thin route delegating to a testable service, and admin-only mutations. The three existing `corrector TEXT` columns are left untouched with no foreign key; the master list governs what can be *entered*, not what is *stored*. On the frontend one module owns the selection rule, and all five entry points consume it.

**Tech Stack:** Node/Express + `pg` on the backend, React (no framework, inline styles) on the frontend, `node:test` for backend tests, Docker Compose for the stack.

**Spec:** `docs/superpowers/specs/2026-08-04-correctors-master-list-design.md`

## Global Constraints

- Corrector names are stored **trimmed but not upper-cased** — these are people's names, unlike `suppliers` which upper-cases codes.
- `DELETE /api/correctors/:id` **deactivates** (`is_active = false`). It must never remove the row.
- The three `corrector TEXT` columns in `die_orders`, `sample_followups` and `quality_discrepancies` are **not modified** and get **no foreign key**.
- No existing corrector data is rewritten by this work.
- The importers (`src/components/modals/PDFImportModal.jsx`, `server/services/sampleFollowupImport.cjs`) are **out of scope** — do not change them.
- Backend tests use `node:test` with a hand-rolled fake pool (`{ query: async (sql, params) => ... }`). There is no Jest/Vitest and no frontend component test framework.
- Verify backend changes with `npm test`; verify frontend changes with `npm run lint` and `npm run build`.
- **`docker compose restart` never picks up a source edit** — the Dockerfiles COPY source in. Always `docker compose build <svc> && docker compose up -d <svc>`.
- When exec'ing psql, always pass `-h /var/run/postgresql`, and from Git Bash prefix the command with `MSYS_NO_PATHCONV=1`.

---

### Task 1: Correctors table, migration and seed

**Files:**
- Modify: `server/db.cjs` (add to the migration template literal, after the `presses` block)
- Modify: `init.sql` (mirror, after the `presses` block near line 102)

**Interfaces:**
- Consumes: nothing
- Produces: table `correctors(id SERIAL PK, name TEXT NOT NULL, plant TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP, updated_at TIMESTAMP, UNIQUE (name, plant))`, seeded with five rows on `GEX 2`.

- [ ] **Step 1: Add the table to `init.sql`**

Insert after the `presses` seed block (after the `INSERT INTO presses ...` statement ends, around line 115):

```sql
-- Corrector master list. Constrains the Corrector dropdown on Die Receiving,
-- Sample Followup and QD. The corrector columns on die_orders,
-- sample_followups and quality_discrepancies stay plain TEXT by design — this
-- table governs what can be entered, not what is stored.
CREATE TABLE IF NOT EXISTS correctors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    plant TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, plant)
);

-- Seed only when the table is empty, so names an admin later removes are not
-- silently resurrected on the next boot.
INSERT INTO correctors (name, plant)
SELECT * FROM (VALUES
    ('Kailash', 'GEX 2'),
    ('Jaypee', 'GEX 2'),
    ('Raheem', 'GEX 2'),
    ('Sujith', 'GEX 2'),
    ('Dinesh', 'GEX 2')
) AS seed(name, plant)
WHERE NOT EXISTS (SELECT 1 FROM correctors);
```

- [ ] **Step 2: Mirror the same block into `server/db.cjs`**

Find the `presses` block inside the big migration template literal and add the identical SQL immediately after it. It is inside a JS template literal, so **the `$$` of any `DO` block would need escaping — this SQL deliberately uses none**, so paste it verbatim.

- [ ] **Step 3: Rebuild the backend and verify the migration applied**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 4: Confirm the table and seed rows exist**

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT name, plant, is_active FROM correctors ORDER BY name;"
```

Expected: exactly 5 rows — Dinesh, Jaypee, Kailash, Raheem, Sujith — all `GEX 2`, all `t`.

- [ ] **Step 5: Confirm the seed is idempotent**

Restart the backend once more (`docker compose build backend && docker compose up -d backend`) and re-run the query from Step 4. Expected: still exactly 5 rows, not 10.

- [ ] **Step 6: Commit**

```bash
git add init.sql server/db.cjs
git commit -m "feat(correctors): master table with plant and active flag"
```

---

### Task 2: Correctors service

**Files:**
- Create: `server/services/correctors.cjs`
- Test: `server/services/correctors.test.cjs`

**Interfaces:**
- Consumes: the `correctors` table from Task 1.
- Produces:
  - `normalizeName(raw) -> string` (trimmed; preserves capitalisation)
  - `listCorrectors(pool, { plant, includeInactive }) -> Promise<Array<row>>`
  - `createCorrector(pool, { name, plant }) -> Promise<row>` — throws `Error` with `.status = 400` on blank name, `.status = 409` on duplicate
  - `updateCorrector(pool, id, { name, plant, is_active }) -> Promise<row|null>` — `null` when id not found
  - `deactivateCorrector(pool, id) -> Promise<row|null>` — `null` when id not found

- [ ] **Step 1: Write the failing tests**

Create `server/services/correctors.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./correctors.cjs');

// A fake pool that records every query and replies from a scripted list.
const makePool = (replies = []) => {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return replies[i++] || { rows: [] };
    },
  };
};

test('normalizeName trims but preserves capitalisation', () => {
  assert.equal(s.normalizeName('  Sujith '), 'Sujith');
  assert.equal(s.normalizeName('kailash'), 'kailash');
  assert.equal(s.normalizeName(null), '');
  assert.equal(s.normalizeName('   '), '');
});

test('listCorrectors returns only active rows by default', async () => {
  const pool = makePool([{ rows: [{ id: 1, name: 'Sujith' }] }]);
  await s.listCorrectors(pool, {});
  assert.match(pool.calls[0].sql, /is_active = TRUE/);
  assert.deepEqual(pool.calls[0].params, []);
});

test('listCorrectors includes inactive rows when asked', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.listCorrectors(pool, { includeInactive: true });
  assert.doesNotMatch(pool.calls[0].sql, /is_active = TRUE/);
});

test('listCorrectors filters by plant when given one', async () => {
  const pool = makePool([{ rows: [] }]);
  await s.listCorrectors(pool, { plant: 'GEX 2' });
  assert.match(pool.calls[0].sql, /plant = \$1/);
  assert.deepEqual(pool.calls[0].params, ['GEX 2']);
});

test('createCorrector rejects a blank name with status 400', async () => {
  const pool = makePool();
  await assert.rejects(
    () => s.createCorrector(pool, { name: '   ', plant: 'GEX 2' }),
    (err) => err.status === 400
  );
  assert.equal(pool.calls.length, 0, 'must not hit the database');
});

test('createCorrector trims the name before inserting', async () => {
  const pool = makePool([
    { rows: [] },                                    // duplicate check
    { rows: [{ id: 7, name: 'Sujith', plant: 'GEX 2' }] }, // insert
  ]);
  const row = await s.createCorrector(pool, { name: ' Sujith ', plant: ' GEX 2 ' });
  const insert = pool.calls.find((c) => /INSERT INTO correctors/.test(c.sql));
  assert.deepEqual(insert.params, ['Sujith', 'GEX 2']);
  assert.equal(row.id, 7);
});

test('createCorrector rejects a duplicate name+plant with status 409', async () => {
  const pool = makePool([{ rows: [{ id: 3 }] }]); // duplicate check finds a row
  await assert.rejects(
    () => s.createCorrector(pool, { name: 'Sujith', plant: 'GEX 2' }),
    (err) => err.status === 409
  );
});

test('createCorrector stores a blank plant as NULL', async () => {
  const pool = makePool([{ rows: [] }, { rows: [{ id: 8 }] }]);
  await s.createCorrector(pool, { name: 'Anil', plant: '' });
  const insert = pool.calls.find((c) => /INSERT INTO correctors/.test(c.sql));
  assert.equal(insert.params[1], null);
});

test('updateCorrector returns null when the id does not exist', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.equal(await s.updateCorrector(pool, 99, { name: 'X' }), null);
});

test('updateCorrector leaves unsupplied fields at their current values', async () => {
  const pool = makePool([
    { rows: [{ id: 5, name: 'Raheem', plant: 'GEX 2', is_active: true }] },
    { rows: [{ id: 5, name: 'Raheem', plant: 'GEX 01', is_active: true }] },
  ]);
  await s.updateCorrector(pool, 5, { plant: 'GEX 01' });
  const upd = pool.calls.find((c) => /UPDATE correctors/.test(c.sql));
  assert.equal(upd.params[0], 'Raheem', 'name unchanged');
  assert.equal(upd.params[1], 'GEX 01', 'plant updated');
  assert.equal(upd.params[2], true, 'is_active unchanged');
});

test('deactivateCorrector sets is_active false and never deletes', async () => {
  const pool = makePool([
    { rows: [{ id: 5, name: 'Raheem' }] },
    { rows: [{ id: 5, name: 'Raheem', is_active: false }] },
  ]);
  const row = await s.deactivateCorrector(pool, 5);
  assert.equal(row.is_active, false);
  assert.ok(
    !pool.calls.some((c) => /DELETE FROM correctors/.test(c.sql)),
    'must not issue a DELETE'
  );
});

test('deactivateCorrector returns null when the id does not exist', async () => {
  const pool = makePool([{ rows: [] }]);
  assert.equal(await s.deactivateCorrector(pool, 99), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './correctors.cjs'`

- [ ] **Step 3: Write the service**

Create `server/services/correctors.cjs`:

```javascript
'use strict';

// Master list behind the Corrector dropdown. The corrector columns on
// die_orders, sample_followups and quality_discrepancies remain plain TEXT —
// this list constrains input, it is not a foreign key. See
// docs/superpowers/specs/2026-08-04-correctors-master-list-design.md.

// Names are people's names, so capitalisation is preserved. Contrast
// suppliers, which upper-cases because those are codes.
function normalizeName(raw) {
  return String(raw == null ? '' : raw).trim();
}

function normalizePlant(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return s || null;
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function listCorrectors(pool, { plant, includeInactive } = {}) {
  const where = [];
  const params = [];
  if (plant) {
    params.push(plant);
    where.push(`plant = $${params.length}`);
  }
  if (!includeInactive) where.push('is_active = TRUE');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, name, plant, is_active FROM correctors ${clause} ORDER BY name`,
    params
  );
  return rows;
}

async function createCorrector(pool, { name, plant }) {
  const cleanName = normalizeName(name);
  if (!cleanName) throw fail(400, 'Corrector name is required');
  const cleanPlant = normalizePlant(plant);

  // NULL plants compare as distinct in a UNIQUE constraint, so check
  // explicitly rather than relying on ON CONFLICT.
  const existing = await pool.query(
    `SELECT id FROM correctors WHERE name = $1 AND plant IS NOT DISTINCT FROM $2`,
    [cleanName, cleanPlant]
  );
  if (existing.rows.length) {
    throw fail(409, `"${cleanName}" already exists${cleanPlant ? ` for ${cleanPlant}` : ''}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO correctors (name, plant) VALUES ($1, $2)
     RETURNING id, name, plant, is_active`,
    [cleanName, cleanPlant]
  );
  return rows[0];
}

async function updateCorrector(pool, id, { name, plant, is_active }) {
  const found = await pool.query(
    'SELECT id, name, plant, is_active FROM correctors WHERE id = $1',
    [id]
  );
  if (!found.rows.length) return null;
  const current = found.rows[0];

  const nextName = name !== undefined ? normalizeName(name) : current.name;
  if (!nextName) throw fail(400, 'Corrector name is required');
  const nextPlant = plant !== undefined ? normalizePlant(plant) : current.plant;
  const nextActive = is_active !== undefined ? !!is_active : current.is_active;

  const { rows } = await pool.query(
    `UPDATE correctors SET name = $1, plant = $2, is_active = $3,
            updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 RETURNING id, name, plant, is_active`,
    [nextName, nextPlant, nextActive, id]
  );
  return rows[0];
}

// Soft delete only. Historical dies reference the name as a string, so a hard
// delete would leave those records pointing at a corrector who appears nowhere.
async function deactivateCorrector(pool, id) {
  const found = await pool.query('SELECT id FROM correctors WHERE id = $1', [id]);
  if (!found.rows.length) return null;
  const { rows } = await pool.query(
    `UPDATE correctors SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING id, name, plant, is_active`,
    [id]
  );
  return rows[0];
}

module.exports = {
  normalizeName, normalizePlant,
  listCorrectors, createCorrector, updateCorrector, deactivateCorrector,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 11 correctors tests green, and every pre-existing test still green.

- [ ] **Step 5: Commit**

```bash
git add server/services/correctors.cjs server/services/correctors.test.cjs
git commit -m "feat(correctors): service with validation and soft delete"
```

---

### Task 3: Correctors route

**Files:**
- Create: `server/routes/correctors.cjs`
- Modify: `server/index.cjs` (require near line 16, mount near line 96)

**Interfaces:**
- Consumes: `server/services/correctors.cjs` from Task 2.
- Produces: `GET /api/correctors` (optional `?plant=` and `?includeInactive=true`), `POST /api/correctors`, `PUT /api/correctors/:id`, `DELETE /api/correctors/:id`.

- [ ] **Step 1: Write the route**

Create `server/routes/correctors.cjs`. It stays thin — all rules live in the service, which is where the tests are:

```javascript
const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');
const correctors = require('../services/correctors.cjs');

// Errors thrown by the service carry a .status; anything else is a real fault.
const handle = (res, error, fallback) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(fallback, error);
    res.status(500).json({ error: fallback });
};

// List correctors (any authenticated user — every form needs this)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const rows = await correctors.listCorrectors(pool, {
            plant: req.query.plant,
            includeInactive: req.query.includeInactive === 'true',
        });
        res.json(rows);
    } catch (error) {
        handle(res, error, 'Failed to fetch correctors');
    }
});

// Add a corrector (admin only)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const row = await correctors.createCorrector(pool, req.body || {});
        res.status(201).json(row);
    } catch (error) {
        handle(res, error, 'Failed to create corrector');
    }
});

// Rename, move plant, or reactivate (admin only)
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const row = await correctors.updateCorrector(pool, req.params.id, req.body || {});
        if (!row) return res.status(404).json({ error: 'Corrector not found' });
        res.json(row);
    } catch (error) {
        handle(res, error, 'Failed to update corrector');
    }
});

// Deactivate — never removes the row, because historical dies store the name.
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const row = await correctors.deactivateCorrector(pool, req.params.id);
        if (!row) return res.status(404).json({ error: 'Corrector not found' });
        res.json({ message: 'Corrector deactivated', corrector: row });
    } catch (error) {
        handle(res, error, 'Failed to deactivate corrector');
    }
});

module.exports = router;
```

- [ ] **Step 2: Register the route in `server/index.cjs`**

Next to the other master-data requires (near line 16):

```javascript
const correctorsRouter = require('./routes/correctors.cjs');
```

Next to the other master-data mounts (near line 96):

```javascript
app.use('/api/correctors', correctorsRouter);
```

- [ ] **Step 3: Rebuild the backend**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 4: Verify the route answers**

The backend port is internal-only, so go through the container. Expected: HTTP 401 — proving the route is mounted and `authMiddleware` is active.

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node -e "fetch('http://localhost:3001/api/correctors').then(r=>console.log('status',r.status))"
```

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/routes/correctors.cjs server/index.cjs
git commit -m "feat(correctors): REST route for the master list"
```

---

### Task 4: Frontend API client and app-level loading

**Files:**
- Modify: `src/api.js` (add after `pressesAPI`, near line 279)
- Modify: `src/DieOrderingSystem.jsx` (import near line 11; state and fetch near the `suppliers` / `plants` state at lines 1569–1576 and their fetchers at 1652–1664)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/correctors` from Task 3.
- Produces:
  - `correctorsAPI.getAll(params)` / `.create(name, plant)` / `.update(id, data)` / `.delete(id)`
  - In `DieOrderingSystem`: state `correctors` (array of `{ id, name, plant, is_active }`), state `correctorsError` (boolean), and `fetchCorrectors()`, all available to pass to child pages. Every page that renders a Corrector field receives both `correctors` and `correctorsError`.

- [ ] **Step 1: Add `correctorsAPI` to `src/api.js`**

Immediately after the `pressesAPI` block:

```javascript
// Correctors API — master list behind the Corrector dropdowns
export const correctorsAPI = {
    getAll: async ({ plant, includeInactive } = {}) => {
        const qs = new URLSearchParams();
        if (plant) qs.set('plant', plant);
        if (includeInactive) qs.set('includeInactive', 'true');
        const suffix = qs.toString() ? `?${qs}` : '';
        return apiRequest(`/correctors${suffix}`);
    },

    create: async (name, plant = null) => {
        return apiRequest('/correctors', {
            method: 'POST',
            body: JSON.stringify({ name, plant }),
        });
    },

    update: async (id, data) => {
        return apiRequest(`/correctors/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id) => {
        return apiRequest(`/correctors/${id}`, {
            method: 'DELETE',
        });
    },
};
```

- [ ] **Step 2: Load correctors once at app level**

In `src/DieOrderingSystem.jsx`, add `correctorsAPI` to the existing import from `./api` on line 11.

Alongside the `suppliers` and `plants` state (near lines 1569–1576):

```javascript
  // Master list for every Corrector dropdown. Inactive rows are fetched too so
  // a record that stores a deactivated corrector still renders its name.
  const [correctors, setCorrectors] = useState([]);
  // Tracked separately so a failed fetch can be shown as an error rather than
  // as an empty dropdown, which would be indistinguishable from "nobody set up".
  const [correctorsError, setCorrectorsError] = useState(false);
```

Alongside `fetchSuppliers` / `fetchPlants` (near lines 1652–1664), following their exact shape:

```javascript
  const fetchCorrectors = async () => {
    try {
      const response = await correctorsAPI.getAll({ includeInactive: true });
      setCorrectors(response || []);
      setCorrectorsError(false);
    } catch (error) {
      console.error('Failed to fetch correctors:', error);
      setCorrectorsError(true);
    }
  };
```

Call `fetchCorrectors()` wherever `fetchSuppliers()` and `fetchPlants()` are already called on load.

- [ ] **Step 3: Verify it compiles and the list loads**

Run: `npm run lint && npm run build`
Expected: PASS, no new warnings.

- [ ] **Step 4: Commit**

```bash
git add src/api.js src/DieOrderingSystem.jsx
git commit -m "feat(correctors): API client and app-level list loading"
```

---

### Task 5: The shared selection rule and component

**Files:**
- Create: `src/components/ui/CorrectorSelect.jsx`

**Interfaces:**
- Consumes: the `correctors` array shape from Task 4.
- Produces, both exported from `src/components/ui/CorrectorSelect.jsx`:
  - `correctorOptions({ correctors, plant, value }) -> Array<string | { value: string, label: string }>` — the filtering, fallback and pinning rule as a pure function, for call sites that already render their own `<select>`. Returns plain strings, except that a pinned unrecognised value is a `{ value, label }` object. Both `renderField` and `InfoRow` already handle either shape.
  - `default CorrectorSelect({ value, onChange, correctors, plant, loadError, id, ariaLabel, style, disabled })` — a ready-made `<select>` for call sites that render a raw input today

- [ ] **Step 1: Write the module**

```jsx
import React from 'react';

// One rule, one place. Every Corrector field in the app resolves its options
// through correctorOptions so the behaviour cannot drift between pages.
//
// Two rules matter here:
//
// 1. Empty-plant fallback. A plant with nobody assigned must not produce an
//    empty required dropdown — that would hard-block die receiving. GEX 01 has
//    no correctors recorded today, so this is a live case, not a hypothetical.
//
// 2. Pin the current value. A stored name that is not in the list (a legacy
//    typo, or a deactivated corrector) is kept as an option so that opening a
//    record never silently blanks or rewrites what is stored.

export const NOT_IN_LIST_SUFFIX = ' — not in list';

export function correctorOptions({ correctors = [], plant, value }) {
  const active = correctors.filter((c) => c.is_active);
  const forPlant = plant ? active.filter((c) => (c.plant || '') === plant) : active;
  const pool = forPlant.length ? forPlant : active;

  const names = [...new Set(pool.map((c) => c.name))]
    .sort((a, b) => a.localeCompare(b));

  const current = String(value || '').trim();
  if (current && !names.includes(current)) {
    return [{ value: current, label: `${current}${NOT_IN_LIST_SUFFIX}` }, ...names];
  }
  return names;
}

export default function CorrectorSelect({
  value, onChange, correctors = [], plant, loadError,
  id, ariaLabel = 'Corrector', style, disabled = false,
}) {
  const options = correctorOptions({ correctors, plant, value });

  // A failed fetch and a genuinely empty list must not look identical. Without
  // this, a backend outage would present as "there are no correctors" and the
  // user would have no idea why they cannot proceed.
  if (loadError) {
    return (
      <div>
        <select id={id} aria-label={ariaLabel} value="" disabled
          style={{ ...style, cursor: 'not-allowed', opacity: 0.65 }}>
          <option value="">— unavailable —</option>
        </select>
        <span style={{ fontSize: '0.68rem', color: '#EF4444', marginTop: '3px', display: 'block' }}>
          Corrector list could not be loaded. Reload the page and try again.
        </span>
      </div>
    );
  }

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...style, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <option value="">— select corrector —</option>
      {options.map((o) =>
        typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/CorrectorSelect.jsx
git commit -m "feat(correctors): shared corrector selection rule and component"
```

---

### Task 6: Die Receiving and the order form

**Files:**
- Modify: `src/pages/FlowPage.jsx:448-449` (the "Assign Corrector *" input) plus its props
- Modify: `src/DieOrderingSystem.jsx:607` (order form field) and `src/DieOrderingSystem.jsx:1334` (detail panel inline edit)

**Interfaces:**
- Consumes: `CorrectorSelect` and `correctorOptions` from Task 5; the `correctors` state from Task 4.
- Produces: no new exports. `FlowPage` gains a `correctors` prop; the order form modal and detail panel gain a `correctors` prop.

- [ ] **Step 1: Replace the Die Receiving input**

In `src/pages/FlowPage.jsx`, add `correctors` and `correctorsError` to the component's destructured props (the list starting near line 81), import the component:

```javascript
import CorrectorSelect from '../components/ui/CorrectorSelect';
```

Then replace the `<input id="flowpage-assign-corrector" ... />` on line 449 with:

```jsx
                <CorrectorSelect
                  id="flowpage-assign-corrector"
                  value={dieReceivanceForm.corrector}
                  onChange={(v) => setDieReceivanceForm({ ...dieReceivanceForm, corrector: v })}
                  correctors={correctors}
                  loadError={correctorsError}
                  plant={dieReceivanceOrder?.Plant}
                  style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                />
```

Leave the existing required-field guard on line 457 untouched — it still correctly rejects an empty selection.

- [ ] **Step 2: Pass `correctors` into `FlowPage`**

In `src/DieOrderingSystem.jsx`, find where `<FlowPage ... />` is rendered and add `correctors={correctors}` and `correctorsError={correctorsError}`.

- [ ] **Step 3: Convert the order form field**

The order form's `renderField` helper (line 499) already supports `type: 'select'` with an `options` array, and `correctorOptions` returns exactly that shape. In `src/DieOrderingSystem.jsx`, import the helper:

```javascript
import { correctorOptions } from './components/ui/CorrectorSelect';
```

Replace line 607:

```jsx
              {renderField({ label: 'Corrector', field: 'Corrector' })}
```

with:

```jsx
              {renderField({ label: 'Corrector', field: 'Corrector', type: 'select', options: correctorOptions({ correctors, plant: form.Plant, value: form.Corrector }), placeholder: '— select corrector —' })}
```

Add `correctors` to the props of the component that owns `renderField`, and pass it in where that modal is rendered.

- [ ] **Step 4: Convert the detail panel inline edit**

`InfoRow` (line 1130) also already supports `type: 'select'` with `options`. Replace line 1334:

```jsx
              {InfoRow({ label: 'Corrector', field: 'Corrector', value: currentOrder['Corrector'] })}
```

with:

```jsx
              {InfoRow({ label: 'Corrector', field: 'Corrector', value: currentOrder['Corrector'], type: 'select', options: correctorOptions({ correctors, plant: currentOrder.Plant, value: editedOrder['Corrector'] }), placeholder: '— select corrector —' })}
```

Add `correctors` to the props of the component that owns `InfoRow`, and pass it in where that panel is rendered.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/FlowPage.jsx src/DieOrderingSystem.jsx
git commit -m "feat(correctors): dropdown on die receiving and the order form"
```

---

### Task 7: Sample Followup and QD

**Files:**
- Modify: `src/pages/SampleFollowupPage.jsx:499` (the form field definition) and its props
- Modify: `src/components/qd/RaiseQDModal.jsx:367-368` (the Corrector input) and its props

**Interfaces:**
- Consumes: `CorrectorSelect` and `correctorOptions` from Task 5; the `correctors` state from Task 4.
- Produces: no new exports. Both components gain a `correctors` prop.

- [ ] **Step 1: Convert the Sample Followup field**

In `src/pages/SampleFollowupPage.jsx`, add `correctors` and `correctorsError` to the destructured props and import the component:

```javascript
import CorrectorSelect from '../components/ui/CorrectorSelect';
```

The form renders fields from an array where each entry is `{ key, label, type }`, then branches on `field.type === 'select'`. Change the entry on line 499 from:

```jsx
                { key: 'corrector', label: 'Corrector', type: 'text' },
```

to:

```jsx
                { key: 'corrector', label: 'Corrector', type: 'corrector' },
```

and add a branch for it in the renderer, before the existing `field.type === 'select'` branch:

```jsx
                  {field.type === 'corrector' ? (
                    <CorrectorSelect
                      value={sampleFollowupForm[field.key] || ''}
                      onChange={(v) => setSampleFollowupForm({ ...sampleFollowupForm, [field.key]: v })}
                      correctors={correctors}
                      loadError={correctorsError}
                      plant={sampleFollowupForm.plant}
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  ) : field.type === 'select' ? (
```

Adjust the closing of the existing ternary chain to match.

- [ ] **Step 2: Pass `correctors` into `SampleFollowupPage`**

In `src/DieOrderingSystem.jsx`, find where `<SampleFollowupPage ... />` is rendered and add `correctors={correctors}`.

- [ ] **Step 3: Convert the QD modal field**

In `src/components/qd/RaiseQDModal.jsx`, add `correctors` and `correctorsError` to the destructured props and import the component:

```javascript
import CorrectorSelect from '../ui/CorrectorSelect';
```

Replace the input on line 368:

```jsx
                <input id="raiseqdmodal-corrector" value={corrector} onChange={(e) => setCorrector(e.target.value)} placeholder="e.g. Sijith" style={field} />
```

with:

```jsx
                <CorrectorSelect
                  id="raiseqdmodal-corrector"
                  value={corrector}
                  onChange={setCorrector}
                  correctors={correctors}
                  loadError={correctorsError}
                  plant={plant}
                  style={field}
                />
```

Note this deletes the `e.g. Sijith` placeholder, which misspelled the name stored everywhere else as `Sujith`.

The existing `corrector.trim()` calls in `buildEditPayload` (line 200) and the create call (line 233) stay as they are — they are harmless on a selected value.

- [ ] **Step 4: Pass `correctors` into `RaiseQDModal`**

Find where `<RaiseQDModal ... />` is rendered (in `src/pages/QDTrackerPage.jsx` or its parent) and thread `correctors` and `correctorsError` through from `DieOrderingSystem`, adding both props to any intermediate component in the chain.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SampleFollowupPage.jsx src/components/qd/RaiseQDModal.jsx src/pages/QDTrackerPage.jsx src/DieOrderingSystem.jsx
git commit -m "feat(correctors): dropdown on sample followup and QD"
```

---

### Task 8: Settings management card

**Files:**
- Create: `src/components/settings/CorrectorsCard.jsx`
- Modify: `src/pages/SettingsPage.jsx` (import, props, and render on the `general` tab after the Suppliers card which ends near line 300)

**Interfaces:**
- Consumes: `correctorsAPI` from Task 4.
- Produces: `default CorrectorsCard({ theme, plants, correctors, fetchCorrectors, isAdmin })`.

**Why a separate file:** `SettingsPage.jsx` is already 1055 lines, with the suppliers card alone spanning ~80 inline. Adding another inline block makes the page harder to work in. Existing cards are deliberately left where they are — moving them would be unrelated churn.

- [ ] **Step 1: Write the card**

```jsx
import React, { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { correctorsAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Admin-maintained master list behind every Corrector dropdown. This is the
// only place in the app where a corrector name is typed rather than chosen.
export default function CorrectorsCard({ theme, plants = [], correctors = [], fetchCorrectors, isAdmin }) {
  const [newName, setNewName] = useState('');
  const [newPlant, setNewPlant] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!newName.trim()) { dialogs.notify('Corrector name is required.', 'error'); return; }
    setSaving(true);
    try {
      await correctorsAPI.create(newName.trim(), newPlant || null);
      setNewName(''); setNewPlant('');
      fetchCorrectors();
    } catch (error) {
      dialogs.notify('Failed to add: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id, data) => {
    try { await correctorsAPI.update(id, data); fetchCorrectors(); }
    catch (error) { dialogs.notify('Failed to update: ' + error.message, 'error'); }
  };

  const deactivate = async (c) => {
    const ok = await dialogs.confirm({
      title: 'Deactivate corrector',
      message: `"${c.name}" will no longer appear in the Corrector dropdowns. Dies already recorded against this name keep it.`,
      confirmLabel: 'Deactivate',
    });
    if (ok) patch(c.id, { is_active: false });
  };

  const cell = { padding: '8px 12px', fontSize: '0.8rem', color: theme.text };

  return (
    <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, marginTop: '1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
          <UserCheck size={20} /> Correctors
        </h3>
        <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
          The list offered on Die Receiving, Sample Followup and QD. Correctors are shown for their own plant first.
        </p>
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            aria-label="New corrector name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Corrector name"
            style={{ flex: '1 1 200px', padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem' }}
          />
          <select
            aria-label="New corrector plant"
            value={newPlant}
            onChange={(e) => setNewPlant(e.target.value)}
            style={{ padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem' }}
          >
            <option value="">All plants</option>
            {plants.map((p) => <option key={p.id || p.name} value={p.name}>{p.name}</option>)}
          </select>
          <button onClick={add} disabled={saving} style={{ padding: '8px 18px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'wait' : 'pointer', fontSize: '0.85rem' }}>
            Add
          </button>
        </div>
      )}

      <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim }}>Name</th>
              <th scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim }}>Plant</th>
              <th scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim }}>Status</th>
              {isAdmin && <th scope="col" style={{ ...cell, textAlign: 'right', color: theme.textDim }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {correctors.map((c) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${theme.cardBorder}`, opacity: c.is_active ? 1 : 0.55 }}>
                <td style={cell}>{c.name}</td>
                <td style={cell}>
                  {isAdmin ? (
                    <select
                      aria-label={`Plant for ${c.name}`}
                      value={c.plant || ''}
                      onChange={(e) => patch(c.id, { plant: e.target.value || null })}
                      style={{ padding: '4px 8px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '4px', color: theme.text, fontSize: '0.75rem' }}
                    >
                      <option value="">All plants</option>
                      {plants.map((p) => <option key={p.id || p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  ) : (c.plant || 'All plants')}
                </td>
                <td style={cell}>{c.is_active ? 'Active' : 'Inactive'}</td>
                {isAdmin && (
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {c.is_active ? (
                      <button onClick={() => deactivate(c)} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Deactivate</button>
                    ) : (
                      <button onClick={() => patch(c.id, { is_active: true })} style={{ padding: '4px 10px', background: '#10B981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Reactivate</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {correctors.length === 0 && (
              <tr><td colSpan={isAdmin ? 4 : 3} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>No correctors configured</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it in Settings**

In `src/pages/SettingsPage.jsx`, import it:

```javascript
import CorrectorsCard from '../components/settings/CorrectorsCard';
```

Add `correctors, fetchCorrectors` to the destructured props (near `suppliers, fetchSuppliers` on line 12). Then render it on the `general` tab, immediately after the Suppliers card's closing `</div>` (near line 300, before the `{/* Email Templates tab */}` comment):

```jsx
                <CorrectorsCard
                  theme={theme}
                  plants={plants}
                  correctors={correctors}
                  fetchCorrectors={fetchCorrectors}
                  isAdmin={isAdmin}
                />
```

`isAdmin` is already computed on line 35 of that file.

- [ ] **Step 3: Pass the props from `DieOrderingSystem`**

Where `<SettingsPage ... />` is rendered, add `correctors={correctors}` and `fetchCorrectors={fetchCorrectors}`.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/CorrectorsCard.jsx src/pages/SettingsPage.jsx src/DieOrderingSystem.jsx
git commit -m "feat(correctors): admin management card in settings"
```

---

### Task 9: End-to-end verification

**Files:** none modified — this task only proves the feature works.

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a verified, running stack.

- [ ] **Step 1: Run the full backend suite**

Run: `npm test`
Expected: PASS, including the 11 correctors tests, with no pre-existing test broken.

- [ ] **Step 2: Lint and build the frontend**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Rebuild and start the whole stack**

A plain restart will not pick up these edits.

```bash
docker compose build backend frontend && docker compose up -d
```

- [ ] **Step 4: Smoke-test in the browser**

Open the app on port 80 and check each item:

- Settings → Plants & Suppliers shows the **Correctors** card with the five seeded GEX 2 names.
- Adding a corrector with a blank name shows an error and adds nothing.
- Adding a duplicate name on the same plant shows the 409 message.
- Die Receiving on a **GEX 2** order: the Corrector field is a dropdown, typing is impossible, and it lists only GEX 2 names.
- Die Receiving on a **GEX 01** order: the dropdown falls back to the full active list rather than being empty. **This is the check that matters most** — an empty required dropdown would hard-block die receiving.
- Sample Followup edit form and the Raise QD modal both show the dropdown.
- Open a QD whose stored corrector is `abcd`: it still displays, shown as `abcd — not in list`, with the real names selectable below it.
- Deactivate a corrector in Settings, then confirm it disappears from the dropdowns while dies already recorded against that name still display it.
- Stop the backend (`docker compose stop backend`), reload the page, and open a Corrector field: it must show the "could not be loaded" message rather than an empty dropdown. Restart with `docker compose start backend` afterwards.

- [ ] **Step 5: Confirm no historical data was rewritten**

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT 'die_orders' t, corrector, count(*) FROM die_orders WHERE corrector IS NOT NULL AND btrim(corrector)<>'' GROUP BY 1,2 UNION ALL SELECT 'quality_discrepancies', corrector, count(*) FROM quality_discrepancies WHERE corrector IS NOT NULL AND btrim(corrector)<>'' GROUP BY 1,2 ORDER BY 1,3 DESC;"
```

Expected: the same distribution as before the work — Kailash 51, Jaypee 49, Raheem 33, Sujith 30, Dinesh 29 in `die_orders`, and the QD rows including `abcd`, `1234` and `vijeesh` still present. Nothing should have moved.

- [ ] **Step 6: Commit any fixes and push the branch**

```bash
git status
git push -u origin feat/corrector-master-list
```

---

## Notes for the implementer

- **Do not add a foreign key** from the three `corrector` columns to `correctors`. That is a deliberate design decision, not an oversight — the spec explains why.
- **Do not "clean up" existing corrector values.** Leaving `abcd` and `1234` in place is the agreed behaviour.
- **Do not touch the importers.** `PDFImportModal` and `sampleFollowupImport.cjs` write corrector values from source documents and are explicitly out of scope.
- If a plant filter would leave the dropdown empty, the fallback must show the full active list. Never ship an empty required dropdown.
