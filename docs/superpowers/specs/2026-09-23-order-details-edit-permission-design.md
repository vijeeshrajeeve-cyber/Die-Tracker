# Order Details Edit Permission — Design

Date: 2026-09-23 · Branch: `feat/order-details-edit-permission` (from `main` at `0d771d1`)

## Problem

The **Order Details** drawer (`OrderDetailModal` in `src/DieOrderingSystem.jsx`) shows **Edit**
to anyone who can open the Orders page. The server checks page access and nothing more, so
there is no way to limit who may change an order's values.

Edits are also barely recorded. Only a status change to CANCELLED or HOLD asks for a reason
and writes a change-log entry. Every other drawer edit (dates, supplier, plant, cavity and
so on) is saved through the generic `PATCH /api/orders/:id` with **no** `order_changes` row,
so nobody can later tell who changed what, or why.

## Decisions (confirmed with the user)

1. Enforcement is **server-side** (Architecture A): the drawer gets its own guarded save
   route, and the server works out what changed and writes the log.
2. Who may edit is chosen **per user on the Users page**: a "Can edit order details" switch
   in the Add/Edit User form. **Admins can always edit.**
3. A reason is required **only when an existing value is changed or cleared**. Filling a field
   that was empty needs no reason, but is still logged.
4. One reason per save covers every change in that save.
5. **Rollout:** the switch defaults to off. On the day this ships only admins can edit, until
   an admin switches it on for the chosen people.
6. The step-by-step pages keep working as they do today and are **not** restricted: Process
   Flow inline edits, Sample Followup, die receipt and PI import all keep using the generic
   `PATCH /api/orders/:id`, and already write their own change-log entries.

## The permission

- New column `users.can_edit_order_details BOOLEAN NOT NULL DEFAULT false`. It is kept out of
  `page_access` on purpose: a `NULL` `page_access` means "all pages", so a capability stored
  there would quietly be granted to every unrestricted user.
- `canEditOrderDetails(user)` is true when `user.role === 'admin'` or the column is true.
- `authMiddleware` (`server/routes/auth.cjs`) already re-reads the user row on every request;
  it also reads the new column into `req.user.canEditOrderDetails`. Switching a user on or off
  therefore applies on that user's next request, with no sign-out.
- Sign-in, `/auth/me` and the password-change responses include `canEditOrderDetails`, so the
  client knows whether to offer **Edit**.
- `server/routes/users.cjs` (admin-only) returns `can_edit_order_details` in the user list and
  accepts it on create and on update. It is stored as `false` for admins, whose access comes
  from the role.

### Users page

The Add/Edit User form (`src/components/modals/AddUserModal.jsx`) gets a **Permissions**
section below Page access with one switch, **Can edit order details**, and the hint "Opens Edit
in the Order Details drawer. A reason is required when changing existing values." For the
Admin role the switch shows on and disabled.

## The drawer

- `canEdit` becomes `activeTab === 'orders' && canEditOrderDetails(user)`. The drawer stays
  read-only on every other tab, exactly as today.
- A user without the permission sees the drawer read-only, with a small **View only · ask an
  admin for edit access** label where **Edit** would be.
- **Freeze / Final Design** is unchanged. It is governed by the Frozen Designs page access, not
  by this permission.
- The attachment upload boxes (Die Order Form, Die Design PDF) are unchanged. Files picked there
  are never persisted today (no route saves `dieOrderFile` / `designFile`), so they are not
  counted as edits. Flagged separately.

### Save flow

1. **Save** with nothing changed leaves edit mode and sends nothing.
2. Otherwise the client builds the change list with `src/utils/orderDetailEdits.js` and opens
   **Review changes** (`src/components/orders/OrderEditReviewDialog.jsx`):
   - **Changed** lists fields that had a value, as `old → new` (clearing counts here).
   - **Newly filled** lists fields that were empty.
   - **Reason** (textarea, up to 500 characters) is required when the reason rule below says
     so. **Save** stays disabled until it has non-blank text. Otherwise it is optional.
   - **ETA cause.** When the ETA moves off a date it already had (`needsCause` from
     `src/utils/deliveryFollowup.js`), the cause picker (cause + note, `other` needs a note)
     appears inside this dialog. The standalone `EtaCauseDialog` is no longer used by the
     drawer; it stays for the delivery drawer.
3. Confirming sends `PATCH /api/orders/:id/details` with only the changed fields.
4. On success the drawer shows the order the server returns and adds the number of logged
   fields to `changeCount`.
5. On 403 `ORDER_EDIT_FORBIDDEN` the drawer shows "You no longer have permission to edit order
   details", drops the edits and returns to view-only. On 400 the server's message is shown
   and the dialog stays open, so nothing is lost.

The separate **Reason Required** pop-up that appears when Status is set to CANCELLED or HOLD is
removed from the drawer. The review dialog asks for that reason instead, so the editor is never
asked twice.

## The reason rule

Each changed field is classified by comparing the stored value with the new one:

| Kind | Stored | New | Needs a reason? |
|------|--------|-----|-----------------|
| `filled` | empty | value | No |
| `changed` | value | different value | **Yes** |
| `cleared` | value | empty | **Yes** |

**Status is the exception.** The drawer derives Status from the dates as they are filled in
(`determineStatus`), so an automatic status step would otherwise demand a reason for simply
filling a blank date. For `STATUS`:

- A change **to or from `CANCELLED` or `HOLD`** needs a reason.
- Any other status change is logged but needs no reason on its own.

A save needs a reason when any field in it needs one.

### What "empty" and "the same" mean

Values are normalised before comparing, so an untouched field never shows up as a change:

- `null`, `undefined`, `''` and whitespace-only strings are all **empty**.
- **Date columns** (`Die Requested Date`, `Ordered date`, `Design Received Date`,
  `3D Model Received Date`, `Design Approved Date`, `Die Received Date`, `Submission Date`,
  `Sample Approval Date`) compare as `YYYY-MM-DD`, using the same parsing as the order route's
  `sanitizeDate`.
- **Date-like text columns** (`PR Entry`, `Oracle Entry`, `ETA`) compare as `YYYY-MM-DD` when
  both sides parse as dates, and as trimmed text otherwise. Legacy values such as `TBC` must not
  be lost.
- **Integers** (`Cavity`, `Mandrels per Cavity`, `Total Mandrels`, `No of Trial`) compare as
  rounded numbers. **`0` counts as empty**, because these columns default to 0 for "not set
  yet". Entering a first cavity count is `filled`; setting it back to 0 is `cleared`.
- **Yes/no** (`simulationEnabled`, `specialFollowUp`) compare as booleans. **`false` counts as
  empty**, for the same reason. Switching one on is `filled`; switching it off is `cleared`.
- **Urgency** compares after `normalizeUrgencyInput`. Every order has one (the default is
  NORMAL), so any urgency change is `changed` and needs a reason.
- Other text compares as trimmed text.

The server copy (`server/services/orderDetailEdits.cjs`) is the authority. The client copy
(`src/utils/orderDetailEdits.js`) only builds the dialog. A test fails if the two ever classify
the same input differently, following the `src/utils/trials.test.js` pattern.

## The server route

`PATCH /api/orders/:id/details` in `server/routes/orders.cjs`

**Body:** `{ fields: { <drawer field>: value, ... }, reason?: string, etaChange?: { cause, note } }`

**Editable fields** (the drawer's own; anything else is a 400): `Plant`, `TYPE`, `Die Size`,
`Cavity`, `Mandrels per Cavity`, `Total Mandrels`, `Type of shipment`, `Supplier`,
`Customer Name`, `PR Number`, `Press`, `simulationEnabled`, `Urgency`, `specialFollowUp`,
`STATUS`, `Die Requested Date`, `Design Received Date`, `3D Model Received Date`,
`Design Approved Date`, `PR Entry`, `Oracle Entry`, `Ordered date`, `ETA`,
`Die Received Date`, `Submission Date`, `Sample Approval Date`, `No of Trial`, `Corrector`.

**Steps:**

1. 403 `{ code: 'ORDER_EDIT_FORBIDDEN' }` unless `canEditOrderDetails(req.user)`.
2. 400 when `fields` is missing or empty, names a field outside the list, has an invalid
   `STATUS` / `TYPE` / shipment type, has an integer out of range, or `reason` is over 500
   characters.
3. In one transaction: `SELECT … FOR UPDATE` the order (404 if it does not exist). Sanitise the
   incoming values with the route's existing sanitisers and diff them against the stored row.
4. No real change: write nothing, roll back, and answer 200 with the unchanged order and
   `logged: 0`.
5. Apply the reason rule. If it needs a reason and `reason` is blank: 400
   `{ code: 'REASON_REQUIRED', fields: [...] }`.
6. ETA: run the existing `planEtaChange(stored, incoming, etaChange)` and `insertEtaEvent`.
   A move without a cause gives the existing 400 `ETA_CAUSE_REQUIRED`.
7. `UPDATE die_orders` with only the changed columns, plus `updated_at`.
8. Insert one `order_changes` row per changed field: `field_name`, `old_value` (from the
   database, not the client), `new_value`, `reason` (the save's reason, on every row of that
   save), `user_id`, `changed_by_name`, `stage` (the status before the save) and
   `changed_at = now()`.
9. Commit. When `Ordered date` was filled, run the existing `autoUpdateBackupRequests` with the
   stored `die_no`, as the generic PATCH does today.
10. Answer 200 with `{ order: presentOrder(row), logged: n }`.

**`PUT /api/orders/:id`** (full replace) gets the same 403 check. Nothing in the app calls it
(`ordersAPI.update` has no callers), but today it can rewrite a whole order.

**Client API:** `ordersAPI.patchDetails(id, { fields, reason, etaChange })` in `src/api.js`.

## Database

- `server/db.cjs`: an idempotent `DO $$ … IF NOT EXISTS … ALTER TABLE users ADD COLUMN
  can_edit_order_details BOOLEAN NOT NULL DEFAULT false` block, in the same style as the other
  `users` migrations.
- `init.sql`: the same column on `CREATE TABLE users`.
- `order_changes` is unchanged; it already has `reason` and `stage`.

## Testing

- `server/services/orderDetailEdits.test.cjs`: normalisation (empties, dates in every accepted
  format, date-like text including `TBC`, integers with 0 as empty, booleans with false as
  empty, urgency), the three
  kinds, the Status rule (to and from CANCELLED/HOLD vs. an ordinary step), and "needs a reason"
  for mixed saves.
- `src/utils/orderDetailEdits.test.js`: the client copy agrees with the server copy on a shared
  table of cases.
- `server/routes/orders.test.cjs`, with the fake `db.cjs` from `server/routes/testSupport.cjs`:
  403 for a non-editor; 200 for an editor and an admin; 400 for an unknown field; 400
  `REASON_REQUIRED` when changing an existing value without a reason; a filled-only save needs
  none; one `order_changes` row per field with the database's old value; 404 for a missing
  order; the ETA cause is still enforced; `PUT` is refused for a non-editor.
- `server/routes/users.test.cjs`: the switch round-trips on create and update, and is stored as
  `false` for admins.
- `server/routes/auth.test.cjs`: `canEditOrderDetails` is present in the sign-in and `/auth/me`
  responses.
- `src/api.test.js`: `patchDetails` sends the right method, path and body.
- Frontend: `npx eslint` on the changed files and `npm run build` (the repo-wide lint has known
  pre-existing failures). Then a browser check on the **test server** with an editor, a
  non-editor and an admin, covering: Edit hidden for the non-editor; a filled-only save with no
  reason; a changed value blocked until a reason is given; CANCELLED asks for a reason once;
  an ETA move asks for the cause in the same dialog; and the reasons appearing in the change log.

## Out of scope (flagged separately)

- `DELETE /api/orders/:id` has no admin check on the server. The UI hides Delete from
  non-admins, but anyone with Orders access can delete an order through the API.
- The drawer's attachment upload boxes never persist the chosen file.
- Restricting the Process Flow inline edits or the generic `PATCH /api/orders/:id`.
- Detecting that someone else saved the same order while the drawer was open. The log always
  records the database's old value, so the history stays correct either way.
