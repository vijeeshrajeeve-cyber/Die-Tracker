# PDF Drawing Request Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Send Reminder" button to an opened PDF Drawing Request email in the Email Inbox that opens Compose pre-filled with the same recipients and the original die-number table.

**Architecture:** Frontend-only change to the thread/detail view of `src/components/email/EmailInbox.jsx`. When the opened email's subject contains `"PDF Drawing Request"`, render a button that builds a prefill object from the opened email (`to_addresses`, `cc_addresses`, `body_content`) and calls the existing `onCompose(prefill)` prop. No backend, DB, or API changes — `onCompose` and `emailAPI.sendEmail` already exist.

**Tech Stack:** React (function component, inline styles, `lucide-react` icons). No frontend test framework in this repo; verification is `npm run lint` + `npm run build`.

## Global Constraints

- No backend, DB schema, or API changes. Frontend only.
- Match existing `EmailInbox.jsx` style: inline `style={{}}` objects, `theme.*` tokens, `lucide-react` icons. No new dependencies.
- The button must render ONLY for PDF Drawing Request emails and ONLY when the `onCompose` prop is provided.
- Reuse the existing `parseAddresses` helper (parses a JSON-array string like `to_addresses`/`cc_addresses` into a comma-joined string) — do not write a new parser.
- Reuse the original email's full `body_content` (NOT `body_preview`, which is truncated to 500 chars) so every die number is included.
- Verification command for the whole plan: `npm run lint && npm run build` (run from repo root `C:/Users/vijee/Desktop/18.06.2026/Die-Tracker`).

---

### Task 1: Add "Send Reminder" button to the opened PDF Drawing Request email

**Files:**
- Modify: `src/components/email/EmailInbox.jsx` (imports line 2; thread-view block lines ~92-153)

**Interfaces:**
- Consumes: the `onCompose` prop already destructured in `EmailInbox({ theme, onCompose })` (line 5). `onCompose(prefill)` where `prefill` is `{ to, cc, subject, body, importance, isHtml, orderId }` — exactly the shape `EmailCompose` reads (`src/components/email/EmailCompose.jsx:6-14`).
- Consumes: existing `parseAddresses(json)` helper (line 55) and `selectedEmail` state (line 12).
- Produces: no exported interface (self-contained UI addition).

- [ ] **Step 1: Add the `Bell` icon to the lucide-react import**

In `src/components/email/EmailInbox.jsx` line 2, add `Bell` to the existing import list:

```js
import { Mail, Send, Inbox, ArrowLeft, ExternalLink, Link2, RefreshCw, ChevronLeft, ChevronRight, Filter, Bell } from 'lucide-react';
```

- [ ] **Step 2: Add a reminder-builder helper inside the component**

Inside the `EmailInbox` component, after the `parseAddresses` helper (after line 58), add a function that detects a PDF Drawing Request email and sends a pre-filled reminder via `onCompose`. Paste exactly:

```js
    // A reminder applies only to a sent "PDF Drawing Request" email. The sent
    // subject is always "URGENT: PDF Drawing Request for N Backup Die Request(s)".
    const isPdfDrawingRequest = (email) =>
        !!email && (email.subject || '').includes('PDF Drawing Request');

    const handleSendReminder = (email) => {
        if (!onCompose || !email) return;
        const rawSubject = email.subject || 'PDF Drawing Request';
        const subject = /^reminder:/i.test(rawSubject) ? rawSubject : `REMINDER: ${rawSubject}`;
        const reminderNote =
            '<p>This is a reminder regarding our earlier PDF drawing request below. ' +
            'The drawings for the die number(s) listed are still pending — please share them at the earliest.</p>';
        onCompose({
            to: parseAddresses(email.to_addresses),
            cc: parseAddresses(email.cc_addresses),
            subject,
            body: reminderNote + (email.body_content || email.body_preview || ''),
            importance: 'high',
            isHtml: true,
            orderId: email.order_id || null,
        });
    };
```

- [ ] **Step 3: Render the button in the thread-view header**

In the thread view (the `if (selectedEmail)` block), replace the existing "Back to Inbox" button (lines 95-102) so the Back button and a conditional "Send Reminder" button sit in one row. Replace this:

```jsx
                <button onClick={() => { setSelectedEmail(null); setThreadEmails([]); }} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'none', border: 'none', color: theme.primary,
                    cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500,
                    marginBottom: '1rem', padding: 0
                }}>
                    <ArrowLeft size={18} /> Back to Inbox
                </button>
```

with:

```jsx
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '1rem', gap: '12px'
                }}>
                    <button onClick={() => { setSelectedEmail(null); setThreadEmails([]); }} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        background: 'none', border: 'none', color: theme.primary,
                        cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500,
                        padding: 0
                    }}>
                        <ArrowLeft size={18} /> Back to Inbox
                    </button>
                    {onCompose && isPdfDrawingRequest(selectedEmail) && (
                        <button onClick={() => handleSendReminder(selectedEmail)} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 18px', borderRadius: '10px', border: 'none',
                            background: 'linear-gradient(135deg, #F59E0B, #EF4444)',
                            color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                            boxShadow: '0 4px 12px rgba(239,68,68,0.3)'
                        }}>
                            <Bell size={16} /> Send Reminder
                        </button>
                    )}
                </div>
```

- [ ] **Step 4: Verify lint and build pass**

Run from the repo root:

```bash
npm run lint && npm run build
```

Expected: lint reports no new errors for `EmailInbox.jsx`; build completes successfully (exit 0). If `node_modules` is missing, run `npm install` first.

- [ ] **Step 5: Commit**

```bash
git add src/components/email/EmailInbox.jsx
git commit -m "feat(email): add Send Reminder button for PDF Drawing Request emails"
```

---

## Self-Review

**1. Spec coverage:**
- "Button inside the opened email, only for PDF Drawing Request" → Task 1 Step 3 (`onCompose && isPdfDrawingRequest(selectedEmail)` guard). ✓
- "Detect by subject containing 'PDF Drawing Request'" → Step 2 `isPdfDrawingRequest`. ✓
- "Open Compose pre-filled" → Step 2 `onCompose({...})`. ✓
- "Same To/CC" → `parseAddresses(email.to_addresses)` / `cc_addresses`. ✓
- "REMINDER: subject, no double prefix" → `/^reminder:/i` guard. ✓
- "All die numbers from original included" → reuse `email.body_content`. ✓
- "importance high, isHtml true, orderId preserved" → present in prefill. ✓
- "Guard when onCompose absent" → `if (!onCompose ...) return;` plus render guard. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; all code is concrete. ✓

**3. Type consistency:** `handleSendReminder` / `isPdfDrawingRequest` named consistently between Step 2 (definition) and Step 3 (usage). Prefill keys (`to, cc, subject, body, importance, isHtml, orderId`) match `EmailCompose` reads. ✓
