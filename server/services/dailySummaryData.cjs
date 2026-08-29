'use strict';

// The daily summary's pure core: what counts as a stage, how a stage date is
// read off an order row, and how a day's rows become a report object.
//
// This module deliberately does not require db.cjs -- it takes a `db` argument
// instead. That is what lets db.cjs require it back for the one-time ledger
// seed without a circular import.

// Report order. Adding a stage means adding one entry here: the SQL, the PDF
// rows and the email body all read this list.
//
// `column` is the die_orders column carrying the stage's date. `match` narrows
// which rows a stage may claim -- only the sample split uses it. `optional`
// rows are omitted from the report when their count is zero; everything else
// renders at zero, because a zero is information.
const STAGES = [
  { key: 'requested',       label: 'Die orders requested',           column: 'die_requested_date' },
  { key: 'ordered',         label: 'Die orders placed',              column: 'ordered_date' },
  { key: 'design_received', label: 'Designs received',               column: 'design_received_date' },
  { key: 'design_approved', label: 'Designs approved',               column: 'design_approved_date' },
  // pr_entry and oracle_entry are used as dates by the workflow but persisted
  // through sanitizeString (server/routes/orders.cjs:329,332), so they can hold
  // arbitrary text. freeText marks them for the unparseable-value footnote.
  { key: 'pr_created',      label: 'PRs created',                    column: 'pr_entry',       freeText: true },
  { key: 'oracle_entry',    label: 'Oracle entries done',            column: 'oracle_entry',   freeText: true },
  { key: 'design_to_ems',   label: 'Designs to EMS completed',       column: 'design_to_ems_date' },
  { key: 'die_received',    label: 'Dies received',                  column: 'die_received_date' },
  { key: 'sample_new',      label: 'Samples submitted - New',        column: 'submission_date', match: (r) => r.type === 'N' },
  { key: 'sample_backup',   label: 'Samples submitted - Backup',     column: 'submission_date', match: (r) => r.type === 'B' },
  // Types T, C and H are rare but real. Without this row they would fall
  // between the two buckets above and disappear from every report.
  { key: 'sample_other',    label: 'Samples submitted - other type', column: 'submission_date',
    match: (r) => r.type !== 'N' && r.type !== 'B', optional: true },
].map((s) => ({ match: () => true, freeText: false, optional: false, ...s }));

const pad = (n) => String(n).padStart(2, '0');

// Accepts what the columns actually hold: ISO dates, ISO timestamps, DD/MM/YYYY
// (the form sanitizeDate in routes/backup-requests.cjs:21 accepts), and real
// Date objects. DATE columns arrive as plain 'YYYY-MM-DD' strings -- db.cjs:10
// overrides pg's parser for OID 1082 -- but TIMESTAMP is left alone, so
// created_at really does come back as a Date and the pending-age fallback
// depends on this branch. Everything else is null -- never a guess. Callers
// count the nulls rather than hiding them.
function parseStageDate(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  const s = String(value).trim();
  if (!s) return null;

  let y, m, d;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    [, y, m, d] = iso;
  } else {
    const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (!dmy) return null;
    [, d, m, y] = dmy;
  }

  const mm = Number(m), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${pad(mm)}-${pad(dd)}`;
}

// The date this row carries for this stage, or null if it carries none, the
// value is unreadable, or the row does not belong to the stage at all.
function stageDateOf(row, stage) {
  if (!stage.match(row)) return null;
  return parseStageDate(row[stage.column]);
}

module.exports = { STAGES, parseStageDate, stageDateOf };
