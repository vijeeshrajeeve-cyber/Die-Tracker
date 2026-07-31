'use strict';
// Renders a Quality Discrepancy (QD) form to PDF.
//
// The output must be a faithful reproduction of the controlled paper form
// "Quality Discrepancy New Format-2026-Final" (server/assets/qd-form-template.pdf)
// because the QD is a certification record: auditors expect the same page size,
// the same grid, the same wording and the same cell order every time. Every
// coordinate below was measured off that template's content stream, so the rules
// land exactly where the template's rules are (US Letter, 612x792 pt).
//
// Consequences of that contract, and how they are handled:
//   * the form is always exactly two pages -- nothing may reflow it;
//   * text too long for its box is fitted, then clipped and reprinted in full on
//     an "Annexure" continuation page, so no data is ever silently lost;
//   * images beyond the template's Profile Image / Approved design cells go into
//     the template's blank working areas, then onto annexure pages.
//
// The GULF EXTRUSION logo is not redrawable (Word emitted it as several hundred
// tiny image masks), so it is embedded as a clipped region of the template PDF
// itself. Without that asset the header cell is simply left blank.
const zlib = require('node:zlib');
const { PDFDocument, StandardFonts, rgb, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } = require('pdf-lib');

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0, 0.691, 0.313);          // Part-A / Production Parameters bands
const GREY_MID = rgb(0.652, 0.652, 0.652);   // image band, acceptance label
const GREY_LIGHT = rgb(0.852, 0.852, 0.852); // Name/Signature band

const PAGE_W = 612;
const PAGE_H = 792;
const RULE = 0.96;  // interior rule thickness
const EDGE = 1.92;  // outer border and section rules
const LEADING = 1.2;
const MIN_SIZE = 5; // never shrink below this; clip to the annexure instead
const PAD = 2;      // horizontal breathing room inside a cell

// Vertical rules shared by the Part-A and Production Parameters tables. COL[0]
// and COL[11] are the form's left and right edges.
const COL = [31.56, 73.32, 120.36, 183, 239.4, 276.96, 331.44, 382.2, 425.4, 475.56, 514.44, 579.72];
const LEFT = COL[0];
const RIGHT = COL[11];
const OUTER_L = 29.64;
const OUTER_R = 579.72;
const BAND_L = 31.08;   // shaded bands start half a rule left of the grid
const BAND_W = 549.72;

// y of every horizontal rule, top to bottom.
const P1 = {
  top: 739.68, header: 676.68, title: 649.68, partA: 631.32, aHead: 573.12,
  aVals: 542.16, band: 515.16, pHead: 479.4, first: 448.44, last: 409.44,
  issue: 307.92, spare: 289.8, defect: 263.4, bottom: 44.16,
};
const P2 = {
  top: 775.8, free: 556.56, imgBand: 523.32, imgCells: 367.56, action: 302.52,
  partB: 275.28, accept: 248.04, taken: 179.28, comments: 155.88, note: 132.48,
  signHead: 102.24, prepared: 78.84, authorized: 55.44, received: 32.04, bottom: 8.16,
};

// The header region of template page 1 that holds the logo artwork.
const LOGO_BOX = { left: LEFT + RULE, bottom: P1.header + EDGE, right: 250, top: P1.top };

const t = (v) => (v == null ? '' : String(v));

// pdf-lib's StandardFonts (Helvetica/HelveticaBold) use WinAnsi encoding, which
// only covers Latin-1 (char codes 0-255). Real QD data frequently contains
// typographic punctuation (em/en dashes, curly quotes, bullets) produced by
// word processors or copy-paste, which sits outside that range and would throw
// "WinAnsi cannot encode ..." inside drawText/widthOfTextAtSize. Every string
// that reaches the font must be passed through here first.
function sanitize(str) {
  const s = t(str);
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code > 255) {
      switch (ch) {
        case '—': // —
        case '–': // –
          out += '-';
          break;
        case '‘': // '
        case '’': // '
          out += "'";
          break;
        case '“': // "
        case '”': // "
          out += '"';
          break;
        case '•': // •
          out += '-';
          break;
        default:
          out += '?';
      }
    } else {
      out += ch;
    }
  }
  return out;
}

// text layout ------------------------------------------------------------

// Greedy word wrap. Words longer than the column (part numbers, pasted paths)
// are hard-broken rather than allowed to run past the rule.
function wrapText(str, f, size, maxW) {
  const width = Math.max(4, maxW);
  const lines = [];
  for (const para of sanitize(str).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const test = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) <= width) { line = test; continue; }
      if (line) { lines.push(line); line = ''; }
      let chunk = '';
      for (const ch of word) {
        if (chunk && f.widthOfTextAtSize(chunk + ch, size) > width) { lines.push(chunk); chunk = ''; }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

// How far a value may be shrunk purely to keep it on one line. Beyond this it
// reads worse than wrapping does.
const SINGLE_LINE_FLOOR = 0.65;

// Shrinks `str` (down to `min`) until its wrapped form fits maxW x maxH, and
// reports whether anything had to be clipped so the caller can spill it to the
// annexure rather than lose it. With `single`, a modest shrink is tried first so
// that indivisible values -- die numbers, tooling codes, dates -- stay whole
// instead of being broken across lines.
function fitText(str, f, size, maxW, maxH, min = MIN_SIZE, single = false) {
  if (single && !/\r?\n/.test(t(str))) {
    const one = sanitize(str).replace(/\s+/g, ' ').trim();
    const floor = Math.max(min, size * SINGLE_LINE_FLOOR);
    for (let s = size; s >= floor; s -= 0.25) {
      if (f.widthOfTextAtSize(one, s) <= maxW && s * LEADING <= maxH) return { size: s, lines: [one], clipped: false };
    }
  }
  let s = size;
  for (;;) {
    const lines = wrapText(str, f, s, maxW);
    const rows = Math.max(1, Math.floor(maxH / (s * LEADING)));
    if (lines.length <= rows) return { size: s, lines, clipped: false };
    if (s <= min) return { size: s, lines: lines.slice(0, rows), clipped: true };
    s = Math.max(min, s - 0.5);
  }
}

function drawLines(page, lines, { x0, x1, top, size, f, align = 'center', color = BLACK }) {
  lines.forEach((line, i) => {
    if (!line) return;
    const w = f.widthOfTextAtSize(line, size);
    const x = align === 'center' ? x0 + (x1 - x0 - w) / 2 : x0;
    page.drawText(line, { x, y: top - size * 0.95 - i * size * LEADING, size, font: f, color });
  });
}

// A value written into a grid cell: wrapped, shrunk to fit, vertically centred
// the way a filled-in paper form reads. Returns the full text when it had to be
// clipped ('' when everything landed).
function drawCell(page, str, cell, opts = {}) {
  const body = t(str).trim();
  if (!body) return '';
  const { size = 9, f, align = 'center', color = BLACK, min = MIN_SIZE, single = true } = opts;
  const maxW = cell.x1 - cell.x0 - PAD * 2;
  const maxH = cell.yT - cell.yB - 2;
  const fitted = fitText(body, f, size, maxW, maxH, min, single);
  const top = cell.yT - (maxH - fitted.lines.length * fitted.size * LEADING) / 2 - 1;
  drawLines(page, fitted.lines, { x0: cell.x0 + PAD, x1: cell.x1 - PAD, top, size: fitted.size, f, align, color });
  return fitted.clipped ? body : '';
}

const MORE_NOTE = '... continued on annexure';
const MORE_SIZE = 7;

// Trims the last kept line so an ellipsis fits on the end of it.
function withEllipsis(lines, f, size, maxW) {
  const out = [...lines];
  let last = `${out[out.length - 1] || ''} ...`;
  while (last.length > 4 && f.widthOfTextAtSize(last, size) > maxW) {
    last = `${last.slice(0, -5).trimEnd()} ...`;
  }
  out[out.length - 1] = last;
  return out;
}

// Free-flowing paragraph text inside one of the form's tall boxes: top-aligned,
// left-aligned, and held at a readable size rather than shrunk to nothing. When
// it does not all fit, the box keeps as much as it can and says so, because a
// silently truncated box would read as the whole answer.
function drawFlow(page, str, cell, opts = {}) {
  const body = t(str).trim();
  if (!body) return '';
  const { size = 10, f, min = size - 1.5 } = opts;
  const maxW = cell.x1 - cell.x0;
  const maxH = cell.yT - cell.yB;
  let fitted = fitText(body, f, size, maxW, maxH, min);
  const marked = fitted.clipped && maxH >= 24;
  if (marked) fitted = fitText(body, f, size, maxW, maxH - MORE_SIZE * LEADING, min);
  // A box too shallow for the notice (the one-line comments row) gets an
  // ellipsis instead, so it never reads as a complete answer either.
  if (fitted.clipped && !marked) fitted.lines = withEllipsis(fitted.lines, f, fitted.size, maxW);
  drawLines(page, fitted.lines, { x0: cell.x0, x1: cell.x1, top: cell.yT, size: fitted.size, f, align: 'left' });
  if (marked) {
    page.drawText(MORE_NOTE, {
      x: cell.x1 - f.widthOfTextAtSize(MORE_NOTE, MORE_SIZE), y: cell.yB + 1,
      size: MORE_SIZE, font: f, color: BLACK,
    });
  }
  return fitted.clipped ? body : '';
}

// A printed label at its exact template baseline, centred on [x0,x1] (or left
// aligned from x0), shrinking only where Helvetica renders the template's
// Calibri wording wider than its cell.
function drawLabel(page, str, { x0, x1, y, size, f, left = false, color = BLACK }) {
  const s = sanitize(str);
  if (!s) return;
  const maxW = x1 - x0 - PAD * 2;
  let sz = size;
  while (sz > MIN_SIZE && f.widthOfTextAtSize(s, sz) > maxW) sz -= 0.25;
  const w = f.widthOfTextAtSize(s, sz);
  page.drawText(s, { x: left ? x0 : x0 + (x1 - x0 - w) / 2, y, size: sz, font: f, color });
}

// A multi-line column heading whose last line sits on `lastBaseline` -- the
// template bottom-aligns the Part-A headings so they all share a baseline.
function drawStackUp(page, lines, { x0, x1, lastBaseline, size, f, color = BLACK }) {
  const leading = size * 1.29; // the template's own spacing for these headings
  lines.forEach((line, i) => {
    drawLabel(page, line, { x0, x1, y: lastBaseline + (lines.length - 1 - i) * leading, size, f, color });
  });
}

// A multi-line heading centred on `midBaseline` (Production Parameters heads).
function drawStackMid(page, lines, { x0, x1, midBaseline, size, f, color = BLACK }) {
  const leading = size * 1.32;
  const first = midBaseline + ((lines.length - 1) / 2) * leading;
  lines.forEach((line, i) => {
    drawLabel(page, line, { x0, x1, y: first - i * leading, size, f, color });
  });
}

// grid -------------------------------------------------------------------
const hrule = (page, y, x0 = LEFT, x1 = RIGHT, thick = RULE) =>
  page.drawRectangle({ x: x0, y, width: x1 - x0, height: thick, color: BLACK });
const vrule = (page, x, yB, yT, thick = RULE) =>
  page.drawRectangle({ x, y: yB, width: thick, height: yT - yB, color: BLACK });
const shade = (page, x, y, w, h, color) =>
  page.drawRectangle({ x, y, width: w, height: h, color });

// static content ---------------------------------------------------------
const PART_A_HEADS = [
  ['Profile', 'No'], ['Die no'], ['Die', 'Received', 'date'], ['Supplier', 'Name'],
  ['Press'], ['Die Type'], ['Die size'], ['No of', 'Cavity'], ['Tooling'],
  ['No of', 'trials'], ['No of', 'correction', 'done'],
];
const PROD_HEADS = [
  ['Date'], [''], ['Die Soaking', 'Hours'], ['Die', 'Temperature'], ['Billet', 'temp'],
  ['Break', 'through', 'Pressure'], ['Running', 'Pressure'], ['Billet', 'length'],
  ['Alloy'], ['Ram', 'Speed'], ['Any Delay', 'observed'],
];
// Columns 4..9 of the Production Parameters table, split per billet row.
const BILLET_COLS = ['billet_temp', 'breakthrough_pressure', 'running_pressure', 'billet_length', 'alloy', 'ram_speed'];
const CLOSING_NOTE = 'Note- Quality Discrepancy should be closed within 10 Working Days';

// main -------------------------------------------------------------------
async function generateQdPdf(qd, opts = {}) {
  const {
    files = [], billets = [], logoBytes = null, templateBytes = null,
    fileBytes = new Map(), signatures = {},
  } = opts;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { font, bold };

  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  const p2 = doc.addPage([PAGE_W, PAGE_H]);

  // Anything a fixed box could not hold, reprinted on the annexure.
  const overflow = [];
  const spill = (title, body) => { if (t(body).trim()) overflow.push({ title, body }); };

  await drawLogo(doc, p1, { logoBytes, templateBytes });
  drawPageOne(p1, qd, billets, fonts, spill);
  drawPageTwo(p2, qd, fonts, spill);

  await drawSignatures(doc, p2, qd, signatures);
  const leftover = await placeImages(doc, p1, p2, files, fileBytes, fonts);
  await drawAnnexure(doc, qd, overflow, leftover, fileBytes, fonts);

  return doc.save();
}

// The logo lives in the template as hundreds of image masks; the only faithful
// way to reproduce it is to embed that region of the template page as-is.
async function drawLogo(doc, page, { logoBytes, templateBytes }) {
  if (logoBytes) {
    try {
      const img = await doc.embedPng(logoBytes);
      const availW = LOGO_BOX.right - LOGO_BOX.left - 8;
      const availH = LOGO_BOX.top - LOGO_BOX.bottom - 8;
      const scale = Math.min(availW / img.width, availH / img.height);
      page.drawImage(img, {
        x: LOGO_BOX.left + 4, y: LOGO_BOX.bottom + (availH - img.height * scale) / 2 + 4,
        width: img.width * scale, height: img.height * scale,
      });
      return;
    } catch { /* fall through to the template clip */ }
  }
  if (!templateBytes) return;
  try {
    const src = await PDFDocument.load(templateBytes);
    const srcPage = src.getPages()[0];
    if (!stripTextOperators(src, srcPage)) return;
    const [logo] = await doc.embedPages([srcPage], [LOGO_BOX]);
    page.drawPage(logo, { x: LOGO_BOX.left, y: LOGO_BOX.bottom, width: logo.width, height: logo.height });
  } catch { /* the header cell simply stays blank */ }
}

// The letterhead is artwork, but it shares template page 1 with the form's
// printed labels -- labels this renderer draws itself. Embedding the region
// as-is would leave a hidden second copy of every label in the generated PDF's
// text layer, where extraction tools would find it, so the text operators are
// dropped from the in-memory copy of the template first. Returns false when the
// stream cannot be rewritten, in which case the caller skips the logo rather
// than ship that duplicate.
function stripTextOperators(src, page) {
  const contents = page.node.Contents();
  if (!contents) return false;
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => src.context.lookup(ref))
    : [contents];
  let body = '';
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) return false;
    body += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }
  const packed = zlib.deflateSync(Buffer.from(withoutTextRuns(body), 'latin1'));
  const dict = src.context.obj({ Length: packed.length, Filter: 'FlateDecode' });
  page.node.set(PDFName.of('Contents'), src.context.register(PDFRawStream.of(dict, new Uint8Array(packed))));
  return true;
}

const DELIM = new Set([undefined, ' ', '\t', '\r', '\n', '\f', '\0', '/', '[', ']', '<', '>', '(', ')', '{', '}', '%']);
const isDelim = (ch) => DELIM.has(ch);

// Removes every BT..ET run from a content stream. Literal strings are skipped
// as units so a "(...ET...)" payload cannot end a run early.
function withoutTextRuns(body) {
  let out = '';
  let inText = false;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === '\\') { j += 2; continue; }
        if (body[j] === '(') depth += 1;
        else if (body[j] === ')') depth -= 1;
        j += 1;
      }
      if (!inText) out += body.slice(i, j);
      i = j;
      continue;
    }
    const isRun = (op) => body.startsWith(op, i) && isDelim(body[i - 1]) && isDelim(body[i + 2]);
    if (isRun('BT')) { inText = true; i += 2; continue; }
    if (isRun('ET')) { inText = false; i += 2; continue; }
    if (!inText) out += ch;
    i += 1;
  }
  return out;
}

// page 1 -----------------------------------------------------------------
function drawPageOne(page, qd, billets, { font, bold }, spill) {
  // Shaded bands go down first so the rules and text sit on top of them; the
  // rectangles are the template's own, not derived from the rule positions.
  shade(page, BAND_L, 573.48, BAND_W, 58.32, GREEN);  // Part-A column headings
  shade(page, BAND_L, 516, BAND_W, 26.64, GREEN);     // Production Parameters

  // Outer border.
  vrule(page, OUTER_L, P1.bottom, P1.top + EDGE, EDGE);
  vrule(page, OUTER_R, P1.bottom, P1.top, EDGE);

  // Horizontal rules; the heavier ones separate the form's sections.
  hrule(page, P1.top, LEFT, RIGHT + EDGE, EDGE);
  hrule(page, P1.header);
  hrule(page, P1.title, LEFT, RIGHT + EDGE, EDGE);
  hrule(page, P1.partA);
  hrule(page, P1.aHead);
  hrule(page, P1.aVals);
  hrule(page, P1.band, LEFT, RIGHT + EDGE, EDGE);
  hrule(page, P1.pHead);
  // The billet split does not cross the merged (per-die, not per-billet) cells.
  hrule(page, P1.first, LEFT, COL[1] + RULE);
  hrule(page, P1.first, COL[4] + RULE, COL[10] + RULE);
  hrule(page, P1.last, LEFT, RIGHT + EDGE, EDGE);
  hrule(page, P1.issue);
  hrule(page, P1.spare);
  hrule(page, P1.defect);
  hrule(page, P1.bottom);

  // Vertical rules.
  vrule(page, COL[9], P1.title + EDGE, P1.top);   // DATE / QD # label column
  vrule(page, COL[10], P1.title + EDGE, P1.top);
  for (let i = 1; i <= 10; i++) {
    vrule(page, COL[i], P1.aVals, P1.partA);      // Part-A table
    vrule(page, COL[i], P1.last, P1.band);        // Production Parameters table
  }
  for (const x of [COL[3], COL[4], COL[7], COL[9]]) vrule(page, x, P1.defect, P1.issue);

  // Header: logo cell (drawn separately) plus DATE and QD #.
  drawLabel(page, 'DATE', { x0: COL[9], x1: COL[10], y: 704.9, size: 12, f: bold });
  drawCell(page, qd.raised_date, { x0: COL[10], x1: RIGHT, yB: P1.header + RULE, yT: P1.top }, { size: 11, f: font });

  drawLabel(page, 'Quality Discrepancy', { x0: LEFT, x1: RIGHT, y: 658.1, size: 20, f: bold });
  drawLabel(page, 'QD #', { x0: COL[9], x1: COL[10], y: 658.1, size: 12, f: bold });
  drawCell(page, qd.qd_no, { x0: COL[10], x1: RIGHT, yB: P1.title + EDGE, yT: P1.header }, { size: 11, f: bold });

  drawLabel(page, 'Part-A (To be filled by Gulfex Team)', { x0: LEFT, x1: RIGHT, y: 636.2, size: 14, f: font });

  // Part-A: green headings, then the values row beneath them.
  PART_A_HEADS.forEach((lines, i) => {
    drawStackUp(page, lines, { x0: COL[i], x1: COL[i + 1], lastBaseline: 578.5, size: 13, f: bold, color: WHITE });
  });
  const partA = [
    qd.profile_number, qd.die_no, qd.die_received_date, qd.supplier, qd.press, qd.die_type,
    qd.die_size, qd.no_of_cavity, qd.tooling, qd.no_of_trials, qd.no_of_corrections,
  ];
  partA.forEach((v, i) => {
    const clipped = drawCell(page, v, { x0: COL[i], x1: COL[i + 1], yB: P1.aVals + RULE, yT: P1.aHead }, { size: 9, f: font });
    spill(PART_A_HEADS[i].join(' '), clipped);
  });

  // Production Parameters.
  drawLabel(page, 'Production Parameters', { x0: LEFT, x1: RIGHT, y: 524.4, size: 16, f: bold, color: WHITE });
  PROD_HEADS.forEach((lines, i) => {
    drawStackMid(page, lines, { x0: COL[i], x1: COL[i + 1], midBaseline: 495, size: 9, f: font });
  });
  drawStackMid(page, ['1st Billet', 'Details'], { x0: LEFT, x1: COL[1], midBaseline: 459.65, size: 9, f: font });
  drawStackMid(page, ['Last Billet', 'Details'], { x0: LEFT, x1: COL[1], midBaseline: 423.05, size: 9, f: font });

  const first = billets.find((b) => b.billet === 'first') || {};
  const last = billets.find((b) => b.billet === 'last') || {};
  // Date, soaking hours and die temperature describe the trial, not one billet,
  // so the template merges them across both rows. Show both values only when
  // the two billets actually disagree.
  const merged = (key) => {
    const vals = [t(first[key]).trim(), t(last[key]).trim()].filter(Boolean);
    return [...new Set(vals)].join(' / ');
  };
  const mergedCell = (i, value) =>
    drawCell(page, value, { x0: COL[i], x1: COL[i + 1], yB: P1.last + RULE, yT: P1.pHead }, { size: 9, f: font });
  mergedCell(1, qd.production_date);
  mergedCell(2, merged('die_soaking_hours'));
  mergedCell(3, merged('die_temperature'));
  // A wordy delay explanation will not fit that narrow column; when it is
  // clipped the annexure carries the answer as prose instead.
  if (mergedCell(10, delayCellText(billets))) spill('Any delay observed', buildDelayLine(billets));

  const rows = [
    { b: first, yB: P1.first + RULE, yT: P1.pHead },
    { b: last, yB: P1.last + RULE, yT: P1.first },
  ];
  for (const { b, yB, yT } of rows) {
    BILLET_COLS.forEach((key, n) => {
      drawCell(page, b[key], { x0: COL[n + 4], x1: COL[n + 5], yB, yT }, { size: 9, f: font });
    });
  }

  // Quality Discrepancy description.
  drawLabel(page, 'Quality Discrepancy :', { x0: 37.4, x1: RIGHT, y: 392.8, size: 18, f: bold, left: true });
  spill('Quality Discrepancy', drawFlow(
    page, qd.issue_detail || qd.issue_summary,
    { x0: 37.4, x1: RIGHT - PAD, yB: P1.issue + RULE + 2, yT: 381 }, { size: 11, f: font },
  ));

  // Defect classification. The row above it is blank on the template too.
  drawLabel(page, 'Manufacturing Defect', { x0: LEFT, x1: COL[3], y: 272.8, size: 14, f: bold });
  drawLabel(page, 'Die Performance', { x0: COL[4], x1: COL[7], y: 272.8, size: 14, f: bold });
  const defectCell = { yB: P1.defect + RULE, yT: P1.spare };
  drawCell(page, qd.manufacturing_defect, { x0: COL[3], x1: COL[4], ...defectCell }, { size: 14, f: bold });
  drawCell(page, qd.die_performance, { x0: COL[7], x1: COL[9], ...defectCell }, { size: 14, f: bold });
}

// page 2 -----------------------------------------------------------------
function drawPageTwo(page, qd, { font, bold }, spill) {
  shade(page, BAND_L, 523.68, BAND_W, 33.36, GREY_MID);    // Profile Image / Approved design
  shade(page, BAND_L, 248.4, 246.48, 27.36, GREY_MID);     // acceptance label cell
  shade(page, BAND_L, 102.6, BAND_W, 30.36, GREY_LIGHT);   // Name / Signature heading

  vrule(page, OUTER_L, P2.bottom, P2.top + RULE, EDGE);
  vrule(page, OUTER_R, P2.bottom, P2.top + RULE, EDGE);

  for (const y of [P2.top, P2.free, P2.imgBand, P2.imgCells, P2.action, P2.partB, P2.accept,
    P2.taken, P2.comments, P2.note, P2.signHead, P2.prepared, P2.authorized, P2.received]) {
    hrule(page, y);
  }
  hrule(page, P2.bottom, LEFT, RIGHT + EDGE, EDGE);

  vrule(page, COL[5], P2.imgCells, P2.free);                       // image cells divider
  for (const x of [COL[5], COL[6], COL[7], COL[8], COL[9], COL[10]]) vrule(page, x, P2.accept, P2.partB);
  for (const x of [COL[3], COL[5], COL[8]]) vrule(page, x, P2.bottom + EDGE, P2.note);

  drawLabel(page, 'Profile Image', { x0: LEFT, x1: COL[5], y: 541.3, size: 16, f: bold });
  drawLabel(page, 'Approved design', { x0: COL[5], x1: RIGHT, y: 541.3, size: 16, f: bold });

  drawLabel(page, 'Recommended Action :', { x0: 32.9, x1: RIGHT, y: 354.2, size: 14, f: bold, left: true });
  spill('Recommended Action', drawFlow(
    page, qd.recommended_action,
    { x0: 32.9, x1: RIGHT - PAD, yB: P2.action + RULE + 2, yT: 345 }, { size: 10, f: font },
  ));

  drawLabel(page, 'Part-B (To be filled by Supplier)', { x0: LEFT, x1: RIGHT, y: 285.1, size: 14, f: font });

  // Acceptance: the template prints YES / NO with an empty box after each, so
  // the answer is recorded by marking the matching box.
  drawLabel(page, 'Quality Discrepancy Acceptance', { x0: 32.9, x1: COL[5], y: 257.9, size: 14, f: bold, left: true });
  drawLabel(page, 'YES', { x0: COL[5], x1: COL[6], y: 257.4, size: 14, f: bold });
  drawLabel(page, 'NO', { x0: COL[7], x1: COL[8], y: 257.4, size: 14, f: bold });
  drawLabel(page, 'ETA', { x0: COL[9], x1: COL[10], y: 257.4, size: 14, f: bold });
  const acceptance = t(qd.supplier_acceptance).trim().toLowerCase();
  if (acceptance === 'yes') drawLabel(page, 'X', { x0: COL[6], x1: COL[7], y: 257.4, size: 14, f: bold });
  if (acceptance === 'no') drawLabel(page, 'X', { x0: COL[8], x1: COL[9], y: 257.4, size: 14, f: bold });
  drawCell(page, qd.eta_date, { x0: COL[10], x1: RIGHT, yB: P2.accept + RULE, yT: P2.partB }, { size: 10, f: font });

  drawLabel(page, 'Action Taken', { x0: 32.9, x1: RIGHT, y: 234.7, size: 14, f: bold, left: true });
  spill('Action Taken', drawFlow(
    page, qd.action_taken,
    { x0: 32.9, x1: RIGHT - PAD, yB: P2.taken + RULE + 2, yT: 226 }, { size: 10, f: font },
  ));

  // The comments row is a single line on the form, so the value shares it with
  // the printed label and anything longer continues on the annexure.
  const commentLabel = 'Supplier Comments/Corrective Action';
  drawLabel(page, commentLabel, { x0: 32.9, x1: RIGHT, y: 166, size: 14, f: bold, left: true });
  const commentX = 32.9 + bold.widthOfTextAtSize(sanitize(commentLabel), 14) + 8;
  spill('Supplier Comments / Corrective Action', drawFlow(
    page, qd.supplier_comments,
    { x0: commentX, x1: RIGHT - PAD, yB: P2.comments + RULE, yT: 174 }, { size: 10, f: font, min: 8 },
  ));

  drawLabel(page, CLOSING_NOTE, { x0: 32.9, x1: RIGHT, y: 142.6, size: 14, f: bold, left: true });

  // Sign-off table. The template leaves the fourth column unheaded; it is where
  // the date and time of each sign-off go, so it is labelled to match.
  drawLabel(page, 'Name', { x0: COL[3], x1: COL[5], y: 113.9, size: 13, f: bold });
  drawLabel(page, 'Signature', { x0: COL[5], x1: COL[8], y: 113.9, size: 13, f: bold });
  drawLabel(page, 'Date & Time', { x0: COL[8], x1: RIGHT, y: 113.9, size: 13, f: bold });
  drawLabel(page, 'Prepared By', { x0: LEFT, x1: COL[3], y: 87.1, size: 13, f: bold });
  drawLabel(page, 'Authorized By', { x0: LEFT, x1: COL[3], y: 63.7, size: 13, f: bold });
  drawLabel(page, 'Received By (Supplier)', { x0: LEFT, x1: COL[3], y: 40.3, size: 13, f: bold });
  drawLabel(page, 'Quality Discrepancy Closed on', { x0: LEFT, x1: COL[3], y: 17.9, size: 10, f: bold });
  const nameCell = (yB, yT, value, size = 13) =>
    drawCell(page, value, { x0: COL[3], x1: COL[5], yB, yT }, { size, f: bold });
  nameCell(P2.prepared + RULE, P2.signHead, qd.prepared_by);
  nameCell(P2.authorized + RULE, P2.prepared, qd.approved_by_name);
  nameCell(P2.bottom + EDGE, P2.received, qd.closed_at, 11);

  // When each sign-off happened. Drawn whether or not that person has uploaded a
  // signature image, because the QD recorded the act either way.
  for (const row of Object.values(SIGN_ROWS)) {
    if (!hasSigned(qd, row)) continue;
    drawCell(page, formatStamp(qd[row.at]), { x0: COL[8], x1: RIGHT, yB: row.yB, yT: row.yT }, { size: 10, f: font });
  }
}

// signatures -------------------------------------------------------------
// The sign-off table, one row per signatory. `at` is the column the QD records
// the act in: preparing is signed off by submitting for approval, authorising by
// approving. Both are stamped into the blank column beside the signature.
const SIGN_ROWS = {
  prepared: { name: 'prepared_by', at: 'submitted_at', yB: P2.prepared + RULE, yT: P2.signHead },
  authorized: { name: 'approved_by_name', at: 'approved_at', yB: P2.authorized + RULE, yT: P2.prepared },
};

// A signature and its timestamp are one assertion -- "this named person did this
// on this date" -- so neither is drawn without the other two parts. A signature
// with no name would not say who signed; one with no timestamp would not say
// when, and would appear on a QD that was never actually submitted or approved.
const hasSigned = (qd, row) => Boolean(t(qd[row.name]).trim() && qd[row.at]);

// Sortable and locale-proof: the QD travels between the plant, the supplier and
// an auditor, and 07/08 must not read as August to any of them.
function formatStamp(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return t(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Draws each signatory's scanned signature beside their name.
async function drawSignatures(doc, page, qd, signatures) {
  for (const [role, row] of Object.entries(SIGN_ROWS)) {
    const sig = signatures[role];
    if (!sig || !sig.bytes || !hasSigned(qd, row)) continue;
    try {
      const img = /png$/i.test(sig.mimeType || '')
        ? await doc.embedPng(sig.bytes)
        : await doc.embedJpg(sig.bytes);
      const availW = COL[8] - COL[5] - 8;
      const availH = row.yT - row.yB - 4;
      const scale = Math.min(availW / img.width, availH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: COL[5] + 4 + (availW - w) / 2,
        y: row.yB + 2 + (availH - h) / 2,
        width: w, height: h,
      });
    } catch { /* an unreadable signature leaves the cell blank, as on paper */ }
  }
}

// images -----------------------------------------------------------------
// pdf-lib embeds only PNG/JPEG, so webp and PDF attachments are skipped here
// (they still live on the QD record).
const CAT_LABEL = { profile_image: 'Profile Image', approved_design: 'Approved design', trial_photo: 'Trial photo', general: 'Image' };
const CAT_ORDER = ['trial_photo', 'profile_image', 'approved_design', 'general'];

// The template's two blank working areas, each taking a 2x2 grid of photos.
const FREE_AREAS = [
  { pageNo: 0, x0: LEFT + RULE, x1: RIGHT, yB: P1.bottom + RULE, yT: P1.defect },
  { pageNo: 1, x0: LEFT + RULE, x1: RIGHT, yB: P2.free + RULE, yT: P2.top },
];

async function placeImages(doc, p1, p2, files, fileBytes, { bold }) {
  const renderable = (files || []).filter((f) => fileBytes.get(f.id) && /(png|jpe?g)$/i.test(f.original_name || ''));
  if (!renderable.length) return [];
  const taken = new Set();
  const firstOf = (cat) => renderable.find((f) => f.category === cat && !taken.has(f.id));

  // The two named cells the template reserves.
  const profile = firstOf('profile_image');
  const approved = firstOf('approved_design');
  const cellY = { yB: P2.imgCells + RULE, yT: P2.imgBand };
  if (profile) { taken.add(profile.id); await drawImage(doc, p2, profile, fileBytes, { x0: LEFT + RULE, x1: COL[5], ...cellY }); }
  if (approved) { taken.add(approved.id); await drawImage(doc, p2, approved, fileBytes, { x0: COL[5] + RULE, x1: RIGHT, ...cellY }); }

  // Everything else fills the blank working areas, captioned so an auditor can
  // tell what each photo is.
  const rest = [...renderable].filter((f) => !taken.has(f.id))
    .sort((a, b) => ((CAT_ORDER.indexOf(a.category) + 1) || 99) - ((CAT_ORDER.indexOf(b.category) + 1) || 99));
  const slots = [];
  for (const area of FREE_AREAS) {
    const w = (area.x1 - area.x0) / 2;
    const h = (area.yT - area.yB) / 2;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        slots.push({
          page: area.pageNo === 0 ? p1 : p2,
          x0: area.x0 + col * w, x1: area.x0 + (col + 1) * w,
          yB: area.yT - (row + 1) * h, yT: area.yT - row * h,
        });
      }
    }
  }
  for (let i = 0; i < Math.min(rest.length, slots.length); i++) {
    const { page, ...cell } = slots[i];
    await drawImage(doc, page, rest[i], fileBytes, cell, bold);
  }
  return rest.slice(slots.length);
}

// Fits the image inside `cell` preserving aspect ratio. With a `labelFont` a
// small caption is printed above it; without one the cell is a template cell
// that is already labelled by the band above it.
async function drawImage(doc, page, file, fileBytes, cell, labelFont = null) {
  const bytes = fileBytes.get(file.id);
  if (!bytes) return;
  let capH = 0;
  if (labelFont) {
    capH = 10;
    page.drawText(sanitize(CAT_LABEL[file.category] || 'Image'), {
      x: cell.x0 + 4, y: cell.yT - 9, size: 7, font: labelFont, color: BLACK,
    });
  }
  try {
    const img = /png$/i.test(file.mime_type || file.original_name || '')
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
    const availW = cell.x1 - cell.x0 - 8;
    const availH = cell.yT - cell.yB - 8 - capH;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / img.width, availH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, {
      x: cell.x0 + 4 + (availW - w) / 2,
      y: cell.yB + 4 + (availH - h) / 2,
      width: w, height: h,
    });
  } catch { /* skip unrenderable image */ }
}

// annexure ---------------------------------------------------------------
// Continuation pages. The controlled form is fixed at two pages, so anything
// that did not fit is reprinted here in full rather than being dropped.
async function drawAnnexure(doc, qd, overflow, leftover, fileBytes, { font, bold }) {
  if (!overflow.length && !leftover.length) return;
  const MARGIN = LEFT;
  const TOP = 750;
  const BOTTOM = 50;
  let page = null;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawText(sanitize(`Annexure - Quality Discrepancy ${t(qd.qd_no) || t(qd.die_no)}`), {
      x: MARGIN, y: TOP + 8, size: 12, font: bold, color: BLACK,
    });
    hrule(page, TOP, MARGIN, RIGHT);
    y = TOP - 16;
  };
  const room = (need) => { if (!page || y - need < BOTTOM) newPage(); };

  for (const { title, body } of overflow) {
    room(30);
    page.drawText(sanitize(title), { x: MARGIN, y, size: 10, font: bold, color: BLACK });
    y -= 14;
    for (const line of wrapText(body, font, 10, RIGHT - MARGIN)) {
      room(12);
      if (line) page.drawText(line, { x: MARGIN, y, size: 10, font, color: BLACK });
      y -= 12;
    }
    y -= 8;
  }

  const boxW = (RIGHT - MARGIN - 12) / 2;
  const boxH = 150;
  for (let i = 0; i < leftover.length; i += 2) {
    room(boxH + 6);
    for (const [n, file] of [leftover[i], leftover[i + 1]].entries()) {
      if (!file) continue;
      const x0 = MARGIN + n * (boxW + 12);
      const cell = { x0, x1: x0 + boxW, yB: y - boxH, yT: y };
      page.drawRectangle({ x: cell.x0, y: cell.yB, width: boxW, height: boxH, borderColor: BLACK, borderWidth: 0.7 });
      await drawImage(doc, page, file, fileBytes, cell, bold);
    }
    y -= boxH + 6;
  }
}

// helpers ----------------------------------------------------------------
const BILLET_LABEL = { first: '1st billet', last: 'Last billet' };

// The delay answer as one line, used for the annexure and by callers that need
// a prose version. Returns '' when neither billet answered, so QDs raised
// before this field existed read exactly as they did before.
function buildDelayLine(billets = []) {
  const parts = [];
  for (const which of ['first', 'last']) {
    const b = (billets || []).find((x) => x.billet === which);
    const answer = t(b?.any_delay_observed).trim();
    if (!answer) continue;
    const details = t(b?.any_delay_details).trim();
    // Legacy rows hold 'YES'/'NO'; print them as stored but match case-insensitively.
    const showDetails = answer.toLowerCase() === 'yes' && details;
    parts.push(`${BILLET_LABEL[which]}: ${answer}${showDetails ? ` - ${details}` : ''}`);
  }
  return parts.length ? `Delay observed - ${parts.join(' · ')}` : '';
}

// The same answer stacked for the template's narrow "Any Delay observed" cell.
function delayCellText(billets = []) {
  const lines = [];
  for (const which of ['first', 'last']) {
    const b = (billets || []).find((x) => x.billet === which);
    const answer = t(b?.any_delay_observed).trim();
    if (!answer) continue;
    const details = t(b?.any_delay_details).trim();
    const showDetails = answer.toLowerCase() === 'yes' && details;
    lines.push(`${which === 'first' ? '1st' : 'Last'}: ${answer}${showDetails ? ` - ${details}` : ''}`);
  }
  return lines.join('\n');
}

module.exports = { generateQdPdf, buildDelayLine, delayCellText, sanitize };
