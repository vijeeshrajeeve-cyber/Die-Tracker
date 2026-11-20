'use strict';

// The published trial schedule for one plant and one day: the document that is
// printed, circulated and worked from at the presses every day.
//
// It is laid out as a controlled shop-floor form rather than a screen print:
//   - a ruled title block on every page (logo, title, reference, revision,
//     issue time, page x of y), so any loose page identifies itself;
//   - a key-facts strip (plant, trial date, counts, who published);
//   - fully ruled tables, serial-numbered, with blank Result and Initials
//     columns for the press floor;
//   - supervised runs in their own section (not trials; day shift only);
//   - a press summary, notes, and a sign-off block.
// Landscape A4, Helvetica only (StandardFonts), black on white with one grey
// for headers so it photocopies cleanly.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const M = 28;
const CONTENT_W = PAGE_W - M * 2;
const FOOTER_H = 18;
const BOTTOM = M + FOOTER_H;

const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.36, 0.37, 0.40);
const LINE = rgb(0.45, 0.46, 0.49);
const HAIR = rgb(0.74, 0.75, 0.78);
const HEAD_FILL = rgb(0.90, 0.91, 0.92);
const BAND_FILL = rgb(0.96, 0.96, 0.97);
const SUP_FILL = rgb(0.99, 0.95, 0.85);
const URGENT = rgb(0.70, 0.07, 0.07);
const NAVY = rgb(0.09, 0.22, 0.40);
const PRESS_FILL = rgb(0.86, 0.90, 0.95);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// StandardFonts are WinAnsi only; a customer name with a stray character must
// not stop a plan from publishing.
function sanitize(str) {
  return String(str == null ? '' : str)
    .replace(/[·•]/g, '-')
    .replace(/[—–‑]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cut to the width with an ellipsis rather than run into the next cell.
function fit(str, font, size, width) {
  let s = sanitize(str);
  if (!s || font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

// Word-wrap into at most `max` lines; the last line is cut with an ellipsis.
function wrap(str, font, size, width, max = 2) {
  const words = sanitize(str).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
    if (line) lines.push(line);
    line = words[i];
    if (lines.length === max - 1) {
      lines.push(fit([line, ...words.slice(i + 1)].join(' '), font, size, width));
      return lines;
    }
  }
  if (line) lines.push(fit(line, font, size, width));
  return lines.slice(0, max);
}

const pad2 = (n) => String(n).padStart(2, '0');

const ordinal = (n) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

// "Carry over from 20th Nov because of Alloy shortage": the wording the plant
// asked for on a die that did not run on an earlier plan.
function carryNote(e) {
  if (!e.carried_from_date) return '';
  const [, m, d] = String(e.carried_from_date).slice(0, 10).split('-').map(Number);
  return `Carry over from ${ordinal(d)} ${MONTHS[m - 1].slice(0, 3)}${e.carry_reason ? ` because of ${e.carry_reason}` : ''}`;
}

const remarksOf = (e) => [carryNote(e), e.out_of_queue_reason].filter(Boolean).join('; ');

function longDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function stamp(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// The schedule's reference: plant and day, so the same plan always prints the
// same reference and a revision tells two printed copies apart.
const reference = (view) => `TS-${String(view.plant).replace(/[^A-Za-z0-9]/g, '')}-${String(view.date).replace(/-/g, '')}`;

// Press order as people read the sheet: by press name, then the planned order.
function byPress(entries) {
  return [...entries].sort((a, b) =>
    String(a.press || '').localeCompare(String(b.press || ''), 'en', { numeric: true })
    || (a.position || 0) - (b.position || 0) || (a.id || 0) - (b.id || 0));
}

function pressSummary(entries) {
  const rows = new Map();
  for (const e of entries) {
    const name = sanitize(e.press) || 'No press';
    if (!rows.has(name)) rows.set(name, { name, trials: 0, supervised: 0, urgent: 0 });
    const r = rows.get(name);
    if (e.entry_type === 'Supervised') r.supervised += 1; else r.trials += 1;
    if (e.urgent) r.urgent += 1;
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

// The trial and supervised tables share one column set. Widths are shares of
// the content width. There is no Press column: each press has its own band
// in the table, so a press crew reads only its own block.
const COLUMNS = [
  { key: 'sn', label: 'S/N', share: 26, align: 'center' },
  { key: 'die', label: 'Die No.', share: 76 },
  { key: 'customer', label: 'Customer', share: 172, wrap: true },
  { key: 'alloy', label: 'Alloy', share: 40, align: 'center' },
  { key: 'tooling', label: 'Tooling', share: 96, wrap: true },
  { key: 'corrector', label: 'Corrector', share: 74 },
  { key: 'priority', label: 'Priority', share: 52, align: 'center' },
  { key: 'remarks', label: 'Remarks', share: 136, wrap: true },
  { key: 'result', label: 'Result', share: 58, align: 'center' },
  { key: 'initials', label: 'Initials', share: 56, align: 'center' },
];

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

// Where the artwork sits inside server/assets/company-logo.png, as fractions of
// the image (measured from the top-left). The file has wide blank margins, so
// sizing by the whole image would print the logo at about half the size the
// cell allows. Re-measure if the logo file is replaced.
const LOGO_INK = { left: 0.085, right: 0.877, top: 0.205, bottom: 0.826 };

const CELL_PAD = 4;
const BODY = 8.4;
const LINE_H = 10;

// view: what planView returns (date, plant, plan, entries).
// opts.publishedBy: the publisher's display name; opts.logoBytes: PNG.
async function generateTrialPlanPdf(view, opts = {}) {
  const { publishedBy = '', generatedAt = new Date(), logoBytes = null, issuedAt = null } = opts;
  const entries = byPress(view.entries || []);
  const trials = entries.filter((e) => e.entry_type !== 'Supervised');
  const supervised = entries.filter((e) => e.entry_type === 'Supervised');
  const plan = view.plan || {};
  const published = plan.status === 'published' && plan.revision > 0;
  const revision = published ? pad2(plan.revision) : 'Draft';
  const ref = reference(view);

  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`Daily Die Trial Schedule - ${view.plant} - ${view.date}`));
  doc.setSubject(`Trial schedule ${ref} revision ${revision}`);
  doc.setCreator('Die Tracker');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const cols = layoutColumns();
  const pages = [];
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
  const box = (x, top, w, h, { fill, border = LINE, thickness = 0.6 } = {}) => {
    page.drawRectangle({ x, y: top - h, width: w, height: h, color: fill, borderColor: border, borderWidth: thickness });
  };
  const hline = (x1, x2, ly, { color = LINE, thickness = 0.6 } = {}) =>
    page.drawLine({ start: { x: x1, y: ly }, end: { x: x2, y: ly }, thickness, color });
  const vline = (x, top, bottom, { color = LINE, thickness = 0.6 } = {}) =>
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness, color });

  // ── Title block, on every page ─────────────────────────────────────────────
  const TITLE_H = 68;
  const LOGO_W = 176;
  const META_W = 230;
  const pageNumberSlots = [];

  const titleBlock = () => {
    const top = PAGE_H - M;

    // Drawn first, so the rules go over it: the logo file carries wide blank
    // margins, and they are allowed to run under the cell borders.
    if (logo) {
      const ink = LOGO_INK;
      const inkW = ink.right - ink.left;
      const inkH = ink.bottom - ink.top;
      const scale = Math.min((TITLE_H - 12) / (logo.height * inkH), (LOGO_W - 18) / (logo.width * inkW));
      const w = logo.width * scale;
      const h = logo.height * scale;
      const cx = M + LOGO_W / 2;
      const cy = top - TITLE_H / 2;
      page.drawImage(logo, {
        x: cx - w * (ink.left + inkW / 2),
        y: cy - h * (1 - (ink.top + inkH / 2)),
        width: w, height: h,
      });
    }

    box(M, top, CONTENT_W, TITLE_H, { thickness: 0.9 });
    vline(M + LOGO_W, top, top - TITLE_H);
    vline(M + CONTENT_W - META_W, top, top - TITLE_H);
    if (!logo) text('Die Tracker', M + 10, top - TITLE_H / 2 - 4, { size: 11, f: bold, color: NAVY });

    const midX = M + LOGO_W;
    const midW = CONTENT_W - LOGO_W - META_W;
    text('DAILY DIE TRIAL SCHEDULE', midX, top - 30, { size: 17, f: bold, color: NAVY, width: midW, align: 'center' });
    text(`${view.plant}  |  Trial date: ${longDate(view.date)}`, midX, top - 49,
      { size: 10, f: bold, width: midW, align: 'center' });

    // Reference, revision, issued, page: a ruled label/value grid.
    const gx = M + CONTENT_W - META_W;
    const rowH = TITLE_H / 4;
    const labelW = 62;
    const rows = [
      ['Reference', ref],
      ['Revision', revision],
      ['Issued', published ? stamp(issuedAt || plan.published_at) || stamp(generatedAt) : 'Not published'],
      ['Page', ''],
    ];
    rows.forEach(([label, value], i) => {
      const rowTop = top - i * rowH;
      if (i) hline(gx, M + CONTENT_W, rowTop, { color: HAIR });
      page.drawRectangle({ x: gx, y: rowTop - rowH, width: labelW, height: rowH, color: BAND_FILL });
      text(label, gx + 6, rowTop - rowH + 4.6, { size: 7.4, f: bold, color: MUTED });
      text(value, gx + labelW + 6, rowTop - rowH + 4.4, { size: 8.4, f: label === 'Revision' ? bold : font, width: META_W - labelW - 12 });
      if (label === 'Page') pageNumberSlots.push({ page, x: gx + labelW + 6, y: rowTop - rowH + 4.4 });
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

  // ── Key facts strip ────────────────────────────────────────────────────────
  const urgentCount = entries.filter((e) => e.urgent).length;
  const facts = [
    ['Plant', view.plant],
    ['Trial date', longDate(view.date)],
    ['Die trials', String(trials.length)],
    ['Supervised runs', String(supervised.length)],
    ['Urgent', String(urgentCount)],
    ['Presses', String(pressSummary(entries).length)],
    ['Published by', publishedBy || '-'],
  ];
  const factShares = [1, 1.9, 0.8, 1, 0.7, 0.7, 1.6];
  const shareSum = factShares.reduce((a, b) => a + b, 0);
  const FACT_H = 32;
  box(M, y, CONTENT_W, FACT_H);
  let fx = M;
  facts.forEach(([label, value], i) => {
    const w = (CONTENT_W * factShares[i]) / shareSum;
    if (i) vline(fx, y, y - FACT_H, { color: HAIR });
    text(label.toUpperCase(), fx + 7, y - 11, { size: 6.8, f: bold, color: MUTED, width: w - 14 });
    text(value, fx + 7, y - 25, { size: 10, f: bold, color: label === 'Urgent' && urgentCount ? URGENT : INK, width: w - 14 });
    fx += w;
  });
  y -= FACT_H + 12;

  // ── Ruled tables ───────────────────────────────────────────────────────────
  const HEAD_H = 17;
  const cellLines = (e, col) => {
    const value = {
      press: e.press, die: e.die_no, customer: e.customer, alloy: e.alloy, tooling: e.tooling,
      corrector: e.corrector, remarks: remarksOf(e),
    }[col.key];
    if (col.wrap) return wrap(value, font, BODY, col.w - CELL_PAD * 2, col.key === 'remarks' ? 3 : 2);
    return value ? [fit(value, col.key === 'die' ? bold : font, BODY, col.w - CELL_PAD * 2)] : [];
  };
  const rowHeight = (e) => {
    const lines = Math.max(1, ...cols.filter((c) => c.wrap).map((c) => cellLines(e, c).length));
    return Math.max(18, lines * LINE_H + 8);
  };

  const tableHead = (fill) => {
    box(M, y, CONTENT_W, HEAD_H, { fill, thickness: 0.8 });
    for (const c of cols) {
      if (c.x > M) vline(c.x, y, y - HEAD_H);
      text(c.label.toUpperCase(), c.x + CELL_PAD, y - 11.4, { size: 7, f: bold, width: c.w - CELL_PAD * 2, align: c.align || 'left' });
    }
    y -= HEAD_H;
  };

  const sectionTitle = (title, note) => {
    text(title, M, y - 10, { size: 10.5, f: bold, color: NAVY });
    if (note) text(note, M, y - 10, { size: 7.8, color: MUTED, width: CONTENT_W, align: 'right' });
    y -= 16;
  };

  // One press's band: the press name in bold, then its counts.
  const BAND_H = 17;
  const pressBand = (group, { continued = false } = {}) => {
    box(M, y, CONTENT_W, BAND_H, { fill: PRESS_FILL, thickness: 0.8 });
    const name = sanitize(group.press);
    text(name, M + CELL_PAD + 2, y - 12, { size: 9.6, f: bold, color: NAVY });
    const urgent = group.rows.filter((e) => e.urgent).length;
    const facts = [
      `${group.rows.length} ${group.rows.length === 1 ? 'die' : 'dies'}`,
      urgent ? `${urgent} urgent` : '',
      continued ? 'continued' : '',
    ].filter(Boolean).join('   |   ');
    text(facts, M + CELL_PAD + 12 + bold.widthOfTextAtSize(name, 9.6), y - 11.8, { size: 8, color: MUTED });
    y -= BAND_H;
  };

  const groupsOf = (list) => {
    const groups = [];
    for (const e of list) {
      const press = sanitize(e.press) || 'No press';
      if (!groups.length || groups.at(-1).press !== press) groups.push({ press, rows: [] });
      groups.at(-1).rows.push(e);
    }
    return groups;
  };

  const entryRow = (e, sn) => {
    const h = rowHeight(e);
    box(M, y, CONTENT_W, h);
    for (const c of cols) {
      if (c.x > M) vline(c.x, y, y - h);
      const firstLine = y - 11.9;
      if (c.key === 'sn') {
        text(String(sn), c.x, firstLine, { width: c.w, align: 'center' });
      } else if (c.key === 'priority') {
        if (e.urgent) text('URGENT', c.x, firstLine, { size: 7.6, f: bold, color: URGENT, width: c.w, align: 'center' });
        else text('Normal', c.x, firstLine, { size: 7.6, color: MUTED, width: c.w, align: 'center' });
      } else if (c.key !== 'result' && c.key !== 'initials') {
        const lines = cellLines(e, c);
        if (!lines.length && c.key !== 'remarks') {
          text('-', c.x + CELL_PAD, firstLine, { color: MUTED, width: c.w - CELL_PAD * 2, align: c.align || 'left' });
        }
        lines.forEach((line, li) => text(line, c.x + CELL_PAD, firstLine - li * LINE_H, {
          f: c.key === 'die' ? bold : font,
          width: c.w - CELL_PAD * 2, align: c.align || 'left',
        }));
      }
    }
    y -= h;
  };

  const table = (title, note, list, { fill, emptyText }) => {
    if (y - (16 + HEAD_H + BAND_H + 22) < BOTTOM) newPage();
    sectionTitle(title, note);
    tableHead(fill);
    if (!list.length) {
      box(M, y, CONTENT_W, 22);
      text(emptyText, M + CELL_PAD + 2, y - 14, { size: BODY, color: MUTED });
      y -= 22 + 12;
      return;
    }
    let sn = 0;
    for (const group of groupsOf(list)) {
      // A press band never sits alone at the foot of a page.
      if (y - (BAND_H + rowHeight(group.rows[0])) < BOTTOM) {
        newPage();
        sectionTitle(`${title} (continued)`, '');
        tableHead(fill);
      }
      pressBand(group);
      for (const e of group.rows) {
        if (y - rowHeight(e) < BOTTOM) {
          newPage();
          sectionTitle(`${title} (continued)`, '');
          tableHead(fill);
          pressBand(group, { continued: true });
        }
        sn += 1;
        entryRow(e, sn);
      }
    }
    y -= 12;
  };

  table('1.  DIE TRIALS', `${trials.length} planned, by press`, trials,
    { fill: HEAD_FILL, emptyText: 'No die trials are planned for this day.' });
  table('2.  SUPERVISED RUNS  -  DAY SHIFT ONLY',
    'Critical products: run in the morning shift with a corrector at the press. Not counted as trials.',
    supervised, { fill: SUP_FILL, emptyText: 'No supervised runs are planned for this day.' });

  // ── Notes and approval, side by side ──────────────────────────────────────
  // The press bands already carry each press's counts, so there is no separate
  // press summary; keeping this block short lets a normal day fit one page.
  const NOTES_LINES = [
    'Record every result (OK, Not OK or Not run) in Die Tracker > Sample Followup > Trial Plan on the day.',
    'Not OK: note the reason (shape, dimension, aesthetic, die choked, manufacturing or other).',
    'A re-published schedule replaces earlier copies. Check the revision before use.',
  ];
  const NOTE_LINE = 12;
  const SIGN_H = 44;
  const notesH = Math.max(SIGN_H, NOTE_LINE * NOTES_LINES.length + 9);
  if (y - (16 + notesH) < BOTTOM) newPage();

  const GAP = 18;
  const notesW = (CONTENT_W - GAP) * 0.48;
  const rx = M + notesW + GAP;
  const rw = CONTENT_W - notesW - GAP;

  text('3.  NOTES', M, y - 10, { size: 10.5, f: bold, color: NAVY });
  text('4.  APPROVAL', rx, y - 10, { size: 10.5, f: bold, color: NAVY });
  y -= 16;

  box(M, y, notesW, notesH);
  NOTES_LINES.forEach((line, i) => {
    text(`${i + 1}.  ${line}`, M + 8, y - 12 - i * NOTE_LINE, { size: 7.6, width: notesW - 16 });
  });

  const signCols = [
    ['Prepared by (Die Shop)', publishedBy],
    ['Checked by', ''],
    ['Received by (Production)', ''],
  ];
  const signW = rw / signCols.length;
  box(rx, y, rw, notesH);
  signCols.forEach(([label, name], i) => {
    const x = rx + i * signW;
    if (i) vline(x, y, y - notesH);
    page.drawRectangle({ x: x + 0.3, y: y - 14, width: signW - 0.6, height: 13.7, color: BAND_FILL });
    text(label.toUpperCase(), x + 6, y - 9.8, { size: 6.6, f: bold, color: MUTED, width: signW - 12 });
    hline(x, x + signW, y - 14, { color: HAIR });
    [['Name', name], ['Sign', ''], ['Date', '']].forEach(([fl, fv], j) => {
      const fy = y - 23 - j * 9.6;
      text(`${fl}:`, x + 6, fy, { size: 7.2, color: MUTED });
      hline(x + 32, x + signW - 8, fy - 2, { color: HAIR, thickness: 0.5 });
      if (fv) text(fv, x + 34, fy, { size: 8, f: bold, width: signW - 44 });
    });
  });
  y -= notesH;

  // ── Footer and page numbers ────────────────────────────────────────────────
  const total = pages.length;
  pages.forEach((p, i) => {
    page = p;
    hline(M, M + CONTENT_W, M + 14, { color: HAIR });
    text(`${ref}  |  Revision ${revision}  |  Generated by Die Tracker on ${stamp(generatedAt)}`, M, M + 4, { size: 7, color: MUTED });
    text('Printed copies are valid only for the trial date and revision shown.', M, M + 4,
      { size: 7, color: MUTED, width: CONTENT_W - 70, align: 'right' });
    text(`Page ${i + 1} of ${total}`, M, M + 4, { size: 7, f: bold, color: MUTED, width: CONTENT_W, align: 'right' });
  });
  for (const slot of pageNumberSlots) {
    page = slot.page;
    text(`${pages.indexOf(slot.page) + 1} of ${total}`, slot.x, slot.y, { size: 8.4 });
  }

  return doc.save();
}

module.exports = { generateTrialPlanPdf, sanitize, fit, wrap, reference, carryNote, longDate, stamp };
