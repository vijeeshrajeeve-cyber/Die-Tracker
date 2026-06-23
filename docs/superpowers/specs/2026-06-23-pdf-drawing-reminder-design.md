# PDF Drawing Request Reminder — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Scope:** Frontend-only change to `src/components/email/EmailInbox.jsx`

## Problem

PDF Drawing Requests are sent manually from the Backup Die Requests page
("Request PDF Drawings" → composes an email to the Design Team and stamps a
`Drawing Requested` date). There is currently no way to follow up when the
drawings don't come back. The user wants a **"Send Reminder"** option in the
Email Inbox to chase a specific, already-sent PDF Drawing Request — re-sending
all the die numbers that were in the original email.

## Decisions (from brainstorming)

- **Trigger style:** Manual button only. No scheduler, no automation.
- **Scope of a reminder:** Per-email. The reminder targets one specific sent
  PDF Drawing Request email and includes all the die numbers that were in that
  original email.
- **Button placement:** Inside the opened email (thread view).
- **Send behavior:** Opens the existing Compose window pre-filled; the user can
  tweak before sending.

## Solution

Frontend-only. No backend, DB, or API changes — `onCompose` and
`emailAPI.sendEmail` already provide everything needed. The opened email object
already carries the full `body_content` (the inbox endpoint returns `SELECT *`),
so the original die-number table is reused verbatim with no re-query.

### 1. Detecting a PDF Drawing Request email

In the thread/detail view (`selectedEmail` is set), show the button only when:

```js
const isPdfDrawingRequest =
  (selectedEmail?.subject || '').includes('PDF Drawing Request');
```

The sent subject is always `URGENT: PDF Drawing Request for N Backup Die
Request(s)`, so a substring match is reliable. For any other email, the button
does not render.

### 2. The "Send Reminder" button

Rendered in the thread-view header area (next to "Back to Inbox"). On click it
builds a prefill and calls `onCompose(prefill)`.

### 3. Building the reminder prefill

From `selectedEmail`:

- **to** → parsed `to_addresses`
- **cc** → parsed `cc_addresses`
- **subject** → `REMINDER: <original subject>`, but if the subject already
  starts with `REMINDER:` (case-insensitive), don't add it again
- **body** → a reminder note (HTML `<p>`) prepended to the original
  `body_content`. Falls back to `body_preview` if `body_content` is empty.
  This carries every die number from the original email automatically.
- **importance** → `'high'`
- **isHtml** → `true`
- **orderId** → `selectedEmail.order_id || null` (preserve linkage)

Reminder note text:

> This is a reminder regarding our earlier PDF drawing request below. The
> drawings for the die number(s) listed are still pending — please share them at
> the earliest.

### 4. Guard

`onCompose` is an optional prop. The button only renders when `onCompose` is
provided (consistent with the existing Compose button).

## Out of scope (YAGNI)

- Automatic / scheduled reminders
- A "reminder sent" tracking column or counter
- Threading the reminder onto the original via `conversation_id` (Compose sends
  a fresh email; the `REMINDER:` subject conveys intent)
- A per-row "Remind" button in the list (chosen: opened-email only)

## Testing

No backend test framework change. Verify with `npm run lint` + `npm run build`
(no frontend component test framework in this repo). Manual smoke check: open a
sent PDF Drawing Request email → confirm "Send Reminder" appears → click →
confirm Compose opens with same recipients, `REMINDER:` subject, and the full
die table in the body. Confirm the button is absent on a non-PDF-Drawing-Request
email.
