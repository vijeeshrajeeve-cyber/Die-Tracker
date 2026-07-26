# QD Requested Date — design

**Date:** 2026-07-26
**Status:** Approved

## Problem

A QD's only date-of-origin today is `raised_date`, which the server stamps to
"today" when the draft row is created ([quality-discrepancies.cjs](../../../server/routes/quality-discrepancies.cjs) POST `/`).
That records when the record entered the system, not when the QD was actually
requested. The two differ whenever a QD is entered late.

Users need a **QD Requested Date** captured by the person raising the QD, and
visible on the QD Tracker page.

## Decisions

Settled before design (user choices):

1. **A new, separate field.** `raised_date` keeps its current meaning as the
   system's "record created" stamp. Every metric derived from it — age,
   avg resolution, hand-off delays, the year filter, the QD number's year
   component — is unchanged.
2. **Required to save.** A draft cannot be saved without a requested date; it
   joins Die No and Supplier as a mandatory field.
3. **No backfill.** Existing rows keep a NULL requested date and display `—`.
   Copying `raised_date` into them would assert a fact the legacy sheet never
   recorded.
4. **The PDF's Part-A `DATE` box stays bound to `raised_date`.** That box is the
   standard form's own date field; re-pointing it would change the content of
   already-issued documents.

## Data model

One new column on `quality_discrepancies`:

| Column              | Type | Null     | Notes                                  |
| ------------------- | ---- | -------- | -------------------------------------- |
| `qd_requested_date` | DATE | nullable | Required by the API for new QDs; NULL only on rows that predate this feature |

Nullable in the database because existing rows have no value and are not
backfilled. The requirement is enforced at the API and form layers, not by a
`NOT NULL` constraint.

Added as an idempotent `DO $$ ... IF NOT EXISTS ... ALTER TABLE` block in
[server/db.cjs](../../../server/db.cjs), alongside the existing QD date-column
migrations, and mirrored into [init.sql](../../../init.sql) for fresh installs.

## Server

### `server/services/qualityDiscrepancies.cjs`

- **`createQD`** gains a `qdRequestedDate` input, written to the new column and
  passed through as nullable (`|| null`). Keeping it nullable at the service
  layer means [import-qd-sheet.cjs](../../../server/scripts/import-qd-sheet.cjs),
  which calls `createQD` directly, needs no change and imports legacy rows
  without a requested date.
- **`EDITABLE_FIELDS`** gains:

  ```js
  qd_requested_date: { label: 'QD requested date', isDate: true, required: true }
  ```

  This makes the date correctable in the detail drawer's fact card with an
  activity-log entry, exactly as `die_received_date` and `eta_date` are.
- **`normalizeField`** learns the `required` flag: an empty value for a required
  column throws `Invalid <label>: a value is required` instead of returning
  `null`. Without this, the drawer or the Edit form could clear a field the raise
  form insists on.

### `server/routes/quality-discrepancies.cjs`

- **POST `/`** destructures `qdRequestedDate`, and rejects it with a 400 when
  missing or not `YYYY-MM-DD`, alongside the existing Die No / Plant / Supplier
  checks. The validated value is passed to `createQD`.
- **`EDIT_BODY_MAP`** gains `qdRequestedDate: 'qd_requested_date'`, so the full
  "Edit QD" PUT saves the field. Validation comes free via `normalizeField`;
  the route already maps `^Invalid ` errors to 400 and `^Cannot edit a QD` to 409.

The PATCH `/:id/fields` path needs no route change — it iterates
`EDITABLE_FIELDS`.

## Raise / Edit form — `src/components/qd/RaiseQDModal.jsx`

A `DatePickerField` labelled **QD Requested Date** in the **Die selection**
section. That section is `open` by default, so a mandatory field is never hidden
inside a collapsed panel (unlike Part-A, which starts collapsed).

- New QD: defaults to today (`new Date().toISOString().slice(0, 10)`).
- Edit mode: pre-filled from `editQd.qd_requested_date`.
- `canSubmit` gains the field, so both *Save Draft* and *Submit for approval*
  stay disabled until it is set — the requirement is visible before a request is
  ever sent.
- The header hint changes to note the third mandatory field:
  "Save Draft needs only Die No + Supplier + Requested date".
- Included in the create payload and in `buildEditPayload()`.

## QD Tracker page — `src/pages/QDTrackerPage.jsx`

- New **QD requested** column immediately before *QD raised*, so the two
  origin dates sit together and read left-to-right in chronological intent.
  Rendered with the existing `Handoff` component, date only (no `days` prop, so
  no day-gap badge).
- CSV export (`exportCsv`) gains a matching `QD requested` header and value in
  the same position.
- The table goes from 12 to 13 columns. It already scrolls inside its own
  `overflow-x: auto` container with no `min-width`, so no layout change is
  needed.

## Detail panel — `src/components/qd/QDDetailPanel.jsx`

The field joins the `facts` array as an editable date card, placed directly
above *Sent to purchase* so the drawer's date chain reads requested → purchase →
supplier. It picks up in-place editing, the 400-error surface, and the timeline
entry from the existing fact-card machinery — no new code path.

## Out of scope

- The PDF's Part-A `DATE` box (decision 4).
- Any change to KPI, age, resolution, hand-off, year-filter or QD-numbering
  arithmetic (decision 1).
- Backfilling existing rows (decision 3).

## Verification

Backend, extending [qualityDiscrepancies.test.cjs](../../../server/services/qualityDiscrepancies.test.cjs)
(`node:test`, mocked pg client — the file's existing pattern):

1. `normalizeField('qd_requested_date', '2026-07-20')` returns the ISO string.
2. `normalizeField('qd_requested_date', '20-07-2026')` throws `Invalid QD requested date`.
3. `normalizeField('qd_requested_date', '')` throws — a required field cannot be cleared.
4. A non-required date field still clears on empty input (guards against the
   `required` flag leaking into other columns).
5. `createQD` writes `qd_requested_date` into the INSERT, and tolerates it being
   omitted (the importer path).

Frontend has no component test framework: verify with `npm run lint` and
`npm run build`.

Full gate: `npm test` && `npm run lint` && `npm run build`.
