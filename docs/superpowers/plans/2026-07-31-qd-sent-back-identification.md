# Identifying sent-back QDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a sent-back QD visible at a glance in the register, and put it in front of the person who has to fix it.

**Architecture:** The badge vocabulary moves out of the drawer into shared constants so the register can use the same one. The day-old `/pending-approvals` endpoint generalizes into `/my-queue`, returning two buckets — QDs awaiting my approval and QDs sent back to me — from a single poll, each governed by its own unit-tested predicate.

**Tech Stack:** Express 5 + node-postgres, React 19, Vite, lucide-react, `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-31-qd-sent-back-identification-design.md`

## Global Constraints

- **Branch:** `feat/qd-sent-back-identification` (already created; the spec commit is on it).
- **No new dependencies, no schema change.** Every column used (`approval_state`, `created_by`, `sent_back_reason`, `submitted_at`, `prepared_by`) already exists.
- **`npm test` must stay green** (`node --test "server/**/*.test.cjs"`); it is at 204 passing before this work.
- **Lint gate is "no *new* errors in the files you touch"** — `npm run lint` fails repo-wide on ~76 pre-existing errors. Check with `npx eslint <file>`. Known pre-existing: `src/api.js:424`, and 12 in `src/DieOrderingSystem.jsx`.
- **Never call setState synchronously in a `useEffect` body** — `react-hooks/set-state-in-effect` is an error here. Defer with `setTimeout(fn, 0)`, as `useQdQueue` and `QDTrackerPage` already do.
- **Styling is inline style objects** reading `theme` with fallbacks (`theme.cardBg || '#09090b'`, `theme.text || '#fafafa'`, `theme.textMuted || '#a1a1aa'`, `theme.textDim || '#71717a'`).
- **Browser verification needs the dev proxy pointed at nginx:** set `vite.config.js`'s target to `http://localhost:80`, and **revert it to `http://localhost:3001` before committing**. Port 3001 is not published to the host.
- **The backend container must be rebuilt** for any browser check of a backend change: `docker compose build backend && docker compose up -d backend`. A plain `restart` re-runs the old image.
- **Commit after every task.**

## File structure

| file | responsibility | task |
| --- | --- | --- |
| `src/utils/constants.js` (modify) | `QD_APPROVAL_BADGE` + `QD_LIST_BADGE_STATES`, the one badge vocabulary | 1 |
| `src/components/qd/QDDetailPanel.jsx` (modify) | drops its private `A_BADGE`, imports the shared one | 1 |
| `src/pages/QDTrackerPage.jsx` (modify) | pill in the QD No cells; later, two queue banners | 1, 3 |
| `server/services/qualityDiscrepancies.cjs` (modify) | `isSentBackToMe` + `listMyQueue` | 2 |
| `server/services/qualityDiscrepancies.test.cjs` (modify) | locks both queue rules | 2 |
| `server/routes/quality-discrepancies.cjs` (modify) | `/pending-approvals` → `/my-queue` | 3 |
| `src/api.js` (modify) | `myQueue()` replaces `pendingApprovals()` | 3 |
| `src/hooks/useQdQueue.js` (rename from `usePendingApprovals.js`) | one poll, two buckets, `total` | 3 |
| `src/components/qd/QdQueueBanner.jsx` (rename from `ApprovalQueueBanner.jsx`) | one titled/toned bucket, rendered twice | 3 |
| `src/DieOrderingSystem.jsx` (modify) | second bell section, `total` into the badge | 3 |
| `src/components/layout/TopBar.jsx` (modify) | prop renamed to `qdQueueCount` | 3 |

**Why Task 3 is large and cannot be split:** renaming the route, the API client and the hook must land together. Any split leaves a commit where the frontend calls a route that no longer exists — unbuildable history, and a bisect trap.

---

### Task 1: One badge vocabulary, used by the register

Pure frontend, no API involvement. Deliverable: a sent-back QD is identifiable in the list.

**Files:**
- Modify: `src/utils/constants.js` (append; the file currently ends with `QD_ACTIVITY_TONES`)
- Modify: `src/components/qd/QDDetailPanel.jsx` (the private `A_BADGE` at lines 23-28; its use at `const aBadge = ...`)
- Modify: `src/pages/QDTrackerPage.jsx` (register cell at line 352; supplier-drilldown cell at line 487)

**Interfaces:**
- Produces:
  - `QD_APPROVAL_BADGE: Record<'Draft'|'Pending'|'Approved'|'SentBack', { label, bg, fg }>`
  - `QD_LIST_BADGE_STATES: string[]` — the subset the list shows.

- [ ] **Step 1: Add the shared vocabulary**

Append to `src/utils/constants.js`:

```js
// Approval-state pill, shared by the QD drawer header and the register so the
// two cannot drift apart. Moved here from QDDetailPanel, where it was private
// and the register would have needed a second copy.
export const QD_APPROVAL_BADGE = {
  Draft:    { label: 'Draft',     bg: 'rgba(161,161,170,0.15)', fg: '#a1a1aa' },
  Pending:  { label: 'Pending',   bg: 'rgba(234,179,8,0.15)',   fg: '#EAB308' },
  Approved: { label: 'Approved',  bg: 'rgba(34,197,94,0.15)',   fg: '#22C55E' },
  SentBack: { label: 'Sent back', bg: 'rgba(239,68,68,0.15)',   fg: '#EF4444' },
};

// Which of those the register marks. Approved is left out on purpose: most QDs
// end up approved, and a pill on nearly every row teaches the eye to skip it.
export const QD_LIST_BADGE_STATES = ['Draft', 'Pending', 'SentBack'];
```

- [ ] **Step 2: Point the drawer at it**

In `src/components/qd/QDDetailPanel.jsx`, delete this block entirely (lines 22-28):

```jsx
// Approval-state pill shown next to the status badge in the header.
const A_BADGE = {
  Draft:    { label: 'Draft',     bg: 'rgba(161,161,170,0.15)', fg: '#a1a1aa' },
  Pending:  { label: 'Pending',   bg: 'rgba(234,179,8,0.15)',   fg: '#EAB308' },
  Approved: { label: 'Approved',  bg: 'rgba(34,197,94,0.15)',   fg: '#22C55E' },
  SentBack: { label: 'Sent back', bg: 'rgba(239,68,68,0.15)',   fg: '#EF4444' },
};
```

Add `QD_APPROVAL_BADGE` to the existing import from `'../../utils/constants'`, so that line reads:

```jsx
import { QD_STATUS_CONFIG, QD_STATUSES, QD_ACTIVITY_TONES, QD_OUTCOMES, QD_PROGRESS_FIELDS, QD_APPROVAL_BADGE } from '../../utils/constants';
```

Then change the one use from `A_BADGE[qd.approval_state]` to:

```jsx
  const aBadge = QD_APPROVAL_BADGE[qd.approval_state] || null;
```

- [ ] **Step 3: Put the pill in the register**

In `src/pages/QDTrackerPage.jsx`, add both names to the existing constants import:

```jsx
import { QD_STATUS_CONFIG, QD_STATUSES, QD_APPROVAL_BADGE, QD_LIST_BADGE_STATES } from '../utils/constants';
```

Just above the component's `return`, add the shared renderer so both call sites
use identical markup:

```jsx
  // Marks a QD that is not simply approved. Rendered inside the QD No cell
  // rather than as a 14th column — the table is already wide, and this is where
  // the eye lands when scanning for a particular QD.
  const approvalPill = (state) => {
    if (!QD_LIST_BADGE_STATES.includes(state)) return null;
    const b = QD_APPROVAL_BADGE[state];
    return (
      <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', background: b.bg, color: b.fg }}>
        {b.label}
      </span>
    );
  };
```

Replace the register cell (line 352):

```jsx
                      <td style={td}><span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{q.qd_no}</span></td>
```

with:

```jsx
                      <td style={td}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{q.qd_no}</span>
                          {approvalPill(q.approval_state)}
                        </span>
                      </td>
```

Replace the supplier-drilldown cell (line 487):

```jsx
                  <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600 }}>{q.qd_no}</span>
```

with:

```jsx
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600 }}>{q.qd_no}</span>
                    {approvalPill(q.approval_state)}
                  </span>
```

Both lists get it deliberately: a marker that appears in one list and not the
other is worse than no marker, because it reads as "this QD is fine".

- [ ] **Step 4: Lint and build**

```bash
npx eslint src/utils/constants.js src/components/qd/QDDetailPanel.jsx src/pages/QDTrackerPage.jsx && npm run build
```

Expected: no errors from these three files; build succeeds.

- [ ] **Step 5: Verify in the browser**

Point the dev proxy at port 80 (see Global Constraints), start the preview
(config `vite`, port 5173), and ask the user to log in — do not attempt a
password. No backend rebuild is needed; this task is frontend-only.

Two QDs are currently `SentBack` — `2026AD-01` and `2026AD-02`. Confirm:

1. Both show a red **Sent back** pill beside their number in the register.
2. Approved QDs show **no** pill.
3. Opening one still shows the same red "Sent back" pill in the drawer header — the drawer must look exactly as it did before this refactor.

Revert `vite.config.js` before committing.

- [ ] **Step 6: Commit**

```bash
git add src/utils/constants.js src/components/qd/QDDetailPanel.jsx src/pages/QDTrackerPage.jsx
git commit -m "feat(qd): mark pending and sent-back QDs in the register"
```

---

### Task 2: The rework predicate and both queues

Backend only, test-first. The existing `/pending-approvals` route and
`listPendingApprovals` are left untouched, so nothing breaks between tasks.

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs` (beside `listPendingApprovals`, which ends at line 710; export block at the bottom)
- Modify: `server/services/qualityDiscrepancies.test.cjs` (append)

**Interfaces:**
- Consumes: `isInApprovalQueue(row, userId)` — already exported.
- Produces:
  - `isSentBackToMe(row, userId): boolean`
  - `listMyQueue(client, userId, { isApprover }): Promise<{ awaitingApproval: Row[], sentBack: Row[] }>`

- [ ] **Step 1: Write the failing tests**

Append to `server/services/qualityDiscrepancies.test.cjs`:

```js
// "Is this mine to fix?" — the counterpart of isInApprovalQueue's "is this mine
// to approve". Being an approver or an admin has nothing to do with it.
test('a QD I raised and had sent back is mine to fix', () => {
  assert.equal(q.isSentBackToMe({ approval_state: 'SentBack', created_by: 7 }, 7), true);
});

test('someone else\'s sent-back QD is not mine to fix, admin or not', () => {
  assert.equal(q.isSentBackToMe({ approval_state: 'SentBack', created_by: 9 }, 7), false);
});

test('only SentBack QDs count as rework', () => {
  for (const state of ['Draft', 'Pending', 'Approved']) {
    assert.equal(q.isSentBackToMe({ approval_state: state, created_by: 7 }, 7), false, state);
  }
});

test('listMyQueue splits the two buckets from one query', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [
        { id: 1, approval_state: 'Pending',  assigned_approver: 7,    created_by: 3 },
        { id: 2, approval_state: 'Pending',  assigned_approver: null, created_by: 3 },
        { id: 3, approval_state: 'Pending',  assigned_approver: 9,    created_by: 3 },
        { id: 4, approval_state: 'SentBack', assigned_approver: 9,    created_by: 7 },
        { id: 5, approval_state: 'SentBack', assigned_approver: 9,    created_by: 3 },
      ] };
    },
  };
  const out = await q.listMyQueue(client, 7, { isApprover: true });
  assert.equal(calls.length, 1, 'both buckets must come from a single query');
  assert.deepEqual(out.awaitingApproval.map((r) => r.id), [1, 2]);
  assert.deepEqual(out.sentBack.map((r) => r.id), [4]);
});

test('a non-approver still gets their own sent-back QDs', async () => {
  // Raising a QD does not require being an approver, so the rework bucket must
  // not be gated on approver eligibility the way the approval bucket is.
  const client = {
    query: async () => ({ rows: [
      { id: 1, approval_state: 'Pending',  assigned_approver: null, created_by: 3 },
      { id: 4, approval_state: 'SentBack', assigned_approver: 9,    created_by: 7 },
    ] }),
  };
  const out = await q.listMyQueue(client, 7, { isApprover: false });
  assert.deepEqual(out.awaitingApproval, []);
  assert.deepEqual(out.sentBack.map((r) => r.id), [4]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `q.isSentBackToMe is not a function`.

- [ ] **Step 3: Implement**

In `server/services/qualityDiscrepancies.cjs`, immediately after
`listPendingApprovals` (which closes at line 710), add:

```js
// "Is this mine to fix?" — the counterpart of isInApprovalQueue's "is this mine
// to approve". Strictly the raiser: an approver or an admin looking at someone
// else's returned QD has nothing to do about it.
function isSentBackToMe(row, userId) {
  return !!row && row.approval_state === 'SentBack' && row.created_by === userId;
}

// Both of a user's queues from one query, so the Alerts bell polls once a
// minute rather than twice. Draft rows are excluded: they are the owner's own
// unsubmitted work and belong to the Drafts view, not to a queue.
//
// `isApprover` gates only the approval bucket. Raising a QD does not require
// being an approver, so the rework bucket is computed for everyone.
async function listMyQueue(client, userId, { isApprover = false } = {}) {
  const { rows } = await client.query(
    `SELECT id, qd_no, die_no, supplier, plant, submitted_at, prepared_by,
            approval_state, assigned_approver, created_by, sent_back_reason
       FROM quality_discrepancies
      WHERE approval_state IN ('Pending', 'SentBack')
      ORDER BY submitted_at DESC NULLS LAST, id DESC`
  );
  return {
    awaitingApproval: isApprover ? rows.filter((r) => isInApprovalQueue(r, userId)) : [],
    sentBack: rows.filter((r) => isSentBackToMe(r, userId)),
  };
}
```

Extend the export line that currently reads
`isInApprovalQueue, listPendingApprovals,` to:

```js
  isInApprovalQueue, listPendingApprovals, isSentBackToMe, listMyQueue,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 209 tests, 0 failures (204 before, 5 added).

- [ ] **Step 5: Commit**

```bash
git add server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): rework queue predicate, and both queues from one query"
```

---

### Task 3: Switch over to /my-queue and surface the rework bucket

One commit by necessity: the route, the API client and the hook rename together.

**Files:**
- Modify: `server/routes/quality-discrepancies.cjs` (the `/pending-approvals` route at lines 457-472)
- Modify: `server/services/qualityDiscrepancies.cjs` (delete the now-unused `listPendingApprovals` and its export)
- Modify: `src/api.js` (the `pendingApprovals` method)
- Rename: `src/hooks/usePendingApprovals.js` → `src/hooks/useQdQueue.js`
- Rename: `src/components/qd/ApprovalQueueBanner.jsx` → `src/components/qd/QdQueueBanner.jsx`
- Modify: `src/pages/QDTrackerPage.jsx`, `src/DieOrderingSystem.jsx`, `src/components/layout/TopBar.jsx`

**Interfaces:**
- Consumes: `qd.listMyQueue(client, userId, { isApprover })` from Task 2; `listEligibleApprovers()` in the route file (line 244).
- Produces:
  - `GET /api/quality-discrepancies/my-queue` → `{ awaitingApproval: { count, qds }, sentBack: { count, qds } }`
  - `qualityDiscrepanciesAPI.myQueue()`
  - `useQdQueue(enabled) → { awaitingApproval: { count, qds }, sentBack: { count, qds }, total, refresh }`
  - `QdQueueBanner({ title, tone, qds, theme, onOpen })` where `tone` is `'amber' | 'red'`

- [ ] **Step 1: Replace the route**

In `server/routes/quality-discrepancies.cjs`, replace the whole
`/pending-approvals` route (the comment block plus the handler, lines 457-472)
with:

```js
// GET /api/quality-discrepancies/my-queue
// What this user personally owes: QDs awaiting their approval, and QDs of
// theirs an approver sent back. One route so the Alerts bell polls once.
// Must stay ahead of the :id routes so it isn't swallowed by that param route.
router.get('/my-queue', async (req, res) => {
  try {
    // Not being an approver is a normal state, not an error: an ordinary user's
    // browser polls this every minute and must get a quiet zero, not a 403.
    // Their rework bucket is still computed — anyone can raise a QD.
    const eligible = await listEligibleApprovers();
    const isApprover = eligible.some((a) => a.id === req.user?.id);
    const { awaitingApproval, sentBack } = await qd.listMyQueue(pool, req.user?.id, { isApprover });
    res.json({
      awaitingApproval: { count: awaitingApproval.length, qds: awaitingApproval },
      sentBack: { count: sentBack.length, qds: sentBack },
    });
  } catch (e) {
    console.error('My queue error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

Then delete `listPendingApprovals` from `server/services/qualityDiscrepancies.cjs`
(lines 701-710, the comment block plus the function) and remove the name from the
export line, leaving:

```js
  isInApprovalQueue, isSentBackToMe, listMyQueue,
```

- [ ] **Step 2: Replace the API client method**

In `src/api.js`, replace:

```js
    // The signed-in user's approval queue. Answers { count: 0, qds: [] } for a
    // user who is not an approver, so callers need no role check of their own.
    pendingApprovals: async () =>
        apiRequest('/quality-discrepancies/pending-approvals'),
```

with:

```js
    // What this user personally owes: QDs awaiting their approval, and QDs of
    // theirs that were sent back. Both buckets come back empty rather than
    // erroring for a user with neither, so callers need no role check.
    myQueue: async () =>
        apiRequest('/quality-discrepancies/my-queue'),
```

- [ ] **Step 3: Rename and widen the hook**

```bash
git mv src/hooks/usePendingApprovals.js src/hooks/useQdQueue.js
```

Replace the file's contents with:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { qualityDiscrepanciesAPI } from '../api';

const POLL_MS = 60000;
const EMPTY = { awaitingApproval: { count: 0, qds: [] }, sentBack: { count: 0, qds: [] } };

// What the signed-in user personally owes, shared by the Alerts bell and the QD
// Tracker banners so they can never disagree. One request covers both buckets.
//
// `enabled` MUST be false for users without qd-tracker access: the endpoint sits
// behind pageAccessMiddleware('qd-tracker'), so polling on their behalf would
// 403 once a minute for their whole session.
export default function useQdQueue(enabled) {
  const [state, setState] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await qualityDiscrepanciesAPI.myQueue();
      setState({
        awaitingApproval: { count: r.awaitingApproval?.count || 0, qds: r.awaitingApproval?.qds || [] },
        sentBack: { count: r.sentBack?.count || 0, qds: r.sentBack?.qds || [] },
      });
    } catch {
      // A failed poll must never break the top bar. The next tick retries, and
      // showing a stale count beats showing an error in a notification bell.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    // The first fetch is kicked off a tick late rather than called straight from
    // the effect body: refresh() reaches setState, and this repo's lint counts
    // any setState reachable from an effect body as a cascading render.
    const kick = setTimeout(refresh, 0);
    const id = setInterval(refresh, POLL_MS);
    // Returning to the tab is exactly when the counts are most likely stale.
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh]);

  return {
    awaitingApproval: state.awaitingApproval,
    sentBack: state.sentBack,
    total: state.awaitingApproval.count + state.sentBack.count,
    refresh,
  };
}
```

- [ ] **Step 4: Rename and generalize the banner**

```bash
git mv src/components/qd/ApprovalQueueBanner.jsx src/components/qd/QdQueueBanner.jsx
```

Replace the file's contents with:

```jsx
import React from 'react';
import { ClipboardCheck, CornerUpLeft } from 'lucide-react';

// One bucket of "things you owe", rendered as nothing when empty — unlike
// FocPendingPanel, whose zero is itself an answer, an empty queue is just noise
// on a page you are already looking at.
const TONES = {
  amber: { border: 'rgba(234,179,8,0.35)', bg: 'rgba(234,179,8,0.08)', fg: '#EAB308', hover: 'rgba(234,179,8,0.10)', Icon: ClipboardCheck },
  red:   { border: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.08)', fg: '#F87171', hover: 'rgba(239,68,68,0.10)', Icon: CornerUpLeft },
};

export default function QdQueueBanner({ title, tone = 'amber', qds = [], theme = {}, onOpen }) {
  if (!qds.length) return null;

  const t = TONES[tone] || TONES.amber;
  const Icon = t.Icon;
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const rowClass = `qd-queue-row-${tone}`;

  return (
    <div style={{ border: `1px solid ${t.border}`, background: t.bg, borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
      <style>{`.${rowClass}:hover { background: ${t.hover}; }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <Icon size={16} style={{ color: t.fg }} />
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: t.fg, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.fg, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {qds.length}
        </span>
      </div>
      {qds.map((q) => (
        <div key={q.id} className={rowClass} onClick={() => onOpen && onOpen(q.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 6px', borderRadius: 8, cursor: onOpen ? 'pointer' : 'default' }}>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: text, minWidth: 96 }}>{q.qd_no || '—'}</span>
          <span style={{ fontSize: 12.5, color: muted }}>Die {q.die_no}</span>
          <span style={{ fontSize: 12.5, color: muted }}>{q.supplier}</span>
          {/* Why it came back, so the raiser can triage without opening each one. */}
          <span style={{ fontSize: 11.5, color: dim, marginLeft: 'auto', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {q.sent_back_reason ? q.sent_back_reason : (q.prepared_by ? `from ${q.prepared_by}` : '')}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Render both banners on the QD Tracker**

In `src/pages/QDTrackerPage.jsx`, change the import:

```jsx
import QdQueueBanner from '../components/qd/QdQueueBanner';
```

Rename the prop `pendingApprovals` to `qdQueue` in the signature:

```jsx
export default function QDTrackerPage({ user, theme = {}, onCompose, qdQueue = null, focusQdId = null, onFocusHandled }) {
```

Replace the single banner block with two:

```jsx
          {/* What is waiting on this user personally. Hidden on the drafts
              view, which is their own unsubmitted work, not anyone's queue. */}
          {!showDrafts && qdQueue && (
            <>
              <QdQueueBanner title="Awaiting your approval" tone="amber"
                qds={qdQueue.awaitingApproval.qds} theme={theme} onOpen={setSelectedId} />
              <QdQueueBanner title="Sent back to you — needs rework" tone="red"
                qds={qdQueue.sentBack.qds} theme={theme} onOpen={setSelectedId} />
            </>
          )}
```

And update the two other references to the old prop name — the drawer's
`onChanged` becomes:

```jsx
          onChanged={async () => { await load(); qdQueue?.refresh?.(); }}
```

- [ ] **Step 6: Update DieOrderingSystem — hook, bell section, badge**

In `src/DieOrderingSystem.jsx`:

Change the import to `import useQdQueue from './hooks/useQdQueue';`, and the call to:

```jsx
  const qdQueue = useQdQueue(isLoggedIn && hasPageAccess('qd-tracker'));
```

Change the dropdown's total from `+ pendingApprovals.count` to `+ qdQueue.total`:

```jsx
    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length + qdQueue.total;
```

In the dropdown body, change the existing approvals block's guard and data from
`pendingApprovals.count` / `pendingApprovals.qds` to `qdQueue.awaitingApproval.count`
/ `qdQueue.awaitingApproval.qds`, then add this second section directly beneath it:

```jsx
              {qdQueue.sentBack.count > 0 && (
                <>
                  <div style={{
                    background: 'rgba(239,68,68,0.1)', borderRadius: '12px',
                    padding: '12px 16px', margin: '8px', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <CornerUpLeft size={16} color="#EF4444" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#EF4444' }}>
                        Sent back to you - {qdQueue.sentBack.count}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: 0 }}>Needs rework before it can go again</p>
                  </div>
                  {qdQueue.sentBack.qds.map((q) => (
                    <div key={`qd-sentback-${q.id}`} style={{ margin: '4px 8px' }}>
                      <div onClick={() => { setFocusQdId(q.id); setActiveTab('qd-tracker'); setShowNotifications(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 16px', borderRadius: '10px',
                          background: 'transparent', cursor: 'pointer'
                        }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, #EF4444, #F97316)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700, color: 'white'
                        }}>{(q.supplier || '??').substring(0, 2)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{q.qd_no || 'Draft'}</div>
                          <div style={{ fontSize: '0.7rem', color: theme.textDim }}>
                            Die {q.die_no}{q.sent_back_reason ? ` · ${q.sent_back_reason}` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
```

Add `CornerUpLeft` to the lucide-react import on line 2.

Update the `<TopBar>` prop to `qdQueueCount={qdQueue.total}`, and the
`<QDTrackerPage>` prop to `qdQueue={qdQueue}`.

- [ ] **Step 7: Update TopBar's prop name**

In `src/components/layout/TopBar.jsx`, rename the destructured prop
`qdApprovalCount = 0,` to `qdQueueCount = 0,` and update the total:

```jsx
    // Must match the dropdown's own total in DieOrderingSystem, or the badge
    // promises a number the panel does not show.
    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length + qdQueueCount;
```

- [ ] **Step 8: Check nothing still references the old names**

```bash
grep -rn "pendingApprovals\|usePendingApprovals\|ApprovalQueueBanner\|qdApprovalCount\|pending-approvals\|listPendingApprovals" src server --include=*.js --include=*.jsx --include=*.cjs
```

Expected: no output. Any hit is a dangling reference to something this task renamed.

- [ ] **Step 9: Tests, lint and build**

```bash
npm test
npx eslint src/api.js src/hooks/useQdQueue.js src/components/qd/QdQueueBanner.jsx src/pages/QDTrackerPage.jsx src/DieOrderingSystem.jsx src/components/layout/TopBar.jsx
npm run build
```

Expected: 209 tests pass; no new lint errors (12 pre-existing in `DieOrderingSystem.jsx`, 1 in `api.js`); build succeeds.

- [ ] **Step 10: Verify in the browser**

This task changes the backend, so rebuild it first:

```bash
docker compose build backend && docker compose up -d backend
```

Point the dev proxy at port 80, start the preview, ask the user to log in. With
`2026AD-01` and `2026AD-02` currently `SentBack` and raised by `admin`:

1. The bell badge counts both buckets; the dropdown shows an amber "QDs awaiting your approval" section and a red "Sent back to you - 2" section listing both QDs with their reasons.
2. The QD Tracker shows both banners, red listing the two sent-back QDs with reasons.
3. Clicking a sent-back row — in either surface — opens that QD's drawer, showing the existing "Sent back: <reason>" callout.
4. In the console, `await (await fetch('/api/quality-discrepancies/my-queue',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}})).json()` returns both buckets, and `/pending-approvals` now 404s.

Revert `vite.config.js` before committing.

- [ ] **Step 11: Commit**

```bash
git add -A src server
git commit -m "feat(qd): surface sent-back QDs to their raiser via /my-queue"
```

---

## Self-review

**Spec coverage.** Pill beside the QD number → Task 1 Step 3. Approved shows no pill → `QD_LIST_BADGE_STATES` omits it. `A_BADGE` shared not copied → Task 1 Steps 1-2. Sent-back queue belongs to the raiser alone → Task 2's `isSentBackToMe`, with the "someone else's, admin or not" test. One endpoint generalized → Task 3 Step 1. `sent_back_reason` returned so surfaces can show why → Task 2's SELECT, rendered in Task 3 Steps 4 and 6. Non-approver still gets their rework bucket → Task 2 Step 1's last test and the route's `isApprover` gate. Rename lands in one commit → Task 3 is a single commit by construction. Tests for all five listed cases → Task 2 Step 1.

**Placeholder scan.** None: every code step carries literal code; every verification step names the action and the expected result.

**Type consistency.** `isSentBackToMe` / `listMyQueue` are named identically in Task 2's Produces block and Task 3's usage. The route returns `{ awaitingApproval: { count, qds }, sentBack: { count, qds } }` and the hook reads exactly those paths. The hook exposes `{ awaitingApproval, sentBack, total, refresh }`; `DieOrderingSystem` uses `qdQueue.total`, `qdQueue.awaitingApproval.qds`, `qdQueue.sentBack.qds`, and `QDTrackerPage` uses `qdQueue.awaitingApproval.qds`, `qdQueue.sentBack.qds`, `qdQueue.refresh` — all present. `QdQueueBanner` takes `{ title, tone, qds, theme, onOpen }` and both call sites pass exactly those. The TopBar prop is `qdQueueCount` at both the passing and receiving site. Task 3 Step 8's grep is the mechanical check that no old name survives.

**Known deviation from the skill's default.** Tasks 1 and 3 have no test-first cycle for their frontend parts: this repo has no frontend test runner and the spec forbids adding one. Task 2, which holds all the new logic, is fully test-first — the frontend tasks are wiring and markup, gated by lint, build, the rename grep, and the scripted browser checks.
