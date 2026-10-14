# Universal Search (Ctrl+K palette) — Design

Date: 2026-10-14
Status: Approved in chat, awaiting spec review

## Problem

The top-bar search box is not universal. It sets one shared `searchTerm` that only
the current page uses to filter itself (Orders, Flow, In Manufacturing, Sample
Followup), each page matching different fields. On the Dashboard or QD Tracker it
does nothing. To find a record today you must already know which page it lives on.

## Goal

From anywhere in the app, type a die no / order no / QD no (or supplier, customer…)
and jump straight to the matching record.

Success: a user on any page presses Ctrl+K, types `D-1234`, presses Enter, and the
order detail modal (or QD drawer) for that record is open — without first
navigating to the right page.

## Decisions (from brainstorming)

- **Purpose:** find-and-jump (option A). The "die dossier" view is out of scope.
- **v1 record types:** die orders and Quality Discrepancies only.
- **Entry point:** a separate Ctrl+K / ⌘K palette. The existing top-bar box keeps
  its current page-filter behaviour, unchanged.
- **Approach:** a server endpoint (`GET /api/search`), not client-side search, so
  page-access and draft-visibility rules are enforced in one place and QDs need
  not be loaded on every page.

## Server

### `GET /api/search?q=<text>`

Mounted in `server/index.cjs` behind `authMiddleware` only. Per-group access is
decided inside the route (a user may see one group and not the other).

- `q` is trimmed; fewer than 2 characters → `400`.
- `q` is used as a parameterised `ILIKE '%' || $1 || '%'` value with `%`, `_` and
  `\` escaped, so user input is never treated as a wildcard.

Response:

```json
{
  "orders": { "items": [ ... ], "total": 14 },
  "qds":    { "items": [ ... ], "total": 2 }
}
```

A group the user may not access is omitted entirely (not returned empty).

### Orders group

- **Access:** user can access any of the page ids `/api/orders` already accepts
  (`dashboard`, `orders`, `analytics`, the `flow-*` pages). Reuse that list from a
  shared constant rather than copying it.
- **Matches on:** `die_no`, `order_no`, `supplier`, `customer_name`, `pr_number`.
- **Item shape:** the full order passed through `presentOrder` (so the client can
  hand it straight to `OrderDetailModal`), plus `matchedField`.

### QDs group

- **Access:** `qd-tracker` page access (same as `/api/quality-discrepancies`).
- **Draft rule:** a QD with `approval_state = 'Draft'` is returned only to its
  creator (`created_by = req.user.id`), matching `excludeDrafts` / `onlyDrafts`.
- **Matches on:** `qd_no`, `die_no`, `supplier`, `profile_number`, `issue_summary`.
- **Item shape:** `id, qd_no, die_no, supplier, plant, status, approval_state,
  raised_date, matchedField`.

### `GET /api/search/qd/:id`

Returns one full QD (the `listQDs` record plus `can_approve` and
`assigned_approver_name`), the same record the Work Queue fetches. The palette
calls it when a QD result is opened and passes it to the QD Tracker as
`focusQdRecord`, so drafts and QDs outside the tracker's current list still open.
`403` without QD access; `404` when missing or someone else's Draft.

### Ranking (pure function, `server/services/search.cjs`)

Within each group, sort by:

1. exact match (case-insensitive) on the group's primary codes
   (orders: `die_no`, `order_no`; QDs: `qd_no`, `die_no`)
2. starts-with on any matched field
3. contains
4. newest first (`created_at` / `raised_date`) as tie-break

Each group returns at most **8** items plus the true `total` count. The SQL fetches
a bounded candidate set (e.g. 200 rows, newest first) that is then ranked in JS; the
total comes from a `COUNT(*)` with the same predicate.

## Client

### `src/components/search/SearchPalette.jsx`

- Centered modal with one input, autofocused. Esc or a backdrop click closes it.
- Debounced 200 ms; no request under 2 characters; stale responses are ignored
  (only the latest query's response is rendered).
- Groups: **Die orders**, then **Quality Discrepancies**, each with a header.
  - Order row: die no · order no · supplier · status chip.
  - QD row: QD no · die no · status · raised date.
  - When `total > items.length`: "Showing 8 of N" under the group.
- Keyboard: ↑/↓ move across both groups, Enter opens, mouse click opens.
- States: idle hint ("Search die no, order no, QD no, supplier…"), loading,
  no results ("No matches for “…”"), error ("Search failed — try again").
- Styling follows the existing `theme` object, light and dark.

### Opening the palette

- A `useSearchShortcut` hook binds Ctrl+K (⌘K on Mac) globally and calls
  `preventDefault` so the browser's own shortcut doesn't fire.
- A small "Search ⌘K" button in `TopBar.jsx`, next to the existing box, also opens
  it. The existing box itself is untouched.

### Opening a result (wiring in `DieOrderingSystem.jsx`)

- **Order:** `setSelectedOrder(item)` — the existing `OrderDetailModal` opens in
  place on the current page. Editability is unchanged: edit only on the Orders
  tab for users with the edit permission, view-only elsewhere.
- **QD:** fetch `/api/search/qd/:id`, then `setFocusQdRecord(record)`,
  `setFocusQdId(record.id)` and switch `activeTab` to the QD Tracker — the same
  path the Work Queue uses today.
- The palette closes after a result is opened.

### API client

Add `searchAPI.query(q)` in `src/api.js` following the existing `apiRequest`
pattern (`encodeURIComponent(q)`).

## Testing

- `server/services/search.test.cjs` (node:test): ranking order (exact > prefix >
  contains > recency), the 8-item cap with correct `total`, `ILIKE` escaping of
  `%` / `_` / `\`.
- `server/routes/search.test.cjs` using `testSupport.cjs`: `400` under 2 chars;
  orders group omitted without order-page access; QD group omitted without
  `qd-tracker`; another user's Draft QD not returned, own Draft returned.
- Browser check on the local stack: Ctrl+K from the Dashboard → type a die no →
  Enter opens the order modal; type a QD no → Enter lands on the QD Tracker with
  that QD open.

## Out of scope (v1)

- Frozen designs, existing dies, backup requests, sample follow-ups, suppliers.
- Recent searches / history.
- The die dossier view.
- Changing the top-bar page-filter box.
