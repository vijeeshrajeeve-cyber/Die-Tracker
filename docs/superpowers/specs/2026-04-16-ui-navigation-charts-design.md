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
- Passed as prop to `<Sidebar>` and used to compute `mainContent.marginLeft`

### Sidebar dimensions
- Expanded: `260px` width
- Collapsed: `64px` width
- CSS transition: `width 0.2s ease` on the sidebar root div

### Collapsed mode behaviour
- Logo icon remains visible; logo text hides (`opacity: 0`, `width: 0`)
- All nav item labels hidden when collapsed
- Icons remain centered (`justifyContent: 'center'`, `gap: 0`)
- Each nav button gets `title={tab.label}` for native browser tooltip on hover
- Section divider labels ("Main Menu", "Process Flow") hidden when collapsed
- Toggle button: `ChevronLeft` when expanded, `ChevronRight` when collapsed — fixed at bottom of sidebar

### Main content offset
- `styles.mainContent.marginLeft` switches between `'260px'` and `'64px'`
- Same `0.2s ease` transition applied so content slides with the sidebar

---

## 2. Process Flow — Flat Sidebar Items

### Current structure
Process Flow is a collapsible accordion group with 9 sub-items rendered with indent + border-left.

### New structure
- Remove the accordion group entirely
- Each flow step becomes a direct top-level nav item
- Rendered in workflow sequence between the main tabs and the bottom tabs (Analytics, Settings, Users)
- A **section label** `"Process Flow"` (same style as "Main Menu") separates them visually
- Access control unchanged — `hasAccess(tab.id)` still gates each item individually

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
- Active flow item uses the status colour from `STATUS_CONFIG` as its background tint (`${config.color}20`) — consistent with old sub-item style but now full-width
- All other items use the same primary blue active style as main tabs

---

## 3. TopBar Icon Labels

### Current state
Each action button is a circular `padding: '10px'` icon-only button.

### New state
Each button becomes a compact vertical pill: icon on top, small label below.

```
┌──────────┐
│  [icon]  │
│  Label   │
└──────────┘
```

- Container: `display: flex; flex-direction: column; align-items: center; gap: 2px`
- Button shape: `borderRadius: '10px'`, `padding: '8px 10px'`
- Label: `fontSize: '0.6rem'`, `fontWeight: 600`, `color: theme.textMuted`, `lineHeight: 1`
- No change to the user avatar area (already has username/role text)

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

| Chart | Orientation | `position` | Format |
|---|---|---|---|
| Avg Design Lead Time by Supplier | Horizontal bar | `"right"` | `"${v}d"` |
| Avg Design Approval Lead Time by Supplier | Horizontal bar | `"right"` | `"${v}d"` |
| Avg Design Approval Time by Month | Vertical bar | `"top"` | `"${v}d"` |
| Avg Design Approval Time by Plant | Vertical bar | `"top"` | `"${v}d"` |

### Charts already labelled (no change)
- Orders by Supplier — has `LabelList position="right"` with count + %
- Avg Delivery Lead Time by Supplier — has `LabelList position="right"`
- Avg Manufacturing Lead Time by Supplier — has `LabelList position="right"`

### Pie chart
- Orders by Die Type already has outer `label` prop rendering name + percent — no change needed

### Y-axis / margin headroom for vertical bars
- Add `margin={{ top: 20 }}` to vertical bar charts receiving top labels so labels are not clipped

---

## Files Changed

| File | Changes |
|---|---|
| `src/DieOrderingSystem.jsx` | Add `sidebarCollapsed` state; update `styles.mainContent`; pass collapsed prop to Sidebar and TopBar |
| `src/components/layout/Sidebar.jsx` | Collapsible logic, flat process flow items, toggle button |
| `src/components/layout/TopBar.jsx` | Pill-shaped buttons with labels |
| `src/utils/constants.js` | Add `icon` field to each `PROCESS_FLOW_TABS` entry |

---

## Out of Scope
- Mobile/responsive breakpoints (existing layout is desktop-only)
- Persisting active tab across refresh
- Reordering sidebar items
