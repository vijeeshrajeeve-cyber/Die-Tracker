'use strict';

// The monthly Sample Approval Followup: which samples are waiting for the
// customer's approval, and last month's approvals and rejections. Same
// controlled-form look as the Sample Status sheet (sampleStatusReportPdf.cjs):
// A4 landscape, Helvetica, a ruled title block on every page, ruled tables.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { sanitize, fit, wrap, stamp } = require('./trialPlanPdf.cjs');

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 28;
const CONTENT_W = PAGE_W - M * 2;
const BOTTOM = M + 18;

const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.36, 0.37, 0.40);
const LINE = rgb(0.45, 0.46, 0.49);
const HAIR = rgb(0.74, 0.75, 0.78);
const HEAD_FILL = rgb(0.90, 0.91, 0.92);
const BAND_FILL = rgb(0.96, 0.96, 0.97);
const URGENT = rgb(0.70, 0.07, 0.07);
const NAVY = rgb(0.09, 0.22, 0.40);
const PRESS_FILL = rgb(0.86, 0.90, 0.95);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WAIT_COLUMNS = [
  { key: 'die', label: 'Die #', share: 80 },
  { key: 'plant', label: 'Plant', share: 70 },
  { key: 'press', label: 'Press', share: 80 },
  { key: 'submitted', label: 'Submitted', share: 74 },
  { key: 'days', label: 'Days', share: 90 },
  { key: 'trials', label: 'Trials', share: 44 },
  { key: 'corrector', label: 'Corrector', share: 76 },
  { key: 'remark', label: 'Last remark', share: 260 },
];
const MONTH_COLUMNS = [
  { key: 'customer', label: 'Customer', share: 260 },
  { key: 'approved', label: 'Approved', share: 80 },
  { key: 'rejected', label: 'Rejected', share: 80 },
  { key: 'avg', label: 'Avg days to approval', share: 130 },
];
const MONTH_TABLE_W = 420;

const CELL_PAD = 4;
const BODY = 8.4;
const LINE_H = 10;
const HEAD_H = 17;
const BAND_H = 17;
const ROW_H = 18;

function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : '';
}

function layoutColumns(defs, totalW) {
  const total = defs.reduce((s, c) => s + c.share, 0);
  let x = M;
  return defs.map((c) => {
    const w = (totalW * c.share) / total;
    const col = { ...c, x, w };
    x += w;
    return col;
  });
}

const avgText = (v) => (v == null ? '-' : Number(v).toFixed(1));

function headerText(report) {
  const h = report.header || {};
  const monthName = String(report.monthLabel || '').split(' ')[0];
  return `Waiting now ${h.waiting || 0} - Overdue ${h.overdue || 0} - Approved in ${monthName} ${h.approved || 0} - Avg days to approval ${avgText(h.avgDays)}`;
}

function bandText(g) {
  const oldest = g.oldestDays == null ? '-' : `${g.oldestDays} d`;
  return `${g.count} waiting, ${g.overdue} overdue - oldest ${oldest}`;
}

// report: what buildSampleApproval returns. opts.logoBytes: PNG.
async function generateSampleApprovalPdf(report, { generatedAt = new Date(), logoBytes = null } = {}) {
  const groups = (report.waiting || []).filter((g) => (g.rows || []).length);
  const monthRows = (report.lastMonth && report.lastMonth.rows) || [];
  const total = (report.lastMonth && report.lastMonth.total) || { approved: 0, rejected: 0, avgDays: null };
  const footnotes = report.footnotes || {};
  const monthLabel = report.monthLabel || report.month || '';

  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`Sample Approval Followup - ${monthLabel}`));
  doc.setCreator('Die Tracker');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const waitCols = layoutColumns(WAIT_COLUMNS, CONTENT_W);
  const monthCols = layoutColumns(MONTH_COLUMNS, MONTH_TABLE_W);
  const pages = [];
  const pageSlots = [];
  let page;
  let y;

  const text = (str, x, ty, { size = BODY, f = font, color = INK, width = 0, align = 'left' } = {}) => {
    const s = width ? fit(str, f, size, width) : sanitize(str);
    if (!s) return;
    let px = x;
    if (align !== 'left' && width) {
      const w = f.widthOfTextAtSize(s, size);
      px = align === 'right' ? x + width - w : x + (width - w) / 2;
    }
    page.drawText(s, { x: px, y: ty, size, font: f, color });
  };
  const box = (x, top, w, h, { fill, border = LINE, thickness = 0.6 } = {}) =>
    page.drawRectangle({ x, y: top - h, width: w, height: h, color: fill, borderColor: border, borderWidth: thickness });
  const hline = (x1, x2, ly, { color = LINE, thickness = 0.6 } = {}) =>
    page.drawLine({ start: { x: x1, y: ly }, end: { x: x2, y: ly }, thickness, color });
  const vline = (x, top, bottom, { color = LINE, thickness = 0.6 } = {}) =>
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness, color });

  // Title block, on every page.
  const TITLE_H = 52;
  const LOGO_W = 150;
  const META_W = 200;
  const titleBlock = () => {
    const top = PAGE_H - M;
    if (logo) {
      const scale = Math.min((TITLE_H - 10) / logo.height, (LOGO_W - 16) / logo.width);
      const w = logo.width * scale;
      const h = logo.height * scale;
      page.drawImage(logo, { x: M + (LOGO_W - w) / 2, y: top - TITLE_H / 2 - h / 2, width: w, height: h });
    }
    box(M, top, CONTENT_W, TITLE_H, { thickness: 0.9 });
    vline(M + LOGO_W, top, top - TITLE_H);
    vline(M + CONTENT_W - META_W, top, top - TITLE_H);
    if (!logo) text('Die Tracker', M + 10, top - TITLE_H / 2 - 4, { size: 11, f: bold, color: NAVY });

    const midX = M + LOGO_W;
    const midW = CONTENT_W - LOGO_W - META_W;
    text('SAMPLE APPROVAL FOLLOWUP', midX, top - 24, { size: 17, f: bold, color: NAVY, width: midW, align: 'center' });
    text(`Report month ${monthLabel}`, midX, top - 41, { size: 10, f: bold, width: midW, align: 'center' });

    const gx = M + CONTENT_W - META_W;
    const rowH = TITLE_H / 3;
    const labelW = 52;
    [['Issued', stamp(generatedAt)], ['Target', `${report.targetDays} days`], ['Page', '']].forEach(([label, value], i) => {
      const rowTop = top - i * rowH;
      if (i) hline(gx, M + CONTENT_W, rowTop, { color: HAIR });
      page.drawRectangle({ x: gx, y: rowTop - rowH, width: labelW, height: rowH, color: BAND_FILL });
      text(label, gx + 6, rowTop - rowH + 5.6, { size: 7, f: bold, color: MUTED });
      text(value, gx + labelW + 6, rowTop - rowH + 5.4, { size: 8, width: META_W - labelW - 12 });
      if (label === 'Page') pageSlots.push({ page, x: gx + labelW + 6, y: rowTop - rowH + 5.4 });
    });
    vline(gx + labelW, top, top - TITLE_H, { color: HAIR });
    y = top - TITLE_H - 12;
  };
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    titleBlock();
  };
  newPage();

  // Header line.
  text(headerText(report), M, y - 10, { size: 10.5, f: bold, width: CONTENT_W });
  y -= 26;

  const sectionTitle = (label) => {
    text(label, M, y - 10, { size: 11, f: bold, color: NAVY });
    hline(M, M + CONTENT_W, y - 15, { color: NAVY, thickness: 0.9 });
    y -= 24;
  };

  const tableHead = (cols, w) => {
    box(M, y, w, HEAD_H, { fill: HEAD_FILL, thickness: 0.8 });
    for (const c of cols) {
      if (c.x > M) vline(c.x, y, y - HEAD_H);
      text(c.label, c.x + CELL_PAD, y - 11.4, { size: 7, f: bold, width: c.w - CELL_PAD * 2 });
    }
    y -= HEAD_H;
  };

  const remarkCol = waitCols[7];
  const remarkLines = (r) => wrap(r.remark, font, BODY, remarkCol.w - CELL_PAD * 2, 2);
  const rowHeight = (r) => Math.max(ROW_H, remarkLines(r).length * LINE_H + 8);

  const customerBand = (g, continued) => {
    box(M, y, CONTENT_W, BAND_H, { fill: PRESS_FILL, thickness: 0.8 });
    const name = sanitize(g.customer);
    text(name, M + CELL_PAD + 2, y - 12, { size: 9.6, f: bold, color: NAVY, width: CONTENT_W / 2 });
    const nameW = Math.min(bold.widthOfTextAtSize(name, 9.6), CONTENT_W / 2);
    text(`${bandText(g)}${continued ? '   |   continued' : ''}`, M + CELL_PAD + 14 + nameW, y - 11.8,
      { size: 8, color: MUTED });
    y -= BAND_H;
  };

  const plain = (value, x, ty, w) => text(value || '-', x, ty, { width: w, color: value ? INK : MUTED });

  const daysCell = (r, c, ty) => {
    const x = c.x + CELL_PAD;
    if (r.daysWaiting == null) {
      text('-', x, ty, { color: MUTED });
    } else if (r.overdue) {
      const n = String(r.daysWaiting);
      text(n, x, ty, { f: bold });
      text('OVERDUE', x + bold.widthOfTextAtSize(n, BODY) + 5, ty, { size: 7.4, f: bold, color: URGENT });
    } else {
      text(String(r.daysWaiting), x, ty);
    }
  };

  const dataRow = (r) => {
    const h = rowHeight(r);
    box(M, y, CONTENT_W, h);
    const first = y - 11.9;
    for (const c of waitCols) {
      if (c.x > M) vline(c.x, y, y - h);
      const w = c.w - CELL_PAD * 2;
      const x = c.x + CELL_PAD;
      switch (c.key) {
        case 'die': text(r.die, x, first, { f: bold, width: w }); break;
        case 'plant': plain(r.plant, x, first, w); break;
        case 'press': plain(r.press, x, first, w); break;
        case 'submitted': plain(shortDate(r.submittedDate), x, first, w); break;
        case 'days': daysCell(r, c, first); break;
        case 'trials': {
          const own = Number(r.trialCount) || 0;
          const legacy = Number(r.legacyTrialCount) || 0;
          if (own) text(String(own), x, first);
          else if (legacy) text(`(${legacy})`, x, first, { color: MUTED });
          else text('-', x, first, { color: MUTED });
          break;
        }
        case 'corrector': plain(r.corrector, x, first, w); break;
        case 'remark': {
          if (!r.remark) text('-', x, first, { color: MUTED });
          else remarkLines(r).forEach((line, i) => text(line, x, first - i * LINE_H, { width: w }));
          break;
        }
        default: break;
      }
    }
    y -= h;
  };

  // Section 1: waiting for approval.
  sectionTitle(`WAITING FOR APPROVAL - as of ${shortDate(report.reportDate) || shortDate(generatedAt.toISOString())}`);
  if (!groups.length) {
    text('No samples are waiting for approval.', M, y - 10, { size: 10, f: bold });
    y -= 24;
  } else {
    for (const g of groups) {
      // A band never sits alone at the foot of a page.
      if (y - (BAND_H + HEAD_H + rowHeight(g.rows[0])) < BOTTOM) newPage();
      customerBand(g, false);
      tableHead(waitCols, CONTENT_W);
      for (const r of g.rows) {
        if (y - rowHeight(r) < BOTTOM) {
          newPage();
          customerBand(g, true);
          tableHead(waitCols, CONTENT_W);
        }
        dataRow(r);
      }
      y -= 12;
    }
  }

  // Footnotes, worked out first so the last table rows can reserve room for them.
  const notes = [];
  if (footnotes.rejectionsNote) notes.push(footnotes.rejectionsNote);
  const excluded = Number(footnotes.excludedFromAverage) || 0;
  if (excluded > 0) notes.push(`${excluded} approval(s) had no usable submission date and are not in the averages.`);
  const NOTES_H = notes.length ? 6 + notes.length * 11 + 8 : 0;
  // The Total row and the notes always travel with the last data row.
  const TAIL_H = ROW_H + 6 + NOTES_H;

  // Section 2: last month.
  y -= 6;
  if (y - (24 + HEAD_H + ROW_H + (monthRows.length <= 1 ? TAIL_H : ROW_H)) < BOTTOM) newPage();
  sectionTitle(`LAST MONTH - ${monthLabel}`);
  if (!monthRows.length) {
    text(`No approvals or rejections in ${monthLabel}.`, M, y - 10, { size: 10, f: bold });
    y -= 24;
  } else {
    const monthHead = () => tableHead(monthCols, MONTH_TABLE_W);
    const monthRow = (r, isTotal, reserve = 0) => {
      if (y - (ROW_H + reserve) < BOTTOM) {
        newPage();
        monthHead();
      }
      box(M, y, MONTH_TABLE_W, ROW_H, { fill: isTotal ? HEAD_FILL : undefined });
      const ty = y - 11.9;
      const f = isTotal ? bold : font;
      monthCols.forEach((c) => {
        if (c.x > M) vline(c.x, y, y - ROW_H);
        const w = c.w - CELL_PAD * 2;
        const x = c.x + CELL_PAD;
        if (c.key === 'customer') text(isTotal ? 'Total' : r.customer, x, ty, { f: bold, width: w });
        else if (c.key === 'avg') text(avgText(r.avgDays), x, ty, { f, color: r.avgDays == null ? MUTED : INK });
        else text(String(r[c.key] || 0), x, ty, { f });
      });
      y -= ROW_H;
    };
    monthHead();
    monthRows.forEach((r, i) => monthRow(r, false, i === monthRows.length - 1 ? TAIL_H : 0));
    monthRow(total, true);
    y -= 6;
  }

  // Footnotes (space was reserved above; the check only matters for an empty last-month section).
  if (y - NOTES_H < BOTTOM) newPage();
  y -= 6;
  notes.forEach((n) => {
    text(n, M, y - 8, { size: 8, color: MUTED, width: CONTENT_W });
    y -= 11;
  });

  // Footer and page numbers.
  const count = pages.length;
  pages.forEach((p) => {
    page = p;
    hline(M, M + CONTENT_W, M + 14, { color: HAIR });
    text(`Generated by Die Tracker on ${stamp(generatedAt)}`, M, M + 4, { size: 7, color: MUTED });
    text(`OVERDUE = waiting more than ${report.targetDays} days since submission.`, M, M + 4,
      { size: 7, color: MUTED, width: CONTENT_W, align: 'right' });
  });
  for (const slot of pageSlots) {
    page = slot.page;
    text(`${pages.indexOf(slot.page) + 1} of ${count}`, slot.x, slot.y, { size: 8 });
  }
  return doc.save();
}

module.exports = { generateSampleApprovalPdf, headerText, bandText };
