# UI Navigation & Charts Enhancement

Implementing 4 coordinated UI improvements from the [spec document](file:///c:/Users/vijee/Desktop/Die-Tracker/docs/superpowers/specs/2026-04-16-ui-navigation-charts-design.md).

## Proposed Changes

### 1. Constants — Add Icons to Process Flow Tabs

#### [MODIFY] [constants.js](file:///c:/Users/vijee/Desktop/Die-Tracker/src/utils/constants.js)
- Import 9 lucide-react icons: `ShoppingCart`, `Pencil`, `Cpu`, `CheckSquare`, `FileText`, `Database`, `Send`, `Factory`, `Eye`
- Add `icon` field to each entry in `PROCESS_FLOW_TABS`

---

### 2. Collapsible Sidebar + Flat Process Flow

#### [MODIFY] [DieOrderingSystem.jsx](file:///c:/Users/vijee/Desktop/Die-Tracker/src/DieOrderingSystem.jsx)
- Add `sidebarCollapsed` state initialized from `localStorage`
- Add `useEffect` to persist collapsed state to `localStorage`
- Update `styles.mainContent.marginLeft` to switch between `'260px'` and `'64px'`
- Add `transition: 'margin-left 0.2s ease'` to main content
- Pass `collapsed` prop to `<Sidebar>`

#### [MODIFY] [Sidebar.jsx](file:///c:/Users/vijee/Desktop/Die-Tracker/src/components/layout/Sidebar.jsx)
- Accept `collapsed` prop
- Root div width switches between `260px` / `64px` with `transition: 'width 0.2s ease'`
- Logo text hides when collapsed (`opacity: 0`, `width: 0`, `overflow: hidden`)
- Nav item labels hidden (`display: 'none'`) when collapsed; icons centered
- Each nav button gets `title={tab.label}` for tooltip
- Section divider labels ("Main Menu", "Process Flow") hidden when collapsed
- **Flatten Process Flow**: Remove accordion group; render each flow step as a direct top-level nav button with its icon from constants
- Flow tab active state uses status color tint background; main tabs use `theme.primary`
- Toggle button pinned to bottom via `marginTop: 'auto'` wrapper — `ChevronLeft`/`ChevronRight` icon

---

### 3. TopBar Icon Labels

#### [MODIFY] [TopBar.jsx](file:///c:/Users/vijee/Desktop/Die-Tracker/src/components/layout/TopBar.jsx)
- Change each action button from circular to vertical pill: `flexDirection: 'column'`, `borderRadius: '10px'`, `padding: '8px 10px'`
- Icon size reduced from 20 to 18
- Add `<span>` label below icon: `fontSize: '0.6rem'`, `fontWeight: 600`
- Labels: Import PDF, Import, Export, Theme, Alerts
- No change to user avatar area

---

### 4. Analytics Charts — Data Labels

#### [MODIFY] [DieOrderingSystem.jsx](file:///c:/Users/vijee/Desktop/Die-Tracker/src/DieOrderingSystem.jsx)

Four bar charts receive `<LabelList>`:

| Chart (line) | Orientation | `position` | Margin added |
|---|---|---|---|
| Avg Design Lead Time by Supplier (~L3837) | Horizontal | `"right"` | `margin={{ right: 50 }}` |
| Avg Design Approval Lead Time by Supplier (~L3879) | Horizontal | `"right"` | `margin={{ right: 50 }}` |
| Avg Design Approval Time by Month (~L3913) | Vertical | `"top"` | `margin={{ top: 20 }}` |
| Avg Design Approval Time by Plant (~L3946) | Vertical | `"top"` | `margin={{ top: 20 }}` |

All use: `<LabelList dataKey="avgDays" position="..." fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => \`${v}d\`} />`

---

## Verification Plan

### Automated
- `npm run dev` — verify build succeeds without errors
- Browser test: toggle sidebar collapse, confirm width transitions, verify all nav items work

### Manual
- Visual check: sidebar collapse/expand animation, flat flow items with icons, topbar labels, chart data labels
