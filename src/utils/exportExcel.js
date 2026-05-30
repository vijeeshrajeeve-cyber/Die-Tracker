import * as XLSX from 'xlsx';
import { formatDate } from './helpers';

// Build a worksheet row from a source object using a curated column map.
// columns: [{ key, label, format? }] where format is one of:
//   'date'  -> formatted via formatDate (DD Mon YYYY)
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
      value = raw ? formatDate(raw) : '';
    } else {
      value = raw === null || raw === undefined ? '' : raw;
    }
    row[label] = value;
  });
  return row;
};

// Auto-size columns based on header + content length (capped for sanity).
const computeColWidths = (rows, columns) => {
  return columns.map(({ label }) => {
    let max = String(label).length;
    rows.forEach((r) => {
      const len = String(r[label] ?? '').length;
      if (len > max) max = len;
    });
    return { wch: Math.min(Math.max(max + 2, 8), 50) };
  });
};

// Export an array of source rows to an .xlsx file using a curated column map.
export const exportToExcel = ({ rows, columns, filename, sheetName = 'Export' }) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const exportRows = safeRows.map((r) => buildRow(r, columns));

  const ws = XLSX.utils.json_to_sheet(exportRows, {
    header: columns.map((c) => c.label),
  });
  ws['!cols'] = computeColWidths(exportRows, columns);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const stamp = new Date().toISOString().slice(0, 10);
  const finalName = filename.endsWith('.xlsx') ? filename : `${filename}_${stamp}.xlsx`;
  XLSX.writeFile(wb, finalName);
};
