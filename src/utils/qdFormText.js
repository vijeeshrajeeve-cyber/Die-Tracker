// Reads the fields an old QD form states plainly, from the text pdfjs pulls out
// of it. The forms are the controlled template (server/assets/
// qd-form-template.pdf) exported from Word, so each value we read sits right
// after a printed label. Anything not found comes back '' -- never a guess.
//
// Deliberately NOT read: the die row past its first two cells, and the billet
// parameters. Word emits no text for an empty table cell, so one blank cell
// shifts every later value into the wrong column. The original PDF stays the
// QD's document, so those values are not lost.

// pdfjs text items -> one string: a newline wherever pdfjs set hasEOL, and one
// between pages.
export const qdFormTextFromItems = (pages) => (pages || [])
  .map((items) => (items || []).map((i) => `${i.str ?? ''}${i.hasEOL ? '\n' : ''}`).join(''))
  .join('\n');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// '4-Jun-26' / '04-June-2026' -> '2026-06-04'. Two-digit years are 20YY.
// '' for anything that is not a real calendar date.
export const parseFormDate = (raw) => {
  const m = String(raw || '').trim().match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2}|\d{4})$/);
  if (!m) return '';
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return '';
  const day = Number(m[1]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// Word wraps a paragraph across lines. A line that ends a sentence closes a
// paragraph; any other line break is only a wrap and becomes a space.
export const joinWrappedLines = (raw) => String(raw || '')
  .split('\n').map((l) => l.trim()).filter(Boolean)
  .reduce((out, line) => (out ? `${out}${/[.!?:]$/.test(out) ? '\n' : ' '}${line}` : line), '');

// The two-letter supplier code in a YYYYCC-NN QD number ('2026PH-04' -> 'PH').
export const supplierCodeFromQdNo = (qdNo) => {
  const m = String(qdNo || '').trim().toUpperCase().match(/^\d{4}([A-Z]{2})-\d+$/);
  return m ? m[1] : '';
};

// A die number in a filename -- the convention PDFImportModal already relies on
// ('320601-201 Quality discrepancy 2026PH-04.pdf' -> '320601-201').
export const dieNoFromFilename = (name) => {
  const m = String(name || '').match(/(\d{3,6})[-_](\d{2,4})/);
  return m ? `${m[1]}-${m[2]}` : '';
};

const firstMatch = (text, re) => (text.match(re)?.[1] || '').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The labels printed on the controlled form. A paragraph we read ends at the
// first of these after it: Word does not emit the form's text in a fixed
// order, so what follows a paragraph differs from one QD to the next (on
// 2026PH-04 the recommended action runs into the photo captions, on 2026PH-06
// into Part-B).
const FORM_LABELS = [
  'Quality Discrepancy :', 'Manufacturing Defect', 'Recommended Action',
  'Part-A (To be filled', 'Part-B (To be filled', 'Production Parameters',
  'Quality Discrepancy Acceptance', 'Action Taken', 'Supplier Comments/Corrective Action',
  'Note- Quality Discrepancy', 'Received By (Supplier)', 'Quality Discrepancy Closed on',
  'Prepared By', 'Authorized By', 'Name Signature', 'Profile Image', 'YES NO ETA',
  'As for 1st trial', 'As for last trial',
];
const UNTIL_NEXT_LABEL = `(?=${FORM_LABELS.map(escapeRe).join('|')}|$)`;

// The paragraph after "<label> :", up to the next printed label.
const paragraphAfter = (t, label) => joinWrappedLines(
  firstMatch(t, new RegExp(`${escapeRe(label)}[ \\t]*:([\\s\\S]*?)${UNTIL_NEXT_LABEL}`)));

export const parseQdFormText = (text) => {
  const t = String(text || '');
  const qdNo = firstMatch(t, /QD\s*#[ \t]*([A-Za-z0-9][A-Za-z0-9/-]*)/).toUpperCase();
  // Upper-case DATE only: the billet table has a "Date" column of its own.
  const raisedDate = parseFormDate(firstMatch(t, /\bDATE[ \t]+(\S+)/));
  // The die row is the line after the header's last label, "done".
  const die = t.match(/\bdone[ \t]*\n[ \t]*(\d{3,6})[ \t]+(\d{1,4}[A-Za-z]?)(?=[ \t\n]|$)/);
  // The colon matters: "Quality Discrepancy" is also the form's title and the
  // start of "Quality Discrepancy Closed on".
  const issue = paragraphAfter(t, 'Quality Discrepancy');
  const recommendedAction = paragraphAfter(t, 'Recommended Action');
  // [ \t]+, not \s+: an unsigned line must not capture the line after it.
  const preparedBy = firstMatch(t, /Prepared By[ \t]+([^\n]+)/);
  const authorizedBy = firstMatch(t, /Authorized By[ \t]+([^\n]+)/);
  return {
    qdNo,
    raisedDate,
    supplierCode: supplierCodeFromQdNo(qdNo),
    profileNo: die ? die[1] : '',
    dieSuffix: die ? die[2] : '',
    issue,
    recommendedAction,
    preparedBy,
    authorizedBy,
  };
};
