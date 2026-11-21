'use strict';
const XLSX = require('xlsx');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DATE_FORMAT = 'dd-mmm-yyyy';

// 'YYYY-MM-DD' -> Date at UTC midnight, so no timezone can shift the day. Anything else is blank.
function utcDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
const numberOrBlank = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

// Builds a sheet from rows of plain values. null = blank cell; Date = real date cell.
function sheetFrom(rows, { dateColumns = [], widths, filter = false } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  rows.forEach((row, r) => {
    dateColumns.forEach((c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'd') cell.z = DATE_FORMAT;
    });
  });
  ws['!cols'] = widths.map((wch) => ({ wch }));
  if (filter) {
    const lastRow = Math.max(rows.length, 1);
    ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(widths.length - 1)}${lastRow}` };
    ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  }
  return ws;
}

function generateSampleApprovalXlsx(report, { generatedAt = new Date() } = {}) {
  const footnotes = report.footnotes || {};

  const waitingRows = [['Customer', 'Die #', 'Plant', 'Press', 'Submitted', 'Days waiting', 'Overdue', 'Trials', 'Corrector', 'Last remark']];
  for (const g of report.waiting || []) {
    for (const r of g.rows) {
      const trials = r.trialCount > 0 ? r.trialCount : (r.legacyTrialCount || 0);
      waitingRows.push([
        g.customer, r.die, r.plant, r.press, utcDate(r.submittedDate),
        numberOrBlank(r.daysWaiting), r.overdue ? 'Yes' : 'No', trials, r.corrector, r.remark,
      ]);
    }
  }

  const monthRows = [['Customer', 'Approved', 'Rejected', 'Avg days to approval']];
  const lm = report.lastMonth || { rows: [], total: null };
  for (const r of lm.rows) monthRows.push([r.customer, r.approved, r.rejected, numberOrBlank(r.avgDays)]);
  if (lm.total) monthRows.push(['Total', lm.total.approved, lm.total.rejected, numberOrBlank(lm.total.avgDays)]);

  const aboutRows = [
    ['Report month', report.monthLabel || report.month || ''],
    ['Generated', stamp(generatedAt)],
    ['Target days', report.targetDays],
    ['Waiting now', report.header ? report.header.waiting : 0],
    ['Overdue now', report.header ? report.header.overdue : 0],
  ];
  if (footnotes.rejectionsNote) aboutRows.push(['Note', footnotes.rejectionsNote]);
  const excluded = Number(footnotes.excludedFromAverage) || 0;
  if (excluded > 0) aboutRows.push(['Note', `${excluded} approval(s) had no usable submission date and are not in the averages.`]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(waitingRows, { dateColumns: [4], widths: [28, 16, 10, 10, 14, 13, 9, 8, 14, 50], filter: true }), 'Waiting');
  XLSX.utils.book_append_sheet(wb, sheetFrom(monthRows, { widths: [28, 11, 11, 20], filter: true }), 'Last month');
  XLSX.utils.book_append_sheet(wb, sheetFrom(aboutRows, { widths: [16, 90] }), 'About');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
}

module.exports = { generateSampleApprovalXlsx };
