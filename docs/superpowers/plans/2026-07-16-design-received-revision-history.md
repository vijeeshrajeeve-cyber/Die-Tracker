# Preserve First Design-Received Date & Log Re-Receipts Per Revision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Design Received Date` / `3D Model Received Date` write-once and record every post-revision re-receipt against its revision row, while surfacing the revision count on the Order Detail modal.

**Architecture:** Add two nullable columns to `order_revisions`. A new server endpoint `PATCH /orders/:id/complete-stage` advances the workflow and decides — via a pure, unit-tested planner — whether the received date sets the (still-empty) top-level column or the latest open revision row. `FlowPage`'s completion action calls this endpoint for the two design stages; other stages keep the generic PATCH. `RevisionHistoryModal` and `OrderDetailModal` display the new data.

**Tech Stack:** Node/Express + `pg` (backend), React (frontend, Vite), `node:test` for backend unit tests. No frontend test framework — frontend verified with `npm run lint` + `npm run build`.

## Global Constraints

- Backend tests use Node's built-in `node:test` runner: `npm test` runs `node --test "server/**/*.test.cjs"`. No Jest/Vitest. Pure functions are unit-tested; route handlers are not directly tested (no supertest harness exists).
- Frontend has **no** component test framework. Verify frontend changes with `npm run lint` and `npm run build` only.
- Schema migrations live in `server/db.cjs` as idempotent `IF NOT EXISTS` blocks. `order_revisions` is created **only** in `server/db.cjs` (not `init.sql`).
- Backend API port 3001 is not published to the host; DB-level verification runs via `docker exec die-ordering-db psql -U postgres -d die_ordering`.
- Use existing helpers already imported in `server/routes/orders.cjs`: `body` (express-validator), `VALID_STATUSES`, `sanitizeDate`, `sanitizeString`, `handleValidationErrors`, `orderIdValidation`, `pool`.
- Revision "re-received" columns: `design_received_date` and `model_received_date` on `order_revisions`.

---

### Task 1: Add revision received-date columns to the schema

**Files:**
- Modify: `server/db.cjs` — the `CREATE TABLE IF NOT EXISTS order_revisions (...)` block (around line 726) and add an idempotent `ALTER` for existing databases.

**Interfaces:**
- Produces: columns `order_revisions.design_received_date TEXT` and `order_revisions.model_received_date TEXT`.

- [ ] **Step 1: Add the columns to the CREATE TABLE (fresh installs)**

In `server/db.cjs`, inside the `CREATE TABLE IF NOT EXISTS order_revisions (...)` statement, add the two columns after `revision_pdf TEXT`:

```javascript
      CREATE TABLE IF NOT EXISTS order_revisions (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL,
        from_status TEXT,
        to_status TEXT,
        notes TEXT,
        revision_date TEXT,
        revision_pdf TEXT,
        design_received_date TEXT,
        model_received_date TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
```

- [ ] **Step 2: Add an idempotent migration for existing installs**

Immediately after the `CREATE INDEX IF NOT EXISTS idx_order_revisions_order_id ...` line (around line 740), add:

```javascript
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='order_revisions' AND column_name='design_received_date') THEN
          ALTER TABLE order_revisions ADD COLUMN design_received_date TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='order_revisions' AND column_name='model_received_date') THEN
          ALTER TABLE order_revisions ADD COLUMN model_received_date TEXT;
        END IF;
      END $$;
    `);
```

- [ ] **Step 3: Apply and verify against the running DB**

Restart the backend so `db.cjs` runs its migrations (e.g. `docker restart die-ordering-backend`), then verify:

Run:
```bash
docker exec die-ordering-db psql -U postgres -d die_ordering -c "\d order_revisions"
```
Expected: output lists both `design_received_date | text` and `model_received_date | text`.

- [ ] **Step 4: Commit**

```bash
git add server/db.cjs
git commit -m "feat(db): add per-revision received-date columns to order_revisions"
```

---

### Task 2: Pure stage-completion planner + unit tests

**Files:**
- Create: `server/services/stageCompletion.cjs`
- Test: `server/services/stageCompletion.test.cjs`

**Interfaces:**
- Produces:
  - `RECEIVED_FIELDS` — object keyed by display field name → `{ orderCol, revisionCol }`.
  - `planReceivedDate({ field, existingValue }) → { writeTo: 'order'|'revision', orderCol: string|null, revisionCol: string|null }`.

- [ ] **Step 1: Write the failing test**

Create `server/services/stageCompletion.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planReceivedDate, RECEIVED_FIELDS } = require('./stageCompletion.cjs');

test('first design receipt (empty existing) writes to the order column', () => {
  const plan = planReceivedDate({ field: 'Design Received Date', existingValue: null });
  assert.equal(plan.writeTo, 'order');
  assert.equal(plan.orderCol, 'design_received_date');
  assert.equal(plan.revisionCol, 'design_received_date');
});

test('re-received design (existing set) writes to the revision column', () => {
  const plan = planReceivedDate({ field: 'Design Received Date', existingValue: '2026-07-01' });
  assert.equal(plan.writeTo, 'revision');
  assert.equal(plan.revisionCol, 'design_received_date');
});

test('first 3D model receipt writes to the order column', () => {
  const plan = planReceivedDate({ field: '3D Model Received Date', existingValue: '' });
  assert.equal(plan.writeTo, 'order');
  assert.equal(plan.orderCol, 'three_d_model_received_date');
  assert.equal(plan.revisionCol, 'model_received_date');
});

test('re-received 3D model writes to the model revision column', () => {
  const plan = planReceivedDate({ field: '3D Model Received Date', existingValue: '2026-07-02' });
  assert.equal(plan.writeTo, 'revision');
  assert.equal(plan.revisionCol, 'model_received_date');
});

test('whitespace-only existing value counts as empty (first receipt)', () => {
  const plan = planReceivedDate({ field: 'Design Received Date', existingValue: '   ' });
  assert.equal(plan.writeTo, 'order');
});

test('unknown field falls back to order with null column', () => {
  const plan = planReceivedDate({ field: 'PR Entry', existingValue: 'anything' });
  assert.equal(plan.writeTo, 'order');
  assert.equal(plan.orderCol, null);
});

test('RECEIVED_FIELDS maps both received fields', () => {
  assert.deepEqual(Object.keys(RECEIVED_FIELDS).sort(), ['3D Model Received Date', 'Design Received Date']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './stageCompletion.cjs'`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/services/stageCompletion.cjs`:

```javascript
'use strict';

// Fields whose "received" date must be preserved on first receipt and recorded
// against the latest open revision on subsequent (post-revision) receipts.
const RECEIVED_FIELDS = {
  'Design Received Date':   { orderCol: 'design_received_date',        revisionCol: 'design_received_date' },
  '3D Model Received Date': { orderCol: 'three_d_model_received_date', revisionCol: 'model_received_date' },
};

function isEmpty(v) {
  return v == null || String(v).trim() === '';
}

// Decide where a stage-completion date should be written.
// - Unknown field: order column (null → caller handles generically).
// - Known field, no existing value: order column (first receipt).
// - Known field, existing value present: latest open revision row (re-receipt).
function planReceivedDate({ field, existingValue }) {
  const mapping = RECEIVED_FIELDS[field];
  if (!mapping) {
    return { writeTo: 'order', orderCol: null, revisionCol: null };
  }
  if (isEmpty(existingValue)) {
    return { writeTo: 'order', orderCol: mapping.orderCol, revisionCol: mapping.revisionCol };
  }
  return { writeTo: 'revision', orderCol: mapping.orderCol, revisionCol: mapping.revisionCol };
}

module.exports = { RECEIVED_FIELDS, planReceivedDate, isEmpty };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `stageCompletion` tests green (existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add server/services/stageCompletion.cjs server/services/stageCompletion.test.cjs
git commit -m "feat: add pure planner for preserving first received date"
```

---

### Task 3: Server endpoint `PATCH /orders/:id/complete-stage` + expose revision dates

**Files:**
- Modify: `server/routes/orders.cjs` — add the new endpoint before `module.exports = router;` (after the `POST /:id/revisions` handler, ~line 680); extend the `GET /:id/revisions` SELECT (~line 577) to return the new columns.

**Interfaces:**
- Consumes: `planReceivedDate`, `RECEIVED_FIELDS` from `server/services/stageCompletion.cjs`.
- Produces: endpoint `PATCH /orders/:id/complete-stage` with body `{ field, date?, nextStatus }`, JSON response `{ message, target: 'order'|'revision', status, date }`. `GET /:id/revisions` rows additionally include `design_received_date`, `model_received_date`.

- [ ] **Step 1: Import the planner**

At the top of `server/routes/orders.cjs`, alongside the other `require` statements, add:

```javascript
const { RECEIVED_FIELDS, planReceivedDate } = require('../services/stageCompletion.cjs');
```

- [ ] **Step 2: Extend the revision-history SELECT**

In the `GET /:id/revisions` handler, change the SELECT column list to include the two new columns:

```javascript
        const result = await pool.query(`
            SELECT r.id, r.revision_number, r.from_status, r.to_status,
                   r.notes, r.revision_date, r.revision_pdf,
                   r.design_received_date, r.model_received_date, r.created_at,
                   COALESCE(u.username, r.created_by_name, 'Unknown') AS created_by
            FROM order_revisions r
            LEFT JOIN users u ON u.id = r.created_by
            WHERE r.order_id = $1
            ORDER BY r.revision_number DESC
        `, [id]);
```

- [ ] **Step 3: Add the complete-stage endpoint**

Insert immediately before `module.exports = router;`:

```javascript
// Complete a design/simulation stage: advances status and records the received
// date. Preserves the first received date on the order; logs re-receipts (after a
// revision) on the latest open revision row so history is never overwritten.
const completeStageValidation = [
    body('field').isString().custom((v) => {
        if (!RECEIVED_FIELDS[v]) throw new Error('Invalid field');
        return true;
    }),
    body('nextStatus').isString().custom((v) => {
        if (!VALID_STATUSES.includes(v)) throw new Error('Invalid next status');
        return true;
    }),
    body('date').optional({ nullable: true }).customSanitizer(sanitizeString),
];

router.patch('/:id/complete-stage', orderIdValidation, completeStageValidation, handleValidationErrors, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { field, nextStatus } = req.body;
        const date = sanitizeDate(req.body.date) || new Date().toISOString().split('T')[0];
        const mapping = RECEIVED_FIELDS[field];

        await client.query('BEGIN');

        const orderRes = await client.query(
            `SELECT status, ${mapping.orderCol} AS existing FROM die_orders WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (orderRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
        }

        const fromStatus = orderRes.rows[0].status;
        const plan = planReceivedDate({ field, existingValue: orderRes.rows[0].existing });
        let target = 'order';

        if (plan.writeTo === 'order') {
            await client.query(
                `UPDATE die_orders SET ${mapping.orderCol} = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
                [date, nextStatus, id]
            );
        } else {
            // Record the re-received date on the most recent revision still missing it.
            const revRes = await client.query(
                `UPDATE order_revisions SET ${mapping.revisionCol} = $1
                 WHERE id = (
                   SELECT id FROM order_revisions
                   WHERE order_id = $2 AND ${mapping.revisionCol} IS NULL
                   ORDER BY revision_number DESC LIMIT 1
                 )`,
                [date, id]
            );
            if (revRes.rowCount === 0) {
                // Defensive fallback: no open revision row → keep the date on the order.
                await client.query(
                    `UPDATE die_orders SET ${mapping.orderCol} = $1 WHERE id = $2`,
                    [date, id]
                );
            } else {
                target = 'revision';
            }
            await client.query(
                `UPDATE die_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [nextStatus, id]
            );
        }

        // Audit entry in the change log.
        await client.query(`
            INSERT INTO order_changes
              (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
            id,
            req.user?.id || null,
            req.user?.username || null,
            new Date(),
            'STATUS',
            fromStatus,
            nextStatus,
            null,
            fromStatus,
        ]);

        await client.query('COMMIT');
        res.json({ message: 'Stage completed', target, status: nextStatus, date });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Complete stage error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});
```

- [ ] **Step 4: Verify the backend boots and lints**

Run: `npm test`
Expected: PASS — existing + `stageCompletion` tests green (this task adds no new unit test; the route uses the already-tested planner).

Run: `npm run lint`
Expected: no new errors in `server/routes/orders.cjs`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/orders.cjs
git commit -m "feat(api): add complete-stage endpoint preserving first received date"
```

---

### Task 4: Add `ordersAPI.completeStage` client method

**Files:**
- Modify: `src/api.js` — inside the `ordersAPI` object, next to `createRevision` (~line 176).

**Interfaces:**
- Consumes: `PATCH /orders/:id/complete-stage`.
- Produces: `ordersAPI.completeStage(id, { field, date, nextStatus }) → Promise<{ message, target, status, date }>`.

- [ ] **Step 1: Add the method**

After the `createRevision` method in `src/api.js`, add:

```javascript
    // Complete a design/simulation stage. Preserves the first received date on the
    // order and records re-receipts (after a revision) on the latest revision row.
    completeStage: async (id, { field, date, nextStatus } = {}) => {
        return apiRequest(`/orders/${id}/complete-stage`, {
            method: 'PATCH',
            body: JSON.stringify({ field, date, nextStatus }),
        });
    },
```

- [ ] **Step 2: Verify lint/build**

Run: `npm run lint`
Expected: no errors in `src/api.js`.

- [ ] **Step 3: Commit**

```bash
git add src/api.js
git commit -m "feat(api-client): add completeStage method"
```

---

### Task 5: Route design/simulation completions through `completeStage` in FlowPage

**Files:**
- Modify: `src/pages/FlowPage.jsx` — `handleCompleteStep` (~line 122).

**Interfaces:**
- Consumes: `ordersAPI.completeStage`, existing `workflow.dateField`, `workflow.nextStatus`, `isSimulationEnabled`.

- [ ] **Step 1: Add the received-field constant**

Near the top of the component body (before `handleCompleteStep`), add:

```javascript
  const RECEIVED_DATE_FIELDS = ['Design Received Date', '3D Model Received Date'];
```

- [ ] **Step 2: Branch `handleCompleteStep` on received fields**

Replace the body of `handleCompleteStep` (from `const patch = {` through the end of the `try/catch`) with:

```javascript
    const changeLogEntry = {
      date: today,
      field: 'STATUS',
      oldValue: order.STATUS,
      newValue: nextStatus,
      stage: order.STATUS,
    };
    try {
      if (RECEIVED_DATE_FIELDS.includes(workflow.dateField)) {
        // Write-once received date: first receipt sets the top-level field; a
        // re-receipt after a revision is logged on the revision row server-side.
        const alreadyReceived = !!order[workflow.dateField];
        await ordersAPI.completeStage(order.id, { field: workflow.dateField, date: today, nextStatus });
        setData(prev => prev.map(o => o.id === order.id ? {
          ...o,
          STATUS: nextStatus,
          ...(alreadyReceived ? {} : { [workflow.dateField]: today }),
          changeCount: (o.changeCount || 0) + 1,
        } : o));
      } else {
        const patch = {
          STATUS: nextStatus,
          [workflow.dateField]: today,
          'Change Log': [changeLogEntry],
        };
        await ordersAPI.patch(order.id, patch);
        setData(prev => prev.map(o => o.id === order.id ? {
          ...o,
          STATUS: nextStatus,
          [workflow.dateField]: today,
          changeCount: (o.changeCount || 0) + 1,
        } : o));
      }
      setToast({ message: `Order ${order['DIE NO']} moved to ${STATUS_CONFIG[nextStatus]?.label || nextStatus}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setToast({ message: 'Failed to update: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
```

Note: the original code built `patch` and `changeLogEntry` before the `try`. After this change, `changeLogEntry` is still declared before the `try` (kept above) and `patch` is built only inside the generic branch. Remove the now-duplicate `const patch = {...}` and `const changeLogEntry = {...}` that preceded the original `try` block so they are not declared twice.

- [ ] **Step 3: Verify lint/build**

Run: `npm run lint`
Expected: no errors in `src/pages/FlowPage.jsx` (in particular, no "duplicate declaration" or "unused variable" for `patch`/`changeLogEntry`).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual end-to-end check**

With the app running (frontend proxy on 8080): take an order through Design → Approval, request a revision (sends it back to Awaiting Design), complete the design step again, and confirm via DB that the top-level `design_received_date` is unchanged while the latest `order_revisions` row now has `design_received_date` set:

```bash
docker exec die-ordering-db psql -U postgres -d die_ordering -c "SELECT id, design_received_date FROM die_orders WHERE id = <ORDER_ID>; SELECT revision_number, design_received_date, model_received_date FROM order_revisions WHERE order_id = <ORDER_ID> ORDER BY revision_number;"
```
Expected: `die_orders.design_received_date` = the original first date; the latest revision row's `design_received_date` = today.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FlowPage.jsx
git commit -m "feat(flow): route design/sim completion through completeStage"
```

---

### Task 6: Show re-received dates in the Revision History modal

**Files:**
- Modify: `src/components/modals/RevisionHistoryModal.jsx` — inside the per-revision card render (~line 178, near the notes block).

**Interfaces:**
- Consumes: `rev.design_received_date`, `rev.model_received_date` from `GET /:id/revisions` (Task 3).

- [ ] **Step 1: Render the re-received dates**

Immediately after the closing of the `{rev.notes && (...)}` block (before the `By <created_by>` footer row, ~line 193), add:

```jsx
                                        {(rev.design_received_date || rev.model_received_date) && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                                                {rev.design_received_date && (
                                                    <span style={{ fontSize: '0.75rem', color: '#10B981', background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: '4px' }}>
                                                        Design re-received: {rev.design_received_date}
                                                    </span>
                                                )}
                                                {rev.model_received_date && (
                                                    <span style={{ fontSize: '0.75rem', color: '#10B981', background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: '4px' }}>
                                                        3D model re-received: {rev.model_received_date}
                                                    </span>
                                                )}
                                            </div>
                                        )}
```

- [ ] **Step 2: Verify lint/build**

Run: `npm run lint`
Expected: no errors in `RevisionHistoryModal.jsx`.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/RevisionHistoryModal.jsx
git commit -m "feat(revisions): show re-received dates in history modal"
```

---

### Task 7: Show the revision counter on the Order Detail modal

**Files:**
- Modify: `src/DieOrderingSystem.jsx` — `OrderDetailModal` signature (~line 899), the Timeline section (~line 1281), and the `OrderDetailModal` render site (~line 2921).

**Interfaces:**
- Consumes: `currentOrder['Design Revision Count']`, `setRevisionHistoryOrder` (already in scope at the render site).
- Produces: `OrderDetailModal` accepts a new `onViewRevisions` prop.

- [ ] **Step 1: Accept the `onViewRevisions` prop**

Change the `OrderDetailModal` signature:

```javascript
const OrderDetailModal = ({ order, onClose, onUpdate, theme, suppliers = [], plants = [], currentUser, canEdit = true, onViewRevisions }) => {
```

- [ ] **Step 2: Add a Revisions row in the Timeline section**

Immediately after the `Design Approved` `InfoRow` line (~line 1281), add:

```jsx
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}` }}>
                <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '80px' }}>Revisions</span>
                {currentOrder['Design Revision Count'] > 0 ? (
                  <button
                    onClick={() => onViewRevisions && onViewRevisions(currentOrder)}
                    style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)', cursor: 'pointer' }}
                    title="View revision history"
                  >
                    {currentOrder['Design Revision Count']} — View history
                  </button>
                ) : (
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>None</span>
                )}
              </div>
```

- [ ] **Step 3: Pass the callback at the render site**

At the `OrderDetailModal` render (~line 2921), add the `onViewRevisions` prop:

```jsx
        {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} theme={theme} suppliers={suppliers} plants={plants} currentUser={user} canEdit={activeTab === 'orders'} onViewRevisions={(o) => setRevisionHistoryOrder(o)} onUpdate={(updated) => { setData(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o)); setSelectedOrder(null); fetchBackupRequests(); }} />}
```

- [ ] **Step 4: Verify lint/build**

Run: `npm run lint`
Expected: no errors in `src/DieOrderingSystem.jsx`.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual check**

Open an order with ≥1 revision in the Order Detail modal; confirm the **Revisions** row shows the count and "View history", and clicking it opens the Revision History modal (which now also shows re-received dates from Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/DieOrderingSystem.jsx
git commit -m "feat(orders): show revision counter + history link on order detail"
```

---

## Self-Review Notes

- **Spec coverage:** write-once received dates (Tasks 1–3, 5); re-receipts stored per revision (Tasks 1, 3, 5); both `Design Received Date` and `3D Model Received Date` covered via `RECEIVED_FIELDS` (Task 2); Design Approved Date unchanged (untouched — still set by the generic PATCH path in FlowPage's non-received branch and the approval stage); revision counter on Order Details (Task 7); re-received dates visible in history (Task 6). ✅
- **Type/name consistency:** `planReceivedDate`, `RECEIVED_FIELDS`, columns `design_received_date`/`model_received_date`, `ordersAPI.completeStage`, prop `onViewRevisions` are used identically across tasks. ✅
- **Approval path:** `PENDING FOR DESIGN APPROVAL` completion has `dateField = 'Design Approved Date'`, which is **not** in `RECEIVED_DATE_FIELDS`, so it flows through the unchanged generic PATCH branch — approval date keeps updating as before. ✅
