# Analytics Overview Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Analytics page layout — cap the runaway column count that clips pie labels, and group the eleven charts into three labelled sections.

**Architecture:** `AnalyticsPage.jsx` (387 lines, one flat grid) splits into a thin page and an `OverviewTab` component. The five chart-data IIFEs currently embedded in JSX are lifted into named `useMemo` values, which is what makes regrouping possible at all. Column count moves from an uncapped `auto-fit` to a `.dt-*` CSS class with breakpoints, matching the existing convention in `index.css`.

**Tech Stack:** React (no framework, inline styles), recharts, CSS classes in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-08-04-supplier-performance-evaluation-design.md` — this plan covers Phase 1 only. The scoring model, Supplier Report tab and targets settings are a separate plan.

## Global Constraints

- **No chart's content changes.** Every chart shows exactly the data it shows today. Cards move and regroup; the numbers, colours, axes, tooltips and copy are untouched.
- No tab bar in this plan. A single tab is not a tab. The tab shell arrives with the Supplier Report tab in the scorecard plan.
- The page uses **recharts** (`BarChart`, `Pie`, `ResponsiveContainer`). Keep it — do not hand-roll SVG here.
- Styling is **inline styles** except where a media query is required, which goes in `src/index.css` as a `.dt-*` class, matching `.dt-table` / `.dt-scroll`.
- **Do not modify the font or any existing rule in `src/index.css`.** Append the new class only.
- Verify frontend with `npm run lint` and `npm run build`. There is no frontend test framework.
- Lint baseline on `main` is **77 problems (75 errors, 2 warnings)**. Do not exceed it.
- **`docker compose restart` never picks up a source edit** — always `docker compose build frontend && docker compose up -d frontend`.

---

### Task 1: Extract OverviewTab

**Files:**
- Create: `src/pages/analytics/OverviewTab.jsx`
- Modify: `src/pages/AnalyticsPage.jsx` (becomes a thin wrapper)

**Interfaces:**
- Consumes: nothing.
- Produces: `default OverviewTab({ data, suppliers, theme })` — the entire current page body, moved verbatim.

This is a pure move. The rendered page must be pixel-identical afterwards.

- [ ] **Step 1: Create the directory and move the file**

```bash
mkdir -p src/pages/analytics
git mv src/pages/AnalyticsPage.jsx src/pages/analytics/OverviewTab.jsx
```

- [ ] **Step 2: Rename the component inside the moved file**

In `src/pages/analytics/OverviewTab.jsx`, change line 36 from:

```jsx
export default function AnalyticsPage({ data, suppliers, theme }) {
```

to:

```jsx
export default function OverviewTab({ data, suppliers, theme }) {
```

Fix the two relative imports, which are now one level deeper — line 3 becomes:

```jsx
import { CHART_COLORS } from '../../utils/constants';
```

Line 1 and 2 (`react`, `recharts`) are package imports and do not change.

- [ ] **Step 3: Create the new thin page**

Create `src/pages/AnalyticsPage.jsx`:

```jsx
import React from 'react';
import OverviewTab from './analytics/OverviewTab';

// Thin shell. The Supplier Report tab joins OverviewTab here in the
// supplier-performance work; until there are two tabs there is no tab bar,
// because a single tab is just chrome.
export default function AnalyticsPage({ data, suppliers, theme }) {
  return <OverviewTab data={data} suppliers={suppliers} theme={theme} />;
}
```

- [ ] **Step 4: Verify nothing else imported the old path**

Run: `grep -rn "pages/AnalyticsPage" src/`
Expected: only `src/DieOrderingSystem.jsx`'s lazy import, which still resolves because the path is unchanged.

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AnalyticsPage.jsx src/pages/analytics/OverviewTab.jsx
git commit -m "refactor(analytics): extract OverviewTab from the page"
```

---

### Task 2: Lift the chart-data IIFEs into named memos

**Files:**
- Modify: `src/pages/analytics/OverviewTab.jsx`

**Interfaces:**
- Consumes: `OverviewTab` from Task 1.
- Produces, all inside `OverviewTab` — each an array the existing charts already expect:
  - `designLeadData: {name, avgDays, count}[]`
  - `approvalLeadData: {name, avgDays, count}[]`
  - `approvalByMonthData: {month, avgDays, count}[]`
  - `approvalByPlantData: {plant, avgDays, count}[]`
  - `deliveryData: {name, avgDays, count}[]`
  - `mfgData: {name, avgDays, count}[]`

**Why:** five IIFEs currently compute data inline inside JSX (at lines ~171, ~214, ~247, ~281, and the block at 310–384 that returns a fragment of two cards). While the data lives inside the markup, cards cannot be moved between sections without dragging their computation along. Lifting them is what makes Task 3 a layout change rather than a rewrite.

- [ ] **Step 1: Lift the four single-chart IIFEs**

For each of the four charts, cut the expression between `data={(() => {` and `})()}` and make it a `useMemo` beside the existing `typeData` memo (which ends at line 78). Give each the name from the Interfaces block above, with `[analyticsData]` as the dependency array — or `[analyticsData, suppliers]` if the body reads `suppliers`.

Then replace each chart's prop with the memo, for example:

```jsx
<BarChart data={designLeadData} layout="vertical" margin={{ right: 60 }}>
```

Do this for `designLeadData` (chart at line ~167), `approvalLeadData` (~210), `approvalByMonthData` (~243) and `approvalByPlantData` (~277). **Copy each body verbatim — do not re-derive or "improve" the arithmetic.**

- [ ] **Step 2: Lift the two-card IIFE**

The block at lines 310–384 computes `supplierDelivery` and `supplierMfg` in one pass, then returns a fragment holding two cards. Move the whole computation into a single memo returning both arrays:

```jsx
  const { deliveryData, mfgData } = useMemo(() => {
    // …the existing supplierDelivery / supplierMfg accumulation, verbatim…
    const deliveryData = Object.entries(supplierDelivery)
      .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
      .sort((a, b) => a.avgDays - b.avgDays);
    const mfgData = Object.entries(supplierMfg)
      .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
      .sort((a, b) => a.avgDays - b.avgDays);
    return { deliveryData, mfgData };
  }, [analyticsData]);
```

Replace the `{(() => { … })()}` block in the JSX with the two cards rendered directly, keeping their existing `deliveryData.length > 0 &&` and `mfgData.length > 0 &&` guards and their exact markup.

- [ ] **Step 3: Confirm no IIFEs remain in the JSX**

Run: `grep -n "(() => {" src/pages/analytics/OverviewTab.jsx`
Expected: no matches inside the `return (...)` block. Matches on `useMemo(() => {` lines are expected and fine.

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems.

- [ ] **Step 5: Check the page renders identically**

Rebuild and open the page:

```bash
docker compose build frontend && docker compose up -d frontend
```

Every chart must show the same bars and values as before. This task changes no output — if a chart empties or changes shape, a memo body was altered or a dependency array is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/pages/analytics/OverviewTab.jsx
git commit -m "refactor(analytics): lift chart data out of JSX into memos"
```

---

### Task 3: Section grouping and the column cap

**Files:**
- Modify: `src/index.css` (append only)
- Modify: `src/pages/analytics/OverviewTab.jsx`

**Interfaces:**
- Consumes: the six memos from Task 2.
- Produces: `.dt-analytics-grid` CSS class; a local `Section` component inside `OverviewTab`.

- [ ] **Step 1: Append the responsive grid class to `src/index.css`**

Append at the end of the file. Inline styles cannot express media queries, which is why this is a class — the same reason `.dt-table` exists.

```css
/* Analytics chart grid. The page previously used an uncapped
   repeat(auto-fit, minmax(320px, 1fr)), which resolves to five or six columns
   on a wide screen and squeezes the pie charts until their labels clip.
   Capped at three. */
.dt-analytics-grid {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: 1fr;
}

@media (min-width: 900px) {
  .dt-analytics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1400px) {
  .dt-analytics-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* Cards that should span the full width of the grid whatever the count. */
.dt-analytics-grid > .dt-span-all {
  grid-column: 1 / -1;
}
```

`minmax(0, 1fr)` rather than `1fr` matters: without it a wide chart forces its
column past its share and the grid overflows horizontally.

- [ ] **Step 2: Add the Section component to `OverviewTab.jsx`**

Declare it above `export default function OverviewTab`, so it is not recreated on every render:

```jsx
function Section({ title, theme, children }) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{
        fontSize: '0.75rem', fontWeight: 700, color: theme.textDim,
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem',
      }}>
        {title}
      </h2>
      <div className="dt-analytics-grid">{children}</div>
    </section>
  );
}
```

- [ ] **Step 3: Restructure the return into filter bar plus three sections**

Replace the single grid wrapper (line 83, `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>`) and its closing `</div>` with this shape. Move each existing card, markup unchanged, into the section shown:

```jsx
  return (
    <div>
      {/* filter bar — unchanged markup, now full width outside the grid */}
      <div style={{ ...styles.chartCard, padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        {/* …existing filter bar contents, verbatim… */}
      </div>

      <Section title="Volume & Distribution" theme={theme}>
        {/* Supplier Performance table — full width */}
        <div style={styles.chartCard} className="dt-span-all"> … </div>
        {/* Orders by Supplier */}
        {/* Die Order Distribution by Region */}
        {/* Orders by Die Type */}
      </Section>

      <Section title="Lead Times" theme={theme}>
        {/* Avg Design Lead Time by Supplier */}
        {deliveryData.length > 0 && ( /* Avg Delivery Lead Time by Supplier */ )}
        {mfgData.length > 0 && ( /* Avg Manufacturing Lead Time by Supplier */ )}
      </Section>

      <Section title="Design Approval" theme={theme}>
        {/* Avg Design Approval Lead Time by Supplier */}
        {/* Avg Design Approval Time by Month */}
        {/* Avg Design Approval Time by Plant */}
      </Section>
    </div>
  );
```

Two details:

- The filter bar and the Supplier Performance table currently carry
  `gridColumn: 'span 2'`. **Remove that inline style from both.** The filter bar
  now sits outside the grid entirely; the table uses `className="dt-span-all"`.
  Leaving `span 2` behind would misalign them in a three-column grid.
- Avg Design Lead Time by Supplier currently renders between the two pies. It
  moves into Lead Times. Its markup does not change.

- [ ] **Step 4: Confirm no stale span rules remain**

Run: `grep -n "gridColumn\|auto-fit" src/pages/analytics/OverviewTab.jsx`
Expected: no matches. Both belong to the old layout.

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: PASS, still 77 problems.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/pages/analytics/OverviewTab.jsx
git commit -m "feat(analytics): group charts into sections and cap the grid at three columns"
```

---

### Task 4: Verify in the browser

**Files:** none modified.

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Rebuild and serve**

```bash
docker compose build frontend && docker compose up -d frontend
```

- [ ] **Step 2: Check the clipping bug is gone at full width**

Open the Analytics page maximised. The two pie charts — Die Order Distribution by
Region, Orders by Die Type — must show complete labels. Before this work they
read `"Ch..."`, `":Turk"` and `"oling 9%"`. At most three cards per row.

- [ ] **Step 3: Check the three section headings**

Volume & Distribution, Lead Times, Design Approval, in that order, each above its
own row of cards.

- [ ] **Step 4: Check the filter still drives every chart**

Set Quarter to Q1. The "Showing N orders" count must drop, and the charts must
change with it. This is the regression that would prove a memo lost its
`analyticsData` dependency.

- [ ] **Step 5: Check narrower widths**

Resize to tablet (768px) and mobile (375px). Expect two columns then one, no
horizontal page scrolling, and no card overflowing its column.

- [ ] **Step 6: Check the console**

No new errors or React key warnings.

---

## Notes for the implementer

- **Do not change what any chart displays.** This plan is layout only. If you
  find yourself editing an axis, a formatter, a colour or a `reduce`, stop — that
  is out of scope.
- The lint baseline is 77 problems, all pre-existing on `main`. If your change
  adds one, fix it rather than accepting a new baseline.
- Do not add a tab bar. It belongs with the second tab, in the scorecard plan.
