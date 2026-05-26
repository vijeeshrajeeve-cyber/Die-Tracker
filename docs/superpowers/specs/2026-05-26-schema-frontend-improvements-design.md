# Schema & Frontend Improvements Design
**Date:** 2026-05-26  
**Approach:** Sequential — schema first, backend second, frontend third

---

## Context

Die-Tracker is a production die-order management system for Gulf Extrusions. The database has ~850 rows. This spec covers two improvement areas:
- **Data integrity & schema fixes** — proper date types, unique constraints, relational audit trail
- **Frontend refactoring** — split monolithic `DieOrderingSystem.jsx` into per-page components and add server-side pagination

---

## Phase 1: Schema Migration

Delivered as a single migration block in `db.cjs` using the existing `app_migrations` pattern (idempotent, one-time execution).

### 1.1 `order_changes` table

Replaces the `die_orders.change_log TEXT` column with a proper relational table.

```sql
CREATE TABLE order_changes (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);
CREATE INDEX ON order_changes(order_id);
```

**Migration steps:**
1. Create the table
2. For each row in `die_orders`, parse `change_log` JSON and insert one row per change entry into `order_changes` (with `user_id = NULL` for legacy entries that lack a user)
3. Drop `die_orders.change_log` column

### 1.2 Date columns: TEXT → DATE

Convert all workflow date fields from `TEXT` to `DATE` type. Invalid or blank values become `NULL`.

**`die_orders`:** `die_requested_date`, `ordered_date`, `design_received_date`, `three_d_model_received_date`, `design_approved_date`, `die_received_date`, `submission_date`, `sample_approval_date`

**`backup_die_requests`:** `requested_date`, `die_available`, `drawing_requested`, `ordered_date`

**`sample_followups`:** `die_received_date`, `submission_date`, `sample_approval_date`

**Migration per column:**
```sql
ALTER TABLE die_orders
  ALTER COLUMN die_requested_date TYPE DATE
  USING CASE WHEN die_requested_date ~ '^\d{4}-\d{2}-\d{2}$'
             THEN die_requested_date::DATE ELSE NULL END;
-- (repeat for each column)
```

### 1.3 UNIQUE constraint on `order_no`

Before adding the constraint, deduplicate existing rows: keep the row with the lowest `id` for each `order_no`; set `status = 'CANCELLED'` on any duplicates.

```sql
-- Deduplicate
UPDATE die_orders SET status = 'CANCELLED'
WHERE id NOT IN (
  SELECT MIN(id) FROM die_orders GROUP BY order_no
) AND order_no IS NOT NULL;

-- Add constraint
ALTER TABLE die_orders ADD CONSTRAINT uq_order_no UNIQUE (order_no);
```

---

## Phase 2: Backend Updates

### 2.1 Change log: write to `order_changes`

In `server/routes/orders.cjs`, the `PUT /:id` handler:
- Removes all `change_log` JSON parsing/serializing logic
- Inserts one row into `order_changes` per changed field:
  ```js
  INSERT INTO order_changes (order_id, user_id, field_name, old_value, new_value)
  VALUES ($1, $2, $3, $4, $5)
  ```
- `user_id` comes from `req.user.id` (JWT payload)

The `POST /:id/changeLogs` endpoint:
- Replaces JSON parsing with:
  ```sql
  SELECT oc.*, u.username
  FROM order_changes oc
  LEFT JOIN users u ON u.id = oc.user_id
  WHERE oc.order_id = $1
  ORDER BY oc.changed_at DESC
  ```

### 2.2 Pagination on `GET /api/orders`

Adds optional query params `?page=1&limit=50` (defaults: page 1, limit 50).

Query:
```sql
SELECT ... FROM die_orders ORDER BY created_at DESC
LIMIT $1 OFFSET $2
```

Response envelope:
```json
{
  "data": [...],
  "pagination": { "page": 1, "limit": 50, "total": 850, "pages": 17 }
}
```

Callers that omit `page`/`limit` get the first 50 results — no breaking change to existing consumers.

### 2.3 Date field handling

Backend accepts ISO date strings (`"2024-03-15"`) or `null` for all date fields. PostgreSQL `DATE` columns handle format validation automatically. On read, dates are returned as ISO strings — no extra conversion layer needed.

---

## Phase 3: Frontend Refactoring

### 3.1 New directory structure

```
src/
  pages/
    DashboardPage.jsx
    OrdersPage.jsx
    AnalyticsPage.jsx
    SampleFollowupsPage.jsx
    SettingsPage.jsx
    UsersPage.jsx
    flow/
      FlowPendingOrder.jsx
      FlowAwaitingDesign.jsx
      FlowSimulation.jsx
      FlowDesignApproval.jsx
      FlowPendingPR.jsx
      FlowOracleEntry.jsx
      FlowDesignEMS.jsx
      FlowCompleted.jsx
      FlowSampleFollowup.jsx
  components/        (unchanged)
  DieOrderingSystem.jsx  (thin shell)
```

### 3.2 `DieOrderingSystem.jsx` after refactor

Retains state-based navigation (no React Router — existing tab-switching pattern preserved). Responsible for:
- Shared state: `orders`, `suppliers`, `plants`, `presses`, loading flags
- A single `switch(currentPage)` rendering the active page component
- Passing shared data and callbacks as props to page components

Each page component owns its own local UI state: filters, search text, selected rows, modal open/closed flags.

### 3.3 Pagination in `OrdersPage.jsx`

Local state: `page`, `limit` (default 50). Fetches `GET /api/orders?page=X&limit=50` on mount and on page change. Renders a simple prev/next control at the bottom of the orders table, driven by `pagination.total` from the API response.

### 3.4 Change log modal update

`ChangeLogModal.jsx` receives the new flat array shape:
```js
{ id, field_name, old_value, new_value, changed_at, username }
```
Instead of the old parsed JSON entries. Display format stays the same — field name, old → new value, timestamp, and now also the username who made the change.

---

## Out of Scope

- React Router / URL-based navigation (state-based tab switching kept as-is)
- Security fixes (email password encryption, localStorage token — separate effort)
- Test coverage
- Other tables' date columns not listed above (e.g., `existing_production_data.production_date` — low priority, no UI date logic depends on it)
