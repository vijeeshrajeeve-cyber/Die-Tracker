# Die Delivery Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the In Manufacturing page into a delivery follow-up worklist driven by the die ETA — buckets, slip history with causes, a per-die follow-up log, and a supplier chaser email.

**Architecture:** One timeline table (`die_delivery_events`) plus a chaser log (`die_delivery_chasers`). A single server service owns the ETA rules and is called from the order routes, a new `/api/delivery-followups` router and the chaser. The frontend gets a dedicated `InManufacturingPage` (same tab id) with a follow-up drawer; internal reminders stay with the existing Work Queue.

**Tech Stack:** Node/Express (CommonJS `.cjs`), PostgreSQL via `pg`, React 18 + Vite (ESM `.js/.jsx`), `node:test`.

Spec: `docs/superpowers/specs/2026-09-22-die-delivery-followup-design.md`

## Global Constraints

- `die_orders.eta` stays `TEXT`. Only `normalizeEta` decides whether a value is a date; `TBC`, blank and unreadable values mean **No ETA**.
- Causes: `supplier_delay`, `our_change`, `logistics`, `other` (`other` needs a note). Channels: `email`, `phone`, `whatsapp`, `meeting`, `other`.
- Changing a stored real-date ETA without a valid cause → **400 `{ code: 'ETA_CAUSE_REQUIRED' }`**, nothing written.
- The chaser ships **disabled** (`delivery_chaser_enabled = false`), defaults `time '08:00'`, `interval_days 3`, `no_eta_days 7`.
- "Today" is the local day: `todayLocal()` (`server/services/dates.cjs`, `src/utils/today.js`).
- DATE columns come back from `pg` as strings (`types.setTypeParser(1082, …)`); never select a DATE inside an array.
- Tests: `npm test` (`node --test "server/**/*.test.cjs" "src/**/*.test.js"`). Lint only your own files with `npx eslint <files>` — the repo has 77 pre-existing lint errors. `npm run build` separately.
- Test server rebuilds: `docker compose build backend frontend && docker compose up -d backend frontend` (restart alone runs old code).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `server/services/deliveryFollowup.cjs` (new) | ETA parser, change rule, follow-up validation, summary derivation, event inserts |
| `server/services/deliveryChaser.cjs` (new) | Chaser settings, candidate classification, cadence, email body, send/preview, scheduler |
| `server/routes/delivery-followups.cjs` (new) | `GET /`, `GET /:orderId/events`, `POST /:orderId` |
| `server/routes/orders.cjs` | PATCH/PUT read ETA under lock, enforce cause, write event in the same transaction |
| `server/routes/email.cjs` | Chaser settings / run-now / preview routes |
| `server/routes/testSupport.cjs` | Fake pool gains `connect()`; `request` gains `method` |
| `server/services/focReminder.cjs` | Export `escapeHtml` and `table` for reuse |
| `server/db.cjs`, `init.sql` | New tables; `reminder_settings` columns (db.cjs only) |
| `server/index.cjs` | Mount router, start chaser scheduler |
| `src/utils/deliveryFollowup.js` (new) | Client ETA parser, buckets, chips, sort, form validation, labels |
| `src/api.js` | `deliveryFollowupsAPI`, chaser methods on `emailAPI` |
| `src/pages/InManufacturingPage.jsx` (new) | The worklist page |
| `src/components/delivery/DieReceivanceModal.jsx` (new) | Receipt dialog moved out of FlowPage, unchanged behaviour |
| `src/components/delivery/DeliveryFollowupDrawer.jsx` (new) | Follow-up form + timeline |
| `src/components/delivery/EtaCauseDialog.jsx` (new) | Cause prompt for the order form |
| `src/components/email/DeliveryChaserSettings.jsx` (new) | Settings panel |
| `src/pages/FlowPage.jsx` | Drop the `DONE` branch |
| `src/DieOrderingSystem.jsx` | Route `flow-completed` to the new page; order-form cause prompt |
| `src/components/email/EmailSettings.jsx` | Render the chaser panel |

---

### Task 1: ETA rules service and schema

**Files:**
- Create: `server/services/deliveryFollowup.cjs`
- Test: `server/services/deliveryFollowup.test.cjs`
- Modify: `server/db.cjs` (after the `daily_summary_*` ALTERs ~line 822, and after `idx_daily_report_ledger_reported_on` ~line 837)
- Modify: `init.sql` (after `idx_daily_report_ledger_reported_on` ~line 602)

**Interfaces:**
- Produces (`require('../services/deliveryFollowup.cjs')`):
  - `CAUSES: string[]`, `CHANNELS: string[]`
  - `class DeliveryRuleError extends Error { status: 400; code: string }`
  - `normalizeEta(value) → 'YYYY-MM-DD' | null`
  - `daysBetween(from, to) → number` (ISO days)
  - `planEtaChange(stored, incoming, change?) → null | { kind: 'eta_set', before: null, after } | { kind: 'eta_revised', before, after, cause, note }` — throws `DeliveryRuleError('…', 'ETA_CAUSE_REQUIRED')`
  - `validateFollowUp(body, today) → { contactDate, channel, note|null, newEta|null, change: { cause, note } }` — throws `DeliveryRuleError`
  - `summarize(row) → { originalEta, slips, daysSlipped, lastContact: {date, channel}|null, lastChasedAt: ISO|null }`
  - `insertEtaEvent(db, orderId, plan, user) → event row`
  - `insertContactEvent(db, orderId, { contactDate, channel, note }, user) → event row`
  - `EVENT_COLUMNS: string` (SQL select list with DATEs cast to text)

- [ ] **Step 1: Write the failing test** — `server/services/deliveryFollowup.test.cjs`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./deliveryFollowup.cjs');

test('normalizeEta accepts the date forms the order routes accept', () => {
  assert.equal(d.normalizeEta('2026-10-01'), '2026-10-01');
  assert.equal(d.normalizeEta('2026-10-01T00:00:00.000Z'), '2026-10-01');
  assert.equal(d.normalizeEta('1/10/2026'), '2026-10-01');
  assert.equal(d.normalizeEta('01.10.2026'), '2026-10-01');
  assert.equal(d.normalizeEta(' 01-10-2026 '), '2026-10-01');
});

test('normalizeEta treats anything else as no ETA', () => {
  for (const v of [null, undefined, '', '  ', 'TBC', 'next week', '2026-02-30', '31/02/2026', 'Oct 1 2026']) {
    assert.equal(d.normalizeEta(v), null, String(v));
  }
});

test('a first ETA is recorded as set, with no cause needed', () => {
  assert.deepEqual(d.planEtaChange(null, '2026-10-01'), { kind: 'eta_set', before: null, after: '2026-10-01' });
  assert.deepEqual(d.planEtaChange('TBC', '2026-10-01'), { kind: 'eta_set', before: null, after: '2026-10-01' });
});

test('an unchanged date records nothing, even in another format', () => {
  assert.equal(d.planEtaChange('2026-10-01', '01/10/2026'), null);
  assert.equal(d.planEtaChange('', 'TBC'), null);
});

test('moving a set ETA needs a cause', () => {
  assert.throws(() => d.planEtaChange('2026-10-01', '2026-10-15'),
    (e) => e instanceof d.DeliveryRuleError && e.code === 'ETA_CAUSE_REQUIRED' && e.status === 400);
  assert.throws(() => d.planEtaChange('2026-10-01', '2026-10-15', { cause: 'weather' }), { code: 'ETA_CAUSE_REQUIRED' });
  assert.throws(() => d.planEtaChange('2026-10-01', '2026-10-15', { cause: 'other' }), { code: 'ETA_CAUSE_REQUIRED' });
  assert.deepEqual(d.planEtaChange('2026-10-01', '2026-10-15', { cause: 'supplier_delay', note: ' Heat treatment ' }),
    { kind: 'eta_revised', before: '2026-10-01', after: '2026-10-15', cause: 'supplier_delay', note: 'Heat treatment' });
});

test('clearing a set ETA is a revision too', () => {
  assert.throws(() => d.planEtaChange('2026-10-01', ''), { code: 'ETA_CAUSE_REQUIRED' });
  assert.deepEqual(d.planEtaChange('2026-10-01', 'TBC', { cause: 'logistics' }),
    { kind: 'eta_revised', before: '2026-10-01', after: null, cause: 'logistics', note: null });
});

test('a follow-up needs a date, a channel and a reply or a new ETA', () => {
  const ok = { contactDate: '2026-09-22', channel: 'phone', note: 'Dispatching Friday' };
  assert.deepEqual(d.validateFollowUp(ok, '2026-09-22'),
    { contactDate: '2026-09-22', channel: 'phone', note: 'Dispatching Friday', newEta: null, change: { cause: undefined, note: undefined } });
  assert.throws(() => d.validateFollowUp({ ...ok, contactDate: '' }, '2026-09-22'), d.DeliveryRuleError);
  assert.throws(() => d.validateFollowUp({ ...ok, contactDate: '2026-09-23' }, '2026-09-22'), /future/);
  assert.throws(() => d.validateFollowUp({ ...ok, channel: 'fax' }, '2026-09-22'), /contacted/);
  assert.throws(() => d.validateFollowUp({ ...ok, note: ' ' }, '2026-09-22'), /reply or give a new ETA/);
  assert.throws(() => d.validateFollowUp({ ...ok, newEta: 'soon' }, '2026-09-22'), /Invalid new ETA/);
  assert.equal(d.validateFollowUp({ ...ok, note: '', newEta: '2026-10-09' }, '2026-09-22').newEta, '2026-10-09');
});

test('summaries derive the original ETA and slips from the revisions', () => {
  assert.deepEqual(d.summarize({ id: 1, eta: '2026-10-15', first_revised_from: '2026-10-01', slips: 2,
    last_contact_date: '2026-09-20', last_contact_channel: 'email', last_chased_at: new Date('2026-09-21T04:00:00Z') }),
  { originalEta: '2026-10-01', slips: 2, daysSlipped: 14,
    lastContact: { date: '2026-09-20', channel: 'email' }, lastChasedAt: '2026-09-21T04:00:00.000Z' });
  assert.deepEqual(d.summarize({ id: 2, eta: '2026-10-01', first_revised_from: null, slips: 0 }),
    { originalEta: '2026-10-01', slips: 0, daysSlipped: 0, lastContact: null, lastChasedAt: null });
  assert.equal(d.summarize({ id: 3, eta: 'TBC', first_revised_from: null, slips: 0 }).originalEta, null);
});

test('event inserts carry who did it', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 9 }] }; } };
  await d.insertEtaEvent(db, 4, { kind: 'eta_revised', before: '2026-10-01', after: '2026-10-15', cause: 'our_change', note: null }, { id: 2, username: 'amal' });
  assert.match(calls[0].sql, /INSERT INTO die_delivery_events/);
  assert.deepEqual(calls[0].params, [4, 'eta_revised', '2026-10-01', '2026-10-15', 'our_change', null, 2, 'amal']);
  await d.insertContactEvent(db, 4, { contactDate: '2026-09-22', channel: 'phone', note: 'Friday' }, null);
  assert.deepEqual(calls[1].params, [4, '2026-09-22', 'phone', 'Friday', null, null]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test server/services/deliveryFollowup.test.cjs`
Expected: FAIL — `Cannot find module './deliveryFollowup.cjs'`

- [ ] **Step 3: Implement** — `server/services/deliveryFollowup.cjs`

```js
'use strict';
/**
 * Die delivery follow-up — the rules shared by the order routes, the
 * follow-up routes and the supplier chaser.
 *
 * die_orders.eta is TEXT and may hold "TBC", so nothing here treats a string
 * as a date unless normalizeEta says it is one. src/utils/deliveryFollowup.js
 * holds the client copy; its test checks the two agree.
 */

const CAUSES = Object.freeze(['supplier_delay', 'our_change', 'logistics', 'other']);
const CHANNELS = Object.freeze(['email', 'phone', 'whatsapp', 'meeting', 'other']);

class DeliveryRuleError extends Error {
  constructor(message, code = 'INVALID') {
    super(message);
    this.status = 400;
    this.code = code;
  }
}

// A real calendar date as 'YYYY-MM-DD', or null. Accepts the forms the order
// routes' sanitizeDate accepts: YYYY-MM-DD, an ISO datetime, DD/MM/YYYY,
// DD-MM-YYYY and DD.MM.YYYY. A day that does not exist (31/02) is null.
function normalizeEta(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  let y; let m; let d;
  if (iso) [, y, m, d] = iso;
  else if (dmy) [, d, m, y] = dmy;
  else return null;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function validateCause(change) {
  const cause = change && typeof change.cause === 'string' ? change.cause.trim() : '';
  const note = change && change.note != null ? String(change.note).trim().slice(0, 1000) : '';
  if (!cause) throw new DeliveryRuleError('A cause is required to change an ETA that was already set', 'ETA_CAUSE_REQUIRED');
  if (!CAUSES.includes(cause)) throw new DeliveryRuleError(`Unknown ETA change cause: ${cause}`, 'ETA_CAUSE_REQUIRED');
  if (cause === 'other' && !note) throw new DeliveryRuleError('Say what the other cause is in the note', 'ETA_CAUSE_REQUIRED');
  return { cause, note: note || null };
}

// What an incoming ETA means against the stored one. A first real date is
// logged without a cause; moving or clearing a real date needs one.
function planEtaChange(stored, incoming, change) {
  const before = normalizeEta(stored);
  const after = normalizeEta(incoming);
  if (before === after) return null;
  if (!before) return { kind: 'eta_set', before: null, after };
  return { kind: 'eta_revised', before, after, ...validateCause(change) };
}

// Every follow-up is a contact (date + channel). It must carry the
// supplier's reply, a new ETA, or both.
function validateFollowUp(body = {}, today) {
  const contactDate = normalizeEta(body.contactDate);
  if (!contactDate) throw new DeliveryRuleError('A valid follow-up date is required');
  if (contactDate > today) throw new DeliveryRuleError('The follow-up date cannot be in the future');
  const channel = String(body.channel || '').trim();
  if (!CHANNELS.includes(channel)) throw new DeliveryRuleError('Pick how the supplier was contacted');
  const note = body.note == null ? '' : String(body.note).trim().slice(0, 2000);
  const rawEta = body.newEta == null ? '' : String(body.newEta).trim();
  const newEta = rawEta ? normalizeEta(rawEta) : null;
  if (rawEta && !newEta) throw new DeliveryRuleError(`Invalid new ETA: ${rawEta} (expected YYYY-MM-DD)`);
  if (!note && !newEta) throw new DeliveryRuleError("Write the supplier's reply or give a new ETA");
  return { contactDate, channel, note: note || null, newEta, change: { cause: body.cause, note: body.causeNote } };
}

// Row from the summaries query → what the page shows. No backfill: a die
// never revised has its current ETA as its original.
function summarize(row) {
  const current = normalizeEta(row.eta);
  const originalEta = row.first_revised_from ? normalizeEta(row.first_revised_from) : current;
  const slips = Number(row.slips) || 0;
  return {
    originalEta,
    slips,
    daysSlipped: slips && originalEta && current ? daysBetween(originalEta, current) : 0,
    lastContact: row.last_contact_date
      ? { date: normalizeEta(row.last_contact_date), channel: row.last_contact_channel }
      : null,
    lastChasedAt: row.last_chased_at ? new Date(row.last_chased_at).toISOString() : null,
  };
}

const EVENT_COLUMNS = `id, order_id, kind, eta_before::text AS eta_before, eta_after::text AS eta_after,
  cause, channel, contact_date::text AS contact_date, note, chaser_id, created_by_name, created_at`;

async function insertEtaEvent(db, orderId, plan, user) {
  const { rows } = await db.query(
    `INSERT INTO die_delivery_events (order_id, kind, eta_before, eta_after, cause, note, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${EVENT_COLUMNS}`,
    [orderId, plan.kind, plan.before, plan.after, plan.cause || null, plan.note || null,
      user?.id || null, user?.username || null]);
  return rows[0];
}

async function insertContactEvent(db, orderId, { contactDate, channel, note }, user) {
  const { rows } = await db.query(
    `INSERT INTO die_delivery_events (order_id, kind, contact_date, channel, note, created_by, created_by_name)
     VALUES ($1, 'contact', $2, $3, $4, $5, $6) RETURNING ${EVENT_COLUMNS}`,
    [orderId, contactDate, channel, note || null, user?.id || null, user?.username || null]);
  return rows[0];
}

module.exports = {
  CAUSES, CHANNELS, DeliveryRuleError, EVENT_COLUMNS,
  normalizeEta, daysBetween, validateCause, planEtaChange, validateFollowUp, summarize,
  insertEtaEvent, insertContactEvent,
};
```

- [ ] **Step 4: Run the test**

Run: `node --test server/services/deliveryFollowup.test.cjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Schema in `server/db.cjs`** — insert after the last `daily_summary_cc` ALTER:

```sql
      -- Die delivery chaser: dies past the supplier's ETA, or with none, out to
      -- each supplier at most once every interval_days. Checked daily at time.
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS delivery_chaser_enabled       BOOLEAN DEFAULT false;
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS delivery_chaser_time          TEXT DEFAULT '08:00';
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS delivery_chaser_last_run      DATE;
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS delivery_chaser_interval_days INTEGER DEFAULT 3;
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS delivery_chaser_no_eta_days   INTEGER DEFAULT 7;
      ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS delivery_chaser_cc            TEXT DEFAULT '';
```

and after `CREATE INDEX IF NOT EXISTS idx_daily_report_ledger_reported_on ON daily_report_ledger(reported_on);`:

```sql
      -- One row per delivery chaser email sent: what the every-N-days rule
      -- counts from, and the record of what went to each supplier.
      CREATE TABLE IF NOT EXISTS die_delivery_chasers (
        id            SERIAL PRIMARY KEY,
        supplier      TEXT NOT NULL,
        recipients    TEXT NOT NULL,
        cc            TEXT,
        overdue_count INTEGER NOT NULL DEFAULT 0,
        no_eta_count  INTEGER NOT NULL DEFAULT 0,
        sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_die_delivery_chasers_supplier
        ON die_delivery_chasers(supplier, sent_at DESC);

      -- A die's delivery timeline. eta_revised keeps the date it replaced, so
      -- the original ETA and every slip survive later edits.
      CREATE TABLE IF NOT EXISTS die_delivery_events (
        id              SERIAL PRIMARY KEY,
        order_id        INTEGER NOT NULL REFERENCES die_orders(id) ON DELETE CASCADE,
        kind            TEXT NOT NULL CHECK (kind IN ('eta_set', 'eta_revised', 'contact', 'chaser_sent')),
        eta_before      DATE,
        eta_after       DATE,
        cause           TEXT CHECK (cause IS NULL OR cause IN ('supplier_delay', 'our_change', 'logistics', 'other')),
        channel         TEXT CHECK (channel IS NULL OR channel IN ('email', 'phone', 'whatsapp', 'meeting', 'other')),
        contact_date    DATE,
        note            TEXT,
        chaser_id       INTEGER REFERENCES die_delivery_chasers(id) ON DELETE SET NULL,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by_name TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT die_delivery_events_kind_fields CHECK (
          (kind = 'eta_set'     AND eta_before IS NULL AND eta_after IS NOT NULL) OR
          (kind = 'eta_revised' AND eta_before IS NOT NULL AND cause IS NOT NULL) OR
          (kind = 'contact'     AND channel IS NOT NULL AND contact_date IS NOT NULL) OR
          (kind = 'chaser_sent')
        )
      );
      CREATE INDEX IF NOT EXISTS idx_die_delivery_events_order
        ON die_delivery_events(order_id, created_at DESC);
```

Copy the same two `CREATE TABLE` + `CREATE INDEX` blocks (not the ALTERs — `reminder_settings` is not mirrored in `init.sql`) into `init.sql` after `idx_daily_report_ledger_reported_on`, at that file's indentation.

- [ ] **Step 6: Validate the DDL on the test server in a rolled-back transaction**

```bash
sed -n '/CREATE TABLE IF NOT EXISTS die_delivery_chasers/,/idx_die_delivery_events_order/p' init.sql > "$TMP/ddl.sql"
# then, from Git Bash:
MSYS_NO_PATHCONV=1 docker exec -i die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -v ON_ERROR_STOP=1 \
  -c 'BEGIN' -f - -c "INSERT INTO die_delivery_events(order_id,kind,eta_before,cause) SELECT id,'eta_revised','2026-10-01','supplier_delay' FROM die_orders LIMIT 1" \
  -c "SAVEPOINT s" -c "INSERT INTO die_delivery_events(order_id,kind,eta_before) SELECT id,'eta_revised','2026-10-01' FROM die_orders LIMIT 1" \
  -c 'ROLLBACK' < "$TMP/ddl.sql"
```
Expected: tables create, first insert succeeds, second fails with `die_delivery_events_kind_fields`, then ROLLBACK (nothing kept). Confirm with `\dt die_delivery*` → no rows.

- [ ] **Step 7: Commit**

```bash
git add server/services/deliveryFollowup.cjs server/services/deliveryFollowup.test.cjs server/db.cjs init.sql
git commit -m "feat(delivery): ETA change rules and the delivery timeline schema"
```

---

### Task 2: Enforce the cause on order updates

**Files:**
- Modify: `server/routes/testSupport.cjs`
- Modify: `server/routes/orders.cjs` (PATCH `/:id` ~269-370, PUT `/:id` ~372-477)
- Test: `server/routes/orders.test.cjs` (new)

**Interfaces:**
- Consumes: `planEtaChange`, `insertEtaEvent`, `DeliveryRuleError` from Task 1.
- Produces: PATCH/PUT accept `body['ETA Change'] = { cause, note }`; 400 body `{ error, code: 'ETA_CAUSE_REQUIRED' }`.

- [ ] **Step 1: Extend `testSupport.cjs`**

In `installFakeDb`, change the exports line to:

```js
  fake.exports = { pool: { query, connect: async () => ({ query, release() {} }) } };
```

and `request` to take a method:

```js
// POST when there is a body, GET otherwise, unless a method is given; always
// parses the JSON answer.
async function request(base, path, { token, body, method } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
```

- [ ] **Step 2: Write the failing test** — `server/routes/orders.test.cjs`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// The stored ETA the next request will find; undefined means no such order.
let storedEta;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT eta FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) {
    return { rows: storedEta === undefined ? [] : [{ eta: storedEta }] };
  }
  if (/^UPDATE die_orders SET/.test(q)) return { rows: [], rowCount: storedEta === undefined ? 0 : 1 };
  if (/^INSERT INTO die_delivery_events/.test(q)) return { rows: [{ id: 1 }] };
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  if (/^UPDATE backup_die_requests/.test(q)) return { rows: [] };
  throw new Error(`orders test: unexpected query ${q}`);
});

const ordersRouter = require('./orders.cjs');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 5, username: 'planner' }; next(); });
app.use('/api/orders', ordersRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => { log = []; storedEta = '2026-10-01'; });

const kinds = () => log.map(({ q }) => q.split(/\s+/).slice(0, 3).join(' '));
const events = () => log.filter(({ q }) => q.startsWith('INSERT INTO die_delivery_events'));
const patch = (body) => request(base, '/api/orders/7', { method: 'PATCH', body });

test('moving a set ETA without a cause is refused and nothing is written', async () => {
  const { status, body } = await patch({ ETA: '2026-10-15' });
  assert.equal(status, 400);
  assert.equal(body.code, 'ETA_CAUSE_REQUIRED');
  assert.ok(!log.some(({ q }) => q.startsWith('UPDATE die_orders')), 'no update issued');
  assert.ok(log.some(({ q }) => q === 'ROLLBACK'));
});

test('with a cause the update and the revision commit together', async () => {
  const { status } = await patch({ ETA: '2026-10-15', 'ETA Change': { cause: 'supplier_delay', note: 'Heat treatment queue' } });
  assert.equal(status, 200);
  // No 'DIE NO' in the body, so autoUpdateBackupRequests returns early.
  assert.deepEqual(kinds(), ['BEGIN', 'SELECT eta FROM', 'UPDATE die_orders SET', 'INSERT INTO die_delivery_events', 'COMMIT']);
  assert.deepEqual(events()[0].params, ['7', 'eta_revised', '2026-10-01', '2026-10-15', 'supplier_delay', 'Heat treatment queue', 5, 'planner']);
});

test('a first ETA is logged as set with no cause', async () => {
  storedEta = null;
  const { status } = await patch({ ETA: '2026-11-01' });
  assert.equal(status, 200);
  assert.equal(events()[0].params[1], 'eta_set');
});

test('re-sending the same ETA records nothing', async () => {
  const { status } = await patch({ ETA: '01/10/2026', Remark: 'checked' });
  assert.equal(status, 200);
  assert.equal(events().length, 0);
});

test('a patch that does not carry ETA never reads it', async () => {
  const { status } = await patch({ Remark: 'checked' });
  assert.equal(status, 200);
  assert.ok(!log.some(({ q }) => q.startsWith('SELECT eta')));
});

test('an unknown order is a 404', async () => {
  storedEta = undefined;
  const { status } = await patch({ ETA: '2026-10-15' });
  assert.equal(status, 404);
});

test('PUT enforces the same rule', async () => {
  const refused = await request(base, '/api/orders/7', { method: 'PUT', body: { ETA: '2026-10-20' } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'ETA_CAUSE_REQUIRED');
  log = [];
  const ok = await request(base, '/api/orders/7', { method: 'PUT', body: { ETA: '2026-10-20', 'ETA Change': { cause: 'our_change' } } });
  assert.equal(ok.status, 200);
  assert.equal(events()[0].params[1], 'eta_revised');
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test server/routes/orders.test.cjs`
Expected: FAIL — first test gets 200 (no rule yet) and `unexpected query` errors for the non-transactional path.

- [ ] **Step 4: Implement in `server/routes/orders.cjs`**

Add below the other requires:

```js
const { planEtaChange, insertEtaEvent, DeliveryRuleError } = require('../services/deliveryFollowup.cjs');
```

Add these helpers above `// Validation error handler`:

```js
// Reads the stored ETA under a row lock and decides what the incoming one
// means. { plan: null } when the body leaves ETA alone or nothing changes;
// null when the order does not exist. Throws DeliveryRuleError for a move
// without a cause.
async function lockEtaPlan(client, id, body) {
    if (!Object.prototype.hasOwnProperty.call(body, 'ETA')) return { plan: null };
    const { rows } = await client.query('SELECT eta FROM die_orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) return null;
    return { plan: planEtaChange(rows[0].eta, body['ETA'], body['ETA Change']) };
}

// The client-written change entries both update routes accept.
async function insertChangeLog(db, id, entries, user) {
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !entry.field) continue;
        const changedAt = entry.date ? new Date(entry.date) : new Date();
        await db.query(
            `INSERT INTO order_changes
              (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                id,
                user?.id || null,
                user?.username || entry.changedBy || null,
                isNaN(changedAt) ? new Date() : changedAt,
                String(entry.field),
                entry.oldValue != null ? String(entry.oldValue) : null,
                entry.newValue != null ? String(entry.newValue) : null,
                entry.reason || null,
                entry.stage || null,
            ]
        );
    }
}

// Runs one order update in a transaction with its ETA event. Resolves to the
// HTTP answer so each route keeps its own success message.
async function updateWithEta(id, body, user, runUpdate) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const eta = await lockEtaPlan(client, id, body);
        if (!eta) {
            await client.query('ROLLBACK');
            return { status: 404, json: { error: 'Order not found' } };
        }
        const result = await runUpdate(client);
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return { status: 404, json: { error: 'Order not found' } };
        }
        if (eta.plan) await insertEtaEvent(client, id, eta.plan, user);
        await insertChangeLog(client, id, body['Change Log'], user);
        await client.query('COMMIT');
        return null;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof DeliveryRuleError) return { status: 400, json: { error: error.message, code: error.code } };
        throw error;
    } finally {
        client.release();
    }
}
```

In PATCH, replace everything from `params.push(id);` through the end of the `for (const entry of newEntries) { … }` loop with:

```js
        params.push(id);
        const refused = await updateWithEta(id, body, req.user, (client) => client.query(
            `UPDATE die_orders SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
            params
        ));
        if (refused) return res.status(refused.status).json(refused.json);
```

In PUT, change `const result = await pool.query(\`` to
`const refused = await updateWithEta(id, order, req.user, (client) => client.query(\``,
close the call with `]));` after the `id,` parameter line, then replace the `if (result.rowCount === 0) { … }` block and the whole `// Insert new change entries into order_changes` loop with:

```js
        if (refused) return res.status(refused.status).json(refused.json);
```

Both routes keep `await autoUpdateBackupRequests(...)` and their `res.json(...)` after it.

- [ ] **Step 5: Run the route test and the full suite**

Run: `node --test server/routes/orders.test.cjs` → PASS (7 tests)
Run: `npm test` → all pass (the Work Queue Postgres suites need the env vars from the dev-workflow memory; without them they skip).

- [ ] **Step 6: Commit**

```bash
git add server/routes/testSupport.cjs server/routes/orders.cjs server/routes/orders.test.cjs
git commit -m "feat(delivery): require a cause to move a set ETA, and log it with the update"
```

---

### Task 3: Follow-up routes

**Files:**
- Create: `server/routes/delivery-followups.cjs`
- Test: `server/routes/delivery-followups.test.cjs`
- Modify: `server/index.cjs` (require near line 37, mount after the `sample-trials` line ~117)

**Interfaces:**
- Consumes: Task 1 service.
- Produces: `GET /api/delivery-followups` → `{ summaries: { [orderId]: Summary } }`; `GET /api/delivery-followups/:orderId/events` → `{ events }`; `POST /api/delivery-followups/:orderId` body `{ contactDate, channel, note, newEta, cause, causeNote }` → 201 `{ events, eta }`.

- [ ] **Step 1: Write the failing test** — `server/routes/delivery-followups.test.cjs`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let storedEta;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT eta FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) {
    return { rows: storedEta === undefined ? [] : [{ eta: storedEta }] };
  }
  if (/^UPDATE die_orders SET eta/.test(q)) return { rows: [], rowCount: 1 };
  if (/^INSERT INTO die_delivery_events/.test(q)) return { rows: [{ id: log.length, kind: /'contact'/.test(q) ? 'contact' : params[1] }] };
  if (/^SELECT o\.id, o\.eta/.test(q)) {
    return { rows: [{ id: 3, eta: '2026-10-15', first_revised_from: '2026-10-01', slips: 1, last_contact_date: null, last_contact_channel: null, last_chased_at: null }] };
  }
  if (/FROM die_delivery_events\s+WHERE order_id = \$1/.test(q)) return { rows: [{ id: 1, kind: 'contact' }] };
  throw new Error(`delivery test: unexpected query ${q}`);
});

const router = require('./delivery-followups.cjs');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 5, username: 'planner' }; next(); });
app.use('/api/delivery-followups', router);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => { log = []; storedEta = '2026-10-01'; });

const today = require('../services/dates.cjs').todayLocal();
const post = (body) => request(base, '/api/delivery-followups/3', { body });
const has = (prefix) => log.some(({ q }) => q.startsWith(prefix));

test('a reply alone logs one contact and leaves the ETA', async () => {
  const { status, body } = await post({ contactDate: today, channel: 'phone', note: 'Dispatch Friday' });
  assert.equal(status, 201);
  assert.equal(body.eta, '2026-10-01');
  assert.ok(!has('UPDATE die_orders'));
  assert.equal(log.filter(({ q }) => q.startsWith('INSERT INTO die_delivery_events')).length, 1);
  assert.ok(has('COMMIT'));
});

test('a new ETA without a cause is refused before anything is written', async () => {
  const { status, body } = await post({ contactDate: today, channel: 'email', newEta: '2026-10-20' });
  assert.equal(status, 400);
  assert.equal(body.code, 'ETA_CAUSE_REQUIRED');
  assert.ok(!has('INSERT'));
  assert.ok(has('ROLLBACK'));
});

test('a new ETA with a cause moves the ETA and logs the revision and the contact', async () => {
  const { status, body } = await post({ contactDate: today, channel: 'email', note: 'Mill delay', newEta: '2026-10-20', cause: 'supplier_delay' });
  assert.equal(status, 201);
  assert.equal(body.eta, '2026-10-20');
  assert.deepEqual(log.find(({ q }) => q.startsWith('UPDATE die_orders')).params, ['2026-10-20', 3]);
  assert.equal(body.events.length, 2);
});

test('bad input is a 400 with the reason', async () => {
  assert.equal((await post({ contactDate: '2999-01-01', channel: 'email', note: 'x' })).status, 400);
  assert.equal((await post({ contactDate: today, channel: 'fax', note: 'x' })).status, 400);
  assert.equal((await post({ contactDate: today, channel: 'email' })).status, 400);
  assert.equal((await request(base, '/api/delivery-followups/abc', { body: {} })).status, 400);
});

test('an unknown order is a 404', async () => {
  storedEta = undefined;
  assert.equal((await post({ contactDate: today, channel: 'email', note: 'x' })).status, 404);
});

test('summaries are keyed by order id', async () => {
  const { status, body } = await request(base, '/api/delivery-followups');
  assert.equal(status, 200);
  assert.deepEqual(body.summaries['3'], { originalEta: '2026-10-01', slips: 1, daysSlipped: 14, lastContact: null, lastChasedAt: null });
});

test('events come back for one order', async () => {
  const { status, body } = await request(base, '/api/delivery-followups/3/events');
  assert.equal(status, 200);
  assert.equal(body.events.length, 1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test server/routes/delivery-followups.test.cjs`
Expected: FAIL — `Cannot find module './delivery-followups.cjs'`

- [ ] **Step 3: Implement** — `server/routes/delivery-followups.cjs`

```js
'use strict';
// Die delivery follow-up for the In Manufacturing page: per-die summaries,
// the delivery timeline, and logging a follow-up (optionally with a new ETA).
const express = require('express');
const { pool } = require('../db.cjs');
const { todayLocal } = require('../services/dates.cjs');
const delivery = require('../services/deliveryFollowup.cjs');

const router = express.Router();

// DATEs are cast to text so a Date object can never reach normalizeEta.
const SUMMARY_SQL = `
  SELECT o.id, o.eta,
         (SELECT e.eta_before::text FROM die_delivery_events e
           WHERE e.order_id = o.id AND e.kind = 'eta_revised'
           ORDER BY e.created_at, e.id LIMIT 1) AS first_revised_from,
         (SELECT COUNT(*) FROM die_delivery_events e
           WHERE e.order_id = o.id AND e.kind = 'eta_revised')::int AS slips,
         lc.contact_date AS last_contact_date, lc.channel AS last_contact_channel,
         (SELECT MAX(e.created_at) FROM die_delivery_events e
           WHERE e.order_id = o.id AND e.kind = 'chaser_sent') AS last_chased_at
    FROM die_orders o
    LEFT JOIN LATERAL (
      SELECT e.contact_date::text AS contact_date, e.channel FROM die_delivery_events e
       WHERE e.order_id = o.id AND e.kind = 'contact'
       ORDER BY e.contact_date DESC, e.id DESC LIMIT 1
    ) lc ON true
   WHERE o.status = 'DONE' AND o.die_received_date IS NULL`;

function orderIdFrom(req, res) {
  const id = Number(req.params.orderId);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid order ID' });
    return null;
  }
  return id;
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(SUMMARY_SQL);
    const summaries = {};
    for (const row of rows) summaries[row.id] = delivery.summarize(row);
    res.json({ summaries });
  } catch (error) {
    console.error('Delivery summaries error:', error);
    res.status(500).json({ error: 'Failed to load delivery follow-ups' });
  }
});

router.get('/:orderId/events', async (req, res) => {
  const id = orderIdFrom(req, res);
  if (!id) return;
  try {
    const { rows } = await pool.query(
      `SELECT ${delivery.EVENT_COLUMNS} FROM die_delivery_events
        WHERE order_id = $1 ORDER BY created_at DESC, id DESC`, [id]);
    res.json({ events: rows });
  } catch (error) {
    console.error('Delivery events error:', error);
    res.status(500).json({ error: 'Failed to load the delivery timeline' });
  }
});

// One follow-up = one contact, plus an ETA change when the supplier gave a
// new date. Both land in one transaction with the order row locked.
router.post('/:orderId', async (req, res) => {
  const id = orderIdFrom(req, res);
  if (!id) return;
  let input;
  try {
    input = delivery.validateFollowUp(req.body, todayLocal());
  } catch (error) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT eta FROM die_orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const plan = input.newEta ? delivery.planEtaChange(rows[0].eta, input.newEta, input.change) : null;
    const events = [];
    if (plan) {
      await client.query('UPDATE die_orders SET eta = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [plan.after, id]);
      events.push(await delivery.insertEtaEvent(client, id, plan, req.user));
    }
    events.push(await delivery.insertContactEvent(client, id, input, req.user));
    await client.query('COMMIT');
    res.status(201).json({ events, eta: plan ? plan.after : rows[0].eta });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof delivery.DeliveryRuleError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('Log delivery follow-up error:', error);
    res.status(500).json({ error: 'Failed to save the follow-up' });
  } finally {
    client?.release();
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount in `server/index.cjs`**

After `const { createWorkQueueRouter } = require('./routes/work-queue.cjs');`:

```js
const deliveryFollowupsRouter = require('./routes/delivery-followups.cjs');
```

After the `/api/sample-trials` mount:

```js
// The follow-up belongs to the In Manufacturing page, so it shares its key.
app.use('/api/delivery-followups', authMiddleware, pageAccessMiddleware('flow-completed'), deliveryFollowupsRouter);
```

- [ ] **Step 5: Run tests**

Run: `node --test server/routes/delivery-followups.test.cjs` → PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add server/routes/delivery-followups.cjs server/routes/delivery-followups.test.cjs server/index.cjs
git commit -m "feat(delivery): follow-up log, timeline and summaries API"
```

---

### Task 4: Supplier chaser

**Files:**
- Modify: `server/services/focReminder.cjs` (exports only)
- Create: `server/services/deliveryChaser.cjs`
- Test: `server/services/deliveryChaser.test.cjs`
- Modify: `server/routes/email.cjs` (require at top; routes after the daily-summary PDF route)
- Modify: `server/index.cjs` (start scheduler after `dailySummaryService.scheduleDailySummary();`)

**Interfaces:**
- Consumes: `normalizeEta`, `daysBetween` (Task 1); `isDue`, `escapeHtml`, `table` from `focReminder.cjs`; `localDay`, `todayLocal` from `dates.cjs`.
- Produces: `getChaserSettings(db?)`, `updateChaserSettings(fields, db?)`, `classifyDie(row, today, noEtaDays)`, `isSupplierDue(lastDay, today, intervalDays)`, `nextChaseDay(lastDay, intervalDays)`, `planChasers({ dies, emails, lastSent, today, intervalDays, noEtaDays })`, `buildSupplierBody(supplier, overdue, noEta)`, `buildSubject(supplier, overdue, noEta)`, `previewDeliveryChasers(opts?)`, `sendDeliveryChasers(opts?)`, `scheduleDeliveryChasers()`, `getChaserState()`.
- Routes: `GET|PUT /api/email/delivery-chaser-settings` (PUT body `{ enabled, time, intervalDays, noEtaDays, cc }`), `POST /api/email/delivery-chaser-settings/run-now`, `GET /api/email/delivery-chaser-preview`.

- [ ] **Step 1: Export the HTML helpers from `focReminder.cjs`**

Add `escapeHtml,` and `table,` to its `module.exports` object.

- [ ] **Step 2: Write the failing test** — `server/services/deliveryChaser.test.cjs`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const chaser = require('./deliveryChaser.cjs');

const TODAY = '2026-09-22';

test('a die past its ETA is overdue; a future ETA is not chased', () => {
  assert.deepEqual(chaser.classifyDie({ eta: '2026-09-19' }, TODAY, 7), { bucket: 'overdue', daysOverdue: 3 });
  assert.equal(chaser.classifyDie({ eta: '2026-09-22' }, TODAY, 7), null);
  assert.equal(chaser.classifyDie({ eta: '2026-10-30' }, TODAY, 7), null);
});

test('no ETA is chased once the die has been in manufacturing long enough', () => {
  assert.deepEqual(chaser.classifyDie({ eta: 'TBC', design_to_ems_date: '2026-09-15' }, TODAY, 7),
    { bucket: 'no_eta', daysInManufacturing: 7 });
  assert.equal(chaser.classifyDie({ eta: '', design_to_ems_date: '2026-09-16' }, TODAY, 7), null);
  assert.deepEqual(chaser.classifyDie({ eta: null, design_to_ems_date: null }, TODAY, 7),
    { bucket: 'no_eta', daysInManufacturing: null }, 'no anchor still asks for an ETA');
});

test('a supplier is due every N days', () => {
  assert.equal(chaser.isSupplierDue(null, TODAY, 3), true);
  assert.equal(chaser.isSupplierDue('2026-09-20', TODAY, 3), false);
  assert.equal(chaser.isSupplierDue('2026-09-19', TODAY, 3), true);
  assert.equal(chaser.isSupplierDue('2026-09-21', TODAY, 1), true);
  assert.equal(chaser.nextChaseDay('2026-09-20', 3), '2026-09-23');
});

const dies = [
  { id: 1, die_no: 'A-1', order_no: 'O1', plant: 'EXT 1', supplier: 'PHME', eta: '2026-09-10', design_to_ems_date: '2026-08-01', slips: 2 },
  { id: 2, die_no: 'A-2', order_no: 'O2', plant: 'EXT 2', supplier: 'phme ', eta: null, design_to_ems_date: '2026-09-01', slips: 0 },
  { id: 3, die_no: 'B-1', order_no: 'O3', plant: 'EXT 1', supplier: 'EKSTEK', eta: '2026-12-01', design_to_ems_date: '2026-09-01', slips: 0 },
  { id: 4, die_no: 'C-1', order_no: 'O4', plant: 'EXT 1', supplier: 'ALMAX', eta: '2026-09-01', design_to_ems_date: null, slips: 0 },
];

test('planChasers groups by supplier name, ignoring case and spaces', () => {
  const plan = chaser.planChasers({
    dies,
    emails: new Map([['PHME', 'sales@phme.test']]),
    lastSent: new Map([['ALMAX', '2026-09-21']]),
    today: TODAY, intervalDays: 3, noEtaDays: 7,
  });
  assert.deepEqual(plan.map((p) => [p.supplier, p.to, p.due, p.overdue.length, p.noEta.length]), [
    ['ALMAX', null, false, 1, 0],
    ['PHME', 'sales@phme.test', true, 1, 1],
  ]);
  assert.equal(plan[0].nextDay, '2026-09-24');
});

test('the email lists both sections, escaped, and omits an empty one', () => {
  const overdue = [{ die_no: 'A-1<b>', order_no: 'O1', plant: 'EXT 1', eta: '2026-09-10', daysOverdue: 12, slips: 2 }];
  const noEta = [{ die_no: 'A-2', order_no: 'O2', plant: 'EXT 2', daysInManufacturing: null }];
  const html = chaser.buildSupplierBody('PHME', overdue, noEta);
  assert.match(html, /Past the ETA you gave \(1\)/);
  assert.match(html, /ETA not yet given \(1\)/);
  assert.match(html, /A-1&lt;b&gt;/);
  assert.match(html, /—/);
  assert.doesNotMatch(chaser.buildSupplierBody('PHME', overdue, []), /ETA not yet given/);
  assert.equal(chaser.buildSubject('PHME', overdue, noEta), 'Die delivery follow-up — 1 overdue, 1 awaiting ETA - PHME');
});

// A fake pool: remembers chasers it records so a second run sees them.
function fakeDb({ failRecord = false } = {}) {
  const chasers = [];
  const events = [];
  const settings = { id: 1, delivery_chaser_interval_days: 3, delivery_chaser_no_eta_days: 7, delivery_chaser_cc: 'buyer@us.test' };
  const query = async (sql, params = []) => {
    const q = sql.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
    if (q.startsWith('SELECT * FROM reminder_settings')) return { rows: [settings] };
    if (q.startsWith('SELECT o.id, o.die_no')) return { rows: dies };
    if (q.startsWith('SELECT name, contact_email FROM suppliers')) {
      return { rows: [{ name: 'PHME', contact_email: 'sales@phme.test' }, { name: 'ALMAX', contact_email: '' }] };
    }
    if (q.startsWith('SELECT upper(trim(supplier)) AS key')) {
      return { rows: chasers.map((c) => ({ key: c.supplier.trim().toUpperCase(), last_sent: c.sent_at })) };
    }
    if (q.startsWith('INSERT INTO die_delivery_chasers')) {
      if (failRecord) throw new Error('disk full');
      chasers.push({ supplier: params[0], sent_at: new Date('2026-09-22T09:00:00') });
      return { rows: [{ id: chasers.length }] };
    }
    if (q.startsWith('INSERT INTO die_delivery_events')) { events.push(params); return { rows: [] }; }
    if (q.startsWith('UPDATE reminder_settings SET delivery_chaser_last_run')) return { rows: [] };
    throw new Error(`chaser test: unexpected query ${q}`);
  };
  return { query, connect: async () => ({ query, release() {} }), chasers, events };
}

const NOW = new Date('2026-09-22T09:00:00');

test('a run mails each due supplier with an email, records it, and skips the rest', async () => {
  const db = fakeDb();
  const sent = [];
  const summary = await chaser.sendDeliveryChasers({ db, now: NOW, checkSendable: async () => {}, send: async (m) => { sent.push(m); } });
  assert.deepEqual(sent.map((m) => [m.to, m.cc]), [['sales@phme.test', 'buyer@us.test']]);
  assert.deepEqual(summary.skippedNoEmail, ['ALMAX']);
  assert.equal(summary.sent, 1);
  assert.deepEqual(db.events[0], [[1, 2], 1, 'Chaser emailed to sales@phme.test']);
});

test('Send now twice in a day does not mail a supplier twice', async () => {
  const db = fakeDb();
  const sent = [];
  const opts = { db, now: NOW, checkSendable: async () => {}, send: async (m) => { sent.push(m); } };
  await chaser.sendDeliveryChasers(opts);
  const second = await chaser.sendDeliveryChasers(opts);
  assert.equal(sent.length, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.notDue, 1, 'PHME was chased today');
  assert.deepEqual(second.skippedNoEmail, ['ALMAX'], 'never chased, still has no email');
});

test('a failed send records nothing, so the next run retries', async () => {
  const db = fakeDb();
  const summary = await chaser.sendDeliveryChasers({ db, now: NOW, checkSendable: async () => {}, send: async () => { throw new Error('SMTP down'); } });
  assert.equal(summary.failed, 1);
  assert.equal(db.chasers.length, 0);
});

test('preview sends and writes nothing', async () => {
  const db = fakeDb();
  const preview = await chaser.previewDeliveryChasers({ db, now: NOW });
  assert.equal(preview.today, TODAY);
  assert.deepEqual(preview.suppliers.map((s) => [s.supplier, s.due, s.to]), [['ALMAX', true, null], ['PHME', true, 'sales@phme.test']]);
  assert.match(preview.suppliers[1].html, /Dear PHME Team/);
  assert.equal(db.chasers.length, 0);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test server/services/deliveryChaser.test.cjs`
Expected: FAIL — `Cannot find module './deliveryChaser.cjs'`

- [ ] **Step 4: Implement** — `server/services/deliveryChaser.cjs`

```js
'use strict';
/**
 * Die Delivery Chaser
 *
 * One email per supplier listing the dies in manufacturing that are past the
 * ETA the supplier gave, or have sat in manufacturing for a while with no ETA
 * at all. The check runs once a day at the configured time; a supplier is
 * mailed at most once every interval_days, so "Send now" twice cannot mail
 * anyone twice. Internal reminders are the Work Queue's job, not this one's.
 */

const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const signature = require('./emailSignature.cjs');
const { localDay, todayLocal } = require('./dates.cjs');
const { isDue, escapeHtml, table } = require('./focReminder.cjs');
const { normalizeEta, daysBetween } = require('./deliveryFollowup.cjs');

let timer = null;
const state = { lastRun: null, lastResult: null, error: null, running: false };

// ── Settings ────────────────────────────────────────────────────────────────

async function getChaserSettings(db = pool) {
  const result = await db.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
  if (result.rows.length > 0) return result.rows[0];
  return (await db.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *')).rows[0];
}

async function updateChaserSettings({ enabled, time, intervalDays, noEtaDays, cc }, db = pool) {
  const existing = await getChaserSettings(db);
  const result = await db.query(`
    UPDATE reminder_settings SET
      delivery_chaser_enabled       = COALESCE($1, delivery_chaser_enabled),
      delivery_chaser_time          = COALESCE($2, delivery_chaser_time),
      delivery_chaser_interval_days = COALESCE($3, delivery_chaser_interval_days),
      delivery_chaser_no_eta_days   = COALESCE($4, delivery_chaser_no_eta_days),
      delivery_chaser_cc            = COALESCE($5, delivery_chaser_cc),
      updated_at                    = CURRENT_TIMESTAMP
    WHERE id = $6
    RETURNING *
  `, [enabled, time, intervalDays, noEtaDays, cc, existing.id]);
  return result.rows[0];
}

// ── Rules ───────────────────────────────────────────────────────────────────

const supplierKey = (name) => String(name || '').trim().toUpperCase();

// Overdue when the real ETA is before today. No ETA once the die has been in
// manufacturing noEtaDays since Design to EMS — or at once when that date is
// missing, because asking for an ETA is never wrong.
function classifyDie(row, today, noEtaDays) {
  const eta = normalizeEta(row.eta);
  if (eta) return eta < today ? { bucket: 'overdue', daysOverdue: daysBetween(eta, today) } : null;
  const since = normalizeEta(row.design_to_ems_date);
  if (!since) return { bucket: 'no_eta', daysInManufacturing: null };
  const days = daysBetween(since, today);
  return days >= noEtaDays ? { bucket: 'no_eta', daysInManufacturing: days } : null;
}

function isSupplierDue(lastDay, today, intervalDays) {
  return !lastDay || daysBetween(lastDay, today) >= intervalDays;
}

function nextChaseDay(lastDay, intervalDays) {
  const d = new Date(`${lastDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + intervalDays);
  return d.toISOString().slice(0, 10);
}

// Everything a run would send, one entry per supplier with at least one die
// to list, in supplier order. Pure: the queries live in loadPlan.
function planChasers({ dies, emails, lastSent, today, intervalDays, noEtaDays }) {
  const groups = new Map();
  for (const die of dies) {
    const verdict = classifyDie(die, today, noEtaDays);
    if (!verdict) continue;
    const key = supplierKey(die.supplier);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { supplier: String(die.supplier).trim(), key, overdue: [], noEta: [] });
    const group = groups.get(key);
    if (verdict.bucket === 'overdue') group.overdue.push({ ...die, eta: normalizeEta(die.eta), daysOverdue: verdict.daysOverdue });
    else group.noEta.push({ ...die, daysInManufacturing: verdict.daysInManufacturing });
  }
  return [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((group) => {
      const last = lastSent.get(group.key) || null;
      return {
        ...group,
        to: emails.get(group.key) || null,
        due: isSupplierDue(last, today, intervalDays),
        lastDay: last,
        nextDay: last ? nextChaseDay(last, intervalDays) : today,
      };
    });
}

// ── Email ───────────────────────────────────────────────────────────────────

const dash = (v) => (v === null || v === undefined ? '—' : v);

function buildSubject(supplier, overdue, noEta) {
  return `Die delivery follow-up — ${overdue.length} overdue, ${noEta.length} awaiting ETA - ${supplier}`;
}

// Sent to the supplier. States only their own dates and what is outstanding.
function buildSupplierBody(supplier, overdue, noEta) {
  const h3 = (text) => `<h3 style="font-family:Arial,sans-serif;color:#0F172A;margin:18px 0 8px;">${text}</h3>`;
  const overdueSection = overdue.length ? `
    ${h3(`Past the ETA you gave (${overdue.length})`)}
    ${table([
      { label: 'SL No', align: 'center' }, { label: 'Die Number' }, { label: 'Order No' }, { label: 'Plant' },
      { label: 'ETA Given' }, { label: 'Days Overdue', align: 'center' }, { label: 'Times Revised', align: 'center' },
    ], overdue.map((r, i) => [i + 1, r.die_no, r.order_no, r.plant, r.eta, r.daysOverdue, r.slips || 0]))}` : '';
  const noEtaSection = noEta.length ? `
    ${h3(`ETA not yet given (${noEta.length})`)}
    ${table([
      { label: 'SL No', align: 'center' }, { label: 'Die Number' }, { label: 'Order No' }, { label: 'Plant' },
      { label: 'Days in Manufacturing', align: 'center' },
    ], noEta.map((r, i) => [i + 1, r.die_no, r.order_no, r.plant, dash(r.daysInManufacturing)]))}` : '';
  const ask = noEta.length && overdue.length
    ? 'Please reply with the dispatch date for each overdue die and an ETA for each die listed without one'
    : noEta.length ? 'Please reply with an ETA for each die listed' : 'Please reply with the dispatch date for each die listed';
  return `
    <p>Dear ${escapeHtml(supplier)} Team,</p>
    <p>This is an automated follow-up on die orders we are waiting to receive from you.</p>
    ${overdueSection}
    ${noEtaSection}
    <p>${ask}, or let us know if any has already shipped.</p>
    ${signature.dieDesignSignature()}`;
}

// ── Queries ─────────────────────────────────────────────────────────────────

async function loadPlan(db, settings, today) {
  const [dies, suppliers, sent] = await Promise.all([
    db.query(`
      SELECT o.id, o.die_no, o.order_no, o.plant, trim(o.supplier) AS supplier, o.eta,
             o.design_to_ems_date::text AS design_to_ems_date,
             (SELECT COUNT(*) FROM die_delivery_events e
               WHERE e.order_id = o.id AND e.kind = 'eta_revised')::int AS slips
        FROM die_orders o
       WHERE o.status = 'DONE' AND o.die_received_date IS NULL
         AND NULLIF(trim(o.supplier), '') IS NOT NULL
       ORDER BY o.die_no`),
    db.query('SELECT name, contact_email FROM suppliers'),
    db.query(`SELECT upper(trim(supplier)) AS key, MAX(sent_at) AS last_sent
                FROM die_delivery_chasers GROUP BY 1`),
  ]);
  return planChasers({
    dies: dies.rows,
    emails: new Map(suppliers.rows
      .filter((s) => (s.contact_email || '').trim())
      .map((s) => [supplierKey(s.name), s.contact_email.trim()])),
    lastSent: new Map(sent.rows.map((r) => [r.key, localDay(new Date(r.last_sent))])),
    today,
    intervalDays: Number(settings.delivery_chaser_interval_days) || 3,
    noEtaDays: Number(settings.delivery_chaser_no_eta_days) || 7,
  });
}

// The chaser row and a timeline event per listed die, together or not at all.
async function recordChaser(db, chaser, cc) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO die_delivery_chasers (supplier, recipients, cc, overdue_count, no_eta_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [chaser.supplier, chaser.to, cc || null, chaser.overdue.length, chaser.noEta.length]);
    await client.query(
      `INSERT INTO die_delivery_events (order_id, kind, chaser_id, note)
       SELECT unnest($1::int[]), 'chaser_sent', $2, $3`,
      [[...chaser.overdue, ...chaser.noEta].map((d) => d.id), rows[0].id, `Chaser emailed to ${chaser.to}`]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function assertSendable() {
  const emailConfig = await emailService.getEmailConfig();
  if (!emailConfig || !emailConfig.send_enabled) {
    throw new Error('SMTP sending is not enabled. Configure it in Email Settings.');
  }
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function previewDeliveryChasers({ db = pool, now = new Date() } = {}) {
  const settings = await getChaserSettings(db);
  const today = todayLocal(now);
  const plan = await loadPlan(db, settings, today);
  return {
    today,
    cc: settings.delivery_chaser_cc || '',
    suppliers: plan.map((p) => ({
      supplier: p.supplier, to: p.to, due: p.due, lastDay: p.lastDay, nextDay: p.nextDay,
      overdueCount: p.overdue.length, noEtaCount: p.noEta.length,
      subject: buildSubject(p.supplier, p.overdue, p.noEta),
      html: buildSupplierBody(p.supplier, p.overdue, p.noEta),
    })),
  };
}

async function sendDeliveryChasers({
  db = pool, send = emailService.sendEmail, now = new Date(), checkSendable = assertSendable,
} = {}) {
  if (state.running) return { skipped: true, reason: 'A delivery chaser run is already in progress' };
  state.running = true;
  try {
    const settings = await getChaserSettings(db);
    await checkSendable();
    const today = todayLocal(now);
    const plan = await loadPlan(db, settings, today);
    const cc = (settings.delivery_chaser_cc || '').trim();
    const summary = { sent: 0, failed: 0, recordFailed: 0, notDue: 0, skippedNoEmail: [], overdue: 0, noEta: 0 };

    for (const chaser of plan) {
      if (!chaser.due) { summary.notDue++; continue; }
      if (!chaser.to) { summary.skippedNoEmail.push(chaser.supplier); continue; }
      try {
        await send({
          to: chaser.to,
          cc: cc || undefined,
          subject: buildSubject(chaser.supplier, chaser.overdue, chaser.noEta),
          body: buildSupplierBody(chaser.supplier, chaser.overdue, chaser.noEta),
          importance: chaser.overdue.length ? 'high' : 'normal',
        });
      } catch (err) {
        console.error(`Delivery chaser: failed to send to ${chaser.supplier}:`, err.message);
        summary.failed++;
        continue;
      }
      try {
        await recordChaser(db, chaser, cc);
      } catch (err) {
        // Sent but not recorded: the next due run mails this supplier again.
        console.error(`Delivery chaser: sent to ${chaser.supplier} but could not record it:`, err.message);
        summary.recordFailed++;
      }
      summary.sent++;
      summary.overdue += chaser.overdue.length;
      summary.noEta += chaser.noEta.length;
    }

    await db.query('UPDATE reminder_settings SET delivery_chaser_last_run = $2 WHERE id = $1', [settings.id, today]);
    state.lastRun = new Date().toISOString();
    state.lastResult = summary;
    state.error = null;
    console.log(`Delivery chasers: ${summary.sent} sent, ${summary.failed} failed, ${summary.notDue} not due, ` +
      `${summary.skippedNoEmail.length} supplier(s) without an email`);
    return summary;
  } catch (error) {
    state.lastRun = new Date().toISOString();
    state.error = error.message;
    console.error('Delivery chaser run error:', error.message);
    throw error;
  } finally {
    state.running = false;
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

async function tick() {
  try {
    const s = await getChaserSettings();
    if (isDue({ enabled: s.delivery_chaser_enabled, time: s.delivery_chaser_time, lastRun: s.delivery_chaser_last_run })) {
      await sendDeliveryChasers().catch(() => {});
    }
  } catch {
    // Already logged by the sender; never let the tick throw
  }
}

function scheduleDeliveryChasers() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 60 * 1000);
  console.log('Delivery chaser scheduler started (checks every minute)');
}

const getChaserState = () => ({ ...state });

module.exports = {
  getChaserSettings, updateChaserSettings,
  classifyDie, isSupplierDue, nextChaseDay, planChasers,
  buildSubject, buildSupplierBody,
  previewDeliveryChasers, sendDeliveryChasers, scheduleDeliveryChasers, getChaserState,
};
```

- [ ] **Step 5: Run the chaser test**

Run: `node --test server/services/deliveryChaser.test.cjs` → PASS (9 tests)

- [ ] **Step 6: Routes in `server/routes/email.cjs`**

At the top with the other services:

```js
const deliveryChaserService = require('../services/deliveryChaser.cjs');
```

After the `router.get('/daily-summary.pdf', …)` handler:

```js
// ── Die delivery chaser ──────────────────────────────────────────────────────

router.get('/delivery-chaser-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const settings = await deliveryChaserService.getChaserSettings();
        res.json({ settings, state: deliveryChaserService.getChaserState() });
    } catch (error) {
        console.error('Get delivery chaser settings error:', error);
        res.status(500).json({ error: 'Failed to fetch delivery chaser settings' });
    }
});

router.put('/delivery-chaser-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const { enabled, time, intervalDays, noEtaDays, cc } = req.body;
        const whole = (v, min, max) => v === undefined || (Number.isInteger(v) && v >= min && v <= max);
        if (enabled !== undefined && typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        if (time !== undefined && !HHMM.test(time)) {
            return res.status(400).json({ error: 'time must be in HH:MM (24-hour) format' });
        }
        if (!whole(intervalDays, 1, 60)) {
            return res.status(400).json({ error: 'Chase every must be a whole number of days from 1 to 60' });
        }
        if (!whole(noEtaDays, 1, 365)) {
            return res.status(400).json({ error: 'The no-ETA threshold must be a whole number of days from 1 to 365' });
        }
        const settings = await deliveryChaserService.updateChaserSettings({
            enabled, time, intervalDays, noEtaDays,
            cc: cc === undefined ? undefined : String(cc).trim(),
        });
        res.json({ message: 'Delivery chaser settings updated', settings });
    } catch (error) {
        console.error('Update delivery chaser settings error:', error);
        res.status(500).json({ error: 'Failed to update delivery chaser settings' });
    }
});

// Runs the chaser now. It still honours each supplier's every-N-days rule,
// so pressing it twice cannot mail anyone twice.
router.post('/delivery-chaser-settings/run-now', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const summary = await deliveryChaserService.sendDeliveryChasers();
        res.json({ message: 'Delivery chaser run complete', summary });
    } catch (error) {
        console.error('Manual delivery chaser run error:', error);
        res.status(500).json({ error: error.message || 'Failed to run the delivery chaser' });
    }
});

// Preview only: builds every email the next run would send; sends and writes nothing.
router.get('/delivery-chaser-preview', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        res.json(await deliveryChaserService.previewDeliveryChasers());
    } catch (error) {
        console.error('Delivery chaser preview error:', error);
        res.status(500).json({ error: 'Failed to build the delivery chaser preview' });
    }
});
```

- [ ] **Step 7: Start the scheduler** — in `server/index.cjs`, after `dailySummaryService.scheduleDailySummary();`:

```js
        // Die delivery chaser: overdue and no-ETA dies out to each supplier
        require('./services/deliveryChaser.cjs').scheduleDeliveryChasers();
```

- [ ] **Step 8: Full suite, then commit**

Run: `npm test` → all pass.

```bash
git add server/services/focReminder.cjs server/services/deliveryChaser.cjs server/services/deliveryChaser.test.cjs server/routes/email.cjs server/index.cjs
git commit -m "feat(delivery): supplier chaser for overdue and no-ETA dies, every N days"
```

---

### Task 5: Client rules and API

**Files:**
- Create: `src/utils/deliveryFollowup.js`
- Test: `src/utils/deliveryFollowup.test.js`
- Modify: `src/api.js` (new `deliveryFollowupsAPI` after `suppliersAPI`; chaser methods inside `emailAPI` after `downloadDailySummaryPdf`)

**Interfaces:**
- Produces: `CAUSES`, `CHANNELS` (`{ value, label }[]`), `DUE_SOON_DAYS = 7`, `normalizeEta`, `daysBetween`, `etaChip(eta, today, format?) → { bucket, tone, text }`, `compareByUrgency(a, b, today)`, `countBuckets(orders, today)`, `needsCause(current, next)`, `validateFollowUpForm(form, currentEta, today) → string|null`, `formatSlip(days)`, `causeLabel(v)`, `channelLabel(v)`.
- API: `deliveryFollowupsAPI.getSummaries()`, `.getEvents(orderId)`, `.log(orderId, payload)`; `emailAPI.getDeliveryChaserSettings()`, `.updateDeliveryChaserSettings(s)`, `.runDeliveryChaserNow()`, `.previewDeliveryChaser()`.

- [ ] **Step 1: Write the failing test** — `src/utils/deliveryFollowup.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  CAUSES, CHANNELS, normalizeEta, etaChip, compareByUrgency, countBuckets,
  needsCause, validateFollowUpForm, formatSlip, causeLabel,
} from './deliveryFollowup.js';

const server = createRequire(import.meta.url)('../../server/services/deliveryFollowup.cjs');
const TODAY = '2026-09-22';

// Two copies of the ETA rules, one ESM for Vite and one CommonJS for the
// server. These checks are what stop them drifting.
test('the client and server agree on what an ETA is', () => {
  for (const v of ['2026-10-01', '2026-10-01T00:00:00Z', '1/10/2026', '01.10.2026', 'TBC', '', null, '31/02/2026']) {
    assert.equal(normalizeEta(v), server.normalizeEta(v), String(v));
  }
  assert.deepEqual(CAUSES.map((c) => c.value), [...server.CAUSES]);
  assert.deepEqual(CHANNELS.map((c) => c.value), [...server.CHANNELS]);
});

test('chips put each die in one bucket', () => {
  assert.deepEqual(etaChip('2026-09-10', TODAY), { bucket: 'overdue', tone: 'danger', text: '12d overdue' });
  assert.deepEqual(etaChip('2026-09-22', TODAY), { bucket: 'due_soon', tone: 'warning', text: 'Due today' });
  assert.deepEqual(etaChip('2026-09-29', TODAY), { bucket: 'due_soon', tone: 'warning', text: 'Due in 7d' });
  assert.deepEqual(etaChip('2026-09-30', TODAY, () => '30 Sep'), { bucket: 'later', tone: 'neutral', text: '30 Sep' });
  assert.deepEqual(etaChip('TBC', TODAY), { bucket: 'no_eta', tone: 'muted', text: 'No ETA' });
});

test('urgency order: most overdue, soonest due, later, then no ETA', () => {
  const rows = [
    { 'DIE NO': 'N-2', ETA: '' }, { 'DIE NO': 'L', ETA: '2026-12-01' }, { 'DIE NO': 'O-new', ETA: '2026-09-20' },
    { 'DIE NO': 'S', ETA: '2026-09-24' }, { 'DIE NO': 'O-old', ETA: '2026-09-01' }, { 'DIE NO': 'N-1', ETA: 'TBC' },
  ];
  assert.deepEqual(rows.sort((a, b) => compareByUrgency(a, b, TODAY)).map((r) => r['DIE NO']),
    ['O-old', 'O-new', 'S', 'L', 'N-1', 'N-2']);
  assert.deepEqual(countBuckets(rows, TODAY), { overdue: 2, due_soon: 1, later: 1, no_eta: 2 });
});

test('a cause is needed only when a real ETA changes', () => {
  assert.equal(needsCause('2026-10-01', '2026-10-15'), true);
  assert.equal(needsCause('2026-10-01', ''), true);
  assert.equal(needsCause('2026-10-01', '01/10/2026'), false);
  assert.equal(needsCause('TBC', '2026-10-15'), false);
  assert.equal(needsCause('', '2026-10-15'), false);
});

test('the follow-up form mirrors the server rules', () => {
  const ok = { contactDate: TODAY, channel: 'phone', note: 'Friday', newEta: '', cause: '', causeNote: '' };
  assert.equal(validateFollowUpForm(ok, '2026-10-01', TODAY), null);
  assert.match(validateFollowUpForm({ ...ok, contactDate: '2026-09-23' }, '2026-10-01', TODAY), /future/);
  assert.match(validateFollowUpForm({ ...ok, note: '' }, '2026-10-01', TODAY), /reply or give a new ETA/);
  assert.match(validateFollowUpForm({ ...ok, newEta: '2026-10-15' }, '2026-10-01', TODAY), /cause/);
  assert.match(validateFollowUpForm({ ...ok, newEta: '2026-10-15', cause: 'other' }, '2026-10-01', TODAY), /other cause/);
  assert.equal(validateFollowUpForm({ ...ok, newEta: '2026-10-15', cause: 'logistics' }, '2026-10-01', TODAY), null);
  assert.equal(validateFollowUpForm({ ...ok, note: '', newEta: '2026-10-15' }, '', TODAY), null, 'a first ETA needs no cause');
});

test('labels and slip text', () => {
  assert.equal(formatSlip(14), '+14d');
  assert.equal(formatSlip(-3), '−3d');
  assert.equal(formatSlip(0), '0d');
  assert.equal(causeLabel('logistics'), 'Shipping / logistics');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test src/utils/deliveryFollowup.test.js`
Expected: FAIL — cannot find `./deliveryFollowup.js`

- [ ] **Step 3: Implement** — `src/utils/deliveryFollowup.js`

```js
// Die delivery follow-up rules for the In Manufacturing page.
//
// die_orders.eta is free text and may hold "TBC", so nothing here treats a
// string as a date unless normalizeEta says it is one. The server keeps the
// same rules in server/services/deliveryFollowup.cjs; the test checks both.

export const CAUSES = [
  { value: 'supplier_delay', label: 'Supplier delay' },
  { value: 'our_change', label: 'Our change (design revision, hold)' },
  { value: 'logistics', label: 'Shipping / logistics' },
  { value: 'other', label: 'Other' },
];

export const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
];

export const DUE_SOON_DAYS = 7;

const labelOf = (list, value) => list.find((item) => item.value === value)?.label || value || '';
export const causeLabel = (value) => labelOf(CAUSES, value);
export const channelLabel = (value) => labelOf(CHANNELS, value);

export function normalizeEta(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  let y; let m; let d;
  if (iso) [, y, m, d] = iso;
  else if (dmy) [, d, m, y] = dmy;
  else return null;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function etaChip(eta, today, format = (d) => d) {
  const date = normalizeEta(eta);
  if (!date) return { bucket: 'no_eta', tone: 'muted', text: 'No ETA' };
  const days = daysBetween(today, date);
  if (days < 0) return { bucket: 'overdue', tone: 'danger', text: `${-days}d overdue` };
  if (days <= DUE_SOON_DAYS) return { bucket: 'due_soon', tone: 'warning', text: days === 0 ? 'Due today' : `Due in ${days}d` };
  return { bucket: 'later', tone: 'neutral', text: format(date) };
}

const BUCKET_RANK = { overdue: 0, due_soon: 1, later: 2, no_eta: 3 };

// Most overdue first, then soonest due, then later, then no ETA by die number.
export function compareByUrgency(a, b, today) {
  const rank = BUCKET_RANK[etaChip(a.ETA, today).bucket] - BUCKET_RANK[etaChip(b.ETA, today).bucket];
  if (rank) return rank;
  const ea = normalizeEta(a.ETA);
  const eb = normalizeEta(b.ETA);
  if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
  return String(a['DIE NO'] || '').localeCompare(String(b['DIE NO'] || ''), undefined, { numeric: true });
}

export function countBuckets(orders, today) {
  const counts = { overdue: 0, due_soon: 0, later: 0, no_eta: 0 };
  for (const order of orders) counts[etaChip(order.ETA, today).bucket] += 1;
  return counts;
}

// Saving `next` over `current` needs a cause when the die already had a real
// ETA and the new value is a different date or no date at all.
export function needsCause(current, next) {
  const before = normalizeEta(current);
  return !!before && before !== normalizeEta(next);
}

export function validateFollowUpForm(form, currentEta, today) {
  const contactDate = normalizeEta(form.contactDate);
  if (!contactDate) return 'Enter the follow-up date';
  if (contactDate > today) return 'The follow-up date cannot be in the future';
  if (!CHANNELS.some((c) => c.value === form.channel)) return 'Pick how the supplier was contacted';
  const note = String(form.note || '').trim();
  const rawEta = String(form.newEta || '').trim();
  if (rawEta && !normalizeEta(rawEta)) return 'The new ETA is not a valid date';
  if (!note && !rawEta) return "Write the supplier's reply or give a new ETA";
  if (rawEta && needsCause(currentEta, rawEta)) {
    if (!CAUSES.some((c) => c.value === form.cause)) return 'Pick the cause of the ETA change';
    if (form.cause === 'other' && !String(form.causeNote || '').trim()) return 'Say what the other cause is';
  }
  return null;
}

export function formatSlip(days) {
  if (!days) return '0d';
  return days > 0 ? `+${days}d` : `−${-days}d`;
}
```

- [ ] **Step 4: API methods in `src/api.js`**

After the `suppliersAPI` object:

```js
// Die delivery follow-up (In Manufacturing page)
export const deliveryFollowupsAPI = {
    getSummaries: async () => apiRequest('/delivery-followups'),
    getEvents: async (orderId) => apiRequest(`/delivery-followups/${orderId}/events`),
    log: async (orderId, payload) => apiRequest(`/delivery-followups/${orderId}`, {
        method: 'POST',
        body: JSON.stringify(payload),
    }),
};
```

Inside `emailAPI`, after `downloadDailySummaryPdf`:

```js
    getDeliveryChaserSettings: async () => apiRequest('/email/delivery-chaser-settings'),

    updateDeliveryChaserSettings: async (settings) => apiRequest('/email/delivery-chaser-settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
    }),

    // Mails every supplier that is due now. The every-N-days rule still applies.
    runDeliveryChaserNow: async () => apiRequest('/email/delivery-chaser-settings/run-now', { method: 'POST' }),

    // Sends nothing: the emails the next run would send.
    previewDeliveryChaser: async () => apiRequest('/email/delivery-chaser-preview'),
```

- [ ] **Step 5: Run tests and lint**

Run: `node --test src/utils/deliveryFollowup.test.js` → PASS (6 tests)
Run: `npx eslint src/utils/deliveryFollowup.js src/utils/deliveryFollowup.test.js src/api.js` → no new errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/deliveryFollowup.js src/utils/deliveryFollowup.test.js src/api.js
git commit -m "feat(delivery): client ETA rules and delivery API methods"
```

---

### Task 6: In Manufacturing page and receipt dialog

**Files:**
- Create: `src/components/delivery/DieReceivanceModal.jsx`
- Create: `src/pages/InManufacturingPage.jsx`
- Modify: `src/pages/FlowPage.jsx` (remove `flow-completed` from `FLOW_TABS`, the `DONE` filter, `isDone` column/button, the receivance modal, its state and now-unused imports)
- Modify: `src/DieOrderingSystem.jsx` (import + route)

**Interfaces:**
- Consumes: Task 5 utils and API. `DeliveryFollowupDrawer` from Task 7 — until Task 7 lands, the page renders without it (import added in Task 7).
- Produces: `<InManufacturingPage data searchTerm setSearchTerm theme correctors correctorsError setSelectedOrder setRevisionHistoryOrder setData setToast setActiveTab />`; `<DieReceivanceModal order theme correctors correctorsError setToast onClose onConfirmed(patch) />`.

- [ ] **Step 1: Create `DieReceivanceModal.jsx`**

Move the `{dieReceivanceOrder && ( … )}` block from `FlowPage.jsx` into this component verbatim, with these substitutions: `dieReceivanceOrder` → `order`; `setDieReceivanceOrder(null)` → `onClose()`; the form state becomes local; the success branch calls `onConfirmed(patch)` instead of touching page state.

```jsx
import React, { useState } from 'react';
import { X, CheckCircle } from 'lucide-react';
import { ordersAPI } from '../../api';
import DieAttentionLabels from '../DieAttentionLabels';
import CorrectorSelect from '../ui/CorrectorSelect';
import { todayLocal } from '../../utils/today.js';
import { skipTrialAllowed, skipTrialDefault, buildReceivancePatch } from '../../utils/dieReceivance';

// Confirm Die Receivance, moved out of FlowPage unchanged when In Manufacturing
// got its own page.
export default function DieReceivanceModal({ order, theme, correctors, correctorsError, setToast, onClose, onConfirmed }) {
  const [form, setForm] = useState({ die_received_date: todayLocal(), corrector: '', skip_trial: skipTrialDefault(order.TYPE) });

  const confirm = async () => {
    if (!form.die_received_date) { setToast({ message: 'Please enter the die received date', type: 'error' }); setTimeout(() => setToast(null), 3000); return; }
    if (!form.corrector.trim()) { setToast({ message: 'Please assign a corrector', type: 'error' }); setTimeout(() => setToast(null), 3000); return; }
    try {
      const { patch } = buildReceivancePatch({ order, form, skipTrial: form.skip_trial });
      await ordersAPI.patch(order.id, patch);
      onConfirmed(patch);
    } catch (error) {
      setToast({ message: 'Failed to confirm: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // …the JSX moved from FlowPage lines 269-350, using `order`, `form`, `setForm`,
  // `onClose` and `confirm` (the Confirm Receivance button's onClick={confirm}).
}
```

(The moved JSX is the existing markup; copy it exactly, only renaming as listed. Input ids stay `flowpage-die-received-date`, `flowpage-assign-corrector`, `flowpage-skip-trial`.)

- [ ] **Step 2: Create `src/pages/InManufacturingPage.jsx`**

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown, ChevronUp, Package, MessageSquarePlus } from 'lucide-react';
import { STATUS_CONFIG } from '../utils/constants';
import { deliveryFollowupsAPI } from '../api';
import { formatDate } from '../utils/helpers';
import { todayLocal } from '../utils/today.js';
import DieAttentionLabels from '../components/DieAttentionLabels';
import DieReceivanceModal from '../components/delivery/DieReceivanceModal';
import {
  etaChip, countBuckets, compareByUrgency, normalizeEta, daysBetween, formatSlip, channelLabel,
} from '../utils/deliveryFollowup';

const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

const BUCKETS = [
  { key: 'overdue', label: 'Overdue', color: '#DC2626' },
  { key: 'due_soon', label: 'Due in 7 days', color: '#D97706' },
  { key: 'later', label: 'Later', color: '#0F766E' },
  { key: 'no_eta', label: 'No ETA', color: '#64748B' },
];

const TONES = {
  danger: { fg: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
  warning: { fg: '#B45309', bg: 'rgba(217,119,6,0.14)' },
  neutral: { fg: '#0F766E', bg: 'rgba(15,118,110,0.12)' },
  muted: { fg: '#64748B', bg: 'rgba(100,116,139,0.14)' },
};

const SORTABLE = [
  { key: 'DIE NO', label: 'Die No' }, { key: 'Order No', label: 'Order' }, { key: 'Plant', label: 'Plant' },
  { key: 'TYPE', label: 'Type' }, { key: 'Die Size', label: 'Size' }, { key: 'Cavity', label: 'Cav' },
  { key: 'Supplier', label: 'Supplier' }, { key: 'ETA', label: 'ETA' },
];

export default function InManufacturingPage({
  data, searchTerm, setSearchTerm, theme, correctors, correctorsError,
  setSelectedOrder, setRevisionHistoryOrder, setData, setToast, setActiveTab,
}) {
  const [summaries, setSummaries] = useState({});
  const [summaryError, setSummaryError] = useState('');
  const [bucket, setBucket] = useState(null);
  const [sort, setSort] = useState(null); // null = urgency order
  const [followupId, setFollowupId] = useState(null);
  const [receivanceOrder, setReceivanceOrder] = useState(null);

  const loadSummaries = useCallback(() => {
    deliveryFollowupsAPI.getSummaries()
      .then((r) => { setSummaries(r?.summaries || {}); setSummaryError(''); })
      .catch((err) => setSummaryError(err.message || 'Could not load follow-ups'));
  }, []);
  // Refetched when the order list changes, so an ETA edited in the order form
  // shows its slip here without a reload.
  useEffect(() => { loadSummaries(); }, [data, loadSummaries]);

  const today = todayLocal();
  const config = STATUS_CONFIG.DONE;
  const StatusIcon = config.icon || Package;
  const orders = data.filter((o) => o.STATUS === 'DONE' && !hasDieReceivedDate(o));
  const counts = countBuckets(orders, today);
  const term = (searchTerm || '').toLowerCase();
  const visible = orders
    .filter((o) => !bucket || etaChip(o.ETA, today).bucket === bucket)
    .filter((o) => !term || [o['DIE NO'], o['Order No'], o.Supplier].some((v) => v && String(v).toLowerCase().includes(term)))
    .sort((a, b) => {
      if (!sort) return compareByUrgency(a, b, today);
      const cmp = String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  const toggleSort = (key) => setSort((s) => (!s || s.key !== key
    ? { key, direction: 'asc' }
    : s.direction === 'asc' ? { key, direction: 'desc' } : null));
  const followupOrder = followupId != null ? data.find((o) => o.id === followupId) : null;

  const styles = {
    tableContainer: { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: theme.shadowSm },
    th: { padding: '0.85rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, borderBottom: `1px solid ${theme.cardBorder}`, whiteSpace: 'nowrap' },
    td: { padding: '0.85rem 0.75rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.85rem', color: theme.text, verticalAlign: 'top' },
    chip: (tone) => ({ display: 'inline-block', padding: '3px 9px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', background: TONES[tone].bg, color: TONES[tone].fg }),
    action: (color) => ({ padding: '6px 12px', background: `${color}1F`, border: `1px solid ${color}66`, borderRadius: '8px', cursor: 'pointer', color, display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }),
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${config.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StatusIcon size={24} color={config.color} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: 0 }}>{config.label}</h1>
            <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Follow up delivery against each supplier&apos;s ETA</p>
          </div>
          <span style={{ background: config.color, color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600 }}>{orders.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.inputBg || '#0F172A', borderRadius: '10px', padding: '10px 14px', border: `1px solid ${theme.border || '#334155'}`, minWidth: '280px' }}>
          <Search size={18} color={theme.textMuted} />
          <input aria-label="Search dies in manufacturing" type="text" placeholder="Search die, order or supplier…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ border: 'none', background: 'transparent', color: theme.text, fontSize: '0.9rem', outline: 'none', width: '100%' }} />
        </div>
      </div>

      <div role="group" aria-label="Filter by ETA" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '1rem' }}>
        {BUCKETS.map((b) => {
          const active = bucket === b.key;
          return (
            <button key={b.key} type="button" aria-pressed={active} onClick={() => setBucket(active ? null : b.key)}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer', background: active ? `${b.color}1A` : theme.cardBg, border: `1px solid ${active ? b.color : theme.cardBorder}`, color: theme.text }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: b.color, fontVariantNumeric: 'tabular-nums' }}>{counts[b.key]}</div>
              <div style={{ fontSize: '0.8rem', color: theme.textMuted }}>{b.label}</div>
            </button>
          );
        })}
      </div>

      {summaryError && (
        <p role="alert" style={{ color: '#DC2626', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          Follow-up history could not be loaded ({summaryError}). ETAs below are still current.
        </p>
      )}

      <div style={styles.tableContainer}>
        {visible.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {SORTABLE.map((col) => (
                    <th scope="col" key={col.key} style={{ ...styles.th, cursor: 'pointer' }} onClick={() => toggleSort(col.key)}
                      aria-sort={sort?.key === col.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        {col.label}
                        {sort?.key === col.key
                          ? (sort.direction === 'asc' ? <ChevronUp size={14} color={config.color} /> : <ChevronDown size={14} color={config.color} />)
                          : <ChevronDown size={14} color="#64748B" style={{ opacity: 0.3 }} />}
                      </span>
                    </th>
                  ))}
                  <th scope="col" style={styles.th}>ETA status</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Slips</th>
                  <th scope="col" style={styles.th}>Last follow-up</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Days</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Rev</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => {
                  const summary = summaries[order.id];
                  const chip = etaChip(order.ETA, today, formatDate);
                  const current = normalizeEta(order.ETA);
                  const revised = summary?.slips > 0 && summary.originalEta && summary.originalEta !== current;
                  const since = normalizeEta(order['Design to EMS Date']);
                  const days = since ? daysBetween(since, today) : null;
                  return (
                    <tr key={order.id}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <DieAttentionLabels order={order} dense />
                        <button type="button" className="row-open" onClick={() => setSelectedOrder(order)} style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>
                          {order['DIE NO']}<span className="sr-only"> — open details</span>
                        </button>
                      </td>
                      <td style={styles.td}>{order['Order No'] || '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{order.Plant || '—'}</td>
                      <td style={styles.td}>{order.TYPE === 'N' ? 'New' : order.TYPE === 'B' ? 'Backup' : (order.TYPE || '—')}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{order['Die Size'] || '—'}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{order.Cavity || '—'}</td>
                      <td style={styles.td}>{order.Supplier || '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {revised && (
                          <div style={{ fontSize: '0.72rem', color: theme.textMuted, textDecoration: 'line-through' }} title="Original ETA">
                            {formatDate(summary.originalEta)}
                          </div>
                        )}
                        {current ? formatDate(current) : (order.ETA ? String(order.ETA) : '—')}
                      </td>
                      <td style={styles.td}><span style={styles.chip(chip.tone)}>{chip.text}</span></td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        {summary?.slips
                          ? <span title={`${formatSlip(summary.daysSlipped)} since the first ETA`} style={styles.chip(summary.slips > 1 ? 'danger' : 'warning')}>{summary.slips}</span>
                          : <span style={{ color: '#64748B' }}>—</span>}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {summary?.lastContact
                          ? <>{formatDate(summary.lastContact.date)}<div style={{ fontSize: '0.72rem', color: theme.textMuted }}>{channelLabel(summary.lastContact.channel)}</div></>
                          : <span style={{ color: theme.textMuted }}>Never</span>}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center', fontFamily: 'monospace' }}>{days != null && days >= 0 ? `${days}d` : '—'}</td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        {order['Design Revision Count'] > 0
                          ? <button type="button" onClick={() => setRevisionHistoryOrder && setRevisionHistoryOrder(order)} style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)', cursor: 'pointer' }} title="View revision history">{order['Design Revision Count']}</button>
                          : <span style={{ color: '#64748B' }}>—</span>}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button type="button" onClick={() => setFollowupId(order.id)} style={styles.action('#4F46E5')} title="Log a follow-up or a new ETA">
                            <MessageSquarePlus size={15} /> Follow up
                          </button>
                          <button type="button" onClick={() => setReceivanceOrder(order)} style={styles.action('#0891B2')} title="Confirm Die Receivance">
                            <Package size={15} /> Confirm
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: theme.textMuted }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '0.5rem' }}>
              {orders.length ? 'No dies match this filter' : 'No dies in manufacturing'}
            </h3>
            {bucket && <button type="button" onClick={() => setBucket(null)} style={styles.action(config.color)}>Show all</button>}
          </div>
        )}
      </div>

      {receivanceOrder && (
        <DieReceivanceModal
          order={receivanceOrder} theme={theme} correctors={correctors} correctorsError={correctorsError}
          setToast={setToast}
          onClose={() => setReceivanceOrder(null)}
          onConfirmed={(patch) => {
            const done = receivanceOrder;
            setData((prev) => prev.map((o) => (o.id === done.id ? { ...o, ...patch, changeCount: (o.changeCount || 0) + 1 } : o)));
            setReceivanceOrder(null);
            setToast({ message: `Die ${done['DIE NO']} confirmed${'Submission Date' in patch ? ', trial skipped' : ''} & moved to Sample Followup`, type: 'success' });
            setActiveTab('flow-sample-followup');
            setTimeout(() => setToast(null), 3000);
          }}
        />
      )}
    </div>
  );
}
```

`followupOrder` is used by the drawer in Task 7; until then add `// eslint-disable-next-line no-unused-vars` is **not** acceptable — instead do Task 7 immediately after this task and lint both together.

- [ ] **Step 3: Route `flow-completed` in `DieOrderingSystem.jsx`**

Add `import InManufacturingPage from './pages/InManufacturingPage';` after the `FlowPage` import. Change the flow-page condition to exclude `flow-completed` and add a branch:

```jsx
          {activeTab === 'flow-completed' && hasPageAccess(activeTab) && (
            <InManufacturingPage
              data={data} searchTerm={searchTerm} setSearchTerm={setSearchTerm} theme={theme}
              correctors={correctors} correctorsError={correctorsError}
              setSelectedOrder={setSelectedOrder} setRevisionHistoryOrder={setRevisionHistoryOrder}
              setData={setData} setToast={setToast} setActiveTab={setActiveTab}
            />
          )}
```

with the existing FlowPage condition becoming
`activeTab.startsWith('flow-') && activeTab !== 'flow-completed' && !activeTab.includes('sample-followup') && hasPageAccess(activeTab)`.

- [ ] **Step 4: Strip the `DONE` branch from `FlowPage.jsx`**

Remove: the `{ id: 'flow-completed', status: 'DONE' }` entry; `if (currentFlow.status === 'DONE') …` in `flowOrders` (keep `return o.STATUS === currentFlow.status;`); `case 'DONE':` in `getStageEntryDate`; `hasDieReceivedDate`; `isDone` and its `<th>`/`<td>`; the `dieReceivanceOrder`/`dieReceivanceForm` state and modal; imports no longer used (`CorrectorSelect`, `skipTrialAllowed`, `skipTrialDefault`, `buildReceivancePatch`, `todayLocal` only if unused — it is still used by `handleCompleteStep`, keep it).

Run: `npx eslint src/pages/FlowPage.jsx` — fix any unused-import errors this introduced.

- [ ] **Step 5: Continue straight to Task 7** (commit after Task 7, since the page and drawer lint together).

---

### Task 7: Follow-up drawer

**Files:**
- Create: `src/components/delivery/DeliveryFollowupDrawer.jsx`
- Modify: `src/pages/InManufacturingPage.jsx` (import + render)

**Interfaces:**
- Consumes: `deliveryFollowupsAPI.getEvents/log`; utils `CAUSES`, `CHANNELS`, `needsCause`, `validateFollowUpForm`, `normalizeEta`, `causeLabel`, `channelLabel`, `formatSlip`.
- Produces: `<DeliveryFollowupDrawer order summary theme onClose onSaved({ events, eta }) />`.

- [ ] **Step 1: Create the drawer**

```jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { deliveryFollowupsAPI } from '../../api';
import { formatDate } from '../../utils/helpers';
import { todayLocal } from '../../utils/today.js';
import {
  CAUSES, CHANNELS, needsCause, validateFollowUpForm, normalizeEta, causeLabel, channelLabel, formatSlip,
} from '../../utils/deliveryFollowup';

const emptyForm = () => ({ contactDate: todayLocal(), channel: 'email', note: '', newEta: '', cause: '', causeNote: '' });

const describe = (e) => {
  if (e.kind === 'eta_set') return { title: `ETA set to ${formatDate(e.eta_after)}` };
  if (e.kind === 'eta_revised') {
    return {
      title: `ETA ${formatDate(e.eta_before)} → ${e.eta_after ? formatDate(e.eta_after) : 'withdrawn'}`,
      detail: [causeLabel(e.cause), e.note].filter(Boolean).join(' — '),
    };
  }
  if (e.kind === 'contact') return { title: `${channelLabel(e.channel)} on ${formatDate(e.contact_date)}`, detail: e.note };
  return { title: 'Chaser email sent', detail: e.note };
};

export default function DeliveryFollowupDrawer({ order, summary, theme, onClose, onSaved }) {
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const firstField = useRef(null);

  const loadEvents = useCallback(() => deliveryFollowupsAPI.getEvents(order.id)
    .then((r) => { setEvents(r?.events || []); setEventsError(''); })
    .catch((err) => setEventsError(err.message || 'Could not load the timeline')), [order.id]);

  useEffect(() => { loadEvents(); firstField.current?.focus(); }, [loadEvents]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = todayLocal();
  const current = normalizeEta(order.ETA);
  const showCause = !!form.newEta && needsCause(order.ETA, form.newEta);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const problem = validateFollowUpForm(form, order.ETA, today);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const result = await deliveryFollowupsAPI.log(order.id, {
        contactDate: form.contactDate, channel: form.channel, note: form.note, newEta: form.newEta || undefined,
        cause: showCause ? form.cause : undefined, causeNote: showCause ? form.causeNote : undefined,
      });
      setForm(emptyForm());
      await loadEvents();
      onSaved(result);
    } catch (err) {
      setError(err.message || 'Could not save the follow-up');
    } finally {
      setSaving(false);
    }
  };

  const field = { width: '100%', padding: '9px 11px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', boxSizing: 'border-box' };
  const label = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: theme.textMuted, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000 }} onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="followup-title" onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', background: theme.cardBg, borderLeft: `1px solid ${theme.cardBorder}`, boxShadow: '-12px 0 32px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '1.1rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <h2 id="followup-title" style={{ margin: 0, fontSize: '1.05rem', color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</h2>
            <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: theme.textMuted }}>{[order.Supplier, order.Plant, order['Order No']].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer', padding: '4px' }}><X size={20} /></button>
        </header>

        <div style={{ overflowY: 'auto', padding: '1rem 1.25rem', flex: 1 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', margin: '0 0 1.1rem' }}>
            {[
              ['Current ETA', current ? formatDate(current) : (order.ETA || 'None')],
              ['Original ETA', summary?.originalEta ? formatDate(summary.originalEta) : '—'],
              ['Slips', summary?.slips ? `${summary.slips} (${formatSlip(summary.daysSlipped)})` : '0'],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: '8px 10px', borderRadius: '8px', background: theme.tableBg }}>
                <dt style={{ fontSize: '0.68rem', color: theme.textMuted, textTransform: 'uppercase' }}>{k}</dt>
                <dd style={{ margin: '2px 0 0', fontSize: '0.88rem', fontWeight: 600, color: theme.text }}>{v}</dd>
              </div>
            ))}
          </dl>

          <form onSubmit={submit} style={{ display: 'grid', gap: '10px', paddingBottom: '1.1rem', borderBottom: `1px solid ${theme.cardBorder}` }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: theme.text }}>Log a follow-up</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={label} htmlFor="followup-date">Date</label>
                <input ref={firstField} id="followup-date" type="date" max={today} value={form.contactDate} onChange={set('contactDate')} style={field} />
              </div>
              <div>
                <label style={label} htmlFor="followup-channel">Channel</label>
                <select id="followup-channel" value={form.channel} onChange={set('channel')} style={field}>
                  {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={label} htmlFor="followup-note">Supplier&apos;s reply</label>
              <textarea id="followup-note" rows={3} value={form.note} onChange={set('note')} placeholder="What did the supplier say?" style={{ ...field, resize: 'vertical' }} />
            </div>
            <div>
              <label style={label} htmlFor="followup-eta">New ETA from supplier (optional)</label>
              <input id="followup-eta" type="date" value={form.newEta} onChange={set('newEta')} style={field} />
            </div>
            {showCause && (
              <div style={{ display: 'grid', gap: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)' }}>
                <div>
                  <label style={label} htmlFor="followup-cause">Why did the ETA move?</label>
                  <select id="followup-cause" value={form.cause} onChange={set('cause')} style={field}>
                    <option value="">Pick a cause…</option>
                    {CAUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label} htmlFor="followup-cause-note">Cause note{form.cause === 'other' ? ' (required)' : ' (optional)'}</label>
                  <input id="followup-cause-note" type="text" value={form.causeNote} onChange={set('causeNote')} style={field} />
                </div>
              </div>
            )}
            {error && <p role="alert" style={{ margin: 0, color: '#DC2626', fontSize: '0.8rem' }}>{error}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={saving} style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#4F46E5', color: 'white', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving…' : 'Save follow-up'}
              </button>
            </div>
          </form>

          <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '0.9rem', color: theme.text }}>Timeline</h3>
          {eventsError && <p role="alert" style={{ color: '#DC2626', fontSize: '0.8rem' }}>{eventsError}</p>}
          {!eventsError && events.length === 0 && <p style={{ color: theme.textMuted, fontSize: '0.82rem' }}>Nothing logged yet.</p>}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '10px' }}>
            {events.map((e) => {
              const { title, detail } = describe(e);
              return (
                <li key={e.id} style={{ paddingLeft: '12px', borderLeft: `2px solid ${e.kind === 'eta_revised' ? '#D97706' : theme.cardBorder}` }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{title}</div>
                  {detail && <div style={{ fontSize: '0.82rem', color: theme.text, marginTop: '2px', whiteSpace: 'pre-wrap' }}>{detail}</div>}
                  <div style={{ fontSize: '0.72rem', color: theme.textMuted, marginTop: '2px' }}>
                    {e.created_by_name || 'Automatic'} · {new Date(e.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Render it from the page** — in `InManufacturingPage.jsx` add the import
`import DeliveryFollowupDrawer from '../components/delivery/DeliveryFollowupDrawer';` and, before the receivance modal:

```jsx
      {followupOrder && (
        <DeliveryFollowupDrawer
          order={followupOrder}
          summary={summaries[followupOrder.id]}
          theme={theme}
          onClose={() => setFollowupId(null)}
          onSaved={(result) => {
            if (result?.eta !== undefined && result.eta !== followupOrder.ETA) {
              setData((prev) => prev.map((o) => (o.id === followupOrder.id ? { ...o, ETA: result.eta } : o)));
            }
            loadSummaries();
            setToast({ message: `Follow-up saved for ${followupOrder['DIE NO']}`, type: 'success' });
            setTimeout(() => setToast(null), 3000);
          }}
        />
      )}
```

- [ ] **Step 3: Lint and build**

Run: `npx eslint src/pages/InManufacturingPage.jsx src/components/delivery/DeliveryFollowupDrawer.jsx src/components/delivery/DieReceivanceModal.jsx src/pages/FlowPage.jsx src/DieOrderingSystem.jsx`
Expected: no errors in the new files; `FlowPage.jsx`/`DieOrderingSystem.jsx` show no errors beyond those present on `main` (compare with `git stash; npx eslint …; git stash pop` if unsure).
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/InManufacturingPage.jsx src/components/delivery/ src/pages/FlowPage.jsx src/DieOrderingSystem.jsx
git commit -m "feat(delivery): In Manufacturing worklist with ETA buckets and a follow-up drawer"
```

---

### Task 8: Cause prompt in the die order form

**Files:**
- Create: `src/components/delivery/EtaCauseDialog.jsx`
- Modify: `src/DieOrderingSystem.jsx` (`OrderDetailModal`: state ~line 944, `handleSave` ~line 1072, render beside the status-reason modal ~line 1413)

**Interfaces:**
- Consumes: `CAUSES`, `needsCause` (Task 5); server accepts `'ETA Change'` (Task 2).
- Produces: `<EtaCauseDialog theme fromEta toEta onCancel onConfirm({ cause, note }) />`.

- [ ] **Step 1: Create the dialog**

```jsx
import React, { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { CAUSES } from '../../utils/deliveryFollowup';
import { formatDate } from '../../utils/helpers';

// Asked when the order form saves a changed ETA over a real one. The server
// refuses the change without a cause, so this is the only way through.
export default function EtaCauseDialog({ theme, fromEta, toEta, onCancel, onConfirm }) {
  const [cause, setCause] = useState('');
  const [note, setNote] = useState('');
  const ready = !!cause && (cause !== 'other' || note.trim());
  const field = { width: '100%', padding: '9px 11px', background: theme?.inputBg || '#0F172A', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', color: theme?.text || '#F1F5F9', fontSize: '0.875rem', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-labelledby="eta-cause-title" style={{ background: theme?.cardBg || '#1E293B', borderRadius: '16px', width: '100%', maxWidth: '440px', border: `1px solid ${theme?.cardBorder || '#334155'}`, overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}`, background: 'rgba(217,119,6,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CalendarClock size={18} color="white" />
          </div>
          <div>
            <h3 id="eta-cause-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: theme?.text || '#F1F5F9' }}>Why did the ETA move?</h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: theme?.textDim || '#64748B' }}>
              {formatDate(fromEta)} → {toEta ? formatDate(toEta) : 'no date'}
            </p>
          </div>
        </div>
        <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gap: '10px' }}>
          <select aria-label="Cause" autoFocus value={cause} onChange={(e) => setCause(e.target.value)} style={field}>
            <option value="">Pick a cause…</option>
            {CAUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <textarea aria-label="Note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={cause === 'other' ? 'Say what the cause is (required)' : 'Note (optional)'} style={{ ...field, resize: 'vertical' }} />
        </div>
        <div style={{ padding: '0 1.5rem 1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', color: theme?.textDim || '#64748B', fontSize: '0.875rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" disabled={!ready} onClick={() => onConfirm({ cause, note: note.trim() })}
            style={{ padding: '8px 18px', background: ready ? '#D97706' : '#334155', border: 'none', borderRadius: '8px', color: 'white', fontSize: '0.875rem', cursor: ready ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
            Save with this cause
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `OrderDetailModal`**

Imports at the top of `DieOrderingSystem.jsx`:

```js
import EtaCauseDialog from './components/delivery/EtaCauseDialog';
import { needsCause } from './utils/deliveryFollowup';
```

State beside `pendingStatusLog`:

```js
  const [etaCausePrompt, setEtaCausePrompt] = useState(false);
```

`handleSave` becomes `const handleSave = async (etaChange) => {` and starts with:

```js
    // onClick passes an event; only a real answer from the cause dialog counts.
    const change = etaChange && etaChange.cause ? etaChange : null;
    if (!change && needsCause(order.ETA, editedOrder.ETA)) {
      setEtaCausePrompt(true);
      return;
    }
```

and after `if (pendingStatusLog) patch['Change Log'] = [pendingStatusLog];` add:

```js
      if (change) patch['ETA Change'] = change;
```

Render just before `{/* Status Change Reason Modal */}`:

```jsx
      {etaCausePrompt && (
        <EtaCauseDialog
          theme={theme}
          fromEta={order.ETA}
          toEta={editedOrder.ETA}
          onCancel={() => setEtaCausePrompt(false)}
          onConfirm={(c) => { setEtaCausePrompt(false); handleSave(c); }}
        />
      )}
```

- [ ] **Step 3: Lint and build**

Run: `npx eslint src/components/delivery/EtaCauseDialog.jsx src/DieOrderingSystem.jsx` → no new errors
Run: `npm run build` → succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/delivery/EtaCauseDialog.jsx src/DieOrderingSystem.jsx
git commit -m "feat(delivery): ask for the cause when the order form moves a set ETA"
```

---

### Task 9: Chaser settings panel

**Files:**
- Create: `src/components/email/DeliveryChaserSettings.jsx`
- Modify: `src/components/email/EmailSettings.jsx` (import; render after `<DailySummarySettings … />`)

**Interfaces:**
- Consumes: `emailAPI.getDeliveryChaserSettings/updateDeliveryChaserSettings/runDeliveryChaserNow/previewDeliveryChaser`; `inputStyle`, `cardStyle`, `ToggleButton`.

- [ ] **Step 1: Create the panel**

```jsx
import React, { useState, useEffect } from 'react';
import { Truck, Save, Send, Eye, CheckCircle, XCircle, X } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, cardStyle } from './settingsStyles';
import ToggleButton from './ToggleButton';

const DeliveryChaserSettings = ({ theme, showToast }) => {
    const [settings, setSettings] = useState({ enabled: false, time: '08:00', intervalDays: 3, noEtaDays: 7, cc: '' });
    const [state, setState] = useState(null);
    const [lastRunDate, setLastRunDate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [shown, setShown] = useState(0);

    const load = async () => {
        try {
            const result = await emailAPI.getDeliveryChaserSettings();
            const s = result.settings || {};
            setSettings({
                enabled: s.delivery_chaser_enabled || false,
                time: s.delivery_chaser_time || '08:00',
                intervalDays: s.delivery_chaser_interval_days ?? 3,
                noEtaDays: s.delivery_chaser_no_eta_days ?? 7,
                cc: s.delivery_chaser_cc || '',
            });
            setState(result.state);
            setLastRunDate(s.delivery_chaser_last_run);
        } catch (err) {
            console.error('Failed to fetch delivery chaser settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateDeliveryChaserSettings({
                ...settings,
                intervalDays: Number(settings.intervalDays),
                noEtaDays: Number(settings.noEtaDays),
            });
            showToast('Delivery chaser settings saved', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to save delivery chaser settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSendNow = async () => {
        setSending(true);
        try {
            const { summary } = await emailAPI.runDeliveryChaserNow();
            if (summary?.skipped) showToast(`Not run — ${summary.reason}`, 'error');
            else {
                const parts = [`${summary.sent} sent`];
                if (summary.notDue) parts.push(`${summary.notDue} not due yet`);
                if (summary.skippedNoEmail?.length) parts.push(`no email for ${summary.skippedNoEmail.join(', ')}`);
                if (summary.failed) parts.push(`${summary.failed} failed`);
                showToast(`Delivery chaser: ${parts.join(' · ')}`, summary.failed ? 'error' : 'success');
            }
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to run the delivery chaser', 'error');
        } finally {
            setSending(false);
        }
    };

    const handlePreview = async () => {
        setPreviewing(true);
        try {
            setPreview(await emailAPI.previewDeliveryChaser());
            setShown(0);
        } catch (err) {
            showToast(err.message || 'Failed to build the preview', 'error');
        } finally {
            setPreviewing(false);
        }
    };

    const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' };
    const hintStyle = { fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' };
    const secondaryButton = (busy) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '12px', border: `1px solid ${theme.cardBorder}`, background: 'transparent', color: theme.text, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap' });
    const current = preview?.suppliers?.[shown];

    return (
        <div style={cardStyle(theme)}>
            <ToggleButton
                theme={theme}
                enabled={settings.enabled}
                onToggle={() => setSettings({ ...settings, enabled: !settings.enabled })}
                label="Die Delivery Chaser"
                sublabel={settings.enabled
                    ? `Active — checked daily at ${settings.time}; each supplier at most every ${settings.intervalDays} day(s)`
                    : 'Disabled — no delivery chasers will be sent'}
                icon={Truck}
                color="#4F46E5"
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '18px' }}>
                <div>
                    <label style={labelStyle} htmlFor="deliverychaser-time">Check Time</label>
                    <input id="deliverychaser-time" type="time" value={settings.time} onChange={(e) => setSettings({ ...settings, time: e.target.value || '08:00' })} style={inputStyle(theme)} />
                    <p style={hintStyle}>Server time, Asia/Dubai.</p>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="deliverychaser-interval">Chase Every (days)</label>
                    <input id="deliverychaser-interval" type="number" min="1" max="60" value={settings.intervalDays} onChange={(e) => setSettings({ ...settings, intervalDays: e.target.value })} style={inputStyle(theme)} />
                    <p style={hintStyle}>Per supplier. 1 = daily, 7 = weekly.</p>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="deliverychaser-noeta">Ask for ETA After (days)</label>
                    <input id="deliverychaser-noeta" type="number" min="1" max="365" value={settings.noEtaDays} onChange={(e) => setSettings({ ...settings, noEtaDays: e.target.value })} style={inputStyle(theme)} />
                    <p style={hintStyle}>Days in manufacturing with no ETA.</p>
                </div>
            </div>

            <div style={{ marginTop: '12px' }}>
                <label style={labelStyle} htmlFor="deliverychaser-cc">CC (optional)</label>
                <input id="deliverychaser-cc" type="text" value={settings.cc} onChange={(e) => setSettings({ ...settings, cc: e.target.value })} placeholder="buyer@company.com" style={inputStyle(theme)} />
                <p style={hintStyle}>Comma-separated. Each email goes to the supplier&apos;s contact email set in Settings → Suppliers; suppliers without one are skipped.</p>
            </div>

            {(state?.error || lastRunDate) && (
                <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '10px', background: state?.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)', fontSize: '0.8rem', color: state?.error ? '#EF4444' : '#10B981', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {state?.error
                        ? <><XCircle size={14} /> Last run error: {state.error}</>
                        : <><CheckCircle size={14} /> Last run: {lastRunDate}{state?.lastResult ? ` — ${state.lastResult.sent} sent` : ''}</>}
                </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '12px', border: 'none', background: '#4F46E5', color: '#fff', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
                    <Save size={15} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleSendNow} disabled={sending} style={secondaryButton(sending)}>
                    <Send size={15} /> {sending ? 'Sending…' : 'Send now'}
                </button>
                <button onClick={handlePreview} disabled={previewing} style={secondaryButton(previewing)}>
                    <Eye size={15} /> {previewing ? 'Building…' : 'Preview'}
                </button>
            </div>

            <p style={{ ...hintStyle, marginTop: '12px' }}>
                <strong>Send now</strong> mails every supplier that is due right now — a supplier chased within the last {settings.intervalDays} day(s) is skipped.
                <strong> Preview</strong> only shows the emails; it sends nothing and changes nothing.
            </p>

            {preview && (
                <div style={{ marginTop: '16px', border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: theme.tableBg }}>
                        <strong style={{ color: theme.text, fontSize: '0.85rem' }}>
                            {preview.suppliers.length ? `Preview for ${preview.today}` : `Nothing to chase on ${preview.today}`}
                        </strong>
                        <button onClick={() => setPreview(null)} aria-label="Close preview" style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer' }}><X size={16} /></button>
                    </div>
                    {preview.suppliers.length > 0 && (
                        <>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px 14px' }}>
                                {preview.suppliers.map((s, i) => (
                                    <button key={s.supplier} onClick={() => setShown(i)} aria-pressed={i === shown}
                                        style={{ padding: '5px 10px', borderRadius: '999px', fontSize: '0.75rem', cursor: 'pointer', border: `1px solid ${i === shown ? '#4F46E5' : theme.cardBorder}`, background: i === shown ? 'rgba(79,70,229,0.12)' : 'transparent', color: theme.text }}>
                                        {s.supplier} · {s.overdueCount + s.noEtaCount}
                                    </button>
                                ))}
                            </div>
                            <div style={{ padding: '0 14px 10px', fontSize: '0.78rem', color: theme.textMuted }}>
                                To: {current.to || 'no contact email — will be skipped'}{preview.cc ? ` · CC: ${preview.cc}` : ''} ·{' '}
                                {current.due ? 'due now' : `next chase ${current.nextDay}`}
                                <div style={{ marginTop: '2px' }}>Subject: {current.subject}</div>
                            </div>
                            <iframe title="Chaser email preview" sandbox="" srcDoc={current.html} style={{ width: '100%', height: '420px', border: 'none', background: '#fff' }} />
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default DeliveryChaserSettings;
```

- [ ] **Step 2: Render it** — in `EmailSettings.jsx` add
`import DeliveryChaserSettings from './DeliveryChaserSettings';` and after `<DailySummarySettings theme={theme} showToast={showToast} />`:

```jsx
            {/* Die Delivery Chaser */}
            <DeliveryChaserSettings theme={theme} showToast={showToast} />
```

- [ ] **Step 3: Lint and build**

Run: `npx eslint src/components/email/DeliveryChaserSettings.jsx src/components/email/EmailSettings.jsx` → no new errors
Run: `npm run build` → succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/email/DeliveryChaserSettings.jsx src/components/email/EmailSettings.jsx
git commit -m "feat(delivery): delivery chaser settings with preview and send now"
```

---

### Task 10: Verify on the test server and merge

**Files:** none (plus memory notes)

- [ ] **Step 1: Full test suite with the Postgres suites enabled**

```bash
docker start die-work-queue-test
PW=$(docker inspect die-work-queue-test --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')
WORK_QUEUE_TEST_DATABASE_URL="postgres://postgres:${PW}@127.0.0.1:55432/die_queue_test" \
WORK_QUEUE_API_TEST_DATABASE_URL="postgres://postgres:${PW}@127.0.0.1:55432/die_queue_api_test" npm test
```
Expected: 0 fail, 0 skipped.

- [ ] **Step 2: Build**

Run: `npm run build` → succeeds.

- [ ] **Step 3: Rebuild the test server**

```bash
docker compose build backend frontend && docker compose up -d backend frontend
docker logs die-ordering-backend --tail 40
```
Expected: "Delivery chaser scheduler started", no migration errors. Then confirm the schema:
`MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "\d die_delivery_events" -c "SELECT delivery_chaser_enabled, delivery_chaser_interval_days FROM reminder_settings"` → table present, `f | 3`.

- [ ] **Step 4: Browser check** (follow the no-credentials approach in the `skip-trial-on-receipt` memory; never brute-force a login)

On the test server: open In Manufacturing → counts render and sum to the page count; click Overdue → only overdue rows; open Follow up on a die with an ETA → log a reply (row shows Last follow-up); enter a new ETA without a cause → inline error; with a cause → ETA cell shows the original struck through and Slips = 1; open the die in the order form, change the ETA → cause dialog appears; Settings → Email → Die Delivery Chaser → Preview renders without sending. Screenshot the page and the drawer.

Record every die id touched, and remove only those rows afterwards (`DELETE FROM die_delivery_events WHERE id IN (…)`, restore each `eta` you changed) after counting before/after — never an unscoped delete.

- [ ] **Step 5: Merge into main**

```bash
git checkout main
git merge --no-ff feat/die-delivery-followup -m "Merge branch 'feat/die-delivery-followup' into main"
```

Pushing is blocked (403, account mismatch) — report it rather than retrying.
