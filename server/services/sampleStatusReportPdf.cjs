'use strict';

// The daily Sample Status sheet: every die still in trial, by plant and press.
// Same controlled-form look as the Trial Schedule (trialPlanPdf.cjs): A4
// landscape, Helvetica, a ruled title block on every page, ruled tables.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { sanitize, fit, wrap, longDate, stamp } = require('./trialPlanPdf.cjs');

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
const TODAY_FILL = rgb(0.85, 0.94, 0.86);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLUMNS = [
  { key: 'die', label: 'Die #', share: 70 },
  { key: 'customer', label: 'Customer', share: 128 },
  { key: 'type', label: 'Type', share: 58 },
  { key: 'supplier', label: 'Supplier', share: 96 },
  { key: 'received', label: 'Received', share: 68 },
  { key: 'days', label: 'Days', share: 76 },
  { key: 'last', label: 'Last trial', share: 82 },
  { key: 'trials', label: 'Trials', share: 40 },
  { key: 'corrector', label: 'Corrector', share: 66 },
  { key: 'latest', label: 'Latest result', share: 186 },
];

const CELL_PAD = 4;
const BODY = 8.4;
const LINE_H = 10;
const HEAD_H = 17;
const BAND_H = 17;

function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : '';
}
const fullShort = (iso) => {
  const s = shortDate(iso);
  return s ? `${s} ${String(iso).slice(0, 4)}` : '';
};

function summaryText(c) {
  return `In trial ${c.inTrial} - Late ${c.late} - Submitted today ${c.submittedToday} - Trials today ${c.trialsToday} (${c.trialsOk} OK / ${c.trialsNotOk} Not OK)`;
}

function layoutColumns() {
  const total = COLUMNS.reduce((s, c) => s + c.share, 0);
  let x = M;
  return COLUMNS.map((c) => {
    const w = (CONTENT_W * c.share) / total;
    const col = { ...c, x, w };
    x += w;
    return col;
  });
}

// report: what buildSampleStatus returns. opts.logoBytes: PNG.
async function generateSampleStatusPdf(report, { generatedAt = new Date(), logoBytes = null } = {}) {
  const allPlants = report.plants || [];
  const plants = allPlants.filter((p) => (p.presses || []).some((pr) => (pr.rows || []).length));
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`Sample Status - ${report.reportDate}`));
  doc.setCreator('Die Tracker');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const cols = layoutColumns();
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
    text('SAMPLE STATUS', midX, top - 24, { size: 17, f: bold, color: NAVY, width: midW, align: 'center' });
    const plantNote = report.plantFilter && report.plantFilter !== 'All' ? `  |  ${report.plantFilter}` : '';
    text(`Report date ${longDate(report.reportDate)}${plantNote}`, midX, top - 41,
      { size: 10, f: bold, width: midW, align: 'center' });

    const gx = M + CONTENT_W - META_W;
    const rowH = TITLE_H / 2;
    const labelW = 52;
    [['Issued', stamp(generatedAt)], ['Page', '']].forEach(([label, value], i) => {
      const rowTop = top - i * rowH;
      if (i) hline(gx, M + CONTENT_W, rowTop, { color: HAIR });
      page.drawRectangle({ x: gx, y: rowTop - rowH, width: labelW, height: rowH, color: BAND_FILL });
      text(label, gx + 6, rowTop - rowH + 9, { size: 7.4, f: bold, color: MUTED });
      text(value, gx + labelW + 6, rowTop - rowH + 8.8, { size: 8.4, width: META_W - labelW - 12 });
      if (label === 'Page') pageSlots.push({ page, x: gx + labelW + 6, y: rowTop - rowH + 8.8 });
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

  // Summary: one line per plant.
  if (!plants.length) {
    text('No dies in trial.', M, y - 12, { size: 11, f: bold });
    y -= 24;
  } else {
    for (const p of plants) {
      text(sanitize(p.plant), M, y - 10, { size: 10, f: bold, color: NAVY });
      text(summaryText(p.counts), M + 90, y - 10, { size: 9.4 });
      y -= 16;
    }
    y -= 8;
  }

  const tableHead = () => {
    box(M, y, CONTENT_W, HEAD_H, { fill: HEAD_FILL, thickness: 0.8 });
    for (const c of cols) {
      if (c.x > M) vline(c.x, y, y - HEAD_H);
      text(c.label, c.x + CELL_PAD, y - 11.4, { size: 7, f: bold, width: c.w - CELL_PAD * 2 });
    }
    y -= HEAD_H;
  };

  const latestLines = (r) => wrap(r.latest, font, BODY, cols[9].w - CELL_PAD * 2, 2);
  const rowHeight = (r) => Math.max(18, latestLines(r).length * LINE_H + 8);

  const plantBand = (p, continued) => {
    box(M, y, CONTENT_W, BAND_H, { fill: NAVY, border: NAVY, thickness: 0.8 });
    const name = sanitize(p.plant);
    text(name, M + CELL_PAD + 2, y - 12, { size: 10, f: bold, color: rgb(1, 1, 1) });
    text(continued ? 'continued' : `${p.counts.inTrial} in trial`, M + CELL_PAD + 14 + bold.widthOfTextAtSize(name, 10), y - 11.8,
      { size: 8, color: rgb(0.85, 0.89, 0.95) });
    y -= BAND_H;
  };
  const pressBand = (press, n, continued) => {
    box(M, y, CONTENT_W, BAND_H, { fill: PRESS_FILL, thickness: 0.8 });
    const name = sanitize(press);
    text(name, M + CELL_PAD + 2, y - 12, { size: 9.6, f: bold, color: NAVY });
    text(`${n} ${n === 1 ? 'die' : 'dies'}${continued ? '   |   continued' : ''}`,
      M + CELL_PAD + 12 + bold.widthOfTextAtSize(name, 9.6), y - 11.8, { size: 8, color: MUTED });
    y -= BAND_H;
  };

  const dayCell = (r, c, ty) => {
    const x = c.x + CELL_PAD;
    if (r.status === 'Rejected') {
      text(r.rejectedWait == null ? 'Rejected' : `Rejected - ${r.rejectedWait} d`, x, ty,
        { f: bold, color: URGENT, width: c.w - CELL_PAD * 2 });
    } else if (r.days == null) {
      text('-', x, ty, { color: MUTED });
    } else if (r.late) {
      const n = String(r.days);
      text(n, x, ty, { f: bold });
      text('LATE', x + bold.widthOfTextAtSize(n, BODY) + 5, ty, { size: 7.4, f: bold, color: URGENT });
    } else {
      text(String(r.days), x, ty);
    }
  };

  const plain = (value, x, ty, w) => text(value || '-', x, ty, { width: w, color: value ? INK : MUTED });

  const dataRow = (r) => {
    const h = rowHeight(r);
    box(M, y, CONTENT_W, h, { fill: r.submittedToday ? TODAY_FILL : undefined });
    const first = y - 11.9;
    for (const c of cols) {
      if (c.x > M) vline(c.x, y, y - h);
      const w = c.w - CELL_PAD * 2;
      const x = c.x + CELL_PAD;
      switch (c.key) {
        case 'die': text(r.die, x, first, { f: bold, width: w }); break;
        case 'customer': plain(r.customer, x, first, w); break;
        case 'type': plain(r.dieType, x, first, w); break;
        case 'supplier': plain(r.supplier, x, first, w); break;
        case 'received': plain(fullShort(r.receivedDate), x, first, w); break;
        case 'days': dayCell(r, c, first); break;
        case 'last': {
          const d = shortDate(r.lastTrialDate);
          plain(d && (r.daysSinceTrial == null ? d : `${d} (${r.daysSinceTrial} d ago)`), x, first, w);
          break;
        }
        case 'trials': {
          const own = Number(r.trialCount) || 0;
          const legacy = Number(r.legacyTrialCount) || 0;
          if (own) text(String(own), x, first);
          else if (legacy) text(`(${legacy})`, x, first, { color: MUTED });
          else text('-', x, first, { color: MUTED });
          break;
        }
        case 'corrector': plain(r.corrector, x, first, w); break;
        case 'latest': latestLines(r).forEach((line, i) => text(line, x, first - i * LINE_H, { width: w })); break;
        default: break;
      }
    }
    y -= h;
  };

  for (const p of plants) {
    const presses = p.presses.filter((pr) => pr.rows.length);
    // A plant band never sits alone at the foot of a page.
    if (y - (BAND_H * 2 + HEAD_H + rowHeight(presses[0].rows[0])) < BOTTOM) newPage();
    plantBand(p, false);
    tableHead();
    for (const pr of presses) {
      if (y - (BAND_H + rowHeight(pr.rows[0])) < BOTTOM) {
        newPage();
        plantBand(p, true);
        tableHead();
      }
      pressBand(pr.press, pr.rows.length, false);
      for (const r of pr.rows) {
        if (y - rowHeight(r) < BOTTOM) {
          newPage();
          plantBand(p, true);
          tableHead();
          pressBand(pr.press, pr.rows.length, true);
        }
        dataRow(r);
      }
    }
    y -= 12;
  }

  // Footer and page numbers.
  const total = pages.length;
  pages.forEach((p) => {
    page = p;
    hline(M, M + CONTENT_W, M + 14, { color: HAIR });
    text(`Generated by Die Tracker on ${stamp(generatedAt)}`, M, M + 4, { size: 7, color: MUTED });
    text('Green rows were submitted today. LATE = more than 7 days since received.', M, M + 4,
      { size: 7, color: MUTED, width: CONTENT_W, align: 'right' });
  });
  for (const slot of pageSlots) {
    page = slot.page;
    text(`${pages.indexOf(slot.page) + 1} of ${total}`, slot.x, slot.y, { size: 8.4 });
  }
  return doc.save();
}

module.exports = { generateSampleStatusPdf, summaryText };
