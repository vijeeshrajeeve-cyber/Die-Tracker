'use strict';

// The Enhancement report for a chosen period, as a PDF: the summary figures, the
// monthly chart and the three project tables (completed, started, open).
//
// It is built from the same `summarise` output the Analytics tab shows, so the
// document cannot disagree with the screen. Layout follows supplierReportPdf.cjs
// (same fonts, ink and brand colours, and the same `sanitize` for text that
// users typed); the page is landscape because each project row carries nine
// numbers. A number that was never recorded prints "not recorded", never 0.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { sanitize } = require('./supplierReportPdf.cjs');
const { todayLocal } = require('./dates.cjs');

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const PANEL = rgb(0.97, 0.975, 0.98);
const NAVY = rgb(0.122, 0.435, 0.690); // BRAND.navy #1F6FB0

const STARTED = rgb(0.231, 0.510, 0.965); // #3B82F6
const ACHIEVED = rgb(0.086, 0.639, 0.290); // #16A34A
const PARTLY = rgb(0.851, 0.467, 0.024); // #D97706
const NOT_ACHIEVED = rgb(0.863, 0.149, 0.149); // #DC2626
const GOOD = rgb(0.086, 0.639, 0.290);
const BAD = rgb(0.863, 0.149, 0.149);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOT_RECORDED = 'not recorded';
const EMPTY_PERIOD = 'No enhancement projects in this period';

const NUMBERS = [
  { key: 'productivity', label: 'Productivity', unit: 'kg/h', higherIsBetter: true },
  { key: 'recovery', label: 'Recovery', unit: '%', higherIsBetter: true },
  { key: 'failure', label: 'Failure', unit: '%', higherIsBetter: false },
];

const GROUPS = [
  { id: 'completed', label: 'COMPLETED IN PERIOD' },
  { id: 'started', label: 'STARTED IN PERIOD' },
  { id: 'open', label: 'OPEN AT END OF PERIOD' },
];

const fmt = (v) => (v === null || v === undefined ? NOT_RECORDED : String(Number(Number(v).toFixed(1))));

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

// Greedy wrap against the measured width, at most `maxLines` lines; the last
// line is cut with "..." when the text runs on.
function wrap(str, font, size, maxW, maxLines) {
  const words = sanitize(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxW) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && font.widthOfTextAtSize(`${last}...`, size) > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}...`;
    return kept;
  }
  return lines;
}

const dayParts = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? { y, m: MONTH_NAMES[m - 1], d } : null;
};
const longDate = (iso) => { const p = dayParts(iso); return p ? `${p.d} ${p.m} ${p.y}` : ''; };

function periodCaption(from, to) {
  const a = dayParts(from);
  const b = dayParts(to);
  if (!a || !b) return '';
  const left = a.y === b.y ? `${a.d} ${a.m}` : `${a.d} ${a.m} ${a.y}`;
  return `${left} to ${b.d} ${b.m} ${b.y}`;
}

function monthLabel(key) {
  return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
}

function drawHeader(page, { from, to }, { bold, font, logo }) {
  let y = PAGE_H - MARGIN;
  if (logo) {
    const scale = Math.min(30 / logo.height, 150 / logo.width);
    page.drawImage(logo, { x: MARGIN, y: y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
  }
  text(page, 'ENHANCEMENT REPORT', { x: MARGIN, y: y - 12, size: 9, font: bold, color: MUTED, align: 'right', width: CONTENT_W });
  y -= 40;
  rule(page, y, { color: NAVY, thickness: 1.6 });
  y -= 24;
  text(page, 'Design enhancement projects', { x: MARGIN, y, size: 20, font: bold });
  text(page, `Generated ${todayLocal()}`, { x: MARGIN, y, size: 9, font, color: MUTED, align: 'right', width: CONTENT_W });
  text(page, periodCaption(from, to), { x: MARGIN, y: y - 16, size: 10, font, color: MUTED });
  return y - 36;
}

function card(page, { x, y, w, h, label, value, sub, valueColor = INK }, { bold, font }) {
  page.drawRectangle({ x, y, width: w, height: h, color: PANEL });
  text(page, label, { x: x + 10, y: y + h - 15, size: 7.6, font: bold, color: MUTED });
  text(page, value, { x: x + 10, y: y + h - 36, size: value.length > 12 ? 11 : 20, font: bold, color: valueColor });
  if (sub) wrap(sub, font, 7, w - 20, 2).forEach((l, i) => text(page, l, { x: x + 10, y: y + 14 - i * 9, size: 7, font, color: MUTED }));
}

function drawFigures(page, summary, y, { bold, font }) {
  const { totals, averages } = summary;
  const gap = 10;
  const h = 60;

  const top = [
    { label: 'PROJECTS STARTED', value: String(totals.started), sub: 'Marked as a design enhancement in the period' },
    { label: 'PROJECTS COMPLETED', value: String(totals.completed), sub: `${totals.achieved} achieved, ${totals.partly} partly, ${totals.notAchieved} not achieved` },
    { label: 'SUCCESS RATE', value: totals.successRate === null ? NOT_RECORDED : `${Math.round(totals.successRate * 100)}%`, sub: `${totals.achieved} of ${totals.completed} completed were Achieved` },
    { label: 'AWAITING LIFE REVIEW', value: String(totals.awaitingLifeReview), sub: 'At the end of the period' },
    { label: 'OPEN', value: String(totals.open), sub: 'No final verdict at the end of the period' },
  ];
  const w5 = (CONTENT_W - gap * 4) / 5;
  top.forEach((c, i) => card(page, { ...c, x: MARGIN + i * (w5 + gap), y: y - h, w: w5, h }, { bold, font }));
  y -= h + 16;

  text(page, 'AVERAGE CHANGE ON COMPLETED PROJECTS (ACTUAL AGAINST BASELINE)', { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  y -= 10;
  const w3 = (CONTENT_W - gap * 2) / 3;
  NUMBERS.forEach((n, i) => {
    const f = averages[n.key];
    let value = 'Not tracked yet';
    let sub = 'No completed project has both a baseline and an actual.';
    let color = MUTED;
    if (f.count > 0) {
      const sign = f.change > 0 ? '+' : '';
      value = `${sign}${fmt(f.change)} ${n.unit}`;
      if (f.change === 0) { color = MUTED; sub = 'no change - '; } else {
        const better = (f.change > 0) === n.higherIsBetter;
        color = better ? GOOD : BAD;
        sub = `${better ? 'better' : 'worse'} - `;
      }
      sub += `average ${fmt(f.baseline)} to ${fmt(f.actual)} ${n.unit}, ${f.count} ${f.count === 1 ? 'project' : 'projects'}`;
    }
    card(page, { x: MARGIN + i * (w3 + gap), y: y - h, w: w3, h, label: `${n.label.toUpperCase()} (${n.unit})`, value, sub, valueColor: color }, { bold, font });
  });
  return y - h - 18;
}

// Bars drawn from the PDF library's own primitives: per month, a blue bar for
// projects started beside a stacked bar for projects completed split by verdict.
function drawChart(page, months, y, { bold, font }) {
  text(page, 'PROJECTS BY MONTH', { x: MARGIN, y, size: 8, font: bold, color: MUTED });

  // Legend, right-aligned on the same line.
  const items = [['Started', STARTED], ['Achieved', ACHIEVED], ['Partly achieved', PARTLY], ['Not achieved', NOT_ACHIEVED]];
  let lx = MARGIN + CONTENT_W;
  [...items].reverse().forEach(([name, color]) => {
    const w = font.widthOfTextAtSize(name, 7.5);
    lx -= w;
    text(page, name, { x: lx, y, size: 7.5, font, color: MUTED });
    lx -= 11;
    page.drawRectangle({ x: lx, y: y - 0.5, width: 8, height: 8, color });
    lx -= 14;
  });

  const plotH = 110;
  const axisY = y - 14 - plotH; // baseline of the bars
  const plotX = MARGIN + 24;
  const plotW = CONTENT_W - 24;
  const peak = Math.max(1, ...months.map((m) => Math.max(m.started, m.achieved + m.partly + m.notAchieved)));
  const scale = (plotH - 12) / peak;

  // Whole-number gridlines, thinned so a tall chart does not draw a line per unit.
  const stepY = Math.ceil(peak / 5);
  for (let v = 0; v <= peak; v += stepY) {
    const gy = axisY + v * scale;
    rule(page, gy, { x: plotX, w: plotW, color: v === 0 ? MUTED : RULE, thickness: v === 0 ? 0.8 : 0.4 });
    text(page, String(v), { x: MARGIN, y: gy - 2.5, size: 6.5, font, color: MUTED, align: 'right', width: 18 });
  }

  const slot = plotW / months.length;
  const bw = Math.min(slot * 0.38, 16);
  const labelled = slot >= 14; // numbers only where they fit
  const labelStep = Math.ceil(26 / slot);
  months.forEach((m, i) => {
    const cx = plotX + slot * i + slot / 2;
    if (m.started > 0) {
      const h = m.started * scale;
      page.drawRectangle({ x: cx - bw - 1, y: axisY, width: bw, height: h, color: STARTED });
      if (labelled) text(page, String(m.started), { x: cx - bw - 1, y: axisY + h + 2, size: 7, font: bold, color: MUTED, align: 'center', width: bw });
    }
    let base = axisY;
    [[m.achieved, ACHIEVED], [m.partly, PARTLY], [m.notAchieved, NOT_ACHIEVED]].forEach(([n, color]) => {
      if (!n) return;
      const h = n * scale;
      page.drawRectangle({ x: cx + 1, y: base, width: bw, height: h, color });
      if (labelled && h >= 8) text(page, String(n), { x: cx + 1, y: base + h / 2 - 2.5, size: 7, font: bold, color: rgb(1, 1, 1), align: 'center', width: bw });
      base += h;
    });
    if (i % labelStep === 0) text(page, monthLabel(m.month), { x: cx - 15, y: axisY - 11, size: 6.5, font, color: MUTED, align: 'center', width: 30 });
  });
  return axisY - 30;
}

// Column layout for the project tables. Each number is three sub-columns
// (baseline, target, actual) so a blank can say "not recorded" in its own cell.
function tableColumns() {
  const cols = [];
  let x = MARGIN;
  const add = (key, w, align = 'left') => { cols.push({ key, x, w, align }); x += w; };
  add('die_no', 54); add('profile', 40); add('supplier', 62); add('issue', 96);
  NUMBERS.forEach((n) => { add(`${n.key}.baseline`, 38, 'right'); add(`${n.key}.target`, 38, 'right'); add(`${n.key}.actual`, 38, 'right'); });
  x += 10; add('verdict', 66); add('state', MARGIN + CONTENT_W - x);
  return cols;
}
const COLS = tableColumns();
const colByKey = (key) => COLS.find((c) => c.key === key);

function drawTableHead(page, y, { bold }) {
  NUMBERS.forEach((n) => {
    const a = colByKey(`${n.key}.baseline`);
    const c = colByKey(`${n.key}.actual`);
    text(page, `${n.label} (${n.unit})`, { x: a.x, y: y + 11, size: 7, font: bold, color: MUTED, align: 'center', width: c.x + c.w - a.x });
  });
  const heads = {
    die_no: 'Die no', profile: 'Profile', supplier: 'Supplier', issue: 'Current issue', verdict: 'Verdict', state: 'State',
  };
  COLS.forEach((c) => {
    const label = heads[c.key] || ({ baseline: 'Base', target: 'Target', actual: 'Actual' })[c.key.split('.')[1]];
    text(page, label, { x: c.x, y, size: 7, font: bold, color: MUTED, align: c.align === 'right' ? 'right' : 'left', width: c.w - (c.align === 'right' ? 4 : 0) });
  });
  rule(page, y - 5);
}

function verdictText(p) {
  if (p.final_verdict) return p.final_verdict;
  return p.trial_verdict ? `${p.trial_verdict} (trial)` : '-';
}

// Draws one group's table starting at `y`; returns { page, y } because a long
// group continues on further pages.
function drawGroup(doc, page, group, projects, y, ctx) {
  const { font, bold } = ctx;
  const newPage = () => {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    return { page: p, y: PAGE_H - MARGIN - 14 };
  };
  if (y < MARGIN + 90) ({ page, y } = newPage());

  text(page, `${group.label} (${projects.length})`, { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= projects.length ? 30 : 16;
  if (!projects.length) {
    text(page, 'No projects in this group for the period.', { x: MARGIN, y: y + 2, size: 8.5, font, color: MUTED });
    return { page, y: y - 22 };
  }
  drawTableHead(page, y, ctx);
  y -= 15;

  for (const p of projects) {
    const issueLines = wrap(p.current_issue || '-', font, 7.5, colByKey('issue').w - 6, 3);
    const supplierLines = wrap(p.supplier || '-', font, 7.5, colByKey('supplier').w - 4, 2);
    const stateLines = wrap(p.state || '', font, 7.5, colByKey('state').w, 2);
    const verdictLines = p.final_verdict && p.final_verdict_date ? 2 : 1; // verdict, then its date
    const lines = Math.max(issueLines.length, supplierLines.length, stateLines.length, verdictLines);
    const rowH = lines * 9 + 7;

    if (y - rowH < MARGIN + 28) {
      ({ page, y } = newPage());
      text(page, `${group.label} (continued)`, { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
      y -= 30;
      drawTableHead(page, y, ctx);
      y -= 15;
    }

    const at = (key, str, opts = {}) => {
      const c = colByKey(key);
      text(page, str, { x: c.x, y, size: 7.5, font, align: c.align === 'right' ? 'right' : 'left', width: c.w - (c.align === 'right' ? 4 : 0), ...opts });
    };
    at('die_no', p.die_no || '-', { font: bold });
    at('profile', p.profile || '-');
    supplierLines.forEach((l, i) => text(page, l, { x: colByKey('supplier').x, y: y - i * 9, size: 7.5, font }));
    issueLines.forEach((l, i) => text(page, l, { x: colByKey('issue').x, y: y - i * 9, size: 7.5, font }));
    NUMBERS.forEach((n) => {
      ['baseline', 'target', 'actual'].forEach((part) => {
        const v = p[n.key][part];
        at(`${n.key}.${part}`, v === null ? NOT_RECORDED : fmt(v), v === null
          ? { size: 6, color: MUTED }
          : (part === 'actual' ? { font: bold } : {}));
      });
    });
    const verdict = verdictText(p);
    at('verdict', verdict);
    if (p.final_verdict && p.final_verdict_date) {
      text(page, longDate(p.final_verdict_date), { x: colByKey('verdict').x, y: y - 9, size: 6.5, font, color: MUTED });
    }
    stateLines.forEach((l, i) => text(page, l, { x: colByKey('state').x, y: y - i * 9, size: 7.5, font }));

    y -= rowH;
    rule(page, y + 5, { thickness: 0.4 });
  }
  return { page, y: y - 14 };
}

function drawFooters(doc, { from, to }, { font }) {
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    rule(page, MARGIN - 8);
    text(page, `Enhancement report - ${periodCaption(from, to)}`, { x: MARGIN, y: MARGIN - 20, size: 7, font, color: MUTED });
    text(page, `Page ${i + 1} of ${pages.length}`, { x: MARGIN, y: MARGIN - 20, size: 7, font, color: MUTED, align: 'right', width: CONTENT_W });
  });
}

// summary: the output of summarise(). logo: optional PNG bytes.
async function generateEnhancementReportPdf(summary, { from, to, logo = null } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx = { font, bold };

  // A report without a logo is still a usable report.
  let logoImage = null;
  if (logo) {
    try { logoImage = await doc.embedPng(logo); } catch { logoImage = null; }
  }

  const firstPage = doc.addPage([PAGE_W, PAGE_H]);
  let page = firstPage;
  let y = drawHeader(page, { from, to }, { bold, font, logo: logoImage });

  const empty = !summary.completed.length && !summary.started.length && !summary.open.length;
  if (empty) {
    text(page, EMPTY_PERIOD, { x: MARGIN, y: y - 10, size: 14, font: bold });
    text(page, 'Nothing was started, completed or left open between these dates. Cancelled orders are left out.',
      { x: MARGIN, y: y - 28, size: 9, font, color: MUTED });
  } else {
    y = drawFigures(page, summary, y, ctx);
    y = drawChart(page, summary.months, y, ctx);
    for (const group of GROUPS) {
      ({ page, y } = drawGroup(doc, page, group, summary[group.id], y, ctx));
    }
  }

  drawFooters(doc, { from, to }, ctx);
  return Buffer.from(await doc.save());
}

module.exports = { generateEnhancementReportPdf, EMPTY_PERIOD };
