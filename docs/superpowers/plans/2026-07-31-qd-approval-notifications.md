# QD approval notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell an approver that a QD is waiting for them — in the existing Alerts bell from any page, and in a banner on the QD Tracker.

**Architecture:** Derived, not stored: one endpoint returns the caller's pending queue, one hook polls it, two surfaces render it. No notifications table, no read/unread state. The queue rule (`Pending` and mine-or-unassigned) is a pure JS predicate so it can be unit-tested, deliberately separate from the permission rule `canActOnApproval`.

**Tech Stack:** Express 5 + node-postgres, React 19, Vite, lucide-react, `node:test` for backend tests.

**Spec:** `docs/superpowers/specs/2026-07-31-qd-approval-notifications-design.md`

## Global Constraints

- **Branch:** `feat/qd-approval-notifications` (already created; the spec commit is on it).
- **No new dependencies.** Nothing is added to `package.json`.
- **No schema change.** Every column used (`approval_state`, `assigned_approver`, `submitted_at`, `prepared_by`) already exists.
- **Backend tests are `node:test`,** run with `npm test` (`node --test "server/**/*.test.cjs"`). Mock the pg client as an object literal with a `query` method — see `server/services/qdSettings.test.cjs:22`. There is **no frontend test framework**; frontend tasks are verified by lint on touched files, `npm run build`, and the scripted browser check in the task.
- **`npm run lint` fails repo-wide on ~76 pre-existing errors.** Do not try to fix them. The gate is: `npx eslint <the files you touched>` reports **no new** errors. `src/api.js` has one known pre-existing error at line 424 (`'_' is defined but never used`) — ignore it.
- **Never call setState synchronously in a `useEffect` body.** This repo's lint config enables `react-hooks/set-state-in-effect` and treats it as an error. Derive values during render, or set state inside an async callback or an event handler.
- **Styling is inline style objects** read from the `theme` prop with fallbacks (`theme.cardBg || '#09090b'`, `theme.cardBorder || '#27272a'`, `theme.text || '#fafafa'`, `theme.textMuted || '#a1a1aa'`, `theme.textDim || '#71717a'`). Follow `src/components/qd/FocPendingPanel.jsx`.
- **Commit after every task.**

## File structure

| file | responsibility | task |
| --- | --- | --- |
| `server/services/qualityDiscrepancies.cjs` (modify) | `isInApprovalQueue` predicate + `listPendingApprovals` query | 1 |
| `server/services/qualityDiscrepancies.test.cjs` (modify) | locks the queue rule, especially the admin case | 1 |
| `server/routes/quality-discrepancies.cjs` (modify) | `GET /pending-approvals`, eligibility gate | 1 |
| `src/api.js` (modify) | `pendingApprovals()` client method | 2 |
| `src/hooks/usePendingApprovals.js` (create) | polling, focus refresh, access gate — the single source of truth | 2 |
| `src/DieOrderingSystem.jsx` (modify) | wires the hook, adds the bell section, holds `focusQdId` | 2, 3 |
| `src/components/layout/TopBar.jsx` (modify) | folds the QD count into the red badge | 2 |
| `src/components/qd/ApprovalQueueBanner.jsx` (create) | the QD Tracker banner | 3 |
| `src/pages/QDTrackerPage.jsx` (modify) | renders the banner, accepts the deep-link | 3 |

---

### Task 1: The queue rule and its endpoint

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs` (add beside `canActOnApproval`, which ends at line 683; export at the bottom, line ~780)
- Modify: `server/services/qualityDiscrepancies.test.cjs` (append)
- Modify: `server/routes/quality-discrepancies.cjs` (add above the `/:id` routes)

**Interfaces:**
- Consumes: `listEligibleApprovers()` — already defined in the route file at line 244, returns `[{ id, username, role }]` (admins ∪ the users an admin ticked in Settings).
- Produces:
  - `qd.isInApprovalQueue(row, userId): boolean`
  - `qd.listPendingApprovals(client, userId): Promise<Array<{id, qd_no, die_no, supplier, plant, submitted_at, prepared_by, approval_state, assigned_approver}>>`
  - `GET /api/quality-discrepancies/pending-approvals` → `{ count: number, qds: [...] }`

- [ ] **Step 1: Write the failing tests**

Append to `server/services/qualityDiscrepancies.test.cjs`:

```js
// The approval queue is a personal work list, not a permission check. These
// tests exist because the obvious "simplification" — reusing canActOnApproval —
// silently fills every admin's bell with other approvers' work.
test('a Pending QD assigned to me is in my queue', () => {
  assert.equal(q.isInApprovalQueue({ approval_state: 'Pending', assigned_approver: 7 }, 7), true);
});

test('a Pending QD assigned to nobody is in any approver\'s queue', () => {
  // Submitted before assignment existed, so it is open to whoever picks it up.
  assert.equal(q.isInApprovalQueue({ approval_state: 'Pending', assigned_approver: null }, 7), true);
});

test('a QD assigned to someone else is NOT in my queue, admin or not', () => {
  // canActOnApproval() would say true for an admin here. The queue must not.
  const row = { approval_state: 'Pending', assigned_approver: 9 };
  assert.equal(q.isInApprovalQueue(row, 7), false);
  const admin = { id: 7, role: 'admin' };
  assert.equal(q.canActOnApproval(admin, row), true); // permission: yes
  assert.equal(q.isInApprovalQueue(row, admin.id), false); // queue: no
});

test('only Pending QDs are queued', () => {
  for (const state of ['Draft', 'Approved', 'SentBack']) {
    assert.equal(q.isInApprovalQueue({ approval_state: state, assigned_approver: null }, 7), false, state);
  }
});

test('listPendingApprovals asks only for Pending rows and filters the rest in JS', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [
        { id: 1, qd_no: '2026AD-01', approval_state: 'Pending', assigned_approver: 7 },
        { id: 2, qd_no: '2026AD-02', approval_state: 'Pending', assigned_approver: null },
        { id: 3, qd_no: '2026AD-03', approval_state: 'Pending', assigned_approver: 9 },
      ] };
    },
  };
  const rows = await q.listPendingApprovals(client, 7);
  assert.match(calls[0].sql, /approval_state = 'Pending'/);
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `q.isInApprovalQueue is not a function`.

- [ ] **Step 3: Implement the predicate and the query**

In `server/services/qualityDiscrepancies.cjs`, immediately after `canActOnApproval` (which closes at line 683), add:

```js
// The approver's personal queue: Pending QDs that are theirs to pick up.
//
// Deliberately NOT canActOnApproval(). That returns true for any admin on any
// QD — right for permissions, wrong for a work list. An admin's power to act on
// someone else's QD is an escape hatch for an absent approver, not a daily
// inbox. A QD with no assigned approver predates assignment and is open to any
// approver, so it sits in everyone's queue until someone acts on it.
function isInApprovalQueue(row, userId) {
  if (!row || row.approval_state !== 'Pending') return false;
  if (row.assigned_approver == null) return true;
  return row.assigned_approver === userId;
}

// Pending rows are fetched and then filtered in JS rather than in SQL so the
// rule above is one testable function instead of a WHERE clause nobody can
// unit-test. There are only ever a handful of Pending QDs.
async function listPendingApprovals(client, userId) {
  const { rows } = await client.query(
    `SELECT id, qd_no, die_no, supplier, plant, submitted_at, prepared_by,
            approval_state, assigned_approver
       FROM quality_discrepancies
      WHERE approval_state = 'Pending'
      ORDER BY submitted_at DESC NULLS LAST, id DESC`
  );
  return rows.filter((r) => isInApprovalQueue(r, userId));
}
```

Then add both names to the `module.exports` block (the line that currently reads
`submitForApproval, approveQD, sendBack, canActOnApproval, excludeDrafts, onlyDrafts,`):

```js
  submitForApproval, approveQD, sendBack, canActOnApproval, excludeDrafts, onlyDrafts,
  isInApprovalQueue, listPendingApprovals,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 5 new tests, and the pre-existing 199 still green.

- [ ] **Step 5: Add the endpoint**

In `server/routes/quality-discrepancies.cjs`, insert this immediately **above** the
`// GET /api/quality-discrepancies/:id/document` comment (line 457):

```js
// GET /api/quality-discrepancies/pending-approvals
// The signed-in approver's queue, for the Alerts bell and the QD Tracker banner.
// Must stay ahead of the :id routes so it isn't swallowed by that param route.
router.get('/pending-approvals', async (req, res) => {
  try {
    // Not being an approver is a normal state, not an error: an ordinary user's
    // browser polls this every minute and must get a quiet zero, not a 403.
    const eligible = await listEligibleApprovers();
    if (!eligible.some((a) => a.id === req.user?.id)) return res.json({ count: 0, qds: [] });
    const qds = await qd.listPendingApprovals(pool, req.user.id);
    res.json({ count: qds.length, qds });
  } catch (e) {
    console.error('Pending approvals error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 6: Verify the endpoint answers**

The backend runs in Docker and port 3001 is not published, so exercise it through
the running container:

```bash
docker exec die-ordering-backend node -e "const{pool}=require('/app/db.cjs');const q=require('/app/services/qualityDiscrepancies.cjs');(async()=>{console.log(await q.listPendingApprovals(pool,1));process.exit(0)})()"
```

Expected: an array of the Pending QDs assigned to user 1 or unassigned. (The
route itself is exercised from the browser in Task 2 — the dev server proxies to
this same backend.)

- [ ] **Step 7: Commit**

```bash
git add server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs server/routes/quality-discrepancies.cjs
git commit -m "feat(qd): endpoint for an approver's pending queue"
```

---

### Task 2: The hook and the Alerts bell

**Files:**
- Modify: `src/api.js` (inside `qualityDiscrepanciesAPI`, which starts at line 659)
- Create: `src/hooks/usePendingApprovals.js`
- Modify: `src/DieOrderingSystem.jsx` (`hasPageAccess` at line 1858; `notificationDropdown` at line 2559; `totalNotifications` at line 2579; `<TopBar>` at line ~2827)
- Modify: `src/components/layout/TopBar.jsx` (props at line 22; `totalNotifications` at line 46)

**Interfaces:**
- Consumes: `GET /quality-discrepancies/pending-approvals` from Task 1; `hasPageAccess(pageId)` (already defined in `DieOrderingSystem.jsx:1858`).
- Produces:
  - `qualityDiscrepanciesAPI.pendingApprovals(): Promise<{count, qds}>`
  - default export `usePendingApprovals(enabled: boolean) → { count, qds, refresh }`
  - `TopBar` prop `qdApprovalCount: number` (default `0`)

- [ ] **Step 1: Add the API method**

In `src/api.js`, inside `qualityDiscrepanciesAPI`, directly after the `listApprovers` method, add:

```js
    // The signed-in user's approval queue. Answers { count: 0, qds: [] } for a
    // user who is not an approver, so callers need no role check of their own.
    pendingApprovals: async () =>
        apiRequest('/quality-discrepancies/pending-approvals'),
```

- [ ] **Step 2: Create the hook**

Create `src/hooks/usePendingApprovals.js`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { qualityDiscrepanciesAPI } from '../api';

const POLL_MS = 60000;

// The approver's pending queue, shared by the Alerts bell and the QD Tracker
// banner so the two can never disagree.
//
// `enabled` MUST be false for users without qd-tracker access: the endpoint sits
// behind pageAccessMiddleware('qd-tracker'), so polling on their behalf would
// 403 once a minute for their whole session.
export default function usePendingApprovals(enabled) {
  const [state, setState] = useState({ count: 0, qds: [] });

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await qualityDiscrepanciesAPI.pendingApprovals();
      setState({ count: r.count || 0, qds: r.qds || [] });
    } catch {
      // A failed poll must never break the top bar. The next tick retries, and
      // showing a stale count beats showing an error in a notification bell.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    // Returning to the tab is exactly when the count is most likely stale.
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh]);

  return { count: state.count, qds: state.qds, refresh };
}
```

- [ ] **Step 3: Wire the hook in DieOrderingSystem**

In `src/DieOrderingSystem.jsx`, add the import beside the other hook/component imports (after the `FrozenDesignBanner` import on line 30):

```jsx
import usePendingApprovals from './hooks/usePendingApprovals';
```

Then, immediately after the `hasPageAccess` callback definition (it ends at line ~1869), add:

```jsx
  // Polled only for users who can actually reach the QD Tracker — the endpoint
  // is gated on that page, so anyone else would just collect 403s.
  const pendingApprovals = usePendingApprovals(isLoggedIn && hasPageAccess('qd-tracker'));
```

- [ ] **Step 4: Add the bell section and fold it into the count**

In the `notificationDropdown` IIFE, change the `totalNotifications` line (2579) from:

```jsx
    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length;
```

to:

```jsx
    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length + pendingApprovals.count;
```

Then, inside the dropdown body, immediately after `<>` on line 2707 (before the
`{/* Design Overdue Section */}` comment), insert:

```jsx
              {pendingApprovals.count > 0 && (
                <>
                  <div style={{
                    background: 'rgba(234,179,8,0.1)', borderRadius: '12px',
                    padding: '12px 16px', margin: '8px', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <ClipboardCheck size={16} color="#EAB308" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#EAB308' }}>
                        QDs awaiting your approval - {pendingApprovals.count}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: 0 }}>Click one to open it</p>
                  </div>
                  {pendingApprovals.qds.map((q) => (
                    <div key={`qd-approval-${q.id}`} style={{ margin: '4px 8px' }}>
                      <div onClick={() => { setActiveTab('qd-tracker'); setShowNotifications(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 16px', borderRadius: '10px',
                          background: 'transparent', cursor: 'pointer'
                        }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, #EAB308, #F59E0B)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700, color: 'white'
                        }}>{(q.supplier || '??').substring(0, 2)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{q.qd_no || 'Draft'}</div>
                          <div style={{ fontSize: '0.7rem', color: theme.textDim }}>
                            Die {q.die_no} · {q.supplier}{q.prepared_by ? ` · from ${q.prepared_by}` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
```

Add `ClipboardCheck` to the lucide-react import on line 2 of the same file.

Note the `totalNotifications === 0` branch above already handles the empty case,
and now correctly accounts for approvals because the count includes them.

- [ ] **Step 5: Pass the count to TopBar so the badge agrees**

`TopBar` computes its own badge total from its props, so it must be told. In the
`<TopBar` element (around line 2827, beside `notificationDropdown={notificationDropdown}`), add:

```jsx
          qdApprovalCount={pendingApprovals.count}
```

In `src/components/layout/TopBar.jsx`, add `qdApprovalCount = 0,` to the destructured
props (the block starting line 22, beside `notificationDropdown`), and change line 46 from:

```jsx
    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length;
```

to:

```jsx
    // Must match the dropdown's own total in DieOrderingSystem, or the badge
    // promises a number the panel does not show.
    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length + qdApprovalCount;
```

- [ ] **Step 6: Lint and build**

Run:

```bash
npx eslint src/api.js src/hooks/usePendingApprovals.js src/DieOrderingSystem.jsx src/components/layout/TopBar.jsx && npm run build
```

Expected: no new errors (`src/api.js:424` is pre-existing), build succeeds.

- [ ] **Step 7: Verify in the browser**

The dev server proxies `/api` to `localhost:3001`, which is **not published to the
host**. Before starting it, change the `target` in `vite.config.js` to
`http://localhost:80` (nginx proxies `/api/` to the backend) and **revert it when
finished** — it must not be committed. Start the preview (config `vite`, port 5173)
and ask the user to log in; do not attempt a password.

Then, with at least one Pending QD assigned to the logged-in user or unassigned:

1. The Alerts bell shows a red badge including the QD count.
2. Opening the bell shows a "QDs awaiting your approval - N" section listing each QD with its number, die and supplier.
3. Clicking a row navigates to the QD Tracker.
4. In the console, `await (await fetch('/api/quality-discrepancies/pending-approvals',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}})).json()` returns the same count the badge shows.

- [ ] **Step 8: Commit**

```bash
git add src/api.js src/hooks/usePendingApprovals.js src/DieOrderingSystem.jsx src/components/layout/TopBar.jsx
git commit -m "feat(qd): show QDs awaiting approval in the Alerts bell"
```

---

### Task 3: The QD Tracker banner and the deep link

**Files:**
- Create: `src/components/qd/ApprovalQueueBanner.jsx`
- Modify: `src/pages/QDTrackerPage.jsx` (props at line ~59; `selectedId` at line 72; `selected` at line 159; `FocPendingPanel` at line 274; `QDDetailPanel` at line 480)
- Modify: `src/DieOrderingSystem.jsx` (the bell row `onClick` from Task 2; the `<QDTrackerPage>` element at line 2925)

**Interfaces:**
- Consumes: `usePendingApprovals` from Task 2 (`{ count, qds, refresh }`); `setSelectedId` (existing `QDTrackerPage` state).
- Produces: default export `ApprovalQueueBanner({ qds, theme, onOpen })`; `QDTrackerPage` props `pendingApprovals` and `focusQdId` / `onFocusHandled`.

- [ ] **Step 1: Create the banner**

Create `src/components/qd/ApprovalQueueBanner.jsx`:

```jsx
import React from 'react';
import { ClipboardCheck } from 'lucide-react';

// "These are waiting on you." Rendered as nothing when the queue is empty —
// unlike FocPendingPanel, whose zero is itself an answer, an empty approval
// queue is just noise on a page you are already looking at.
export default function ApprovalQueueBanner({ qds = [], theme = {}, onOpen }) {
  if (!qds.length) return null;

  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  return (
    <div style={{ border: '1px solid rgba(234,179,8,0.35)', background: 'rgba(234,179,8,0.08)', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
      <style>{`.qd-approval-row:hover { background: rgba(234,179,8,0.10); }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <ClipboardCheck size={16} style={{ color: '#EAB308' }} />
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#EAB308', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Awaiting your approval
        </span>
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: '#EAB308', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {qds.length}
        </span>
      </div>
      {qds.map((q) => (
        <div key={q.id} className="qd-approval-row" onClick={() => onOpen && onOpen(q.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 6px', borderRadius: 8, cursor: onOpen ? 'pointer' : 'default' }}>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: text, minWidth: 96 }}>{q.qd_no || '—'}</span>
          <span style={{ fontSize: 12.5, color: muted }}>Die {q.die_no}</span>
          <span style={{ fontSize: 12.5, color: muted }}>{q.supplier}</span>
          <span style={{ fontSize: 11.5, color: dim, marginLeft: 'auto' }}>
            {q.prepared_by ? `from ${q.prepared_by}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Render it on the QD Tracker, and accept the deep link**

In `src/pages/QDTrackerPage.jsx`:

Add the import after the `FocPendingPanel` import (line 10):

```jsx
import ApprovalQueueBanner from '../components/qd/ApprovalQueueBanner';
```

Extend the component's props (line ~59) from `{ user, theme, onCompose }` to:

```jsx
export default function QDTrackerPage({ user, theme, onCompose, pendingApprovals = null, focusQdId = null, onFocusHandled }) {
```

Replace the `selected` line (159):

```jsx
  const selected = data.qds.find(q => q.id === selectedId) || null;
```

with:

```jsx
  // The deep link from the Alerts bell is *derived*, not copied into state by an
  // effect: setting state in an effect is an extra render and a lint error here
  // (react-hooks/set-state-in-effect). Closing the drawer clears both, or the
  // fallback would immediately reopen it.
  const openId = selectedId ?? focusQdId ?? null;
  const selected = data.qds.find(q => q.id === openId) || null;
```

Render the banner immediately above the `FocPendingPanel` line (274):

```jsx
          {!showDrafts && pendingApprovals && (
            <ApprovalQueueBanner qds={pendingApprovals.qds} theme={theme} onOpen={setSelectedId} />
          )}
```

Finally, on the `<QDDetailPanel>` (line 480), make close clear both ids and refresh
the queue. Change its `onClose` and `onChanged` props to:

```jsx
          onClose={() => { setSelectedId(null); onFocusHandled?.(); }}
          onChanged={async () => { await load(); pendingApprovals?.refresh?.(); }}
```

If `onChanged` currently passes something other than `load`, keep the existing call
and add the `pendingApprovals?.refresh?.()` line after it — the point is that
approving or sending back updates the queue at once instead of up to 60s later.

- [ ] **Step 3: Pass the props from DieOrderingSystem**

In `src/DieOrderingSystem.jsx`, add the focus state beside the other page state
(directly after the `pendingApprovals` hook line added in Task 2):

```jsx
  // Which QD a notification asked us to open, handed to the QD Tracker once.
  const [focusQdId, setFocusQdId] = useState(null);
```

Change the bell row's `onClick` (added in Task 2, Step 4) from:

```jsx
                      <div onClick={() => { setActiveTab('qd-tracker'); setShowNotifications(false); }}
```

to:

```jsx
                      <div onClick={() => { setFocusQdId(q.id); setActiveTab('qd-tracker'); setShowNotifications(false); }}
```

And extend the `<QDTrackerPage>` element (line 2925):

```jsx
            <QDTrackerPage
              user={user}
              theme={theme}
              onCompose={(prefill) => setShowEmailCompose(prefill || {})}
              pendingApprovals={pendingApprovals}
              focusQdId={focusQdId}
              onFocusHandled={() => setFocusQdId(null)}
            />
```

- [ ] **Step 4: Lint and build**

Run:

```bash
npx eslint src/components/qd/ApprovalQueueBanner.jsx src/pages/QDTrackerPage.jsx src/DieOrderingSystem.jsx && npm run build
```

Expected: no new errors, build succeeds.

- [ ] **Step 5: Verify in the browser**

With the dev proxy pointed at port 80 as in Task 2 (revert it afterwards), and at
least one Pending QD in the logged-in user's queue:

1. The QD Tracker shows an amber "Awaiting your approval" banner listing the QDs.
2. Clicking a banner row opens that QD's drawer.
3. From another page, clicking the same QD in the Alerts bell lands on the QD Tracker **with that QD's drawer already open**.
4. Closing the drawer leaves it closed — it must not immediately reopen from the deep link.
5. Approving that QD (or sending it back) makes the banner row and the badge disappear without a page reload.
6. Switch to the Drafts view: the banner is hidden there.

- [ ] **Step 6: Revert the dev proxy**

`vite.config.js`'s proxy target must be back to `http://localhost:3001`. Confirm
with `git status` that `vite.config.js` is **not** modified before committing.

- [ ] **Step 7: Commit**

```bash
git add src/components/qd/ApprovalQueueBanner.jsx src/pages/QDTrackerPage.jsx src/DieOrderingSystem.jsx
git commit -m "feat(qd): approval queue banner on the QD Tracker, with deep link"
```

---

## Self-review

**Spec coverage.** Derived not stored → no table in any task; the hook holds the only state. Queue rule narrower than the permission rule → Task 1 `isInApprovalQueue`, with the admin case explicitly asserted against `canActOnApproval` in the same test. Endpoint above `/:id` → Task 1 Step 5. Inherits `pageAccessMiddleware('qd-tracker')` → nothing in the plan adds a second gate; the non-approver case returns a quiet zero instead. Poll 60s + window focus → Task 2 Step 2. Poll only with page access → Task 2 Step 3 (`isLoggedIn && hasPageAccess('qd-tracker')`). Bell section + badge → Task 2 Steps 4-5. Banner hidden at zero → Task 3 Step 1 (`if (!qds.length) return null`). Both surfaces open the drawer → Task 3 Steps 2-3. `onChanged` refreshes → Task 3 Step 2. Tests for the five listed cases → Task 1 Step 1.

**Placeholders.** None: every code step carries literal code, every verification step names the click and the expected result.

**Type consistency.** `isInApprovalQueue(row, userId)` and `listPendingApprovals(client, userId)` are named identically in Task 1's Produces block and Task 2's usage. The hook returns `{ count, qds, refresh }` and every consumer uses exactly those three. `qdApprovalCount` is the TopBar prop in both the passing site (Task 2 Step 5, `DieOrderingSystem`) and the receiving site (`TopBar`). `pendingApprovals` is passed to `QDTrackerPage` as the whole hook object, and Task 3 uses `pendingApprovals.qds` and `pendingApprovals.refresh` — consistent with that shape, not with a bare array.

**Known deviation from the skill's default.** Tasks 2 and 3 have no test-first cycle: the repo has no frontend test runner and the spec forbids adding one. Their gate is lint on touched files, `npm run build`, and the scripted browser checks. Task 1, which is backend, is fully test-first.
