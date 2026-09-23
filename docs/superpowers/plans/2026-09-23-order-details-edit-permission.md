# Order Details Edit Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only admins and users an admin switches on can edit the Order Details drawer, and every drawer edit is logged, with a reason required when an existing value is changed or cleared.

**Architecture:** A new `users.can_edit_order_details` column, read on every request by `authMiddleware`, gates a new `PATCH /api/orders/:id/details` route and the unused `PUT /api/orders/:id`. The route diffs the incoming fields against the locked row using `server/services/orderDetailEdits.cjs`, enforces the reason rule, and writes one `order_changes` row per changed field. The drawer builds a **Review changes** dialog from a client copy of the same rules (`src/utils/orderDetailEdits.js`), and a test keeps the two copies in step.

**Tech Stack:** Node/Express (CommonJS), PostgreSQL via `pg`, `node:test`, React 18 + Vite (ESM), plain inline styles.

**Spec:** `docs/superpowers/specs/2026-09-23-order-details-edit-permission-design.md`

## Global Constraints

- Branch: `feat/order-details-edit-permission` (already created from `main` at `0d771d1`; the spec commit `6eb6b4b` is on it). **Do not push.** GitHub push fails with a 403 credential mismatch.
- Tests use Node's built-in runner: `npm test` runs `node --test "server/**/*.test.cjs" "src/**/*.test.js"`. The baseline on this branch is **684 pass, 0 fail, 2 skipped**. The 2 skips are the Work Queue Postgres suites, which need an environment variable and are not touched here.
- Route tests never reach a database: they call `installFakeDb(query)` from `server/routes/testSupport.cjs` **before** requiring the route module.
- Admins can always edit. For everyone else the column defaults to `false`.
- The reason is optional text, trimmed, **at most 500 characters**.
- The generic `PATCH /api/orders/:id` stays unrestricted. The Process Flow, Sample Followup, die-receipt and PI-import paths use it.
- Frontend verification: run `npx eslint <changed files>` plus `npm run build`. **Do not** use `npm run lint` or `npm run build:check`, because the repo-wide lint already fails on 77 old problems.
- Server code uses 4-space indentation in `server/routes/*` and 2 spaces in `server/services/*`. Frontend code uses 2 spaces. Match the file you are in.
- End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The local Docker stack is a **test server**, not production. Never run an unscoped `DELETE`, and never present its data as the user's real data. To deploy a code change, use `docker compose build <svc> && docker compose up -d <svc>`. `restart` does not pick up source changes.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `server/services/orderDetailEdits.cjs` | Create | The authority: editable fields, value normalisation, change kinds, the reason rule, the permission check |
| `server/services/orderDetailEdits.test.cjs` | Create | Unit tests for the above |
| `src/utils/orderDetailEdits.js` | Create | Client copy of the rules, plus the drawer helpers `pickEditable`, `fieldLabel` and `fieldType` |
| `src/utils/orderDetailEdits.test.js` | Create | Checks that the client and server copies agree, and tests the client helpers |
| `server/db.cjs`, `init.sql` | Modify | Add the `users.can_edit_order_details` column |
| `server/routes/auth.cjs` (+ `auth.test.cjs`) | Modify | Read the column on every request; return `canEditOrderDetails` |
| `server/routes/users.cjs` (+ `users.test.cjs`) | Modify | Admins read and write the switch |
| `server/routes/orders.cjs` (+ `orders.test.cjs`) | Modify | `requireOrderEditor`, the new details route, and the guarded `PUT` |
| `server/routes/orders.details.test.cjs` | Create | Tests for the details route |
| `src/api.js` (+ `api.test.js`) | Modify | `ordersAPI.patchDetails`, `authAPI.refreshUser`, and the switch in `usersAPI` |
| `src/components/modals/AddUserModal.jsx`, `src/pages/UsersPage.jsx` | Modify | The Permissions switch and the **Edits orders** badge |
| `src/components/orders/OrderEditReviewDialog.jsx` | Create | The Review changes dialog, with the ETA cause picker inside it |
| `src/DieOrderingSystem.jsx` | Modify | Drawer save flow, view-only label, refreshing the user on load |
| `src/components/modals/ChangeLogModal.jsx` | Modify | Show `N/A` when a value was cleared |
| `src/components/delivery/EtaCauseDialog.jsx` | Delete | Only the drawer used it; its picker now lives in the review dialog |

---

### Task 1: Server edit rules

**Files:**
- Create: `server/services/orderDetailEdits.cjs`
- Test: `server/services/orderDetailEdits.test.cjs`

**Interfaces:**
- Consumes: `normalizeEta(value) -> 'YYYY-MM-DD' | null` from `server/services/deliveryFollowup.cjs`.
- Produces (every later server task uses these exact names):
  - `EDITABLE_FIELDS`: a frozen map from drawer field to `{ col, type, max?, oneOf?, storedAsInt? }`
  - `STATUSES`: a frozen array of 11 status strings
  - `REASON_MAX`: `500`
  - `class OrderEditError extends Error { status: 400, code: string, fields?: string[] }`
  - `planChanges(before, fields) -> Array<{ field, kind: 'filled'|'changed'|'cleared', before, after }>`. Throws `OrderEditError`.
  - `changeNeedsReason(change) -> boolean` and `needsReason(changes) -> boolean`
  - `displayValue(field, value) -> string | null`
  - `validateReason(reason) -> string | null`. Throws `OrderEditError` above 500 characters.
  - `canEditOrderDetails(user) -> boolean`
  - `fromRow(dieOrdersRow) -> object keyed by drawer field`
  - `columnValue(field, value) -> value to write`

- [ ] **Step 1: Write the failing test**

Create `server/services/orderDetailEdits.test.cjs`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EDITABLE_FIELDS, OrderEditError, planChanges, needsReason, changeNeedsReason,
  displayValue, validateReason, canEditOrderDetails, fromRow, columnValue,
} = require('./orderDetailEdits.cjs');

const kinds = (before, fields) => planChanges(before, fields).map((c) => [c.field, c.kind]);

test('blank, null and whitespace are all empty, so re-saving them changes nothing', () => {
  assert.deepEqual(planChanges({ Supplier: null, 'PR Number': '' }, { Supplier: '  ', 'PR Number': null }), []);
});

test('dates compare as days, whatever format they are written in', () => {
  assert.deepEqual(planChanges({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '15/09/2026' }), []);
  assert.deepEqual(planChanges({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '2026-09-15T00:00:00.000Z' }), []);
  assert.deepEqual(kinds({ 'Ordered date': null }, { 'Ordered date': '2026-09-16' }), [['Ordered date', 'filled']]);
  assert.deepEqual(kinds({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '2026-09-16' }), [['Ordered date', 'changed']]);
  assert.deepEqual(kinds({ 'Ordered date': '2026-09-15' }, { 'Ordered date': '' }), [['Ordered date', 'cleared']]);
});

test('a date that is not a date is refused rather than saved as a clear', () => {
  assert.throws(() => planChanges({ 'Ordered date': null }, { 'Ordered date': 'next week' }), /Ordered date is not a valid date/);
});

test('date-like text keeps values such as TBC and compares real dates as days', () => {
  assert.deepEqual(planChanges({ ETA: 'TBC' }, { ETA: 'TBC' }), []);
  assert.deepEqual(planChanges({ ETA: '01/10/2026' }, { ETA: '2026-10-01' }), []);
  assert.deepEqual(kinds({ ETA: 'TBC' }, { ETA: '2026-10-01' }), [['ETA', 'changed']]);
  assert.equal(planChanges({ 'PR Entry': null }, { 'PR Entry': '2026-09-01' })[0].after, '2026-09-01');
});

test('whole numbers treat 0 as not set yet', () => {
  assert.deepEqual(kinds({ Cavity: 0 }, { Cavity: '3' }), [['Cavity', 'filled']]);
  assert.deepEqual(kinds({ Cavity: null }, { Cavity: 3 }), [['Cavity', 'filled']]);
  assert.deepEqual(kinds({ Cavity: 2 }, { Cavity: '3' }), [['Cavity', 'changed']]);
  assert.deepEqual(kinds({ Cavity: 3 }, { Cavity: 0 }), [['Cavity', 'cleared']]);
  assert.deepEqual(planChanges({ Cavity: 3 }, { Cavity: '3' }), []);
});

test('whole numbers outside their range are refused', () => {
  assert.throws(() => planChanges({ Cavity: 2 }, { Cavity: -1 }), /Cavity must be a whole number from 0 to 10000/);
  assert.throws(() => planChanges({ Cavity: 2 }, { Cavity: 'two' }), OrderEditError);
  assert.throws(() => planChanges({ 'No of Trial': 0 }, { 'No of Trial': 1001 }), /No of Trial must be a whole number from 0 to 1000/);
});

test('yes/no fields treat off as not set yet', () => {
  assert.deepEqual(kinds({ simulationEnabled: 0 }, { simulationEnabled: true }), [['simulationEnabled', 'filled']]);
  assert.deepEqual(kinds({ specialFollowUp: true }, { specialFollowUp: false }), [['specialFollowUp', 'cleared']]);
  assert.deepEqual(planChanges({ simulationEnabled: 1 }, { simulationEnabled: true }), []);
});

test('every order has an urgency, so any urgency change is a change', () => {
  assert.deepEqual(kinds({ Urgency: 'NORMAL' }, { Urgency: 'URGENT' }), [['Urgency', 'changed']]);
  assert.deepEqual(planChanges({ Urgency: 'TOP_URGENT' }, { Urgency: 'top urgent' }), []);
  assert.deepEqual(planChanges({ Urgency: null }, { Urgency: 'NORMAL' }), []);
});

test('fields the drawer does not show, and values outside a list, are refused', () => {
  assert.throws(() => planChanges({}, { Remark: 'x' }), /Remark cannot be changed from Order Details/);
  assert.throws(() => planChanges({}, { toString: 'x' }), /toString cannot be changed from Order Details/);
  assert.throws(() => planChanges({ STATUS: 'DONE' }, { STATUS: 'SHIPPED' }), /STATUS cannot be SHIPPED/);
  assert.throws(() => planChanges({ TYPE: 'B' }, { TYPE: 'X' }), /TYPE cannot be X/);
  assert.deepEqual(kinds({ STATUS: 'DONE' }, { STATUS: 'DIE RECEIVED' }), [['STATUS', 'changed']]);
});

test('an odd stored value that is sent back untouched never blocks a save', () => {
  assert.deepEqual(kinds({ TYPE: 'b', Supplier: 'A' }, { TYPE: 'b', Supplier: 'B' }), [['Supplier', 'changed']]);
});

test('filling empty fields needs no reason; changing or clearing one does', () => {
  assert.equal(needsReason(planChanges({ Supplier: null }, { Supplier: 'BETA' })), false);
  assert.equal(needsReason(planChanges({ Supplier: 'ALPHA', Cavity: 0 }, { Supplier: 'BETA', Cavity: 2 })), true);
  assert.equal(needsReason(planChanges({ 'PR Number': 'PR-1' }, { 'PR Number': '' })), true);
});

test('an ordinary status step needs no reason; CANCELLED and HOLD always do', () => {
  assert.equal(needsReason(planChanges({ STATUS: 'AWAITING FOR DESIGN' }, { STATUS: 'PENDING FOR DESIGN APPROVAL' })), false);
  assert.equal(changeNeedsReason(planChanges({ STATUS: 'DONE' }, { STATUS: 'CANCELLED' })[0]), true);
  assert.equal(changeNeedsReason(planChanges({ STATUS: 'HOLD' }, { STATUS: 'PENDING FOR PR' })[0]), true);
});

test('log values read the way the drawer shows them', () => {
  assert.equal(displayValue('simulationEnabled', true), 'Yes');
  assert.equal(displayValue('specialFollowUp', false), 'No');
  assert.equal(displayValue('Cavity', 0), '0');
  assert.equal(displayValue('Supplier', null), null);
  assert.equal(displayValue('Ordered date', '2026-09-16'), '2026-09-16');
});

test('a reason is trimmed, optional, and at most 500 characters', () => {
  assert.equal(validateReason('  Supplier revised the quotation  '), 'Supplier revised the quotation');
  assert.equal(validateReason(''), null);
  assert.equal(validateReason(undefined), null);
  assert.equal(validateReason('x'.repeat(500)).length, 500);
  assert.throws(() => validateReason('x'.repeat(501)), /500 characters or fewer/);
});

test('admins can always edit; anyone else needs the switch', () => {
  assert.equal(canEditOrderDetails({ role: 'admin' }), true);
  assert.equal(canEditOrderDetails({ role: 'user', canEditOrderDetails: true }), true);
  assert.equal(canEditOrderDetails({ role: 'user', canEditOrderDetails: false }), false);
  assert.equal(canEditOrderDetails({ role: 'die_designer' }), false);
  assert.equal(canEditOrderDetails(null), false);
});

test('rows map onto drawer fields, and the yes/no integer column is written as 0 or 1', () => {
  const before = fromRow({ supplier: 'ALPHA', ordered_date: '2026-09-15', simulation_enabled: 1, eta: 'TBC' });
  assert.equal(before.Supplier, 'ALPHA');
  assert.equal(before['Ordered date'], '2026-09-15');
  assert.equal(before.simulationEnabled, 1);
  assert.equal(before.ETA, 'TBC');
  assert.equal(Object.keys(before).length, Object.keys(EDITABLE_FIELDS).length);
  assert.equal(columnValue('simulationEnabled', true), 1);
  assert.equal(columnValue('simulationEnabled', false), 0);
  assert.equal(columnValue('specialFollowUp', true), true);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test server/services/orderDetailEdits.test.cjs`
Expected: FAIL with `Cannot find module './orderDetailEdits.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `server/services/orderDetailEdits.cjs`:

```js
'use strict';
/**
 * Order Details drawer edits: which fields the drawer may change, what counts
 * as a change, and when a change needs a reason. PATCH /api/orders/:id/details
 * is the authority. src/utils/orderDetailEdits.js holds the client copy that
 * builds the Review changes dialog; its test fails if the two drift.
 */
const { normalizeEta } = require('./deliveryFollowup.cjs');

class OrderEditError extends Error {
  constructor(message, code = 'INVALID', fields) {
    super(message);
    this.status = 400;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

// Every status the drawer offers (STATUS_CONFIG in src/utils/constants.js).
// DIE RECEIVED is a real stored status, although the order routes'
// VALID_STATUSES list leaves it out.
const STATUSES = Object.freeze([
  'AWAITING FOR DESIGN', 'PENDING FOR DESIGN APPROVAL', 'UNDER SIMULATION',
  'PENDING FOR DESIGN TO EMS', 'PENDING FOR PR', 'PENDING FOR ORACLE ENTRY',
  'PENDING FOR ORDERING', 'DONE', 'DIE RECEIVED', 'CANCELLED', 'HOLD',
]);

// Moving into or out of these always needs a reason, as the drawer asked before.
const REASON_STATUSES = Object.freeze(['CANCELLED', 'HOLD']);
const REASON_MAX = 500;

// Drawer field -> column, how its values compare, and its limits.
//   text      trimmed text; blank is empty
//   int       whole number; 0 is empty (these columns default to 0 for "not set")
//   bool      yes/no; false is empty
//   urgency   NORMAL | URGENT | TOP_URGENT; never empty
//   date      a date column, compared as YYYY-MM-DD
//   datetext  a TEXT column that usually holds a date but may hold e.g. "TBC"
const EDITABLE_FIELDS = Object.freeze({
  'Plant':                  { col: 'plant', type: 'text' },
  'TYPE':                   { col: 'type', type: 'text', oneOf: ['N', 'B', 'T', 'C', 'H'] },
  'Die Size':               { col: 'die_size', type: 'text' },
  'Cavity':                 { col: 'cavity', type: 'int', max: 10000 },
  'Mandrels per Cavity':    { col: 'mandrels_per_cavity', type: 'int', max: 10000 },
  'Total Mandrels':         { col: 'total_mandrels', type: 'int', max: 100000 },
  'Type of shipment':       { col: 'shipment_type', type: 'text', oneOf: ['AIR', 'LAND'] },
  'Supplier':               { col: 'supplier', type: 'text' },
  'Customer Name':          { col: 'customer_name', type: 'text' },
  'PR Number':              { col: 'pr_number', type: 'text' },
  'Press':                  { col: 'press', type: 'text' },
  'simulationEnabled':      { col: 'simulation_enabled', type: 'bool', storedAsInt: true },
  'Urgency':                { col: 'urgency', type: 'urgency' },
  'specialFollowUp':        { col: 'special_follow_up', type: 'bool' },
  'STATUS':                 { col: 'status', type: 'text', oneOf: STATUSES },
  'Die Requested Date':     { col: 'die_requested_date', type: 'date' },
  'Design Received Date':   { col: 'design_received_date', type: 'date' },
  '3D Model Received Date': { col: 'three_d_model_received_date', type: 'date' },
  'Design Approved Date':   { col: 'design_approved_date', type: 'date' },
  'PR Entry':               { col: 'pr_entry', type: 'datetext' },
  'Oracle Entry':           { col: 'oracle_entry', type: 'datetext' },
  'Ordered date':           { col: 'ordered_date', type: 'date' },
  'ETA':                    { col: 'eta', type: 'datetext' },
  'Die Received Date':      { col: 'die_received_date', type: 'date' },
  'Submission Date':        { col: 'submission_date', type: 'date' },
  'Sample Approval Date':   { col: 'sample_approval_date', type: 'date' },
  'No of Trial':            { col: 'no_of_trial', type: 'int', max: 1000 },
  'Corrector':              { col: 'corrector', type: 'text' },
});

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const textOf = (value) => (value === null || value === undefined ? '' : String(value).trim());

// Same mapping as normalizeUrgencyInput in routes/orders.cjs.
function normalizeUrgency(value) {
  const s = textOf(value).toUpperCase().replace(/\s+/g, '_');
  if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
  if (s === 'URGENT') return 'URGENT';
  return 'NORMAL';
}

// One comparable form per type. Stored and incoming values both pass through
// here, so '', null and '  ' match, and 15/09/2026 matches 2026-09-15.
function canonical(type, value) {
  const text = textOf(value);
  switch (type) {
    case 'int': {
      if (text === '') return 0;
      const n = Math.round(Number(text));
      return n === 0 ? 0 : n; // folds -0 into 0
    }
    case 'bool':
      return value === true || value === 1 || ['true', '1', 'yes', 'y'].includes(text.toLowerCase());
    case 'urgency':
      return normalizeUrgency(value);
    case 'date':
      return text === '' ? null : normalizeEta(text);
    case 'datetext':
      return text === '' ? null : (normalizeEta(text) || text.slice(0, 500));
    default:
      return text === '' ? null : text.slice(0, 500);
  }
}

// A column's "not set yet" value.
function isEmpty(type, value) {
  if (type === 'int') return value === 0;
  if (type === 'bool') return value === false;
  if (type === 'urgency') return false;
  return value === null;
}

// Refuses a new value the column cannot take.
function checkValue(field, value, raw) {
  const spec = EDITABLE_FIELDS[field];
  if (spec.type === 'int' && !(Number.isInteger(value) && value >= 0 && value <= spec.max)) {
    throw new OrderEditError(`${field} must be a whole number from 0 to ${spec.max}`);
  }
  if (spec.type === 'date' && value === null && textOf(raw) !== '') {
    throw new OrderEditError(`${field} is not a valid date`);
  }
  if (spec.oneOf && value !== null && !spec.oneOf.includes(value)) {
    throw new OrderEditError(`${field} cannot be ${value}`);
  }
}

// The edits that really change something, one entry per field. `before` and
// `fields` are both keyed by drawer field ('Ordered date', not ordered_date).
function planChanges(before, fields) {
  const changes = [];
  for (const [field, raw] of Object.entries(fields || {})) {
    if (!hasOwn(EDITABLE_FIELDS, field)) {
      throw new OrderEditError(`${field} cannot be changed from Order Details`);
    }
    const { type } = EDITABLE_FIELDS[field];
    const stored = before ? before[field] : undefined;
    // Sent back untouched: whatever the column holds is already stored, so an
    // odd legacy value never blocks saving the fields that did change.
    if (textOf(raw) === textOf(stored)) continue;
    const was = canonical(type, stored);
    const after = canonical(type, raw);
    checkValue(field, after, raw);
    if (Object.is(was, after)) continue;
    let kind = 'changed';
    if (isEmpty(type, was)) kind = 'filled';
    else if (isEmpty(type, after)) kind = 'cleared';
    changes.push({ field, kind, before: was, after });
  }
  return changes;
}

// Filling an empty field needs no reason. Status is derived from the dates as
// they are filled in, so an ordinary status step needs none either; only a
// move into or out of CANCELLED or HOLD does.
function changeNeedsReason({ field, kind, before, after }) {
  if (field === 'STATUS') return REASON_STATUSES.includes(before) || REASON_STATUSES.includes(after);
  return kind !== 'filled';
}

const needsReason = (changes) => changes.some(changeNeedsReason);

// How a value is written to the change log.
function displayValue(field, value) {
  const { type } = EDITABLE_FIELDS[field];
  if (type === 'bool') return value ? 'Yes' : 'No';
  if (type === 'int') return String(value);
  return value === null || value === undefined ? null : String(value);
}

function validateReason(reason) {
  const text = textOf(reason);
  if (text.length > REASON_MAX) {
    throw new OrderEditError(`Keep the reason to ${REASON_MAX} characters or fewer`);
  }
  return text || null;
}

function canEditOrderDetails(user) {
  return !!user && (user.role === 'admin' || user.canEditOrderDetails === true);
}

// A die_orders row keyed by drawer field, for planChanges.
function fromRow(row) {
  return Object.fromEntries(Object.entries(EDITABLE_FIELDS).map(([field, { col }]) => [field, row[col]]));
}

// What to write: simulation_enabled is an INTEGER column, not a boolean.
function columnValue(field, value) {
  return EDITABLE_FIELDS[field].storedAsInt ? (value ? 1 : 0) : value;
}

module.exports = {
  EDITABLE_FIELDS, STATUSES, REASON_MAX, OrderEditError,
  canonical, planChanges, changeNeedsReason, needsReason, displayValue,
  validateReason, canEditOrderDetails, fromRow, columnValue,
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test server/services/orderDetailEdits.test.cjs`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/orderDetailEdits.cjs server/services/orderDetailEdits.test.cjs
git commit -m "feat(orders): rules for what an Order Details edit changes and when it needs a reason

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client copy of the rules

**Files:**
- Create: `src/utils/orderDetailEdits.js`
- Test: `src/utils/orderDetailEdits.test.js`

**Interfaces:**
- Consumes: `normalizeEta` from `src/utils/deliveryFollowup.js`. The test also loads the Task 1 server module through `createRequire`.
- Produces (Tasks 8 and 9 use these):
  - `EDITABLE_FIELDS` (the same keys, `type`, `max` and `oneOf` as the server; no `col`), `STATUSES`, `REASON_MAX`, `OrderEditError`
  - `planChanges`, `changeNeedsReason`, `needsReason`, `displayValue` and `canEditOrderDetails`, with the same signatures as Task 1
  - `pickEditable(order) -> object` containing only the editable fields that are present on `order`
  - `fieldLabel(field) -> string` and `fieldType(field) -> string | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/utils/orderDetailEdits.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  EDITABLE_FIELDS, STATUSES, planChanges, needsReason, changeNeedsReason, displayValue,
  canEditOrderDetails, pickEditable, fieldLabel, fieldType,
} from './orderDetailEdits.js';

const server = createRequire(import.meta.url)('../../server/services/orderDetailEdits.cjs');

const shape = (fields) => Object.fromEntries(Object.entries(fields)
  .map(([field, { type, max, oneOf }]) => [field, { type, max, oneOf: oneOf && [...oneOf] }]));

// Pairs of (stored order, drawer edits). Both copies must plan them the same.
const CASES = [
  [{ Supplier: null }, { Supplier: 'BETA' }],
  [{ Supplier: 'ALPHA' }, { Supplier: '  ' }],
  [{ 'Ordered date': '2026-09-15' }, { 'Ordered date': '15/09/2026' }],
  [{ 'Ordered date': '2026-09-15' }, { 'Ordered date': '2026-09-20' }],
  [{ ETA: 'TBC' }, { ETA: '2026-10-01' }],
  [{ ETA: '01/10/2026' }, { ETA: '2026-10-01' }],
  [{ Cavity: 0 }, { Cavity: '3' }],
  [{ Cavity: 3 }, { Cavity: 0 }],
  [{ simulationEnabled: 0 }, { simulationEnabled: true }],
  [{ specialFollowUp: true }, { specialFollowUp: false }],
  [{ Urgency: 'NORMAL' }, { Urgency: 'TOP URGENT' }],
  [{ STATUS: 'AWAITING FOR DESIGN' }, { STATUS: 'PENDING FOR DESIGN APPROVAL' }],
  [{ STATUS: 'DONE' }, { STATUS: 'HOLD' }],
  [{ TYPE: 'b', Supplier: 'A' }, { TYPE: 'b', Supplier: 'B' }],
];

// Two copies of the rules, one ESM for Vite and one CommonJS for the server.
// These checks are what stop them drifting.
test('the client and server copies agree on fields, plans and reasons', () => {
  assert.deepEqual(shape(EDITABLE_FIELDS), shape(server.EDITABLE_FIELDS));
  assert.deepEqual([...STATUSES], [...server.STATUSES]);
  for (const [before, fields] of CASES) {
    const ours = planChanges(before, fields);
    assert.deepEqual(ours, server.planChanges(before, fields), JSON.stringify(fields));
    assert.equal(needsReason(ours), server.needsReason(ours), JSON.stringify(fields));
    for (const change of ours) {
      assert.equal(changeNeedsReason(change), server.changeNeedsReason(change));
      assert.equal(displayValue(change.field, change.after), server.displayValue(change.field, change.after));
    }
  }
  for (const user of [{ role: 'admin' }, { role: 'user', canEditOrderDetails: true }, { role: 'user' }, null]) {
    assert.equal(canEditOrderDetails(user), server.canEditOrderDetails(user));
  }
});

test('both copies refuse the same bad input', () => {
  const bad = [
    [{}, { Remark: 'x' }],
    [{ Cavity: 2 }, { Cavity: -1 }],
    [{ 'Ordered date': null }, { 'Ordered date': 'soon' }],
    [{ STATUS: 'DONE' }, { STATUS: 'SHIPPED' }],
  ];
  for (const [before, fields] of bad) {
    assert.throws(() => planChanges(before, fields), Error, JSON.stringify(fields));
    assert.throws(() => server.planChanges(before, fields), Error, JSON.stringify(fields));
  }
});

test('the drawer sends only the fields it may edit', () => {
  const edited = { id: 7, 'DIE NO': '30533_201', 'Order No': 'A-1', Supplier: 'BETA', changeCount: 2, Delay: 4 };
  assert.deepEqual(pickEditable(edited), { Supplier: 'BETA' });
});

test('fields read the way the drawer labels them', () => {
  assert.equal(fieldLabel('simulationEnabled'), 'Simulation');
  assert.equal(fieldLabel('specialFollowUp'), 'Special follow-up');
  assert.equal(fieldLabel('STATUS'), 'Status');
  assert.equal(fieldLabel('Supplier'), 'Supplier');
  assert.equal(fieldType('ETA'), 'datetext');
  assert.equal(fieldType('Remark'), undefined);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test src/utils/orderDetailEdits.test.js`
Expected: FAIL with `Cannot find module` for `./orderDetailEdits.js`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/orderDetailEdits.js`:

```js
import { normalizeEta } from './deliveryFollowup.js';

/**
 * Order Details drawer edits, client copy. server/services/orderDetailEdits.cjs
 * is the authority; this copy only builds the Review changes dialog, and
 * orderDetailEdits.test.js fails if the two ever disagree.
 */

export class OrderEditError extends Error {
  constructor(message, code = 'INVALID', fields) {
    super(message);
    this.status = 400;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

// Every status the drawer offers (STATUS_CONFIG in ./constants.js).
export const STATUSES = Object.freeze([
  'AWAITING FOR DESIGN', 'PENDING FOR DESIGN APPROVAL', 'UNDER SIMULATION',
  'PENDING FOR DESIGN TO EMS', 'PENDING FOR PR', 'PENDING FOR ORACLE ENTRY',
  'PENDING FOR ORDERING', 'DONE', 'DIE RECEIVED', 'CANCELLED', 'HOLD',
]);

const REASON_STATUSES = Object.freeze(['CANCELLED', 'HOLD']);
export const REASON_MAX = 500;

// Drawer field -> how its values compare. Types are described in the server copy.
export const EDITABLE_FIELDS = Object.freeze({
  'Plant':                  { type: 'text' },
  'TYPE':                   { type: 'text', oneOf: ['N', 'B', 'T', 'C', 'H'] },
  'Die Size':               { type: 'text' },
  'Cavity':                 { type: 'int', max: 10000 },
  'Mandrels per Cavity':    { type: 'int', max: 10000 },
  'Total Mandrels':         { type: 'int', max: 100000 },
  'Type of shipment':       { type: 'text', oneOf: ['AIR', 'LAND'] },
  'Supplier':               { type: 'text' },
  'Customer Name':          { type: 'text' },
  'PR Number':              { type: 'text' },
  'Press':                  { type: 'text' },
  'simulationEnabled':      { type: 'bool' },
  'Urgency':                { type: 'urgency' },
  'specialFollowUp':        { type: 'bool' },
  'STATUS':                 { type: 'text', oneOf: STATUSES },
  'Die Requested Date':     { type: 'date' },
  'Design Received Date':   { type: 'date' },
  '3D Model Received Date': { type: 'date' },
  'Design Approved Date':   { type: 'date' },
  'PR Entry':               { type: 'datetext' },
  'Oracle Entry':           { type: 'datetext' },
  'Ordered date':           { type: 'date' },
  'ETA':                    { type: 'datetext' },
  'Die Received Date':      { type: 'date' },
  'Submission Date':        { type: 'date' },
  'Sample Approval Date':   { type: 'date' },
  'No of Trial':            { type: 'int', max: 1000 },
  'Corrector':              { type: 'text' },
});

// The drawer's own labels where they differ from the field name.
const FIELD_LABELS = {
  'TYPE': 'Type',
  'STATUS': 'Status',
  'simulationEnabled': 'Simulation',
  'specialFollowUp': 'Special follow-up',
  'Type of shipment': 'Shipment',
  'Mandrels per Cavity': 'Mandrels/Cav',
  'Ordered date': 'Ordered',
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const textOf = (value) => (value === null || value === undefined ? '' : String(value).trim());

function normalizeUrgency(value) {
  const s = textOf(value).toUpperCase().replace(/\s+/g, '_');
  if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
  if (s === 'URGENT') return 'URGENT';
  return 'NORMAL';
}

function canonical(type, value) {
  const text = textOf(value);
  switch (type) {
    case 'int': {
      if (text === '') return 0;
      const n = Math.round(Number(text));
      return n === 0 ? 0 : n;
    }
    case 'bool':
      return value === true || value === 1 || ['true', '1', 'yes', 'y'].includes(text.toLowerCase());
    case 'urgency':
      return normalizeUrgency(value);
    case 'date':
      return text === '' ? null : normalizeEta(text);
    case 'datetext':
      return text === '' ? null : (normalizeEta(text) || text.slice(0, 500));
    default:
      return text === '' ? null : text.slice(0, 500);
  }
}

function isEmpty(type, value) {
  if (type === 'int') return value === 0;
  if (type === 'bool') return value === false;
  if (type === 'urgency') return false;
  return value === null;
}

function checkValue(field, value, raw) {
  const spec = EDITABLE_FIELDS[field];
  if (spec.type === 'int' && !(Number.isInteger(value) && value >= 0 && value <= spec.max)) {
    throw new OrderEditError(`${field} must be a whole number from 0 to ${spec.max}`);
  }
  if (spec.type === 'date' && value === null && textOf(raw) !== '') {
    throw new OrderEditError(`${field} is not a valid date`);
  }
  if (spec.oneOf && value !== null && !spec.oneOf.includes(value)) {
    throw new OrderEditError(`${field} cannot be ${value}`);
  }
}

export function planChanges(before, fields) {
  const changes = [];
  for (const [field, raw] of Object.entries(fields || {})) {
    if (!hasOwn(EDITABLE_FIELDS, field)) {
      throw new OrderEditError(`${field} cannot be changed from Order Details`);
    }
    const { type } = EDITABLE_FIELDS[field];
    const stored = before ? before[field] : undefined;
    if (textOf(raw) === textOf(stored)) continue;
    const was = canonical(type, stored);
    const after = canonical(type, raw);
    checkValue(field, after, raw);
    if (Object.is(was, after)) continue;
    let kind = 'changed';
    if (isEmpty(type, was)) kind = 'filled';
    else if (isEmpty(type, after)) kind = 'cleared';
    changes.push({ field, kind, before: was, after });
  }
  return changes;
}

export function changeNeedsReason({ field, kind, before, after }) {
  if (field === 'STATUS') return REASON_STATUSES.includes(before) || REASON_STATUSES.includes(after);
  return kind !== 'filled';
}

export const needsReason = (changes) => changes.some(changeNeedsReason);

export function displayValue(field, value) {
  const { type } = EDITABLE_FIELDS[field];
  if (type === 'bool') return value ? 'Yes' : 'No';
  if (type === 'int') return String(value);
  return value === null || value === undefined ? null : String(value);
}

export function canEditOrderDetails(user) {
  return !!user && (user.role === 'admin' || user.canEditOrderDetails === true);
}

// The drawer's edited order carries every column; only these may be sent.
export function pickEditable(order) {
  return Object.fromEntries(Object.keys(EDITABLE_FIELDS)
    .filter((field) => hasOwn(order || {}, field))
    .map((field) => [field, order[field]]));
}

export const fieldLabel = (field) => FIELD_LABELS[field] || field;
export const fieldType = (field) => (hasOwn(EDITABLE_FIELDS, field) ? EDITABLE_FIELDS[field].type : undefined);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test src/utils/orderDetailEdits.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint and commit**

Run: `npx eslint src/utils/orderDetailEdits.js src/utils/orderDetailEdits.test.js`
Expected: no output.

```bash
git add src/utils/orderDetailEdits.js src/utils/orderDetailEdits.test.js
git commit -m "feat(orders): client copy of the Order Details edit rules, kept in step by a test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The permission column and the auth responses

**Files:**
- Modify: `server/db.cjs` (the first `DO $$` block of `users` migrations, which ends with the `page_access` check around line 114)
- Modify: `init.sql` (`CREATE TABLE IF NOT EXISTS users`, after `page_access TEXT DEFAULT NULL,`)
- Modify: `server/routes/auth.cjs` (login ~L116/165, change-password ~L243, `/me` ~L272/281, `authMiddleware` ~L336/356)
- Test: `server/routes/auth.test.cjs`

**Interfaces:**
- Produces: `req.user.canEditOrderDetails: boolean` on every authenticated request. Sign-in, `/auth/me` and change-password all return `user.canEditOrderDetails: boolean`.

- [ ] **Step 1: Make the auth test's fake database behave like Postgres, then write the failing tests**

In `server/routes/auth.test.cjs`, add this helper directly above `installFakeDb(`:

```js
// Answer with only the columns the query names, as Postgres would, so a
// column left out of a SELECT is missing here too.
const pick = (sql, row) => {
  const cols = sql.match(/^SELECT (.+?) FROM users/s)[1].trim();
  if (cols === '*') return row;
  return Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, row[c]]));
};
```

Replace the two lookup handlers at the top of the fake:

```js
  if (/FROM users WHERE id = \$1/.test(sql)) {
    return { rows: users.has(params[0]) ? [users.get(params[0])] : [] };
  }
  if (/FROM users WHERE username = \$1/.test(sql)) {
    return { rows: byName(params[0]) ? [byName(params[0])] : [] };
  }
```

with:

```js
  if (/FROM users WHERE id = \$1/.test(sql)) {
    return { rows: users.has(params[0]) ? [pick(sql, users.get(params[0]))] : [] };
  }
  if (/FROM users WHERE username = \$1/.test(sql)) {
    return { rows: byName(params[0]) ? [pick(sql, byName(params[0]))] : [] };
  }
```

Directly below `app.get('/api/orders', ...)`, add a route that echoes the request user:

```js
app.get('/api/whoami', authMiddleware, (req, res) => res.json(req.user));
```

Replace `addUser` so a test can give the user the switch:

```js
const addUser = ({ mustChange, password = 'Temp-pass-1', canEdit = false }) => {
  const id = nextId++;
  users.set(id, {
    id, username: `user${id}`, role: 'user', page_access: null,
    password_hash: bcrypt.hashSync(password, 4), password_must_change: mustChange,
    failed_login_attempts: 0, locked_until: null, can_edit_order_details: canEdit,
  });
  // The token deliberately says nothing about the pending change: the server
  // has to read it from the database, not trust what the client holds.
  return { username: `user${id}`, token: jwt.sign({ id, username: `user${id}`, role: 'user' }, process.env.JWT_SECRET) };
};
```

Append these tests to the end of the file:

```js
test('sign-in and the profile say whether the user may edit order details', async () => {
  const { username, token } = addUser({ mustChange: false, password: 'Right-pass-1', canEdit: true });
  const signedIn = await signIn(username, 'Right-pass-1');
  assert.equal(signedIn.body.user.canEditOrderDetails, true);
  const me = await request(base, '/api/auth/me', { token });
  assert.equal(me.body.user.canEditOrderDetails, true);
});

test('the permission is read from the database on every request', async () => {
  const { token } = addUser({ mustChange: false });
  const { id } = jwt.decode(token);
  assert.equal((await request(base, '/api/whoami', { token })).body.canEditOrderDetails, false);
  users.get(id).can_edit_order_details = true;
  assert.equal((await request(base, '/api/whoami', { token })).body.canEditOrderDetails, true);
});

test('a password change keeps the permission in the user it returns', async () => {
  const { token } = addUser({ mustChange: true, password: 'Temp-pass-1', canEdit: true });
  const changed = await request(base, '/api/auth/change-password', {
    token, body: { currentPassword: 'Temp-pass-1', newPassword: 'New-pass-22' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.canEditOrderDetails, true);
});
```

- [ ] **Step 2: Run the tests and confirm the new ones fail**

Run: `node --test server/routes/auth.test.cjs`
Expected: the 9 existing tests PASS. The 3 new tests FAIL, because `canEditOrderDetails` is `undefined`.

- [ ] **Step 3: Add the column**

In `server/db.cjs`, inside the first `DO $$` block of `users` migrations, directly after the `page_access` `END IF;`, add:

```sql
        -- Who may edit an order from the Order Details drawer. Admins always
        -- can; everyone else needs an admin to switch this on.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='can_edit_order_details') THEN
          ALTER TABLE users ADD COLUMN can_edit_order_details BOOLEAN NOT NULL DEFAULT false;
        END IF;
```

In `init.sql`, inside `CREATE TABLE IF NOT EXISTS users`, directly after `page_access TEXT DEFAULT NULL,`, add:

```sql
    -- Who may edit an order from the Order Details drawer (admins always can).
    can_edit_order_details BOOLEAN NOT NULL DEFAULT false,
```

- [ ] **Step 4: Read and return the switch in `server/routes/auth.cjs`**

Login query: in `'SELECT id, username, full_name, email, phone, password_hash, role, password_must_change, failed_login_attempts, locked_until, page_access FROM users WHERE username = $1'`, change `page_access FROM users` to `page_access, can_edit_order_details FROM users`.

Login response: in the `res.json({ token, user: { ... } })` of `/login`, change

```js
                passwordMustChange: user.password_must_change,
                pageAccess
            }
        });
```

to

```js
                passwordMustChange: user.password_must_change,
                pageAccess,
                canEditOrderDetails: !!user.can_edit_order_details
            }
        });
```

Change-password response (its query is `SELECT *`, so the column is already there): change

```js
                passwordMustChange: false,
                pageAccess: cpPageAccess
            }
```

to

```js
                passwordMustChange: false,
                pageAccess: cpPageAccess,
                canEditOrderDetails: !!user.can_edit_order_details
            }
```

`/me` query: change `'SELECT id, username, full_name, email, phone, role, password_must_change, page_access, created_at FROM users WHERE id = $1'` to `'SELECT id, username, full_name, email, phone, role, password_must_change, page_access, can_edit_order_details, created_at FROM users WHERE id = $1'`. In its response, change

```js
                pageAccess: parsePageAccess(user.page_access),
                createdAt: user.created_at
```

to

```js
                pageAccess: parsePageAccess(user.page_access),
                canEditOrderDetails: !!user.can_edit_order_details,
                createdAt: user.created_at
```

`authMiddleware` query: change `'SELECT id, username, role, password_must_change, page_access FROM users WHERE id = $1'` to `'SELECT id, username, role, password_must_change, page_access, can_edit_order_details FROM users WHERE id = $1'`. In the `req.user = { ... }` it builds, change

```js
            pageAccess: parsePageAccess(currentUser.page_access)
        };
```

to

```js
            pageAccess: parsePageAccess(currentUser.page_access),
            // Re-read on every request, so switching it off applies at once.
            canEditOrderDetails: !!currentUser.can_edit_order_details
        };
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test server/routes/auth.test.cjs`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add server/db.cjs init.sql server/routes/auth.cjs server/routes/auth.test.cjs
git commit -m "feat(auth): can_edit_order_details column, read on every request and returned to the client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admins read and write the switch

**Files:**
- Modify: `server/routes/users.cjs` (validations ~L28-63, `GET /`, `POST /`, `PATCH /:id`)
- Test: `server/routes/users.test.cjs`

**Interfaces:**
- Consumes: the column from Task 3.
- Produces: `GET /api/users` rows include `can_edit_order_details: boolean`. `POST /api/users` and `PATCH /api/users/:id` accept `can_edit_order_details`, which must be a boolean. It is always stored as `false` for admins.

- [ ] **Step 1: Extend the fake database and write the failing tests**

In `server/routes/users.test.cjs`, replace the whole `installFakeDb(...)` call, and the `const stored = new Map();` line above it, with:

```js
// What the routes wrote, so a test can check the stored hash itself.
const stored = new Map();
let lastInsert;
let lastUpdate;
let targetRole = 'user';

// Answer with only the columns the query names, as Postgres would.
const pick = (sql, row) => {
  const cols = sql.match(/^SELECT (.+?) FROM users/s)[1].trim();
  return Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, row[c]]));
};

installFakeDb(async (sql, params) => {
  if (/^SELECT id FROM users WHERE LOWER\(username\)/.test(sql)) return { rows: [] };
  if (/^INSERT INTO users/.test(sql)) {
    stored.set(params[0], params[1]);
    lastInsert = { sql, params };
    return { rows: [{ id: 41 }] };
  }
  if (/^SELECT id FROM users WHERE id = \$1/.test(sql)) return { rows: [{ id: params[0] }] };
  if (/^SELECT id, username, role FROM users WHERE id = \$1/.test(sql)) {
    return { rows: [{ id: params[0], username: 'ravi', role: targetRole }] };
  }
  if (/FROM users ORDER BY created_at DESC/.test(sql)) {
    return { rows: [pick(sql, {
      id: 7, username: 'ravi', full_name: null, email: null, phone: null, role: 'user',
      page_access: null, can_edit_order_details: true, created_at: null,
    })] };
  }
  if (/^UPDATE users SET\s+password_hash = \$1,\s+password_must_change = true/.test(sql)) {
    stored.set(`reset:${params[1]}`, params[0]);
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE users SET .* RETURNING/s.test(sql)) {
    lastUpdate = { sql, params };
    return { rows: [{ id: 7, username: 'ravi', role: targetRole, page_access: null, can_edit_order_details: false }] };
  }
  throw new Error(`users test: unexpected query ${sql}`);
});

// The value an UPDATE set for a column, or undefined when it left it alone.
const setValue = ({ sql, params }, col) => {
  const m = sql.match(new RegExp(`${col} = \\$(\\d+)`));
  return m ? params[Number(m[1]) - 1] : undefined;
};
```

Append these tests to the end of the file:

```js
test('a new user can be given the order details switch', async () => {
  const { status, body } = await request(base, '/api/users', {
    body: { username: 'editor1', password: 'Start-pass-1', role: 'user', can_edit_order_details: true },
  });
  assert.equal(status, 201);
  assert.equal(body.user.can_edit_order_details, true);
  assert.match(lastInsert.sql, /can_edit_order_details/);
  assert.equal(lastInsert.params[8], true);
});

test('a new user starts without the switch, and an admin never stores it', async () => {
  await request(base, '/api/users', { body: { username: 'plain1', password: 'Start-pass-1', role: 'user' } });
  assert.equal(lastInsert.params[8], false);
  await request(base, '/api/users', {
    body: { username: 'boss1', password: 'Start-pass-1', role: 'admin', can_edit_order_details: true },
  });
  assert.equal(lastInsert.params[8], false);
});

test('the switch can be turned on and off for an existing user', async () => {
  targetRole = 'user';
  const on = await request(base, '/api/users/7', { method: 'PATCH', body: { can_edit_order_details: true } });
  assert.equal(on.status, 200);
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), true);
  await request(base, '/api/users/7', { method: 'PATCH', body: { can_edit_order_details: false } });
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), false);
});

test('an update that leaves the switch out does not touch it', async () => {
  targetRole = 'user';
  await request(base, '/api/users/7', { method: 'PATCH', body: { email: 'ravi@example.com' } });
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), undefined);
});

test('making someone an admin clears the switch, since the role already allows editing', async () => {
  targetRole = 'user';
  await request(base, '/api/users/7', { method: 'PATCH', body: { role: 'admin', can_edit_order_details: true } });
  assert.equal(setValue(lastUpdate, 'can_edit_order_details'), false);
});

test('the switch must be true or false', async () => {
  const { status } = await request(base, '/api/users/7', { method: 'PATCH', body: { can_edit_order_details: 'maybe' } });
  assert.equal(status, 400);
});

test('the user list says who can edit order details', async () => {
  const { status, body } = await request(base, '/api/users');
  assert.equal(status, 200);
  assert.equal(body.users[0].can_edit_order_details, true);
});
```

- [ ] **Step 2: Run the tests and confirm the new ones fail**

Run: `node --test server/routes/users.test.cjs`
Expected: the 2 existing tests PASS and the 7 new tests FAIL.

- [ ] **Step 3: Implement the switch in `server/routes/users.cjs`**

Directly below `const normalizeEmail = blankToNull;`, add:

```js
// Accepts what express-validator's isBoolean lets through.
const toFlag = (v) => v === true || v === 'true' || v === 1 || v === '1';
```

Add this rule to the end of **both** `createUserValidation` and `updateUserValidation`, after their last entry:

```js
    body('can_edit_order_details')
        .optional()
        .isBoolean().withMessage('can_edit_order_details must be true or false'),
```

In `GET /`, change the query to `'SELECT id, username, full_name, email, phone, role, page_access, can_edit_order_details, created_at FROM users ORDER BY created_at DESC'`.

In `POST /`:
- Change the destructuring to `const { username, password, email, full_name, phone, role = 'user', page_access, can_edit_order_details } = req.body;`
- Directly after the `storedPageAccess` line, add:

```js
        // Admins edit orders through their role; the switch is for everyone else.
        const canEditOrders = role !== 'admin' && toFlag(can_edit_order_details);
```

- Change the insert to:

```js
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, email, full_name, phone, role, password_must_change, page_access, can_edit_order_details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
            [username, passwordHash, normalizeEmail(email), blankToNull(full_name), blankToNull(phone), role, true, storedPageAccess, canEditOrders]
        );
```

- In the 201 response's `user`, add `can_edit_order_details: canEditOrders,` after `role,`.

In `PATCH /:id`:
- Change the destructuring to `const { username, email, full_name, phone, role, page_access, can_edit_order_details } = req.body;`
- Directly after the block that ends `fields.push(\`page_access = $${idx++}\`); values.push(null);\n        }` (the "If switching to admin" block), add:

```js
        // Admins edit orders through their role, so the switch is kept off for them.
        if (nextRole === 'admin') {
            fields.push(`can_edit_order_details = $${idx++}`); values.push(false);
        } else if (can_edit_order_details !== undefined) {
            fields.push(`can_edit_order_details = $${idx++}`); values.push(toFlag(can_edit_order_details));
        }
```

- Change the `RETURNING` list to `RETURNING id, username, full_name, email, phone, role, page_access, can_edit_order_details, created_at`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test server/routes/users.test.cjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add server/routes/users.cjs server/routes/users.test.cjs
git commit -m "feat(users): admins set who can edit order details

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The guarded details route

**Files:**
- Modify: `server/routes/orders.cjs` (the imports at the top, a new middleware after `handleValidationErrors`, the `PUT /:id` line, and a new route directly after `PATCH /:id`)
- Modify: `server/routes/orders.test.cjs` (the user under test, plus one new test)
- Create: `server/routes/orders.details.test.cjs`

**Interfaces:**
- Consumes: from Task 1, `EDITABLE_FIELDS`, `OrderEditError`, `planChanges`, `needsReason`, `changeNeedsReason`, `displayValue`, `validateReason`, `canEditOrderDetails`, `fromRow` and `columnValue`. From `orders.cjs`, the existing `insertChangeLog`, `autoUpdateBackupRequests` and `presentOrder`. From the delivery service, `planEtaChange`, `insertEtaEvent` and `DeliveryRuleError`.
- Produces: `PATCH /api/orders/:id/details` with body `{ fields, reason?, etaChange? }`:
  - 200 → `{ order, logged }`. `order` has no `changeCount`.
  - 400 → `{ error, code, fields? }`, where `code` is one of `INVALID`, `REASON_REQUIRED` or `ETA_CAUSE_REQUIRED`.
  - 403 → `{ error, code: 'ORDER_EDIT_FORBIDDEN' }`.
  - 404 when the order doesn't exist.

  `PUT /api/orders/:id` now answers the same 403 to non-editors.

- [ ] **Step 1: Write the failing route tests**

Create `server/routes/orders.details.test.cjs`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// The order the next request finds; null means no such order.
let stored;
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT \* FROM die_orders WHERE id = \$1 FOR UPDATE/.test(q)) return { rows: stored ? [stored] : [] };
  if (/^UPDATE die_orders SET/.test(q)) return { rows: [{ ...stored }], rowCount: 1 };
  if (/^INSERT INTO die_delivery_events/.test(q)) return { rows: [{ id: 1 }] };
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  if (/^UPDATE backup_die_requests/.test(q)) return { rows: [] };
  throw new Error(`order details test: unexpected query ${q}`);
});

const ordersRouter = require('./orders.cjs');

const EDITOR = { id: 5, username: 'planner', role: 'user', canEditOrderDetails: true };
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/orders', ordersRouter);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  log = [];
  currentUser = EDITOR;
  stored = {
    id: 7, die_no: '30533_201', status: 'PENDING FOR DESIGN APPROVAL', supplier: 'ALPHA', cavity: 2,
    ordered_date: null, die_received_date: null, eta: '2026-10-01', simulation_enabled: 0,
    urgency: 'NORMAL', special_follow_up: false,
  };
});

const save = (body) => request(base, '/api/orders/7/details', { method: 'PATCH', body });
const queries = (prefix) => log.filter(({ q }) => q.startsWith(prefix));
// order_changes columns: order_id, user_id, changed_by_name, changed_at,
// field_name, old_value, new_value, reason, stage.
const logged = () => queries('INSERT INTO order_changes').map(({ params }) => ({
  field: params[4], old: params[5], new: params[6], reason: params[7], stage: params[8], by: params[2],
}));

test('someone without the switch is refused before anything is read', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status, body } = await save({ fields: { 'Die Received Date': '2026-09-21' } });
  assert.equal(status, 403);
  assert.equal(body.code, 'ORDER_EDIT_FORBIDDEN');
  assert.equal(log.length, 0);
});

test('an admin needs no switch', async () => {
  currentUser = { id: 1, username: 'admin', role: 'admin' };
  const { status } = await save({ fields: { 'Die Received Date': '2026-09-21' } });
  assert.equal(status, 200);
});

test('filling empty fields saves without a reason and logs each field', async () => {
  const { status, body } = await save({ fields: { 'Die Received Date': '2026-09-21', simulationEnabled: true } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.logged, 2);
  const [update] = queries('UPDATE die_orders');
  assert.match(update.q, /die_received_date = \$1, simulation_enabled = \$2, updated_at = CURRENT_TIMESTAMP WHERE id = \$3 RETURNING \*/);
  assert.deepEqual(update.params, ['2026-09-21', 1, '7']);
  assert.deepEqual(logged(), [
    { field: 'Die Received Date', old: null, new: '2026-09-21', reason: null, stage: 'PENDING FOR DESIGN APPROVAL', by: 'planner' },
    { field: 'simulationEnabled', old: 'No', new: 'Yes', reason: null, stage: 'PENDING FOR DESIGN APPROVAL', by: 'planner' },
  ]);
  assert.equal(log.at(-1).q, 'COMMIT');
});

test('changing an existing value without a reason is refused and nothing is written', async () => {
  const { status, body } = await save({ fields: { Supplier: 'BETA', 'Die Received Date': '2026-09-21' } });
  assert.equal(status, 400);
  assert.equal(body.code, 'REASON_REQUIRED');
  assert.deepEqual(body.fields, ['Supplier']);
  assert.equal(queries('UPDATE die_orders').length, 0);
  assert.equal(log.at(-1).q, 'ROLLBACK');
});

test('with a reason, every field is logged with the stored old value and that reason', async () => {
  const { status, body } = await save({
    fields: { Supplier: 'BETA', Cavity: '3', 'Die Received Date': '2026-09-21' },
    reason: '  Supplier revised the quotation ',
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(logged().map((e) => [e.field, e.old, e.new, e.reason]), [
    ['Supplier', 'ALPHA', 'BETA', 'Supplier revised the quotation'],
    ['Cavity', '2', '3', 'Supplier revised the quotation'],
    ['Die Received Date', null, '2026-09-21', 'Supplier revised the quotation'],
  ]);
  assert.equal(body.order['DIE NO'], '30533_201');
  assert.equal('changeCount' in body.order, false);
});

test('an ordinary status step needs no reason, but CANCELLED does', async () => {
  const step = await save({ fields: { 'Design Approved Date': '2026-09-22', STATUS: 'PENDING FOR PR' } });
  assert.equal(step.status, 200, JSON.stringify(step.body));
  const cancel = await save({ fields: { STATUS: 'CANCELLED' } });
  assert.equal(cancel.status, 400);
  assert.equal(cancel.body.code, 'REASON_REQUIRED');
  assert.deepEqual(cancel.body.fields, ['STATUS']);
});

test('re-sending stored values writes nothing', async () => {
  const { status, body } = await save({ fields: { Supplier: ' ALPHA ', Cavity: 2 } });
  assert.equal(status, 200);
  assert.equal(body.logged, 0);
  assert.equal(queries('UPDATE die_orders').length, 0);
  assert.equal(log.at(-1).q, 'ROLLBACK');
});

test('fields the drawer does not show are refused', async () => {
  const { status, body } = await save({ fields: { Remark: 'hello' } });
  assert.equal(status, 400);
  assert.match(body.error, /Remark cannot be changed from Order Details/);
  assert.equal(queries('UPDATE die_orders').length, 0);
});

test('an empty save and an over-long reason are refused before anything is read', async () => {
  assert.equal((await save({ fields: {} })).status, 400);
  assert.equal((await save({})).status, 400);
  assert.equal((await save({ fields: { Supplier: 'BETA' }, reason: 'x'.repeat(501) })).status, 400);
  assert.equal(log.length, 0);
});

test('an unknown order is a 404', async () => {
  stored = null;
  const { status } = await save({ fields: { Supplier: 'BETA' }, reason: 'Re-quoted' });
  assert.equal(status, 404);
});

test('moving the ETA still needs a delivery cause, and is logged on the timeline', async () => {
  const refused = await save({ fields: { ETA: '2026-10-15' }, reason: 'Supplier call' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'ETA_CAUSE_REQUIRED');
  assert.equal(queries('UPDATE die_orders').length, 0);
  log = [];
  const ok = await save({
    fields: { ETA: '2026-10-15' }, reason: 'Supplier call',
    etaChange: { cause: 'supplier_delay', note: 'Heat treatment' },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(queries('INSERT INTO die_delivery_events')[0].params,
    ['7', 'eta_revised', '2026-10-01', '2026-10-15', 'supplier_delay', 'Heat treatment', 5, 'planner']);
});

test('filling the ordered date completes pending backup requests for the die', async () => {
  const { status } = await save({ fields: { 'Ordered date': '2026-09-23' } });
  assert.equal(status, 200);
  assert.deepEqual(queries('UPDATE backup_die_requests')[0].params, ['2026-09-23', '30533_201']);
});
```

In `server/routes/orders.test.cjs`, make the user under test switchable. Replace

```js
app.use((req, res, next) => { req.user = { id: 5, username: 'planner' }; next(); });
```

with

```js
const EDITOR = { id: 5, username: 'planner', role: 'user', canEditOrderDetails: true };
let currentUser = EDITOR;
app.use((req, res, next) => { req.user = currentUser; next(); });
```

and replace

```js
test.beforeEach(() => { log = []; storedEta = '2026-10-01'; });
```

with

```js
test.beforeEach(() => { log = []; storedEta = '2026-10-01'; currentUser = EDITOR; });
```

Append to `server/routes/orders.test.cjs`:

```js
test('PUT is refused for someone without the order details switch', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status, body } = await request(base, '/api/orders/7', { method: 'PUT', body: { ETA: '2026-10-20' } });
  assert.equal(status, 403);
  assert.equal(body.code, 'ORDER_EDIT_FORBIDDEN');
  assert.equal(log.length, 0);
});

test('the generic PATCH stays open to the step-by-step pages', async () => {
  currentUser = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
  const { status } = await request(base, '/api/orders/7', { method: 'PATCH', body: { Remark: 'checked' } });
  assert.equal(status, 200);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test server/routes/orders.details.test.cjs server/routes/orders.test.cjs`
Expected: the new details tests FAIL with 404s, because the route doesn't exist yet. The PUT-refused test FAILS, because PUT still answers. The existing 7 tests and the generic-PATCH test PASS.

- [ ] **Step 3: Implement the guard and the route in `server/routes/orders.cjs`**

Below the existing `require` of `../services/deliveryFollowup.cjs` (line 7), add:

```js
const {
    EDITABLE_FIELDS, OrderEditError, planChanges, needsReason, changeNeedsReason,
    displayValue, validateReason, canEditOrderDetails, fromRow, columnValue,
} = require('../services/orderDetailEdits.cjs');
```

Directly after the `handleValidationErrors` function, add:

```js
// Only admins, and the people an admin switched on, may edit an order's
// values directly. The step-by-step pages use PATCH /:id and stay open.
const requireOrderEditor = (req, res, next) => {
    if (!canEditOrderDetails(req.user)) {
        return res.status(403).json({ error: 'You do not have permission to edit order details', code: 'ORDER_EDIT_FORBIDDEN' });
    }
    next();
};

// The saved row carries no change count, so the client adds `logged` to its own.
const presentSaved = (row) => {
    const order = presentOrder(row);
    delete order.changeCount;
    return order;
};
```

Change the PUT route's first line from

```js
router.put('/:id', orderIdValidation, orderValidation, handleValidationErrors, async (req, res) => {
```

to

```js
router.put('/:id', requireOrderEditor, orderIdValidation, orderValidation, handleValidationErrors, async (req, res) => {
```

Directly after the closing `});` of `router.patch('/:id', ...)` (just before the `// Update order (full replace` comment), add:

```js
// Save from the Order Details drawer. Editors only. The server diffs the
// incoming fields against the locked row, asks for a reason when an existing
// value is changed or cleared, and logs every changed field with the old value
// read from the database, never from the client.
router.patch('/:id/details', requireOrderEditor, orderIdValidation, handleValidationErrors, async (req, res) => {
    const { id } = req.params;
    const { fields, etaChange } = req.body || {};
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'Nothing to save' });
    }
    let reason;
    try {
        reason = validateReason(req.body.reason);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: error.code });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM die_orders WHERE id = $1 FOR UPDATE', [id]);
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
        }
        const stored = rows[0];
        const changes = planChanges(fromRow(stored), fields);
        if (changes.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ order: presentSaved(stored), logged: 0 });
        }
        if (needsReason(changes) && !reason) {
            throw new OrderEditError('Give a reason for changing existing values', 'REASON_REQUIRED',
                changes.filter(changeNeedsReason).map((c) => c.field));
        }
        const eta = changes.find((c) => c.field === 'ETA');
        const etaPlan = eta ? planEtaChange(stored.eta, eta.after, etaChange) : null;

        const sets = changes.map((c, i) => `${EDITABLE_FIELDS[c.field].col} = $${i + 1}`);
        const values = [...changes.map((c) => columnValue(c.field, c.after)), id];
        const updated = await client.query(
            `UPDATE die_orders SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (etaPlan) await insertEtaEvent(client, id, etaPlan, req.user);
        await insertChangeLog(client, id, changes.map((c) => ({
            field: c.field,
            oldValue: displayValue(c.field, c.before),
            newValue: displayValue(c.field, c.after),
            reason,
            stage: stored.status,
        })), req.user);
        await client.query('COMMIT');

        const ordered = changes.find((c) => c.field === 'Ordered date' && c.after);
        if (ordered) await autoUpdateBackupRequests(stored.die_no, ordered.after);

        res.json({ order: presentSaved(updated.rows[0]), logged: changes.length });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof OrderEditError || error instanceof DeliveryRuleError) {
            return res.status(400).json({ error: error.message, code: error.code, ...(error.fields && { fields: error.fields }) });
        }
        console.error('Save order details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test server/routes/orders.details.test.cjs server/routes/orders.test.cjs`
Expected: PASS, 12 details tests and 9 orders tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: `fail 0`, with the 2 Work Queue suites still skipped.

- [ ] **Step 6: Commit**

```bash
git add server/routes/orders.cjs server/routes/orders.test.cjs server/routes/orders.details.test.cjs
git commit -m "feat(orders): guarded Order Details save that logs every field and asks for a reason

PATCH /api/orders/:id/details diffs against the locked row, refuses a
changed or cleared value without a reason, keeps the ETA cause rule, and
writes one order_changes row per field. PUT /api/orders/:id gets the same
permission check; the generic PATCH stays open for the step pages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: API client

**Files:**
- Modify: `src/api.js` (`authAPI` ~L108, `usersAPI.create`/`update` ~L147-178, `ordersAPI` after `patch` ~L255)
- Test: `src/api.test.js`

**Interfaces:**
- Consumes: the routes from Tasks 3–5.
- Produces:
  - `ordersAPI.patchDetails(id, { fields, reason, etaChange }) -> Promise<{ order, logged }>`. When it fails, the error carries `status` and `data.code`.
  - `authAPI.refreshUser() -> Promise<user | null>`. It stores the merged user in `localStorage`.
  - `usersAPI.create(username, password, role, pageAccess, email, fullName, phone, canEditOrderDetails = false)`
  - `usersAPI.update(id, { ..., canEditOrderDetails })`

- [ ] **Step 1: Write the failing tests**

In `src/api.test.js`, change the import line

```js
const { frozenDesignsAPI, existingDataAPI, backupRequestsAPI, qualityDiscrepanciesAPI } = await import('./api.js');
```

to

```js
const { frozenDesignsAPI, existingDataAPI, backupRequestsAPI, qualityDiscrepanciesAPI, ordersAPI, usersAPI, authAPI } = await import('./api.js');
```

Append:

```js
test('patchDetails sends only the fields, the reason and any ETA cause', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ order: { id: 7 }, logged: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const res = await ordersAPI.patchDetails(7, { fields: { Supplier: 'BETA' }, reason: 'Re-quoted' });
  assert.equal(res.logged, 1);
  assert.match(seen.url, /\/orders\/7\/details$/);
  assert.equal(seen.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(seen.options.body), { fields: { Supplier: 'BETA' }, reason: 'Re-quoted' });
});

test('a refused order save carries the server code for the drawer to branch on', async () => {
  respondWith(JSON.stringify({ error: 'You do not have permission to edit order details', code: 'ORDER_EDIT_FORBIDDEN' }), 403);
  await assert.rejects(ordersAPI.patchDetails(7, { fields: { Supplier: 'BETA' } }), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.data.code, 'ORDER_EDIT_FORBIDDEN');
    return true;
  });
});

test('the users API sends the order details switch on create and update', async () => {
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ user: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await usersAPI.create('ravi', 'Start-pass-1', 'user', null, null, null, null, true);
  await usersAPI.update(7, { canEditOrderDetails: false });
  await usersAPI.update(7, { email: '' });
  assert.equal(bodies[0].can_edit_order_details, true);
  assert.deepEqual(bodies[1], { can_edit_order_details: false });
  assert.equal('can_edit_order_details' in bodies[2], false);
});

test('refreshUser stores the latest profile over the one sign-in saved', async () => {
  const saved = {};
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (key === 'user' ? JSON.stringify({ id: 3, username: 'ravi', canEditOrderDetails: false }) : null),
    setItem: (key, value) => { saved[key] = value; },
    removeItem: () => {},
  };
  try {
    respondWith(JSON.stringify({ user: { id: 3, username: 'ravi', role: 'user', canEditOrderDetails: true } }));
    const user = await authAPI.refreshUser();
    assert.equal(user.canEditOrderDetails, true);
    assert.equal(JSON.parse(saved.user).canEditOrderDetails, true);
  } finally {
    globalThis.localStorage = original;
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test src/api.test.js`
Expected: the 4 new tests FAIL with `ordersAPI.patchDetails is not a function`, a missing `can_edit_order_details`, and `authAPI.refreshUser is not a function`.

- [ ] **Step 3: Implement in `src/api.js`**

In `authAPI`, directly after the `me` method, add:

```js
    // Re-read the signed-in user, so a permission an admin changed since
    // sign-in (page access, editing order details) is picked up on reload.
    refreshUser: async () => {
        const data = await apiRequest('/auth/me');
        if (!data?.user) return null;
        const user = { ...getUser(), ...data.user };
        setUser(user);
        return user;
    },
```

Replace `usersAPI.create` with:

```js
    create: async (username, password, role = 'user', pageAccess = null, email = null, fullName = null, phone = null, canEditOrderDetails = false) => {
        return apiRequest('/users', {
            method: 'POST',
            body: JSON.stringify({
                username, password, role, page_access: pageAccess, email, full_name: fullName, phone,
                can_edit_order_details: canEditOrderDetails,
            }),
        });
    },
```

In `usersAPI.update`, change the signature to `update: async (id, { username, role, pageAccess, email, fullName, phone, canEditOrderDetails } = {}) => {` and add this after the `phone` line:

```js
        if (canEditOrderDetails !== undefined) body.can_edit_order_details = canEditOrderDetails;
```

In `ordersAPI`, directly after the `patch` method, add:

```js
    // Save from the Order Details drawer. Editors only: the server works out
    // what changed and needs `reason` when an existing value is changed or
    // cleared, and `etaChange` ({ cause, note }) when a set ETA moves.
    patchDetails: async (id, { fields, reason, etaChange } = {}) => {
        return apiRequest(`/orders/${id}/details`, {
            method: 'PATCH',
            body: JSON.stringify({ fields, reason, etaChange }),
        });
    },
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test src/api.test.js`
Expected: PASS, with all tests including the 4 new ones.

- [ ] **Step 5: Lint and commit**

Run: `npx eslint src/api.js src/api.test.js`
Expected: no output.

```bash
git add src/api.js src/api.test.js
git commit -m "feat(api): patchDetails, refreshUser, and the order details switch on users

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Users page: the switch and the badge

**Files:**
- Modify: `src/components/modals/AddUserModal.jsx`
- Modify: `src/pages/UsersPage.jsx`

**Interfaces:**
- Consumes: `usersAPI.create(..., canEditOrderDetails)` and `usersAPI.update(id, { canEditOrderDetails })` from Task 6, plus `can_edit_order_details` on user rows from Task 4.
- Produces: `onSubmit(userData)` from `AddUserModal` now includes `userData.canEditOrderDetails: boolean`.

There is no component test framework in this repo. Verify with eslint, the build, and the browser check in Task 10.

- [ ] **Step 1: Add the state and toggle to `AddUserModal.jsx`**

In the edit-mode initial state object, add `canEditOrderDetails: !!initialUser.can_edit_order_details,` after `pageAccess: initialUser.page_access ?? null,`. Change the create-mode return to:

```js
    return { username: '', password: '', fullName: '', email: '', phone: '', role: 'user', pageAccess: null, canEditOrderDetails: false };
```

Directly after the `toggleAllFlow` function, add:

```js
  // Admins can always edit orders; the switch is only for everyone else.
  const toggleOrderEdit = () => {
    if (newUser.role === 'admin') return;
    setNewUser((prev) => ({ ...prev, canEditOrderDetails: !prev.canEditOrderDetails }));
  };
```

- [ ] **Step 2: Add the Permissions section**

In the right column, directly after the Page Access block's closing `</div>` (the one right after the `<p>` that reads "Uncheck pages to restrict access..."), and before the column's own closing `</div>`, add:

```jsx
                {/* Permissions */}
                <div>
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 700, color: theme.textMuted,
                    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px',
                  }}>
                    Permissions
                  </div>
                  {/* The Checkbox gets no onChange: its click bubbles to this row,
                      which is the one place the switch flips. */}
                  <div
                    onClick={toggleOrderEdit}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '12px',
                      padding: '10px 12px', borderRadius: '10px',
                      cursor: newUser.role === 'admin' ? 'default' : 'pointer',
                    }}
                    onMouseEnter={e => { if (newUser.role !== 'admin') e.currentTarget.style.background = theme.inputBg; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Checkbox
                      checked={newUser.role === 'admin' || newUser.canEditOrderDetails}
                      color="#F59E0B"
                      disabled={newUser.role === 'admin'}
                    />
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500, color: theme.text }}>
                        Can edit order details
                      </div>
                      <div style={{ fontSize: '0.68rem', color: theme.textDim, lineHeight: 1.4 }}>
                        {newUser.role === 'admin'
                          ? 'Admins can always edit.'
                          : 'Opens Edit in the Order Details drawer. A reason is required when changing existing values.'}
                      </div>
                    </div>
                  </div>
                </div>
```

- [ ] **Step 3: Pass the switch through in `UsersPage.jsx`, and show the badge**

In the Add User `onSubmit`, change the create call to:

```js
                      await usersAPI.create(userData.username, userData.password, userData.role, userData.pageAccess, userData.email, userData.fullName, userData.phone, userData.role === 'admin' ? false : userData.canEditOrderDetails);
```

In the Edit User `onSubmit`'s `usersAPI.update(editingUser.id, { ... })` object, add after the `pageAccess` line:

```js
                        canEditOrderDetails: userData.role === 'admin' ? false : !!userData.canEditOrderDetails,
```

In the table body, replace the role cell

```jsx
                        <td style={td}><span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600, background: u.role === 'admin' ? '#3B82F620' : '#64748B20', color: u.role === 'admin' ? '#3B82F6' : '#94A3B8' }}>{u.role}</span></td>
```

with

```jsx
                        <td style={td}>
                          <span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600, background: u.role === 'admin' ? '#3B82F620' : '#64748B20', color: u.role === 'admin' ? '#3B82F6' : '#94A3B8' }}>{u.role}</span>
                          {u.role !== 'admin' && u.can_edit_order_details && (
                            <span title="Can edit order details" style={{ marginLeft: '6px', padding: '4px 8px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 600, background: '#F59E0B20', color: '#F59E0B' }}>Edits orders</span>
                          )}
                        </td>
```

- [ ] **Step 4: Lint and build**

Run: `npx eslint src/components/modals/AddUserModal.jsx src/pages/UsersPage.jsx`
Expected: none of the reported problems are on lines you changed. Check each reported line number against `git diff -U0 src/components/modals/AddUserModal.jsx src/pages/UsersPage.jsx`.

Run: `npm run build`
Expected: `✓ built in`, with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/AddUserModal.jsx src/pages/UsersPage.jsx
git commit -m "feat(users): Can edit order details switch and an Edits orders badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Review changes dialog

**Files:**
- Create: `src/components/orders/OrderEditReviewDialog.jsx`

**Interfaces:**
- Consumes: `changeNeedsReason`, `displayValue`, `fieldLabel`, `fieldType` and `REASON_MAX` from Task 2. From `src/utils/deliveryFollowup.js`, `CAUSES`, `needsCause` and `normalizeEta`. `formatDate` from `src/utils/helpers.js`, and `useDialog` from `src/hooks/useDialog.js`.
- Produces: `<OrderEditReviewDialog theme dieNo changes fromEta toEta saving error onCancel onConfirm />`, where `onConfirm({ reason: string, etaChange?: { cause, note } })`.

- [ ] **Step 1: Create the component**

Create `src/components/orders/OrderEditReviewDialog.jsx`:

```jsx
import React, { useId, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import { CAUSES, needsCause, normalizeEta } from '../../utils/deliveryFollowup';
import { changeNeedsReason, displayValue, fieldLabel, fieldType, REASON_MAX } from '../../utils/orderDetailEdits';
import { formatDate } from '../../utils/helpers';

// A value as the drawer shows it: dates formatted, blanks as a dash.
function shown(field, value) {
  const text = displayValue(field, value);
  if (text === null) return '—';
  const type = fieldType(field);
  if ((type === 'date' || type === 'datetext') && normalizeEta(text)) return formatDate(text);
  return text;
}

// Opened by Save in the Order Details drawer. Lists every change, requires a
// reason when an existing value is changed or cleared, and asks for the
// delivery cause when a set ETA moves. The server checks all of it again.
export default function OrderEditReviewDialog({ theme, dieNo, changes, fromEta, toEta, saving, error, onCancel, onConfirm }) {
  const titleId = useId();
  const dialogRef = useDialog({ open: true, onClose: onCancel, closeOnEscape: !saving });
  const [reason, setReason] = useState('');
  const [cause, setCause] = useState('');
  const [causeNote, setCauseNote] = useState('');

  const withReason = changes.filter(changeNeedsReason);
  const withoutReason = changes.filter((c) => !changeNeedsReason(c));
  const reasonRequired = withReason.length > 0;
  const etaMoved = changes.some((c) => c.field === 'ETA') && needsCause(fromEta, toEta);
  const causeReady = !etaMoved || (!!cause && (cause !== 'other' || !!causeNote.trim()));
  const ready = !saving && causeReady && (!reasonRequired || !!reason.trim());

  const border = theme?.cardBorder || '#334155';
  const input = { width: '100%', padding: '9px 11px', background: theme?.inputBg || '#0F172A', border: `1px solid ${border}`, borderRadius: '8px', color: theme?.text || '#F1F5F9', fontSize: '0.875rem', boxSizing: 'border-box' };
  const heading = { margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: theme?.textDim || '#64748B' };

  const group = (title, list) => list.length > 0 && (
    <section>
      <h4 style={heading}>{title}</h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((c) => (
          <li key={c.field} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderBottom: `1px solid ${border}`, fontSize: '0.84rem' }}>
            <span style={{ color: theme?.textDim || '#64748B' }}>{fieldLabel(c.field)}</span>
            <span style={{ color: theme?.text || '#F1F5F9', textAlign: 'right' }}>
              {shown(c.field, c.before)} <span aria-hidden="true">→</span> <strong>{shown(c.field, c.after)}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={(e) => e.stopPropagation()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{ background: theme?.cardBg || '#1E293B', borderRadius: '16px', width: '100%', maxWidth: '480px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1px solid ${border}`, overflow: 'hidden' }}>
        <div style={{ padding: '1.1rem 1.5rem', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardCheck size={18} color="white" />
          </div>
          <div>
            <h3 id={titleId} style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: theme?.text || '#F1F5F9' }}>Save changes to {dieNo}</h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: theme?.textDim || '#64748B' }}>
              {changes.length} field{changes.length === 1 ? '' : 's'} changed
            </p>
          </div>
        </div>

        <div style={{ padding: '1.1rem 1.5rem', overflowY: 'auto', display: 'grid', gap: '14px' }}>
          {group('Changed · needs a reason', withReason)}
          {group('No reason needed', withoutReason)}

          {etaMoved && (
            <section style={{ display: 'grid', gap: '8px' }}>
              <h4 style={heading}>Why did the ETA move? *</h4>
              <select aria-label="ETA change cause" value={cause} onChange={(e) => setCause(e.target.value)} style={input}>
                <option value="">Pick a cause…</option>
                {CAUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <textarea aria-label="ETA cause note" rows={2} value={causeNote} onChange={(e) => setCauseNote(e.target.value)}
                placeholder={cause === 'other' ? 'Say what the cause is (required)' : 'Note (optional)'} style={{ ...input, resize: 'vertical' }} />
            </section>
          )}

          <section style={{ display: 'grid', gap: '6px' }}>
            <label htmlFor={`${titleId}-reason`} style={heading}>
              {reasonRequired ? 'Reason for changing existing values *' : 'Reason (optional)'}
            </label>
            <textarea id={`${titleId}-reason`} rows={3} maxLength={REASON_MAX} value={reason}
              onChange={(e) => setReason(e.target.value)} placeholder="Why are these values changing?"
              style={{ ...input, resize: 'vertical' }} />
          </section>

          {error && <p role="alert" style={{ margin: 0, fontSize: '0.82rem', color: '#F87171' }}>{error}</p>}
        </div>

        <div style={{ padding: '0 1.5rem 1.1rem', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${border}`, borderRadius: '8px', color: theme?.textDim || '#64748B', fontSize: '0.875rem', cursor: saving ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button type="button" disabled={!ready}
            onClick={() => onConfirm({ reason: reason.trim(), ...(etaMoved && { etaChange: { cause, note: causeNote.trim() } }) })}
            style={{ padding: '8px 18px', background: ready ? '#10B981' : '#334155', border: 'none', borderRadius: '8px', color: 'white', fontSize: '0.875rem', fontWeight: 600, cursor: ready ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint src/components/orders/OrderEditReviewDialog.jsx`
Expected: no output.

- [ ] **Step 3: Commit**

The component isn't wired in yet. The build check comes in Task 9, where it's first imported.

```bash
git add src/components/orders/OrderEditReviewDialog.jsx
git commit -m "feat(orders): Review changes dialog with the reason and ETA cause in one place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the drawer, refresh the user, remove the old dialogs

**Files:**
- Modify: `src/DieOrderingSystem.jsx` (imports L2 and L29–30, `OrderDetailModal` ~L944–1485, the load effect ~L1887, the drawer render ~L3336)
- Modify: `src/components/modals/ChangeLogModal.jsx` (~L194)
- Delete: `src/components/delivery/EtaCauseDialog.jsx`

**Interfaces:**
- Consumes: `planChanges`, `pickEditable` and `canEditOrderDetails` from Task 2. `ordersAPI.patchDetails` and `authAPI.refreshUser` from Task 6. `OrderEditReviewDialog` from Task 8.
- Produces: `OrderDetailModal` gains a `showViewOnly` prop.

- [ ] **Step 1: Swap the imports**

On line 2, remove `XCircle, ` from the `lucide-react` import. Its only other use is the status-reason pop-up, which Step 5 deletes.

Replace

```js
import EtaCauseDialog from './components/delivery/EtaCauseDialog';
import { needsCause } from './utils/deliveryFollowup';
```

with

```js
import OrderEditReviewDialog from './components/orders/OrderEditReviewDialog';
import { planChanges, pickEditable, canEditOrderDetails } from './utils/orderDetailEdits';
```

- [ ] **Step 2: Replace the drawer's props and state**

Change the component's first line to the following. It drops `currentUser`, which only the deleted status pop-up read; the server now records who made the change. The parent may keep passing it, which is harmless.

```js
const OrderDetailModal = ({ order, onClose, onUpdate, theme, suppliers = [], plants = [], correctors = [], canEdit = true, showViewOnly = false, onViewRevisions }) => {
```

Replace

```js
  const [statusReasonModal, setStatusReasonModal] = useState({ show: false, newStatus: '', oldStatus: '', reason: '' });
  const [pendingStatusLog, setPendingStatusLog] = useState(null);
  const [etaCausePrompt, setEtaCausePrompt] = useState(false);
```

with

```js
  const [review, setReview] = useState(null); // { changes } while Review changes is open
  const [reviewError, setReviewError] = useState('');
  // Set when the server refuses a save because an admin switched the permission off.
  const [editRevoked, setEditRevoked] = useState(false);
```

In the `useEffect(() => { setEditedOrder({...}); setIsEditing(false); setPendingStatusLog(null); }, [order.id]);` block, replace `setPendingStatusLog(null);` with `setReview(null);`.

- [ ] **Step 3: Stop `handleFieldChange` from opening the old status pop-up**

Delete these lines from the top of `handleFieldChange`:

```js
    if (field === 'STATUS' && (value === 'CANCELLED' || value === 'HOLD')) {
      const oldStatus = editedOrder.STATUS || order.STATUS;
      setStatusReasonModal({ show: true, newStatus: value, oldStatus, reason: '' });
      return;
    }
```

- [ ] **Step 4: Replace the save logic**

Delete `handleStatusReasonConfirm` and the whole `handleSave` function. That's everything from `const handleStatusReasonConfirm = () => {` through the closing `};` of `handleSave`, just before `const handleCancel`. Put this in their place:

```js
  // Save opens Review changes with what really changed; nothing changed means
  // nothing to send. A value the server would refuse is reported here first.
  const handleSave = () => {
    let changes;
    try {
      changes = planChanges(order, pickEditable(editedOrder));
    } catch (error) {
      dialogs.notify(error.message, 'error');
      return;
    }
    if (changes.length === 0) {
      setIsEditing(false);
      return;
    }
    setReviewError('');
    setReview({ changes });
  };

  const confirmSave = async ({ reason, etaChange }) => {
    const fields = Object.fromEntries(review.changes.map((c) => [c.field, editedOrder[c.field]]));
    setIsSaving(true);
    setReviewError('');
    try {
      const saved = await ordersAPI.patchDetails(order.id, { fields, reason, etaChange });
      setReview(null);
      setIsEditing(false);
      if (onUpdate) onUpdate({ ...order, ...saved.order, changeCount: (order.changeCount || 0) + saved.logged });
    } catch (error) {
      if (error.data?.code === 'ORDER_EDIT_FORBIDDEN') {
        setEditRevoked(true);
        handleCancel();
        dialogs.notify('You no longer have permission to edit order details', 'error');
      } else {
        setReviewError(error.message);
      }
    } finally {
      setIsSaving(false);
    }
  };
```

In `handleCancel`, replace `setPendingStatusLog(null);` with `setReview(null);`.

- [ ] **Step 5: Replace the Edit button, and the old dialogs with the new one**

Replace the Edit button line

```jsx
                {canEdit && <button onClick={() => setIsEditing(true)} style={{ padding: '9px 22px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}>Edit</button>}
```

with

```jsx
                {canEdit && !editRevoked && <button onClick={() => setIsEditing(true)} style={{ padding: '9px 22px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}>Edit</button>}
                {(showViewOnly || (canEdit && editRevoked)) && (
                  <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: theme?.textDim || '#64748B' }}>
                    View only · ask an admin for edit access
                  </span>
                )}
```

Delete the `{etaCausePrompt && ( <EtaCauseDialog ... /> )}` block and the whole `{/* Status Change Reason Modal */}` block after it. Together they run from `{etaCausePrompt && (` to the `)}` just before the drawer's last `</div>`. Put this in their place:

```jsx
      {review && (
        <OrderEditReviewDialog
          theme={theme}
          dieNo={currentOrder['DIE NO']}
          changes={review.changes}
          fromEta={order.ETA}
          toEta={editedOrder.ETA}
          saving={isSaving}
          error={reviewError}
          onCancel={() => { if (!isSaving) setReview(null); }}
          onConfirm={confirmSave}
        />
      )}
```

- [ ] **Step 6: Gate the drawer on the permission**

In the `{selectedOrder && <OrderDetailModal ... />}` render (~L3336), replace `canEdit={activeTab === 'orders'}` with:

```jsx
canEdit={activeTab === 'orders' && canEditOrderDetails(user)} showViewOnly={activeTab === 'orders' && !canEditOrderDetails(user)}
```

- [ ] **Step 7: Refresh the signed-in user once on load**

Directly after the data-loading `useEffect` that ends with `}, [isLoggedIn, forcePasswordChange, fetchOrders, fetchUsers, ...]);`, add:

```js
  // The stored user is whatever sign-in returned. Re-read it once on load so a
  // permission an admin changed since then shows after a reload. Only a real
  // permission change replaces it: a new user object re-runs every loader
  // above, because fetchUsers depends on it.
  useEffect(() => {
    if (!isLoggedIn || forcePasswordChange) return undefined;
    let cancelled = false;
    authAPI.refreshUser()
      .then((fresh) => {
        if (cancelled || !fresh) return;
        setUser((prev) => (
          prev
          && prev.role === fresh.role
          && prev.canEditOrderDetails === fresh.canEditOrderDetails
          && JSON.stringify(prev.pageAccess) === JSON.stringify(fresh.pageAccess)
            ? prev
            : fresh
        ));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLoggedIn, forcePasswordChange]);
```

- [ ] **Step 8: Show cleared values in the change log, and delete the old dialog**

In `src/components/modals/ChangeLogModal.jsx`, change `{entry.new_value}` to `{entry.new_value || 'N/A'}`, so it matches how `old_value` is shown.

Delete the ETA dialog, which nothing imports any more:

```bash
git rm src/components/delivery/EtaCauseDialog.jsx
```

Check that nothing still refers to it, or to the old state:

Run: `git grep -n "EtaCauseDialog\|statusReasonModal\|pendingStatusLog\|etaCausePrompt\|needsCause" -- src/DieOrderingSystem.jsx src/components`
Expected: the only matches are in `src/components/orders/OrderEditReviewDialog.jsx` (`needsCause`) and `src/components/delivery/DeliveryFollowupDrawer.jsx` (`needsCause`).

- [ ] **Step 9: Lint, build and test**

Run: `npx eslint src/DieOrderingSystem.jsx src/components/modals/ChangeLogModal.jsx src/components/orders/OrderEditReviewDialog.jsx`
Expected: none of the reported problems are on lines this task changed. `DieOrderingSystem.jsx` already has some. Check each reported line number against `git diff -U0 src/DieOrderingSystem.jsx src/components/modals/ChangeLogModal.jsx`.

Run: `npm run build`
Expected: `✓ built in`, with no errors.

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 10: Commit**

```bash
git add -A src/DieOrderingSystem.jsx src/components/modals/ChangeLogModal.jsx src/components/delivery/EtaCauseDialog.jsx
git commit -m "feat(orders): Order Details drawer saves through Review changes, editors only

Save now opens one dialog that lists the changes, asks for a reason when an
existing value changes and for the cause when a set ETA moves. The separate
CANCELLED/HOLD and ETA pop-ups are gone. Users without the switch see a
view-only note, and the signed-in user is re-read on load so a new switch
shows after a reload.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verify on the test server

**Files:** none, unless the check finds a bug. If it does, fix it in the file concerned, re-run Task 9's Step 9 checks, and commit.

- [ ] **Step 1: Rebuild both services**

```bash
docker compose build backend frontend
```

```bash
docker compose up -d backend frontend
```

- [ ] **Step 2: Confirm the migration ran**

Run: `MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -Atc "select column_name, data_type, column_default, is_nullable from information_schema.columns where table_name='users' and column_name='can_edit_order_details'"`
Expected: `can_edit_order_details|boolean|false|NO`

Run: `MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -Atc "select count(*) filter (where can_edit_order_details) from users"`
Expected: `0`. Nobody but admins can edit until an admin switches them on.

- [ ] **Step 3: Ask the user to sign in**

There are no test-server credentials on this machine. Minting a token, or copying one between origins, is blocked, so don't try either. Ask the user to sign in as an admin on the Browser pane at `http://localhost`. If they have a non-admin test account, ask them to name it; `pwcheck` may still exist.

- [ ] **Step 4: Check the Users page** (admin session)

Open Users → **Edit** on a non-admin test account. Check that:
- A **Permissions** section with **Can edit order details** appears, switched off.
- Switching it on and saving shows an **Edits orders** badge on that row.
- For an Admin row, the switch shows on and disabled.

Switch it back off afterwards if the user doesn't want to keep it.

- [ ] **Step 5: Check the drawer** (admin session, on one order the user agrees to use for testing)

On the Orders page, open that order and click **Edit**. Check each of these:
1. Fill a blank date only, then **Save**. The dialog lists it under **No reason needed**, **Save** is enabled with no reason, and the drawer closes.
2. Change an existing value such as Supplier, then **Save**. It's listed under **Changed · needs a reason**, and **Save** stays disabled until a reason is typed.
3. Set Status to CANCELLED. No pop-up appears when you pick it. **Save** lists Status under **needs a reason**. Click **Cancel** so the order isn't really cancelled.
4. Move a set ETA. The cause picker appears inside the same dialog, and **Save** needs both the cause and the reason. Cancel this too, unless the user wants the test ETA kept.
5. Open the order's change-log (history icon). The saved fields show old → new, **Changed by** the admin, and the reason.

Put back any value you changed during the check, again with a reason such as "Reverting test edit". Tell the user exactly which order and fields were touched: it's the test server, but they work in it.

- [ ] **Step 6: Check a non-editor** (only if the user can sign in as one)

As that user, the drawer on the Orders page shows **View only · ask an admin for edit access** and no **Edit** button. The Process Flow pages still save their inline fields.

If no such account is available, say so in the report. The 403 path is covered by `orders.details.test.cjs` and `orders.test.cjs`.

- [ ] **Step 7: Report**

Give the user:
- Test counts from `npm test`.
- What was checked in the browser, with a screenshot of the Review changes dialog.
- Which test-server order and fields were touched.
- A reminder that on deploy, only admins can edit until switches are turned on.

Then use superpowers:finishing-a-development-branch to decide how to integrate. Do not push.
