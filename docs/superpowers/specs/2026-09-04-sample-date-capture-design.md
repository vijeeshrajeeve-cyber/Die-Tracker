# Sample Date Capture — Design

Date: 2026-09-04
Status: Approved for planning

## Problem

Submission Date and Sample Approval Date are typed in by hand, through a date
picker, on a page where the overwhelmingly common case is "this happened today".
Picking today's date from a calendar widget is several clicks for a fact the
system already knows, and it happens dozens of times a week.

Worse, the date and the Status that goes with it are recorded separately. A die
whose sample was submitted today needs a date set *and* a status moved, and
nothing links the two — so records drift into states that contradict
themselves: a submission date filled in while Status still reads Pending.

This design adds a one-click way to record both together, correctly.

## Scope

In scope: a button beside each of the two date fields that sets it to today and
advances Status when appropriate, in both the table and the record modal.

Out of scope: Die Received Date (it is set by the receiving flow, not here),
any change to the date pickers themselves, and backfilling status on existing
records that already disagree with their dates. Those records stay as they are;
this feature stops the problem growing, it does not rewrite history.

## The button

A small **Today** button beside Submission Date and Sample Approval Date,
appearing in both places the fields appear: the inline table cell and the
record modal. One shared component, so the two cannot drift apart.

Clicking it sets that date to today's local date and, when the rule below
allows, advances Status. Both fields are written in a **single request**, so a
record can never end up with the date saved and the status not.

**When the field already holds a date**, a confirm appears first, naming both
the existing date and the new one. Overwriting a recorded date is exactly the
kind of thing that should not happen on a stray click, and seeing the old value
is what makes the decision possible. Declining the confirm changes **nothing** —
not the date, and not the Status, even where the ladder would have allowed the
status to advance. The two move together or not at all.

**Permissions:** anyone who can edit the page. The date picker beside the button
is already open to everyone, so gating the button would be inconsistent theatre.

## The Status rule

Status advances along a three-stage ladder and never moves backwards:

```
Pending (0)  →  Sample Submitted (1)  →  Approved (2)
```

- The Submission button targets `Sample Submitted`; the Approval button targets
  `Approved`.
- Status is written only when the target ranks **higher** than the record's
  current stage. Stamping a submission date on an already-Approved die corrects
  the date and leaves it Approved.
- An empty status counts as `Pending`, so it advances normally.

### Rejected and On hold

`Rejected` and `On hold` are not stages on that ladder — they are sideways
states describing a decision, not progress. For a record in either, **the button
sets the date and leaves Status untouched.**

The alternative was to treat the Approval button as clearing a rejection. It was
rejected because the system cannot tell whether the rejection still stands, and
silently flipping a Rejected die to Approved because somebody corrected a date
would erase a real decision that a person made. Moving off Rejected stays
deliberate.

## Feedback

One click changing two fields is only acceptable if it says what it did. The
toast names both outcomes explicitly:

- `Submission date set to 04 Sept 2026 — status moved to Sample Submitted`
- `Submission date set to 04 Sept 2026 — status unchanged`

The second form is what a user sees on an Approved or Rejected record, and it is
the message that stops them assuming a status change happened when it did not.

## Structure

The ladder lives in `src/utils/sampleStatus.js` as a pure function:

```
advanceStatus(currentStatus, targetStatus) -> string | null
```

It returns the status to store, or `null` meaning "leave it alone" — covering
both the no-rewind case and the off-ladder case with one answer shape. Pure, so
it is unit-tested without a browser or a database, the same way `trials.js` is.

The button is a small shared component. It receives the current date, the
current status, and a save callback; it owns the confirm and the toast wording,
and knows nothing about which of the two date fields it is serving beyond what
it is passed.

Saving routes through the page's existing split: records sourced from
`die_orders` patch through `ordersAPI`, standalone records through
`sampleFollowupsAPI` — the same two paths the page already uses for inline
edits, extended to carry two fields in one call instead of one.

## Testing

`node --test`, against `src/utils/sampleStatus.test.js`:

- Pending advances to Sample Submitted, and to Approved
- Sample Submitted advances to Approved
- Approved does not fall back to Sample Submitted
- Sample Submitted does not fall back when re-stamped with its own target
- an empty or missing status is treated as Pending and advances
- `Rejected` returns null for both targets
- `On hold` returns null for both targets
- an unrecognised status returns null rather than guessing

## Risks

**The button writes two fields.** Mitigated by the single request and by a toast
that names the status outcome every time, including when nothing moved.

**Off-ladder records need manual status changes.** A Rejected die that is later
approved needs someone to set Status by hand. This is deliberate: the cost is a
dropdown, and the alternative silently overrides human decisions.
