# QD approval notifications — design

**Date:** 2026-07-31
**Status:** approved, not implemented

## Problem

`POST /api/quality-discrepancies/:id/submit` assigns the QD number, sets
`assigned_approver`, writes a timeline entry — and tells the approver nothing.
There is no notification of any kind. An approver learns that work is waiting
only by opening the QD Tracker and noticing a Pending badge, or by the raiser
walking over to say so.

This is the other half of the problem the in-app form preview solved. The
preview stopped the approver having to *ask for details*; it did nothing about
them not knowing there was anything to look at.

The app already has an Alerts bell in the top bar, with a red badge count and a
dropdown grouped by category. It covers overdue designs and pending ordering.
QDs are not in it.

## Decisions taken

1. **Derived, not stored.** No notifications table, no read/unread state, no
   dismiss. The bell answers "QDs waiting on you right now": an entry appears
   when a QD is submitted and disappears when it is approved or sent back.
2. **The queue rule is narrower than the permission rule.** A QD is in your
   queue when it is Pending **and** (`assigned_approver` is you **or** it is
   NULL), and you are an eligible approver. Admins do **not** get other people's
   assigned QDs in their queue.
3. **Two surfaces, one source of truth:** the existing Alerts bell (visible from
   every page) and a banner on the QD Tracker page.
4. **Scope:** no desktop notifications, no email to the approver.

Decision 1 follows the Alerts dropdown that already exists, which is computed
from loaded order data on every render and stores nothing. It also removes the
question a stored design would force: what happens to an unread notification
when the QD is approved by someone else? Derived, the question cannot arise —
the row is gone because the work is gone.

The cost is real and accepted: there is no "new since you last looked", and no
way to dismiss an entry. Dismissing an approval you still owe would be a bug
dressed as a feature.

Decision 2 exists because `canActOnApproval(user, row)` returns `true` for any
admin on any QD — correct for permissions, wrong for a personal work queue. An
admin's power to act on someone else's QD is an escape hatch for an absent
approver, not a daily inbox. The two rules look like they should be the same
function and deliberately are not.

Decision 4 is forced by the deployment, not by preference. `nginx.conf` listens
on port 80 with no TLS anywhere in the stack, so anyone reaching the app at
`http://<server-ip>` is in an insecure browser context, where the Notifications
API is unavailable and the permission prompt never appears. Desktop
notifications require HTTPS first; they are a separate piece of work.

## Architecture

### Backend — one new endpoint

`GET /api/quality-discrepancies/pending-approvals`

```json
{ "count": 2,
  "qds": [{ "id": 55, "qd_no": "2026AD-01", "die_no": "013794-123",
            "supplier": "ADEX", "plant": "GEX 1",
            "submitted_at": "2026-07-30T09:12:00.000Z", "prepared_by": "jaypee" }] }
```

Newest first. Backed by `listPendingApprovals(client, user)` in
`server/services/qualityDiscrepancies.cjs`, beside the other approval helpers.

Two placement constraints, both already established in this file:

- The route must be declared **above** the `/:id` routes, or the param route
  shadows it — exactly as the `/document` route already notes.
- It inherits `pageAccessMiddleware('qd-tracker')` from the router mount in
  `server/index.cjs`, so a user without QD access is refused by construction
  rather than by a check inside the handler.

Eligibility reuses the existing `listEligibleApprovers()` (admins ∪ the users an
admin ticked in Settings). A caller who is not eligible gets `{ count: 0, qds: [] }`
rather than a 403 — not being an approver is a normal state, not an error.

### Frontend — one hook, two surfaces

`src/hooks/usePendingApprovals.js` → `{ count, qds, refresh }`

- Polls every 60 seconds and on window focus. Without polling, an approver
  sitting on the Dashboard would never learn of a submission.
- Runs **only when `hasPageAccess('qd-tracker')`** (the callback already exists
  in `DieOrderingSystem.jsx`). Otherwise it would 403 in a loop, once a minute,
  for every user who cannot see QDs.
- One source of truth, so the bell and the banner cannot disagree.

**Alerts bell** — a "QDs awaiting your approval" section in the existing
dropdown, its count added to the red badge.

**QD Tracker banner** — an amber strip above the register when the count is
above zero, listing each waiting QD. Rendered as nothing at zero: an empty
"no notifications" box is noise on the page you are already looking at.

Both surfaces' rows open that QD's drawer. The QD page's existing `onChanged`
calls `refresh`, so approving a QD clears it at once instead of leaving it on
screen for up to a minute.

## Testing

`listPendingApprovals` gets `node:test` coverage against a mocked pool, matching
the other QD service tests. The cases that matter:

- a Pending QD assigned to the caller is included;
- a Pending QD assigned to **someone else** is excluded **even for an admin** —
  this is the whole point of decision 2 and the thing a later refactor would
  most plausibly break by "simplifying" it to `canActOnApproval`;
- an unassigned Pending QD is included for any eligible approver;
- a Draft, Approved or SentBack QD never appears;
- a caller who is not an eligible approver gets zero.

The frontend has no test framework (`npm test` runs `node --test "server/**/*.test.cjs"`),
so the hook, bell and banner are verified by `npm run build`, lint on the touched
files, and a browser click-through: submit a QD, confirm the badge and banner
appear without a page reload, click through to the drawer, approve, and confirm
both clear.

## Out of scope

**Desktop notifications** — blocked on HTTPS, as above.

**Email to the assigned approver on submit.** Still the only channel that
reaches someone who is not logged in. `users.email` and the send-back notifier
(`notifySendBack`) already exist, so this is a small piece of work; it is left
out here only because the bell and banner were the ask.

**The raiser is still not told when their QD is approved.** Approval emails
Purchase and sends the raiser nothing. Symmetrical to this problem and
unaddressed by this design.
