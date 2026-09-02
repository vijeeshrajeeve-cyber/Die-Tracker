'use strict';
const path = require('path');
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { collectJFileData } = require('./jFileData.cjs');

// ── Template ────────────────────────────────────────────────────────────────
const TEMPLATE_PATH = path.join(__dirname, '../assets/backup-j-template.pdf');
let _templateBytes = null;
function getTemplateBytes() {
  if (!_templateBytes) _templateBytes = fs.readFileSync(TEMPLATE_PATH);
  return _templateBytes;
}

// ── Layout constants (calibrated by coordinate probe against backup-j-template.pdf)
// Page: 612 × 792 pt (US Letter). In pdf-lib, y = 0 is the bottom of the page.
const FS = 8;      // main font size (pt)
const FS_SM = 7;   // smaller size for long-value columns
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

// "Press" column center (text is centered within the narrow column borders ~205–258 pt).
const PRESS_CENTER_X = 231;

// ── Reason-for-die-ordering checkboxes ───────────────────────────────────────
// Box geometry calibrated against the template's printed checkboxes.
const REASON_BOX = 9;
const REASON_COL_X = { 1: 36, 2: 193, 3: 404 };
const REASON_ROW_Y = { 1: 421, 2: 392, 3: 363 };
// Canonical reason → checkbox [column, row]. Keys must match the modal dropdown.
const REASON_BOXES = {
  'Die Broken':                   [1, 1],
  'Die Plate Broken':             [2, 1],
  'Back up die for Other Press':  [3, 1],
  'Poor Die Design':              [1, 2],
  'Design Enhancement':           [2, 2],
  'High Order Volume Expected':   [3, 2],
  'Over Weight':                  [1, 3],
  'Other':                        [2, 3],
};
// Checkmarks pre-printed in the template that must be erased before drawing the
// user-selected reason. (col, row)
const REASON_BAKED_CHECKS = [[3, 2], [2, 3]];

// Table column x-positions (text baseline, ~2 pt left padding inside each cell)
const COL_X = {
  profile:   56,
  newDieNo:  147,
  press:     239,
  dieType:   287,
  dieSize:   362,
  activeDie: 442,   // "No. of Active Dies" column
  extruded:  532,   // "Extruded Volume on Active Dies" column
};

// Row text-baseline y-positions: Row 1 at index 0, stride ~14.5 pt downward.
// Baselines match the template's row-number labels (1 → y=641.9, 10 → y=510.8).
const ROW_BASE_Y  = 642;
const ROW_STRIDE  = 14.5;
const rowY = (i) => ROW_BASE_Y - i * ROW_STRIDE; // i = 0..9

// Static field positions — y-baselines aligned to the template's printed labels
// (probed against backup-j-template.pdf with pdfjs-dist).
const FIELD = {
  customerName:  { x: 155, y: 744 },
  orderVolume:   { x: 215, y: 715 },
  prefSupplier:  { x: 195, y: 482 },
  prevSuppliers: { x: 195, y: 467 },
  pendingKg:     { x: 130, y: 321 },
  asOnDate:      { x: 420, y: 321 },
};

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Extract profile (everything before the first '-'). */
function extractProfile(dieNo) {
  if (!dieNo) return '';
  const idx = String(dieNo).indexOf('-');
  return idx === -1 ? String(dieNo) : String(dieNo).substring(0, idx);
}

/** Extract new die number (everything after the first '-'). */
function extractNewDieNo(dieNo) {
  if (!dieNo) return '';
  const idx = String(dieNo).indexOf('-');
  return idx === -1 ? '' : String(dieNo).substring(idx + 1);
}

/** Format a number as "N,NNN Kg". */
function formatKg(value) {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString('en-US') + ' Kg';
}

/** Format a Date as DD/MM/YYYY. */
function formatDate(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

/**
 * Draw text clamped to maxWidth — truncates with a trailing '…' when needed.
 */
function drawClamped(page, text, x, y, font, size, maxWidth) {
  if (!text) return;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth) {
    s = s.slice(0, -1);
  }
  page.drawText(s, { x, y, font, size, color: BLACK });
}

/** Draw text horizontally centered on centerX. */
function drawCentered(page, text, centerX, y, font, size) {
  if (!text) return;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - w / 2, y, font, size, color: BLACK });
}

/** Draw a tick mark inside the checkbox at (column, row). */
function drawReasonCheck(page, col, row) {
  const x = REASON_COL_X[col];
  const y = REASON_ROW_Y[row];
  if (x == null || y == null) return;
  const s = REASON_BOX, p = s * 0.22;
  page.drawLine({ start: { x: x + p, y: y + s * 0.45 }, end: { x: x + s * 0.42, y: y + p }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: x + s * 0.42, y: y + p }, end: { x: x + s - p, y: y + s - p + 0.5 }, thickness: 1, color: BLACK });
}

/** Remove a pre-printed checkmark in the box at (column, row).
 *  The template tick overflows the box edges, so we white out a generous area
 *  (clear of the label text ~13 pt to the right) and redraw a clean empty box. */
function eraseReasonCheck(page, col, row) {
  const x = REASON_COL_X[col];
  const y = REASON_ROW_Y[row];
  if (x == null || y == null) return;
  page.drawRectangle({ x: x - 1.5, y: y - 1.5, width: REASON_BOX + 4, height: REASON_BOX + 4, color: WHITE });
  page.drawRectangle({ x, y, width: REASON_BOX, height: REASON_BOX, borderColor: BLACK, borderWidth: 0.7 });
}

// ── Database queries ────────────────────────────────────────────────────────

async function queryOrderVolume(pool, profile) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0)::bigint AS total
     FROM existing_production_data
     WHERE profile_number = $1`,
    [profile]
  );
  return Number(rows[0]?.total || 0);
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate the filled BACK UP DIE ORDERING FORM (J-file).
 *
 * @param {object} backupRequest  Row from backup_die_requests (die_no, customer, press …)
 * @param {object} orderValues    Values from the Generate Order modal, including PENDING_ORDER_KG
 * @param {object} pool           pg Pool instance
 * @returns {Promise<Buffer>}     Filled PDF as Buffer
 */
async function generateJFilePdf(backupRequest, orderValues, pool) {
  const dieNo   = backupRequest.die_no || '';
  const profile = extractProfile(dieNo);

  // ── Parallel DB queries ─────────────────────────────────────────────────
  const [{ activeDies, prevSuppliers: prevSuppliersList }, orderVolume] = await Promise.all([
    collectJFileData(pool, dieNo),
    queryOrderVolume(pool, profile),
  ]);

  // ── Load template ───────────────────────────────────────────────────────
  const pdf  = await PDFDocument.load(getTemplateBytes());
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // ── Header ──────────────────────────────────────────────────────────────
  page.drawText(backupRequest.customer || '', {
    x: FIELD.customerName.x, y: FIELD.customerName.y, font, size: FS, color: BLACK,
  });

  page.drawText(formatKg(orderVolume), {
    x: FIELD.orderVolume.x, y: FIELD.orderVolume.y, font, size: FS, color: BLACK,
  });

  // ── Table Row 1 (the new die being ordered) ─────────────────────────────
  const dieType = orderValues.HOLLOW ? 'Hollow' : (orderValues.SOLID ? 'Solid' : '');
  const y1 = rowY(0); // 638

  page.drawText(extractProfile(dieNo),     { x: COL_X.profile,  y: y1, font, size: FS, color: BLACK });
  // "New Die No." shows the full Profile-Die number, e.g. "29663-252".
  page.drawText(dieNo,                      { x: COL_X.newDieNo, y: y1, font, size: FS, color: BLACK });
  drawCentered(page, backupRequest.press || '', PRESS_CENTER_X, y1, font, FS);
  page.drawText(dieType,                   { x: COL_X.dieType,  y: y1, font, size: FS, color: BLACK });
  drawClamped(page, orderValues.DIE_SIZE || '', COL_X.dieSize, y1, font, FS, 70);

  // ── Active dies — "No. of Active Dies" + "Extruded Volume" columns ───────
  // Col 7 (activeDie) width ≈ 88 pt; col 8 (extruded) width ≈ 50 pt
  for (let i = 0; i < activeDies.length; i++) {
    const y = rowY(i);
    const die = activeDies[i];

    const activeDieText = die.supplier ? `${die.die_no} ${die.supplier}` : die.die_no;
    drawClamped(page, activeDieText, COL_X.activeDie, y, font, FS_SM, 88);

    // A die still on order has extruded nothing yet, which is not the same as
    // having extruded zero — leave the cell blank rather than printing 0 Kg.
    if (die.tonnage !== null) {
      drawClamped(page, formatKg(die.tonnage), COL_X.extruded, y, font, FS_SM, 50);
    }
  }

  // ── Below-table fields ───────────────────────────────────────────────────
  drawClamped(page, orderValues.SUPPLIER || '', FIELD.prefSupplier.x, FIELD.prefSupplier.y, font, FS, 380);

  if (prevSuppliersList.length > 0) {
    drawClamped(page, prevSuppliersList.join(' , '), FIELD.prevSuppliers.x, FIELD.prevSuppliers.y, font, FS, 380);
  }

  // ── Reason for Die Ordering ──────────────────────────────────────────────
  // Erase the template's pre-printed checkmarks, then tick the user's choice.
  for (const [c, r] of REASON_BAKED_CHECKS) eraseReasonCheck(page, c, r);
  const reasonBox = REASON_BOXES[orderValues.REASON];
  if (reasonBox) drawReasonCheck(page, reasonBox[0], reasonBox[1]);

  // ── Die Ordering Explanation ─────────────────────────────────────────────
  page.drawText(formatKg(Number(orderValues.PENDING_ORDER_KG) || 0), {
    x: FIELD.pendingKg.x, y: FIELD.pendingKg.y, font, size: FS, color: BLACK,
  });
  page.drawText(formatDate(), {
    x: FIELD.asOnDate.x, y: FIELD.asOnDate.y, font, size: FS, color: BLACK,
  });

  return Buffer.from(await pdf.save());
}

module.exports = { generateJFilePdf, extractProfile, extractNewDieNo, formatKg, formatDate };
