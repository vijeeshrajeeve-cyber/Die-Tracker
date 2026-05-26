# Cavity Column — Display, Edit & Change Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the `Cavity` field in Orders, Design Approval, and PR pages; allow inline editing from Design Approval with a reason popover that writes to the change log.

**Architecture:** All logic lives in three existing files. `handleCavityChange` is defined in `DieOrderingSystem.jsx` (matches the pattern of `handleSizeChange`) and passed as a prop to `FlowPage`. The popover is a local state component inside `FlowPage` — no new files needed.

**Tech Stack:** React (Vite), uncontrolled inputs (`defaultValue`), PostgreSQL via existing `ordersAPI.update` + `order_changes` table.

> **No test framework** is configured in this project. TDD steps are replaced with manual browser verification via `npm run dev` + `npm run server:dev`.

---

## File Map

| File | What changes |
|---|---|
| `src/DieOrderingSystem.jsx` | Add `handleCavityChange` handler; add it to `<FlowPage>` props |
| `src/pages/FlowPage.jsx` | Add `handleCavityChange` to props destructure; add `isDesignApproval` flag; add `cavityEdit`/`cavityReason` state; add Cav column to columns array; add Cav cell to row (editable for Design Approval, read-only otherwise); add popover JSX |
| `src/pages/OrdersPage.jsx` | Add read-only Cav column header + cell after Thickness |

---

## Task 1: Add `handleCavityChange` to DieOrderingSystem.jsx

**Files:**
- Modify: `src/DieOrderingSystem.jsx` — two locations

### Steps

- [ ] **Step 1: Add the handler after `handleMandrelsChange` (ends around line 1851)**

Find the block ending:
```js
    setToast({ message: `Mandrels updated: ${mpc}/cav, ${totalMandrels} total`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('Mandrels update error:', error);
      setToast({ message: 'Failed to save mandrels', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };
```

Insert immediately after it:
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
    try {
      await ordersAPI.update(order.id, updatedOrder);
      setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
      setToast({ message: `Cavity updated: ${oldValue} → ${newCavity}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setToast({ message: 'Failed to update cavity: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };
```

- [ ] **Step 2: Pass `handleCavityChange` as a prop to `<FlowPage>`**

Find (around line 2510–2511):
```jsx
              handleInlineFieldSave={handleInlineFieldSave} handleSizeChange={handleSizeChange}
              handleMandrelsChange={handleMandrelsChange} handlePRNumberChange={handlePRNumberChange}
```

Replace with:
```jsx
              handleInlineFieldSave={handleInlineFieldSave} handleSizeChange={handleSizeChange}
              handleMandrelsChange={handleMandrelsChange} handlePRNumberChange={handlePRNumberChange}
              handleCavityChange={handleCavityChange}
```

- [ ] **Step 3: Commit**

```bash
git add src/DieOrderingSystem.jsx
git commit -m "feat: add handleCavityChange handler and wire to FlowPage"
```

---

## Task 2: Add read-only Cav column to OrdersPage.jsx

**Files:**
- Modify: `src/pages/OrdersPage.jsx` — columns array + row cell

### Steps

- [ ] **Step 1: Add Cav to the columns array (around line 118)**

Find:
```js
                  { key: 'Thickness', label: 'T' },
                  { key: 'Supplier', label: 'Supplier' },
```

Replace with:
```js
                  { key: 'Thickness', label: 'T' },
                  { key: 'Cavity', label: 'Cav' },
                  { key: 'Supplier', label: 'Supplier' },
```

- [ ] **Step 2: Add Cav cell in the row after the Thickness cell (around line 152)**

Find:
```jsx
                  <td style={td}><span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span></td>
                  <td style={td}>{order.Supplier}</td>
```

Replace with:
```jsx
                  <td style={td}><span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span></td>
                  <td style={td}><span style={{ fontFamily: 'monospace' }}>{order['Cavity'] || '—'}</span></td>
                  <td style={td}>{order.Supplier}</td>
```

- [ ] **Step 3: Verify manually**

Start the app (`npm run dev` + `npm run server:dev`). Open the **Orders** page. Confirm:
- A `Cav` column appears between `T` and `Supplier`
- Orders with a cavity value (imported from PDF) show the number; others show `—`

- [ ] **Step 4: Commit**

```bash
git add src/pages/OrdersPage.jsx
git commit -m "feat: add read-only Cav column to Orders page"
```

---

## Task 3: Add Cav column + cells to FlowPage.jsx (all tabs)

**Files:**
- Modify: `src/pages/FlowPage.jsx`

This task adds the column header and read-only display. Task 4 adds the editable input and popover specifically for Design Approval.

### Steps

- [ ] **Step 1: Add `handleCavityChange` to the FlowPage props destructure (line 71–76)**

Find:
```js
export default function FlowPage({
  data, activeTab, searchTerm, setSearchTerm, sortConfig, handleSort, suppliers, theme,
  setSelectedOrder, setShowAddOrderModal, setRevisionOrder, setChangelogOrder,
  setData, setToast, setActiveTab,
  handleInlineFieldSave, handleSizeChange, handleMandrelsChange, handlePRNumberChange, copyForERP,
}) {
```

Replace with:
```js
export default function FlowPage({
  data, activeTab, searchTerm, setSearchTerm, sortConfig, handleSort, suppliers, theme,
  setSelectedOrder, setShowAddOrderModal, setRevisionOrder, setChangelogOrder,
  setData, setToast, setActiveTab,
  handleInlineFieldSave, handleSizeChange, handleMandrelsChange, handlePRNumberChange, copyForERP,
  handleCavityChange,
}) {
```

- [ ] **Step 2: Add `isDesignApproval` flag after the existing `isPR`/`isDone` flags (around line 130–133)**

Find:
```js
  const isPendingOrder = currentFlow.status === 'PENDING FOR ORDERING';
  const isSimOrApproval = currentFlow.status === 'UNDER SIMULATION' || currentFlow.status === 'PENDING FOR DESIGN APPROVAL';
  const isPR = currentFlow.status === 'PENDING FOR PR';
  const isDone = currentFlow.status === 'DONE';
```

Replace with:
```js
  const isPendingOrder = currentFlow.status === 'PENDING FOR ORDERING';
  const isSimOrApproval = currentFlow.status === 'UNDER SIMULATION' || currentFlow.status === 'PENDING FOR DESIGN APPROVAL';
  const isPR = currentFlow.status === 'PENDING FOR PR';
  const isDone = currentFlow.status === 'DONE';
  const isDesignApproval = currentFlow.status === 'PENDING FOR DESIGN APPROVAL';
```

- [ ] **Step 3: Add Cav to the columns array (around line 141)**

Find:
```js
    { key: 'Thickness', label: 'Thickness' },
    { key: 'Supplier', label: 'Supplier' },
```

Replace with:
```js
    { key: 'Thickness', label: 'Thickness' },
    { key: 'Cavity', label: 'Cav' },
    { key: 'Supplier', label: 'Supplier' },
```

- [ ] **Step 4: Add read-only Cav cell after the Thickness cell in the row (around line 227–231)**

Find:
```jsx
                    <td style={styles.td}>
                      {isSimOrApproval ? (
                        <input type="number" defaultValue={parseDieSize(order['Die Size']).thickness || ''} onBlur={(e) => handleSizeChange(order, 'Thickness', parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '65px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }} placeholder="T" />
                      ) : <span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span>}
                    </td>
                    <td style={styles.td}>
```

Replace with:
```jsx
                    <td style={styles.td}>
                      {isSimOrApproval ? (
                        <input type="number" defaultValue={parseDieSize(order['Die Size']).thickness || ''} onBlur={(e) => handleSizeChange(order, 'Thickness', parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '65px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }} placeholder="T" />
                      ) : <span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span>}
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontFamily: 'monospace' }}>{order['Cavity'] || '—'}</span>
                    </td>
                    <td style={styles.td}>
```

- [ ] **Step 5: Verify manually**

Navigate to any flow tab (Design Approval, PR, etc.). Confirm the `Cav` column appears between Thickness and Supplier, showing the cavity count (read-only for now).

- [ ] **Step 6: Commit**

```bash
git add src/pages/FlowPage.jsx
git commit -m "feat: add Cav column to FlowPage (read-only, all tabs)"
```

---

## Task 4: Add editable input + reason popover to FlowPage.jsx (Design Approval only)

**Files:**
- Modify: `src/pages/FlowPage.jsx`

### Steps

- [ ] **Step 1: Add `cavityEdit` and `cavityReason` state at the top of the component (after the existing `useState` for `dieReceivanceOrder`)**

Find:
```js
  const [dieReceivanceOrder, setDieReceivanceOrder] = useState(null);
  const [dieReceivanceForm, setDieReceivanceForm] = useState({ die_received_date: '', corrector: '' });
```

Replace with:
```js
  const [dieReceivanceOrder, setDieReceivanceOrder] = useState(null);
  const [dieReceivanceForm, setDieReceivanceForm] = useState({ die_received_date: '', corrector: '' });
  const [cavityEdit, setCavityEdit] = useState(null);
  const [cavityReason, setCavityReason] = useState('');
```

- [ ] **Step 2: Replace the read-only Cav cell added in Task 3 Step 4 with a conditional input for Design Approval**

Find (the cell added in Task 3):
```jsx
                    <td style={styles.td}>
                      <span style={{ fontFamily: 'monospace' }}>{order['Cavity'] || '—'}</span>
                    </td>
```

Replace with:
```jsx
                    <td style={styles.td}>
                      {isDesignApproval ? (
                        <input
                          type="number"
                          min="1"
                          defaultValue={order['Cavity'] || ''}
                          onBlur={(e) => {
                            const newVal = parseInt(e.target.value, 10);
                            if (!isNaN(newVal) && newVal !== (order['Cavity'] || 0)) {
                              setCavityEdit({ order, newValue: newVal, rect: e.target.getBoundingClientRect() });
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          style={{ width: '55px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }}
                          placeholder="Cav"
                        />
                      ) : (
                        <span style={{ fontFamily: 'monospace' }}>{order['Cavity'] || '—'}</span>
                      )}
                    </td>
```

- [ ] **Step 3: Add the popover JSX and close-on-outside-click handler**

Find the last `{dieReceivanceOrder && (` block near the end of the return. It ends with:
```jsx
      )}
    </div>
  );
}
```

Replace that closing sequence with:
```jsx
      )}

      {cavityEdit && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1999 }}
          onClick={() => { setCavityEdit(null); setCavityReason(''); }}
        >
          <div
            style={{
              position: 'fixed',
              top: cavityEdit.rect.bottom + 8,
              left: cavityEdit.rect.left,
              zIndex: 2000,
              background: theme.cardBg || '#1E293B',
              border: `1px solid ${theme.border || '#334155'}`,
              borderRadius: '10px',
              padding: '12px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              minWidth: '260px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '0.8rem', color: theme.textMuted || '#94A3B8', marginBottom: '8px' }}>
              Cavity change:{' '}
              <span style={{ fontFamily: 'monospace', color: '#EF4444', textDecoration: 'line-through' }}>
                {cavityEdit.order['Cavity'] || 0}
              </span>
              {' → '}
              <span style={{ fontFamily: 'monospace', color: '#10B981', fontWeight: 700 }}>
                {cavityEdit.newValue}
              </span>
            </div>
            <textarea
              autoFocus
              placeholder="Reason for change…"
              value={cavityReason}
              onChange={(e) => setCavityReason(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: theme.inputBg || '#0F172A',
                border: `1px solid ${theme.border || '#334155'}`,
                borderRadius: '6px',
                color: theme.text,
                fontSize: '0.8rem',
                resize: 'none',
                height: '60px',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={() => { setCavityEdit(null); setCavityReason(''); }}
                style={{ padding: '5px 12px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.textMuted || '#94A3B8', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                disabled={!cavityReason.trim()}
                onClick={async () => {
                  await handleCavityChange(cavityEdit.order, cavityEdit.newValue, cavityReason.trim());
                  setCavityEdit(null);
                  setCavityReason('');
                }}
                style={{ padding: '5px 12px', background: cavityReason.trim() ? '#3B82F6' : '#334155', border: 'none', borderRadius: '6px', color: cavityReason.trim() ? 'white' : '#64748B', fontSize: '0.8rem', fontWeight: 600, cursor: cavityReason.trim() ? 'pointer' : 'not-allowed' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify manually — edit flow**

Navigate to **Design Approval** tab. For an order with a cavity value:
1. Click into the `Cav` input, change the number, and press Enter or click away
2. The popover appears with Old → New summary and an empty reason textarea
3. Leave reason blank — Save button should be greyed out and non-clickable
4. Type a reason — Save button turns blue
5. Click **Cancel** — popover closes, no change
6. Repeat, type reason, click **Save** — toast appears "Cavity updated: X → Y", popover closes
7. Click the **Change Log** (History icon) for that order — the entry should appear with field `Cavity`, old/new values, and the reason

- [ ] **Step 5: Verify manually — PR and Orders pages are read-only**

Navigate to the **PR** tab and confirm the `Cav` column shows a plain number (no input).
Navigate to the **Orders** page and confirm the same.

- [ ] **Step 6: Commit**

```bash
git add src/pages/FlowPage.jsx
git commit -m "feat: editable Cavity with reason popover on Design Approval tab"
```
