'use strict';

// The published trial schedule for one plant and one day: the sheet that goes
// to the shop floor and to the plant's mailing list when a plan is published.
//
// Layout follows the "Published plan" mockup: a navy header with the day and
// the trial count, the trials by press, supervised runs in their own section
// (they are not trials and run in the day shift only), then a tile per press.
// Colours and type mirror dailySummaryPdf.cjs so the documents look related.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = MARGIN + 28;

const INK = rgb(0.035, 0.035, 0.043);
const MUTED = rgb(0.34, 0.34, 0.37);
const RULE = rgb(0.894, 0.894, 0.906);
const HEAD_BG = rgb(0.957, 0.957, 0.961);
const NAVY = rgb(0.122, 0.435, 0.690); // #1F6FB0
const WHITE = rgb(1, 1, 1);
const URGENT = rgb(0.725, 0.11, 0.11);
const URGENT_BG = rgb(0.996, 0.886, 0.886);
const AMBER_RULE = rgb(0.941, 0.765, 0.42);
const AMBER_BG = rgb(1, 0.984, 0.922);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// StandardFonts are WinAnsi only; a customer name with a stray character must
// not stop a plan from publishing.
function sanitize(str) {
  return String(str == null ? '' : str)
    .replace(/[·•]/g, '-')
    .replace(/[—–‑]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .trim();
}

// Cut to the column with an ellipsis rather than run into the next one.
function fit(str, font, size, width) {
  let s = sanitize(str);
  if (!s || font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

function longDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Columns as fractions of the content width, as in the mockup's grid.
const COLUMNS = [
  { key: 'press', label: 'Press', share: 0.8 },
  { key: 'die', label: 'Die', share: 1.6 },
  { key: 'customer', label: 'Customer', share: 1.5 },
  { key: 'alloy', label: 'Alloy', share: 0.6 },
  { key: 'tooling', label: 'Tooling', share: 1 },
  { key: 'corrector', label: 'Corrector', share: 0.9 },
];
const PAD_X = 10;
const GAP = 8;

function layoutColumns() {
  const total = COLUMNS.reduce((sum, c) => sum + c.share, 0);
  const usable = CONTENT_W - PAD_X * 2 - GAP * (COLUMNS.length - 1);
  let x = MARGIN + PAD_X;
  return COLUMNS.map((c) => {
    const w = (usable * c.share) / total;
    const col = { ...c, x, w };
    x += w + GAP;
    return col;
  });
}

// Press order as people read the sheet: by press name, then the order the dies
// were planned in.
function byPress(entries) {
  return [...entries].sort((a, b) =>
    String(a.press || '').localeCompare(String(b.press || ''), 'en', { numeric: true })
    || (a.position || 0) - (b.position || 0) || (a.id || 0) - (b.id || 0));
}

function pressTiles(entries) {
  const tiles = new Map();
  for (const e of entries) {
    const name = sanitize(e.press) || 'No press';
    if (!tiles.has(name)) tiles.set(name, { name, trials: 0, supervised: 0 });
    tiles.get(name)[e.entry_type === 'Supervised' ? 'supervised' : 'trials'] += 1;
  }
  return [...tiles.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

// view: what planView returns (date, plant, plan, entries).
// opts.publishedBy: the publisher's display name; opts.logoBytes: PNG.
async function generateTrialPlanPdf(view, opts = {}) {
  const { publishedBy = '', generatedAt = new Date(), logoBytes = null } = opts;
  const entries = byPress(view.entries || []);
  const trials = entries.filter((e) => e.entry_type !== 'Supervised');
  const supervised = entries.filter((e) => e.entry_type === 'Supervised');
  const plan = view.plan || {};

  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`Trial schedule ${view.plant} ${view.date}`));
  doc.setCreator('Die Tracker');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);

  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const cols = layoutColumns();
  let page;
  let y;
  const draw = (str, { x, size = 9.5, f = font, color = INK, width = 0, align = 'left' }) => {
    const s = width ? fit(str, f, size, width) : sanitize(str);
    if (!s) return;
    let px = x;
    if (align === 'right') px = x + width - f.widthOfTextAtSize(s, size);
    page.drawText(s, { x: px, y, size, font: f, color });
  };

  // ── Header band ──────────────────────────────────────────────────────────
  const header = () => {
    const bandH = 74;
    page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: NAVY });
    y = PAGE_H - 28;
    draw(`${view.plant} - Trial schedule`.toUpperCase(), { x: MARGIN, size: 9, f: bold, color: WHITE });
    y -= 26;
    draw(longDate(view.date), { x: MARGIN, size: 21, f: bold, color: WHITE });

    const count = String(trials.length);
    y = PAGE_H - 40;
    draw(count, { x: MARGIN, width: CONTENT_W, align: 'right', size: 22, f: mono, color: WHITE });
    y -= 16;
    draw(`${plural(trials.length, 'trial')} - ${plural(supervised.length, 'supervised run')}`,
      { x: MARGIN, width: CONTENT_W, align: 'right', size: 9, f: bold, color: WHITE });
    y = PAGE_H - bandH - 18;
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    header();
  };
  const need = (space) => { if (y - space < BOTTOM) newPage(); };

  newPage();

  // Who published it and which revision, so two printed copies can be told apart.
  const meta = [
    plan.revision ? `Revision ${plan.revision}` : 'Draft - not yet published',
    publishedBy ? `published by ${publishedBy}` : '',
    `printed ${generatedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`,
  ].filter(Boolean).join(' - ');
  draw(meta, { x: MARGIN, size: 8, color: MUTED });
  y -= 22;

  // ── A table of entries ───────────────────────────────────────────────────
  const ROW_H = 20;
  const tableHead = (fill) => {
    page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT_W, height: 18, color: fill });
    for (const c of cols) draw(c.label.toUpperCase(), { x: c.x, width: c.w, size: 7.4, f: bold, color: MUTED });
    y -= 18;
  };

  const row = (e, { lineColor }) => {
    const reason = sanitize(e.out_of_queue_reason);
    const height = reason ? ROW_H + 10 : ROW_H;
    need(height + 4);
    page.drawLine({ start: { x: MARGIN, y: y + 12 }, end: { x: MARGIN + CONTENT_W, y: y + 12 }, thickness: 0.6, color: lineColor });
    y -= 3;
    const die = cols[1];
    for (const c of cols) {
      if (c.key === 'die') continue;
      const value = c.key === 'press' ? e.press : e[c.key];
      draw(value || '-', {
        x: c.x, width: c.w, size: 9,
        f: c.key === 'press' ? bold : (c.key === 'alloy' || c.key === 'tooling' ? mono : font),
        color: value ? INK : MUTED,
      });
    }
    // The die number, with the urgent tag beside it as on the screen.
    const dieText = fit(e.die_no, mono, 9.5, die.w);
    draw(dieText, { x: die.x, size: 9.5, f: mono });
    if (e.urgent) {
      const tagX = die.x + mono.widthOfTextAtSize(dieText, 9.5) + 5;
      const tagW = bold.widthOfTextAtSize('URGENT', 6.4) + 8;
      if (tagX + tagW <= die.x + die.w + GAP) {
        page.drawRectangle({ x: tagX, y: y - 2.5, width: tagW, height: 10, color: URGENT_BG });
        page.drawText('URGENT', { x: tagX + 4, y: y + 0.4, size: 6.4, font: bold, color: URGENT });
      }
    }
    if (reason) {
      y -= 10;
      draw(`Why: ${reason}`, { x: die.x, width: CONTENT_W - (die.x - MARGIN) - PAD_X, size: 7.4, color: MUTED });
    }
    y -= ROW_H - 3;
  };

  const section = (title, note, list, { fill, lineColor, empty }) => {
    need(60);
    draw(title, { x: MARGIN, size: 11.5, f: bold });
    y -= 13;
    if (note) {
      draw(note, { x: MARGIN, size: 8.2, color: MUTED });
      y -= 13;
    }
    y -= 4;
    if (!list.length) {
      draw(empty, { x: MARGIN, size: 9, color: MUTED });
      y -= 22;
      return;
    }
    tableHead(fill);
    y -= 2;
    for (const e of list) row(e, { lineColor });
    page.drawLine({ start: { x: MARGIN, y: y + 12 }, end: { x: MARGIN + CONTENT_W, y: y + 12 }, thickness: 0.6, color: lineColor });
    y -= 18;
  };

  section('Trials', '', trials, { fill: HEAD_BG, lineColor: RULE, empty: 'No trials on this plan.' });
  if (supervised.length) {
    section('Supervised runs - day shift only',
      'Critical products. Run in the morning shift with a corrector at the press.',
      supervised, { fill: AMBER_BG, lineColor: AMBER_RULE, empty: '' });
  }

  // ── A tile per press ─────────────────────────────────────────────────────
  const tiles = pressTiles(entries);
  if (tiles.length) {
    const perRow = 4;
    const gap = 10;
    const tileW = (CONTENT_W - gap * (perRow - 1)) / perRow;
    const tileH = 52;
    for (let i = 0; i < tiles.length; i += perRow) {
      need(tileH + 8);
      const top = y + 10;
      tiles.slice(i, i + perRow).forEach((t, j) => {
        const x = MARGIN + j * (tileW + gap);
        page.drawRectangle({ x, y: top - tileH, width: tileW, height: tileH, borderColor: RULE, borderWidth: 0.8 });
        const save = y;
        y = top - 14;
        draw(t.name.toUpperCase(), { x: x + 10, width: tileW - 20, size: 7.4, f: bold, color: MUTED });
        y -= 18;
        draw(String(t.trials), { x: x + 10, size: 16, f: mono });
        y -= 12;
        const note = [plural(t.trials, 'trial'), t.supervised ? `${t.supervised} supervised` : ''].filter(Boolean).join(' - ');
        draw(note, { x: x + 10, width: tileW - 20, size: 7.6, color: MUTED });
        y = save;
      });
      y -= tileH + gap;
    }
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    y = MARGIN;
    if (logo && i === 0) {
      const scale = Math.min(24 / logo.height, 110 / logo.width);
      p.drawImage(logo, { x: MARGIN, y: MARGIN - 8, width: logo.width * scale, height: logo.height * scale });
    }
    const left = logo && i === 0 ? MARGIN + 120 : MARGIN;
    draw('Published from Die Tracker - results are recorded in Sample Followup after each trial',
      { x: left, size: 7.6, color: MUTED });
    draw(`Page ${i + 1} of ${pages.length}`, { x: MARGIN, width: CONTENT_W, align: 'right', size: 7.6, color: MUTED });
  });

  return doc.save();
}

module.exports = { generateTrialPlanPdf, sanitize, fit };
