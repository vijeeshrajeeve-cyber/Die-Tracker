# Die Delivery Follow-up — Design

Date: 2026-09-22 · Branch: `feat/die-delivery-followup` (from `main` after the Work Queue merge)

## Problem

Once a die reaches **In Manufacturing** (`status = 'DONE'`, no `die_received_date`) nothing
helps anyone chase it. The page does not even show the ETA. When a supplier moves a date,
the old one is overwritten and lost, so there is no way to tell a die that slipped three
times from one that never moved, or a slip the supplier caused from one we caused.

## Decisions (confirmed with the user)

1. Everything lives on the existing **In Manufacturing** page — no new page.
2. Changing an ETA that was already set **requires a cause**: Supplier delay, Our change,
   Shipping / logistics, Other (+ note). A first ETA needs none.
3. ETAs stay editable in the die order form **and** get a Revise path on the In Manufacturing
   page. Both ask for the cause.
4. A **supplier chaser** email lists **overdue** dies and dies with **no ETA**. A supplier is
   emailed at most once every **N days** (default 3), checked daily at a set time.
5. **Internal reminders come from the Work Queue**, which already makes an In Manufacturing
   item due on the ETA with due-soon / due-today / overdue / escalation notices. No new
   reminder code.
6. Architecture A: one delivery timeline table, cause rule enforced server-side.
7. Supplier on-time scoring in the supplier report is **out of scope**; the cause data makes
   it possible later.

## What counts as an ETA

`die_orders.eta` is `TEXT` and stays `TEXT`: production may hold values like `TBC`, and a
column type change would fail or silently null them. One parser decides:

- `normalizeEta(value)` → `'YYYY-MM-DD'` for `YYYY-MM-DD`, an ISO datetime, or
  `DD/MM/YYYY` / `DD-MM-YYYY` / `DD.MM.YYYY`; otherwise `null`.
- `null` means **No ETA** everywhere (page bucket, chaser). A string like `TBC` is never a date.
- New ETAs entered from the follow-up drawer must be real dates.

The same rules exist server-side (`server/services/deliveryFollowup.cjs`) and client-side
(`src/utils/deliveryFollowup.js`), each with its own tests.

## The ETA change rule

Compare `old = normalizeEta(stored)` with `new = normalizeEta(incoming)`:

| old | new | result |
|---|---|---|
| same date (incl. format-only change) | | nothing recorded |
| null | null | nothing recorded (e.g. blank → `TBC`) |
| null | date | `eta_set` event, no cause needed |
| date | different date or null | `eta_revised` event, **cause required** |

A missing or invalid cause on an `eta_revised` change is refused **400**
`{ code: 'ETA_CAUSE_REQUIRED' }` and nothing is written. Cause `other` also needs a note.

Enforced in one service function, `planEtaChange`, called by:

- `PATCH /api/orders/:id` and `PUT /api/orders/:id` when the body carries `ETA`. The cause
  travels as `body['ETA Change'] = { cause, note }`. The stored ETA is read `FOR UPDATE` and
  the order update + event insert run in **one transaction**.
- `POST /api/delivery-followups/:orderId` (the drawer).

`POST /api/orders` (create, Excel import, PI import) is untouched: a create only ever sets a
first ETA. The Work Queue picks up every ETA change through its existing `die_orders`
trigger, so its deadline moves with no extra code.

## Data

`die_delivery_events` — one row per event on a die's delivery timeline:

| column | notes |
|---|---|
| `id` SERIAL PK | |
| `order_id` INT → `die_orders(id)` ON DELETE CASCADE | indexed |
| `kind` TEXT | `eta_set`, `eta_revised`, `contact`, `chaser_sent` |
| `eta_before`, `eta_after` DATE | ETA events only |
| `cause` TEXT | `supplier_delay`, `our_change`, `logistics`, `other`; required for `eta_revised` |
| `channel` TEXT | `email`, `phone`, `whatsapp`, `meeting`, `other`; required for `contact` |
| `contact_date` DATE | required for `contact` |
| `note` TEXT | |
| `chaser_id` INT → `die_delivery_chasers(id)` | `chaser_sent` only |
| `created_by` INT → `users(id)`, `created_by_name` TEXT | null for the scheduler |
| `created_at` TIMESTAMPTZ DEFAULT now() | |

CHECK constraints pin the per-kind requirements above.

`die_delivery_chasers` — one row per chaser email sent: `id`, `supplier`, `recipients`,
`cc`, `overdue_count`, `no_eta_count`, `sent_at`. Drives the every-N-days rule and is the
audit of what went out.

`reminder_settings` gains: `delivery_chaser_enabled` (false), `delivery_chaser_time`
('08:00'), `delivery_chaser_last_run` (DATE), `delivery_chaser_interval_days` (3),
`delivery_chaser_no_eta_days` (7), `delivery_chaser_cc` (''). Added in `db.cjs` only, like
the FOC and daily-summary columns. Both new tables go in `db.cjs` and `init.sql`.

Derived per die (no backfill):

- **Original ETA** = `eta_before` of the first `eta_revised`, else the current ETA.
- **Slips** = count of `eta_revised`; **days slipped** = current ETA − original ETA.
- **Last follow-up** = newest `contact`; **last chased** = newest `chaser_sent`.

## API

Mounted at `/api/delivery-followups` behind `authMiddleware` +
`pageAccessMiddleware('flow-completed')`.

- `GET /` → `{ summaries: { [orderId]: { originalEta, slips, daysSlipped, lastContact, lastChasedAt } } }`
  for dies in manufacturing.
- `GET /:orderId/events` → `{ events }`, newest first.
- `POST /:orderId` `{ contactDate, channel, note, newEta, cause, causeNote }` → logs a contact
  and/or an ETA change in one transaction. At least one of a note or a new ETA is required.
  `contactDate` may not be in the future. Returns the new events and the order's ETA.

Chaser settings in `server/routes/email.cjs`, beside the FOC ones:
`GET|PUT /api/email/delivery-chaser-settings`, `POST /api/email/delivery-chaser-settings/run-now`,
`GET /api/email/delivery-chaser-preview`.

## In Manufacturing page

`FlowPage` hands the `DONE` tab to a new `InManufacturingPage` so the other stages stay as
they are. Same tab id (`flow-completed`), sidebar entry and page permission. The receipt
dialog moves out of `FlowPage` into `DieReceivanceModal` unchanged.

- **Summary strip**: Overdue · Due in 7 days · Later · No ETA, each a filter (click again for All).
- **Columns**: Die No, Order, Plant, Type, Diameter, Thickness, Cav, Supplier, **ETA** (original
  struck through beside it when revised), **ETA status** chip ("12d overdue" red,
  "Due today" / "Due in 3d" amber, date neutral, "No ETA" grey), **Slips** (count, days slipped
  on hover), **Last follow-up** (date · channel, or "Never"), Days in stage, View, Rev,
  **Follow up**, Confirm.
- **Default order**: most overdue first, then soonest due, then Later, then No ETA. Clicking
  a column header still sorts.
- **Follow-up drawer**: die facts; ETA block (original, current, slips); the log form (date,
  channel, supplier's reply, optional new ETA — the cause picker appears when the die
  already had an ETA and the new one differs); the timeline, newest first, with who and when.
  After a save the row updates in place without a full reload.

Buckets: overdue = ETA < today; due soon = today ≤ ETA ≤ today + 7; later = beyond; no ETA =
`normalizeEta` null. "Today" is the local day (`todayLocal`).

## Die order form

`handleSave` in the order detail modal: when the edited ETA changes a stored real date, an
**ETA cause dialog** (same pattern as the status-reason dialog) opens first; its answer is
sent as `'ETA Change'` with the patch. A server `ETA_CAUSE_REQUIRED` answer is shown as a
plain error, never swallowed.

## Supplier chaser

`server/services/deliveryChaser.cjs`, scheduled like the FOC chaser (minute tick, once per
day at or after `delivery_chaser_time`, guarded by `delivery_chaser_last_run`).

- **Candidates**: `status = 'DONE'`, no `die_received_date`, supplier set, and either
  **overdue** (real ETA < today) or **no ETA** with the die in manufacturing ≥
  `delivery_chaser_no_eta_days` since `design_to_ems_date`. A die with no Design to EMS date
  and no ETA is included, with days shown as "—".
- **Cadence**: a supplier is due when it has never been chased, or the local day of its
  newest `die_delivery_chasers.sent_at` is ≤ today − `interval_days` (so N = 1 is daily,
  N = 7 weekly).
- **Recipients**: `suppliers.contact_email` (matched on trimmed, case-insensitive name), CC
  `delivery_chaser_cc`. Suppliers without an email are skipped and named in the run result.
- **Email**: two tables — *Past the ETA you gave* (die, profile, plant, ETA, days overdue,
  times revised) and *ETA not yet given* (die, profile, plant, days in manufacturing) — asking
  for a dispatch date or ETA. Same HTML conventions and signature as the FOC chaser.
- **After a send succeeds**: one transaction writes the `die_delivery_chasers` row and a
  `chaser_sent` event per listed die. A failed send writes nothing, so it is retried next run.
- **Send now** runs the job immediately but still honours the cadence, so a double click
  cannot mail a supplier twice. **Preview** sends and writes nothing: per supplier it shows
  the rendered email, the recipient, and whether it is due now or its next date.
- **Ships disabled.** Settings panel `DeliveryChaserSettings.jsx` in Email Settings: enable,
  time, every N days, no-ETA threshold, CC, last-run status, Preview, Send now.

## Error handling

- Bad input on the drawer or settings → 400 with a message the UI shows as-is.
- A chaser run error is kept in memory state and shown in the settings panel, like FOC.
- One supplier's send failure does not stop the others; the summary counts failures.

## Testing

`node:test`, no real database needed except where noted:

- `deliveryFollowup.test.cjs`: `normalizeEta`, the change table above, cause/note
  validation, summary derivation.
- `orders` route test: PATCH changing a set ETA without a cause → 400 and no UPDATE issued;
  with a cause → UPDATE + event in one transaction; first ETA → `eta_set` with no cause.
  `testSupport.installFakeDb` gains `pool.connect()`.
- `delivery-followups` route test: validation and the contact + ETA transaction.
- `deliveryChaser.test.cjs`: candidate classification, cadence, grouping, recipients,
  email body, no log rows on send failure, Send-now honouring cadence.
- `src/utils/deliveryFollowup.test.js`: buckets, chips, sort order, form validation.
- `npm run build`, then a browser check of the page and drawer on the test server.
