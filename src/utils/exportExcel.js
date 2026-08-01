import { parseDateDMY } from './helpers';

// `xlsx` is ~800 KB and is only needed the moment someone clicks Export. A
// static import put the whole spreadsheet writer in the main bundle, so it was
// downloaded and parsed before the login screen could paint, for every user
// including the ones who only ever read the register.
let xlsxPromise = null;
const loadXLSX = () => (xlsxPromise ||= import('xlsx'));

const EXCEL_DATE_FMT = 'dd mmm yyyy';

// Convert a stored date value (ISO, "YYYY-MM-DD", "DD/MM/YYYY", or with a time
// part) into a real JS Date anchored at local noon. Noon avoids day-shifts from
// timezone/DST when the value is later converted to an Excel serial number.
const parseToDate = (value) => {
  if (!value) return null;
  const datePart = String(value).split('T')[0];
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : parseDateDMY(datePart);
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

// Returns a real JS Date ONLY when the value is, in its entirety, a date string
// (ISO date, ISO datetime, or a full DD/MM/YYYY). Anything else returns null so
// non-date text is never accidentally converted. Useful for "convert whatever
// looks like a date" exports that keep all other columns untouched.
export const toExcelDate = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const isIso = /^\d{4}-\d{2}-\d{2}(T[\d:.+Zz-]*)?$/.test(trimmed);
  const isDmy = /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/.test(trimmed);
  if (!isIso && !isDmy) return null;
  return parseToDate(trimmed);
};

// Build a worksheet row from a source object using a curated column map.
// columns: [{ key, label, format? }] where format is one of:
//   'date'  -> real Excel date cell (or '' when missing/unparseable)
//   fn      -> custom (value, row) => any
// or omitted for a plain value lookup by key.
const buildRow = (source, columns) => {
  const row = {};
  columns.forEach(({ key, label, format }) => {
    const raw = source[key];
    let value;
    if (typeof format === 'function') {
      value = format(raw, source);
    } else if (format === 'date') {
      value = parseToDate(raw) || '';
    } else {
      value = raw === null || raw === undefined ? '' : raw;
    }
    row[label] = value;
  });
  return row;
};

// Auto-size columns based on header + content length (capped for sanity).
const computeColWidths = (rows, columns) => {
  return columns.map(({ label, format }) => {
    let max = String(label).length;
    rows.forEach((r) => {
      const cell = r[label];
      const len = cell instanceof Date ? EXCEL_DATE_FMT.length : String(cell ?? '').length;
      if (len > max) max = len;
    });
    return { wch: Math.min(Math.max(max + 2, format === 'date' ? 12 : 8), 50) };
  });
};

// Apply a date number format to every date cell in the date-typed columns so
// Excel renders them as real, sortable dates rather than serial numbers.
const applyDateFormats = (XLSX, ws, columns, rowCount) => {
  columns.forEach((col, ci) => {
    if (col.format !== 'date') return;
    for (let ri = 1; ri <= rowCount; ri++) {
      const addr = XLSX.utils.encode_cell({ c: ci, r: ri });
      const cell = ws[addr];
      if (cell && (cell.t === 'n' || cell.t === 'd')) cell.z = EXCEL_DATE_FMT;
    }
  });
};

// Export an array of source rows to an .xlsx file using a curated column map.
export const exportToExcel = async ({ rows, columns, filename, sheetName = 'Export' }) => {
  const XLSX = await loadXLSX();
  const safeRows = Array.isArray(rows) ? rows : [];
  const exportRows = safeRows.map((r) => buildRow(r, columns));

  const ws = XLSX.utils.json_to_sheet(exportRows, {
    header: columns.map((c) => c.label),
  });
  ws['!cols'] = computeColWidths(exportRows, columns);
  applyDateFormats(XLSX, ws, columns, exportRows.length);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const stamp = new Date().toISOString().slice(0, 10);
  const finalName = filename.endsWith('.xlsx') ? filename : `${filename}_${stamp}.xlsx`;
  XLSX.writeFile(wb, finalName);
};
