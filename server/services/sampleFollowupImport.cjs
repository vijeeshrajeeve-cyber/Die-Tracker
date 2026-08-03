'use strict';
// Pure decision logic for the one-time Sample Followup Excel backfill.
// Driven by server/scripts/import-sample-followup-sheet.cjs.
// Design: docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md

// Logical name → header text in the 'Sample Followup' sheet.
const COLUMNS = {
  die: 'Die',
  plant: 'Plant',
  supplier: 'Supplier',
  received: 'Die Received Date',
  submission: 'Submission Date',
  approval: 'Sample Approval Date',
  trials: 'No. of Trial',
  corrector: 'Corrector',
};

// No of Trial ceiling, matching the validator in server/routes/orders.cjs.
const MAX_TRIALS = 1000;

// Sheet headers sometimes carry stray trailing spaces (the QD sheet did).
function readCell(row, name) {
  if (row[name] !== undefined) return row[name];
  const key = Object.keys(row).find((k) => k.trim() === name);
  return key === undefined ? '' : row[key];
}

function normalizeDieNo(v) {
  return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(v) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

// Guards against well-formed but impossible dates like '2026-13-45'.
function isValidYmd(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

// Excel serial (1900 system) or typed text → 'YYYY-MM-DD'. Blank/garbage → null.
function parseSheetDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(Math.round((n - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) {
    const ymd = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidYmd(ymd) ? ymd : null;
  }

  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const ymd = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return isValidYmd(ymd) ? ymd : null;
  }

  return null;
}

function parseTrialCount(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const r = Math.trunc(n);
  return r < 0 || r > MAX_TRIALS ? null : r;
}

module.exports = {
  COLUMNS, MAX_TRIALS,
  readCell, normalizeDieNo, cleanText, parseSheetDate, parseTrialCount,
};
