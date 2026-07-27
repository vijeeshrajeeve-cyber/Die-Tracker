'use strict';
// Renders a Quality Discrepancy (QD) form to an A4 PDF using pdf-lib.
// Faithful-but-pragmatic: this mirrors the standard QD paper form (header, Part-A
// tables, production-parameter grid, wrapped discrepancy text, image grid,
// recommended action, Part-B, sign-off). The form body is one page; the image
// grid paginates onto additional pages so every uploaded image is included.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const GREEN = rgb(0.13, 0.70, 0.36);
const GREY = rgb(0.75, 0.75, 0.75);
const BLACK = rgb(0, 0, 0);

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

async function generateQdPdf(qd, { files = [], billets = [], logoBytes = null, fileBytes = new Map() } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]); // A4 portrait, points
  const M = 30;
  let y = 812;

  const text = (s, x, yy, { size = 9, f = font, color = BLACK } = {}) =>
    page.drawText(sanitize(t(s)).slice(0, 120), { x, y: yy, size, font: f, color });
  const box = (x, yy, w, h, color = BLACK, width = 0.7) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: color, borderWidth: width });
  const fill = (x, yy, w, h, color) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });

  // Header band: logo + title + DATE / QD#
  if (logoBytes) {
    try { const img = await doc.embedPng(logoBytes); page.drawImage(img, { x: M, y: y - 34, width: 120, height: 34 }); }
    catch { /* logo optional */ }
  }
  text('Quality Discrepancy', 230, y - 22, { size: 15, f: bold });
  box(M, y - 44, 535, 44);
  text('DATE', 470, y - 16, { f: bold }); text(t(qd.raised_date), 505, y - 16);
  text('QD #', 470, y - 34, { f: bold }); text(t(qd.qd_no), 505, y - 34);
  y -= 52;

  // Part-A header row (green) — draw the label band then the value cells
  fill(M, y - 16, 535, 16, GREEN);
  const hdrs = ['Profile', 'Die no', 'Received', 'Supplier', 'Press', 'Die Type', 'Die size', 'Cavity', 'Tooling', 'Trials', 'Corr.'];
  const vals = [qd.profile_number, qd.die_no, qd.die_received_date, qd.supplier, qd.press,
    qd.die_type, qd.die_size, qd.no_of_cavity, qd.tooling, qd.no_of_trials, qd.no_of_corrections];
  const colW = 535 / hdrs.length;
  hdrs.forEach((h, i) => text(h, M + 3 + i * colW, y - 12, { size: 7, f: bold, color: rgb(1, 1, 1) }));
  y -= 16; box(M, y - 16, 535, 16);
  vals.forEach((v, i) => text(v, M + 3 + i * colW, y - 12, { size: 7 }));
  y -= 24;

  // Production parameters (1st / last billet)
  fill(M, y - 14, 535, 14, GREEN);
  text('Production Parameters', 250, y - 11, { size: 8, f: bold, color: rgb(1, 1, 1) });
  y -= 14;
  const pcols = ['', 'Soak', 'Die T', 'Billet T', 'B/thru', 'Running', 'Length', 'Alloy', 'Ram'];
  const pw = 535 / pcols.length;
  box(M, y - 14, 535, 14); pcols.forEach((h, i) => text(h, M + 3 + i * pw, y - 10, { size: 7, f: bold }));
  y -= 14;
  for (const label of ['first', 'last']) {
    const b = billets.find((x) => x.billet === label) || {};
    const row = [label === 'first' ? '1st' : 'Last', b.die_soaking_hours, b.die_temperature, b.billet_temp,
      b.breakthrough_pressure, b.running_pressure, b.billet_length, b.alloy, b.ram_speed];
    box(M, y - 14, 535, 14); row.forEach((v, i) => text(v, M + 3 + i * pw, y - 10, { size: 7 }));
    y -= 14;
  }
  y -= 8;

  // One wrapped line rather than a tenth column in the table above, which would
  // squeeze all nine existing columns below legibility. drawWrapped (unlike
  // text) does not truncate, so a long explanation flows onto further lines.
  const delayLine = buildDelayLine(billets);
  if (delayLine) {
    y = drawWrapped(page, font, delayLine, M, y, 535, 8);
    y -= 6;
  }

  // Quality Discrepancy description (wrapped)
  text('Quality Discrepancy:', M, y, { f: bold, size: 10 }); y -= 14;
  y = drawWrapped(page, font, t(qd.issue_detail || qd.issue_summary), M, y, 535, 9);
  y -= 6;

  // Defect classification
  text(`Manufacturing Defect: ${t(qd.manufacturing_defect) || '-'}    Die Performance: ${t(qd.die_performance) || '-'}`, M, y, { size: 9, f: bold });
  y -= 20;

  // Images: every uploaded image, grouped by category, paginating as needed.
  const newPage = () => doc.addPage([595, 842]);
  ({ page, y } = await drawImages(doc, page, files, fileBytes, M, y, newPage));
  // If the images filled the page, start a fresh one so the closing sections
  // (Recommended Action, Part-B, sign-off) don't render off the bottom edge.
  if (y < 180) { page = newPage(); y = 812; }

  // Recommended action
  text('Recommended Action:', M, y, { f: bold, size: 10 }); y -= 14;
  y = drawWrapped(page, font, t(qd.recommended_action), M, y, 535, 9); y -= 10;

  // Part-B (supplier)
  fill(M, y - 14, 535, 14, GREY); text('Part-B (To be filled by Supplier)', 210, y - 11, { size: 8, f: bold }); y -= 14;
  text(`Acceptance: ${t(qd.supplier_acceptance) || '-'}    ETA: ${t(qd.eta_date) || '-'}`, M, y - 12, { size: 9 }); y -= 24;
  text('Action Taken:', M, y, { f: bold, size: 9 }); y -= 12;
  y = drawWrapped(page, font, t(qd.action_taken), M, y, 535, 9); y -= 6;
  text('Supplier Comments / Corrective Action:', M, y, { f: bold, size: 9 }); y -= 12;
  y = drawWrapped(page, font, t(qd.supplier_comments), M, y, 535, 9); y -= 10;

  // Sign-off
  text(`Prepared By: ${t(qd.prepared_by)}`, M, y, { size: 9 });
  text(`Authorized By: ${t(qd.approved_by_name || '')}`, 210, y, { size: 9 });
  text(`Closed on: ${t(qd.closed_at) || '-'}`, 420, y, { size: 9 });

  return doc.save();
}

// helpers ---------------------------------------------------------------
function drawWrapped(page, font, str, x, y, maxW, size) {
  const words = sanitize(t(str)).split(/\s+/); let line = ''; let yy = y;
  const flush = () => { if (line) { page.drawText(line, { x, y: yy, size, font }); yy -= size + 3; line = ''; } };
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW) { flush(); line = w; } else { line = test; }
  }
  flush();
  return yy;
}

// The delay answer as one line for under the Production Parameters table.
// Returns '' when neither billet answered, so QDs raised before this field
// existed render exactly as they did before.
const BILLET_LABEL = { first: '1st billet', last: 'Last billet' };

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

// Draws every uploaded (embeddable) image, ordered by category, into a 2-up
// grid of labelled boxes. Adds pages as it fills, and returns the page/cursor
// the caller should continue drawing on. pdf-lib embeds only PNG/JPEG, so webp
// and PDF attachments are skipped here (they still live on the QD record).
const CAT_LABEL = { profile_image: 'Profile Image', approved_design: 'Approved design', trial_photo: 'Trial photo', general: 'Image' };
const CAT_ORDER = ['profile_image', 'approved_design', 'trial_photo', 'general'];

async function drawImages(doc, page, files, fileBytes, x, y, newPage) {
  const renderable = files.filter((f) => fileBytes.get(f.id) && /(png|jpe?g)$/i.test(f.original_name || ''));
  if (!renderable.length) return { page, y };
  const ordered = [...renderable].sort(
    (a, b) => ((CAT_ORDER.indexOf(a.category) + 1) || 99) - ((CAT_ORDER.indexOf(b.category) + 1) || 99)
  );
  const boxW = 260, boxH = 130, gap = 15, bottom = 40;
  const labelFont = await doc.embedFont(StandardFonts.HelveticaBold);
  let col = 0, rowY = y;
  for (const f of ordered) {
    if (col === 0 && rowY - boxH < bottom) { page = newPage(); rowY = 812; }
    const sx = x + col * (boxW + gap);
    page.drawRectangle({ x: sx, y: rowY - boxH, width: boxW, height: boxH, borderColor: rgb(0, 0, 0), borderWidth: 0.7 });
    page.drawText(sanitize(CAT_LABEL[f.category] || 'Image'), { x: sx + 4, y: rowY - 12, size: 8, font: labelFont });
    const bytes = fileBytes.get(f.id);
    try {
      const img = /png$/i.test(f.mime_type || f.original_name) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      // Fit inside the box preserving aspect ratio, centred below the label.
      const availW = boxW - 8, availH = boxH - 22;
      const scale = Math.min(availW / img.width, availH / img.height);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: sx + 4 + (availW - w) / 2, y: rowY - boxH + 4 + (availH - h) / 2, width: w, height: h });
    } catch { /* skip unrenderable image */ }
    col += 1;
    if (col === 2) { col = 0; rowY -= boxH + 10; }
  }
  return { page, y: col === 0 ? rowY : rowY - boxH - 10 };
}

module.exports = { generateQdPdf, buildDelayLine };
