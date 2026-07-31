# Identifying sent-back QDs — design

**Date:** 2026-07-31
**Status:** approved, not implemented

## Problem

A QD an approver hands back is invisible until someone opens it.

`approval_state` has carried `SentBack` since the approval workflow was built, and
the detail drawer shows both a red "Sent back" pill and the reason. But:

- **The register renders `approval_state` nowhere.** A sent-back QD is one
  indistinguishable row among the rest. Nothing in the list says this QD is stuck
  in rework and belongs to nobody until its raiser picks it up.
- **The Drafts view does not cover it.** That filter fetches `?drafts=1`, the
  owner's *unsubmitted* QDs. A sent-back QD has been submitted and has a number,
  so it is excluded — it sits in the main register instead, unmarked.
- **The raiser gets no in-app signal.** `notifySendBack` emails them (added
  2026-07-28) when `users.email` is set and SMTP works; the app itself says
  nothing. The Alerts bell learned about *approvals* on 2026-07-31 and does not
  know about rework.

So the QD most in need of someone's attention is the one hardest to find.

## Decisions taken

1. **A pill beside the QD number, not a new column.** Shown for `Pending`
   (amber) and `SentBack` (red) only.
2. **`Approved` shows no pill.** Most QDs are approved; marking all of them
   teaches the eye to skip the marker.
3. **The badge vocabulary becomes shared, not copied.** `A_BADGE` moves out of
   `QDDetailPanel.jsx` into `src/utils/constants.js`.
4. **The sent-back queue belongs to the raiser alone** — `created_by`, not
   approvers, not admins.
5. **One endpoint, generalized — not a second one alongside.**

Decision 3 exists because the drawer and the register must agree on what "Sent
back" looks like. `A_BADGE` is currently private to the panel, so the table would
need its own copy, and two copies of a colour vocabulary drift.

Decision 4 is the counterpart of the approval queue's rule. `isInApprovalQueue`
answers "is this mine to approve"; this answers "is this mine to fix". An admin
looking at someone else's returned QD has nothing to do about it.

Decision 5: `GET /pending-approvals` shipped hours before this design and has one
consumer, the hook this design also changes. Adding a parallel
`/sent-back-to-me` would mean two polls a minute and two hooks kept in step;
keeping the old name while returning rework items would mean a route that lies
about half its payload. So it is renamed.

## Architecture

### Backend

`GET /api/quality-discrepancies/pending-approvals` → `GET /api/quality-discrepancies/my-queue`

```json
{ "awaitingApproval": { "count": 1, "qds": [...] },
  "sentBack":         { "count": 2, "qds": [...] } }
```

Both lists carry the same row shape already returned today: `id, qd_no, die_no,
supplier, plant, submitted_at, prepared_by`, plus `sent_back_reason` on the
`sentBack` rows so a surface can show *why* without opening the QD.

The route keeps its position **above** the `/:id` routes and its inherited
`pageAccessMiddleware('qd-tracker')` gate. A caller who is not an eligible
approver still gets `awaitingApproval: { count: 0, qds: [] }` — but their
`sentBack` list is computed regardless, because raising a QD does not require
being an approver.

In `server/services/qualityDiscrepancies.cjs`, beside `isInApprovalQueue`:

```
isSentBackToMe(row, userId) = row.approval_state === 'SentBack'
                              && row.created_by === userId
```

and `listMyQueue(client, userId, { isApprover })` returning both buckets from a
single query over the non-Draft rows, filtered in JS by the two predicates — the
same pattern and the same reason as the existing one: the rules stay testable.

### Frontend

- `src/utils/constants.js` gains `QD_APPROVAL_BADGE` (the moved `A_BADGE`), and
  `QDDetailPanel.jsx` imports it instead of defining it.
- `usePendingApprovals` → `useQdQueue`, returning
  `{ awaitingApproval: { count, qds }, sentBack: { count, qds }, total, refresh }`.
  Polling, the window-focus refresh and the `hasPageAccess('qd-tracker')` gate are
  unchanged. `total` feeds the badge.
- `ApprovalQueueBanner` → `QdQueueBanner`, taking `{ title, tone, qds, onOpen }`
  and rendering nothing when `qds` is empty. The QD Tracker renders it twice:
  amber "Awaiting your approval", red "Sent back to you — needs rework".
- The Alerts bell gains a matching second section, and its count is `total`.
- The register's QD No cell renders the pill from `QD_APPROVAL_BADGE`.

The rename touches the route, the API client and the hook. They must land in one
commit: any split leaves a commit where the frontend calls a route that no longer
exists.

## Testing

`node:test`, against a mocked client as elsewhere in this service:

- a `SentBack` QD I raised is in my `sentBack` bucket;
- a `SentBack` QD **someone else** raised is not — including for an admin;
- `Draft`, `Pending` and `Approved` never appear in `sentBack`;
- the `awaitingApproval` bucket still obeys `isInApprovalQueue` after the
  refactor, including the admin case the existing tests already lock;
- a non-approver gets an empty `awaitingApproval` but still gets their own
  `sentBack` rows.

Frontend verification is lint on touched files, `npm run build`, and a browser
check against the two QDs currently in `SentBack` (`2026AD-01`, `2026AD-02`,
both raised by `admin`): the pill appears in the register, the red banner lists
both, the bell counts them, and clicking one opens its drawer showing the reason.

## Out of scope

**A status filter for sent-back QDs.** The register's existing filter dropdown
covers `status`, a different axis from `approval_state`; adding approval to it is
its own change.

**Notifying the raiser when their QD is approved.** Approval emails Purchase and
tells the raiser nothing, in-app or otherwise — the same shape of gap this design
closes for rework, still open for the happy path.

**Desktop notifications and an approver email on submit**, both still blocked or
deferred as recorded in `2026-07-31-qd-approval-notifications-design.md`.
