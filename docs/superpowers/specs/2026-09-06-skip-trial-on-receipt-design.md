# Skip Trial on Die Receipt — Design

Date: 2026-09-06
Status: Approved for implementation

## Problem

Tooling and some Backup dies never go through a sample trial: the moment they
are received they are fit for use. Today the Confirm Die Receivance form has no
way to say so, so every such die lands on the Sample Followup page as
`Pending` with empty submission and approval dates, and someone has to visit
that page later and stamp the same date into two fields and set the status by
hand. The result is either busywork or a row that stays wrongly `Pending`.

## Scope

In scope: a `Skip trial` option on the Confirm Die Receivance modal on the
Flow page, shown for Tooling and Backup dies only, which stamps the sample
fields at receipt time.

Out of scope: any new column or endpoint, any change to the Sample Followup
page, any change to New dies, and any retroactive marking of dies already
received. The Flow page modal is the only interactive path that marks a die
received (`src/pages/FlowPage.jsx`); the import path derives `DIE RECEIVED`
from a received date and is unaffected.

## Behaviour

**Visibility.** The option renders only when the order's `TYPE` is `T`
(Tooling) or `B` (Backup). New dies (`N`) never see it.

**Default.** Tooling opens with the box checked; Backup opens unchecked. The
user may toggle it either way for both types. The default is applied when the
modal opens for an order, not on every render, so a user's change sticks.

**Effect when checked.** The receipt PATCH gains four fields, all derived from
the received date the user typed:

| Display key            | Value                 |
|------------------------|-----------------------|
| `Submission Date`      | the die received date |
| `Sample Approval Date` | the die received date |
| `No of Trial`          | `0`                   |
| `Sample Status`        | `Approved`            |

The change-log entry that already records the move to `DIE RECEIVED` keeps its
`Corrector: <name>` reason and appends ` · Trial skipped (Tooling)` or
` · Trial skipped (Backup)`, so the audit trail explains why the sample jumped
straight to Approved. The success toast says the trial was skipped.

**Effect when unchecked.** The PATCH is exactly what it is today: status,
received date, corrector, press, Ascona reference, existing sample status
(defaulting to `Pending`), and the change-log entry.

No persistent flag is stored. On the Sample Followup page a skipped die shows
`Approved` with both dates equal to the received date and `0` in No. of Trial
in the normal (non-legacy) style, because zero logged trials with a zero
legacy count is exactly what `trialCountFor` renders as a real zero. The Today
buttons only move status forward, so nothing there can undo the stamp. This
was the user's explicit choice over a persisted marker.

## Structure

A new pure module `src/utils/dieReceivance.js` owns the decision logic so it
can be unit-tested without a component test framework:

- `skipTrialDefault(type)` — `true` for `T`, `false` otherwise.
- `skipTrialAllowed(type)` — `true` for `T` and `B`.
- `buildReceivancePatch({ order, form, skipTrial })` — returns
  `{ patch, logEntry }` for the given inputs, where `patch` already contains
  the `Change Log` array with `logEntry` inside it. This is the code that
  currently lives inline in the Confirm button's click handler, lifted out
  unchanged and extended with the skip branch.

`FlowPage.jsx` keeps the modal, adds `skip_trial` to `dieReceivanceForm`,
seeds it from `skipTrialDefault(order.TYPE)` when the Confirm button on a row
is clicked, renders the checkbox row under Assign Corrector when
`skipTrialAllowed`, and calls `buildReceivancePatch` in the handler. The local
`setData` merge keeps spreading `patch`, so the Sample Followup view updates
without a refetch.

## Testing

`src/utils/dieReceivance.test.js` under `node:test`:

- Tooling defaults on, Backup and New default off.
- Allowed for Tooling and Backup, not for New or a missing type.
- Checked: patch carries the four sample fields at the received date, and the
  log reason mentions the skip with the type name.
- Unchecked: patch has no `Submission Date`, `Sample Approval Date` or
  `No of Trial`, `Sample Status` falls back to the order's current value or
  `Pending`, and the reason is `Corrector: <name>` alone.
- Corrector name is trimmed in both the patch and the reason.

The modal itself is checked in the browser against the test server: a Tooling
die opens with the box ticked, a Backup die with it clear, a New die shows no
row, and confirming a ticked die shows it Approved on the Sample Followup page.
