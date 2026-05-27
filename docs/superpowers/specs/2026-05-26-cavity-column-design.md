# Cavity Column — Display, Edit & Change Log

**Date:** 2026-05-26

## Goal

Show the `Cavity` (number of cavities) field in the Orders page, Design Approval tab, and PR tab. Allow editing it from the Design Approval tab with a required reason, persisted to the change log.

---

## Affected Files

| File | Change |
|---|---|
| `src/pages/OrdersPage.jsx` | Add read-only `Cav` column after Thickness |
| `src/pages/FlowPage.jsx` | Add `Cav` column; editable + popover for Design Approval; read-only for PR |
| `src/DieOrderingSystem.jsx` | Add `handleCavityChange` handler; pass it to `FlowPage` |

No server or DB changes required — `cavity` column and `order_changes.reason` already exist.

---

## Column Placement

Insert after **Thickness** column on all three views.

| View | Editable |
|---|---|
| Orders page | No |
| Design Approval tab (`PENDING FOR DESIGN APPROVAL`) | Yes — inline input + reason popover |
| PR tab (`PENDING FOR PR`) | No |

---

## Edit Flow (Design Approval tab)

1. Cavity renders as `<input type="number">` — same style as existing Diameter/Thickness inputs. Use a dedicated `isDesignApproval` flag (`currentFlow.status === 'PENDING FOR DESIGN APPROVAL'`) rather than `isSimOrApproval`, so Cavity is NOT editable on the Simulation tab.
2. On **blur**, if value differs from `order['Cavity']`: capture `{ order, newValue, rect: inputEl.getBoundingClientRect() }` into `cavityEdit` state local to `FlowPage`.
3. A **popover** renders fixed-positioned, anchored below the input:
   - Summary line: `Old → New`
   - `<textarea>` for reason (placeholder "Reason for change…")
   - **Save** button (disabled until reason is non-empty) and **Cancel** button
4. **Cancel**: clears `cavityEdit`; input reverts visually on next render.
5. **Save**:
   - Calls `handleCavityChange(order, newValue, reason)` (defined in `DieOrderingSystem.jsx`, passed as prop)
   - Recalculates `Total Mandrels = (order['Mandrels per Cavity'] || 0) * newValue`
   - Builds change log entry: `{ date, field: 'Cavity', oldValue, newValue, changedBy, stage, reason }`
   - Calls `ordersAPI.update(order.id, { ...updatedOrder, 'Change Log': [entry] })`
   - Updates local `data` state; shows success toast
   - Clears `cavityEdit`

---

## handleCavityChange (DieOrderingSystem.jsx)

```js
const handleCavityChange = async (order, newCavity, reason) => {
  const oldValue = order['Cavity'] || 0;
  if (oldValue === newCavity) return;
  const changeLogEntry = {
    date: new Date().toISOString().split('T')[0],
    field: 'Cavity',
    oldValue,
    newValue: newCavity,
    changedBy: user?.username || 'unknown',
    stage: order.STATUS,
    reason,
  };
  const totalMandrels = (order['Mandrels per Cavity'] || 0) * newCavity;
  const updatedOrder = {
    ...order,
    'Cavity': newCavity,
    'Total Mandrels': totalMandrels,
    'Change Log': [changeLogEntry],
  };
  await ordersAPI.update(order.id, updatedOrder);
  setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
};
```

---

## Popover Component

Local to `FlowPage.jsx` — no new file needed. State:

```js
const [cavityEdit, setCavityEdit] = useState(null);
// null | { order, newValue, rect: DOMRect }
```

Popover is a `<div>` with `position: fixed`, `top: rect.bottom + 8`, `left: rect.left`, `zIndex: 2000`.

Contains:
- Summary: `{old} → {newValue}` (monospace, coloured red→green)
- `<textarea>` bound to local `reason` state
- Save button (disabled when reason is empty)
- Cancel button

---

## Change Log

No changes to `ChangeLogModal.jsx` or server routes. The `reason` field is already displayed in the modal.

---

## Side Effect: Total Mandrels Recalculation

When Cavity changes, `Total Mandrels` is recalculated as `Mandrels per Cavity × new Cavity` and saved in the same update. This keeps the ERP copy string (`CAV n`) accurate.
