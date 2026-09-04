# Sample Trial Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record each die trial as its own row — date, OK/Not OK result, a failure reason when it failed, and a comment — replacing the single hand-typed trial count on Sample Followup.

**Architecture:** A new `sample_trials` table holds one row per trial, hanging off either `die_orders` or `sample_followups` (Sample Followup rows are a merge of both). Pure rules — the reason vocabulary, the reason-matches-result rule, the no-future-dates rule, trial numbering — live in `server/services/sampleTrials.cjs` and are unit-tested against a fake pg client, following `qdFocRounds.cjs`. The route stays thin. The frontend adds a Trials section to the record modal the eye icon already opens, and the `No. of Trial` column becomes derived.

**Tech Stack:** Node + Express (CommonJS `.cjs` under `server/`), PostgreSQL, React 18 with inline style objects (ESM under `src/`), `node:test` for tests, `xlsx` for exports.

**Spec:** `docs/superpowers/specs/2026-09-04-sample-trial-recording-design.md`

## Global Constraints

- **Failure reasons, exact strings, in this order:** `Shape`, `Dimension Out of Spec`, `Aesthetic Out of Spec`, `Die Choked`, `Manufacturing issue`, `Other`. These are stored values — a typo becomes a data migration.
- **Results, exact strings:** `OK`, `Not OK`.
- **`server/` is CommonJS (`.cjs`); `src/` is ESM** — `package.json` has `"type": "module"`.
- **Tests:** `npm test` runs `node --test "server/**/*.test.cjs" "src/**/*.test.js"`. No Jest, no Vitest, no React component test framework.
- **Do not run `npm run build:check`.** `npm run lint` fails on 77 pre-existing problems on a clean `main`, and `build:check` is `lint && build`, so it never reaches the build. Verify frontend work with `npx eslint <your changed files>` plus `npm run build` separately.
- **Schema changes go in two places:** an idempotent block in `server/db.cjs` (applied to existing databases at boot) and mirrored in `init.sql` (fresh installs). Both, every time.
- **A trial is never invented.** No task backfills trial rows from the existing `no_of_trial` numbers.
- **Never write `no_of_trial` from the UI after Task 6.** The column stays in the database as legacy data.
- **Local Docker stack is a TEST server.** Never present counts from it as facts about real data. Restarting a container does not pick up source edits — use `docker compose build <svc> && docker compose up -d <svc>`.
- **Never run an unscoped `DELETE FROM`.** Delete only rows you created, by id.

---

### Task 1: Trial rules service (pure logic)

The vocabulary and the validation rules, with no database involved. Everything later depends on these exact names.

**Files:**
- Create: `server/services/sampleTrials.cjs`
- Test: `server/services/sampleTrials.test.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TRIAL_RESULTS: string[]` — `['OK', 'Not OK']`
  - `FAIL_REASONS: string[]` — the six reasons in Global Constraints
  - `normaliseDate(value): string | null` — `'YYYY-MM-DD'` or null
  - `validateTrial(input, today): { ok: true, value } | { ok: false, error: string }` where `input` is `{ trial_date, result, fail_reason, comments }`, `today` is a `'YYYY-MM-DD'` string, and `value` is `{ trial_date, result, fail_reason, comments }` with `fail_reason` forced to `null` on an OK trial and `comments` forced to `null` when blank
  - `nextTrialNo(trials): number` — max `trial_no` + 1, or 1 for an empty list

- [ ] **Step 1: Write the failing test**

Create `server/services/sampleTrials.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const trials = require('./sampleTrials.cjs');

const TODAY = '2026-09-04';
const ok = (over = {}) => ({ trial_date: '2026-09-01', result: 'OK', fail_reason: null, comments: '', ...over });

test('a Not OK trial without a reason is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: null }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /reason/i);
});

test('an OK trial carrying a reason has it dropped, not stored', () => {
  const r = trials.validateTrial(ok({ result: 'OK', fail_reason: 'Shape' }), TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.value.fail_reason, null);
});

test('a reason outside the fixed list is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: 'Gremlins' }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /reason/i);
});

test('every listed reason is accepted on a Not OK trial', () => {
  for (const reason of trials.FAIL_REASONS) {
    const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: reason }), TODAY);
    assert.equal(r.ok, true, `${reason} should be accepted`);
    assert.equal(r.value.fail_reason, reason);
  }
});

test('the reason list is exactly the agreed vocabulary, in order', () => {
  assert.deepEqual(trials.FAIL_REASONS, [
    'Shape', 'Dimension Out of Spec', 'Aesthetic Out of Spec',
    'Die Choked', 'Manufacturing issue', 'Other',
  ]);
});

test('a result outside OK / Not OK is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Maybe' }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /result/i);
});

test('a future trial date is rejected but today is accepted', () => {
  assert.equal(trials.validateTrial(ok({ trial_date: '2026-09-05' }), TODAY).ok, false);
  assert.equal(trials.validateTrial(ok({ trial_date: TODAY }), TODAY).ok, true);
});

test('a missing or unparseable trial date is rejected', () => {
  assert.equal(trials.validateTrial(ok({ trial_date: '' }), TODAY).ok, false);
  assert.equal(trials.validateTrial(ok({ trial_date: 'last tuesday' }), TODAY).ok, false);
});

test('DD/MM/YYYY dates are normalised to ISO', () => {
  assert.equal(trials.normaliseDate('01/09/2026'), '2026-09-01');
  assert.equal(trials.normaliseDate('2026-09-01T10:30:00Z'), '2026-09-01');
  assert.equal(trials.normaliseDate(''), null);
});

test('blank comments are stored as null, real ones are trimmed', () => {
  assert.equal(trials.validateTrial(ok({ comments: '   ' }), TODAY).value.comments, null);
  assert.equal(trials.validateTrial(ok({ comments: '  ran short  ' }), TODAY).value.comments, 'ran short');
});

test('next trial number is max + 1, and 1 for a die with no trials', () => {
  assert.equal(trials.nextTrialNo([]), 1);
  assert.equal(trials.nextTrialNo([{ trial_no: 1 }, { trial_no: 3 }]), 4);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --test-name-pattern="trial"
```

Expected: FAIL — `Cannot find module './sampleTrials.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `server/services/sampleTrials.cjs`:

```js
'use strict';

// One row per trial of a die sample.
//
// Sample Followup used to carry a single hand-typed `no_of_trial` integer. That
// number could not say when a trial ran, whether it passed, or why it failed —
// so the reason a die needed five trials lived only in somebody's memory. Each
// trial is its own row here for the same reason FOC rounds are their own rows
// in qdFocRounds.cjs: the history is the evidence.
//
// This module owns the vocabulary and the rules. It never decides Sample
// Status — a failed trial does not reject a sample; a person does.

const TRIAL_RESULTS = ['OK', 'Not OK'];

// Fixed, and stored verbatim in the fail_reason column. Changing a string here
// is a data migration, not an edit. `Other` exists so a novel failure is never
// mis-filed under a reason that does not fit; the explanation goes in comments.
const FAIL_REASONS = [
  'Shape',
  'Dimension Out of Spec',
  'Aesthetic Out of Spec',
  'Die Choked',
  'Manufacturing issue',
  'Other',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Accepts ISO, ISO-with-time, and DD/MM/YYYY — the three shapes that reach this
// app, since older followup dates were imported from spreadsheets.
function normaliseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (iso) return iso[1];
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

const trim = (v) => (v === null || v === undefined ? '' : String(v).trim());

// `today` is an ISO day string so the caller decides what "today" means and the
// rule stays testable. ISO dates compare correctly as strings.
function validateTrial(input = {}, today) {
  const trial_date = normaliseDate(input.trial_date);
  if (!trial_date) return { ok: false, error: 'A valid trial date is required' };
  if (today && trial_date > today) {
    return { ok: false, error: 'Trial date cannot be in the future' };
  }

  const result = trim(input.result);
  if (!TRIAL_RESULTS.includes(result)) {
    return { ok: false, error: `Result must be one of: ${TRIAL_RESULTS.join(', ')}` };
  }

  // A reason is required precisely when the trial failed, and meaningless when
  // it passed — so an OK trial silently drops any reason rather than erroring,
  // which is what happens when someone picks Not OK, chooses a reason, then
  // switches back to OK.
  let fail_reason = null;
  if (result === 'Not OK') {
    fail_reason = trim(input.fail_reason);
    if (!fail_reason) return { ok: false, error: 'A reason is required when the result is Not OK' };
    if (!FAIL_REASONS.includes(fail_reason)) {
      return { ok: false, error: `Reason must be one of: ${FAIL_REASONS.join(', ')}` };
    }
  }

  const comments = trim(input.comments).slice(0, 2000) || null;

  return { ok: true, value: { trial_date, result, fail_reason, comments } };
}

function nextTrialNo(trials) {
  return (trials || []).reduce((max, t) => Math.max(max, Number(t.trial_no) || 0), 0) + 1;
}

module.exports = {
  TRIAL_RESULTS, FAIL_REASONS, ISO_DATE,
  normaliseDate, validateTrial, nextTrialNo,
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- --test-name-pattern="trial"
```

Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/sampleTrials.cjs server/services/sampleTrials.test.cjs
git commit -m "feat(sample-trials): trial vocabulary and validation rules"
```

---

### Task 2: Database schema

**Files:**
- Modify: `server/db.cjs` (add after the `sample_followups` block that ends around line 977)
- Modify: `init.sql` (add after the `sample_followups` table, around line 227)

**Interfaces:**
- Consumes: nothing.
- Produces: table `sample_trials` with columns `id, die_order_id, sample_followup_id, trial_no, trial_date, result, fail_reason, comments, created_by, created_at, updated_at`.

- [ ] **Step 1: Add the DDL to `server/db.cjs`**

In `server/db.cjs`, immediately after the line `ALTER TABLE sample_followups ADD COLUMN IF NOT EXISTS plant TEXT;` and before the closing `` `); `` of that template literal, insert:

```sql
      -- One row per trial of a die sample. Two nullable parents because Sample
      -- Followup rows are a merge of two tables: dies that came through the
      -- order flow live in die_orders, records added by hand live in
      -- sample_followups. A generic parent_id + parent_type pair was rejected —
      -- Postgres cannot foreign-key it, so nothing would stop a trial pointing
      -- at a die that no longer exists.
      CREATE TABLE IF NOT EXISTS sample_trials (
        id                 SERIAL PRIMARY KEY,
        die_order_id       INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
        sample_followup_id INTEGER REFERENCES sample_followups(id) ON DELETE CASCADE,
        trial_no           INTEGER NOT NULL,
        trial_date         DATE NOT NULL,
        result             TEXT NOT NULL CHECK (result IN ('OK', 'Not OK')),
        fail_reason        TEXT,
        comments           TEXT,
        created_by         INTEGER REFERENCES users(id),
        created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT sample_trials_one_parent CHECK (
          (die_order_id IS NULL) <> (sample_followup_id IS NULL)
        ),
        CONSTRAINT sample_trials_reason_matches_result CHECK (
          (result = 'Not OK' AND fail_reason IS NOT NULL)
          OR (result = 'OK' AND fail_reason IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_trials_order_no
        ON sample_trials(die_order_id, trial_no) WHERE die_order_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_trials_sf_no
        ON sample_trials(sample_followup_id, trial_no) WHERE sample_followup_id IS NOT NULL;
```

- [ ] **Step 2: Mirror it in `init.sql`**

In `init.sql`, immediately after the `CREATE TABLE IF NOT EXISTS sample_followups (...);` block and before the `-- Seed suppliers` comment, paste the same `CREATE TABLE sample_trials` and the two `CREATE UNIQUE INDEX` statements (without the leading six-space indentation — match the surrounding file's flush-left style).

- [ ] **Step 3: Apply the migration to the local test database**

```bash
docker compose build backend && docker compose up -d backend
```

A plain `docker compose restart` will NOT apply this — the Dockerfile COPYs the source in and `server/` is not bind-mounted, so a restart silently re-runs the old `db.cjs`.

- [ ] **Step 4: Verify the table and both constraints exist**

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "\d sample_trials"
```

Expected: the table prints with both `sample_trials_one_parent` and `sample_trials_reason_matches_result` listed under "Check constraints", and both partial unique indexes listed.

- [ ] **Step 5: Prove the constraints actually reject bad rows**

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "INSERT INTO sample_trials (trial_no, trial_date, result) VALUES (1, '2026-09-01', 'OK');"
```

Expected: FAILS with `new row ... violates check constraint "sample_trials_one_parent"` (no parent set).

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "INSERT INTO sample_trials (sample_followup_id, trial_no, trial_date, result) SELECT id, 1, '2026-09-01', 'Not OK' FROM sample_followups LIMIT 1;"
```

Expected: FAILS with `violates check constraint "sample_trials_reason_matches_result"` (Not OK with no reason). Both statements are expected to fail, so no cleanup is needed — verify with:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) FROM sample_trials;"
```

Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add server/db.cjs init.sql
git commit -m "feat(sample-trials): add sample_trials table"
```

---

### Task 3: Data access and API route

**Files:**
- Modify: `server/services/sampleTrials.cjs`
- Modify: `server/services/sampleTrials.test.cjs`
- Create: `server/routes/sample-trials.cjs`
- Modify: `server/index.cjs` (import near line 28, mount near line 110)
- Modify: `src/api.js` (add after `sampleFollowupsAPI`, around line 722)

**Interfaces:**
- Consumes: `validateTrial`, `nextTrialNo`, `TRIAL_RESULTS`, `FAIL_REASONS` from Task 1; table from Task 2.
- Produces:
  - `parentRef(input): { column: 'die_order_id' | 'sample_followup_id', id: number } | null`
  - `listTrials(client): Promise<row[]>`
  - `createTrial(client, input, userId, today): Promise<{ ok: true, row } | { ok: false, error, status }>`
  - `updateTrial(client, id, input, today): Promise<{ ok: true, row } | { ok: false, error, status }>`
  - `deleteTrial(client, id): Promise<boolean>`
  - HTTP: `GET/POST /api/sample-trials`, `PUT/DELETE /api/sample-trials/:id`
  - `sampleTrialsAPI` in `src/api.js` with `getAll()`, `create(data)`, `update(id, data)`, `delete(id)`

- [ ] **Step 1: Write the failing tests**

Append to `server/services/sampleTrials.test.cjs`:

```js
// Minimal stand-in for a pg client, dispatching on the SQL the service writes.
// Same approach as qdFocRounds.test.cjs: exercises the queries without a database.
function fakeClient(seed = []) {
  let nextId = seed.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const rows = seed.map((r) => ({
    die_order_id: null, sample_followup_id: null, fail_reason: null,
    comments: null, created_by: null, ...r,
  }));
  return {
    rows,
    async query(sql, params = []) {
      const s = String(sql);
      if (s.includes('INSERT INTO sample_trials')) {
        const row = {
          id: nextId++, die_order_id: null, sample_followup_id: null,
          trial_no: params[1], trial_date: params[2], result: params[3],
          fail_reason: params[4], comments: params[5], created_by: params[6],
        };
        // Dispatch on the INSERT column list, not the whole statement: the
        // RETURNING clause names both parent columns, so a bare
        // `s.includes('die_order_id')` would always match.
        row[s.includes('(die_order_id,') ? 'die_order_id' : 'sample_followup_id'] = params[0];
        rows.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (s.includes('UPDATE sample_trials')) {
        const row = rows.find((r) => r.id === Number(params[4]));
        if (!row) return { rows: [], rowCount: 0 };
        Object.assign(row, {
          trial_date: params[0], result: params[1], fail_reason: params[2], comments: params[3],
        });
        return { rows: [row], rowCount: 1 };
      }
      if (s.includes('DELETE FROM sample_trials')) {
        const i = rows.findIndex((r) => r.id === Number(params[0]));
        if (i === -1) return { rowCount: 0 };
        rows.splice(i, 1);
        return { rowCount: 1 };
      }
      if (s.includes('FROM sample_trials') && s.includes('WHERE')) {
        const key = s.includes('die_order_id = $1') ? 'die_order_id' : 'sample_followup_id';
        return { rows: rows.filter((r) => r[key] === params[0]).sort((a, b) => a.trial_no - b.trial_no) };
      }
      if (s.includes('FROM sample_trials')) return { rows: [...rows] };
      throw new Error(`unexpected SQL: ${s}`);
    },
  };
}

test('parentRef picks whichever parent is supplied, and rejects none or both', () => {
  assert.deepEqual(trials.parentRef({ die_order_id: 5 }), { column: 'die_order_id', id: 5 });
  assert.deepEqual(trials.parentRef({ sample_followup_id: 9 }), { column: 'sample_followup_id', id: 9 });
  assert.equal(trials.parentRef({}), null);
  assert.equal(trials.parentRef({ die_order_id: 5, sample_followup_id: 9 }), null);
});

test('createTrial numbers trials per parent, starting at 1', async () => {
  const c = fakeClient();
  const a = await trials.createTrial(c, { sample_followup_id: 1, trial_date: '2026-09-01', result: 'OK' }, 3, TODAY);
  const b = await trials.createTrial(c, { sample_followup_id: 1, trial_date: '2026-09-02', result: 'OK' }, 3, TODAY);
  const other = await trials.createTrial(c, { die_order_id: 1, trial_date: '2026-09-02', result: 'OK' }, 3, TODAY);
  assert.equal(a.row.trial_no, 1);
  assert.equal(b.row.trial_no, 2);
  assert.equal(other.row.trial_no, 1, 'a different die starts its own numbering');
});

test('createTrial ignores a client-supplied trial_no', async () => {
  const c = fakeClient();
  const r = await trials.createTrial(c, { sample_followup_id: 1, trial_no: 99, trial_date: '2026-09-01', result: 'OK' }, 3, TODAY);
  assert.equal(r.row.trial_no, 1);
});

test('createTrial rejects a missing parent with a 400', async () => {
  const r = await trials.createTrial(fakeClient(), { trial_date: '2026-09-01', result: 'OK' }, 3, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('createTrial rejects a Not OK trial with no reason', async () => {
  const r = await trials.createTrial(fakeClient(), { sample_followup_id: 1, trial_date: '2026-09-01', result: 'Not OK' }, 3, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('createTrial stores the reason on a Not OK trial', async () => {
  const c = fakeClient();
  const r = await trials.createTrial(c, { sample_followup_id: 1, trial_date: '2026-09-01', result: 'Not OK', fail_reason: 'Die Choked', comments: 'stopped at 3m' }, 3, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.row.fail_reason, 'Die Choked');
  assert.equal(r.row.comments, 'stopped at 3m');
  assert.equal(r.row.created_by, 3);
});

test('updateTrial clears the reason when a failed trial is corrected to OK', async () => {
  const c = fakeClient([{ id: 1, sample_followup_id: 1, trial_no: 1, trial_date: '2026-09-01', result: 'Not OK', fail_reason: 'Shape' }]);
  const r = await trials.updateTrial(c, 1, { trial_date: '2026-09-01', result: 'OK' }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.row.fail_reason, null);
});

test('updateTrial on a missing id reports 404', async () => {
  const r = await trials.updateTrial(fakeClient(), 42, { trial_date: '2026-09-01', result: 'OK' }, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('deleteTrial reports whether a row went', async () => {
  const c = fakeClient([{ id: 1, sample_followup_id: 1, trial_no: 1, trial_date: '2026-09-01', result: 'OK' }]);
  assert.equal(await trials.deleteTrial(c, 1), true);
  assert.equal(await trials.deleteTrial(c, 1), false);
});

test('listTrials returns every trial for the page to group', async () => {
  const c = fakeClient([
    { id: 1, sample_followup_id: 1, trial_no: 1, trial_date: '2026-09-01', result: 'OK' },
    { id: 2, die_order_id: 4, trial_no: 1, trial_date: '2026-09-02', result: 'OK' },
  ]);
  assert.equal((await trials.listTrials(c)).length, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- --test-name-pattern="trial"
```

Expected: FAIL — `trials.parentRef is not a function`.

- [ ] **Step 3: Add the data access to `server/services/sampleTrials.cjs`**

Insert before `module.exports`:

```js
const TRIAL_COLS = [
  'id', 'die_order_id', 'sample_followup_id', 'trial_no',
  'trial_date', 'result', 'fail_reason', 'comments', 'created_by', 'created_at',
].join(', ');

// Exactly one parent, matching the sample_trials_one_parent check constraint.
// Returning null rather than throwing keeps the route's error handling in one
// place.
function parentRef(input = {}) {
  const order = Number(input.die_order_id) || null;
  const followup = Number(input.sample_followup_id) || null;
  if (order && followup) return null;
  if (order) return { column: 'die_order_id', id: order };
  if (followup) return { column: 'sample_followup_id', id: followup };
  return null;
}

async function listTrials(client) {
  const { rows } = await client.query(
    `SELECT ${TRIAL_COLS} FROM sample_trials ORDER BY trial_no ASC, id ASC`
  );
  return rows;
}

async function trialsForParent(client, parent) {
  const { rows } = await client.query(
    `SELECT ${TRIAL_COLS} FROM sample_trials WHERE ${parent.column} = $1 ORDER BY trial_no ASC`,
    [parent.id]
  );
  return rows;
}

async function createTrial(client, input, userId, today) {
  const parent = parentRef(input);
  if (!parent) {
    return { ok: false, status: 400, error: 'A trial must belong to exactly one die record' };
  }
  const check = validateTrial(input, today);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  // trial_no is assigned here and never accepted from the client, so two people
  // adding a trial at once cannot both claim the same number. The partial
  // unique index is the backstop if they race.
  const existing = await trialsForParent(client, parent);
  const trial_no = nextTrialNo(existing);
  const { trial_date, result, fail_reason, comments } = check.value;

  const { rows } = await client.query(
    `INSERT INTO sample_trials (${parent.column}, trial_no, trial_date, result, fail_reason, comments, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${TRIAL_COLS}`,
    [parent.id, trial_no, trial_date, result, fail_reason, comments, userId]
  );
  return { ok: true, row: rows[0] };
}

// The parent is never changed by an edit — a trial cannot move to another die.
async function updateTrial(client, id, input, today) {
  const check = validateTrial(input, today);
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  const { trial_date, result, fail_reason, comments } = check.value;

  const { rows, rowCount } = await client.query(
    `UPDATE sample_trials
        SET trial_date = $1, result = $2, fail_reason = $3, comments = $4,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING ${TRIAL_COLS}`,
    [trial_date, result, fail_reason, comments, id]
  );
  if (!rowCount) return { ok: false, status: 404, error: 'Trial not found' };
  return { ok: true, row: rows[0] };
}

async function deleteTrial(client, id) {
  const { rowCount } = await client.query('DELETE FROM sample_trials WHERE id = $1', [id]);
  return rowCount > 0;
}
```

Then replace the `module.exports` block with:

```js
module.exports = {
  TRIAL_RESULTS, FAIL_REASONS, ISO_DATE, TRIAL_COLS,
  normaliseDate, validateTrial, nextTrialNo, trialCountFor,
  parentRef, listTrials, trialsForParent, createTrial, updateTrial, deleteTrial,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- --test-name-pattern="trial"
```

Expected: PASS, all 21 tests.

- [ ] **Step 5: Write the route**

Create `server/routes/sample-trials.cjs`:

```js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');
const svc = require('../services/sampleTrials.cjs');

const router = express.Router();

const today = () => new Date().toISOString().slice(0, 10);

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(e => e.msg)
        });
    }
    next();
};

const idValidation = [param('id').isInt({ min: 1 }).withMessage('Invalid ID')];

const trialValidation = [
    body('trial_date').notEmpty().withMessage('Trial date is required'),
    body('result').isIn(svc.TRIAL_RESULTS).withMessage('Invalid result'),
    body('fail_reason').optional({ nullable: true }),
    body('comments').optional({ nullable: true }).isLength({ max: 2000 }).withMessage('Comment too long'),
];

// Every trial, for the page to group by parent. Sample Followup already fetches
// its standalone rows wholesale; at this volume anything cleverer is not worth
// the complexity.
router.get('/', async (req, res) => {
    try {
        res.json({ sampleTrials: await svc.listTrials(pool) });
    } catch (error) {
        console.error('Get sample trials error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', trialValidation, handleValidationErrors, async (req, res) => {
    try {
        const out = await svc.createTrial(pool, req.body, req.user.id, today());
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.status(201).json({ trial: out.row, message: 'Trial recorded' });
    } catch (error) {
        console.error('Create sample trial error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/:id', idValidation, trialValidation, handleValidationErrors, async (req, res) => {
    try {
        const out = await svc.updateTrial(pool, req.params.id, req.body, today());
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.json({ trial: out.row, message: 'Trial updated' });
    } catch (error) {
        console.error('Update sample trial error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin only. A trial is a record of something that happened, so removing one
// should be deliberate — the same reason followup delete is admin-gated.
router.delete('/:id', idValidation, handleValidationErrors, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only an admin can delete a trial' });
        }
        const gone = await svc.deleteTrial(pool, req.params.id);
        if (!gone) return res.status(404).json({ error: 'Trial not found' });
        res.json({ message: 'Trial deleted' });
    } catch (error) {
        console.error('Delete sample trial error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
```

- [ ] **Step 6: Mount the route in `server/index.cjs`**

Next to the existing `const sampleFollowupsRouter = require('./routes/sample-followups.cjs');` (line 28) add:

```js
const sampleTrialsRouter = require('./routes/sample-trials.cjs');
```

Next to the existing mount on line 110 add:

```js
app.use('/api/sample-trials', authMiddleware, pageAccessMiddleware('flow-sample-followup'), sampleTrialsRouter);
```

Same page-access key as sample followups — trials are part of that page, so anyone who can see the page can see its trials.

- [ ] **Step 7: Add the API client to `src/api.js`**

After the closing brace of `sampleFollowupsAPI`, add:

```js
export const sampleTrialsAPI = {
    getAll: async () => {
        return apiRequest('/sample-trials');
    },

    create: async (data) => {
        return apiRequest('/sample-trials', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    update: async (id, data) => {
        return apiRequest(`/sample-trials/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id) => {
        return apiRequest(`/sample-trials/${id}`, {
            method: 'DELETE',
        });
    },
};
```

- [ ] **Step 8: Verify the endpoint answers**

```bash
docker compose build backend && docker compose up -d backend
```

```bash
docker exec die-ordering-backend node -e "fetch('http://localhost:3001/api/sample-trials').then(r=>console.log(r.status))"
```

Expected: `401` — proving the route is mounted and the auth middleware is in front of it. A `404` means the mount is wrong.

- [ ] **Step 9: Commit**

```bash
git add server/services/sampleTrials.cjs server/services/sampleTrials.test.cjs server/routes/sample-trials.cjs server/index.cjs src/api.js
git commit -m "feat(sample-trials): read and write trials through the API"
```

---

### Task 4: Frontend vocabulary and the derived-count rule

The reason strings must exist in both an ESM constant for the dropdown and the CJS service for the validator — neither module can import the other. A test reads both and fails if they ever drift.

The count rule lives here rather than on the server because only the frontend needs it: the page already holds every trial and every followup in memory, so nothing server-side ever computes this.

**Files:**
- Modify: `src/utils/constants.js` (add near `BYPASS_REASONS`, line 202)
- Create: `src/utils/trials.js`
- Create: `src/utils/trials.test.js`

**Interfaces:**
- Consumes: `FAIL_REASONS`, `TRIAL_RESULTS` from Task 1.
- Produces:
  - `TRIAL_RESULTS: string[]` and `TRIAL_FAIL_REASONS: string[]` exported from `src/utils/constants.js`
  - `trialCountFor(trials, legacyCount): { count: number, isLegacy: boolean }` exported from `src/utils/trials.js`

- [ ] **Step 1: Write the failing test**

Create `src/utils/trials.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { trialCountFor } from './trials.js';

// The dropdown and the validator hold separate copies of this vocabulary — one
// is ESM for Vite, one is CommonJS for the server, and neither can import the
// other. This test is what stops them drifting: a reason added to one and not
// the other would let the UI offer a value the API rejects.
const require = createRequire(import.meta.url);
const server = require('../../server/services/sampleTrials.cjs');
const { TRIAL_FAIL_REASONS, TRIAL_RESULTS } = await import('./constants.js');

test('the frontend reason list matches the backend, exactly and in order', () => {
  assert.deepEqual(TRIAL_FAIL_REASONS, server.FAIL_REASONS);
});

test('the frontend result list matches the backend, exactly and in order', () => {
  assert.deepEqual(TRIAL_RESULTS, server.TRIAL_RESULTS);
});

test('the count prefers logged trials and falls back to the legacy number', () => {
  assert.deepEqual(trialCountFor([{ trial_no: 1 }, { trial_no: 2 }], 7), { count: 2, isLegacy: false });
  assert.deepEqual(trialCountFor([], 7), { count: 7, isLegacy: true });
});

test('a die with neither trials nor a legacy number shows a plain zero', () => {
  assert.deepEqual(trialCountFor([], 0), { count: 0, isLegacy: false });
  assert.deepEqual(trialCountFor([], null), { count: 0, isLegacy: false });
});

test('one logged trial beats a larger legacy number', () => {
  assert.deepEqual(trialCountFor([{ trial_no: 1 }], 9), { count: 1, isLegacy: false });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --test-name-pattern="count|frontend"
```

Expected: FAIL — cannot find module `./trials.js`.

- [ ] **Step 3: Add the constants**

In `src/utils/constants.js`, after the `BYPASS_REASONS` line, add:

```js
// Sample trial vocabulary. Mirrored from server/services/sampleTrials.cjs,
// which is the authority — src/utils/trialVocabulary.test.js fails if the two
// ever drift. These strings are stored in the database; changing one is a data
// migration, not an edit.
export const TRIAL_RESULTS = ['OK', 'Not OK'];
export const TRIAL_FAIL_REASONS = [
  'Shape',
  'Dimension Out of Spec',
  'Aesthetic Out of Spec',
  'Die Choked',
  'Manufacturing issue',
  'Other',
];
```

- [ ] **Step 4: Add the count rule**

Create `src/utils/trials.js`:

```js
// The number shown in the No. of Trial column.
//
// 193 followup records carry a hand-typed count from before trials were logged
// individually — a number with no date, result or reason behind it. Those are
// shown as legacy rather than discarded, and are never turned into fabricated
// trial rows: a row claiming a trial happened on an unknown date is worse than
// no row. The moment a real trial is logged for a die, its legacy number stops
// being shown.
export const trialCountFor = (trials, legacyCount) => {
  const logged = (trials || []).length;
  if (logged > 0) return { count: logged, isLegacy: false };
  const legacy = Number(legacyCount) || 0;
  return { count: legacy, isLegacy: legacy > 0 };
};
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- --test-name-pattern="count|frontend"
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/utils/constants.js src/utils/trials.js src/utils/trials.test.js
git commit -m "feat(sample-trials): share the trial vocabulary and count rule with the frontend"
```

---

### Task 5: Trials section in the record modal

**Files:**
- Create: `src/components/sample/TrialsSection.jsx`
- Modify: `src/pages/SampleFollowupPage.jsx` (import at top; render inside the modal after the Remark block, around line 566)
- Modify: `src/DieOrderingSystem.jsx` (fetch trials near `fetchSampleFollowups`, line ~1753; pass props at line ~3090)

**Interfaces:**
- Consumes: `sampleTrialsAPI` (Task 3), `TRIAL_RESULTS` / `TRIAL_FAIL_REASONS` (Task 4).
- Produces:
  - `<TrialsSection parent={{ die_order_id }|{ sample_followup_id }|null} trials={[]} theme user onChanged={() => {}} setToast />`
  - In `DieOrderingSystem.jsx`: state `sampleTrials`, callback `fetchSampleTrials`, both passed down to `SampleFollowupPage`.

A separate component because `SampleFollowupPage.jsx` is already 577 lines and the trials UI carries its own form state; folding it inline would make the page harder to hold in context.

- [ ] **Step 1: Create the component**

Create `src/components/sample/TrialsSection.jsx`:

```jsx
import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { sampleTrialsAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import { TRIAL_RESULTS, TRIAL_FAIL_REASONS } from '../../utils/constants';
import { formatDate } from '../../utils/helpers';

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = { trial_date: '', result: 'OK', fail_reason: '', comments: '' };

const resultStyle = {
  'OK': { color: '#16A34A', bg: 'rgba(22,163,74,0.15)' },
  'Not OK': { color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
};

// Trials save the moment they are added, not when the record's Save button is
// pressed — they are their own records with their own endpoint. The subtitle
// says so, because two save models in one modal is otherwise a surprise.
export default function TrialsSection({ parent, trials, theme, user, onChanged, setToast }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const input = {
    width: '100%', padding: '8px 10px', background: theme.inputBg || '#0F172A',
    border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px',
    color: theme.text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
  };
  const label = {
    display: 'block', fontSize: '0.7rem', fontWeight: 600, color: theme.textMuted,
    marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  const notify = (message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000);
  };

  const reset = () => { setForm(EMPTY); setAdding(false); };

  const save = async () => {
    if (!form.trial_date) return notify('Trial date is required', 'error');
    if (form.trial_date > today()) return notify('Trial date cannot be in the future', 'error');
    if (form.result === 'Not OK' && !form.fail_reason) {
      return notify('Select a reason for the failed trial', 'error');
    }
    setBusy(true);
    try {
      await sampleTrialsAPI.create({
        ...parent,
        trial_date: form.trial_date,
        result: form.result,
        fail_reason: form.result === 'Not OK' ? form.fail_reason : null,
        comments: form.comments,
      });
      reset();
      await onChanged();
      notify('Trial recorded', 'success');
    } catch (error) {
      notify('Failed to record trial: ' + error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (trial) => {
    const ok = await dialogs.confirm({
      title: `Delete trial ${trial.trial_no}`,
      message: 'This removes the trial permanently. It cannot be undone.',
      confirmLabel: 'Delete trial',
    });
    if (!ok) return;
    try {
      await sampleTrialsAPI.delete(trial.id);
      await onChanged();
      notify('Trial deleted', 'success');
    } catch (error) {
      notify('Failed to delete trial: ' + error.message, 'error');
    }
  };

  const cell = { padding: '8px 10px', fontSize: '0.82rem', color: theme.text, borderTop: `1px solid ${theme.border || '#334155'}` };
  const head = { padding: '8px 10px', fontSize: '0.7rem', fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left' };

  return (
    <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: `1px solid ${theme.border || '#334155'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', gap: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: theme.text, margin: 0 }}>Trials</h3>
          <p style={{ fontSize: '0.75rem', color: theme.textMuted, margin: '2px 0 0' }}>
            Saved as soon as you add them — separately from this record.
          </p>
        </div>
        {parent && !adding && (
          <button
            onClick={() => { setForm({ ...EMPTY, trial_date: today() }); setAdding(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: 'rgba(8,145,178,0.15)', border: '1px solid #0891B2', borderRadius: '8px', color: '#0891B2', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          >
            <Plus size={14} /> Add Trial
          </button>
        )}
      </div>

      {!parent ? (
        <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: 0 }}>
          Save the record first to log trials.
        </p>
      ) : (
        <>
          {trials.length === 0 && !adding && (
            <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: 0 }}>No trials logged yet.</p>
          )}

          {trials.length > 0 && (
            <div style={{ overflowX: 'auto', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...head, width: '40px' }}>#</th>
                    <th style={head}>Date</th>
                    <th style={head}>Result</th>
                    <th style={head}>Reason</th>
                    <th style={head}>Comments</th>
                    <th style={{ ...head, width: '40px' }} />
                  </tr>
                </thead>
                <tbody>
                  {trials.map(t => {
                    const rs = resultStyle[t.result] || resultStyle['OK'];
                    return (
                      <tr key={t.id}>
                        <td style={{ ...cell, fontFamily: 'monospace' }}>{t.trial_no}</td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>{formatDate(t.trial_date)}</td>
                        <td style={cell}>
                          <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 600, background: rs.bg, color: rs.color, whiteSpace: 'nowrap' }}>
                            {t.result}
                          </span>
                        </td>
                        <td style={cell}>{t.fail_reason || '—'}</td>
                        <td style={{ ...cell, color: theme.textMuted }}>{t.comments || '—'}</td>
                        <td style={{ ...cell, textAlign: 'center' }}>
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => remove(t)}
                              title="Delete trial"
                              style={{ padding: '4px', background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#EF4444' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {adding && (
            <div style={{ marginTop: '0.75rem', padding: '1rem', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '10px', background: 'rgba(8,145,178,0.05)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={label} htmlFor="trial-date">Trial Date</label>
                  <input
                    id="trial-date" type="date" style={input}
                    value={form.trial_date}
                    max={today()}
                    onChange={(e) => setForm({ ...form, trial_date: e.target.value })}
                  />
                </div>
                <div>
                  <label style={label} htmlFor="trial-result">Result</label>
                  <select
                    id="trial-result" style={input}
                    value={form.result}
                    onChange={(e) => setForm({ ...form, result: e.target.value, fail_reason: '' })}
                  >
                    {TRIAL_RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                {form.result === 'Not OK' && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={label} htmlFor="trial-reason">Reason</label>
                    <select
                      id="trial-reason" style={input}
                      value={form.fail_reason}
                      onChange={(e) => setForm({ ...form, fail_reason: e.target.value })}
                    >
                      <option value="">Select a reason…</option>
                      {TRIAL_FAIL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={label} htmlFor="trial-comments">Comments</label>
                  <textarea
                    id="trial-comments" rows={2}
                    style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
                    value={form.comments}
                    onChange={(e) => setForm({ ...form, comments: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.75rem' }}>
                <button
                  onClick={reset}
                  style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.textMuted, fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem' }}
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={busy}
                  style={{ padding: '8px 18px', background: '#0891B2', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontSize: '0.82rem', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? 'Saving…' : 'Save Trial'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Fetch trials in `DieOrderingSystem.jsx`**

Add `sampleTrialsAPI` to the existing import from `./api` on line 11.

Next to `const [sampleFollowupsStandalone, setSampleFollowupsStandalone] = useState([]);` (line ~1750) add:

```jsx
  const [sampleTrials, setSampleTrials] = useState([]);
```

Immediately after the `fetchSampleFollowups` callback, add one shaped the same way:

```jsx
  const fetchSampleTrials = useCallback(async () => {
    try {
      const response = await sampleTrialsAPI.getAll();
      setSampleTrials(response.sampleTrials || []);
    } catch (error) {
      console.error('Fetch sample trials error:', error);
    }
  }, []);
```

Call `fetchSampleTrials()` from the same effect that already calls `fetchSampleFollowups()`.

- [ ] **Step 3: Pass the trials down**

In the `<SampleFollowupPage ... />` render (line ~3090), after the `sampleFollowupsStandalone` prop, add:

```jsx
              sampleTrials={sampleTrials}
              fetchSampleTrials={fetchSampleTrials}
```

- [ ] **Step 4: Render the section in the modal**

In `src/pages/SampleFollowupPage.jsx`, add the import:

```jsx
import TrialsSection from '../components/sample/TrialsSection';
```

Add `sampleTrials`, `fetchSampleTrials` to the destructured props.

Above the `return (`, add the helpers that map a followup row to its trials:

```jsx
  // A trial hangs off whichever table its followup came from. `null` means the
  // record has not been saved yet, so there is nothing to attach a trial to.
  const trialParentOf = (sf) => {
    if (!sf) return null;
    if (sf._source === 'order') return { die_order_id: sf._order.id };
    if (sf._source === 'standalone') return { sample_followup_id: sf._raw.id };
    return null;
  };

  const trialsOf = (sf) => {
    const parent = trialParentOf(sf);
    if (!parent) return [];
    const key = parent.die_order_id ? 'die_order_id' : 'sample_followup_id';
    const id = parent.die_order_id || parent.sample_followup_id;
    return (sampleTrials || [])
      .filter(t => t[key] === id)
      .sort((a, b) => a.trial_no - b.trial_no);
  };
```

Inside the modal, immediately after the closing `</div>` of the grid that holds the Remark textarea and before the Cancel/Update button row, add:

```jsx
            <TrialsSection
              parent={trialParentOf(editingSampleFollowup)}
              trials={trialsOf(editingSampleFollowup)}
              theme={theme}
              user={user}
              onChanged={fetchSampleTrials}
              setToast={setToast}
            />
```

- [ ] **Step 5: Verify lint and build**

```bash
npx eslint src/components/sample/TrialsSection.jsx src/pages/SampleFollowupPage.jsx src/DieOrderingSystem.jsx
```

Expected: no errors for these files. Do not run `npm run build:check` — lint fails repo-wide on 77 pre-existing problems.

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/sample/TrialsSection.jsx src/pages/SampleFollowupPage.jsx src/DieOrderingSystem.jsx
git commit -m "feat(sample-trials): log trials from the followup record"
```

---

### Task 6: Derive the trial count

**Files:**
- Modify: `src/pages/SampleFollowupPage.jsx` (the `No. of Trial` cell around line 412; `formToOrderFields` line 46; `formToSfFields` line 63; `EMPTY_FORM` line 80; the modal field list line 500; `handleDeleteSampleFollowup` line 176; `SF_DISPLAY_TO_SNAKE` line 19)

**Interfaces:**
- Consumes: `trialsOf` from Task 5, `trialCountFor` from Task 4.
- Produces: no new exports. `No of Trial` is no longer sent by any write path from this page.

- [ ] **Step 1: Replace the editable cell with derived text**

Add the import at the top of `src/pages/SampleFollowupPage.jsx`:

```jsx
import { trialCountFor } from '../utils/trials';
```

In the table body, replace the whole `<td>` containing the `no_of_trial` number input with:

```jsx
                      <td style={{ ...td, textAlign: 'center' }}>
                        {(() => {
                          const { count, isLegacy } = trialCountFor(trialsOf(sf), sf.no_of_trial);
                          return (
                            <span
                              title={isLegacy ? 'Recorded before trials were logged individually' : 'Counted from the logged trials'}
                              style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: isLegacy ? theme.textMuted : theme.text, fontStyle: isLegacy ? 'italic' : 'normal' }}
                            >
                              {count}
                            </span>
                          );
                        })()}
                      </td>
```

- [ ] **Step 2: Stop writing `no_of_trial` from every path**

Remove the `'No of Trial': form.no_of_trial || 0,` line from `formToOrderFields`.

Remove the `no_of_trial: form.no_of_trial || 0,` line from `formToSfFields`.

Remove `no_of_trial: 0,` from `EMPTY_FORM`.

Remove the `'No of Trial': 'no_of_trial',` entry from `SF_DISPLAY_TO_SNAKE` — nothing saves that field inline any more.

Remove `{ key: 'no_of_trial', label: 'No. of Trial', type: 'number' },` from the modal's field list; the Trials section replaces it.

Remove `no_of_trial: sf.no_of_trial || 0,` from the object literal passed to `setSampleFollowupForm` in the eye-icon click handler.

In `handleDeleteSampleFollowup`, remove `'No of Trial': 0,` from the `ordersAPI.patch` payload, and change the confirmation message from `'Only the sample and trial fields are reset. The underlying die order is kept.'` to:

```js
      message: 'Only the sample fields are reset. Logged trials and the underlying die order are kept.',
```

Clearing the sample fields does not delete trial history — those trials still happened. Deleting the die order itself still cascades them away.

- [ ] **Step 3: Verify lint and build**

```bash
npx eslint src/pages/SampleFollowupPage.jsx
```

Expected: no errors. In particular, no "no_of_trial is not defined" — every reference must be gone or reading `sf.no_of_trial` from the merged row, which still exists.

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Confirm no write path remains**

```bash
grep -n "no_of_trial\|No of Trial" src/pages/SampleFollowupPage.jsx
```

Expected: exactly two hits — one reading `sf.no_of_trial` in the derived-count cell, and one `key: 'no_of_trial'` in `handleExport` (Task 7 rewrites that one). Both are reads. Any hit inside `formToOrderFields`, `formToSfFields`, `EMPTY_FORM`, `SF_DISPLAY_TO_SNAKE`, the modal field list, or an `ordersAPI.patch` payload is a bug — those are writes and must all be gone.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SampleFollowupPage.jsx
git commit -m "feat(sample-trials): count trials from the log instead of a typed number"
```

---

### Task 7: Trials sheet in the Excel export

**Files:**
- Modify: `src/utils/exportExcel.js` (the `exportToExcel` function, line 85)
- Create: `src/utils/exportExcel.test.js`
- Modify: `src/pages/SampleFollowupPage.jsx` (`handleExport`, line 225)

**Interfaces:**
- Consumes: `trialsOf` from Task 5, `trialCountFor` from Task 4.
- Produces: `exportToExcel({ sheets: [{ name, rows, columns }], filename })` as an alternative to the existing `{ rows, columns, sheetName }` form, plus `buildSheetData({ rows, columns })` exported for testing.

- [ ] **Step 1: Write the failing test**

Create `src/utils/exportExcel.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetData } from './exportExcel.js';

test('buildSheetData maps rows through the column labels', () => {
  const out = buildSheetData({
    rows: [{ a: 1, b: 'x' }],
    columns: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }],
  });
  assert.deepEqual(out, [{ Alpha: 1, Beta: 'x' }]);
});

test('buildSheetData applies a format function and blanks missing values', () => {
  const out = buildSheetData({
    rows: [{ a: null }],
    columns: [
      { key: 'a', label: 'Alpha' },
      { key: 'b', label: 'Beta', format: (_, row) => (row.a === null ? 'none' : 'some') },
    ],
  });
  assert.deepEqual(out, [{ Alpha: '', Beta: 'none' }]);
});

test('buildSheetData on no rows returns an empty array, not a header row', () => {
  assert.deepEqual(buildSheetData({ rows: [], columns: [{ key: 'a', label: 'Alpha' }] }), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --test-name-pattern="buildSheetData"
```

Expected: FAIL — `buildSheetData` is not exported.

- [ ] **Step 3: Add multi-sheet support to `src/utils/exportExcel.js`**

Export the existing row builder by adding above `exportToExcel`:

```js
// Exposed for tests: the row mapping is the part with real logic, and it needs
// no xlsx import to exercise.
export const buildSheetData = ({ rows, columns }) =>
  (Array.isArray(rows) ? rows : []).map((r) => buildRow(r, columns));
```

Then replace the body of `exportToExcel` with:

```js
// Accepts either a single sheet ({ rows, columns, sheetName }) or several
// ({ sheets: [{ name, rows, columns }] }). Callers passing one sheet keep
// working unchanged.
export const exportToExcel = async ({ rows, columns, filename, sheetName = 'Export', sheets }) => {
  const XLSX = await loadXLSX();
  const plan = sheets && sheets.length
    ? sheets
    : [{ name: sheetName, rows, columns }];

  const wb = XLSX.utils.book_new();
  plan.forEach(({ name, rows: sheetRows, columns: sheetColumns }) => {
    const exportRows = buildSheetData({ rows: sheetRows, columns: sheetColumns });
    const ws = XLSX.utils.json_to_sheet(exportRows, {
      header: sheetColumns.map((c) => c.label),
    });
    ws['!cols'] = computeColWidths(exportRows, sheetColumns);
    applyDateFormats(XLSX, ws, sheetColumns, exportRows.length);
    XLSX.utils.book_append_sheet(wb, ws, String(name).slice(0, 31));
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const finalName = filename.endsWith('.xlsx') ? filename : `${filename}_${stamp}.xlsx`;
  XLSX.writeFile(wb, finalName);
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- --test-name-pattern="buildSheetData"
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Add the Trials sheet to the export**

In `src/pages/SampleFollowupPage.jsx`, rewrite `handleExport` so the existing column list becomes the first sheet and a second sheet carries the trials. The `No. of Trial` column now reports the derived count. Replace the whole `handleExport` function with:

```jsx
  const handleExport = async () => {
    const followupColumns = [
      { key: 'die', label: 'Die' },
      { key: 'profile', label: 'Profile' },
      { key: 'plant', label: 'Plant' },
      { key: 'press', label: 'Press' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'customer', label: 'Customer' },
      { key: 'die_received_date', label: 'Die Received Date', format: 'date' },
      { key: 'ascona_reference', label: 'Ascona Ref', format: (v) => v || 'No' },
      { key: 'submission_date', label: 'Submission Date', format: 'date' },
      { key: 'sample_approval_date', label: 'Sample Approval Date', format: 'date' },
      { key: 'delay_days', label: 'Delay Days', format: (_, sf) => computeSfDelay(sf.die_received_date, sf.submission_date) },
      { key: 'status', label: 'Status', format: (v) => v || 'Pending' },
      { key: 'no_of_trial', label: 'No. of Trial', format: (v, sf) => trialCountFor(trialsOf(sf), v).count },
      { key: 'remark', label: 'Remark' },
      { key: 'corrector', label: 'Corrector' },
    ];

    // One row per trial across everything currently filtered on screen, so the
    // export matches what the user is looking at.
    const trialRows = filteredFollowups.flatMap(sf =>
      trialsOf(sf).map(t => ({
        die: sf.die, profile: sf.profile, plant: sf.plant, supplier: sf.supplier,
        trial_no: t.trial_no, trial_date: t.trial_date, result: t.result,
        fail_reason: t.fail_reason, comments: t.comments,
      }))
    );

    await exportToExcel({
      filename: 'sample_followups',
      sheets: [
        { name: 'Sample Followup', rows: filteredFollowups, columns: followupColumns },
        {
          name: 'Trials',
          rows: trialRows,
          columns: [
            { key: 'die', label: 'Die' },
            { key: 'profile', label: 'Profile' },
            { key: 'plant', label: 'Plant' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'trial_no', label: 'Trial No' },
            { key: 'trial_date', label: 'Trial Date', format: 'date' },
            { key: 'result', label: 'Result' },
            { key: 'fail_reason', label: 'Reason' },
            { key: 'comments', label: 'Comments' },
          ],
        },
      ],
    });
  };
```

- [ ] **Step 6: Verify lint, build and the whole suite**

```bash
npx eslint src/utils/exportExcel.js src/pages/SampleFollowupPage.jsx
```

Expected: no errors.

```bash
npm run build && npm test
```

Expected: build succeeds; every test passes, including the pre-existing ones.

- [ ] **Step 7: Commit**

```bash
git add src/utils/exportExcel.js src/utils/exportExcel.test.js src/pages/SampleFollowupPage.jsx
git commit -m "feat(sample-trials): export trial history on its own sheet"
```

---

## Final verification

Run once the seven tasks are done. This is a browser check against the local **test** server — never quote counts from it as facts about real data.

- [ ] **Rebuild both services**

```bash
docker compose build backend frontend && docker compose up -d backend frontend
```

- [ ] **Walk the feature** at `http://localhost` → Sample Followup:
  1. Open a record with the eye icon. The Trials section appears; `No. of Trial` is gone from the form fields.
  2. Add an OK trial dated today. It appears in the list; the row's `No. of Trial` becomes `1` in normal (non-italic) type.
  3. Add a Not OK trial. Confirm the Reason dropdown appears only after picking Not OK, that saving without one is refused, and that all six reasons are listed in order.
  4. Confirm the date field will not accept tomorrow.
  5. As an admin, delete a trial; confirm the count drops. As a non-admin, confirm no delete button shows.
  6. Find a record with a legacy count and no trials — its number shows greyed and italic.
  7. Export and open the file: two sheets, and the Trials sheet lists what you entered.

- [ ] **Confirm the rows landed as expected**

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT id, die_order_id, sample_followup_id, trial_no, trial_date, result, fail_reason FROM sample_trials ORDER BY id;"
```

Expected: only the rows you just created, each with exactly one parent set and a reason present precisely on the Not OK ones.

- [ ] **Clean up only what you created**, by id — never an unscoped `DELETE FROM sample_trials`, and ask before removing anything you did not create.
