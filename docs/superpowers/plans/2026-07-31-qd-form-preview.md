# QD form preview for the approver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone open the rendered QD form inside the app, so an approver can read every detail and decide without leaving the drawer or asking the raiser.

**Architecture:** Frontend only. `GET /api/quality-discrepancies/:id/document` already renders the form live from the record and already sets `Content-Disposition: inline` — this plan adds no endpoint and changes no server code. The PDF is fetched in JS (the route is behind `authMiddleware` and needs a Bearer header, which an `<iframe>` cannot send), turned into an object URL, and shown in a full-screen modal whose footer carries Approve / Send back.

**Tech Stack:** React 19, Vite (rolldown-vite), lucide-react icons, inline style objects (no CSS framework), `useDialog` for modal behaviour.

**Spec:** `docs/superpowers/specs/2026-07-31-qd-form-preview-design.md`

## Global Constraints

- **Branch:** `feat/qd-form-preview` (already created; the spec commit `6ba54ed` is on it).
- **No new dependencies.** Do not add a PDF library, a test runner, or anything else to `package.json`. The browser's built-in PDF viewer renders the iframe.
- **No server changes.** Do not touch anything under `server/`. If a task seems to need a backend change, stop and report — the design says it does not.
- **There is no frontend test framework.** `npm test` is `node --test "server/**/*.test.cjs"` and covers server code only. Adding one would break the no-new-dependencies constraint. So each task's verification is: `npm run lint`, `npm run build`, and the scripted browser check written into the task. Do not claim a task passes without running all three.
- **Theming:** read colours from the `theme` prop with a fallback, exactly as the existing QD components do: `theme.cardBg || '#09090b'`, `theme.cardBorder || '#27272a'`, `theme.text || '#fafafa'`, `theme.textMuted || '#a1a1aa'`. Never hardcode a colour that `theme` supplies.
- **Styling is inline style objects.** This codebase does not use CSS classes for layout; follow `src/components/qd/FocTrialModal.jsx`.
- **Every modal uses `useDialog`** (`src/hooks/useDialog.js`) for Escape, focus trap, and scroll lock, and renders `role="dialog" aria-modal="true"` with the returned ref.
- **Commit after every task**, on the branch above.

## File structure

| file | responsibility | task |
| --- | --- | --- |
| `src/api.js` (modify, ~line 766-780) | one authenticated fetch of the rendered form, exposed as a blob and as an object URL | 1 |
| `src/components/qd/QDFormPreviewModal.jsx` (create) | full-screen viewer: fetch, render, loading/error, download, approver footer | 2, 3 |
| `src/components/qd/QDDetailPanel.jsx` (modify) | the *Preview QD form* button, the modal's open state, and bridging its actions to the panel's existing approve / send-back handlers | 2, 3 |

---

### Task 1: Share one authenticated fetch for the rendered form

`downloadDocument` currently inlines its own `fetch`. The preview needs the same bytes, so extract the fetch once — two copies could drift and show the approver something different from what Purchase receives.

**Files:**
- Modify: `src/api.js:766-780` (inside `export const qualityDiscrepanciesAPI`, which starts at line 659)

**Interfaces:**
- Consumes: `API_BASE_URL` (`src/api.js:5`), `getToken` (`src/api.js:8`) — both already in scope in this module.
- Produces:
  - `qualityDiscrepanciesAPI.documentBlob(id): Promise<Blob>` — throws `Error('Document failed (HTTP <status>)')` on a non-OK response.
  - `qualityDiscrepanciesAPI.documentUrl(id): Promise<string>` — an object URL the **caller must revoke**.
  - `qualityDiscrepanciesAPI.downloadDocument(id, qdNo): Promise<void>` — unchanged behaviour and signature.

- [ ] **Step 1: Replace the `downloadDocument` block**

Replace lines 766-780 of `src/api.js` (the comment plus the whole `downloadDocument` property) with:

```js
    // One authenticated fetch of the rendered QD form, shared by the download and
    // the in-app preview so the two can never show different bytes. The route is
    // behind authMiddleware and needs this Bearer header — which is exactly why
    // the preview cannot point an <iframe> straight at the API.
    documentBlob: async (id) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/quality-discrepancies/${id}/document`, {
            headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (!response.ok) throw new Error(`Document failed (HTTP ${response.status})`);
        return response.blob();
    },

    // Object URL for the preview iframe. The caller owns it and MUST call
    // URL.revokeObjectURL on it — otherwise every re-open strands another copy
    // of the PDF in memory for the life of the tab.
    documentUrl: async (id) =>
        URL.createObjectURL(await qualityDiscrepanciesAPI.documentBlob(id)),

    // Streams the rendered QD form as a PDF and triggers a browser download.
    downloadDocument: async (id, qdNo) => {
        const blob = await qualityDiscrepanciesAPI.documentBlob(id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `QD-${qdNo || id}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    },
```

`documentUrl` referring to `qualityDiscrepanciesAPI` from inside its own object literal is fine — the const is bound long before any call.

- [ ] **Step 2: Lint and build**

Run:

```bash
npm run lint && npm run build
```

Expected: both succeed. A `no-undef` on `qualityDiscrepanciesAPI` would mean the property was pasted outside the object — check the braces.

- [ ] **Step 3: Verify the download still works**

Start the dev server (preview tool, config `vite`, port 5173), log in, open QD Tracker, open any QD, click **Download QD PDF**.

Expected: a file named `QD-<number>.pdf` downloads and opens as the two-page form — identical behaviour to before. This is a refactor; a change here is a regression.

- [ ] **Step 4: Commit**

```bash
git add src/api.js
git commit -m "refactor(qd): share one authenticated fetch for the rendered form"
```

---

### Task 2: The preview modal, opened from the drawer

Ships the viewer itself: fetch, render, loading and error states, download, close. No approve/send-back yet — that is Task 3, so a reviewer can judge the viewer on its own.

**Files:**
- Create: `src/components/qd/QDFormPreviewModal.jsx`
- Modify: `src/components/qd/QDDetailPanel.jsx` (imports at lines 2-15; actions row ends line 415; modal rendering area near line 635)

**Interfaces:**
- Consumes: `qualityDiscrepanciesAPI.documentUrl(id)` and `.downloadDocument(id, qdNo)` from Task 1; `useDialog({ open, onClose })` from `src/hooks/useDialog.js`.
- Produces: default export `QDFormPreviewModal({ qd, theme, mayApprove, busy, onApprove, onSendBack, onClose })`. Task 3 supplies `mayApprove`, `busy`, `onApprove`, `onSendBack`; this task passes only `qd`, `theme`, `onClose`.

- [ ] **Step 1: Create the component**

Create `src/components/qd/QDFormPreviewModal.jsx` with exactly this content:

```jsx
import React, { useEffect, useState } from 'react';
import { X, Download, RefreshCw, Check, CornerUpLeft } from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import useDialog from '../../hooks/useDialog';

// The QD form as it will actually be issued, shown where the decision is made.
//
// It renders the real PDF rather than re-drawing the fields in HTML on purpose:
// the QD is a certification record, and a preview that can disagree with the
// document Purchase receives would be worse than no preview at all.
export default function QDFormPreviewModal({
  qd, theme = {}, mayApprove = false, busy = false, onApprove, onSendBack, onClose,
}) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); // bumped by Retry to refetch

  const dialogRef = useDialog({ open: true, onClose });

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';

  // One fetch per open (or per Retry). The object URL is revoked on teardown —
  // without that, every re-open would strand another copy of the PDF in memory.
  useEffect(() => {
    let cancelled = false;
    let created = '';
    setLoading(true);
    setError('');
    qualityDiscrepanciesAPI.documentUrl(qd.id)
      .then((u) => {
        created = u;
        if (cancelled) { URL.revokeObjectURL(u); return; }
        setUrl(u);
      })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not render the QD form'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [qd.id, attempt]);

  const download = async () => {
    try {
      await qualityDiscrepanciesAPI.downloadDocument(qd.id, qd.qd_no);
    } catch (e) {
      setError(e.message || 'Could not download the QD form');
    }
  };

  const btn = {
    padding: '8px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 8,
    color: muted, fontWeight: 500, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
  };
  const centre = {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexDirection: 'column', gap: 12, color: muted, fontSize: 13.5,
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
        aria-label={`QD form preview ${qd.qd_no || 'draft'}`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '92vw', height: '92vh', background: bg, border: `1px solid ${border}`, borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', color: text, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>QD form — {qd.qd_no || 'Draft'}</div>
            <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>
              {qd.status}{qd.approval_state ? ` · ${qd.approval_state}` : ''} · Die {qd.die_no} · {qd.supplier}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* Always available: a browser that will not render a PDF inline shows
                an empty frame rather than firing an error, so the way out must not
                live behind the error state. */}
            <button type="button" onClick={download} style={btn}>
              <Download size={15} /> Download PDF
            </button>
            <button type="button" onClick={onClose} aria-label="Close preview"
              style={{ width: 34, height: 34, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#334155' }}>
          {loading && <div style={centre}>Rendering the QD form…</div>}
          {!loading && error && (
            <div style={centre}>
              <span style={{ color: '#FCA5A5' }}>{error}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setAttempt((a) => a + 1)} style={btn}>
                  <RefreshCw size={15} /> Retry
                </button>
                <button type="button" onClick={download} style={btn}>
                  <Download size={15} /> Download instead
                </button>
              </div>
            </div>
          )}
          {!loading && !error && url && (
            <iframe src={`${url}#view=FitH`} title="QD form preview"
              style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </div>
      </div>
    </div>
  );
}
```

`Check` and `CornerUpLeft` are imported for Task 3's footer. If `npm run lint` flags them as unused in this task, leave the import as is and let Task 3 use them — do not chase the warning by deleting and re-adding.

- [ ] **Step 2: Import it in the drawer**

In `src/components/qd/QDDetailPanel.jsx`, add `Eye` to the lucide import (line 2-6 block) — put it beside `Download` on line 5 so it reads `Download, Eye,`. Then add this import after the `FocRounds` import on line 12:

```jsx
import QDFormPreviewModal from './QDFormPreviewModal';
```

- [ ] **Step 3: Add the open state**

In `QDDetailPanel`, directly after `const [sendBackReason, setSendBackReason] = useState('');` (line 89) add:

```jsx
  // Nothing is fetched until this opens — a QD drawer must not pay for a
  // server-side PDF render that nobody asked for.
  const [previewOpen, setPreviewOpen] = useState(false);
```

- [ ] **Step 4: Add the button to the actions row**

In the actions row, immediately after the `Download QD PDF` button (which closes at line 409 with `</button>`) and before the status `<select>`, insert:

```jsx
          <button onClick={() => setPreviewOpen(true)} className="qd-action" title="Read the QD form without leaving the app"
            style={{ padding: '8px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Eye size={15} /> Preview QD form
          </button>
```

- [ ] **Step 5: Render the modal**

In the same file, immediately before the `{sendBackOpen && (` block (line 635), insert:

```jsx
      {previewOpen && (
        <QDFormPreviewModal
          qd={qd}
          theme={theme}
          onClose={() => setPreviewOpen(false)}
        />
      )}
```

- [ ] **Step 6: Lint and build**

Run:

```bash
npm run lint && npm run build
```

Expected: both succeed.

- [ ] **Step 7: Verify in the browser**

Start the dev server (preview tool, config `vite`, port 5173), log in, open QD Tracker, open a QD, click **Preview QD form**. Check all five:

1. The modal fills most of the window and the two-page form renders, with the letterhead and the Part-A/Part-B values legible.
2. The header shows the QD number, status and die number.
3. **Download PDF** in the header still downloads the file.
4. **Esc** closes the preview and leaves the drawer open behind it — it must not close the drawer too.
5. Re-open the preview 3 times, then run this in the console — it confirms the object URLs are being revoked rather than accumulating:

```js
performance.getEntriesByType('resource').filter(r => r.name.startsWith('blob:')).length
```

Take a screenshot of the rendered form for the commit review.

- [ ] **Step 8: Commit**

```bash
git add src/components/qd/QDFormPreviewModal.jsx src/components/qd/QDDetailPanel.jsx
git commit -m "feat(qd): preview the rendered QD form inside the app"
```

---

### Task 3: Approve and send back from the preview

Without this the approver still closes the preview to act, which is the round trip the feature exists to remove.

**Files:**
- Modify: `src/components/qd/QDFormPreviewModal.jsx` (add the footer before the closing `</div>` of the dialog box)
- Modify: `src/components/qd/QDDetailPanel.jsx` (the `<QDFormPreviewModal …>` added in Task 2)

**Interfaces:**
- Consumes: `mayApprove`, `busy`, `onApprove`, `onSendBack` — already in the component signature from Task 2; the panel's existing `handleApprove` (line 310) and `setSendBackOpen` (line 88).
- Produces: nothing new.

- [ ] **Step 1: Add the footer to the modal**

In `src/components/qd/QDFormPreviewModal.jsx`, insert this immediately after the Body `</div>` and before the dialog box's closing `</div>`:

```jsx
        {/* Reading the form and acting on it are one task — an approver who has
            to close the preview to decide is back where they started. */}
        {mayApprove && qd.approval_state === 'Pending' && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 20px', borderTop: `1px solid ${border}`, flexShrink: 0 }}>
            <button type="button" onClick={onSendBack} disabled={busy}
              style={{ ...btn, cursor: busy ? 'wait' : 'pointer' }}>
              <CornerUpLeft size={15} /> Send back
            </button>
            <button type="button" onClick={onApprove} disabled={busy}
              style={{ padding: '8px 14px', background: '#22C55E', border: 'none', borderRadius: 8, color: '#052e16', fontWeight: 600, fontSize: 13, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={15} /> Approve &amp; send to Purchase
            </button>
          </div>
        )}
```

The green is the same `#22C55E` on `#052e16` as the drawer's Approve button (`QDDetailPanel.jsx:444`) — the two must not look like different actions.

- [ ] **Step 2: Wire the panel's handlers**

In `src/components/qd/QDDetailPanel.jsx`, replace the `<QDFormPreviewModal …>` block from Task 2 with:

```jsx
      {previewOpen && (
        <QDFormPreviewModal
          qd={qd}
          theme={theme}
          mayApprove={mayApprove}
          busy={busy}
          onApprove={async () => { setPreviewOpen(false); await handleApprove(); }}
          onSendBack={() => { setPreviewOpen(false); setSendBackOpen(true); }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
```

Both close the preview first, deliberately: `handleApprove` reports a failed Purchase email into the drawer's error line, and the send-back reason box lives in the drawer — either one left underneath an open preview would be invisible.

- [ ] **Step 3: Lint and build**

Run:

```bash
npm run lint && npm run build
```

Expected: both succeed, with no unused-import warning for `Check` or `CornerUpLeft` now that the footer uses them.

- [ ] **Step 4: Verify the approver path in the browser**

Log in as a user who is the assigned approver of a **Pending** QD (or as an admin, who can always act). Open that QD, click **Preview QD form**:

1. The footer shows **Send back** and **Approve & send to Purchase**.
2. Click **Approve**: the preview closes, the drawer refreshes, the badge becomes **Approved**, and the timeline gains the approval entry. If the Purchase email fails, the drawer shows `Approved, but the Purchase email failed: …` — that is correct behaviour, not a bug in this task.
3. Re-open the preview on the now-Approved QD: **the footer is gone** (it is gated on `Pending`).
4. On a second Pending QD, click **Send back**: the preview closes and the reason box opens; submitting a reason sets the badge to **Sent back**.
5. Open a **Draft** QD as its raiser: the preview renders, and there is **no footer** — a draft is nobody's to approve.

- [ ] **Step 5: Commit**

```bash
git add src/components/qd/QDFormPreviewModal.jsx src/components/qd/QDDetailPanel.jsx
git commit -m "feat(qd): approve or send back straight from the form preview"
```

---

## Self-review

**Spec coverage.** Preview the real PDF → Task 2. Everyone, collapsed by default → Task 2 Steps 3-4 (`previewOpen` starts false, button unconditional). Full-screen modal → Task 2 Step 1 (`92vw × 92vh`). Approve/Send back in the footer → Task 3. Blob URL because of the Bearer header → Task 1. Shared fetch so preview and download cannot diverge → Task 1. Not reusing `PDFViewer.jsx` → honoured; the new component has no notes pane and no signature canvas. Send back reuses the drawer's reason box → Task 3 Step 2. No schema change, no endpoint, no dependency → nothing in any task touches `server/` or `package.json`.

**Placeholders.** None: every code step carries the literal code, and every verification step names what to click and what to expect.

**Type consistency.** `documentBlob` / `documentUrl` / `downloadDocument` are named identically in Task 1's Produces block and in Tasks 2-3's usage. The modal's props (`qd`, `theme`, `mayApprove`, `busy`, `onApprove`, `onSendBack`, `onClose`) match between the component signature in Task 2 and the call site in Task 3. `mayApprove` is the panel's existing variable name (`QDDetailPanel.jsx:105`), not `canApprove` — the prop and the panel-level fallback are different things and must not be confused.

**Known deviation from the skill's default.** No test-first cycle: this repo has no frontend test runner and the spec forbids adding one. Verification is lint + build + the scripted browser checks in each task. Do not report a task complete on lint and build alone.
