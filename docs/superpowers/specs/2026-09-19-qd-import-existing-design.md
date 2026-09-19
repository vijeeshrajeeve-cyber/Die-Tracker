# Import Existing QD Forms — Design

Date: 2026-09-19
Status: Approved for implementation

## Problem

QDs raised before the tracker went live exist only as PDF forms, issued on the
same controlled form the app now draws (`server/assets/qd-form-template.pdf`,
e.g. `320601-201 Quality discrepancy 2026PH-04.pdf`). None of them is in the
register, so:

- their history is missing from the register, the KPIs and the supplier stats;
- any of them still open with a supplier cannot be tracked (status, FOC, chasers);
- the app's numbering does not know those numbers were used. A new Phoenix QD
  would be issued `2026PH-01` even though `2026PH-04` exists on paper.

The only importer today is `server/scripts/import-qd-sheet.cjs`, a
command-line tool for an Excel register that does not exist. It has never been
run.

## Scope

In scope: an admin-only way to upload one old QD PDF at a time (fewer than 30
are expected). It turns each PDF into a full QD in the register that keeps the
original PDF as its document. Also in scope: an admin-only way to undo an
import so a mistake can be corrected.

Out of scope: bulk upload; reading the die row and billet parameters out of
the PDF (Word's table text is unreliable, see "Reading the PDF"); scanned or
image-only PDFs, beyond the admin typing every field; importing the Excel
register; any change to the approval workflow for QDs raised in the app.

## Admin flow

1. **Entry point.** The QD Tracker header gets an **Import existing QD**
   button next to *Raise QD*. It renders only when `getUser()?.role ===
   'admin'`. The server enforces the same rule with `adminMiddleware`.
2. **Pick the PDF.** The button opens `ImportQDModal`, which has a single PDF
   picker (`.pdf` only, 25 MB, the QD attachment limit). The browser reads the
   text layer with pdfjs, the way `PDFImportModal` already does. Nothing is
   uploaded until Save.
3. **Pre-filled form.** The admin checks and completes the fields below.
   Fields the PDF did not yield stay blank.

| Field | Pre-filled from | Required |
|---|---|---|
| QD No | text after `QD #` | yes |
| Date raised | text after `DATE` (`4-Jun-26` → `2026-06-04`) | yes |
| Supplier | the QD number's code (`2026PH-04` → `PH` → the supplier whose `qd_code` is `PH`). A dropdown of the suppliers master | yes |
| Die No | the die row's first two cells, `<Profile No>-<Die no>` (`30601-201`) | yes |
| Plant | not on the form; the admin picks it | yes |
| Issue | the paragraph after `Quality Discrepancy :`, up to `Manufacturing Defect` | yes |
| Recommended action | the paragraph after `Recommended Action :` | no |
| Prepared by | the name after `Prepared By` | no |
| Authorized by | the name after `Authorized By` | no |
| Current status | admin picks; defaults to `Open` | yes |
| Closed date | shown for `Closed` / `Rejected` | when shown |
| ETA | shown for `FOC Accepted` and `FOC Received` | when shown |
| Received date | shown for `FOC Received` | when shown |

   **Die-number cross-check.** When the filename carries a die number (the
   `PDFImportModal` pattern `\d{3,6}[-_]\d{2,4}`) that differs from the one read
   from the form, the modal shows both and pre-fills the form's. The sample
   file has exactly this case: its filename says `320601-201` but the form says
   `30601` / `201`.

   **Early duplicate check.** Once the QD number is read (or typed), the modal
   checks it against the register, so "2026PH-04 already exists" appears
   before the admin fills in anything else.
4. **Save.** The modal uploads the PDF and the fields in one request. On
   success it closes, the register refreshes, and the new QD opens in the
   drawer.

## Reading the PDF

Parsing is a pure function over the text pdfjs returns, in a plain module
`src/utils/qdFormText.js`, so it can be unit-tested under `node:test`. pdfjs
itself is loaded only by the modal.

`qdFormTextFromItems(pages)` joins the text items of each page, in pdfjs
order, into one string with a newline wherever pdfjs marks an end of line.
`parseQdFormText(text)` then returns `{ qdNo, raisedDate, supplierCode,
profileNo, dieSuffix, issue, recommendedAction, preparedBy, authorizedBy }`.
Any value it cannot find is `''`. It never guesses.

- It reads only fields anchored to a printed label: `QD #`, `DATE`,
  `Quality Discrepancy :`, `Recommended Action :`, `Prepared By`,
  `Authorized By`.
- The die row is read only for its first two cells, the items that follow the
  header's last label (`done`). They are accepted only when they look like a
  profile (`^\d{3,6}$`) and a suffix (`^\d{1,4}[A-Z]?$`). Otherwise both stay
  blank. The rest of that row is not read: an empty Word table cell emits no
  text item, so every later cell shifts by one and the values land in the
  wrong fields.
- Dates in `D-Mon-YY` form (`4-Jun-26`) become ISO dates. Two-digit years are
  taken as 20YY.
- The supplier code is the two letters in a `YYYYCC-NN` QD number. The modal
  maps it to a supplier through the suppliers master's `qd_code`. A number in
  any other format pre-fills no supplier.

## What gets saved

**Schema.** One new column, `quality_discrepancies.imported BOOLEAN NOT NULL
DEFAULT FALSE`, added through an idempotent `DO $$ … IF NOT EXISTS` block in
`server/db.cjs` and mirrored in `init.sql`. Existing rows read `false`.

**File category.** A new `quality_discrepancy_files.category` value,
`original_form`. The ordinary upload route (`POST /:id/files`) cannot set it,
because its whitelist stays unchanged, so only the import writes it.

**Route.** `POST /api/quality-discrepancies/import`: `adminMiddleware`,
multipart with one `file` (PDF) plus the fields, all in one transaction:

1. **Validate** (a pure `validateImport` in `qualityDiscrepancies.cjs` for the
   shape; the database for uniqueness and the supplier):
   - QD No: not empty, and no existing QD with the same number,
     case-insensitive. The error names the number.
   - Supplier: present in the suppliers master.
   - Dates: all ISO. The raised, closed and received dates are not later than
     today, and neither the closed nor the received date is before the raised
     date. The ETA is a supplier's promise, so it may be in the future.
   - Status: in `STATUSES`, with the dates it needs (see step 4).
   - File: a PDF.
2. **Insert** through the existing `createQD`, with
   `approval_state = 'Approved'`, `imported = true`, `created_by` = the
   admin, `prepared_by` = the form's name (blank if absent), `closed_at` =
   the closed date for `Closed` / `Rejected`, `issue_summary` = the first line
   of the issue (160 characters, as the sheet importer does), and
   `issue_detail` = the whole issue. `submitted_*`, `approved_*` and
   `assigned_approver` stay `NULL`: nobody submitted or approved it in the
   app, so the form is never signed by the app.
3. **Store the PDF** with the existing `qdStorage` path builder, as category
   `original_form`.
4. **Status.** The QD is created `Open`. Any other status is applied through
   the **existing `updateStatus`**, with the reason "Status at import", so
   the import follows the same rules and FOC round bookkeeping as a normal
   status change:
   - `FOC Accepted` requires an ETA and opens FOC round 1.
   - `FOC Received` requires an ETA and a received date. It is applied as
     `FOC Accepted` (ETA), then `FOC Received` (received date), because
     `recordReceipt` refuses a receipt with no open round. The round's
     `accepted_at` is the import day, since the form carries no acceptance
     date.
   - `Closed` / `Rejected` keep the closed date set in step 2, because
     `updateStatus` stamps `COALESCE(closed_at, CURRENT_DATE)`.
5. **Timeline.** "raised QD against die X", with `occurred_at` set to the
   raised date (as the sheet importer writes it), and "imported from the
   original QD form (filename) by <admin>", which also carries
   "Authorized by <name>" when the form has one. That person need not be an
   app user, so nothing else can hold the name.

A PDF moved into storage before a failed commit is deleted again, so a
rejected import leaves nothing on disk.

**Duplicate check endpoint.** `GET /api/quality-discrepancies/exists?qdNo=…`
returns `{ exists }`. It powers the modal's early check. The import route
still enforces uniqueness itself.

**Numbering.** No change. `nextSequence` already continues from the highest
number in the supplier-year series, so importing `2026PH-04` makes the next
Phoenix QD raised in the app `2026PH-05`. Old QDs of the current year should
therefore be imported before new ones are raised for the same supplier. The
spec does not enforce this; the import's duplicate error covers a clash.

## The original PDF is the document

`buildQdPdfBytes` in `server/services/qdDocument.cjs` returns the stored
`original_form` bytes, unchanged, when `row.imported` is true. That one branch
covers every place the form leaves the app: the download, the in-app preview,
Resend to Purchase and the supplier email attachment. A redrawn form would
come from partial data and disagree with the certified document already
issued. If the original file is missing on disk, the document request fails
with a clear error rather than falling back to a redrawn form.

## After import

An imported QD is an Approved QD, so its Part-A fields stay locked (the
existing `PATCH` rule). Progress fields (ETA, hand-off dates, supplier reply),
status changes, FOC trials, notes, emails and extra attachments all work as
they do for any Approved QD. It counts in the KPIs, the supplier rollup and
the year filter by its raised date. `qd_requested_date` stays `NULL`, as it is
for other pre-existing rows.

**Register and drawer.** An **Imported** pill sits beside the QD number,
defined next to `QD_APPROVAL_BADGE` in `constants.js` so the register, the
supplier drill-down and the drawer cannot drift apart. The drawer lists the
original under its own label, "Original QD form".

## Undo import

`DELETE /api/quality-discrepancies/:id/import`, `adminMiddleware`. It is
refused with 400 unless `imported = true`, so it can never delete a QD raised
in the app, and the app still has no general QD delete. It deletes the QD row;
activity, billets, files and FOC rounds cascade (`ON DELETE CASCADE` on all
four). After the commit it unlinks the stored files, best effort. The drawer
shows **Undo import** to admins on imported QDs only, behind a confirm dialog
that says everything recorded since the import (status changes, notes,
attachments) goes with it. The number is then free to import again, which is
correct: it is the paper number, not one the app issued.

## Error handling

- Parse failure (a corrupt or non-text PDF): the modal says the form could not
  be read and leaves every field blank for the admin to type. The PDF can
  still be imported.
- Validation errors return 400 with a message naming the field. The modal
  shows it and keeps the admin's input.
- A non-admin calling either route gets 403 from `adminMiddleware`.

## Testing

`node:test`, run by `npm test`:

- `src/utils/qdFormText.test.js`: a fixture shaped like the sample's pdfjs
  items. It checks every pre-filled field, date conversion, the supplier code,
  blank fields when the die row fails the profile/suffix shape, blank
  fields when a label is absent, and the filename die-number helper against
  the `320601-201` / `30601-201` mismatch.
- `server/services/qualityDiscrepancies.test.cjs`: `validateImport`, covering
  required fields, future dates, closed before raised, and the status-specific
  dates.
- `server/services/qdDocument` test: an imported row returns the original
  bytes untouched; a missing original throws; a non-imported row still
  renders.
- Undo: refuses a non-imported QD.

Then a click-through on the test server: import the sample
`2026PH-04` PDF, confirm the register pill, the drawer, the preview showing
the original, and Undo import. Because the local stack is the test server, the
test import is undone afterwards by its id.
