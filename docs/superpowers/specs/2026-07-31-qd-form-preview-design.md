# QD form preview for the approver — design

**Date:** 2026-07-31
**Status:** approved, not implemented

## Problem

An approver decides on a QD from the detail drawer, but the drawer does not show
them the QD form. It shows the fact cards — a subset of the record — while the
issued document carries all 16 Part-A/Part-B fields, the billet parameters and
every attached image.

To see the rest they click **Download QD PDF**, which streams
`GET /api/quality-discrepancies/:id/document` as a file download. That takes them
out of the app, into a downloads folder and a separate PDF application, and back
to the drawer to click Approve. In practice the cheaper move is to ask the raiser
for the missing detail — so approval waits on a conversation that the record
already answers.

Everything needed already exists and is already correct. It is simply not
present where the decision is made.

## Decisions taken

1. **Preview the real PDF, not a second rendering.** An HTML re-render of the
   same fields would be faster to load and searchable, but the QD is a
   certification record: a preview that can disagree with the issued document is
   worse than no preview. The approver sees the exact bytes that go to Purchase.
2. **Available to everyone, collapsed by default.** Any user, any QD, no
   auto-load. The raiser proof-reads the form before submitting — which prevents
   send-backs rather than just resolving them — and no drawer open pays for a
   server-side PDF render nobody asked for.
3. **Full-screen modal, not an in-drawer panel.** The drawer is 840px and the
   form is US Letter, two pages plus annexures. The form's small print is
   unreadable squeezed into the drawer.
4. **Approve and Send back live in the preview's footer.** Reading the form and
   acting on it are one task. Making the approver close the preview to act would
   rebuild the round trip this feature removes.
5. **Scope:** frontend only. No schema change, no new endpoint, no new
   dependency.

Decision 1 is what makes this cheap: `GET /:id/document` already exists, already
renders live from the record (so it needs no invalidation, and an edit is
reflected on the next open) and already sets `Content-Disposition: inline`.

## Architecture

### New — `src/components/qd/QDFormPreviewModal.jsx`

A focused full-screen overlay (`position: fixed; inset: 0`) above the drawer's
z-index, in three bands:

| band | contents |
| --- | --- |
| header | `QD <qd_no>` or `QD Draft`, status + approval badges, **Download PDF**, close (X and Esc) |
| body | `<iframe src={blobUrl}>` filling the space — the browser's own PDF viewer |
| footer | **Approve & send to Purchase** and **Send back**, only when the viewer may act |

Props: `qd`, `theme`, `onClose`, `mayApprove`, `onApprove`, `onSendBack`, `busy`.

It fetches the PDF once on open into an object URL and revokes it on close, so
nothing leaks across repeated opens.

**The blob is required, not a preference.** `/api/quality-discrepancies` is
mounted behind `authMiddleware` and the client authenticates with a Bearer
header; an `<iframe>` cannot send one, so the bytes must be fetched in JS and
handed to the iframe as an object URL.

States: a spinner while fetching; on failure an error with **Retry** and
**Download instead**, so a browser that will not render PDFs inline is never a
dead end.

It deliberately does **not** reuse the existing `src/components/PDFViewer.jsx`.
That component carries a notes pane and a hand-drawn signature canvas and
requires an `onSave`; its signature capture would collide with the real scanned
signatures that `qdPdf` draws into the form's sign-off column.

### Changed — `src/api.js`

`downloadDocument` currently inlines its own authenticated fetch. Extract that
into `documentBlob(id)`, and add `documentUrl(id)` returning an object URL for
the iframe. `downloadDocument` keeps its behaviour and calls the shared helper —
one fetch path, so the preview and the download can never diverge.

### Changed — `src/components/qd/QDDetailPanel.jsx`

A **Preview QD form** button (Eye icon) in the actions row beside *Download QD
PDF*, with a `previewOpen` state rendering the modal.

- **Approve** in the modal calls the panel's existing `handleApprove`, which
  already refreshes the drawer and surfaces a failed Purchase email without
  making a successful approval look failed.
- **Send back** closes the preview and opens the drawer's existing reason box.
  A reason is mandatory and that UI exists; rebuilding it inside the modal would
  give send-back two code paths. The approver has already seen what they needed —
  the return trip being removed is the one to the raiser, not the one to a text
  box.

## Testing

No server logic changes, so there is nothing to add to the `node:test` suites.
Verification is running the app and confirming, on a Pending QD: the preview
opens and renders the two-page form, Approve from the footer moves the QD to
Approved, Send back reaches the reason box, Esc and the close button both revoke
the object URL, and a Draft previews unsigned.

## Out of scope

**The approver is still not told a QD is waiting for them.** `POST /:id/submit`
assigns the number, sets `assigned_approver` and sends no notification at all —
the approver discovers pending work by opening the tracker. That is the other
half of "going back and asking for details" and needs its own design: a
submit-time email to the assigned approver, mirroring the send-back notice that
already mails the raiser via `users.email`.

Also unchanged: there is still no terminal **Reject** on the approval axis, so an
approver who thinks a QD should never have been raised can only hand it back.
