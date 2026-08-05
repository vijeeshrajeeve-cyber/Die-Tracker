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

// "1 Jul - 31 Aug 2026". Drops the repeated year when both ends share one.
function periodCaption(p) {
  const day = (iso) => {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return '';
    return { d, m: MONTH_NAMES[m - 1], y };
  };
  const a = day(p.from);
  const b = day(p.to);
  if (!a || !b) return `${p.month} ${p.year}`;
  const left = a.y === b.y ? `${a.d} ${a.m}` : `${a.d} ${a.m} ${a.y}`;
  return `${left} to ${b.d} ${b.m} ${b.y}`;
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
  // The exact window, spelled out. "Quarterly" ending in August means July to
  // August, not a whole quarter, and "YTD" means January to the chosen month --
  // neither is obvious to a supplier reading the word alone, and this document
  // has to stand on its own once it has left the building.
  const covered = periodCaption(p);
  text(page, `${p.frequency} report - ${covered}`, { x: MARGIN, y: y - 16, size: 10, font, color: MUTED });
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

const GREEN = '#16A34A';
const AMBER = '#D97706';

// A status disc with a hand-drawn glyph. The icon carries meaning rather than
// decoration: it says at a glance whether the metric passed, which is the first
// thing anyone reads off a card.
function drawStatusDisc(page, cx, cy, status, color) {
  const c = hexColor(color);
  page.drawCircle({ x: cx, y: cy, size: 7, color: c, opacity: 0.14 });
  const white = rgb(1, 1, 1);
  if (status === 'ok') {
    // A tick, drawn rather than typed: WinAnsi has no check character, so a
    // glyph would sanitize away to a blank disc.
    page.drawLine({ start: { x: cx - 2.8, y: cy + 0.2 }, end: { x: cx - 0.8, y: cy - 2.0 }, thickness: 1.3, color: c });
    page.drawLine({ start: { x: cx - 0.8, y: cy - 2.0 }, end: { x: cx + 2.9, y: cy + 2.6 }, thickness: 1.3, color: c });
  } else if (status === 'warn') {
    page.drawLine({ start: { x: cx, y: cy + 2.8 }, end: { x: cx, y: cy - 0.4 }, thickness: 1.3, color: c });
    page.drawCircle({ x: cx, y: cy - 2.4, size: 0.75, color: c });
  } else {
    page.drawLine({ start: { x: cx - 2.4, y: cy }, end: { x: cx + 2.4, y: cy }, thickness: 1.3, color: c });
  }
  void white;
}

// The movement line: how this metric changed against the same supplier's own
// previous period. Never against another supplier -- this document is sent to
// the one it names.
function movementLine(m, value, previousValue, label) {
  // Unscored metrics get no movement line. Order volume is labelled "scale
  // context - not scored", so calling a change in it "better" would pass
  // judgement on the one number the report promises not to judge.
  if (!m.scored) return null;
  if (value == null || previousValue == null || !label) return null;
  const delta = Number(value) - Number(previousValue);
  const size = Math.abs(delta);
  if (size < 0.05) return `unchanged vs ${label}`;
  const improved = m.lowerBetter ? delta < 0 : delta > 0;
  const unit = m.unit ? ` ${m.unit}` : '';
  return `${fmt(size, m.decimals)}${unit} ${improved ? 'better' : 'worse'} than ${label} (${fmt(previousValue, m.decimals)}${unit})`;
}

function drawMetricCard(page, m, ctx, { x, y, w, h }, { bold, font }) {
  const { value, score, previousValue, previousLabel } = ctx;
  const top = y + h;

  page.drawRectangle({ x, y, width: w, height: h, borderColor: RULE, borderWidth: 0.6 });

  // Status drives the disc and the target line colour.
  let status = 'none';
  let statusColor = '#94A3B8';
  if (m.scored && value != null) {
    const onTarget = m.lowerBetter ? value <= m.target : value >= m.target;
    status = onTarget ? 'ok' : 'warn';
    statusColor = onTarget ? GREEN : AMBER;
  } else if (!m.scored) {
    statusColor = '#1F6FB0';
  }

  drawStatusDisc(page, x + 18, top - 15, status, statusColor);
  text(page, m.label, { x: x + 31, y: top - 18, size: 7.4, font: bold });

  if (score != null) {
    const badgeW = 26;
    const bx = x + w - badgeW - 9;
    const bc = hexColor(scoreBandColor(score));
    page.drawRectangle({ x: bx, y: top - 23, width: badgeW, height: 12, color: bc, opacity: 0.13 });
    text(page, score.toFixed(1), { x: bx, y: top - 19.5, size: 7.2, font: bold, color: bc, align: 'center', width: badgeW });
  }

  // The number itself, the largest thing on the card.
  if (value == null) {
    text(page, 'Not recorded', { x: x + 12, y: top - 45, size: 13, font: bold, color: MUTED });
    text(page, 'no figure for this period', { x: x + 12, y: top - 58, size: 6.4, font, color: MUTED });
  } else {
    const shown = fmt(value, m.decimals);
    text(page, shown, { x: x + 12, y: top - 47, size: 19, font: bold });
    if (m.unit) {
      text(page, m.unit, { x: x + 14 + bold.widthOfTextAtSize(shown, 19), y: top - 47, size: 7.4, font, color: MUTED });
    }
    if (m.scored) {
      const label = status === 'ok' ? 'On target' : 'Off target';
      text(page, label, { x: x + 12, y: top - 60, size: 6.6, font: bold, color: hexColor(statusColor) });
      text(page, `- target ${m.lowerBetter ? '<=' : '>='} ${fmt(m.target, m.decimals)}${m.unit ? ` ${m.unit}` : ''}`,
        { x: x + 14 + bold.widthOfTextAtSize(label, 6.6), y: top - 60, size: 6.6, font, color: MUTED });
    } else {
      text(page, 'scale context - not scored', { x: x + 12, y: top - 60, size: 6.6, font, color: MUTED });
    }
  }

  if (score != null) {
    const barW = w - 24;
    page.drawRectangle({ x: x + 12, y: top - 70, width: barW, height: 3, color: RULE });
    page.drawRectangle({ x: x + 12, y: top - 70, width: barW * (score / 10), height: 3, color: hexColor(scoreBandColor(score)) });
  }

  const move = movementLine(m, value, previousValue, previousLabel);
  if (move) {
    rule(page, y + 15, { x: x + 12, w: w - 24 });
    text(page, move, { x: x + 12, y: y + 6, size: 5.9, font, color: MUTED });
  }
}

// Three across. Reads as a dashboard rather than a spreadsheet -- the same
// information the old table carried, but a supplier can find their worst metric
// without reading every row.
function drawMetricCards(page, report, y, { bold, font }) {
  text(page, 'METRIC BREAKDOWN', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;

  const GAP = 11;
  const cardW = (CONTENT_W - GAP * 2) / 3;
  const cardH = 97;
  const prev = (report.previous && report.previous.snapshot) || {};
  const prevLabel = report.previous && report.previous.label;

  const cards = (report.metrics || []).filter((m) => m.scored || m.key === 'ordersPlaced');
  cards.forEach((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    drawMetricCard(page, m, {
      value: report.snapshot ? report.snapshot[m.key] : null,
      score: report.scores ? report.scores[m.key] : null,
      previousValue: prev[m.key],
      previousLabel: prevLabel,
    }, {
      x: MARGIN + col * (cardW + GAP),
      y: y - cardH - row * (cardH + GAP),
      w: cardW, h: cardH,
    }, { bold, font });
  });

  const rows = Math.ceil(cards.length / 3);
  return y - rows * (cardH + GAP) - 8;
}

function drawScoreExplainer(page, report, y, { bold, font }) {
  const weights = (report.metrics || [])
    .filter((m) => m.scored)
    .map((m) => `${m.label} ${Math.round(m.weight * 100)}%`)
    .join(' - ');

  const body = `Each metric is scored 0-10 against a Gulf Extrusion target band, then combined using the weights shown here: ${weights}. Lower is better for every metric except die life, where higher is better. Order volume reports scale and does not affect the score. A metric with no figure for the period is excluded and the rating is renormalised over the rest, never scored zero.`;
  const lines = wrapText(body, font, 7.4, CONTENT_W - 24);
  const boxH = 26 + lines.length * 10;

  page.drawRectangle({ x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: rgb(0.97, 0.975, 0.98) });
  text(page, 'HOW THE SCORE IS CALCULATED', { x: MARGIN + 12, y: y - 16, size: 7.6, font: bold, color: MUTED });
  lines.forEach((line, i) => {
    text(page, line, { x: MARGIN + 12, y: y - 29 - i * 10, size: 7.4, font, color: INK });
  });
  return y - boxH - 22;
}

// Space for a wet signature on both sides. A performance review that nobody
// signs is a memo; the supplier acknowledging it is the point of sending it.
function drawSignOff(page, y, preparedBy, { bold, font }) {
  const colW = (CONTENT_W - 40) / 2;
  const cols = [
    { x: MARGIN, label: 'Prepared by - Gulf Extrusion', name: preparedBy },
    { x: MARGIN + colW + 40, label: 'Supplier acknowledgement - name, signature and date', name: '' },
  ];
  for (const c of cols) {
    if (c.name) text(page, c.name, { x: c.x, y: y + 6, size: 8, font: bold, color: MUTED });
    rule(page, y, { x: c.x, w: colW, color: rgb(0.65, 0.68, 0.72) });
    text(page, c.label, { x: c.x, y: y - 11, size: 6.8, font, color: MUTED });
  }
  return y - 26;
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
// Every chart on the page shares one timeline: January through the reported
// month, whether or not this metric has a figure in each of them.
//
// Scaling each chart to its own data instead would give the page a different
// x-axis per card -- die life running Jul-Sep beside design lead time running
// Jan-Apr -- and nothing on a page headed "monthly trend" could be compared
// with anything else. Months without a figure leave a gap in the line rather
// than a plotted zero or an interpolated straight-through.
function drawTrendChart(page, { x, y, w, h, axis, points, target, color, label, unit, bars }, { bold, font }) {
  text(page, label, { x, y: y + h + 8, size: 9, font: bold });
  text(page, unit || '', { x, y: y + h + 8, size: 7.5, font, color: MUTED, align: 'right', width: w });

  const values = points.map((p) => p.value);
  const all = target != null ? [...values, target] : values;
  let min = Math.min(...all);
  let max = Math.max(...all);
  // Bars are read against zero: starting the axis part-way up exaggerates the
  // difference between one month and the next.
  if (bars) min = 0;
  const range = (max - min) || 1;
  if (!bars) min -= range * 0.2;
  max += range * 0.2;
  const span = max - min;

  const lastIdx = Math.max(1, axis.length - 1);
  const px = (i) => x + (i / lastIdx) * w;
  const py = (v) => y + ((v - min) / span) * h;

  page.drawRectangle({ x, y, width: w, height: h, borderColor: RULE, borderWidth: 0.6 });

  if (target != null) {
    const ty = py(target);
    page.drawLine({ start: { x, y: ty }, end: { x: x + w, y: ty }, thickness: 0.8, color: MUTED, dashArray: [3, 3] });
  }

  const c = hexColor(color);
  if (bars) {
    // A count reads as bars, matching how the app charts it on screen. Zero is
    // a real reading here, so a bar of no height still gets its baseline tick.
    const slot = w / axis.length;
    const bw = Math.min(slot * 0.55, 9);
    for (const p of points) {
      const bx = px(p.index) - bw / 2;
      const top = py(p.value);
      page.drawRectangle({ x: bx, y: y + 0.6, width: bw, height: Math.max(0.8, top - y), color: c });
    }
  } else {
    // Join only months that sit next to each other. Drawing straight through a
    // gap would invent a reading for a month nobody recorded.
    for (let k = 1; k < points.length; k += 1) {
      if (points[k].index !== points[k - 1].index + 1) continue;
      page.drawLine({
        start: { x: px(points[k - 1].index), y: py(points[k - 1].value) },
        end: { x: px(points[k].index), y: py(points[k].value) },
        thickness: 1.4, color: c,
      });
    }
    for (const p of points) {
      page.drawCircle({ x: px(p.index), y: py(p.value), size: 2, color: c });
    }
  }

  // The target caption goes on last, knocked out of the plot. Drawn earlier it
  // is painted over by the series wherever the data crosses its own target --
  // which is precisely where a reader looks.
  if (target != null) {
    const ty = py(target);
    const caption = `target ${target}`;
    const capW = font.widthOfTextAtSize(caption, 6.5);
    page.drawRectangle({ x: x + w - capW - 4, y: ty + 1.4, width: capW + 4, height: 8, color: rgb(1, 1, 1) });
    text(page, caption, { x: x - 2, y: ty + 3, size: 6.5, font, color: MUTED, align: 'right', width: w });
  }

  // Twelve labels on a half-width chart collide, so thin them out.
  const step = axis.length > 8 ? 2 : 1;
  axis.forEach((m, i) => {
    if (i % step !== 0 && i !== axis.length - 1) return;
    text(page, m, { x: px(i) - 12, y: y - 9, size: 6.5, font, color: MUTED, align: 'center', width: 24 });
  });
}

const TREND_COLORS = {
  dieLife: '#14B8A6', dieFailure: '#F43F5E', deliveryLeadTime: '#6366F1',
  designLeadTime: '#0EA5E9', trialRatio: '#8B5CF6', qdRate: '#EF4444', designRevisions: '#F59E0B',
};

// Returns the metrics that actually have two or more points to draw.
//
// The null check is load-bearing and easy to lose: Number(null) is 0, and 0 is
// finite, so testing Number.isFinite alone silently turns every unrecorded
// month into a plotted zero. That would draw a supplier a chart claiming their
// die life was 0 MT for the six months before anyone started recording it.
// A month with no figure is absent from the line, not a point on the floor.
// Every metric in the breakdown gets a chart, order volume included -- the page
// is the whole scorecard over time, and a missing card reads as an oversight
// rather than as an absence of data.
//
// A metric is dropped only when it has no figure in any month of the year. That
// is the case the original browser export got wrong: it printed a page of five
// boxes reading "Not enough data", which is worse than not printing them.
function trendable(report) {
  const trend = report.trend || [];
  // The shared timeline for every chart on the page: January through the month
  // this report ends at.
  const axis = trend.map((r) => r.month);
  const out = [];
  for (const m of report.metrics || []) {
    const points = trend
      .map((r, index) => ({ index, month: r.month, value: r[m.key] }))
      .filter((p) => p.value !== null && p.value !== undefined && p.value !== ''
        && Number.isFinite(Number(p.value)))
      .map((p) => ({ index: p.index, month: p.month, value: Number(p.value) }));
    // One recorded month is worth showing as a single marker. Zero is not.
    if (points.length >= 1) out.push({ metric: m, points, axis });
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

  // Attribution only, deliberately not a second signature rule: the sign-off
  // block on the scorecard is the one place this document gets signed, and two
  // ruled lines would leave the supplier guessing which.
  y -= 18;
  text(page, `${sanitize(preparedBy || 'Gulf Extrusion')} - ${new Date().toISOString().slice(0, 10)}`,
    { x: MARGIN, y, size: 8, font, color: MUTED });
}

// Footers are drawn last because "Page N of M" cannot be known until every page
// exists.
function drawFooters(doc, report, { font, bold }) {
  const pages = doc.getPages();
  const p = report.period || {};
  const red = hexColor('#B91C1C');
  pages.forEach((page, i) => {
    rule(page, MARGIN + 16);
    text(page, 'CONFIDENTIAL - SHARED UNDER SUPPLIER AGREEMENT',
      { x: MARGIN, y: MARGIN + 4, size: 7, font: bold, color: red });
    text(page, `${report.supplier} - ${p.frequency === 'YTD' ? 'YTD' : p.month} ${p.year} - Page ${i + 1} of ${pages.length}`,
      { x: MARGIN, y: MARGIN + 4, size: 7, font, color: MUTED, align: 'right', width: CONTENT_W });
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
  y = drawMetricCards(p1, report, y, { bold, font });
  y = drawScoreExplainer(p1, report, y, { bold, font });
  // Anchored near the foot of the page rather than left floating under the
  // explainer: a signature block belongs at the bottom of the sheet. Falls back
  // to following the content if the explainer ever runs that far down.
  drawSignOff(p1, Math.min(y, MARGIN + 78), preparedBy, { bold, font });

  // Trends come before the die life detail: having seen the score, the next
  // question is which way it is moving.
  const charts = trendable(report);
  if (charts.length) {
    const p2 = doc.addPage([PAGE_W, PAGE_H]);
    text(p2, `MONTHLY TREND - JAN TO ${String((report.period || {}).month || '').toUpperCase()} ${(report.period || {}).year || ''}`,
      { x: MARGIN, y: PAGE_H - MARGIN - 20, size: 8.5, font: bold, color: MUTED });
    // The series is always monthly regardless of the report frequency, so a
    // quarterly or year-to-date report still shows month-by-month movement
    // rather than a single flat point.
    text(p2, 'Monthly figures across the year to date, whatever period this report covers. Dashed line is the target.',
      { x: MARGIN, y: PAGE_H - MARGIN - 32, size: 7.2, font, color: MUTED });

    // Two per row, three rows a page.
    const cw = (CONTENT_W - 24) / 2;
    const ch = 96;
    let cy = PAGE_H - MARGIN - 76;
    let page = p2;
    charts.forEach((c, i) => {
      const col = i % 2;
      if (col === 0 && i > 0) cy -= ch + 44;
      if (cy < MARGIN + 60) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        cy = PAGE_H - MARGIN - 64;
      }
      drawTrendChart(page, {
        x: MARGIN + col * (cw + 24), y: cy - ch, w: cw, h: ch,
        axis: c.axis, points: c.points, target: c.metric.scored ? c.metric.target : null,
        color: TREND_COLORS[c.metric.key] || '#1F6FB0',
        label: c.metric.label, unit: c.metric.unit || 'count',
        bars: !c.metric.scored,
      }, { bold, font });
    });
  }

  const matrixRows = report.dieLifeRows || [];
  if (matrixRows.length) {
    const pm = doc.addPage([PAGE_W, PAGE_H]);
    drawMatrix(pm, report, PAGE_H - MARGIN - 20, { bold, font });
  }

  drawComments(doc, report, comments, preparedBy, { bold, font });
  drawFooters(doc, report, { font, bold });
  return doc.save();
}

module.exports = { generateSupplierReportPdf, sanitize, trendable, MONTH_NAMES };
