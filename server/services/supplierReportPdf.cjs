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

// The counts sit beside the percentage on purpose: a supplier who disputes a
// failure rate can be shown the two numbers it came from.
function drawMatrix(page, report, y, { bold, font }) {
  const rows = report.dieLifeRows || [];
  if (!rows.length) return y;

  const cols = [
    { x: MARGIN, w: 90, align: 'left' },
    { x: MARGIN + 95, w: 100, align: 'right' },
    { x: MARGIN + 200, w: 95, align: 'right' },
    { x: MARGIN + 300, w: 90, align: 'right' },
    { x: MARGIN + 395, w: 104, align: 'right' },
  ];

  text(page, 'DIE LIFE & FAILURE', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;
  tableRow(page, ['Month', 'Avg Die Life (MT)', 'Dies In Service', 'Dies Failed', 'Failure %'], cols,
    { y, font: bold, color: MUTED, size: 8.5 });
  y -= 6;
  rule(page, y);
  y -= 15;

  let failed = 0, inService = 0, weighted = 0, weight = 0;
  for (const r of rows) {
    const pct = (r.diesInService != null && r.diesInService > 0 && r.diesFailed != null)
      ? (r.diesFailed / r.diesInService) * 100 : null;
    tableRow(page, [
      MONTH_NAMES[r.month - 1] || String(r.month),
      fmt(r.avgDieLifeMt, 1) || '-',
      r.diesInService == null ? '-' : String(r.diesInService),
      r.diesFailed == null ? '-' : String(r.diesFailed),
      pct == null ? '-' : `${pct.toFixed(1)}%`,
    ], cols, { y, font, size: 9.5 });

    if (r.diesInService != null) {
      inService += r.diesInService;
      if (r.diesFailed != null) failed += r.diesFailed;
      if (r.avgDieLifeMt != null && r.diesInService > 0) {
        weighted += r.avgDieLifeMt * r.diesInService;
        weight += r.diesInService;
      }
    }
    y -= 17;
  }

  // Weighted exactly as the server aggregates. A simple mean here would print a
  // figure that quietly disagrees with the score on page 1.
  const totalLife = weight > 0 ? weighted / weight : null;
  const totalRate = inService > 0 ? (failed / inService) * 100 : null;
  rule(page, y + 6, { thickness: 1.1 });
  y -= 6;
  tableRow(page, [
    'Period',
    fmt(totalLife, 1) || '-',
    inService ? String(inService) : '-',
    inService ? String(failed) : '-',
    totalRate == null ? '-' : `${totalRate.toFixed(1)}%`,
  ], cols, { y, font: bold, size: 9.5 });

  y -= 20;
  text(page, 'Figures entered monthly. Failure % is derived from the counts, never entered directly.',
    { x: MARGIN, y, size: 8, font, color: MUTED });
  return y - 26;
}

// A small line chart, drawn as vector art. Metrics with fewer than two points
// are skipped entirely by the caller -- the browser export devoted a whole page
// to five boxes reading "Not enough data", which is not something to send to a
// supplier.
function drawTrendChart(page, { x, y, w, h, points, target, color, label, unit }, { bold, font }) {
  text(page, label, { x, y: y + h + 8, size: 9, font: bold });
  text(page, unit || '', { x, y: y + h + 8, size: 7.5, font, color: MUTED, align: 'right', width: w });

  const values = points.map((p) => p.value);
  const all = target != null ? [...values, target] : values;
  let min = Math.min(...all);
  let max = Math.max(...all);
  const range = (max - min) || 1;
  min -= range * 0.2;
  max += range * 0.2;
  const span = max - min;

  const px = (i) => x + (i / Math.max(1, points.length - 1)) * w;
  const py = (v) => y + ((v - min) / span) * h;

  page.drawRectangle({ x, y, width: w, height: h, borderColor: RULE, borderWidth: 0.6 });

  if (target != null) {
    const ty = py(target);
    page.drawLine({ start: { x, y: ty }, end: { x: x + w, y: ty }, thickness: 0.8, color: MUTED, dashArray: [3, 3] });
    text(page, `target ${target}`, { x: x - 2, y: ty + 3, size: 6.5, font, color: MUTED, align: 'right', width: w });
  }

  const c = hexColor(color);
  for (let i = 1; i < points.length; i += 1) {
    page.drawLine({
      start: { x: px(i - 1), y: py(points[i - 1].value) },
      end: { x: px(i), y: py(points[i].value) },
      thickness: 1.4, color: c,
    });
  }
  points.forEach((p, i) => {
    page.drawCircle({ x: px(i), y: py(p.value), size: 2, color: c });
    text(page, p.month, { x: px(i) - 12, y: y - 9, size: 6.5, font, color: MUTED, align: 'center', width: 24 });
  });
}

const TREND_COLORS = {
  dieLife: '#14B8A6', dieFailure: '#F43F5E', deliveryLeadTime: '#6366F1',
  designLeadTime: '#0EA5E9', trialRatio: '#8B5CF6', qdRate: '#EF4444', designRevisions: '#F59E0B',
};

// Returns the metrics that actually have two or more points to draw.
function trendable(report) {
  const out = [];
  for (const m of report.metrics || []) {
    if (!m.scored) continue;
    const points = (report.trend || [])
      .map((r) => ({ month: r.month, value: r[m.key] }))
      .filter((p) => Number.isFinite(Number(p.value)))
      .map((p) => ({ month: p.month, value: Number(p.value) }));
    if (points.length >= 2) out.push({ metric: m, points });
  }
  return out;
}

// Greedy wrap against the real measured width. Long words that still overflow
// are left long rather than broken mid-word.
function wrapText(str, font, size, maxW) {
  const out = [];
  for (const para of sanitize(str).split(/\r?\n/)) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxW && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function drawComments(doc, report, comments, preparedBy, { bold, font }) {
  const body = String(comments || '').trim();
  if (!body) return;

  const size = 10;
  const leading = 15;
  const lines = wrapText(body, font, size, CONTENT_W);

  // Its own page, so the remarks are never orphaned two lines below a chart.
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN - 20;
  text(page, 'COMMENTS & ACTION POINTS', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 10;
  rule(page, y);
  y -= 24;

  for (const line of lines) {
    if (y < MARGIN + 90) break; // one page of remarks is enough
    text(page, line, { x: MARGIN, y, size, font });
    y -= leading;
  }

  y -= 24;
  rule(page, y, { w: 200 });
  text(page, sanitize(preparedBy || 'Gulf Extrusion'), { x: MARGIN, y: y - 13, size: 9.5, font: bold });
  text(page, `Prepared ${new Date().toISOString().slice(0, 10)}`, { x: MARGIN, y: y - 26, size: 8.5, font, color: MUTED });
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
  const { logoBytes = null, comments = '', preparedBy = '' } = opts;
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

  const matrixRows = report.dieLifeRows || [];
  if (matrixRows.length) {
    const p2 = doc.addPage([PAGE_W, PAGE_H]);
    drawMatrix(p2, report, PAGE_H - MARGIN - 20, { bold, font });
  }

  const charts = trendable(report);
  if (charts.length) {
    const p3 = doc.addPage([PAGE_W, PAGE_H]);
    text(p3, `TRENDS - JAN TO ${String((report.period || {}).month || '').toUpperCase()} ${(report.period || {}).year || ''}`,
      { x: MARGIN, y: PAGE_H - MARGIN - 20, size: 8.5, font: bold, color: MUTED });

    // Two per row, three rows a page.
    const cw = (CONTENT_W - 24) / 2;
    const ch = 96;
    let cy = PAGE_H - MARGIN - 64;
    let page = p3;
    charts.forEach((c, i) => {
      const col = i % 2;
      if (col === 0 && i > 0) cy -= ch + 44;
      if (cy < MARGIN + 60) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        cy = PAGE_H - MARGIN - 64;
      }
      drawTrendChart(page, {
        x: MARGIN + col * (cw + 24), y: cy - ch, w: cw, h: ch,
        points: c.points, target: c.metric.scored ? c.metric.target : null,
        color: TREND_COLORS[c.metric.key] || '#1F6FB0',
        label: c.metric.label, unit: c.metric.unit,
      }, { bold, font });
    });
  }

  drawComments(doc, report, comments, preparedBy, { bold, font });
  drawFooters(doc, report, { font });
  return doc.save();
}

module.exports = { generateSupplierReportPdf, sanitize, MONTH_NAMES };
