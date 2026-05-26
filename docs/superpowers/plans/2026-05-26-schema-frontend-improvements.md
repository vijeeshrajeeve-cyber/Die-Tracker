# Schema & Frontend Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix data integrity issues (proper date types, unique constraints, relational audit trail) and split the 325KB `DieOrderingSystem.jsx` monolith into per-page components with server-side pagination.

**Architecture:** Three sequential phases — DB migration first (idempotent via `app_migrations` pattern), then backend route updates, then frontend extraction. The backend `order_changes` table replaces the `die_orders.change_log TEXT` column. Frontend pages are extracted into `src/pages/` and the shell becomes a thin `switch(activeTab)` router.

**Tech Stack:** PostgreSQL 15, Node.js/Express (CommonJS `.cjs`), React 19/Vite, no test framework present (use `curl` for backend verification, browser for frontend).

**Spec:** `docs/superpowers/specs/2026-05-26-schema-frontend-improvements-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/db.cjs` | Modify | Add 3 migration blocks inside `initializeDatabase` |
| `server/routes/orders.cjs` | Modify | Add change-log endpoint, pagination, order_changes writes |
| `src/api.js` | Modify | Add `getPage` and `getChangeLog` to `ordersAPI` |
| `src/DieOrderingSystem.jsx` | Modify | Thin shell — shared state + `switch(activeTab)` render |
| `src/pages/DashboardPage.jsx` | Create | Dashboard KPIs and charts |
| `src/pages/OrdersPage.jsx` | Create | Orders table with server-side pagination |
| `src/pages/AnalyticsPage.jsx` | Create | Analytics charts and filter bar |
| `src/pages/SampleFollowupsPage.jsx` | Create | Sample followup grid (currently inline in flow-sample-followup) |
| `src/pages/SettingsPage.jsx` | Create | Admin settings (suppliers, plants, budgets, API keys) |
| `src/pages/UsersPage.jsx` | Create | Admin user management |
| `src/pages/flow/FlowPage.jsx` | Create | Status-filtered order flow (8 flow tabs share this) |
| `src/components/modals/ChangeLogModal.jsx` | Modify | Fetch from API, map new shape |

---

## Phase 1: Database Migration

### Task 1: Add `order_changes` table migration

**Files:**
- Modify: `server/db.cjs` — inside the `try` block of `initializeDatabase`, after the existing `app_migrations` guard at the end of the large `client.query(...)` call

- [ ] **Step 1: Read the end of `initializeDatabase` in `server/db.cjs`**

  Open `server/db.cjs` and locate the `app_migrations` block (around line 444). Add the following migration block AFTER the closing of the large `client.query(...)` call (after line 471) but BEFORE `console.log('Database initialized successfully')`.

- [ ] **Step 2: Add the migration block**

  ```js
  // Migration: order_changes table (replaces change_log TEXT column)
  const ocExists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='order_changes'`
  );
  if (ocExists.rows.length === 0) {
    await client.query(`
      CREATE TABLE order_changes (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        changed_by_name TEXT,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        stage TEXT
      );
      CREATE INDEX idx_order_changes_order_id ON order_changes(order_id);
    `);
    console.log('Created order_changes table');

    // Migrate existing change_log JSON into order_changes
    const rows = await client.query(
      `SELECT id, change_log FROM die_orders WHERE change_log IS NOT NULL AND change_log != '[]'`
    );
    let migrated = 0;
    for (const row of rows.rows) {
      let entries;
      try { entries = JSON.parse(row.change_log); } catch { continue; }
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!e || !e.field) continue;
        const changedAt = e.date ? new Date(e.date) : new Date();
        await client.query(
          `INSERT INTO order_changes
            (order_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            row.id,
            e.changedBy || null,
            isNaN(changedAt) ? new Date() : changedAt,
            String(e.field),
            e.oldValue != null ? String(e.oldValue) : null,
            e.newValue != null ? String(e.newValue) : null,
            e.reason || null,
            e.stage || null,
          ]
        );
        migrated++;
      }
    }
    console.log(`Migrated ${migrated} change log entries to order_changes`);
  }

  // Drop change_log column after successful migration
  if (ocExists.rows.length === 0) {
    const colExists = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='change_log'`
    );
    if (colExists.rows.length > 0) {
      await client.query(`ALTER TABLE die_orders DROP COLUMN change_log`);
      console.log('Dropped die_orders.change_log column');
    }
  }
  ```

- [ ] **Step 3: Restart the backend and verify**

  ```bash
  # In Docker:
  docker compose restart backend
  docker compose logs backend --tail=30

  # Expected log lines:
  # Created order_changes table
  # Migrated N change log entries to order_changes
  # Dropped die_orders.change_log column
  # Database initialized successfully
  ```

- [ ] **Step 4: Verify table and data**

  Connect to the DB (via Supabase Studio at http://localhost:8082 or `docker exec -it <postgres-container> psql -U postgres die_ordering`) and run:

  ```sql
  SELECT COUNT(*) FROM order_changes;
  SELECT * FROM order_changes LIMIT 3;
  ```

  Confirm row count matches what was logged. Confirm `die_orders` no longer has a `change_log` column:
  ```sql
  SELECT column_name FROM information_schema.columns WHERE table_name='die_orders' AND column_name='change_log';
  -- Should return 0 rows
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add server/db.cjs
  git commit -m "feat: migrate change_log to order_changes table"
  ```

---

### Task 2: Convert TEXT date columns to DATE

**Files:**
- Modify: `server/db.cjs` — add another migration block immediately after the one from Task 1

- [ ] **Step 1: Add the date migration block**

  Add this block right after the `order_changes` migration code:

  ```js
  // Migration: TEXT date columns → DATE
  if (!await client.query(`SELECT 1 FROM app_migrations WHERE id='date_columns_to_date_v1'`).then(r => r.rows.length)) {
    const dieDateCols = [
      'die_requested_date','ordered_date','design_received_date',
      'three_d_model_received_date','design_approved_date','die_received_date',
      'submission_date','sample_approval_date'
    ];
    for (const col of dieDateCols) {
      const exists = await client.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name='die_orders' AND column_name=$1`, [col]
      );
      if (exists.rows.length > 0 && exists.rows[0].data_type === 'text') {
        await client.query(`
          ALTER TABLE die_orders
            ALTER COLUMN ${col} TYPE DATE
            USING CASE
              WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${col}::DATE
              ELSE NULL
            END
        `);
      }
    }

    const backupDateCols = ['requested_date','die_available','drawing_requested','ordered_date'];
    for (const col of backupDateCols) {
      const exists = await client.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name=$1`, [col]
      );
      if (exists.rows.length > 0 && exists.rows[0].data_type === 'text') {
        await client.query(`
          ALTER TABLE backup_die_requests
            ALTER COLUMN ${col} TYPE DATE
            USING CASE
              WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${col}::DATE
              ELSE NULL
            END
        `);
      }
    }

    const followupDateCols = ['die_received_date','submission_date','sample_approval_date'];
    for (const col of followupDateCols) {
      const exists = await client.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name='sample_followups' AND column_name=$1`, [col]
      );
      if (exists.rows.length > 0 && exists.rows[0].data_type === 'text') {
        await client.query(`
          ALTER TABLE sample_followups
            ALTER COLUMN ${col} TYPE DATE
            USING CASE
              WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${col}::DATE
              ELSE NULL
            END
        `);
      }
    }

    await client.query(`INSERT INTO app_migrations (id) VALUES ('date_columns_to_date_v1')`);
    console.log('Converted TEXT date columns to DATE type');
  }
  ```

- [ ] **Step 2: Restart backend and verify**

  ```bash
  docker compose restart backend
  docker compose logs backend --tail=20
  # Expected: "Converted TEXT date columns to DATE type"
  ```

  Verify in DB:
  ```sql
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'die_orders'
    AND column_name IN (
      'die_requested_date','ordered_date','design_received_date',
      'design_approved_date','die_received_date'
    );
  -- All should show data_type = 'date'
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/db.cjs
  git commit -m "feat: convert TEXT date columns to DATE type"
  ```

---

### Task 3: Add UNIQUE constraint on `order_no`

**Files:**
- Modify: `server/db.cjs` — add another migration block after Task 2's block

- [ ] **Step 1: Add the unique constraint migration**

  ```js
  // Migration: UNIQUE constraint on die_orders.order_no
  if (!await client.query(`SELECT 1 FROM app_migrations WHERE id='unique_order_no_v1'`).then(r => r.rows.length)) {
    // Mark duplicate order_no rows as CANCELLED (keep lowest id)
    await client.query(`
      UPDATE die_orders SET status = 'CANCELLED'
      WHERE id NOT IN (
        SELECT MIN(id) FROM die_orders WHERE order_no IS NOT NULL GROUP BY order_no
      ) AND order_no IS NOT NULL AND order_no != ''
    `);

    // Add unique constraint (ignoring NULLs — PostgreSQL unique allows multiple NULLs)
    const constraintExists = await client.query(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name='die_orders' AND constraint_name='uq_order_no'
    `);
    if (constraintExists.rows.length === 0) {
      await client.query(`ALTER TABLE die_orders ADD CONSTRAINT uq_order_no UNIQUE (order_no)`);
    }

    await client.query(`INSERT INTO app_migrations (id) VALUES ('unique_order_no_v1')`);
    console.log('Added UNIQUE constraint on die_orders.order_no');
  }
  ```

- [ ] **Step 2: Restart backend and verify**

  ```bash
  docker compose restart backend
  docker compose logs backend --tail=20
  # Expected: "Added UNIQUE constraint on die_orders.order_no"
  ```

  Verify:
  ```sql
  SELECT constraint_name FROM information_schema.table_constraints
  WHERE table_name = 'die_orders' AND constraint_name = 'uq_order_no';
  -- Should return 1 row
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/db.cjs
  git commit -m "feat: add UNIQUE constraint on die_orders.order_no"
  ```

---

## Phase 2: Backend Updates

### Task 4: Add `GET /orders/:id/change-log` endpoint

**Files:**
- Modify: `server/routes/orders.cjs`

- [ ] **Step 1: Add the endpoint before `module.exports = router`**

  In `server/routes/orders.cjs`, find the DELETE route (line ~370) and add this new endpoint after it, before `module.exports = router`:

  ```js
  // Get change log for a specific order
  router.get('/:id/change-log', orderIdValidation, handleValidationErrors, async (req, res) => {
      try {
          const { id } = req.params;
          const result = await pool.query(`
              SELECT oc.id, oc.field_name, oc.old_value, oc.new_value,
                     oc.changed_at, oc.reason, oc.stage,
                     COALESCE(u.username, oc.changed_by_name, 'Unknown') AS changed_by
              FROM order_changes oc
              LEFT JOIN users u ON u.id = oc.user_id
              WHERE oc.order_id = $1
              ORDER BY oc.changed_at DESC
          `, [id]);
          res.json({ changes: result.rows });
      } catch (error) {
          console.error('Get change log error:', error);
          res.status(500).json({ error: 'Internal server error' });
      }
  });
  ```

- [ ] **Step 2: Verify with curl**

  ```bash
  # First get a token (replace with real credentials)
  TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"yourpassword"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

  curl -s http://localhost:3001/api/orders/1/change-log \
    -H "Authorization: Bearer $TOKEN" | head -c 500
  # Expected: {"changes": [...]} or {"changes": []}
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/routes/orders.cjs
  git commit -m "feat: add GET /orders/:id/change-log endpoint"
  ```

---

### Task 5: Update PUT `/orders/:id` to write to `order_changes`

**Files:**
- Modify: `server/routes/orders.cjs`

- [ ] **Step 1: Remove `change_log` logic from the PUT handler**

  In `server/routes/orders.cjs`, find the `router.put('/:id', ...)` handler (line ~282). Remove the entire `changeLogForDb` block (lines 288-297) and remove `change_log = $35,` from the UPDATE query and its corresponding parameter.

  The current block to remove:
  ```js
  let changeLogForDb;
  if (Object.prototype.hasOwnProperty.call(order, 'Change Log')) {
      changeLogForDb = serializeChangeLogFromArray(Array.isArray(order['Change Log']) ? order['Change Log'] : []);
  } else {
      const existingRow = await pool.query('SELECT change_log FROM die_orders WHERE id = $1', [id]);
      if (existingRow.rows.length === 0) {
          return res.status(404).json({ error: 'Order not found' });
      }
      const prev = existingRow.rows[0].change_log;
      changeLogForDb = (prev == null || prev === '') ? '[]' : String(prev);
  }
  ```

- [ ] **Step 2: Replace the UPDATE query (remove `change_log = $35` and renumber params)**

  The new UPDATE query (note: `change_log` is removed, params shift from `$35` being change_log and `$36,$37,$38` becoming `$35,$36,$37`):

  ```js
  const result = await pool.query(`
      UPDATE die_orders SET
          plant = $1, order_no = $2, die_no = $3, type = $4, die_size = $5,
          die_requested_date = $6, ordered_date = $7, shipment_type = $8,
          mandrels_per_cavity = $9, total_mandrels = $10, design_received_date = $11,
          three_d_model_received_date = $12, simulation_enabled = $13,
          design_approved_date = $14, delay = $15, pr_entry = $16, pr_number = $17,
          customer_name = $18, oracle_entry = $19, supplier = $20, status = $21,
          overall_delay = $22, eta = $23, month = $24,
          die_received_date = $25, submission_date = $26, sample_approval_date = $27,
          no_of_trial = $28, corrector = $29,
          press = $30, cavity = $31, ascona_reference = $32, sample_status = $33, remark = $34,
          urgency = $35, special_follow_up = $36,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $37
  `, [
      sanitizeString(order['Plant']),
      sanitizeString(order['Order No']),
      sanitizeString(order['DIE NO']),
      sanitizeString(order['TYPE']),
      sanitizeString(order['Die Size']),
      sanitizeString(order['Die Requested Date']) || null,
      sanitizeString(order['Ordered date']) || null,
      sanitizeString(order['Type of shipment']),
      Math.round(order['Mandrels per Cavity'] || 0),
      Math.round(order['Total Mandrels'] || 0),
      sanitizeString(order['Design Received Date']) || null,
      sanitizeString(order['3D Model Received Date']) || null,
      order['simulationEnabled'] ? 1 : 0,
      sanitizeString(order['Design Approved Date']) || null,
      Math.round(order['Delay'] || 0),
      sanitizeString(order['PR Entry']),
      sanitizeString(order['PR Number']),
      sanitizeString(order['Customer Name']),
      sanitizeString(order['Oracle Entry']),
      sanitizeString(order['Supplier']),
      sanitizeString(order['STATUS']),
      Math.round(order['OVERALL DELAY'] || 0),
      sanitizeString(order['ETA']),
      sanitizeString(order['month']),
      sanitizeString(order['Die Received Date']) || null,
      sanitizeString(order['Submission Date']) || null,
      sanitizeString(order['Sample Approval Date']) || null,
      Math.round(order['No of Trial'] || 0),
      sanitizeString(order['Corrector']),
      sanitizeString(order['Press']),
      Math.round(order['Cavity'] || 0),
      sanitizeString(order['Ascona Reference']),
      sanitizeString(order['Sample Status']),
      sanitizeString(order['Remark']),
      normalizeUrgencyInput(order['Urgency']),
      parseSpecialFollowUpInput(order.specialFollowUp),
      id
  ]);
  ```

- [ ] **Step 3: Insert new change entries into `order_changes`**

  Add this block AFTER the `if (result.rowCount === 0)` check and BEFORE `await autoUpdateBackupRequests(...)`:

  ```js
  // Insert any new change entries sent by the frontend
  const newEntries = Array.isArray(order['Change Log']) ? order['Change Log'] : [];
  for (const entry of newEntries) {
      if (!entry || !entry.field) continue;
      await pool.query(
          `INSERT INTO order_changes
            (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
              id,
              req.user?.id || null,
              req.user?.username || entry.changedBy || null,
              entry.date ? new Date(entry.date) : new Date(),
              String(entry.field),
              entry.oldValue != null ? String(entry.oldValue) : null,
              entry.newValue != null ? String(entry.newValue) : null,
              entry.reason || null,
              entry.stage || null,
          ]
      );
  }
  ```

- [ ] **Step 4: Do the same fix in the POST (create) handler**

  In `router.post('/')`, find the INSERT query (line ~215). Remove `change_log` from the column list and its value `serializeChangeLogFromArray(...)` from the values array. The column list changes from 38 params to 37 params.

  Remove this from the INSERT column list:
  ```
  change_log,
  ```
  Remove this from the values array:
  ```js
  serializeChangeLogFromArray(Array.isArray(order['Change Log']) ? order['Change Log'] : []),
  ```
  Renumber the `created_by` param from `$38` to `$37`.

- [ ] **Step 5: Remove the now-unused helper functions**

  Remove `parseChangeLog` and `serializeChangeLogFromArray` functions (lines 55-74) and `MAX_CHANGE_LOG_ENTRIES` constant (line 53) since they're no longer needed.

  Also remove the `'Change Log'` validation rule from `orderValidation` array (the `body('Change Log')...` entry).

- [ ] **Step 6: Restart backend and test**

  ```bash
  docker compose restart backend

  # Update an order via the app UI, then verify the change was recorded:
  # In DB: SELECT * FROM order_changes WHERE order_id = <id> ORDER BY changed_at DESC LIMIT 5;
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add server/routes/orders.cjs
  git commit -m "feat: write order changes to order_changes table"
  ```

---

### Task 6: Add pagination to `GET /orders`

**Files:**
- Modify: `server/routes/orders.cjs`

- [ ] **Step 1: Replace the GET / handler**

  Find `router.get('/', async (req, res) => {` (line ~157) and replace the handler body:

  ```js
  router.get('/', async (req, res) => {
      try {
          const page = Math.max(1, parseInt(req.query.page) || 1);
          const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
          const offset = (page - 1) * limit;

          const [result, countResult] = await Promise.all([
              pool.query('SELECT * FROM die_orders ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
              pool.query('SELECT COUNT(*)::int AS total FROM die_orders'),
          ]);

          const total = countResult.rows[0].total;

          const formattedOrders = result.rows.map(order => ({
              id: order.id,
              'Plant': order.plant,
              'Order No': order.order_no,
              'DIE NO': order.die_no,
              'TYPE': order.type,
              'Die Size': order.die_size,
              'Die Requested Date': order.die_requested_date,
              'Ordered date': order.ordered_date,
              'Type of shipment': order.shipment_type,
              'Mandrels per Cavity': order.mandrels_per_cavity,
              'Total Mandrels': order.total_mandrels,
              'Design Received Date': order.design_received_date,
              '3D Model Received Date': order.three_d_model_received_date,
              'simulationEnabled': !!order.simulation_enabled,
              'Design Approved Date': order.design_approved_date,
              'Delay': order.delay,
              'PR Entry': order.pr_entry,
              'PR Number': order.pr_number,
              'Customer Name': order.customer_name,
              'Oracle Entry': order.oracle_entry,
              'Supplier': order.supplier,
              'STATUS': order.status,
              'OVERALL DELAY': order.overall_delay,
              'ETA': order.eta,
              'month': order.month,
              'Die Received Date': order.die_received_date,
              'Submission Date': order.submission_date,
              'Sample Approval Date': order.sample_approval_date,
              'No of Trial': order.no_of_trial,
              'Corrector': order.corrector,
              'Press': order.press,
              'Cavity': order.cavity,
              'Ascona Reference': order.ascona_reference,
              'Sample Status': order.sample_status,
              'Remark': order.remark,
              'Urgency': order.urgency || 'NORMAL',
              'specialFollowUp': !!order.special_follow_up,
          }));

          res.json({
              orders: formattedOrders,
              pagination: { page, limit, total, pages: Math.ceil(total / limit) },
          });
      } catch (error) {
          console.error('Get orders error:', error);
          res.status(500).json({ error: 'Internal server error' });
      }
  });
  ```

- [ ] **Step 2: Verify with curl**

  ```bash
  curl -s "http://localhost:3001/api/orders?page=1&limit=5" \
    -H "Authorization: Bearer $TOKEN" | python -m json.tool | head -20
  # Expected: {"orders": [...5 items...], "pagination": {"page":1,"limit":5,"total":850,"pages":170}}

  # Verify no-param call still works (backward compat):
  curl -s "http://localhost:3001/api/orders" \
    -H "Authorization: Bearer $TOKEN" | python -m json.tool | grep -E '"page"|"limit"|"total"'
  # Expected: "page": 1, "limit": 50, "total": 850
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/routes/orders.cjs
  git commit -m "feat: add server-side pagination to GET /orders"
  ```

---

## Phase 3: API Client Update

### Task 7: Update `src/api.js`

**Files:**
- Modify: `src/api.js`

- [ ] **Step 1: Update `ordersAPI.getAll` to support pagination**

  Find the `ordersAPI` object in `src/api.js` (around line 148) and replace `getAll`:

  ```js
  export const ordersAPI = {
      getAll: async ({ page = 1, limit = 500 } = {}) => {
          return apiRequest(`/orders?page=${page}&limit=${limit}`);
      },

      getPage: async (page = 1, limit = 50) => {
          return apiRequest(`/orders?page=${page}&limit=${limit}`);
      },

      getChangeLog: async (orderId) => {
          return apiRequest(`/orders/${orderId}/change-log`);
      },

      create: async (order) => {
          return apiRequest('/orders', {
              method: 'POST',
              body: JSON.stringify(order),
          });
      },

      update: async (id, order) => {
          return apiRequest(`/orders/${id}`, {
              method: 'PUT',
              body: JSON.stringify(order),
          });
      },

      delete: async (id) => {
          return apiRequest(`/orders/${id}`, {
              method: 'DELETE',
          });
      },
  };
  ```

  Note: `getAll` defaults to `limit=500` so existing callers (dashboard, analytics, flow pages) still load all orders. `getPage` is for the paginated `OrdersPage`.

- [ ] **Step 2: Verify the app still loads**

  Start the dev server (`npm run dev`) and open the browser. The orders page should still display. Check the browser console for errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/api.js
  git commit -m "feat: add getPage and getChangeLog to ordersAPI"
  ```

---

## Phase 4: Frontend Refactoring

> **Note on reading DieOrderingSystem.jsx:** The file is 325KB. Use `offset` and `limit` with the Read tool to read specific sections. Key line numbers (approximate — verify with grep):
> - Utility functions (constants, helpers): lines 1–240
> - Inline order card component (order details panel): lines 400–1240
> - Main component state declarations: lines 1247–1430
> - Data fetching useEffects: lines 1430–1680
> - Business logic handlers: lines 1680–1990
> - Computed/memo values: lines 1990–2100
> - Main render/return: lines 2100–2600
> - `activeTab === 'dashboard'` block: lines 2626–2916
> - `activeTab === 'orders'` block: lines 2917–3058
> - `activeTab.startsWith('flow-')` block: lines 3059–3514
> - `activeTab === 'flow-sample-followup'` block: lines 3515–3997
> - `activeTab === 'backup-requests'` block: lines 3998–4009
> - `activeTab === 'email-inbox'` block: lines 4010–4016
> - `activeTab === 'email-settings'` block: lines 4017–4020
> - `activeTab === 'analytics'` block: lines 4021–4382
> - `activeTab === 'settings'` block: lines 4383–5024
> - `activeTab === 'users'` block: lines 5025–end

---

### Task 8: Extract `DashboardPage`

**Files:**
- Create: `src/pages/DashboardPage.jsx`
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Create `src/pages/DashboardPage.jsx`**

  Read the dashboard block from `DieOrderingSystem.jsx` (lines ~2626–2916). The component signature receives these props:

  ```jsx
  export default function DashboardPage({
    data,          // all orders array
    suppliers,     // suppliers array
    theme,         // theme object
    user,          // current user
    setActiveTab,  // for "View all" navigation links
    STATUS_CONFIG, // from parent (or import from utils)
  }) {
    // Paste the JSX from the activeTab === 'dashboard' block here
    // (everything inside the {activeTab === 'dashboard' && hasPageAccess('dashboard') && ( ... )} wrapper)
  }
  ```

  Move any `useMemo`/`useState` that are purely dashboard-specific (e.g., `showCompletedInChart`, `showCancelledInChart`) into this component as local state.

  Constants like `STATUS_CONFIG`, `CHART_COLORS`, `PLANT_COLORS`, `getPlantColor` that are only used in the dashboard can move into this file.

- [ ] **Step 2: Update `DieOrderingSystem.jsx` to use `DashboardPage`**

  Add import at the top:
  ```jsx
  import DashboardPage from './pages/DashboardPage';
  ```

  Replace the `{activeTab === 'dashboard' && ...}` block with:
  ```jsx
  {activeTab === 'dashboard' && hasPageAccess('dashboard') && (
    <DashboardPage
      data={data}
      suppliers={suppliers}
      theme={theme}
      user={user}
      setActiveTab={setActiveTab}
    />
  )}
  ```

  Remove the state variables `showCompletedInChart`, `showCancelledInChart` from `DieOrderingSystem.jsx` (they now live in `DashboardPage`).

- [ ] **Step 3: Verify**

  Open the browser, navigate to the dashboard tab, verify KPI cards and charts render correctly.

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/DashboardPage.jsx src/DieOrderingSystem.jsx
  git commit -m "refactor: extract DashboardPage component"
  ```

---

### Task 9: Extract `AnalyticsPage`

**Files:**
- Create: `src/pages/AnalyticsPage.jsx`
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Create `src/pages/AnalyticsPage.jsx`**

  Read the analytics block from `DieOrderingSystem.jsx` (lines ~4021–4382). Signature:

  ```jsx
  export default function AnalyticsPage({ data, suppliers, plantBudgets, theme }) {
    const [analyticsFilter, setAnalyticsFilter] = useState({ period: 'all', quarter: 'all' });
    const [trendYear, setTrendYear] = useState(new Date().getFullYear().toString());
    // ... paste analytics block JSX and computed values here
  }
  ```

  Move `analyticsFilter`, `trendYear`, and all analytics `useMemo` computations (supplier counts, type distribution, etc.) into this component.

- [ ] **Step 2: Update `DieOrderingSystem.jsx`**

  Add import:
  ```jsx
  import AnalyticsPage from './pages/AnalyticsPage';
  ```

  Replace the analytics block:
  ```jsx
  {activeTab === 'analytics' && hasPageAccess('analytics') && (
    <AnalyticsPage
      data={data}
      suppliers={suppliers}
      plantBudgets={plantBudgets}
      theme={theme}
    />
  )}
  ```

  Remove `analyticsFilter`, `trendYear`, and analytics-related memos from `DieOrderingSystem.jsx`.

- [ ] **Step 3: Verify analytics tab renders, charts display correctly**

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/AnalyticsPage.jsx src/DieOrderingSystem.jsx
  git commit -m "refactor: extract AnalyticsPage component"
  ```

---

### Task 10: Extract `FlowPage` (all 8 status-based flow tabs)

**Files:**
- Create: `src/pages/flow/FlowPage.jsx`
- Create: `src/pages/flow/` (directory)
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Create `src/pages/flow/FlowPage.jsx`**

  Read the flow block from `DieOrderingSystem.jsx` (lines ~3059–3514). This block is an IIFE that determines the `status` from `activeTab` and renders one table. The component signature:

  ```jsx
  export default function FlowPage({
    activeTab,       // to determine which status to filter
    data,            // all orders
    setData,         // to update orders in place
    suppliers,
    user,
    theme,
    setActiveTab,    // for navigation to other tabs
    handleRevision,  // revision callback
    handleSizeChange,// die size change callback
    setChangelogOrder, // open changelog modal
  }) {
    // Paste the IIFE contents here (the flowTabs array, filtering, JSX)
  }
  ```

  The `flowTabs` array mapping (keep inline in this file):
  ```js
  const flowTabs = [
    { id: 'flow-pending-order', status: 'PENDING FOR ORDERING' },
    { id: 'flow-awaiting-design', status: 'AWAITING FOR DESIGN' },
    { id: 'flow-simulation', status: 'UNDER SIMULATION' },
    { id: 'flow-design-approval', status: 'PENDING FOR DESIGN APPROVAL' },
    { id: 'flow-pending-pr', status: 'PENDING FOR PR' },
    { id: 'flow-oracle-entry', status: 'PENDING FOR ORACLE ENTRY' },
    { id: 'flow-design-ems', status: 'PENDING FOR DESIGN TO EMS' },
    { id: 'flow-completed', status: 'DONE' },
  ];
  ```

- [ ] **Step 2: Update `DieOrderingSystem.jsx`**

  Add import:
  ```jsx
  import FlowPage from './pages/flow/FlowPage';
  ```

  Replace the entire `{activeTab.startsWith('flow-') && ...}` block (lines 3059–3514) with:
  ```jsx
  {activeTab.startsWith('flow-') && !activeTab.includes('sample-followup') && hasPageAccess(activeTab) && (
    <FlowPage
      activeTab={activeTab}
      data={data}
      setData={setData}
      suppliers={suppliers}
      user={user}
      theme={theme}
      setActiveTab={setActiveTab}
      handleRevision={handleRevision}
      handleSizeChange={handleSizeChange}
      setChangelogOrder={setChangelogOrder}
    />
  )}
  ```

- [ ] **Step 3: Verify each flow tab renders and order status changes work**

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/flow/FlowPage.jsx src/DieOrderingSystem.jsx
  git commit -m "refactor: extract FlowPage component"
  ```

---

### Task 11: Extract `SampleFollowupFlowPage`

**Files:**
- Create: `src/pages/flow/SampleFollowupFlowPage.jsx`
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Create `src/pages/flow/SampleFollowupFlowPage.jsx`**

  Read the sample followup flow block (lines ~3515–3997). Signature:

  ```jsx
  export default function SampleFollowupFlowPage({
    data,            // orders (for linking die_no to orders)
    sampleFollowups,
    setSampleFollowups,
    suppliers,
    user,
    theme,
    setActiveTab,
  }) {
    // Paste the flow-sample-followup IIFE contents here
    // Move any local state (form state, filter state) as useState inside this component
  }
  ```

- [ ] **Step 2: Update `DieOrderingSystem.jsx`**

  Add import:
  ```jsx
  import SampleFollowupFlowPage from './pages/flow/SampleFollowupFlowPage';
  ```

  Replace the `{activeTab === 'flow-sample-followup' && ...}` block:
  ```jsx
  {activeTab === 'flow-sample-followup' && hasPageAccess('flow-sample-followup') && (
    <SampleFollowupFlowPage
      data={data}
      sampleFollowups={sampleFollowups}
      setSampleFollowups={setSampleFollowups}
      suppliers={suppliers}
      user={user}
      theme={theme}
      setActiveTab={setActiveTab}
    />
  )}
  ```

  Check if `sampleFollowups` / `setSampleFollowups` state already exists in `DieOrderingSystem.jsx`; if not, add it and fetch from `sampleFollowupsAPI.getAll()` in the data-fetch `useEffect`.

- [ ] **Step 3: Verify the sample followup flow tab works**

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/flow/SampleFollowupFlowPage.jsx src/DieOrderingSystem.jsx
  git commit -m "refactor: extract SampleFollowupFlowPage component"
  ```

---

### Task 12: Extract `SettingsPage` and `UsersPage`

**Files:**
- Create: `src/pages/SettingsPage.jsx`
- Create: `src/pages/UsersPage.jsx`
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Create `src/pages/SettingsPage.jsx`**

  Read the settings block (lines ~4383–5024). Signature:

  ```jsx
  export default function SettingsPage({
    suppliers, setSuppliers,
    plants, setPlants,
    presses,
    apiKeys, setApiKeys,
    plantBudgets, setPlantBudgets,
    user,
    theme,
  }) {
    // Local state for add-supplier form, add-plant form, budget edits, etc.
    // Paste settings block JSX here
  }
  ```

  Move these state variables from `DieOrderingSystem.jsx` into `SettingsPage`:
  - `showAddSupplier`, `newSupplierName`, `newSupplierShipment`, `newSupplierRegion`
  - `showAddPlant`, `newPlantName`
  - `budgetYear`, `budgetActivePlant`, `budgetEdits`, `budgetSaving`

- [ ] **Step 2: Create `src/pages/UsersPage.jsx`**

  Read the users block (lines ~5025–end). Signature:

  ```jsx
  export default function UsersPage({
    users, setUsers,
    user,    // current logged-in user
    theme,
    CONTROLLABLE_PAGES,
  }) {
    // Local state for add-user form, editing user
    // Paste users block JSX here
  }
  ```

  Move these state variables from `DieOrderingSystem.jsx` into `UsersPage`:
  - `showAddUser`, `newUser`, `editingUser`, `resettingUser`

- [ ] **Step 3: Update `DieOrderingSystem.jsx`**

  Add imports:
  ```jsx
  import SettingsPage from './pages/SettingsPage';
  import UsersPage from './pages/UsersPage';
  ```

  Replace the settings block:
  ```jsx
  {activeTab === 'settings' && user?.role === 'admin' && (
    <SettingsPage
      suppliers={suppliers} setSuppliers={setSuppliers}
      plants={plants} setPlants={setPlants}
      presses={presses}
      apiKeys={apiKeys} setApiKeys={setApiKeys}
      plantBudgets={plantBudgets} setPlantBudgets={setPlantBudgets}
      user={user}
      theme={theme}
    />
  )}
  ```

  Replace the users block:
  ```jsx
  {activeTab === 'users' && user?.role === 'admin' && (
    <UsersPage
      users={users} setUsers={setUsers}
      user={user}
      theme={theme}
      CONTROLLABLE_PAGES={CONTROLLABLE_PAGES}
    />
  )}
  ```

- [ ] **Step 4: Verify settings and users tabs work (add/delete supplier, create user)**

- [ ] **Step 5: Commit**

  ```bash
  git add src/pages/SettingsPage.jsx src/pages/UsersPage.jsx src/DieOrderingSystem.jsx
  git commit -m "refactor: extract SettingsPage and UsersPage components"
  ```

---

### Task 13: Extract `OrdersPage` with server-side pagination

**Files:**
- Create: `src/pages/OrdersPage.jsx`
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Create `src/pages/OrdersPage.jsx`**

  Read the orders block from `DieOrderingSystem.jsx` (lines ~2917–3058). Signature:

  ```jsx
  import { useState, useMemo, useEffect, useCallback } from 'react';
  import { ordersAPI } from '../api';
  // ... other imports (icons, DatePickerField, modals, etc.)

  export default function OrdersPage({
    suppliers,
    plants,
    presses,
    user,
    theme,
    onOrderCreated,    // callback: (newOrder) => void — add to parent data
    onOrderUpdated,    // callback: (updatedOrder) => void
    onOrderDeleted,    // callback: (id) => void
    setChangelogOrder, // open changelog modal
  }) {
    const [orders, setOrders] = useState([]);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ plant: 'all', status: 'all', supplier: 'all', type: 'all', month: 'all', year: 'all' });
    const [sortConfig, setSortConfig] = useState({ key: 'Die Requested Date', direction: 'desc' });
    const LIMIT = 50;

    const fetchPage = useCallback(async (p = 1) => {
      setLoading(true);
      try {
        const res = await ordersAPI.getPage(p, LIMIT);
        setOrders(res.orders);
        setPagination(res.pagination);
        setPage(p);
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { fetchPage(1); }, [fetchPage]);

    // Search and filter apply to the loaded page
    const filteredData = useMemo(() => {
      // ... same filter logic as existing code in DieOrderingSystem.jsx
      // (the useMemo around line 1940–1962)
    }, [orders, searchTerm, filters, sortConfig]);

    // ... rest of orders page JSX (table, modals, toolbar)
  }
  ```

  Key changes vs. the existing inline code:
  - `data` (orders) is fetched internally (page by page), not passed from parent
  - `currentPage` → `page` (server page)
  - `paginatedData` → just `filteredData` (all rows on the current server page)
  - Pagination controls use `fetchPage(page ± 1)` instead of local slice
  - Total pages come from `pagination.pages`

  After save/update/delete, call the parent callback AND re-fetch the current page:
  ```js
  await ordersAPI.update(id, order);
  onOrderUpdated(order);
  fetchPage(page); // refresh current page
  ```

- [ ] **Step 2: Update `DieOrderingSystem.jsx`**

  Add import:
  ```jsx
  import OrdersPage from './pages/OrdersPage';
  ```

  Replace the orders block:
  ```jsx
  {activeTab === 'orders' && hasPageAccess('orders') && (
    <OrdersPage
      suppliers={suppliers}
      plants={plants}
      presses={presses}
      user={user}
      theme={theme}
      onOrderCreated={(o) => setData(prev => [o, ...prev])}
      onOrderUpdated={(o) => setData(prev => prev.map(x => x.id === o.id ? o : x))}
      onOrderDeleted={(id) => setData(prev => prev.filter(x => x.id !== id))}
      setChangelogOrder={setChangelogOrder}
    />
  )}
  ```

  Remove these state variables from `DieOrderingSystem.jsx` (they now live in `OrdersPage`):
  - `searchTerm`, `filters`, `sortConfig`
  - `currentPage`, `itemsPerPage` (line 1297–1298, 1258)

  Remove the `filteredData`, `paginatedData`, `totalPages` memos (lines ~1940–1965).

- [ ] **Step 3: Verify orders page: loads data, pagination controls work, filtering works**

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/OrdersPage.jsx src/DieOrderingSystem.jsx
  git commit -m "refactor: extract OrdersPage with server-side pagination"
  ```

---

### Task 14: Update `ChangeLogModal` to use new API shape

**Files:**
- Modify: `src/components/modals/ChangeLogModal.jsx`

- [ ] **Step 1: Add API fetch on open**

  Replace `ChangeLogModal.jsx` with a version that fetches from the API:

  ```jsx
  import React, { useState, useEffect } from 'react';
  import { X, History } from 'lucide-react';
  import { ordersAPI } from '../../api';

  function ChangeLogModal({ order, onClose, theme }) {
      if (!order) return null;

      const [changes, setChanges] = useState([]);
      const [loading, setLoading] = useState(true);

      useEffect(() => {
          let cancelled = false;
          ordersAPI.getChangeLog(order.id).then(res => {
              if (!cancelled) setChanges(res.changes || []);
          }).catch(() => {}).finally(() => {
              if (!cancelled) setLoading(false);
          });
          return () => { cancelled = true; };
      }, [order.id]);

      // Map new shape to display fields:
      // entry.field_name   → field label
      // entry.old_value    → old value
      // entry.new_value    → new value
      // entry.changed_at   → date string
      // entry.changed_by   → username (already resolved by backend JOIN)
      // entry.reason       → reason
      // entry.stage        → stage

      return (
          // ... same JSX as before but replace:
          //   changeLog.length → changes.length
          //   [...changeLog].reverse().map((entry, idx) => ...)
          // with:
          //   changes.map((entry, idx) => ...)
          // and update field references:
          //   entry.date → new Date(entry.changed_at).toISOString().split('T')[0]
          //   entry.field → entry.field_name
          //   entry.oldValue → entry.old_value
          //   entry.newValue → entry.new_value
          //   entry.changedBy → entry.changed_by
          //   entry.reason → entry.reason  (same key)
          //   entry.stage → entry.stage    (same key)
      );
  }

  export default ChangeLogModal;
  ```

  Keep all existing inline styles and JSX structure — only the data access changes.

  Add a loading state display (simple spinner or "Loading...") while `loading === true`.

- [ ] **Step 2: Update how `ChangeLogModal` is invoked**

  In `DieOrderingSystem.jsx`, find where `ChangeLogModal` is rendered (search for `changelogOrder`). The existing call passes the full `order` object. This works because `ChangeLogModal` now only needs `order.id` (plus `order['DIE NO']` and `order['Order No']` for the header subtitle).

  No change needed in the caller — it already passes `order={changelogOrder}`.

- [ ] **Step 3: Verify change log modal opens, shows spinner, then shows entries**

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/modals/ChangeLogModal.jsx
  git commit -m "feat: ChangeLogModal fetches from API instead of reading order prop"
  ```

---

### Task 15: Update frontend change log creation (send new entries only)

**Files:**
- Modify: `src/DieOrderingSystem.jsx` (or `src/pages/OrdersPage.jsx` and `src/pages/flow/FlowPage.jsx` after extraction)

- [ ] **Step 1: Find `handleSizeChange` and update it**

  In `DieOrderingSystem.jsx` (line ~1734) or in `FlowPage.jsx` after extraction, find `handleSizeChange`. Change the `updatedOrder` to only pass the new entry (not accumulate old ones):

  ```js
  const updatedOrder = {
    ...order,
    'Die Size': newDieSize,
    'Change Log': [changeLogEntry],  // only the NEW entry, not [...existingLog, changeLogEntry]
  };
  ```

- [ ] **Step 2: Find `handleSave` in the inline order card and update it**

  In `DieOrderingSystem.jsx` (line ~927) or `OrdersPage.jsx` after extraction, find `handleSave`. Change:

  ```js
  // Before:
  orderToSave['Change Log'] = [...existingLog, pendingStatusLog];

  // After:
  orderToSave['Change Log'] = [pendingStatusLog]; // only the new entry
  ```

- [ ] **Step 3: Verify changes are still recorded**

  Change a die order status in the app. Open the change log modal. Verify the new entry appears.

- [ ] **Step 4: Commit**

  ```bash
  git add src/DieOrderingSystem.jsx
  git commit -m "fix: send only new change entries in order updates"
  ```

---

### Task 16: Final cleanup — verify and remove dead code

**Files:**
- Modify: `src/DieOrderingSystem.jsx`

- [ ] **Step 1: Search for any remaining `'Change Log'` reads in `DieOrderingSystem.jsx`**

  ```bash
  grep -n "Change Log\|changeLog\|change_log" src/DieOrderingSystem.jsx
  ```

  Remove any remaining references to reading `order['Change Log']` for display purposes (these are now fetched by the modal). Keep any references that write new entries to the API.

- [ ] **Step 2: Search for stale state variables**

  Check if `allChangeLogs` memo (line ~1967–1978) still exists. If it's used only for the now-extracted pages, remove it.

- [ ] **Step 3: Run a final check**

  Open all pages in the browser:
  - Dashboard: KPIs and charts load
  - Orders: pagination controls work, 50 rows per page
  - Analytics: charts render
  - Each flow tab: filtered orders display, status changes work
  - Sample followup flow: table loads
  - Settings (admin): supplier/plant management works
  - Users (admin): user list loads
  - Change log modal: opens, fetches and displays history

- [ ] **Step 4: Final commit**

  ```bash
  git add src/DieOrderingSystem.jsx
  git commit -m "refactor: clean up dead code from DieOrderingSystem.jsx"
  ```

---

## Self-Review Notes

- Task 1 migration guard uses `CREATE TABLE IF NOT EXISTS` check rather than `app_migrations` for the order_changes table, since checking the table's existence is more reliable than a migration ID for DDL.
- Tasks 5/6 preserve backward compatibility: callers without `?page=&limit=` get page 1, limit 50.
- Task 7 `ordersAPI.getAll` defaults to `limit=500` so dashboard, analytics, and flow pages continue loading all data (correct for their filter/chart use cases).
- Task 13 `OrdersPage` fetches its own data independently — parent (`DieOrderingSystem.jsx`) no longer needs to pass `data` to it, but still maintains `data` state for dashboard/analytics/flow pages.
- The `handleRevision` and `handleSizeChange` functions remain in `DieOrderingSystem.jsx` until `FlowPage` and `OrdersPage` are extracted (Tasks 10, 13), at which point they can move into their respective page components or be passed as props.
