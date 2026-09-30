# PDF Import Fills Blanks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A die order PDF imported for a die that already has an order fills only that order's blank fields, through the Order Details drawer route, instead of overwriting the whole row.

**Architecture:** Pure planning and apply logic in a new `src/utils/pdfImportFills.js`, reusing the drawer's `planChanges` so "blank" means what it means in the drawer. The modal shows existing dies as they will be after import and hands the hook two lists: new orders (created as today) and planned fills (saved one by one with `ordersAPI.patchDetails`, which the server re-checks and logs).

**Tech Stack:** React 18 + Vite (rolldown-vite), Express + pg backend (unchanged), `node:test`.

Spec: `docs/superpowers/specs/2026-09-30-pdf-import-fill-blanks-design.md`

## Global Constraints

- Fillable fields, exactly: `Die Size`, `Supplier`, `Press`, `Plant`, `Cavity`, `Die Requested Date`, `simulationEnabled`, `Type of shipment`, `TYPE`, `Mandrels per Cavity`, `Total Mandrels`.
- Blank = the drawer's rule: empty text/date, `0`, `false`.
- Placeholders never fill: Supplier `UNKNOWN`, Die Size `N/A`, Plant not derived from the PDF press, `Type of shipment` when the supplier is not in the supplier table.
- Existing dies are never sent to the generic `PATCH /api/orders/:id` by the PDF import.
- No backend changes.
- Frontend util imports inside `src/utils` use explicit `.js` extensions (they run under `node:test`).
- Tests: `npm test`. Lint only changed files with `npx eslint <files>` (the repo has pre-existing lint errors; `PDFImportModal.jsx` has 20 `no-useless-escape` errors before this work). Build with `npm run build`.

---

### Task 1: Plan fills for an existing die

**Files:**
- Modify: `src/utils/orderDetailEdits.js` (append one export at the end)
- Create: `src/utils/pdfImportFills.js`
- Test: `src/utils/pdfImportFills.test.js`

**Interfaces:**
- Produces: `isBlankValue(field, value) → boolean` (orderDetailEdits.js);
  `FILLABLE_FIELDS: string[]`, `FILL_NEEDS_PERMISSION: string`,
  `mergeExistingForPreview(existing, row, { plantFromPdf, shipmentFromTable }) → row`,
  `planPdfFills(existing, row) → { fields: object, labels: string[] }` (pdfImportFills.js).

- [ ] **Step 1: Write the failing tests** — `src/utils/pdfImportFills.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeExistingForPreview, planPdfFills } from './pdfImportFills.js';

// An order as the app holds it (server presentOrder shape) with some fields set.
const EXISTING = {
  id: 7, 'DIE NO': '030724-701', 'Die Size': '320X160', Supplier: 'PHME', Press: null, Plant: 'GEX 2',
  Cavity: 0, 'Die Requested Date': null, simulationEnabled: false, 'Type of shipment': 'LAND',
  TYPE: 'N', 'Mandrels per Cavity': 0, 'Total Mandrels': 0,
  'Ordered date': '2026-09-20', ETA: '2026-11-01', 'Design Received Date': '2026-09-25T00:00:00.000Z',
};
// The row the parser built from the PDF for the same die.
const PARSED = {
  id: 7, isExisting: true, 'DIE NO': '030724-701', 'Die Size': '330X160', Supplier: 'PDTMC', Press: 'P7',
  Plant: 'GEX 1', Cavity: 2, 'Die Requested Date': '2026-10-11', simulationEnabled: true,
  'Type of shipment': 'AIR', TYPE: 'N', 'Mandrels per Cavity': 0, 'Total Mandrels': 0,
  'Ordered date': null, ETA: null, 'Design Received Date': null,
};
const FROM_PDF = { plantFromPdf: true, shipmentFromTable: true };

test('set values keep the order value; blanks take the PDF value', () => {
  const row = mergeExistingForPreview(EXISTING, PARSED, FROM_PDF);
  assert.equal(row['Die Size'], '320X160');
  assert.equal(row.Supplier, 'PHME');
  assert.equal(row.Plant, 'GEX 2');
  assert.equal(row['Type of shipment'], 'LAND');
  assert.equal(row.Press, 'P7');
  assert.equal(row.Cavity, 2);
  assert.equal(row['Die Requested Date'], '2026-10-11');
  assert.equal(row.simulationEnabled, true);
});

test('a re-import plans only the blanks, never the dates, ETA or set values', () => {
  const row = mergeExistingForPreview(EXISTING, PARSED, FROM_PDF);
  const { fields, labels } = planPdfFills(EXISTING, row);
  assert.deepEqual(fields, { Press: 'P7', Cavity: 2, 'Die Requested Date': '2026-10-11', simulationEnabled: true });
  assert.deepEqual(labels, ['Press', 'Cavity', 'Die Requested Date', 'Simulation']);
});

test('parser placeholders never fill a blank', () => {
  const blank = { ...EXISTING, 'Die Size': null, Supplier: '', Plant: null, 'Type of shipment': null };
  const parsed = { ...PARSED, 'Die Size': 'N/A', Supplier: 'UNKNOWN', Plant: 'GEX 1', 'Type of shipment': 'LAND' };
  const row = mergeExistingForPreview(blank, parsed, { plantFromPdf: false, shipmentFromTable: false });
  assert.equal(row['Die Size'], null);
  assert.equal(row.Supplier, null);
  assert.equal(row.Plant, null);
  assert.equal(row['Type of shipment'], null);
  const { fields } = planPdfFills(blank, row);
  for (const field of ['Die Size', 'Supplier', 'Plant', 'Type of shipment']) {
    assert.equal(field in fields, false, field);
  }
});

test('a plant picked in the preview fills a blank plant', () => {
  const blank = { ...EXISTING, Plant: null };
  const row = { ...mergeExistingForPreview(blank, PARSED, { ...FROM_PDF, plantFromPdf: false }), Plant: 'GEX 2' };
  assert.equal(planPdfFills(blank, row).fields.Plant, 'GEX 2');
});

test('a complete order plans nothing', () => {
  const complete = {
    ...EXISTING, Press: 'P7', Cavity: 2, 'Die Requested Date': '2026-10-11T00:00:00.000Z', simulationEnabled: true,
  };
  const row = mergeExistingForPreview(complete, PARSED, FROM_PDF);
  assert.deepEqual(planPdfFills(complete, row), { fields: {}, labels: [] });
});

test('a value the drawer would refuse is left out rather than failing the plan', () => {
  const noShipment = { ...EXISTING, 'Type of shipment': null };
  const row = { ...mergeExistingForPreview(noShipment, PARSED, FROM_PDF), 'Type of shipment': 'SEA' };
  const { fields } = planPdfFills(noShipment, row);
  assert.equal('Type of shipment' in fields, false);
  assert.equal(fields.Press, 'P7');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/utils/pdfImportFills.test.js`
Expected: FAIL — `Cannot find module ... pdfImportFills.js`.

- [ ] **Step 3: Implement**

Append to `src/utils/orderDetailEdits.js`:

```js
// True when the drawer counts this value as empty, so setting it is a fill.
export function isBlankValue(field, value) {
  const { type } = EDITABLE_FIELDS[field];
  return isEmpty(type, canonical(type, value));
}
```

Create `src/utils/pdfImportFills.js`:

```js
import { fieldLabel, isBlankValue, planChanges } from './orderDetailEdits.js';

/**
 * Die order PDF import on a die that already has an order: the PDF may only
 * fill the order's blank fields. Changing a set value stays in the Order
 * Details drawer, where it needs permission and a reason. Blank is the
 * drawer's own rule (empty text or date, 0, false), so a fill here is a fill
 * there, and the drawer route re-checks it against the live row.
 */

// What the PDF or the import preview supplies that the drawer can save.
export const FILLABLE_FIELDS = Object.freeze([
  'Die Size', 'Supplier', 'Press', 'Plant', 'Cavity', 'Die Requested Date',
  'simulationEnabled', 'Type of shipment', 'TYPE', 'Mandrels per Cavity', 'Total Mandrels',
]);

export const FILL_NEEDS_PERMISSION = 'needs Order Details permission';

const EMPTY = { Cavity: 0, 'Mandrels per Cavity': 0, 'Total Mandrels': 0, simulationEnabled: false };
const emptyOf = (field) => (field in EMPTY ? EMPTY[field] : null);

// The parser's fallbacks for what the PDF did not say. They are not values.
function isPlaceholder(field, value, { plantFromPdf, shipmentFromTable }) {
  if (field === 'Supplier') return value === 'UNKNOWN';
  if (field === 'Die Size') return value === 'N/A';
  if (field === 'Plant') return !plantFromPdf;
  if (field === 'Type of shipment') return !shipmentFromTable;
  return false;
}

// The preview row for a die that already has an order: the order's value where
// it has one, otherwise what the PDF read (a placeholder shows as empty).
export function mergeExistingForPreview(existing, row, { plantFromPdf = false, shipmentFromTable = false } = {}) {
  const merged = { ...row };
  for (const field of FILLABLE_FIELDS) {
    if (!isBlankValue(field, existing[field])) merged[field] = existing[field];
    else if (isPlaceholder(field, row[field], { plantFromPdf, shipmentFromTable })) merged[field] = emptyOf(field);
  }
  return merged;
}

// The blank fields of `existing` this preview row would fill, with drawer labels.
export function planPdfFills(existing, row) {
  const fields = {};
  for (const field of FILLABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    let changes;
    try {
      changes = planChanges(existing, { [field]: row[field] });
    } catch {
      continue; // a value the drawer would refuse (e.g. shipment SEA) is not filled
    }
    if (changes.length && changes[0].kind === 'filled') fields[field] = row[field];
  }
  return { fields, labels: Object.keys(fields).map(fieldLabel) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/utils/pdfImportFills.test.js src/utils/orderDetailEdits.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/orderDetailEdits.js src/utils/pdfImportFills.js src/utils/pdfImportFills.test.js
git commit -m "feat(pdf-import): plan blank-only fills for existing orders"
```

### Task 2: Apply fills one die at a time and summarise

**Files:**
- Modify: `src/utils/pdfImportFills.js`
- Test: `src/utils/pdfImportFills.test.js`

**Interfaces:**
- Consumes: `FILL_NEEDS_PERMISSION` (Task 1).
- Produces: `applyPdfFills(items: {id, dieNo, fields}[], patchDetails(id, {fields}) → Promise) → Promise<{ filled: number, failed: {dieNo, cause}[] }>`;
  `fillSummary({ created, filled, complete, failed }) → string`.

- [ ] **Step 1: Write the failing tests** — append to `src/utils/pdfImportFills.test.js` and extend its import to
  `import { applyPdfFills, fillSummary, FILL_NEEDS_PERMISSION, mergeExistingForPreview, planPdfFills } from './pdfImportFills.js';`

```js
const httpError = (status, message, code) => Object.assign(new Error(message), { status, data: { error: message, code } });

test('fills each die in turn and keeps going after a refusal or an error', async () => {
  const calls = [];
  const patchDetails = async (id, body) => {
    calls.push([id, body]);
    if (id === 2) throw httpError(400, 'Give a reason for changing existing values', 'REASON_REQUIRED');
    if (id === 3) throw httpError(403, 'You do not have permission to edit order details', 'ORDER_EDIT_FORBIDDEN');
    if (id === 4) throw new Error('Network down');
    return { logged: 1 };
  };
  const result = await applyPdfFills([
    { id: 1, dieNo: 'A-1', fields: { Press: 'P7' } },
    { id: 2, dieNo: 'B-2', fields: { Cavity: 2 } },
    { id: 3, dieNo: 'C-3', fields: { Cavity: 1 } },
    { id: 4, dieNo: 'D-4', fields: { Cavity: 1 } },
    { id: 5, dieNo: 'E-5', fields: { Press: 'P4' } },
  ], patchDetails);
  assert.deepEqual(calls.map(([id]) => id), [1, 2, 3, 4, 5]);
  assert.deepEqual(calls[0][1], { fields: { Press: 'P7' } });
  assert.equal(result.filled, 2);
  assert.deepEqual(result.failed, [
    { dieNo: 'B-2', cause: 'changed since preview' },
    { dieNo: 'C-3', cause: FILL_NEEDS_PERMISSION },
    { dieNo: 'D-4', cause: 'Network down' },
  ]);
});

test('the summary counts each outcome and names the dies not filled', () => {
  assert.equal(
    fillSummary({ created: 4, filled: 2, complete: 10, failed: [{ dieNo: '30725-201', cause: 'changed since preview' }] }),
    'PDF import: 4 new orders created, 2 existing orders filled, 10 already complete, 1 not filled (30725-201: changed since preview)',
  );
  assert.equal(fillSummary({ created: 1, filled: 1, complete: 0, failed: [] }), 'PDF import: 1 new order created, 1 existing order filled');
  assert.equal(fillSummary({ created: 0, filled: 0, complete: 3, failed: [] }), 'PDF import: 3 already complete');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/utils/pdfImportFills.test.js`
Expected: FAIL — `applyPdfFills` / `fillSummary` not exported.

- [ ] **Step 3: Implement** — append to `src/utils/pdfImportFills.js`:

```js
function fillFailureCause(error) {
  if (error?.data?.code === 'REASON_REQUIRED') return 'changed since preview';
  if (error?.status === 403) return FILL_NEEDS_PERMISSION;
  return error?.message || 'save failed';
}

// Saves each planned fill on its own through the drawer route (`patchDetails` is
// ordersAPI.patchDetails); one refusal or error never stops the rest.
export async function applyPdfFills(items, patchDetails) {
  let filled = 0;
  const failed = [];
  for (const { id, dieNo, fields } of items) {
    try {
      await patchDetails(id, { fields });
      filled += 1;
    } catch (error) {
      failed.push({ dieNo, cause: fillFailureCause(error) });
    }
  }
  return { filled, failed };
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function fillSummary({ created = 0, filled = 0, complete = 0, failed = [] }) {
  const parts = [];
  if (created) parts.push(`${count(created, 'new order', 'new orders')} created`);
  if (filled) parts.push(`${count(filled, 'existing order', 'existing orders')} filled`);
  if (complete) parts.push(`${complete} already complete`);
  if (failed.length) parts.push(`${failed.length} not filled (${failed.map((f) => `${f.dieNo}: ${f.cause}`).join('; ')})`);
  return `PDF import: ${parts.join(', ') || 'nothing to change'}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/utils/pdfImportFills.test.js`
Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfImportFills.js src/utils/pdfImportFills.test.js
git commit -m "feat(pdf-import): apply fills per die and summarise the import"
```

### Task 3: Hook runs the fills after creating new orders

**Files:**
- Modify: `src/hooks/usePIImport.js` (imports; `handlePIImport` options and tail)

**Interfaces:**
- Consumes: `applyPdfFills`, `fillSummary`, `FILL_NEEDS_PERMISSION` (Tasks 1–2); `ordersAPI.patchDetails` (src/api.js).
- Produces: `handlePIImport(newRecords, { pdfFills: { items, canFill, complete } })`. Without `pdfFills` behaviour is unchanged (PI import).

- [ ] **Step 1: Implement**

Add the import:

```js
import { applyPdfFills, fillSummary, FILL_NEEDS_PERMISSION } from '../utils/pdfImportFills';
```

Extend the options comment and destructuring:

```js
    // pdfFills: PDF import only — { items, canFill, complete }. Existing dies are not in
    //   importData; their planned blank fills are saved through the drawer route instead.
    const { resolveCustomers = true, restrictUpdateFields = null, pdfFills = null } = options;
```

Replace the block from `await fetchOrders();` to the end of the `try` with:

```js
      let fillResult = null;
      if (pdfFills) {
        fillResult = pdfFills.canFill
          ? await applyPdfFills(pdfFills.items, ordersAPI.patchDetails)
          : { filled: 0, failed: pdfFills.items.map(({ dieNo }) => ({ dieNo, cause: FILL_NEEDS_PERMISSION })) };
      }

      await fetchOrders();
      setCurrentPage(1);

      if (fillResult) {
        const notFilled = fillResult.failed.length > 0;
        setToast({
          message: fillSummary({ created, filled: fillResult.filled, complete: pdfFills.complete, failed: fillResult.failed }),
          type: notFilled ? 'warning' : 'success',
        });
        setTimeout(() => setToast(null), notFilled ? 10000 : 5000);
        return;
      }

      const messages = [];
      if (created > 0) messages.push(`${created} new order(s) created`);
      if (updated > 0) messages.push(`${updated} order(s) updated`);
      const msg = `PI Import successful: ${messages.join(', ')}`;
      setToast({ message: msg, type: 'success' });
      setTimeout(() => setToast(null), 5000);
```

- [ ] **Step 2: Verify**

Run: `npx eslint src/hooks/usePIImport.js` → no problems. `npm test` → 0 fail.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePIImport.js
git commit -m "feat(pdf-import): save planned fills through the drawer route after creating new orders"
```

### Task 4: Modal shows and plans fills; app passes the permission

**Files:**
- Modify: `src/components/modals/PDFImportModal.jsx`
- Modify: `src/DieOrderingSystem.jsx` (the `<PDFImportModal …/>` line)

**Interfaces:**
- Consumes: `isBlankValue` (Task 1), `mergeExistingForPreview`, `planPdfFills` (Task 1), `handlePIImport` options (Task 3).
- Produces: prop `canFillExisting: boolean` on `PDFImportModal`.

- [ ] **Step 1: Imports and prop**

```js
import { isBlankValue } from '../../utils/orderDetailEdits';
import { mergeExistingForPreview, planPdfFills } from '../../utils/pdfImportFills';
```

Signature: `const PDFImportModal = ({ onClose, onImportRecords, existingOrders = [], suppliers = [], canFillExisting = false, theme = {} }) => {`

- [ ] **Step 2: Build existing rows from the order** — in `parseSinglePDF`, replace `const orders = [mainOrder];` with:

```js
    // A die that already has an order: show the order's values and let the PDF
    // fill only its blanks (planned at import time from this row).
    const fillFlags = { plantFromPdf: !!plantFromPress, shipmentFromTable: !!supplierRecord };
    const withExisting = (row, existing) => (existing
      ? { ...mergeExistingForPreview(existing, row, fillFlags), _existing: existing }
      : row);

    const orders = [withExisting(mainOrder, existingOrder)];
```

and in `createSubOrder` replace `return subOrder;` with `return withExisting(subOrder, existingSub);`.

- [ ] **Step 3: Preview helpers** — inside the component, before `return (`:

```js
  // Why an existing die's field can't be edited in the preview, or null when it can.
  const lockReason = (order, field) => {
    if (!order._existing) return null;
    if (!canFillExisting) return 'Needs Order Details permission';
    return isBlankValue(field, order._existing[field]) ? null : 'Already set — change it in Order Details';
  };

  // The line under an existing die: what the import will fill, if anything.
  const fillNote = (order) => {
    const { labels } = planPdfFills(order._existing, order);
    if (labels.length === 0) return { text: 'Already complete — nothing to change', active: false };
    if (!canFillExisting) return { text: 'Not changed — needs Order Details permission', active: false };
    return { text: `Will fill: ${labels.join(', ')}`, active: true };
  };

  const lockedStyle = (locked) => (locked ? { opacity: 0.55, cursor: 'not-allowed' } : {});
```

- [ ] **Step 4: Summary box, badge, note** — replace the "already exist and will be updated" paragraph with:

```jsx
                  {preview.orders.some(o => o._existing) && (
                    <p style={{ fontSize: '0.75rem', color: '#F59E0B', marginTop: '4px' }}>
                      {preview.orders.filter(o => o._existing).length} order(s) already exist
                      {canFillExisting
                        ? ' — only their blank fields are filled; values already set are kept'
                        : ' and will not be changed — filling their blanks needs Order Details permission'}
                    </p>
                  )}
```

Change the row badge text `UPDATE` to `EXISTING`. After the `_reorderNote` span in the Die No cell, add:

```jsx
                              {order._existing && (() => {
                                const note = fillNote(order);
                                return (
                                  <span style={{ fontSize: '0.65rem', color: note.active ? '#F59E0B' : theme.textMuted, fontFamily: 'inherit', whiteSpace: 'normal', maxWidth: '220px' }}>
                                    {note.text}
                                  </span>
                                );
                              })()}
```

- [ ] **Step 5: Lock set fields** — on the Plant select, Type select, Cavity input and Mandrels/Cav input add
  `disabled={!!lockReason(order, '<field>')}` and `title={lockReason(order, '<field>') || undefined}`, and spread
  `...lockedStyle(!!lockReason(order, '<field>'))` into their `style`, with `<field>` = `Plant`, `TYPE`, `Cavity`,
  `Mandrels per Cavity`. In the Cavity and Mandrels/Cav `onChange` handlers, only include `'Total Mandrels'` in the
  edit when `!lockReason(order, 'Total Mandrels')`. Shipment badge text becomes `{order['Type of shipment'] || '—'}`.

- [ ] **Step 6: Import splits new orders from fills** — in `handleImportAll` replace the body of the `try` with:

```js
        // Existing dies never go through the generic update: only their blank fields are filled.
        const newOrders = preview.orders.filter((order) => !order._existing).map((order) => {
          const cleanOrder = { ...order };
          delete cleanOrder._urgency;
          delete cleanOrder._componentType;
          delete cleanOrder._isRevision;
          delete cleanOrder._cavity;
          delete cleanOrder._reorderNote;
          delete cleanOrder._existing;
          return cleanOrder;
        });
        const planned = preview.orders
          .filter((order) => order._existing)
          .map((order) => ({ id: order.id, dieNo: order['DIE NO'], fields: planPdfFills(order._existing, order).fields }));
        const items = planned.filter((p) => Object.keys(p.fields).length > 0);
        await onImportRecords(newOrders, { pdfFills: { items, canFill: canFillExisting, complete: planned.length - items.length } });
        onClose();
```

- [ ] **Step 7: Pass the permission** — in `src/DieOrderingSystem.jsx` add `canFillExisting={canEditOrderDetails(user)}` to `<PDFImportModal … />`.

- [ ] **Step 8: Verify**

Run: `npx eslint src/components/modals/PDFImportModal.jsx src/DieOrderingSystem.jsx` → only the pre-existing errors (20 `no-useless-escape` in the modal; compare against `git show HEAD:<file> | npx eslint --stdin --stdin-filename <file>`).
Run: `npm run build` → succeeds.
Run the Node harness (scratchpad `harness/run.mjs`) on the 15 PDFs with a fake existing order for `030724-701` (dates, ETA, Supplier set; Press blank) and one for `25IC2-030724` (complete): the first row keeps the set values and plans only blanks; the second plans nothing.

- [ ] **Step 9: Commit**

```bash
git add src/components/modals/PDFImportModal.jsx src/DieOrderingSystem.jsx
git commit -m "feat(pdf-import): existing dies show what the PDF fills and keep set values"
```

### Task 5: Final verification

- [ ] `npm test` → 0 fail. `npm run build` → succeeds.
- [ ] `git log --oneline fix/pdf-import-insert-no..HEAD` shows spec, plan and the four task commits.
