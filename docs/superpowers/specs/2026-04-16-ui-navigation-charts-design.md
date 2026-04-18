# UI Navigation & Charts Enhancement Design
**Date:** 2026-04-16  
**Status:** Approved

---

## Overview

Four coordinated UI improvements to the Die Ordering System:
1. Collapsible sidebar (icon-only collapsed mode)
2. Process Flow steps flattened into main sidebar
3. TopBar action buttons get text labels
4. Analytics tab charts get data labels on all bar charts

---

## 1. Collapsible Sidebar

### State
- `sidebarCollapsed: boolean` state added to `DieOrderingSystem.jsx`
- Initialized from `localStorage.getItem('sidebarCollapsed') === 'true'`
- Persisted via `useEffect` on change: `localStorage.setItem('sidebarCollapsed', collapsed)`
- Passed as prop to `<Sidebar>` only — TopBar does not receive this prop and needs no change

### Sidebar dimensions
- Expanded: `260px` width
- Collapsed: `64px` width
- CSS transition: `width 0.2s ease` on the sidebar root div

### Collapsed mode behaviour
- Logo icon remains visible; logo text hides (`opacity: 0`, `width: 0`, `overflow: hidden`)
- All nav item labels hidden when collapsed (`display: 'none'`)
- Icons remain centered (`justifyContent: 'center'`, `gap: 0` when collapsed, `gap: '12px'` when expanded)
- Each nav button gets `title={tab.label}` for native browser tooltip on hover
- Section divider labels ("Main Menu", "Process Flow") hidden when collapsed; the divider element itself is suppressed via `display: 'none'`
- "Process Flow" section label AND its items are both suppressed entirely when `accessibleFlowTabs.length === 0` (same `showProcessFlow` guard as today)

### Toggle button placement
- The sidebar root div uses `display: flex; flex-direction: column`
- A wrapper `<div style={{ marginTop: 'auto', paddingTop: '1rem' }}>` holds the toggle button, pinning it to the bottom via flex without needing `position: absolute` (which conflicts with `overflowY: auto`)
- Toggle button: `ChevronLeft` icon when expanded, `ChevronRight` when collapsed
- Same pill style as other nav buttons; `title="Collapse sidebar"` / `title="Expand sidebar"`

### Main content offset
- `styles.mainContent.marginLeft` switches between `'260px'` and `'64px'` based on `sidebarCollapsed`
- Same `0.2s ease` transition applied so content slides with the sidebar

---

## 2. Process Flow — Flat Sidebar Items

### Current structure
Process Flow is a collapsible accordion group with 9 sub-items rendered with indent + border-left.

### New structure
- Remove the accordion group entirely (no parent "Process Flow" button with chevron)
- Each flow step becomes a direct top-level nav button, same height and padding as main tabs
- Rendered in workflow sequence between the main tabs (Dashboard…Email) and the bottom tabs (Analytics, Settings, Users)
- A **section label** `"Process Flow"` in the same style as "Main Menu" separates them visually; hidden (not rendered) when collapsed
- The entire section (label + items) is suppressed when `accessibleFlowTabs.length === 0`

### Icons per step (added to `PROCESS_FLOW_TABS` in `constants.js`)

| Step id | Label | Icon |
|---|---|---|
| `flow-pending-order` | Pending Order | `ShoppingCart` |
| `flow-awaiting-design` | Awaiting Design | `Pencil` |
| `flow-simulation` | Simulation | `Cpu` |
| `flow-design-approval` | Design Approval | `CheckSquare` |
| `flow-pending-pr` | Pending PR | `FileText` |
| `flow-oracle-entry` | Oracle Entry | `Database` |
| `flow-design-ems` | Design to EMS | `Send` |
| `flow-completed` | In Manufacturing | `Factory` |
| `flow-sample-followup` | Sample Followup | `Eye` |

### Active state
- When a flow tab is the active tab: its button background uses `${STATUS_CONFIG[tab.status]?.color || '#3B82F6'}20` (colour tint) with text colour `theme.text`
- When a main menu or bottom tab (Dashboard, Orders, Analytics…) is the active tab: that button uses the existing primary blue background (`theme.primary`) and `theme.primaryText`
- Only one item is ever active at a time; all others render with `background: transparent` and `color: theme.textMuted`

---

## 3. TopBar Icon Labels

### Current state
Each action button is a circular `padding: '10px'` icon-only button with `borderRadius: '50%'`.

### New state
Each button becomes a compact vertical pill: icon on top, small label below.

```
┌──────────┐
│  [icon]  │
│  Label   │
└──────────┘
```

- Button shape: `display: flex; flexDirection: 'column'; alignItems: 'center'; gap: '2px'`
- `borderRadius: '10px'`, `padding: '8px 10px'`
- Icon: `size={18}` (slightly smaller than current 20 to give label room)
- Label `<span>`: `fontSize: '0.6rem'`, `fontWeight: 600`, `color: theme.textMuted`, `lineHeight: 1`, `whiteSpace: 'nowrap'`
- No change to the user avatar area (already has username/role text)
- The PDF import button retains its dropdown; the pill style applies to its trigger button only

### Labels

| Button | Label |
|---|---|
| FileText (PDF import dropdown) | `Import PDF` |
| Upload (Excel import) | `Import` |
| Download (export) | `Export` |
| Sun/Moon (theme toggle) | `Theme` |
| Bell (notifications) | `Alerts` |

---

## 4. Analytics Charts — Data Labels

Add `<LabelList>` to all bar charts that currently lack them.

### Charts receiving new labels

| Chart | Orientation | `position` | Format | Extra margin needed |
|---|---|---|---|---|
| Avg Design Lead Time by Supplier | Horizontal bar | `"right"` | `"${v}d"` | Add `margin={{ right: 50 }}` to `<BarChart>` |
| Avg Design Approval Lead Time by Supplier | Horizontal bar | `"right"` | `"${v}d"` | Add `margin={{ right: 50 }}` to `<BarChart>` |
| Avg Design Approval Time by Month | Vertical bar | `"top"` | `"${v}d"` | Add `margin={{ top: 20 }}` to `<BarChart>` |
| Avg Design Approval Time by Plant | Vertical bar | `"top"` | `"${v}d"` | Add `margin={{ top: 20 }}` to `<BarChart>` |

### LabelList props (all four charts)
```jsx
<LabelList dataKey="avgDays" position="right"|"top" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
```

### Charts already labelled (no change)
- Orders by Supplier — has `LabelList position="right"` with count + %
- Avg Delivery Lead Time by Supplier — has `LabelList position="right"`
- Avg Manufacturing Lead Time by Supplier — has `LabelList position="right"`

### Pie chart
- Orders by Die Type already has outer `label` prop rendering name + percent — no change needed

---

## Files Changed

| File | Changes |
|---|---|
| `src/DieOrderingSystem.jsx` | Add `sidebarCollapsed` state + localStorage persistence; update `styles.mainContent.marginLeft`; pass `collapsed` prop to `<Sidebar>` |
| `src/components/layout/Sidebar.jsx` | Collapsible width/label logic; flat process flow items with icons; toggle button pinned via `marginTop: auto` |
| `src/components/layout/TopBar.jsx` | Pill-shaped buttons with labels |
| `src/utils/constants.js` | Add `icon` field to each `PROCESS_FLOW_TABS` entry |

---

## Out of Scope
- Mobile/responsive breakpoints (existing layout is desktop-only)
- Persisting active tab across refresh
- Reordering sidebar items
