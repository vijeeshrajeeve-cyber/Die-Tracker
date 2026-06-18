# Frozen / Final Design Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users freeze an approved die design (with final files), then flag and reuse it on future orders/backup requests for the same Profile+Plant+Press+Cavity — skipping Design/Approval stages straight to PR Pending, with a recorded reason when bypassed.

**Architecture:** New `frozen_designs` + `frozen_design_files` tables and FK/audit columns on `die_orders` and `backup_die_requests`. Pure, unit-tested service modules (`server/services/frozenDesigns.cjs`, `frozenDesignStorage.cjs`) hold all logic; a thin router (`server/routes/frozen-designs.cjs`) exposes them. Files land in a server-local Docker volume via multer. Frontend adds a Frozen Designs page, a freeze checkbox at design approval, and a reusable match banner in the add-order and backup-request forms.

**Tech Stack:** Node + Express 5, PostgreSQL (`pg`), `node:test` runner, multer (new), React 19 + Vite, lucide-react.

Spec: `docs/superpowers/specs/2026-06-18-frozen-design-design.md`

---

## File Structure

**Backend — create:**
- `server/services/frozenDesignStorage.cjs` — pure file helpers: extension allow-list, filename sanitize, stored-path builder, root resolver.
- `server/services/frozenDesignStorage.test.cjs` — tests for the above.
- `server/services/frozenDesigns.cjs` — DB logic: `findActiveMatch`, `freezeDesign` (transactional supersede+insert), `listFrozenDesigns` (with released/bypassed counts + files), `manualRelease`, `extractProfileFromDie`.
- `server/services/frozenDesigns.test.cjs` — tests using a mock pg client.
- `server/routes/frozen-designs.cjs` — Express router (list/match/create/files/download/release).

**Backend — modify:**
- `server/db.cjs` — create the two tables + add columns (idempotent migrations).
- `init.sql` — mirror schema for fresh installs.
- `server/index.cjs` — mount the new router.
- `server/routes/orders.cjs` — on design-approval transition, freeze when `freeze_design` is set; accept frozen-design link/bypass fields on create.
- `server/routes/backup-requests.cjs` — accept frozen-design link/bypass fields on create.
- `package.json` — add `multer` dependency and a `test` script.
- `Dockerfile.backend`, `docker-compose.yml` — mount the frozen-designs volume + `FROZEN_DESIGNS_ROOT` env.

**Frontend — create:**
- `src/pages/FrozenDesignsPage.jsx` — list view with status, files, Released ×N / Bypassed ×N, admin release.
- `src/components/FrozenDesignBanner.jsx` — match banner with Release / Proceed-normal-flow actions.

**Frontend — modify:**
- `src/api.js` — add `frozenDesignsAPI`.
- `src/utils/constants.js` — add page to `CONTROLLABLE_PAGES`; add bypass-reason presets.
- `src/DieOrderingSystem.jsx` — sidebar entry + `activeTab === 'frozen-designs'` branch; freeze checkbox at approval; render banner in add-order form.
- `src/components/backup/BackupDieRequests.jsx` — render banner in add form.

---

## Phase 1 — Database Schema

### Task 1: Create tables and columns in db.cjs

**Files:**
- Modify: `server/db.cjs` (after the `backup_die_requests` migration block, ~line 306)

- [ ] **Step 1: Add the schema block**

In `server/db.cjs`, immediately after the `backup_die_requests` `DO $$ ... END $$;` block (currently ending ~line 306), insert:

```javascript
      // ── Frozen / Final Designs ──────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS frozen_designs (
        id SERIAL PRIMARY KEY,
        profile_number  TEXT NOT NULL,
        plant           TEXT NOT NULL,
        press           TEXT NOT NULL,
        cavity          INTEGER NOT NULL,
        source_order_id INTEGER REFERENCES die_orders(id),
        frozen_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        frozen_by       INTEGER REFERENCES users(id),
        is_active       BOOLEAN DEFAULT true,
        superseded_by   INTEGER REFERENCES frozen_designs(id),
        released_at     TIMESTAMP,
        released_by     INTEGER REFERENCES users(id),
        release_reason  TEXT,
        notes           TEXT,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_frozen
        ON frozen_designs (profile_number, plant, press, cavity)
        WHERE is_active = true;

      CREATE TABLE IF NOT EXISTS frozen_design_files (
        id SERIAL PRIMARY KEY,
        frozen_design_id INTEGER NOT NULL REFERENCES frozen_designs(id) ON DELETE CASCADE,
        original_name    TEXT NOT NULL,
        stored_path      TEXT NOT NULL,
        mime_type        TEXT,
        size_bytes       BIGINT,
        uploaded_by      INTEGER REFERENCES users(id),
        uploaded_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='frozen_design_id') THEN
          ALTER TABLE die_orders ADD COLUMN frozen_design_id INTEGER REFERENCES frozen_designs(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='frozen_design_action') THEN
          ALTER TABLE die_orders ADD COLUMN frozen_design_action TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='frozen_design_override_reason') THEN
          ALTER TABLE die_orders ADD COLUMN frozen_design_override_reason TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='frozen_design_override_note') THEN
          ALTER TABLE die_orders ADD COLUMN frozen_design_override_note TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name='frozen_design_id') THEN
          ALTER TABLE backup_die_requests ADD COLUMN frozen_design_id INTEGER REFERENCES frozen_designs(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name='frozen_design_action') THEN
          ALTER TABLE backup_die_requests ADD COLUMN frozen_design_action TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name='frozen_design_override_reason') THEN
          ALTER TABLE backup_die_requests ADD COLUMN frozen_design_override_reason TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name='frozen_design_override_note') THEN
          ALTER TABLE backup_die_requests ADD COLUMN frozen_design_override_note TEXT;
        END IF;
      END $$;
```

> Note: this text goes inside the same template-literal SQL string that the surrounding `CREATE TABLE`/`DO $$` blocks live in. Match the existing indentation and ensure it is part of the `pool.query(\`...\`)` call, not a new statement.

- [ ] **Step 2: Verify the file still parses**

Run: `node -e "require('./server/db.cjs'); console.log('db.cjs loads OK')"`
Expected: prints `db.cjs loads OK` (no syntax error). It will NOT connect to a DB — we only check the module loads.

- [ ] **Step 3: Mirror schema in init.sql**

In `init.sql`, after the `backup_die_requests` table block (ends ~line 128), add the same two `CREATE TABLE` statements and the `CREATE UNIQUE INDEX`, plus `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for the four columns on each of `die_orders` and `backup_die_requests`:

```sql
-- Frozen / Final Designs
CREATE TABLE IF NOT EXISTS frozen_designs (
    id SERIAL PRIMARY KEY,
    profile_number  TEXT NOT NULL,
    plant           TEXT NOT NULL,
    press           TEXT NOT NULL,
    cavity          INTEGER NOT NULL,
    source_order_id INTEGER REFERENCES die_orders(id),
    frozen_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    frozen_by       INTEGER REFERENCES users(id),
    is_active       BOOLEAN DEFAULT true,
    superseded_by   INTEGER REFERENCES frozen_designs(id),
    released_at     TIMESTAMP,
    released_by     INTEGER REFERENCES users(id),
    release_reason  TEXT,
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_frozen
    ON frozen_designs (profile_number, plant, press, cavity)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS frozen_design_files (
    id SERIAL PRIMARY KEY,
    frozen_design_id INTEGER NOT NULL REFERENCES frozen_designs(id) ON DELETE CASCADE,
    original_name    TEXT NOT NULL,
    stored_path      TEXT NOT NULL,
    mime_type        TEXT,
    size_bytes       BIGINT,
    uploaded_by      INTEGER REFERENCES users(id),
    uploaded_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_id INTEGER REFERENCES frozen_designs(id);
ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_action TEXT;
ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_override_reason TEXT;
ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_override_note TEXT;
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_id INTEGER REFERENCES frozen_designs(id);
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_action TEXT;
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_override_reason TEXT;
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_override_note TEXT;
```

- [ ] **Step 4: Commit**

```bash
git add server/db.cjs init.sql
git commit -m "feat(db): add frozen_designs schema and order link columns"
```

---

## Phase 2 — Backend Storage Helpers (TDD)

### Task 2: File storage helper module

**Files:**
- Create: `server/services/frozenDesignStorage.cjs`
- Test: `server/services/frozenDesignStorage.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `server/services/frozenDesignStorage.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const s = require('./frozenDesignStorage.cjs');

test('isAllowedExtension accepts design types, rejects others', () => {
  assert.equal(s.isAllowedExtension('drawing.PDF'), true);
  assert.equal(s.isAllowedExtension('model.step'), true);
  assert.equal(s.isAllowedExtension('a.dwg'), true);
  assert.equal(s.isAllowedExtension('photo.jpeg'), true);
  assert.equal(s.isAllowedExtension('virus.exe'), false);
  assert.equal(s.isAllowedExtension('noext'), false);
});

test('sanitizeFilename strips paths and unsafe chars but keeps extension', () => {
  assert.equal(s.sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(s.sanitizeFilename('My Drawing #1.pdf'), 'My_Drawing_1.pdf');
  assert.equal(s.sanitizeFilename(''), 'file');
});

test('buildStoredPath composes root/profile/press/cavity/id/name', () => {
  const root = path.join('/srv', 'fz');
  const out = s.buildStoredPath(root, { profile: '14752', press: 'PRESS 4', cavity: 2, frozenDesignId: 9, fileName: 'd.pdf' });
  assert.equal(out, path.join(root, '14752', 'PRESS_4', '2', '9', 'd.pdf'));
});

test('MAX_FILE_BYTES is 100 MB', () => {
  assert.equal(s.MAX_FILE_BYTES, 100 * 1024 * 1024);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/frozenDesignStorage.test.cjs`
Expected: FAIL — cannot find module `./frozenDesignStorage.cjs`.

- [ ] **Step 3: Write the implementation**

Create `server/services/frozenDesignStorage.cjs`:

```javascript
'use strict';
const path = require('path');

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'dwg', 'dxf', 'step', 'stp'];
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

function getRoot() {
  return process.env.FROZEN_DESIGNS_ROOT || '/app/storage/frozen-designs';
}

function extOf(name) {
  const base = String(name || '');
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

function isAllowedExtension(name) {
  return ALLOWED_EXTENSIONS.includes(extOf(name));
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || '')).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'file';
}

function sanitizeSegment(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || '_';
}

function buildStoredPath(root, { profile, press, cavity, frozenDesignId, fileName }) {
  return path.join(
    root,
    sanitizeSegment(profile),
    sanitizeSegment(press),
    sanitizeSegment(cavity),
    sanitizeSegment(frozenDesignId),
    sanitizeFilename(fileName)
  );
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  getRoot,
  isAllowedExtension,
  sanitizeFilename,
  sanitizeSegment,
  buildStoredPath,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/services/frozenDesignStorage.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/frozenDesignStorage.cjs server/services/frozenDesignStorage.test.cjs
git commit -m "feat(frozen): add file storage helpers with tests"
```

---

## Phase 3 — Backend DB Logic (TDD)

### Task 3: profile extraction + match lookup

**Files:**
- Create: `server/services/frozenDesigns.cjs`
- Test: `server/services/frozenDesigns.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `server/services/frozenDesigns.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fd = require('./frozenDesigns.cjs');

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

test('extractProfileFromDie strips prefix and leading zeros', () => {
  assert.equal(fd.extractProfileFromDie('014752-702'), '14752');
  assert.equal(fd.extractProfileFromDie('00900'), '900');
  assert.equal(fd.extractProfileFromDie(''), null);
  assert.equal(fd.extractProfileFromDie(null), null);
});

test('findActiveMatch returns null when key incomplete', async () => {
  const client = makeClient();
  const res = await fd.findActiveMatch(client, { profile: '14752', plant: 'GEX 01', press: '', cavity: 2 });
  assert.equal(res, null);
  assert.equal(client.calls.length, 0); // no query fired
});

test('findActiveMatch queries active row by full key', async () => {
  const client = makeClient([
    { match: (s) => s.includes('FROM frozen_designs') && s.includes('is_active'),
      result: () => ({ rows: [{ id: 7, profile_number: '14752' }], rowCount: 1 }) },
  ]);
  const res = await fd.findActiveMatch(client, { profile: '14752', plant: 'GEX 01', press: 'PRESS 4', cavity: 2 });
  assert.equal(res.id, 7);
  assert.deepEqual(client.calls[0].params, ['14752', 'GEX 01', 'PRESS 4', 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/frozenDesigns.test.cjs`
Expected: FAIL — cannot find module `./frozenDesigns.cjs`.

- [ ] **Step 3: Write the implementation (initial)**

Create `server/services/frozenDesigns.cjs`:

```javascript
'use strict';

function extractProfileFromDie(dieNo) {
  if (dieNo === null || dieNo === undefined) return null;
  const cleaned = String(dieNo).trim().split('-')[0].replace(/^0+/, '');
  return cleaned || null;
}

function hasFullKey({ profile, plant, press, cavity }) {
  return Boolean(profile) && Boolean(plant) && Boolean(press) &&
    cavity !== null && cavity !== undefined && cavity !== '';
}

async function findActiveMatch(client, { profile, plant, press, cavity }) {
  if (!hasFullKey({ profile, plant, press, cavity })) return null;
  const { rows } = await client.query(
    `SELECT * FROM frozen_designs
       WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4
         AND is_active = true
       LIMIT 1`,
    [profile, plant, press, Math.round(Number(cavity))]
  );
  return rows[0] || null;
}

module.exports = { extractProfileFromDie, hasFullKey, findActiveMatch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/services/frozenDesigns.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/frozenDesigns.cjs server/services/frozenDesigns.test.cjs
git commit -m "feat(frozen): add profile extraction and active-match lookup"
```

### Task 4: freezeDesign (transactional supersede + insert)

**Files:**
- Modify: `server/services/frozenDesigns.cjs`
- Modify: `server/services/frozenDesigns.test.cjs`

- [ ] **Step 1: Add failing test**

Append to `server/services/frozenDesigns.test.cjs`:

```javascript
test('freezeDesign supersedes existing active then inserts new', async () => {
  const client = makeClient([
    { match: (s) => s.startsWith('UPDATE frozen_designs SET is_active = false'),
      result: () => ({ rows: [], rowCount: 1 }) },
    { match: (s) => s.startsWith('INSERT INTO frozen_designs'),
      result: () => ({ rows: [{ id: 42 }], rowCount: 1 }) },
    { match: (s) => s.startsWith('UPDATE frozen_designs SET superseded_by'),
      result: () => ({ rows: [], rowCount: 1 }) },
  ]);
  const id = await fd.freezeDesign(client, {
    profile: '14752', plant: 'GEX 01', press: 'PRESS 4', cavity: 2,
    sourceOrderId: 5, frozenBy: 3, notes: 'final',
  });
  assert.equal(id, 42);
  const sqls = client.calls.map(c => c.sql);
  assert.ok(sqls.some(s => s.startsWith('UPDATE frozen_designs SET is_active = false')));
  assert.ok(sqls.some(s => s.startsWith('INSERT INTO frozen_designs')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/frozenDesigns.test.cjs`
Expected: FAIL — `fd.freezeDesign is not a function`.

- [ ] **Step 3: Implement freezeDesign**

In `server/services/frozenDesigns.cjs`, add before `module.exports` and include in exports:

```javascript
async function freezeDesign(client, { profile, plant, press, cavity, sourceOrderId, frozenBy, notes }) {
  const cav = Math.round(Number(cavity));
  // Deactivate any existing active design for this key.
  await client.query(
    `UPDATE frozen_designs SET is_active = false, released_at = CURRENT_TIMESTAMP,
       released_by = $5, release_reason = 'superseded'
       WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4 AND is_active = true`,
    [profile, plant, press, cav, frozenBy || null]
  );
  const { rows } = await client.query(
    `INSERT INTO frozen_designs (profile_number, plant, press, cavity, source_order_id, frozen_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [profile, plant, press, cav, sourceOrderId || null, frozenBy || null, notes || null]
  );
  const newId = rows[0].id;
  // Point superseded rows (just deactivated for this key) at the new active one.
  await client.query(
    `UPDATE frozen_designs SET superseded_by = $1
       WHERE profile_number = $2 AND plant = $3 AND press = $4 AND cavity = $5
         AND is_active = false AND release_reason = 'superseded' AND superseded_by IS NULL AND id <> $1`,
    [newId, profile, plant, press, cav]
  );
  return newId;
}
```

Update the exports line to:

```javascript
module.exports = { extractProfileFromDie, hasFullKey, findActiveMatch, freezeDesign };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/services/frozenDesigns.test.cjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/frozenDesigns.cjs server/services/frozenDesigns.test.cjs
git commit -m "feat(frozen): add transactional freezeDesign with supersession"
```

### Task 5: listFrozenDesigns (with derived counts + files) and manualRelease

**Files:**
- Modify: `server/services/frozenDesigns.cjs`
- Modify: `server/services/frozenDesigns.test.cjs`

- [ ] **Step 1: Add failing test**

Append to `server/services/frozenDesigns.test.cjs`:

```javascript
test('listFrozenDesigns selects released/bypassed counts and orders by frozen_at', async () => {
  const client = makeClient([
    { match: (s) => s.includes('FROM frozen_designs') && s.includes('released_count'),
      result: () => ({ rows: [{ id: 1, released_count: 3, bypassed_count: 1 }], rowCount: 1 }) },
    { match: (s) => s.includes('FROM frozen_design_files'),
      result: () => ({ rows: [{ id: 11, frozen_design_id: 1, original_name: 'd.pdf' }] }) },
  ]);
  const rows = await fd.listFrozenDesigns(client, {});
  assert.equal(rows[0].released_count, 3);
  assert.equal(rows[0].bypassed_count, 1);
  assert.equal(rows[0].files.length, 1);
});

test('manualRelease deactivates by id with reason manual', async () => {
  const client = makeClient([
    { match: (s) => s.startsWith('UPDATE frozen_designs SET is_active = false'),
      result: () => ({ rows: [{ id: 5 }], rowCount: 1 }) },
  ]);
  const ok = await fd.manualRelease(client, { id: 5, userId: 2 });
  assert.equal(ok, true);
  assert.deepEqual(client.calls[0].params, [2, 5]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/frozenDesigns.test.cjs`
Expected: FAIL — `fd.listFrozenDesigns is not a function`.

- [ ] **Step 3: Implement both functions**

In `server/services/frozenDesigns.cjs`, add before `module.exports`:

```javascript
async function listFrozenDesigns(client, { profile, plant, press, cavity, activeOnly } = {}) {
  const where = [];
  const params = [];
  if (profile) { params.push(profile); where.push(`fd.profile_number = $${params.length}`); }
  if (plant)   { params.push(plant);   where.push(`fd.plant = $${params.length}`); }
  if (press)   { params.push(press);   where.push(`fd.press = $${params.length}`); }
  if (cavity !== undefined && cavity !== null && cavity !== '') {
    params.push(Math.round(Number(cavity))); where.push(`fd.cavity = $${params.length}`);
  }
  if (activeOnly) where.push('fd.is_active = true');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await client.query(
    `SELECT fd.*,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'released')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'released')
         AS released_count,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'bypassed')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'bypassed')
         AS bypassed_count
       FROM frozen_designs fd
       ${whereSql}
       ORDER BY fd.frozen_at DESC`,
    params
  );
  const ids = rows.map(r => r.id);
  let files = [];
  if (ids.length) {
    const fres = await client.query(
      `SELECT id, frozen_design_id, original_name, mime_type, size_bytes, uploaded_at
         FROM frozen_design_files WHERE frozen_design_id = ANY($1) ORDER BY uploaded_at ASC`,
      [ids]
    );
    files = fres.rows;
  }
  return rows.map(r => ({
    ...r,
    released_count: Number(r.released_count) || 0,
    bypassed_count: Number(r.bypassed_count) || 0,
    files: files.filter(f => f.frozen_design_id === r.id),
  }));
}

async function manualRelease(client, { id, userId }) {
  const { rowCount } = await client.query(
    `UPDATE frozen_designs SET is_active = false, released_at = CURRENT_TIMESTAMP,
       released_by = $1, release_reason = 'manual'
       WHERE id = $2 AND is_active = true`,
    [userId || null, id]
  );
  return rowCount > 0;
}
```

Update exports:

```javascript
module.exports = { extractProfileFromDie, hasFullKey, findActiveMatch, freezeDesign, listFrozenDesigns, manualRelease };
```

- [ ] **Step 4: Run all service tests**

Run: `node --test server/services/frozenDesigns.test.cjs server/services/frozenDesignStorage.test.cjs`
Expected: PASS (all tests across both files).

- [ ] **Step 5: Commit**

```bash
git add server/services/frozenDesigns.cjs server/services/frozenDesigns.test.cjs
git commit -m "feat(frozen): add listFrozenDesigns counts and manualRelease"
```

---

## Phase 4 — Backend Router & Wiring

### Task 6: Add multer dependency and test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install multer**

Run: `npm install multer@^2.0.0`
Expected: `multer` added to `dependencies` in `package.json`.

- [ ] **Step 2: Add a test script**

In `package.json` `"scripts"`, add:

```json
    "test": "node --test server/**/*.test.cjs",
```

- [ ] **Step 3: Verify the test script runs the suite**

Run: `npm test`
Expected: PASS — runs the storage + frozenDesigns + existing jFileTemplate tests.
(If the `server/**/*.test.cjs` glob is not expanded on Windows shells, fall back to: `node --test server/services/frozenDesigns.test.cjs server/services/frozenDesignStorage.test.cjs server/services/jFileTemplate.test.cjs` and keep that explicit list in the script.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add multer and npm test script"
```

### Task 7: Frozen-designs router

**Files:**
- Create: `server/routes/frozen-designs.cjs`

- [ ] **Step 1: Write the router**

Create `server/routes/frozen-designs.cjs`:

```javascript
'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const multer = require('multer');
const { pool } = require('../db.cjs');
const { adminMiddleware } = require('./auth.cjs');
const fd = require('../services/frozenDesigns.cjs');
const store = require('../services/frozenDesignStorage.cjs');

const router = express.Router();

const upload = multer({
  dest: path.join(os.tmpdir(), 'frozen-uploads'),
  limits: { fileSize: store.MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (store.isAllowedExtension(file.originalname)) return cb(null, true);
    cb(new Error('File type not allowed'));
  },
});

// GET /api/frozen-designs?profile=&plant=&press=&cavity=&activeOnly=
router.get('/', async (req, res) => {
  try {
    const { profile, plant, press, cavity, activeOnly } = req.query;
    const rows = await fd.listFrozenDesigns(pool, {
      profile, plant, press, cavity,
      activeOnly: activeOnly === 'true' || activeOnly === '1',
    });
    res.json(rows);
  } catch (e) {
    console.error('List frozen designs error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/frozen-designs/match?profile=&plant=&press=&cavity=
router.get('/match', async (req, res) => {
  try {
    const { profile, plant, press, cavity } = req.query;
    const match = await fd.findActiveMatch(pool, { profile, plant, press, cavity });
    if (!match) return res.json(null);
    const files = await pool.query(
      `SELECT id, original_name, mime_type, size_bytes FROM frozen_design_files WHERE frozen_design_id = $1`,
      [match.id]
    );
    res.json({ ...match, files: files.rows });
  } catch (e) {
    console.error('Match frozen design error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/frozen-designs  { profile, plant, press, cavity, sourceOrderId, notes }
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { profile, plant, press, cavity, sourceOrderId, notes } = req.body;
    if (!fd.hasFullKey({ profile, plant, press, cavity })) {
      return res.status(400).json({ error: 'profile, plant, press and cavity are required' });
    }
    await client.query('BEGIN');
    const id = await fd.freezeDesign(client, {
      profile, plant, press, cavity, sourceOrderId, frozenBy: req.user?.id, notes,
    });
    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create frozen design error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/frozen-designs/:id/files  (multipart, field name "files")
router.post('/:id/files', upload.array('files', 10), async (req, res) => {
  try {
    const { id } = req.params;
    const meta = await pool.query(`SELECT * FROM frozen_designs WHERE id = $1`, [id]);
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Frozen design not found' });
    const d = meta.rows[0];
    const root = store.getRoot();
    const saved = [];
    for (const file of (req.files || [])) {
      const dest = store.buildStoredPath(root, {
        profile: d.profile_number, press: d.press, cavity: d.cavity,
        frozenDesignId: d.id, fileName: file.originalname,
      });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(file.path, dest);
      const rel = path.relative(root, dest);
      const ins = await pool.query(
        `INSERT INTO frozen_design_files (frozen_design_id, original_name, stored_path, mime_type, size_bytes, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [d.id, file.originalname, rel, file.mimetype, file.size, req.user?.id || null]
      );
      saved.push({ id: ins.rows[0].id, original_name: file.originalname });
    }
    res.status(201).json({ files: saved });
  } catch (e) {
    console.error('Upload frozen design files error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/frozen-designs/files/:fileId  (download)
router.get('/files/:fileId', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM frozen_design_files WHERE id = $1`, [req.params.fileId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'File not found' });
    const root = store.getRoot();
    const abs = path.resolve(root, r.rows[0].stored_path);
    if (!abs.startsWith(path.resolve(root))) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
    res.download(abs, r.rows[0].original_name);
  } catch (e) {
    console.error('Download frozen design file error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/frozen-designs/:id/release  (admin)
router.post('/:id/release', adminMiddleware, async (req, res) => {
  try {
    const ok = await fd.manualRelease(pool, { id: req.params.id, userId: req.user?.id });
    if (!ok) return res.status(404).json({ error: 'Active frozen design not found' });
    res.json({ message: 'Released' });
  } catch (e) {
    console.error('Release frozen design error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify it parses**

Run: `node -e "require('./server/routes/frozen-designs.cjs'); console.log('router OK')"`
Expected: prints `router OK`.

- [ ] **Step 3: Commit**

```bash
git add server/routes/frozen-designs.cjs
git commit -m "feat(frozen): add frozen-designs router"
```

### Task 8: Mount router in index.cjs

**Files:**
- Modify: `server/index.cjs` (require block ~line 28; mount block ~line 94)

- [ ] **Step 1: Add the require**

After the `autoBackupsRouter` require (~line 27), add:

```javascript
const frozenDesignsRouter = require('./routes/frozen-designs.cjs');
```

- [ ] **Step 2: Mount with auth + page access**

After the `backup-requests` mount (~line 94), add:

```javascript
app.use('/api/frozen-designs', authMiddleware, pageAccessMiddleware('frozen-designs'), frozenDesignsRouter);
```

- [ ] **Step 3: Verify server module loads**

Run: `node -e "process.env.JWT_SECRET='x'; require('./server/index.cjs'); setTimeout(()=>process.exit(0), 200)" 2>&1 | head -5`
Expected: no `Cannot find module` / syntax errors (it may log a DB connection attempt — that's fine; we only check the module loads).

- [ ] **Step 4: Commit**

```bash
git add server/index.cjs
git commit -m "feat(frozen): mount frozen-designs router"
```

### Task 9: Freeze-on-approval and link/bypass fields in orders.cjs

**Files:**
- Modify: `server/routes/orders.cjs` (PATCH `/:id` workflow handler near line 392; POST `/` create near line 227–283; PUT `/:id` near line 402–462)

- [ ] **Step 1: Require the service at top of orders.cjs**

Near the other requires at the top of `server/routes/orders.cjs`, add:

```javascript
const fdService = require('../services/frozenDesigns.cjs');
```

- [ ] **Step 2: Freeze on the design-approval PATCH**

In the PATCH `/:id` handler, just before `await autoUpdateBackupRequests(...)` (~line 392), add:

```javascript
        // Freeze design when the approval action requested it.
        if (req.body && req.body.freeze_design) {
            const row = await pool.query('SELECT die_no, plant, press, cavity FROM die_orders WHERE id = $1', [req.params.id]);
            if (row.rowCount > 0) {
                const o = row.rows[0];
                const profile = fdService.extractProfileFromDie(o.die_no);
                if (fdService.hasFullKey({ profile, plant: o.plant, press: o.press, cavity: o.cavity })) {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        const newId = await fdService.freezeDesign(client, {
                            profile, plant: o.plant, press: o.press, cavity: o.cavity,
                            sourceOrderId: Number(req.params.id), frozenBy: req.user?.id,
                            notes: req.body.freeze_notes || null,
                        });
                        await client.query('COMMIT');
                        res.locals.frozenDesignId = newId;
                    } catch (fe) {
                        await client.query('ROLLBACK');
                        console.error('Freeze on approval error:', fe);
                    } finally {
                        client.release();
                    }
                }
            }
        }
```

Then change the success response (`res.json({ message: 'Order updated' });`) to:

```javascript
        res.json({ message: 'Order updated', frozenDesignId: res.locals.frozenDesignId || null });
```

- [ ] **Step 3: Persist link/bypass columns on create (POST `/`)**

In the POST `/` `INSERT INTO die_orders (...)` statement, append the four columns to the column list and corresponding `$N` placeholders, and add their values to the params array (after `design_to_ems_date`, before `created_by`). Concretely, extend the column list with:

```
                frozen_design_id, frozen_design_action,
                frozen_design_override_reason, frozen_design_override_note,
```

bump `created_by` to the next placeholder, and add these to the values array (immediately after the `sanitizeDate(order['Design to EMS Date'])` value):

```javascript
            order['frozenDesignId'] || null,
            sanitizeString(order['frozenDesignAction']),
            sanitizeString(order['frozenDesignOverrideReason']),
            sanitizeString(order['frozenDesignOverrideNote']),
```

Renumber the `VALUES ($1...$N)` list to include the four new placeholders before `created_by`.

- [ ] **Step 4: Persist link/bypass columns on PUT `/:id`**

In the PUT `/:id` `UPDATE die_orders SET ...` statement, add before `updated_at = CURRENT_TIMESTAMP`:

```
                frozen_design_id = $38, frozen_design_action = $39,
                frozen_design_override_reason = $40, frozen_design_override_note = $41,
```

shift the `WHERE id = $38` to `WHERE id = $42`, and add the four values before `id` in the params array:

```javascript
            order['frozenDesignId'] || null,
            sanitizeString(order['frozenDesignAction']),
            sanitizeString(order['frozenDesignOverrideReason']),
            sanitizeString(order['frozenDesignOverrideNote']),
```

- [ ] **Step 5: Verify parse**

Run: `node -e "require('./server/routes/orders.cjs'); console.log('orders OK')"`
Expected: prints `orders OK`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/orders.cjs
git commit -m "feat(frozen): freeze on approval and persist link/bypass on orders"
```

### Task 10: Link/bypass fields in backup-requests.cjs

**Files:**
- Modify: `server/routes/backup-requests.cjs` (POST create ~line 103–113; PUT update ~line 148–159)

- [ ] **Step 1: Add columns on create**

In the `INSERT INTO backup_die_requests (...)` column list, append:

```
                frozen_design_id, frozen_design_action,
                frozen_design_override_reason, frozen_design_override_note
```

add the matching `$N` placeholders, and push values:

```javascript
            data['frozenDesignId'] || null,
            data['frozenDesignAction'] || null,
            data['frozenDesignOverrideReason'] || null,
            data['frozenDesignOverrideNote'] || null,
```

- [ ] **Step 2: Add columns on update**

In the `UPDATE backup_die_requests SET ...` statement, add the four `col = $N` assignments before the `WHERE id = ...`, renumber the WHERE placeholder, and push the same four values before the id.

- [ ] **Step 3: Verify parse**

Run: `node -e "require('./server/routes/backup-requests.cjs'); console.log('backup OK')"`
Expected: prints `backup OK`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/backup-requests.cjs
git commit -m "feat(frozen): persist link/bypass fields on backup requests"
```

---

## Phase 5 — Docker / Storage Volume

### Task 11: Wire the storage volume and env

**Files:**
- Modify: `docker-compose.yml`, `Dockerfile.backend`

- [ ] **Step 1: Read current compose backend service**

Run: `cat docker-compose.yml`
Identify the backend service name and its `volumes:` / `environment:` blocks and the top-level `volumes:` list.

- [ ] **Step 2: Add a named volume and env var**

In `docker-compose.yml`, under the backend service add to `environment:`:

```yaml
      - FROZEN_DESIGNS_ROOT=/app/storage/frozen-designs
```

add to that service's `volumes:`:

```yaml
      - frozen_designs_data:/app/storage/frozen-designs
```

and add to the top-level `volumes:` map:

```yaml
  frozen_designs_data:
```

- [ ] **Step 3: Ensure the directory exists in the image**

In `Dockerfile.backend`, before the `CMD`/entrypoint, add:

```dockerfile
RUN mkdir -p /app/storage/frozen-designs
```

- [ ] **Step 4: Validate compose syntax**

Run: `docker compose config >/dev/null && echo "compose OK"`
Expected: prints `compose OK` (requires Docker available; if Docker is not installed in this environment, visually confirm YAML indentation instead).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml Dockerfile.backend
git commit -m "chore(frozen): add storage volume and FROZEN_DESIGNS_ROOT"
```

---

## Phase 6 — Frontend

### Task 12: API client + constants

**Files:**
- Modify: `src/api.js` (after `profilesAPI`, before/after other API objects)
- Modify: `src/utils/constants.js`

- [ ] **Step 1: Add frozenDesignsAPI**

In `src/api.js`, add (uses the existing `apiRequest` helper and `API_BASE`/token pattern already in the file — match how other `*API` objects build URLs and headers):

```javascript
// Frozen / Final Designs API
export const frozenDesignsAPI = {
    list: async (params = {}) => {
        const qs = new URLSearchParams(params).toString();
        return apiRequest(`/frozen-designs${qs ? `?${qs}` : ''}`);
    },
    match: async ({ profile, plant, press, cavity }) => {
        const qs = new URLSearchParams({ profile: profile ?? '', plant: plant ?? '', press: press ?? '', cavity: cavity ?? '' }).toString();
        return apiRequest(`/frozen-designs/match?${qs}`);
    },
    create: async (payload) => {
        return apiRequest('/frozen-designs', { method: 'POST', body: JSON.stringify(payload) });
    },
    uploadFiles: async (id, fileList) => {
        const form = new FormData();
        Array.from(fileList).forEach(f => form.append('files', f));
        // apiRequest sets JSON headers; for multipart we call fetch directly with auth.
        return apiRequest(`/frozen-designs/${id}/files`, { method: 'POST', body: form, isMultipart: true });
    },
    fileUrl: (fileId) => `${API_BASE}/frozen-designs/files/${fileId}`,
    release: async (id) => {
        return apiRequest(`/frozen-designs/${id}/release`, { method: 'POST' });
    },
};
```

- [ ] **Step 2: Make apiRequest support multipart**

Inspect the existing `apiRequest` in `src/api.js`. It currently sets `'Content-Type': 'application/json'`. Update it so that when `options.isMultipart` is true it does NOT set `Content-Type` (lets the browser set the multipart boundary) and passes `body` through unchanged. Keep the `Authorization` header logic identical. Example shape:

```javascript
const headers = { ...(options.isMultipart ? {} : { 'Content-Type': 'application/json' }), ...authHeader };
```

(Adapt to the actual variable names in the file — do not change auth/token behavior.)

- [ ] **Step 3: Add page + bypass presets to constants**

In `src/utils/constants.js`, add to `CONTROLLABLE_PAGES` (after the `backup-requests` entry):

```javascript
  { id: 'frozen-designs', label: 'Frozen Designs' },
```

and add a new export:

```javascript
export const BYPASS_REASONS = ['Profile revised', 'Customer change', 'Quality issue', 'Other'];
```

- [ ] **Step 4: Verify lint/build**

Run: `npm run lint`
Expected: no new errors in `src/api.js` or `src/utils/constants.js`.

- [ ] **Step 5: Commit**

```bash
git add src/api.js src/utils/constants.js
git commit -m "feat(frozen): add frozenDesignsAPI client and constants"
```

### Task 13: FrozenDesignBanner component

**Files:**
- Create: `src/components/FrozenDesignBanner.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/FrozenDesignBanner.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
import { frozenDesignsAPI } from '../api';
import { BYPASS_REASONS } from '../utils/constants';

// Props: { profile, plant, press, cavity, onRelease(match), onBypass({reason, note, match}) }
// Fires a /match lookup when the full key is present; renders nothing when no match.
export default function FrozenDesignBanner({ profile, plant, press, cavity, onRelease, onBypass }) {
  const [match, setMatch] = useState(null);
  const [mode, setMode] = useState(null); // null | 'bypass'
  const [reason, setReason] = useState(BYPASS_REASONS[0]);
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    const full = profile && plant && press && (cavity !== '' && cavity !== null && cavity !== undefined);
    if (!full) { setMatch(null); return; }
    frozenDesignsAPI.match({ profile, plant, press, cavity })
      .then(r => { if (!cancelled) setMatch(r); })
      .catch(() => { if (!cancelled) setMatch(null); });
    return () => { cancelled = true; };
  }, [profile, plant, press, cavity]);

  if (!match) return null;

  const noteRequired = reason === 'Other';
  const canBypass = !noteRequired || note.trim().length > 0;

  return (
    <div style={{ border: '1px solid #F59E0B', background: '#FFFBEB', borderRadius: 8, padding: 12, margin: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: '#92400E' }}>
        <AlertTriangle size={18} /> Frozen Design Available
      </div>
      <div style={{ fontSize: '0.85rem', color: '#78350F', marginTop: 4 }}>
        A finalized design exists for {profile} / {press} / cavity {cavity}. Frozen on {match.frozen_at ? new Date(match.frozen_at).toLocaleDateString() : '—'}.
      </div>
      {Array.isArray(match.files) && match.files.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {match.files.map(f => (
            <a key={f.id} href={frozenDesignsAPI.fileUrl(f.id)} target="_blank" rel="noreferrer"
               style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#1D4ED8' }}>
              <FileText size={14} /> {f.original_name}
            </a>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => onRelease && onRelease(match)}
          style={{ background: '#16A34A', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>
          Release Frozen Design
        </button>
        <button type="button" onClick={() => setMode(mode === 'bypass' ? null : 'bypass')}
          style={{ background: '#fff', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>
          Proceed with normal flow
        </button>
      </div>
      {mode === 'bypass' && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.8rem', color: '#78350F' }}>Reason (required)</label>
          <select value={reason} onChange={e => setReason(e.target.value)}>
            {BYPASS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <textarea placeholder={noteRequired ? 'Note required for "Other"' : 'Optional note'}
            value={note} onChange={e => setNote(e.target.value)} rows={2} />
          <button type="button" disabled={!canBypass}
            onClick={() => onBypass && onBypass({ reason, note: note.trim(), match })}
            style={{ alignSelf: 'flex-start', background: canBypass ? '#92400E' : '#D1D5DB', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: canBypass ? 'pointer' : 'not-allowed' }}>
            Confirm normal flow
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: no new errors in `src/components/FrozenDesignBanner.jsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/FrozenDesignBanner.jsx
git commit -m "feat(frozen): add FrozenDesignBanner component"
```

### Task 14: Frozen Designs page + sidebar wiring

**Files:**
- Create: `src/pages/FrozenDesignsPage.jsx`
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Create the page**

Create `src/pages/FrozenDesignsPage.jsx`:

```jsx
import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Unlock } from 'lucide-react';
import { frozenDesignsAPI } from '../api';

export default function FrozenDesignsPage({ user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    setLoading(true);
    frozenDesignsAPI.list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const release = async (id) => {
    if (!window.confirm('Release (unfreeze) this design? Future orders will no longer be flagged.')) return;
    await frozenDesignsAPI.release(id);
    load();
  };

  const statusLabel = (r) => r.is_active ? 'Active' : (r.release_reason === 'superseded' ? 'Superseded' : 'Released');

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>Frozen Designs</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>
            <th>Profile</th><th>Plant</th><th>Press</th><th>Cavity</th>
            <th>Status</th><th>Frozen At</th><th>Files</th>
            <th>Released ×N</th><th>Bypassed ×N</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
              <td>{r.profile_number}</td><td>{r.plant}</td><td>{r.press}</td><td>{r.cavity}</td>
              <td>{statusLabel(r)}</td>
              <td>{r.frozen_at ? new Date(r.frozen_at).toLocaleDateString() : '—'}</td>
              <td>
                {(r.files || []).map(f => (
                  <a key={f.id} href={frozenDesignsAPI.fileUrl(f.id)} target="_blank" rel="noreferrer"
                     style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, color: '#1D4ED8' }}>
                    <FileText size={13} /> {f.original_name}
                  </a>
                ))}
              </td>
              <td>Released ×{r.released_count}</td>
              <td>Bypassed ×{r.bypassed_count}</td>
              <td>
                {isAdmin && r.is_active && (
                  <button onClick={() => release(r.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid #DC2626', color: '#DC2626', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                    <Unlock size={13} /> Release
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={10} style={{ padding: 16, color: '#6B7280' }}>No frozen designs yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Import and wire the page in DieOrderingSystem.jsx**

Add the import near the other page imports:

```javascript
import FrozenDesignsPage from './pages/FrozenDesignsPage';
```

Add a render branch alongside the other `activeTab === '...'` branches (mirror the `backup-requests` branch ~line 2787):

```jsx
          {activeTab === 'frozen-designs' && hasPageAccess('frozen-designs') && (
            <FrozenDesignsPage user={user} />
          )}
```

- [ ] **Step 3: Add the sidebar nav entry**

Locate the sidebar/nav definition that renders the `backup-requests` link (search `backup-requests` in `DieOrderingSystem.jsx` and in `src/components/layout`). Add a sibling entry with `id: 'frozen-designs'`, label `Frozen Designs`, and an icon (e.g. `Snowflake` from lucide-react — add to the lucide import). Match the existing nav item structure exactly.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds; the new page compiles.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FrozenDesignsPage.jsx src/DieOrderingSystem.jsx
git commit -m "feat(frozen): add Frozen Designs page and sidebar entry"
```

### Task 15: Freeze checkbox at design approval

**Files:**
- Modify: `src/DieOrderingSystem.jsx` (the design-approval completion UI / workflow action)

- [ ] **Step 1: Locate the approval action**

Search `DieOrderingSystem.jsx` for `PENDING FOR DESIGN APPROVAL` and the workflow-completion handler that PATCHes the order with the next status. Identify the modal/confirm UI shown for `WORKFLOW_STEPS['PENDING FOR DESIGN APPROVAL']` (`completionLabel: 'Approve Design'`).

- [ ] **Step 2: Add the checkbox state + UI**

In that approval UI, add a checkbox bound to local state `freezeDesign`:

```jsx
<label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
  <input type="checkbox" checked={freezeDesign} onChange={e => setFreezeDesign(e.target.checked)} />
  Mark design as Frozen / Final
</label>
```

- [ ] **Step 3: Send freeze_design and capture id**

In the handler that PATCHes the approval transition, include `freeze_design: freezeDesign` in the request body. On success, read `frozenDesignId` from the response; if present and `freezeDesign` is true, open a file-upload modal (a simple `<input type="file" multiple>` that calls `frozenDesignsAPI.uploadFiles(frozenDesignId, files)`).

```javascript
const resp = await ordersAPI.update(orderId, { ...patchBody, freeze_design: freezeDesign });
if (freezeDesign && resp?.frozenDesignId) {
  setFreezeUploadTarget(resp.frozenDesignId); // opens the upload modal
}
```

(Use the actual order-update API method name present in `src/api.js`; match the existing workflow PATCH call.)

- [ ] **Step 4: Add the upload modal**

Add a minimal modal driven by `freezeUploadTarget`:

```jsx
{freezeUploadTarget && (
  <div className="modal-overlay">
    <div className="modal">
      <h3>Upload Final Design Files</h3>
      <input type="file" multiple onChange={async (e) => {
        if (e.target.files?.length) {
          await frozenDesignsAPI.uploadFiles(freezeUploadTarget, e.target.files);
        }
      }} />
      <button onClick={() => setFreezeUploadTarget(null)}>Done</button>
    </div>
  </div>
)}
```

(Reuse the project's existing modal styling/classes instead of literal class names if they differ.)

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/DieOrderingSystem.jsx
git commit -m "feat(frozen): add freeze checkbox and file upload at design approval"
```

### Task 16: Banner in add-order and backup-request forms

**Files:**
- Modify: `src/DieOrderingSystem.jsx` (add-order form)
- Modify: `src/components/backup/BackupDieRequests.jsx` (add form)

- [ ] **Step 1: Add banner to the add-order form**

In the add-order form within `DieOrderingSystem.jsx`, import `FrozenDesignBanner` and `extractProfileFromDie`, and render it where the user has entered Die No / Plant / Press / Cavity:

```jsx
<FrozenDesignBanner
  profile={extractProfileFromDie(form['DIE NO'])}
  plant={form['Plant']}
  press={form['Press']}
  cavity={form['Cavity']}
  onRelease={() => {
    const today = new Date().toISOString().slice(0, 10);
    setForm(f => ({
      ...f,
      'Design Received Date': today,
      'Design Approved Date': today,
      'STATUS': 'PENDING FOR PR',
      frozenDesignId: bannerMatchId,           // capture match.id via onRelease(match)
      frozenDesignAction: 'released',
    }));
  }}
  onBypass={({ reason, note, match }) => {
    setForm(f => ({
      ...f,
      frozenDesignId: match.id,
      frozenDesignAction: 'bypassed',
      frozenDesignOverrideReason: reason,
      frozenDesignOverrideNote: note,
    }));
  }}
/>
```

Adjust `onRelease` to receive the match (`onRelease={(match) => ...}`) so `frozenDesignId: match.id`. The form field keys (`'DIE NO'`, `'Plant'`, `'Press'`, `'Cavity'`, `'STATUS'`) must match the existing add-order form state keys — verify against the current form object.

- [ ] **Step 2: Add banner to BackupDieRequests add form**

In `src/components/backup/BackupDieRequests.jsx`, import `FrozenDesignBanner`, and inside the add-request form render it using the form's profile/plant/press/cavity (the file already imports `extractProfileFromDie`). On `onRelease`/`onBypass`, set `frozenDesignId`, `frozenDesignAction`, and (for bypass) `frozenDesignOverrideReason`/`frozenDesignOverrideNote` into the backup form state so they post with the request. Backup requests have no design-stage statuses, so release here just records the link/action (no status jump) — confirm desired behavior with existing backup status options (`Pending`/`Completed`).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/DieOrderingSystem.jsx src/components/backup/BackupDieRequests.jsx
git commit -m "feat(frozen): show frozen-design banner in order and backup forms"
```

---

## Phase 7 — Integration Verification

### Task 17: End-to-end manual verification

**Files:** none (manual)

- [ ] **Step 1: Start the stack**

Run: `npm run docker:rebuild` (or `docker compose up -d --build`)
Expected: backend + db + frontend start; check `npm run docker:ps`.

- [ ] **Step 2: Run the backend test suite once more**

Run: `npm test`
Expected: all service tests PASS.

- [ ] **Step 3: Freeze a design**

In the UI: take an order to `PENDING FOR DESIGN APPROVAL`, click Approve Design with "Mark design as Frozen / Final" checked, upload a PDF.
Expected: order moves to `PENDING FOR PR`; a row appears on the Frozen Designs page with the file linked and `Released ×0`.

- [ ] **Step 4: Release onto a new order**

Create a new order with the same Profile+Plant+Press+Cavity.
Expected: the ⚠️ Frozen Design Available banner appears with the file link. Click "Release Frozen Design" → Design Received/Approved dates default to today and status is `PENDING FOR PR`. Save. The Frozen Designs page now shows `Released ×1`.

- [ ] **Step 5: Bypass with reason**

Create another new order for the same key, click "Proceed with normal flow", pick a reason (try "Other" → confirm note is required), confirm.
Expected: order follows the normal flow (not jumped to PR); Frozen Designs page shows `Bypassed ×1`.

- [ ] **Step 6: Supersede + admin release**

Freeze a new design for the same key (approve another order with the checkbox).
Expected: old row becomes `Superseded`, new row `Active`. As an admin, click Release on the active row → it becomes `Released` and the banner no longer appears for new orders of that key.

- [ ] **Step 7: Final commit (docs)**

```bash
git add docs/superpowers/plans/2026-06-18-frozen-design.md
git commit -m "docs(frozen): add implementation plan"
```

---

## Self-Review Notes

- **Spec coverage:** §2 match key → Tasks 3, 13, 16. §3 data model → Tasks 1, 9, 10. §4 supersession → Task 4. §5 permissions (admin release / approver freeze) → Tasks 7, 9, 14. §6 API/storage → Tasks 2, 7, 8, 11. §7 frontend → Tasks 12–16. §8 release vs bypass behavior → Tasks 9, 16. Released/Bypassed ×N → Task 5 (derive) + Task 14 (display). §9 edge cases (incomplete key, edit-mode info-only, active-only match) → Tasks 3, 13 (banner only renders on full key; banner used in add forms only). §10 testing → Tasks 2–5, 17.
- **Edit-mode info-only:** banner is rendered only inside the *add* forms (Tasks 14/16), satisfying "no auto-release on edit" by construction.
- **Type consistency:** service exports (`extractProfileFromDie`, `hasFullKey`, `findActiveMatch`, `freezeDesign`, `listFrozenDesigns`, `manualRelease`) are referenced consistently in Tasks 7 and 9. Client fields (`frozenDesignId`, `frozenDesignAction`, `frozenDesignOverrideReason`, `frozenDesignOverrideNote`) match the columns persisted in Tasks 9–10.
