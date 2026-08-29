'use strict';

// The daily summary, as a sheet somebody can print, read at a glance and sign.
//
// Layout constants below mirror supplierReportPdf.cjs so the two documents look
// like they came from the same company; they are layout, not contract.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
// How low ordinary content may run before breaking to a new page. Only the
// sign-off needs more than this, and it asks for its own room at the end --
// reserving the sign-off's height on *every* block was what pushed a report
// that comfortably fits one page onto a second, near-empty one.
const BOTTOM = MARGIN + 24;

// The sign-off is pinned this far above the bottom margin, and spans roughly
// 54pt upwards from there. SIGN_OFF_ROOM is what must be free below the last
// line of content for it to share the page.
const SIGN_OFF_Y = MARGIN + 40;
const SIGN_OFF_ROOM = 118;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const NAVY = rgb(0.122, 0.435, 0.690); // BRAND.navy #1F6FB0

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// StandardFonts are WinAnsi-encoded and throw on characters outside it. The
// stage labels carry an em dash, so without this the 06:00 run would crash
// rather than render. Replaced, not stripped, so the meaning survives.
function sanitize(str) {
  return String(str == null ? '' : str)
    .replace(/[·•]/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[—–‑]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    // Anything still outside WinAnsi becomes a space rather than an exception.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

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

function rule(page, y, { x = MARGIN, w = CONTENT_W, color = RULE } = {}) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color });
}

function longDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

// Blank name, signature and date lines. A daily report nobody signs is a memo;
// being signable is the point of generating a PDF rather than an email alone.
function drawSignOff(page, y, { bold, font }) {
  const colW = (CONTENT_W - 40) / 3;
  const cols = ['Prepared by', 'Reviewed by', 'Approved by'];

  text(page, 'SIGN-OFF', { x: MARGIN, y: y + 46, size: 8.5, font: bold, color: MUTED });

  cols.forEach((label, i) => {
    const x = MARGIN + i * (colW + 20);
    text(page, label, { x, y: y + 32, size: 7.4, font: bold, color: MUTED });
    rule(page, y + 20, { x, w: colW, color: rgb(0.65, 0.68, 0.72) });
    text(page, 'Name', { x, y: y + 11, size: 6.6, font, color: MUTED });
    rule(page, y, { x, w: colW, color: rgb(0.65, 0.68, 0.72) });
    text(page, 'Signature and date', { x, y: y - 9, size: 6.6, font, color: MUTED });
  });
}

async function generateDailySummaryPdf(report, opts = {}) {
  const { logoBytes = null, generatedAt = new Date(), timeZone = 'Asia/Dubai' } = opts;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A report without a logo is still a usable report -- and a corrupt file must
  // not take the morning's mail down with it.
  let logo = null;
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }

  const pages = [doc.addPage([PAGE_W, PAGE_H])];
  let page = pages[0];
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - MARGIN;
    return page;
  };
  const need = (space) => { if (y - space < BOTTOM) newPage(); };

  // ── Header ────────────────────────────────────────────────────────────────
  if (logo) {
    const scale = Math.min(34 / logo.height, 150 / logo.width);
    page.drawImage(logo, {
      x: MARGIN, y: y - logo.height * scale,
      width: logo.width * scale, height: logo.height * scale,
    });
    y -= logo.height * scale + 14;
  }
  text(page, 'DAILY DIE ORDER SUMMARY', { x: MARGIN, y, size: 15, font: bold, color: NAVY });
  y -= 17;
  text(page, longDate(report.reportDate), { x: MARGIN, y, size: 10.5, font: bold });
  y -= 13;
  text(page, `Generated ${generatedAt.toLocaleString('en-GB')} (${timeZone})`,
    { x: MARGIN, y, size: 7.6, font, color: MUTED });
  y -= 12;
  rule(page, y, { color: NAVY });
  y -= 22;

  // ── Activity ──────────────────────────────────────────────────────────────
  text(page, 'ACTIVITY RECORDED FOR THIS DAY', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 15;
  rule(page, y);
  y -= 15;

  for (const row of report.activity) {
    need(16);
    text(page, row.label, { x: MARGIN, y, size: 9.5, font });
    text(page, String(row.count), { x: MARGIN, y, size: 9.5, font: bold,
      align: 'right', width: CONTENT_W });
    y -= 13.5;
  }

  need(20);
  rule(page, y + 4);
  y -= 2;
  text(page, 'Total movements', { x: MARGIN, y, size: 9.5, font: bold });
  text(page, String(report.activityTotal), { x: MARGIN, y, size: 9.5, font: bold,
    align: 'right', width: CONTENT_W });
  y -= 20;

  // ── Recorded late ─────────────────────────────────────────────────────────
  if (report.lateTotal > 0) {
    need(46);
    text(page, 'RECORDED LATE', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
    y -= 12;
    text(page, 'Entered after the day they belong to, and not included in the counts above.',
      { x: MARGIN, y, size: 7.6, font, color: MUTED });
    y -= 12;
    rule(page, y);
    y -= 14;

    const cols = [
      { x: MARGIN, w: 110, align: 'left' },
      { x: MARGIN + 115, w: 110, align: 'left' },
      { x: MARGIN + 230, w: 160, align: 'left' },
      { x: MARGIN + 395, w: 104, align: 'right' },
    ];
    ['Die Number', 'Order Number', 'Stage', 'Dated'].forEach((h, i) =>
      text(page, h, { ...cols[i], y, size: 8, font: bold, color: MUTED, width: cols[i].w }));
    y -= 13;

    for (const row of report.late) {
      need(14);
      const cells = [row.dieNo || '-', row.orderNo || '-', row.stageLabel, row.stageDate];
      cells.forEach((c, i) => text(page, c, { ...cols[i], y, size: 8.6, font, width: cols[i].w }));
      y -= 13;
    }

    if (report.lateTotal > report.late.length) {
      need(14);
      text(page, `... and ${report.lateTotal - report.late.length} more not listed`,
        { x: MARGIN, y, size: 7.6, font, color: MUTED });
      y -= 13;
    }
    y -= 12;
  }

  // ── Pending ───────────────────────────────────────────────────────────────
  need(70);
  text(page, 'PENDING AT EACH STAGE', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 12;
  // Without this line the two blocks look like they contradict each other.
  text(page, 'Position as at the time of generation, not as at the report date above.',
    { x: MARGIN, y, size: 7.6, font, color: MUTED });
  y -= 12;
  rule(page, y);
  y -= 14;

  const pcols = [
    { x: MARGIN, w: 240, align: 'left' },
    { x: MARGIN + 250, w: 100, align: 'right' },
    { x: MARGIN + 360, w: 139, align: 'right' },
  ];
  ['Stage', 'Orders', 'Oldest waiting (days)'].forEach((h, i) =>
    text(page, h, { ...pcols[i], y, size: 8, font: bold, color: MUTED, width: pcols[i].w }));
  y -= 13;

  for (const row of report.pending) {
    need(15);
    // An age of null renders "-", never 0: no date is not the same as today.
    const cells = [row.label, String(row.count), row.oldestDays === null ? '-' : String(row.oldestDays)];
    cells.forEach((c, i) => text(page, c, {
      ...pcols[i], y, size: 9.2, font: i === 0 ? font : bold, width: pcols[i].w,
    }));
    y -= 13;
  }
  y -= 10;

  // ── Footnotes ─────────────────────────────────────────────────────────────
  if (report.unparseable.length) {
    need(30);
    rule(page, y + 6);
    for (const note of report.unparseable) {
      need(12);
      text(page, `${note.count} "${note.label}" value(s) could not be read as a date and are not counted.`,
        { x: MARGIN, y, size: 7.4, font, color: MUTED });
      y -= 11;
    }
  }

  // ── Sign-off, on the last page ────────────────────────────────────────────
  // On the last page, not page one: that placement is the standing complaint
  // against the supplier report and there is no reason to repeat it.
  if (y < MARGIN + SIGN_OFF_ROOM) newPage();
  drawSignOff(page, SIGN_OFF_Y, { bold, font });
  // pdf-lib offers no text extraction, so this is how the tests can assert the
  // block landed on the last page. Recorded, not returned, to keep the
  // function's contract a plain Uint8Array.
  generateDailySummaryPdf.lastSignOffPageIndex = pages.length - 1;

  return doc.save();
}

module.exports = { generateDailySummaryPdf, sanitize };
