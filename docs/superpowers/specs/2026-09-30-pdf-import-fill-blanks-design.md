# PDF Import Fills Blanks on Existing Orders — Design

Date: 2026-09-30 · Branch: `fix/pdf-import-fill-blanks` (from `fix/pdf-import-insert-no` at `4e4d7c0`)

## Problem

When the die order PDF import (`src/components/modals/PDFImportModal.jsx`) finds a die that
already has an order, it marks the row UPDATE and `handlePIImport` (`src/hooks/usePIImport.js`)
sends the **whole** parsed row to the generic `PATCH /api/orders/:id`. That route writes every
field present in the body, so a re-import:

1. **Blanks** Ordered date, Design Received / 3D Model / Design Approved dates, PR Entry and
   Oracle Entry, and resets Delay and Overall Delay to 0 (the row carries `null`/`0` for them).
2. **Fails part-way** when the die has an ETA: the row sends `ETA: null`, the ETA rule refuses
   clearing a set ETA without a cause (`ETA_CAUSE_REQUIRED`), `handlePIImport` throws, and the
   orders before it in the batch are already written.
3. **Overwrites real values with placeholders** when the PDF could not read a field: Supplier
   `UNKNOWN`, Die Size `N/A`, Plant default `GEX 1`, shipment default `LAND`.
4. **Completes the die's pending backup requests** with today's date, because the body carries
   `DIE NO` and the route calls `autoUpdateBackupRequests`.

Existing inserts/bolsters found by the import (sub-orders) have the same problem.

## Decisions (confirmed with the user)

1. A PDF may only **fill blanks** on an existing order. Nothing already set is changed; real
   changes go through the Order Details drawer, with its permission and reason rule.
2. Fills go through the **drawer's save route** `PATCH /api/orders/:id/details`, so the server
   checks them against the live row, refuses to change a set value without a reason, and logs
   every fill in `order_changes` under the importing user.
3. Filling blanks therefore needs **"Can edit order details"** (admins always have it). Users
   without it can still import: new orders are created and existing dies are left untouched.

## Definitions

- **Blank** is the drawer's definition (`planChanges` in `src/utils/orderDetailEdits.js`):
  empty text or date, `0` for whole numbers, `false` for yes/no. So a PDF whose 3D simulation
  says *Required* fills an order whose simulation is off.
- **Fillable fields** — what the PDF or the preview supplies and the drawer can save:
  `Die Size`, `Supplier`, `Press`, `Plant`, `Cavity`, `Die Requested Date`, `simulationEnabled`,
  `Type of shipment`, `TYPE`, `Mandrels per Cavity`, `Total Mandrels`.
- **Placeholders are not values**: Supplier `UNKNOWN`, Die Size `N/A`, a Plant not derived from
  the PDF's press, and `Type of shipment` when the supplier is not in the supplier table.
  A placeholder never fills anything. A value the user picks in the preview is a real value.

## Design

### Preview (existing dies)

- The row shows the order **as it will be after import**: a field already set on the order
  shows the order's value; a blank field shows the PDF's value (or nothing, for a placeholder).
- Inputs for already-set fields (Plant, Type, Cavity, Mandrels/Cav) are **disabled**, titled
  "Already set — change it in Order Details". Inputs for blank fields stay editable.
- Under the die number: **"Will fill: Press, Cavity, Req Date"** (drawer labels) or
  **"Already complete — nothing to change"**.
- Without the edit permission, the summary box says existing dies will not be changed and only
  new orders will be created; existing rows say "Not changed — needs Order Details permission".

### Import

1. New orders (including a CANCELLED die re-ordered with a new supplier) are created exactly as
   today through `handlePIImport`.
2. For each existing die, the fills are planned from its current preview row against the order
   it matched: `planChanges(existing, fillableFieldsOf(row))`, keeping only `filled` changes.
3. A die with nothing to fill sends no request.
4. Otherwise `ordersAPI.patchDetails(id, { fields: fills })` with no reason. The server
   re-plans against the locked row; if a value was set since the preview it refuses with
   `REASON_REQUIRED` and nothing on that order changes.
5. Each die is saved on its own: one refusal or error never stops the others.
6. One toast summarises: new orders created, existing orders filled, already complete, and
   not filled with the die number and a short cause (changed since preview / no permission /
   the server's message).
7. Without the permission, no fill requests are sent at all; dies that had something to fill
   are counted as not filled with the cause "needs Order Details permission".
8. If creating a new order fails, the import stops with an error as it does today, before any
   fills run, so a retry never meets half-filled orders from the same batch.

`month` is not a drawer field, so filling Die Requested Date does not set it. Nothing in the
UI reads `month`; accepted.

### Units

- `src/utils/pdfImportFills.js` (pure, tested):
  - `mergeExistingForPreview(existing, parsedRow, { plantFromPdf, shipmentFromTable })` → the row
    to show: set fields keep the order's value, blanks take the PDF value unless it is a
    placeholder.
  - `planPdfFills(existing, row)` → `{ fields, labels }` of blank fields the row would fill.
  - `applyPdfFills(items, patchDetails)` → saves each `{ id, dieNo, fields }` in turn, never
    throwing; returns `{ filled, failed: [{ dieNo, cause }] }`.
  - `fillSummary({ created, filled, complete, failed })` → the toast text.
- `PDFImportModal.jsx`: builds existing rows with `mergeExistingForPreview`, renders the
  "Will fill" line and disabled inputs, and on Import passes new orders and planned fills
  separately.
- `usePIImport.js`: `handlePIImport` accepts `options.pdfFills = { items, canFill, complete }`
  (the planned fills, the user's permission, and how many existing dies had nothing to fill);
  creates new orders as today, then runs `applyPdfFills`, refreshes orders once, and shows the
  summary toast.
- `DieOrderingSystem.jsx`: passes `canEditOrderDetails(user)` to the modal.

## Testing

- `node:test` for every function in `pdfImportFills.js`: set values kept, blanks filled, `0`
  and `false` are blank, each placeholder ignored, user-picked Plant fills, dates compared by
  day, nothing-to-fill yields no fields; `applyPdfFills` with a fake `patchDetails` covering
  success, `REASON_REQUIRED`, 403 and a thrown error, continuing after each.
- Existing suites stay green (`npm test`); `npx eslint` on changed files; `npm run build`.
- The Node harness that runs the real `parseSinglePDF` on the user's 15 PDFs, with a fake
  existing order that has dates, an ETA and set values, to show the preview rows keep them.

## Out of scope

- Changing set values from a PDF (use the drawer).
- The PI import, which already restricts its updates to five fields.
- Filling Customer Name on existing orders.
