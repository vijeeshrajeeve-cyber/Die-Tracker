'use strict';

// The monthly supplier performance report, as a document fit to send to a
// supplier.
//
// This exists because window.print() cannot produce one. The browser injects
// its own header and footer -- the date, the URL, "1/3" -- and the only way to
// suppress them is for whoever exports to untick a box in the print dialog
// every single month. It also prints the live DOM, which is why the export this
// replaces carried the application's sidebar down the left of every page and
// gave a whole page to five boxes reading "Not enough data".
//
// Unlike qdPdf.cjs there is no controlled template to reproduce: the QD form is
// a certification record with fixed coordinates, this is a report that may
// reflow freely. The constants below are layout, not contract.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const NAVY = rgb(0.122, 0.435, 0.690); // BRAND.navy #1F6FB0

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// StandardFonts are WinAnsi-encoded and throw on characters outside it. The
// band names carry "-" separators drawn from "·", and targets read "<=" from
// "≤" -- all of which would crash the generator rather than render. Replaced,
// not stripped, so the meaning survives.
function sanitize(str) {
  return String(str == null ? '' : str)
    .replace(/[·•]/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    // Anything still outside WinAnsi becomes a space rather than an exception.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

const hexColor = (hex) => {
  const h = String(hex || '#000000').replace('#', '');
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
};

function text(page, str, { x, y, size = 10, font, color = INK, align = 'left', width = 0 }) {
  const s = sanitize(str);
  if (!s) return;
  let px = x;
  if (align !== 'left') {
    const w = font.widthOfTextAtSize(s, size);
    px = align === 'right' ? x + width - w : x + (width - w) / 2;
  }
  page.drawText(s, { x: px, y, size, font, color });
}

function rule(page, y, { x = MARGIN, w = CONTENT_W, color = RULE, thickness = 0.7 } = {}) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });
}

// A table row. `cols` is [{ x, w, align }] and `cells` the strings for it.
function tableRow(page, cells, cols, { y, size = 9.5, font, color = INK }) {
  cells.forEach((c, i) => {
    const col = cols[i];
    if (!col) return;
    text(page, c, { x: col.x, y, size, font, color, align: col.align || 'left', width: col.w });
  });
}

const fmt = (v, decimals = 0) => (v == null ? null : Number(v).toFixed(decimals));

// Mirrors the server's ratingBand thresholds, colour only.
function scoreBandColor(score) {
  if (score >= 7.5) return '#16A34A';
  if (score >= 6.5) return '#0D9488';
  if (score >= 5.5) return '#D97706';
  if (score >= 4.0) return '#EA580C';
  return '#DC2626';
}

function drawHeader(page, report, { bold, font, logo }) {
  let y = PAGE_H - MARGIN;

  if (logo) {
    const maxH = 30;
    const scale = Math.min(maxH / logo.height, 150 / logo.width);
    page.drawImage(logo, { x: MARGIN, y: y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
  }
  text(page, 'SUPPLIER PERFORMANCE REPORT', { x: MARGIN, y: y - 12, size: 9, font: bold, color: MUTED, align: 'right', width: CONTENT_W });
  y -= 44;
  rule(page, y, { color: NAVY, thickness: 1.6 });
  y -= 26;

  text(page, report.supplier, { x: MARGIN, y, size: 22, font: bold });
  const p = report.period || {};
  text(page, `${p.month} ${p.year} - ${p.frequency}`, { x: MARGIN, y: y - 16, size: 10, font, color: MUTED });
  text(page, `Generated ${new Date().toISOString().slice(0, 10)}`, { x: MARGIN, y, size: 9, font, color: MUTED, align: 'right', width: CONTENT_W });
  return y - 40;
}

function drawRating(page, report, y, { bold, font }) {
  const r = report.rating;
  if (!r) {
    text(page, 'Not enough data to rate this supplier', { x: MARGIN, y, size: 13, font: bold });
    text(page, 'No scored metric has a value for this period.', { x: MARGIN, y: y - 15, size: 9.5, font, color: MUTED });
    return y - 44;
  }

  const bandColor = hexColor(r.band.color);
  page.drawRectangle({ x: MARGIN, y: y - 52, width: CONTENT_W, height: 64, color: rgb(0.97, 0.975, 0.98) });
  text(page, r.score.toFixed(1), { x: MARGIN + 16, y: y - 26, size: 34, font: bold, color: bandColor });
  text(page, '/10', { x: MARGIN + 16 + bold.widthOfTextAtSize(r.score.toFixed(1), 34) + 3, y: y - 26, size: 13, font, color: MUTED });
  text(page, r.band.label, { x: MARGIN + 120, y: y - 12, size: 12, font: bold, color: bandColor });

  const scored = (report.metrics || []).filter((m) => m.scored).length;
  const note = r.contributing < scored
    ? `Rated on ${r.contributing} of ${scored} scored metrics; the rating is renormalised over those with data.`
    : `Rated on all ${scored} scored metrics.`;
  text(page, note, { x: MARGIN + 120, y: y - 30, size: 9, font, color: MUTED });
  return y - 76;
}

function drawMetricTable(page, report, y, { bold, font }) {
  const cols = [
    { x: MARGIN, w: 170, align: 'left' },
    { x: MARGIN + 175, w: 80, align: 'right' },
    { x: MARGIN + 260, w: 80, align: 'right' },
    { x: MARGIN + 345, w: 60, align: 'right' },
    { x: MARGIN + 410, w: 89, align: 'right' },
  ];

  text(page, 'PERFORMANCE AGAINST TARGET', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;
  tableRow(page, ['Metric', 'Actual', 'Target', 'Weight', 'Score /10'], cols, { y, font: bold, color: MUTED, size: 8.5 });
  y -= 6;
  rule(page, y);
  y -= 15;

  for (const m of report.metrics || []) {
    if (!m.scored) continue;
    const value = report.snapshot ? report.snapshot[m.key] : null;
    const score = report.scores ? report.scores[m.key] : null;
    const unit = m.unit ? ` ${m.unit}` : '';

    const actual = value == null ? 'Not recorded' : `${fmt(value, m.decimals)}${unit}`;
    const target = `${m.lowerBetter ? '<=' : '>='} ${fmt(m.target, m.decimals)}${unit}`;
    const weight = `${Math.round(m.weight * 100)}%`;
    const scoreText = score == null ? '-' : score.toFixed(1);

    tableRow(page, [m.label, actual, target, weight, scoreText], cols, {
      y, font, size: 9.5, color: value == null ? MUTED : INK,
    });

    // A short bar under the score, so the table reads at a glance.
    if (score != null) {
      const barW = 89;
      const bx = cols[4].x;
      page.drawRectangle({ x: bx, y: y - 6, width: barW, height: 2.5, color: RULE });
      page.drawRectangle({ x: bx, y: y - 6, width: barW * (score / 10), height: 2.5, color: hexColor(scoreBandColor(score)) });
    }
    y -= 20;
  }

  const orders = report.snapshot ? report.snapshot.ordersPlaced : null;
  rule(page, y + 6);
  text(page, `Orders placed in the period: ${orders == null ? '-' : orders}`, { x: MARGIN, y: y - 8, size: 9, font, color: MUTED });
  return y - 30;
}

// Footers are drawn last because "Page N of M" cannot be known until every page
// exists.
function drawFooters(doc, report, { font }) {
  const pages = doc.getPages();
  const p = report.period || {};
  pages.forEach((page, i) => {
    rule(page, MARGIN + 22);
    text(page, `Gulf Extrusion - Supplier Performance Report - ${report.supplier} - ${p.month} ${p.year}`,
      { x: MARGIN, y: MARGIN + 10, size: 7.5, font, color: MUTED });
    text(page, `Page ${i + 1} of ${pages.length}`,
      { x: MARGIN, y: MARGIN + 10, size: 7.5, font, color: MUTED, align: 'right', width: CONTENT_W });
    text(page, 'Confidential - issued to the named supplier for performance review.',
      { x: MARGIN, y: MARGIN, size: 6.5, font, color: MUTED });
  });
}

async function generateSupplierReportPdf(report, opts = {}) {
  const { logoBytes = null } = opts;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A report without a logo is still a usable report; the QD renderer takes the
  // same view of a missing asset.
  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  let y = drawHeader(p1, report, { bold, font, logo });
  y = drawRating(p1, report, y, { bold, font });
  drawMetricTable(p1, report, y, { bold, font });

  drawFooters(doc, report, { font });
  return doc.save();
}

module.exports = { generateSupplierReportPdf, sanitize, MONTH_NAMES };
