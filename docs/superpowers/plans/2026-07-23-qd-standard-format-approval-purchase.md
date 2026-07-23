# QD Standard Format, Approval Workflow & Purchase Hand-off — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the QD Tracker so a QD is captured in the company's full standard format, passes a Draft→Pending→Approved approval gate handled by named approvers, and on approval is emailed (with a generated PDF) to the Purchase team.

**Architecture:** Two phases. Phase 1 adds an `approval_state` dimension (separate from the existing 7-value `status`), approver/recipient settings, approve/send-back/submit endpoints, and a non-blocking Purchase email — all on the current fields. Phase 2 widens the schema to the full Part-A/Part-B format (+ a `qd_billet_parameters` child table), rebuilds the raise form, and adds a `pdf-lib` document generator that also becomes the Purchase-email attachment. Business logic lives in `server/services/qualityDiscrepancies.cjs` and a new `qdSettings.cjs`/`qdPdf.cjs`, kept as pure/DB-only functions so they are unit-testable with the project's mock-client pattern.

**Tech Stack:** Node.js (CommonJS `.cjs` backend), Express, PostgreSQL (`pg`), `node:test` runner, `pdf-lib`, `nodemailer` (via existing `email.cjs`), React (Vite) frontend with plain `fetch` API client.

## Global Constraints

- Backend files are CommonJS `.cjs`; frontend is ESM React. Do not mix.
- Tests use `node:test` + `node:assert/strict`, run with `npm test` (`node --test "server/**/*.test.cjs"`). No Jest/Vitest. Tests mock the `pg` client — pass a fake `{ query: async (sql, params) => ... }`; never hit a real DB in unit tests.
- Frontend has **no** component test framework — verify frontend tasks with `npm run lint` and `npm run build` only.
- Schema changes go in **both** `server/db.cjs` (idempotent `DO $$ ... IF NOT EXISTS ... ALTER TABLE` blocks, inside the one big migration template literal) **and** `init.sql` (fresh-install mirror). Follow the existing style exactly.
- QD number format is unchanged: `YYYY` + supplier code + `-` + zero-padded per-supplier sequence (e.g. `2026PH-04`). Numbering helpers already exist in the service; reuse them.
- The existing 7-value `status` vocabulary, `OPEN_STATUSES`, KPI/avg-resolution math, and their tests must remain untouched and passing.
- Never run an unscoped `DELETE`/`UPDATE` against the live DB during verification. Query by specific ids only.
- Commit after each task with the shown message.

---

# PHASE 1 — Approval workflow & Purchase email

### Task 1: Schema — approval dimension + settings table

**Files:**
- Modify: `server/db.cjs` (inside the migration template literal, after the existing QD hand-off-date `DO $$` block near line 434)
- Modify: `init.sql` (mirror the same columns/table on the `quality_discrepancies` definition and add the new table)

**Interfaces:**
- Produces: columns `approval_state, submitted_by, submitted_at, approved_by, approved_at, sent_back_reason, sent_back_at, prepared_by` on `quality_discrepancies`; `qd_no` made nullable; table `qd_settings`.

- [ ] **Step 1: Add the approval columns + nullable qd_no + backfill (db.cjs)**

Insert this block immediately after the existing `sent_to_supplier_date` `DO $$ ... END $$;` block:

```sql
      -- ── QD approval workflow ────────────────────────────────────────────
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='approval_state') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'Draft';
          -- Existing QDs predate the workflow and are already live; treat them
          -- as approved so they are never trapped behind the new gate. This
          -- one-time backfill only runs when the column is first created.
          UPDATE quality_discrepancies SET approval_state = 'Approved';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='submitted_by') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN submitted_by INTEGER REFERENCES users(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='submitted_at') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN submitted_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='approved_by') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN approved_by INTEGER REFERENCES users(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='approved_at') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN approved_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='sent_back_reason') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN sent_back_reason TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='sent_back_at') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN sent_back_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='prepared_by') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN prepared_by TEXT;
        END IF;
        -- Drafts carry no QD number until submitted, so qd_no must be nullable.
        -- The UNIQUE constraint still holds: Postgres treats NULLs as distinct.
        ALTER TABLE quality_discrepancies ALTER COLUMN qd_no DROP NOT NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS qd_settings (
        id                SERIAL PRIMARY KEY,
        approver_user_ids TEXT DEFAULT '[]',
        purchase_email_to TEXT DEFAULT '',
        purchase_email_cc TEXT DEFAULT '',
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
```

- [ ] **Step 2: Mirror in init.sql**

In `init.sql`, add the same eight columns to the `quality_discrepancies` `CREATE TABLE` (with `qd_no TEXT UNIQUE` — no `NOT NULL`), and add the `qd_settings` `CREATE TABLE` shown above.

- [ ] **Step 3: Verify migration applies cleanly**

Run (per dev-workflow — internal container):
```bash
docker exec die-ordering-backend node -e "require('/app/server/db.cjs')" 2>&1 | tail -5
```
Expected: no error (migrations are idempotent). Then confirm columns exist:
```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "\d quality_discrepancies" | grep approval_state
```
Expected: a row showing `approval_state | text`.

- [ ] **Step 4: Commit**

```bash
git add server/db.cjs init.sql
git commit -m "feat(qd): schema for approval workflow (approval_state, settings, nullable qd_no)"
```

---

### Task 2: Approval-state helpers & transition guards (service)

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs`
- Test: `server/services/qualityDiscrepancies.test.cjs`

**Interfaces:**
- Produces:
  - `APPROVAL_STATES: string[]`, `EDITABLE_APPROVAL_STATES: string[]`
  - `nextApprovalState(from, action) -> string` (throws on illegal transition; actions: `'submit'|'approve'|'sendBack'`)
  - `getApprovalRow(client, id) -> {id, qd_no, approval_state, supplier} | null`
  - `submitForApproval(client, {id, newQdNo, actor, userId}) -> {ok, qdNo?, state?}`
  - `approveQD(client, {id, actor, userId}) -> {ok, qdNo?}`
  - `sendBack(client, {id, reason, actor, userId}) -> {ok}`
  - `excludeDrafts(rows) -> rows`, `onlyDrafts(rows, userId) -> rows`

- [ ] **Step 1: Write failing tests**

Append to `qualityDiscrepancies.test.cjs`:

```js
test('APPROVAL_STATES and the editable subset are the agreed values', () => {
  assert.deepEqual(q.APPROVAL_STATES, ['Draft', 'Pending', 'Approved', 'SentBack']);
  assert.deepEqual(q.EDITABLE_APPROVAL_STATES, ['Draft', 'SentBack']);
});

test('nextApprovalState allows only legal transitions', () => {
  assert.equal(q.nextApprovalState('Draft', 'submit'), 'Pending');
  assert.equal(q.nextApprovalState('SentBack', 'submit'), 'Pending');
  assert.equal(q.nextApprovalState('Pending', 'approve'), 'Approved');
  assert.equal(q.nextApprovalState('Pending', 'sendBack'), 'SentBack');
  assert.throws(() => q.nextApprovalState('Approved', 'approve'), /Cannot approve/);
  assert.throws(() => q.nextApprovalState('Draft', 'approve'), /Cannot approve/);
  assert.throws(() => q.nextApprovalState('Pending', 'submit'), /Cannot submit/);
});

test('submitForApproval assigns a number to an unnumbered draft and moves it to Pending', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: null, approval_state: 'Draft', supplier: 'Phoenix' }] };
    return { rowCount: 1, rows: [] };
  } };
  const out = await q.submitForApproval(client, { id: 5, newQdNo: '2026PH-04', actor: 'Veera', userId: 2 });
  assert.deepEqual(out, { ok: true, qdNo: '2026PH-04', state: 'Pending' });
  const upd = calls.find(c => /SET qd_no = \$1, approval_state = \$2/.test(c.sql));
  assert.equal(upd.params[0], '2026PH-04');
  assert.equal(upd.params[1], 'Pending');
});

test('submitForApproval keeps an existing number when resubmitting a SentBack QD', async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'SentBack', supplier: 'Phoenix' }] };
    return { rowCount: 1, rows: [] };
  } };
  const out = await q.submitForApproval(client, { id: 5, newQdNo: '2026PH-99', actor: 'Veera', userId: 2 });
  assert.equal(out.qdNo, '2026PH-04'); // not the freshly-computed candidate
});

test('approveQD stamps approver + purchase date and requires Pending', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'Pending' }] };
    return { rowCount: 1, rows: [] };
  } };
  const out = await q.approveQD(client, { id: 5, actor: 'Imran', userId: 3 });
  assert.deepEqual(out, { ok: true, qdNo: '2026PH-04' });
  const upd = calls.find(c => /approval_state = 'Approved'/.test(c.sql));
  assert.match(upd.sql, /sent_to_purchase_date = COALESCE\(sent_to_purchase_date, CURRENT_DATE\)/);
});

test('approveQD refuses a QD that is not Pending', async () => {
  const client = { query: async (sql) => (/SELECT id, qd_no, approval_state/.test(sql)
    ? { rows: [{ id: 5, qd_no: null, approval_state: 'Draft' }] } : { rowCount: 1 }) };
  await assert.rejects(() => q.approveQD(client, { id: 5, actor: 'X' }), /Cannot approve/);
});

test('sendBack requires a reason and only works from Pending', async () => {
  const okRow = { query: async (sql) => (/SELECT id, qd_no, approval_state/.test(sql)
    ? { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'Pending' }] } : { rowCount: 1 }) };
  await assert.rejects(() => q.sendBack(okRow, { id: 5, reason: '  ', actor: 'X' }), /Reason is required/);
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params });
    return /SELECT id, qd_no, approval_state/.test(sql) ? { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'Pending' }] } : { rowCount: 1 }; } };
  const out = await q.sendBack(client, { id: 5, reason: 'billet temps missing', actor: 'Imran', userId: 3 });
  assert.equal(out.ok, true);
  const upd = calls.find(c => /approval_state = 'SentBack'/.test(c.sql));
  assert.equal(upd.params[0], 'billet temps missing');
});

test('excludeDrafts / onlyDrafts split rows by approval_state', () => {
  const rows = [
    { id: 1, approval_state: 'Draft', created_by: 2 },
    { id: 2, approval_state: 'Approved', created_by: 2 },
    { id: 3, approval_state: 'Draft', created_by: 9 },
  ];
  assert.deepEqual(q.excludeDrafts(rows).map(r => r.id), [2]);
  assert.deepEqual(q.onlyDrafts(rows, 2).map(r => r.id), [1]);
  assert.deepEqual(q.onlyDrafts(rows, null).map(r => r.id), [1, 3]);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `q.APPROVAL_STATES` undefined / functions not defined.

- [ ] **Step 3: Implement in `qualityDiscrepancies.cjs`**

Add near the top constants (after `OUTCOMES`):

```js
const APPROVAL_STATES = ['Draft', 'Pending', 'Approved', 'SentBack'];
const EDITABLE_APPROVAL_STATES = ['Draft', 'SentBack'];

// Legal approval transitions. Throwing here (rather than returning null) means
// an illegal action surfaces as a 400 at the route, not a silent no-op.
const APPROVAL_TRANSITIONS = {
  Draft:    { submit: 'Pending' },
  SentBack: { submit: 'Pending' },
  Pending:  { approve: 'Approved', sendBack: 'SentBack' },
};
function nextApprovalState(from, action) {
  const to = APPROVAL_TRANSITIONS[from] && APPROVAL_TRANSITIONS[from][action];
  if (!to) throw new Error(`Cannot ${action} a QD that is ${from}`);
  return to;
}
```

Add these functions (after `updateStatus`):

```js
async function getApprovalRow(client, id) {
  const { rows } = await client.query(
    `SELECT id, qd_no, approval_state, supplier FROM quality_discrepancies WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function submitForApproval(client, { id, newQdNo, actor, userId }) {
  const row = await getApprovalRow(client, id);
  if (!row) return { ok: false };
  const to = nextApprovalState(row.approval_state, 'submit');
  const qdNo = row.qd_no || newQdNo;
  if (!qdNo) throw new Error('A QD number is required to submit');
  await client.query(
    `UPDATE quality_discrepancies
        SET qd_no = $1, approval_state = $2, submitted_by = $3,
            submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4`,
    [qdNo, to, userId || null, id]);
  await addActivity(client, { qdId: id, actor, action: `submitted QD ${qdNo} for approval`, icon: 'send', tone: 'send', userId });
  return { ok: true, qdNo, state: to };
}

async function approveQD(client, { id, actor, userId }) {
  const row = await getApprovalRow(client, id);
  if (!row) return { ok: false };
  nextApprovalState(row.approval_state, 'approve');
  await client.query(
    `UPDATE quality_discrepancies
        SET approval_state = 'Approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP,
            sent_to_purchase_date = COALESCE(sent_to_purchase_date, CURRENT_DATE),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [userId || null, id]);
  await addActivity(client, { qdId: id, actor, action: `approved QD ${row.qd_no}`, icon: 'check', tone: 'good', userId });
  return { ok: true, qdNo: row.qd_no };
}

async function sendBack(client, { id, reason, actor, userId }) {
  const why = String(reason == null ? '' : reason).trim();
  if (!why) throw new Error('Reason is required to send a QD back');
  const row = await getApprovalRow(client, id);
  if (!row) return { ok: false };
  nextApprovalState(row.approval_state, 'sendBack');
  await client.query(
    `UPDATE quality_discrepancies
        SET approval_state = 'SentBack', sent_back_reason = $1,
            sent_back_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [why, id]);
  await addActivity(client, { qdId: id, actor, action: `sent QD back — ${why}`, icon: 'undo', tone: 'bad', userId });
  return { ok: true };
}

const excludeDrafts = (rows) => (rows || []).filter((r) => r.approval_state !== 'Draft');
const onlyDrafts = (rows, userId) => (rows || []).filter(
  (r) => r.approval_state === 'Draft' && (userId == null || r.created_by === userId));
```

Add all new names to `module.exports`:
`APPROVAL_STATES, EDITABLE_APPROVAL_STATES, nextApprovalState, getApprovalRow, submitForApproval, approveQD, sendBack, excludeDrafts, onlyDrafts`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS (all new + existing tests green).

- [ ] **Step 5: Commit**

```bash
git add server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): approval-state transitions and submit/approve/send-back service fns"
```

---

### Task 3: QD settings service (approvers + Purchase recipients)

**Files:**
- Create: `server/services/qdSettings.cjs`
- Test: `server/services/qdSettings.test.cjs`

**Interfaces:**
- Produces:
  - `parseIds(raw) -> number[]`
  - `isApprover(user, approverUserIds) -> boolean` (admins always true)
  - `getQdSettings(pool) -> {approverUserIds, purchaseEmailTo, purchaseEmailCc}`
  - `saveQdSettings(pool, {approverUserIds, purchaseEmailTo, purchaseEmailCc}) -> void`

- [ ] **Step 1: Write failing tests**

`server/services/qdSettings.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./qdSettings.cjs');

test('parseIds tolerates junk and coerces to numbers', () => {
  assert.deepEqual(s.parseIds('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(s.parseIds('["4","5"]'), [4, 5]);
  assert.deepEqual(s.parseIds(''), []);
  assert.deepEqual(s.parseIds('not json'), []);
  assert.deepEqual(s.parseIds(null), []);
});

test('isApprover: admins always, otherwise only listed users', () => {
  assert.equal(s.isApprover({ id: 9, role: 'admin' }, []), true);
  assert.equal(s.isApprover({ id: 3, role: 'user' }, [3, 7]), true);
  assert.equal(s.isApprover({ id: 4, role: 'user' }, [3, 7]), false);
  assert.equal(s.isApprover(null, [3]), false);
});

test('getQdSettings returns parsed defaults when no row exists', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await s.getQdSettings(pool),
    { approverUserIds: [], purchaseEmailTo: '', purchaseEmailCc: '' });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — cannot find module `./qdSettings.cjs`.

- [ ] **Step 3: Implement `qdSettings.cjs`**

```js
'use strict';

function parseIds(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}

function isApprover(user, approverUserIds) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (approverUserIds || []).includes(user.id);
}

async function getQdSettings(pool) {
  const { rows } = await pool.query('SELECT * FROM qd_settings ORDER BY id LIMIT 1');
  const row = rows[0] || {};
  return {
    approverUserIds: parseIds(row.approver_user_ids),
    purchaseEmailTo: row.purchase_email_to || '',
    purchaseEmailCc: row.purchase_email_cc || '',
  };
}

async function saveQdSettings(pool, { approverUserIds, purchaseEmailTo, purchaseEmailCc }) {
  const ids = JSON.stringify((approverUserIds || []).map(Number).filter(Number.isFinite));
  const existing = await pool.query('SELECT id FROM qd_settings ORDER BY id LIMIT 1');
  if (existing.rows.length) {
    await pool.query(
      `UPDATE qd_settings SET approver_user_ids = $1, purchase_email_to = $2,
              purchase_email_cc = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [ids, purchaseEmailTo || '', purchaseEmailCc || '', existing.rows[0].id]);
  } else {
    await pool.query(
      `INSERT INTO qd_settings (approver_user_ids, purchase_email_to, purchase_email_cc)
       VALUES ($1, $2, $3)`,
      [ids, purchaseEmailTo || '', purchaseEmailCc || '']);
  }
}

module.exports = { parseIds, isApprover, getQdSettings, saveQdSettings };
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/qdSettings.cjs server/services/qdSettings.test.cjs
git commit -m "feat(qd): settings service for approvers and Purchase recipients"
```

---

### Task 4: Purchase-email body builder (pure)

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs`
- Test: `server/services/qualityDiscrepancies.test.cjs`

**Interfaces:**
- Produces: `buildPurchaseEmailHtml(qd) -> string`, `purchaseEmailSubject(qd) -> string`

- [ ] **Step 1: Write failing tests**

Append:

```js
test('purchaseEmailSubject names the QD', () => {
  assert.equal(q.purchaseEmailSubject({ qd_no: '2026PH-04' }),
    'QD 2026PH-04 approved — action required');
});

test('buildPurchaseEmailHtml includes key fields and escapes the issue text', () => {
  const html = q.buildPurchaseEmailHtml({
    qd_no: '2026PH-04', die_no: '30601-201', profile_number: '30601',
    supplier: 'Phoenix', raised_date: '2026-06-04',
    recommended_action: 'Provide FOC replacement die',
    issue_detail: 'Heavy blend <observed> on profile',
  });
  assert.match(html, /2026PH-04/);
  assert.match(html, /Phoenix/);
  assert.match(html, /Provide FOC replacement die/);
  assert.match(html, /&lt;observed&gt;/);      // escaped, not raw HTML
  assert.doesNotMatch(html, /<observed>/);
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL (not defined).

- [ ] **Step 3: Implement**

```js
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function purchaseEmailSubject(qd) {
  return `QD ${qd.qd_no} approved — action required`;
}

function buildPurchaseEmailHtml(qd) {
  const row = (k, v) => `<tr><td style="padding:3px 10px;color:#555">${k}</td>` +
    `<td style="padding:3px 10px"><b>${escapeHtml(v) || '—'}</b></td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
    <h2 style="margin:0 0 6px">Quality Discrepancy ${escapeHtml(qd.qd_no)}</h2>
    <p>This QD has been approved and is handed over to Purchase for further processing.</p>
    <table style="border-collapse:collapse;margin:8px 0">
      ${row('QD No', qd.qd_no)}${row('Die No', qd.die_no)}${row('Profile', qd.profile_number)}
      ${row('Supplier', qd.supplier)}${row('Raised', qd.raised_date)}
      ${row('Recommended action', qd.recommended_action || qd.outcome)}
    </table>
    <p style="white-space:pre-wrap">${escapeHtml(qd.issue_detail || qd.issue_summary)}</p>
  </div>`;
}
```

Export `purchaseEmailSubject, buildPurchaseEmailHtml`.

- [ ] **Step 4: Run, verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): Purchase-email subject and HTML body builder"
```

---

### Task 5: Routes — Draft create, submit/approve/send-back, settings, Purchase email

**Files:**
- Modify: `server/routes/quality-discrepancies.cjs`
- Modify: `server/services/qualityDiscrepancies.cjs` (make `createQD` accept a null `qdNo` and `approvalState`)

**Interfaces:**
- Consumes: `qd.submitForApproval/approveQD/sendBack/excludeDrafts/onlyDrafts/purchaseEmailSubject/buildPurchaseEmailHtml`, `qdSettings.getQdSettings/isApprover`, `email.sendEmail`.
- Produces endpoints: `POST /:id/submit`, `POST /:id/approve`, `POST /:id/send-back`, `POST /:id/resend-purchase`, `GET /settings`, `PUT /settings`; GET `/` gains `canApprove` + Draft filtering; POST `/` now creates a Draft.

- [ ] **Step 1: Make `createQD` draft-capable**

In `qualityDiscrepancies.cjs`, change `createQD` to accept `approvalState` and allow a null `qdNo`:

```js
async function createQD(client, input) {
  const {
    qdNo, dieNo, raisedDate, plant, supplier, corrector, status, outcome,
    issueSummary, issueDetail, etaDate, inputAtFailure, closedAt, createdBy, dieOrderId,
    approvalState, preparedBy,
  } = input;
  const { rows } = await client.query(
    `INSERT INTO quality_discrepancies
       (qd_no, die_no, profile_number, die_order_id, raised_date, plant, supplier, corrector,
        status, outcome, issue_summary, issue_detail, eta_date, input_at_failure, closed_at,
        created_by, approval_state, prepared_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      qdNo || null, dieNo, extractProfileFromDie(dieNo), dieOrderId || null, raisedDate, plant, supplier,
      corrector || null, status || 'Open', outcome || null, issueSummary, issueDetail || null,
      etaDate || null, inputAtFailure || null, closedAt || null, createdBy || null,
      approvalState || 'Draft', preparedBy || null,
    ]
  );
  return rows[0].id;
}
```

- [ ] **Step 2: Rework POST `/` to create a Draft (no number yet)**

Replace the body of `router.post('/', ...)` so it no longer assigns a number or sets status Open-with-number; instead create a Draft:

```js
    await client.query('BEGIN');
    const id = await qd.createQD(client, {
      qdNo: null,
      dieNo: String(dieNo).trim(),
      raisedDate: new Date().toISOString().slice(0, 10),
      plant: String(plant).trim(),
      supplier: String(supplier).trim(),
      corrector: String(corrector || '').trim() || null,
      status: 'Open',
      approvalState: 'Draft',
      outcome: outcome || null,
      issueSummary: summary,
      issueDetail: text,
      inputAtFailure: String(inputAtFailure || '').trim() || null,
      preparedBy: String(corrector || '').trim() || actorFor(req),
      createdBy: req.user?.id,
    });
    await qd.addActivity(client, {
      qdId: id, actor: String(corrector || '').trim() || actorFor(req),
      action: `drafted QD against die ${String(dieNo).trim()}`,
      icon: 'flag', tone: 'flag', userId: req.user?.id,
    });
    await client.query('COMMIT');
    res.status(201).json({ id });
```

(The `nextQdNo` helper stays — it is now called from the submit route.)

- [ ] **Step 3: Add the settings + workflow routes**

At the top add:
```js
const qdSettings = require('../services/qdSettings.cjs');
const email = require('../services/email.cjs');
```

Add **before** the `router.patch('/:id', ...)` route (so `/settings` isn't captured by `/:id`):

```js
// GET /settings → approver ids + Purchase recipients (any authed user may read;
// the client uses it to prefill the admin form, and canApprove is derived here too)
router.get('/settings', async (req, res) => {
  try {
    res.json(await qdSettings.getQdSettings(pool));
  } catch (e) { console.error('QD settings read error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /settings → admin only
router.put('/settings', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { approverUserIds, purchaseEmailTo, purchaseEmailCc } = req.body || {};
    await qdSettings.saveQdSettings(pool, {
      approverUserIds: Array.isArray(approverUserIds) ? approverUserIds : [],
      purchaseEmailTo: String(purchaseEmailTo || ''),
      purchaseEmailCc: String(purchaseEmailCc || ''),
    });
    res.json({ message: 'Saved' });
  } catch (e) { console.error('QD settings save error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

const requireApprover = async (req, res, next) => {
  try {
    const { approverUserIds } = await qdSettings.getQdSettings(pool);
    if (!qdSettings.isApprover(req.user, approverUserIds)) {
      return res.status(403).json({ error: 'Not authorized to approve QDs' });
    }
    next();
  } catch (e) { console.error('Approver check error:', e); res.status(500).json({ error: 'Internal server error' }); }
};

// Shared: build + send the Purchase email for an already-approved QD.
// Non-blocking — the caller decides how to report a send failure.
async function sendPurchaseEmail(qdId, sentBy) {
  const { rows } = await pool.query('SELECT * FROM quality_discrepancies WHERE id = $1', [qdId]);
  const row = rows[0];
  if (!row) throw new Error('QD not found');
  const { purchaseEmailTo, purchaseEmailCc } = await qdSettings.getQdSettings(pool);
  if (!purchaseEmailTo) throw new Error('No Purchase recipient configured (Settings → QD)');
  await email.sendEmail({
    to: purchaseEmailTo, cc: purchaseEmailCc || undefined,
    subject: qd.purchaseEmailSubject(row), body: qd.buildPurchaseEmailHtml(row),
    importance: 'high', sentBy,
  });
}

// POST /:id/submit → Draft/SentBack → Pending (assigns a number if unnumbered)
router.post('/:id/submit', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await qd.getApprovalRow(client, req.params.id);
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'QD not found' }); }
    const newQdNo = row.qd_no || await nextQdNo(client, row.supplier);
    const out = await qd.submitForApproval(client, {
      id: req.params.id, newQdNo, actor: actorFor(req), userId: req.user?.id,
    });
    await client.query('COMMIT');
    res.json({ message: 'Submitted', qd_no: out.qdNo, approval_state: out.state });
  } catch (e) {
    await client.query('ROLLBACK');
    if (/^Cannot submit/.test(e.message)) return res.status(400).json({ error: e.message });
    if (/^No QD code/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Submit QD error:', e); res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

// POST /:id/approve → Pending → Approved, then email Purchase (non-blocking)
router.post('/:id/approve', requireApprover, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await qd.approveQD(client, { id: req.params.id, actor: actorFor(req), userId: req.user?.id });
    if (!out.ok) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'QD not found' }); }
    await client.query('COMMIT');
    // Email after commit — a mail failure must not undo the approval.
    try {
      await sendPurchaseEmail(req.params.id, req.user?.id);
      await qd.addActivityOfKind(pool, { qdId: req.params.id, kind: 'email',
        actor: actorFor(req), note: 'QD emailed to Purchase team', userId: req.user?.id });
      res.json({ message: 'Approved and sent to Purchase' });
    } catch (mailErr) {
      console.error('Purchase email failed:', mailErr.message);
      res.json({ message: 'Approved', emailWarning: mailErr.message });
    }
  } catch (e) {
    await client.query('ROLLBACK');
    if (/^Cannot approve/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Approve QD error:', e); res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

// POST /:id/resend-purchase → re-send the Purchase email for an Approved QD
router.post('/:id/resend-purchase', requireApprover, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT approval_state FROM quality_discrepancies WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'QD not found' });
    if (rows[0].approval_state !== 'Approved') return res.status(400).json({ error: 'Only an approved QD can be sent to Purchase' });
    await sendPurchaseEmail(req.params.id, req.user?.id);
    await qd.addActivityOfKind(pool, { qdId: req.params.id, kind: 'email',
      actor: actorFor(req), note: 'QD re-sent to Purchase team', userId: req.user?.id });
    res.json({ message: 'Re-sent to Purchase' });
  } catch (e) {
    console.error('Resend Purchase error:', e); res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

// POST /:id/send-back → Pending → SentBack (reason required), approver only
router.post('/:id/send-back', requireApprover, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await qd.sendBack(client, {
      id: req.params.id, reason: req.body?.reason, actor: actorFor(req), userId: req.user?.id });
    if (!out.ok) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'QD not found' }); }
    await client.query('COMMIT');
    res.json({ message: 'Sent back' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (/^Reason is required/.test(e.message) || /^Cannot sendBack/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error('Send-back QD error:', e); res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});
```

- [ ] **Step 4: Filter Drafts + expose `canApprove` in GET `/`**

Replace the `router.get('/', ...)` handler body with:

```js
    const now = new Date();
    const all = await qd.listQDs(pool);
    const scoped = qd.filterByYear(all, req.query.year);
    const { approverUserIds } = await qdSettings.getQdSettings(pool);
    const visible = req.query.drafts === '1'
      ? qd.onlyDrafts(scoped, req.user?.id)
      : qd.excludeDrafts(scoped);
    const forKpis = qd.excludeDrafts(scoped);
    res.json({
      qds: visible,
      kpis: qd.computeKpis(forKpis, now),
      suppliers: qd.summarizeSuppliers(forKpis, now),
      years: qd.availableYears(all),
      canApprove: qdSettings.isApprover(req.user, approverUserIds),
    });
```

- [ ] **Step 5: Verify (lint + container smoke)**

Run: `npm run lint`
Expected: no new errors in `server/routes/quality-discrepancies.cjs`.

Smoke (per dev-workflow, through the nginx proxy on 8080 with a valid token, or `docker exec` a small script). Minimum: confirm the server boots after the changes:
```bash
docker exec die-ordering-backend node -e "require('/app/server/routes/quality-discrepancies.cjs'); console.log('route module ok')"
```
Expected: `route module ok`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/quality-discrepancies.cjs server/services/qualityDiscrepancies.cjs
git commit -m "feat(qd): draft create + submit/approve/send-back routes with Purchase email"
```

---

### Task 6: Frontend — approval actions in the drawer + approver settings

**Files:**
- Modify: `src/api.js` (add methods to `qualityDiscrepanciesAPI`)
- Modify: `src/components/qd/QDDetailPanel.jsx` (approval badge + action buttons + send-back modal)
- Modify: `src/pages/QDTrackerPage.jsx` (thread `canApprove`, add a "Drafts" view toggle, refresh after actions)
- Modify: the Settings page/component that lists other admin sections (add a "QD Approvers & Purchase" panel) — locate with `grep -rl "Suppliers" src/pages src/components | grep -i setting`

**Interfaces:**
- Consumes: Phase-1 endpoints.
- Produces: drawer actions calling `qualityDiscrepanciesAPI.submit/approve/sendBack/resendPurchase`; settings panel calling `getSettings/saveSettings`.

- [ ] **Step 1: Add API methods**

In `src/api.js`, inside the `qualityDiscrepanciesAPI` object, add:

```js
    submit: async (id) =>
        apiRequest(`/quality-discrepancies/${id}/submit`, { method: 'POST' }),
    approve: async (id) =>
        apiRequest(`/quality-discrepancies/${id}/approve`, { method: 'POST' }),
    sendBack: async (id, reason) =>
        apiRequest(`/quality-discrepancies/${id}/send-back`, { method: 'POST', body: JSON.stringify({ reason }) }),
    resendPurchase: async (id) =>
        apiRequest(`/quality-discrepancies/${id}/resend-purchase`, { method: 'POST' }),
    getSettings: async () =>
        apiRequest('/quality-discrepancies/settings'),
    saveSettings: async (payload) =>
        apiRequest('/quality-discrepancies/settings', { method: 'PUT', body: JSON.stringify(payload) }),
```

- [ ] **Step 2: Show approval state + actions in the drawer**

In `QDDetailPanel.jsx`, accept two new props: `canApprove` (bool) and `onChanged` (callback to refresh the list). Read the current user with `getUser()` from `../../api`. Render, near the header:

```jsx
// approval badge
const A_BADGE = {
  Draft:    { label: 'Draft',      bg: 'rgba(161,161,170,0.15)', fg: '#a1a1aa' },
  Pending:  { label: 'Pending',    bg: 'rgba(234,179,8,0.15)',   fg: '#EAB308' },
  Approved: { label: 'Approved',   bg: 'rgba(34,197,94,0.15)',   fg: '#22C55E' },
  SentBack: { label: 'Sent back',  bg: 'rgba(239,68,68,0.15)',   fg: '#EF4444' },
}[qd.approval_state] || null;
```

Render `A_BADGE` as a pill. Then an actions row driven by state:

```jsx
const me = getUser();
const isOwner = me && qd.created_by === me.id;
const editable = qd.approval_state === 'Draft' || qd.approval_state === 'SentBack';

{editable && (isOwner || me?.role === 'admin') && (
  <button onClick={handleSubmit}>Submit for approval</button>
)}
{qd.approval_state === 'Pending' && canApprove && (
  <>
    <button onClick={handleApprove}>Approve &amp; send to Purchase</button>
    <button onClick={() => setSendBackOpen(true)}>Send back</button>
  </>
)}
{qd.approval_state === 'Approved' && canApprove && (
  <button onClick={handleResend}>Resend to Purchase</button>
)}
{qd.approval_state === 'SentBack' && qd.sent_back_reason && (
  <div className="qd-sentback-reason">Sent back: {qd.sent_back_reason}</div>
)}
```

Handlers (show a busy state; surface `emailWarning` if present; call `onChanged()` after success):

```jsx
const handleSubmit = async () => {
  try { const r = await qualityDiscrepanciesAPI.submit(qd.id); onChanged?.(); }
  catch (e) { setError(e.message); }
};
const handleApprove = async () => {
  try {
    const r = await qualityDiscrepanciesAPI.approve(qd.id);
    if (r.emailWarning) setError(`Approved, but the Purchase email failed: ${r.emailWarning}`);
    onChanged?.();
  } catch (e) { setError(e.message); }
};
const handleResend = async () => {
  try { await qualityDiscrepanciesAPI.resendPurchase(qd.id); onChanged?.(); }
  catch (e) { setError(e.message); }
};
const submitSendBack = async () => {
  if (!sendBackReason.trim()) return;
  try { await qualityDiscrepanciesAPI.sendBack(qd.id, sendBackReason.trim()); setSendBackOpen(false); onChanged?.(); }
  catch (e) { setError(e.message); }
};
```

Add a small send-back modal (reuse the existing reason-modal styling used by the status-change reason prompt in this component).

- [ ] **Step 3: Thread `canApprove` + Drafts toggle in `QDTrackerPage.jsx`**

- Store `canApprove` from the list response (`const { qds, kpis, suppliers, years, canApprove } = await qualityDiscrepanciesAPI.list(year)`).
- Pass `canApprove` and `onChanged={() => reload()}` to `<QDDetailPanel>`.
- Add a "Drafts" toggle that calls the list with `?drafts=1`. Extend `qualityDiscrepanciesAPI.list` to accept an options arg:

```js
    list: async (year, { drafts = false } = {}) => {
        const params = new URLSearchParams();
        if (year && year !== 'All') params.set('year', year);
        if (drafts) params.set('drafts', '1');
        const qs = params.toString();
        return apiRequest(`/quality-discrepancies${qs ? `?${qs}` : ''}`);
    },
```

- [ ] **Step 4: Settings panel — approvers + Purchase recipients**

In the admin Settings area, add a panel: multi-select of users (from `usersAPI.getAll()`) bound to `approverUserIds`, plus text inputs for `purchaseEmailTo` and `purchaseEmailCc`. Load with `qualityDiscrepanciesAPI.getSettings()`, save with `qualityDiscrepanciesAPI.saveSettings({ approverUserIds, purchaseEmailTo, purchaseEmailCc })`. Gate the panel behind `me.role === 'admin'`.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run build`
Expected: build succeeds, no errors.

Manual: log in as a non-approver → Pending QD shows no Approve button; as an approver → Approve/Send-back appear; approving a QD with a Purchase recipient set fires the email (check the Email log).

- [ ] **Step 6: Commit**

```bash
git add src/api.js src/components/qd/QDDetailPanel.jsx src/pages/QDTrackerPage.jsx
git commit -m "feat(qd): approval actions in the drawer + approver/Purchase settings UI"
```

**PHASE 1 COMPLETE — the approval → Purchase-email workflow is fully usable on the current fields.**

---

# PHASE 2 — Full standard format, PDF & Part-B

### Task 7: Schema — Part-A/Part-B columns, billet child table, file category

**Files:**
- Modify: `server/db.cjs`, `init.sql`

**Interfaces:**
- Produces: Part-A/Part-B columns on `quality_discrepancies`; `qd_billet_parameters` table; `category` on `quality_discrepancy_files`.

- [ ] **Step 1: Add columns + child table (db.cjs)**

After the Task-1 approval block, add:

```sql
      -- ── QD standard-format fields (Part-A header, classification, Part-B) ──
      DO $$
      DECLARE col TEXT;
      BEGIN
        FOREACH col IN ARRAY ARRAY[
          'die_received_date','press','die_type','die_size','no_of_cavity','tooling',
          'no_of_trials','no_of_corrections','production_date',
          'manufacturing_defect','die_performance','recommended_action',
          'supplier_acceptance','action_taken','supplier_comments','received_by_supplier'
        ] LOOP
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name='quality_discrepancies' AND column_name=col) THEN
            EXECUTE format('ALTER TABLE quality_discrepancies ADD COLUMN %I TEXT', col);
          END IF;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='quality_discrepancy_files' AND column_name='category') THEN
          ALTER TABLE quality_discrepancy_files ADD COLUMN category TEXT DEFAULT 'general';
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS qd_billet_parameters (
        id                   SERIAL PRIMARY KEY,
        qd_id                INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE,
        billet               TEXT NOT NULL,               -- 'first' | 'last'
        die_soaking_hours    TEXT,
        die_temperature      TEXT,
        billet_temp          TEXT,
        breakthrough_pressure TEXT,
        running_pressure     TEXT,
        billet_length        TEXT,
        alloy                TEXT,
        ram_speed            TEXT,
        any_delay_observed   TEXT,
        UNIQUE (qd_id, billet)
      );
      CREATE INDEX IF NOT EXISTS idx_qd_billet_qd ON qd_billet_parameters (qd_id);
```

- [ ] **Step 2: Mirror in init.sql** — add the 16 `TEXT` columns to the QD table, the `category TEXT DEFAULT 'general'` column to the files table, and the `qd_billet_parameters` table.

- [ ] **Step 3: Verify** — same approach as Task 1 Step 3, grepping for `die_type` and `qd_billet_parameters`:
```bash
docker exec die-ordering-backend node -e "require('/app/server/db.cjs')" 2>&1 | tail -3
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "\dt qd_billet_parameters"
```
Expected: table listed.

- [ ] **Step 4: Commit**

```bash
git add server/db.cjs init.sql
git commit -m "feat(qd): schema for full standard format + billet-parameter child table"
```

---

### Task 8: Service — billet parameters, Part-B editable fields, full row assembly

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs`, `server/services/qualityDiscrepancies.test.cjs`

**Interfaces:**
- Produces:
  - `BILLETS = ['first','last']`
  - `saveBilletParameters(client, qdId, params) -> void` (params: `{ first?: {...}, last?: {...} }`; empty/missing billets removed)
  - `listBilletParameters(client, qdIds) -> Map<qdId, rows[]>`
  - extended `EDITABLE_FIELDS` with the Part-B + Part-A columns
  - `listQDs` decorates each row with `billets`

- [ ] **Step 1: Write failing tests**

```js
test('EDITABLE_FIELDS now covers the Part-A/Part-B format fields', () => {
  for (const f of ['recommended_action','manufacturing_defect','die_performance',
                   'supplier_acceptance','action_taken','supplier_comments','received_by_supplier',
                   'press','die_type','die_size','no_of_cavity','tooling','no_of_trials',
                   'no_of_corrections','die_received_date','production_date']) {
    assert.ok(q.EDITABLE_FIELDS[f], `expected ${f} to be editable`);
  }
});

test('manufacturing_defect only accepts Yes/No', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { manufacturing_defect: 'maybe' }, actor: 'x' }),
    /Invalid Manufacturing defect/);
});

test('saveBilletParameters upserts given billets and deletes empty ones', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  await q.saveBilletParameters(client, 5, {
    first: { billet_temp: '502', running_pressure: '167' },
    last: {},   // empty → should be deleted, not inserted
  });
  const del = calls.find(c => /DELETE FROM qd_billet_parameters/.test(c.sql) && c.params.includes('last'));
  const up = calls.find(c => /INSERT INTO qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  assert.ok(del, 'empty last billet should be deleted');
  assert.ok(up, 'first billet should be upserted');
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

Extend `EDITABLE_FIELDS` (add entries; the Yes/No ones get a validator):

```js
const YES_NO = ['Yes', 'No'];
// add to EDITABLE_FIELDS:
  recommended_action:   { label: 'Recommended action' },
  manufacturing_defect: { label: 'Manufacturing defect', oneOf: YES_NO },
  die_performance:      { label: 'Die performance', oneOf: YES_NO },
  supplier_acceptance:  { label: 'Supplier acceptance', oneOf: YES_NO },
  action_taken:         { label: 'Action taken' },
  supplier_comments:    { label: 'Supplier comments' },
  received_by_supplier: { label: 'Received by (supplier)' },
  press:                { label: 'Press' },
  die_type:             { label: 'Die type' },
  die_size:             { label: 'Die size' },
  no_of_cavity:         { label: 'No of cavity' },
  tooling:              { label: 'Tooling' },
  no_of_trials:         { label: 'No of trials' },
  no_of_corrections:    { label: 'No of corrections' },
  die_received_date:    { label: 'Die received date' },
  production_date:      { label: 'Production date' },
```

In `normalizeField`, add a generic `oneOf` check (before the isDate check):

```js
  const spec = EDITABLE_FIELDS[column];
  if (spec?.oneOf && !spec.oneOf.includes(value)) {
    throw new Error(`Invalid ${spec.label}: ${value} (expected ${spec.oneOf.join(' or ')})`);
  }
```

Add billet helpers:

```js
const BILLETS = ['first', 'last'];
const BILLET_COLS = ['die_soaking_hours','die_temperature','billet_temp','breakthrough_pressure',
  'running_pressure','billet_length','alloy','ram_speed','any_delay_observed'];

const hasAnyValue = (obj) => BILLET_COLS.some((c) => String(obj?.[c] ?? '').trim() !== '');

async function saveBilletParameters(client, qdId, params) {
  for (const billet of BILLETS) {
    const data = params?.[billet];
    if (!data || !hasAnyValue(data)) {
      await client.query('DELETE FROM qd_billet_parameters WHERE qd_id = $1 AND billet = $2', [qdId, billet]);
      continue;
    }
    const vals = BILLET_COLS.map((c) => String(data[c] ?? '').trim() || null);
    await client.query(
      `INSERT INTO qd_billet_parameters (qd_id, billet, ${BILLET_COLS.join(', ')})
       VALUES ($1, $2, ${BILLET_COLS.map((_, i) => `$${i + 3}`).join(', ')})
       ON CONFLICT (qd_id, billet) DO UPDATE SET
         ${BILLET_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      [qdId, billet, ...vals]);
  }
}

async function listBilletParameters(client, qdIds) {
  const map = new Map();
  if (!qdIds || !qdIds.length) return map;
  const { rows } = await client.query(
    `SELECT * FROM qd_billet_parameters WHERE qd_id = ANY($1)`, [qdIds]);
  for (const r of rows) {
    if (!map.has(r.qd_id)) map.set(r.qd_id, []);
    map.get(r.qd_id).push(r);
  }
  return map;
}
```

In `listQDs`, after building `files`/`activity`, also fetch billets and attach:

```js
  const billets = await listBilletParameters(client, ids);
  // ... in the final map(): billets: billets.get(r.id) || [],
```

Export `BILLETS, saveBilletParameters, listBilletParameters`.

- [ ] **Step 4: Run, verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): billet parameters + Part-A/Part-B editable fields"
```

---

### Task 9: Route — persist full Part-A on create; billet + category endpoints

**Files:**
- Modify: `server/routes/quality-discrepancies.cjs`, `server/services/qualityDiscrepancies.cjs` (createQD already extended in Task 5 — add the Part-A header fields there too)

**Interfaces:**
- Produces: POST `/` accepts the full Part-A payload + `billets`; file upload accepts a `category` field.

- [ ] **Step 1: Extend `createQD` INSERT with Part-A header columns**

Add `dieReceivedDate, press, dieType, dieSize, noOfCavity, tooling, noOfTrials, noOfCorrections, productionDate, manufacturingDefect, diePerformance, recommendedAction` to the destructure and the INSERT column/param lists (all nullable TEXT).

- [ ] **Step 2: POST `/` — accept and persist the new fields + billets**

In the POST handler, read the extra fields from `req.body`, pass them to `createQD`, and after create call:
```js
    if (req.body.billets) await qd.saveBilletParameters(client, id, req.body.billets);
```
(inside the same transaction, before COMMIT).

- [ ] **Step 3: File upload — store category**

In `POST /:id/files`, read `req.body.category` (validate against `['profile_image','approved_design','trial_photo','general']`, default `general`) and include it in the INSERT:
```js
    const category = ['profile_image','approved_design','trial_photo','general'].includes(req.body.category) ? req.body.category : 'general';
    // add category to the INSERT columns/values
```

- [ ] **Step 4: Verify** — `npm run lint`, then module-load smoke:
```bash
docker exec die-ordering-backend node -e "require('/app/server/routes/quality-discrepancies.cjs'); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/quality-discrepancies.cjs server/services/qualityDiscrepancies.cjs
git commit -m "feat(qd): persist full Part-A fields, billets and image categories on create"
```

---

### Task 10: PDF generator (`qdPdf.cjs`)

**Files:**
- Create: `server/services/qdPdf.cjs`
- Create: `server/services/qdPdf.test.cjs`
- Add asset: `server/assets/gulfex-logo.png` (extract from the sample PDF if not already present)

**Interfaces:**
- Produces: `async generateQdPdf(qd, { files, billets, logoBytes, fileBytes }) -> Uint8Array`
  - `qd`: the QD row; `billets`: array of billet rows; `files`: file metadata with `category`; `fileBytes`: `Map<fileId, Buffer>` of image bytes to embed; `logoBytes`: optional logo image bytes.

- [ ] **Step 1: Write a smoke test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateQdPdf } = require('./qdPdf.cjs');

const baseQd = {
  qd_no: '2026PH-04', die_no: '30601-201', profile_number: '30601', supplier: 'Phoenix',
  raised_date: '2026-06-04', press: 'P2', die_type: 'Hollow', die_size: '475x280',
  no_of_cavity: '1', tooling: 'BOL 30587', no_of_trials: '5', no_of_corrections: '4',
  issue_detail: 'Heavy blend observed on the profile after trial production.',
  manufacturing_defect: 'No', die_performance: 'Yes',
  recommended_action: 'Provide a replacement FOC dieplate on an urgent basis.',
  prepared_by: 'Veera', supplier_acceptance: null, closed_at: null,
};

test('generateQdPdf returns a non-empty PDF for a fully-populated QD', async () => {
  const bytes = await generateQdPdf(baseQd, { files: [], billets: [
    { billet: 'first', billet_temp: '502', running_pressure: '167' },
    { billet: 'last',  billet_temp: '498', running_pressure: '162' },
  ], fileBytes: new Map() });
  assert.ok(bytes.length > 800);
  // PDF magic header
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});

test('generateQdPdf tolerates missing optional fields and no images', async () => {
  const bytes = await generateQdPdf({ qd_no: '2026PH-05', die_no: 'x' }, { files: [], billets: [], fileBytes: new Map() });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL (module missing).

- [ ] **Step 3: Implement `qdPdf.cjs`**

Use `pdf-lib` to draw the form. Keep it a single, well-commented module. Skeleton with the real drawing primitives:

```js
'use strict';
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const GREEN = rgb(0.13, 0.70, 0.36);
const GREY = rgb(0.75, 0.75, 0.75);
const BLACK = rgb(0, 0, 0);

const t = (v) => (v == null ? '' : String(v));

async function generateQdPdf(qd, { files = [], billets = [], logoBytes = null, fileBytes = new Map() } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]); // A4 portrait, points
  const M = 30;
  let y = 812;

  const text = (s, x, yy, { size = 9, f = font, color = BLACK } = {}) =>
    page.drawText(t(s).slice(0, 120), { x, y: yy, size, font: f, color });
  const box = (x, yy, w, h, color = BLACK, width = 0.7) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: color, borderWidth: width });
  const fill = (x, yy, w, h, color) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });

  // Header band: logo + title + DATE / QD#
  if (logoBytes) {
    try { const img = await doc.embedPng(logoBytes); page.drawImage(img, { x: M, y: y - 34, width: 120, height: 34 }); }
    catch { /* logo optional */ }
  }
  text('Quality Discrepancy', 230, y - 22, { size: 15, f: bold });
  box(M, y - 44, 535, 44);
  text('DATE', 470, y - 16, { f: bold }); text(t(qd.raised_date), 505, y - 16);
  text('QD #', 470, y - 34, { f: bold }); text(t(qd.qd_no), 505, y - 34);
  y -= 52;

  // Part-A header row (green) — draw the label band then the value cells
  fill(M, y - 16, 535, 16, GREEN);
  const hdrs = ['Profile', 'Die no', 'Received', 'Supplier', 'Press', 'Die Type', 'Die size', 'Cavity', 'Tooling', 'Trials', 'Corr.'];
  const vals = [qd.profile_number, qd.die_no, qd.die_received_date, qd.supplier, qd.press,
    qd.die_type, qd.die_size, qd.no_of_cavity, qd.tooling, qd.no_of_trials, qd.no_of_corrections];
  const colW = 535 / hdrs.length;
  hdrs.forEach((h, i) => text(h, M + 3 + i * colW, y - 12, { size: 7, f: bold, color: rgb(1, 1, 1) }));
  y -= 16; box(M, y - 16, 535, 16);
  vals.forEach((v, i) => text(v, M + 3 + i * colW, y - 12, { size: 7 }));
  y -= 24;

  // Production parameters (1st / last billet)
  fill(M, y - 14, 535, 14, GREEN);
  text('Production Parameters', 250, y - 11, { size: 8, f: bold, color: rgb(1, 1, 1) });
  y -= 14;
  const pcols = ['', 'Soak', 'Die T', 'Billet T', 'B/thru', 'Running', 'Length', 'Alloy', 'Ram'];
  const pw = 535 / pcols.length;
  box(M, y - 14, 535, 14); pcols.forEach((h, i) => text(h, M + 3 + i * pw, y - 10, { size: 7, f: bold }));
  y -= 14;
  for (const label of ['first', 'last']) {
    const b = billets.find((x) => x.billet === label) || {};
    const row = [label === 'first' ? '1st' : 'Last', b.die_soaking_hours, b.die_temperature, b.billet_temp,
      b.breakthrough_pressure, b.running_pressure, b.billet_length, b.alloy, b.ram_speed];
    box(M, y - 14, 535, 14); row.forEach((v, i) => text(v, M + 3 + i * pw, y - 10, { size: 7 }));
    y -= 14;
  }
  y -= 8;

  // Quality Discrepancy description (wrapped)
  text('Quality Discrepancy:', M, y, { f: bold, size: 10 }); y -= 14;
  y = drawWrapped(page, font, t(qd.issue_detail || qd.issue_summary), M, y, 535, 9);
  y -= 6;

  // Defect classification
  text(`Manufacturing Defect: ${t(qd.manufacturing_defect) || '—'}    Die Performance: ${t(qd.die_performance) || '—'}`, M, y, { size: 9, f: bold });
  y -= 20;

  // Images: profile_image + approved_design slots
  y = await drawImageSlots(doc, page, files, fileBytes, M, y);

  // Recommended action
  text('Recommended Action:', M, y, { f: bold, size: 10 }); y -= 14;
  y = drawWrapped(page, font, t(qd.recommended_action), M, y, 535, 9); y -= 10;

  // Part-B (supplier)
  fill(M, y - 14, 535, 14, GREY); text('Part-B (To be filled by Supplier)', 210, y - 11, { size: 8, f: bold }); y -= 14;
  text(`Acceptance: ${t(qd.supplier_acceptance) || '—'}    ETA: ${t(qd.eta_date) || '—'}`, M, y - 12, { size: 9 }); y -= 24;
  text('Action Taken:', M, y, { f: bold, size: 9 }); y -= 12;
  y = drawWrapped(page, font, t(qd.action_taken), M, y, 535, 9); y -= 6;
  text('Supplier Comments / Corrective Action:', M, y, { f: bold, size: 9 }); y -= 12;
  y = drawWrapped(page, font, t(qd.supplier_comments), M, y, 535, 9); y -= 10;

  // Sign-off
  text(`Prepared By: ${t(qd.prepared_by)}`, M, y, { size: 9 });
  text(`Authorized By: ${t(qd.approved_by_name || '')}`, 210, y, { size: 9 });
  text(`Closed on: ${t(qd.closed_at) || '—'}`, 420, y, { size: 9 });

  return doc.save();
}

// helpers ---------------------------------------------------------------
function drawWrapped(page, font, str, x, y, maxW, size) {
  const words = t(str).split(/\s+/); let line = ''; let yy = y;
  const flush = () => { if (line) { page.drawText(line, { x, y: yy, size, font }); yy -= size + 3; line = ''; } };
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW) { flush(); line = w; } else { line = test; }
  }
  flush();
  return yy;
}

async function drawImageSlots(doc, page, files, fileBytes, x, y) {
  const slots = [['profile_image', 'Profile Image'], ['approved_design', 'Approved design']];
  const boxW = 260, boxH = 120; let sx = x;
  for (const [cat, label] of slots) {
    page.drawRectangle({ x: sx, y: y - boxH, width: boxW, height: boxH, borderColor: rgb(0,0,0), borderWidth: 0.7 });
    page.drawText(label, { x: sx + 4, y: y - 12, size: 8, font: await doc.embedFont(StandardFonts.HelveticaBold) });
    const f = files.find((ff) => ff.category === cat);
    const bytes = f && fileBytes.get(f.id);
    if (bytes) {
      try {
        const img = /png$/i.test(f.mime_type || f.original_name) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        page.drawImage(img, { x: sx + 4, y: y - boxH + 4, width: boxW - 8, height: boxH - 20 });
      } catch { /* skip unrenderable image */ }
    }
    sx += boxW + 15;
  }
  return y - boxH - 10;
}

module.exports = { generateQdPdf };
```

> Note: this is a faithful-but-pragmatic rendition (single page, overflow tolerated). Fidelity refinements (exact column widths, second page for extra trial photos) can follow once the smoke test passes — do not block the task on pixel-matching.

- [ ] **Step 4: Extract the logo asset** — if `server/assets/gulfex-logo.png` doesn't exist, extract page-1 top-left image from `320601-201 Quality discrepancy 2026PH-04.pdf` (or ask the user for the logo PNG). Store it; `generateQdPdf` treats it as optional so tests pass without it.

- [ ] **Step 5: Run, verify pass** — `npm test` → PASS (both smoke tests).

- [ ] **Step 6: Commit**

```bash
git add server/services/qdPdf.cjs server/services/qdPdf.test.cjs server/assets/
git commit -m "feat(qd): standard-format PDF generator (pdf-lib)"
```

---

### Task 11: Route — document endpoint + PDF attached to the Purchase email

**Files:**
- Modify: `server/routes/quality-discrepancies.cjs`
- Modify: `server/services/email.cjs` (allow attachments) — small, additive

**Interfaces:**
- Consumes: `qdPdf.generateQdPdf`, `qd.listBilletParameters`.
- Produces: `GET /:id/document` (streams PDF); `sendPurchaseEmail` now attaches the PDF.

- [ ] **Step 1: Add attachment support to `sendEmail`**

In `email.cjs`, add an optional `attachments` param and pass it to `transporter.sendMail`:

```js
async function sendEmail({ to, cc, subject, body, importance = 'normal', orderId = null, sentBy = null, attachments = null }) {
  // ...
  const info = await transporter.sendMail({
    from: config.mailbox_email || config.email_user, to, cc: cc || undefined,
    subject, html: body,
    attachments: attachments || undefined,
    priority: importance === 'high' ? 'high' : importance === 'low' ? 'low' : 'normal',
  });
  // ...
}
```

- [ ] **Step 2: Add a helper to build the PDF for a QD id**

In the route file:

```js
const fsp2 = require('fs/promises');
const qdPdf = require('../services/qdPdf.cjs');
const pathMod = require('path');

async function buildQdPdfBytes(qdId) {
  const [{ rows: qrows }, filesRes] = await Promise.all([
    pool.query('SELECT * FROM quality_discrepancies WHERE id = $1', [qdId]),
    pool.query('SELECT id, original_name, mime_type, stored_path, category FROM quality_discrepancy_files WHERE qd_id = $1', [qdId]),
  ]);
  const row = qrows[0];
  if (!row) throw new Error('QD not found');
  if (row.approved_by) {
    const u = await pool.query('SELECT username FROM users WHERE id = $1', [row.approved_by]);
    row.approved_by_name = u.rows[0]?.username || '';
  }
  const billets = (await qd.listBilletParameters(pool, [qdId])).get(qdId) || [];
  const fileBytes = new Map();
  const root = pathMod.resolve(store.getRoot());
  for (const f of filesRes.rows) {
    if (!/(png|jpe?g|webp)$/i.test(f.original_name)) continue;
    try { fileBytes.set(f.id, await fsp2.readFile(pathMod.resolve(root, f.stored_path))); } catch { /* skip */ }
  }
  let logoBytes = null;
  try { logoBytes = await fsp2.readFile(pathMod.join(__dirname, '..', 'assets', 'gulfex-logo.png')); } catch { /* optional */ }
  return { row, bytes: await qdPdf.generateQdPdf(row, { files: filesRes.rows, billets, fileBytes, logoBytes }) };
}
```

- [ ] **Step 3: `GET /:id/document`** (place before `/:id` patch, after `/files/:fileId`):

```js
router.get('/:id/document', async (req, res) => {
  try {
    const { row, bytes } = await buildQdPdfBytes(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="QD-${row.qd_no || row.id}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    if (/QD not found/.test(e.message)) return res.status(404).json({ error: e.message });
    console.error('QD document error:', e); res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Attach PDF in `sendPurchaseEmail`**

Update `sendPurchaseEmail` (from Task 5) to build and attach the PDF:

```js
async function sendPurchaseEmail(qdId, sentBy) {
  const { row, bytes } = await buildQdPdfBytes(qdId);
  const { purchaseEmailTo, purchaseEmailCc } = await qdSettings.getQdSettings(pool);
  if (!purchaseEmailTo) throw new Error('No Purchase recipient configured (Settings → QD)');
  await email.sendEmail({
    to: purchaseEmailTo, cc: purchaseEmailCc || undefined,
    subject: qd.purchaseEmailSubject(row), body: qd.buildPurchaseEmailHtml(row),
    importance: 'high', sentBy,
    attachments: [{ filename: `QD-${row.qd_no || row.id}.pdf`, content: Buffer.from(bytes), contentType: 'application/pdf' }],
  });
}
```

- [ ] **Step 5: Verify** — `npm run lint`, then generate a PDF through the container for a known QD id (use a real id from the DB):
```bash
docker exec die-ordering-backend node -e "const r=require('/app/server/routes/quality-discrepancies.cjs'); console.log('ok')"
```
Expected: `ok`. Optionally hit `GET /api/quality-discrepancies/<id>/document` through the proxy and confirm a PDF downloads.

- [ ] **Step 6: Commit**

```bash
git add server/routes/quality-discrepancies.cjs server/services/email.cjs
git commit -m "feat(qd): QD document endpoint + PDF attached to the Purchase email"
```

---

### Task 12: Frontend — full standard-format raise form with auto-fill

**Files:**
- Modify: `src/components/qd/RaiseQDModal.jsx` (restructure into sections)
- Modify: `src/api.js` (die lookup for auto-fill — reuse `ordersAPI`/`existingDataAPI`)

**Interfaces:**
- Consumes: die/order lookup; POST `/` full payload (Part-A + `billets`); file upload with `category`.

- [ ] **Step 1: Die picker + auto-fill**

Add a searchable Die No input at the top. On selection (or blur match), fetch the die record (`ordersAPI.getAll` is already loaded app-wide; filter by `die_no`, or add `ordersAPI.getByDieNo` if one exists) and prefill state: `profileNumber, supplier, press, dieReceivedDate, noOfTrials`, plus `dieType/dieSize/noOfCavity/tooling` when present. Keep every field editable; store `dieOrderId`.

- [ ] **Step 2: Sectioned form state**

Expand component state to cover all Part-A fields and a `billets` object:

```jsx
const [partA, setPartA] = useState({
  profileNumber: '', dieReceivedDate: '', press: '', dieType: '', dieSize: '',
  noOfCavity: '', tooling: '', noOfTrials: '', noOfCorrections: '', productionDate: '',
  manufacturingDefect: '', diePerformance: '', recommendedAction: '',
});
const [billets, setBillets] = useState({ first: {}, last: {} });
```

Render collapsible `<section>`s: Die details, Production parameters (a 2-row grid bound to `billets.first`/`billets.last`), Discrepancy (existing `issue` + defect Yes/No toggles + `recommendedAction`), Images (existing uploader + a category `<select>` per file). Reuse the existing field styles from the current modal.

- [ ] **Step 3: Submit wiring**

Footer keeps *Save Draft* and adds *Submit for approval*:

```jsx
const save = async (submit) => {
  const { id } = await qualityDiscrepanciesAPI.create({
    dieNo: dieNo.trim(), plant, supplier: supplier.trim(), corrector: corrector.trim(),
    issue: issue.trim(), outcome, inputAtFailure: inputAtFailure.trim(),
    dieReceivedDate: partA.dieReceivedDate, press: partA.press, dieType: partA.dieType,
    dieSize: partA.dieSize, noOfCavity: partA.noOfCavity, tooling: partA.tooling,
    noOfTrials: partA.noOfTrials, noOfCorrections: partA.noOfCorrections, productionDate: partA.productionDate,
    manufacturingDefect: partA.manufacturingDefect, diePerformance: partA.diePerformance,
    recommendedAction: partA.recommendedAction, dieOrderId, billets,
  });
  if (files.length) await qualityDiscrepanciesAPI.uploadFiles(id, files, fileCategory);
  if (submit) await qualityDiscrepanciesAPI.submit(id);
  onCreated(id);
};
```

(Extend `uploadFiles` to send `category` as a form field.)

- [ ] **Step 4: Verify** — `npm run lint && npm run build`. Manual: raise a QD with the sample `2026PH-04` data, Save Draft, confirm it appears under Drafts and not the main register.

- [ ] **Step 5: Commit**

```bash
git add src/components/qd/RaiseQDModal.jsx src/api.js
git commit -m "feat(qd): full standard-format raise form with die auto-fill and billets"
```

---

### Task 13: Frontend — Part-B capture + document download in the drawer

**Files:**
- Modify: `src/components/qd/QDDetailPanel.jsx`, `src/api.js`

**Interfaces:**
- Consumes: PATCH `/:id` (Part-B fields via existing `update`); `GET /:id/document`.

- [ ] **Step 1: Part-B editor**

Add editable fact cards (reuse the existing click-to-edit fact-card pattern in this component) for `supplier_acceptance` (Yes/No select), `action_taken`, `supplier_comments`, `received_by_supplier`, alongside the existing `eta_date`. Each saves via `qualityDiscrepanciesAPI.update(id, { field: value })`.

- [ ] **Step 2: Download / print the QD document**

Add a "Download QD PDF" button:

```js
// api.js
downloadDocument: async (id, qdNo) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/quality-discrepancies/${id}/document`, {
    headers: { ...(token && { Authorization: `Bearer ${token}` }) } });
  if (!res.ok) throw new Error(`Document failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `QD-${qdNo || id}.pdf`; a.click();
  URL.revokeObjectURL(url);
},
```

Wire the button to `qualityDiscrepanciesAPI.downloadDocument(qd.id, qd.qd_no)`.

- [ ] **Step 3: Verify** — `npm run lint && npm run build`. Manual: open an approved QD → Download QD PDF returns the formatted document; edit a Part-B field → it persists and shows on the timeline.

- [ ] **Step 4: Commit**

```bash
git add src/components/qd/QDDetailPanel.jsx src/api.js
git commit -m "feat(qd): Part-B capture and QD document download in the drawer"
```

**PHASE 2 COMPLETE.**

---

## Final verification

- [ ] `npm test` — all backend suites green.
- [ ] `npm run lint && npm run build` — clean.
- [ ] End-to-end against the sample: raise `2026PH-04` (full data) → Save Draft → Submit (number assigned) → approve as an approver → Purchase email fires with PDF → open PDF and compare to `320601-201 Quality discrepancy 2026PH-04.pdf`.
- [ ] Confirm existing QDs still show as `Approved`, the register KPIs are unchanged, and the existing status flow (Sent to Supplier / FOC Accepted / Rejected / Closed) still works.

## Self-review notes (coverage against the spec)

- Approval dimension, Draft numbering-on-submit, Draft hiding, backfill-to-Approved → Tasks 1, 2, 5.
- Approver = named users + Purchase recipients + gating → Tasks 3, 5, 6.
- Purchase email (non-blocking, resend) → Tasks 4, 5, 11.
- Full Part-A capture + auto-fill → Tasks 7, 8, 9, 12.
- Billet parameters child table → Tasks 7, 8, 9, 12.
- Part-B staff entry → Tasks 8, 13.
- PDF generation + attachment + download → Tasks 10, 11, 13.
- Image categories → Tasks 7, 9, 10, 12.
- KPI/status vocabulary untouched → guaranteed by excludeDrafts feeding KPIs and no change to STATUSES.
