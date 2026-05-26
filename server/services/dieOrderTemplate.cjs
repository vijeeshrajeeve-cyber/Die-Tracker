const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const MM = 72 / 25.4; // 1 mm in PDF points
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

const isTruthy = (v) => {
    if (typeof v === 'boolean') return v;
    if (v == null) return false;
    return ['1', 'true', 'yes', 'y', 'x', 'on', 'checked'].includes(String(v).trim().toLowerCase());
};

const textValue = (values, key) => {
    const raw = values?.[key];
    if (raw == null) return '';
    if (typeof raw === 'boolean') return raw ? 'Yes' : '';
    return String(raw);
};

/**
 * Stamp the filled die-order template onto the first page of the given PDF.
 * Mirrors the layout produced by the original die_order_template.py
 * (8 mm left margin, 10 mm top margin by default).
 *
 * @param {Buffer|Uint8Array} inputPdfBytes - the user's profile drawing PDF
 * @param {Object} values - field values (see VALUE_KEYS below for accepted keys)
 * @param {Object} [options]
 * @param {number} [options.templateYOffsetMm=10] - top margin of the template in mm
 * @returns {Promise<Buffer>} the modified PDF bytes
 */
async function generateBackupOrderPdf(inputPdfBytes, values, options = {}) {
    const yOffsetMm = options.templateYOffsetMm ?? 10;

    const pdf = await PDFDocument.load(inputPdfBytes);
    const pages = pdf.getPages();
    if (pages.length === 0) {
        throw new Error('Input PDF has no pages');
    }
    const page = pages[0];
    const pageHeight = page.getHeight();

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const fontSize = 4.5;
    const smallFont = 3.8;

    const tableWidth = 55 * MM;
    const leftMargin = 8 * MM;
    const tableX = leftMargin;

    const rowH = 4 * MM;
    const headerH = 5 * MM;
    const noteH = 4 * MM;
    const finishH = 5.5 * MM;

    const totalRowsHeight =
        headerH + // row 1
        rowH * 9 + // rows 2-10
        noteH +    // row 11
        finishH;   // row 12

    const tableTop = pageHeight - yOffsetMm * MM;

    const col1X = tableX;
    const col2X = tableX + 13 * MM;
    const col3X = tableX + 28 * MM;
    const col4X = tableX + 41 * MM;
    const midX = tableX + 33 * MM;

    const lineThickness = 0.4;

    const drawRect = (x, yBottom, w, h, fill) => {
        const opts = { x, y: yBottom, width: w, height: h, borderColor: BLACK, borderWidth: lineThickness };
        if (fill) {
            opts.color = fill;
        }
        page.drawRectangle(opts);
    };

    const drawLineV = (x, yTop, yBottom) => {
        page.drawLine({ start: { x, y: yTop }, end: { x, y: yBottom }, thickness: lineThickness, color: BLACK });
    };

    const drawCellText = (text, x, yTop, w, h, { bold = false, centered = false, size = fontSize } = {}) => {
        if (text === undefined || text === null || text === '') return;
        const f = bold ? fontBold : font;
        const textY = yTop - h / 2 - size * 0.35;
        if (centered) {
            const tw = f.widthOfTextAtSize(text, size);
            page.drawText(text, { x: x + w / 2 - tw / 2, y: textY, font: f, size, color: BLACK });
        } else {
            page.drawText(text, { x: x + 2 * MM, y: textY, font: f, size, color: BLACK });
        }
    };

    const drawCheckMark = (boxX, boxY, size) => {
        const pad = size * 0.18;
        page.drawLine({ start: { x: boxX + pad, y: boxY + pad }, end: { x: boxX + size - pad, y: boxY + size - pad }, thickness: 0.5, color: BLACK });
        page.drawLine({ start: { x: boxX + pad, y: boxY + size - pad }, end: { x: boxX + size - pad, y: boxY + pad }, thickness: 0.5, color: BLACK });
    };

    // White background for the table so the underlying PDF doesn't bleed through.
    page.drawRectangle({
        x: tableX,
        y: tableTop - totalRowsHeight,
        width: tableWidth,
        height: totalRowsHeight,
        color: WHITE,
        borderWidth: 0,
    });

    let y = tableTop; // top of the current row

    // === ROW 1: SUPPLIER / DATE ===
    let h = headerH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(col2X, y, y - h);
    drawLineV(col3X, y, y - h);
    drawLineV(col4X, y, y - h);
    drawCellText('SUPPLIER', col1X, y, col2X - col1X, h, { bold: true });
    drawCellText(textValue(values, 'SUPPLIER'), col2X, y, col3X - col2X, h);
    drawCellText('DATE', col3X, y, col4X - col3X, h, { bold: true });
    drawCellText(textValue(values, 'DATE'), col4X, y, tableX + tableWidth - col4X, h);
    y -= h;

    // === ROW 2: header banner ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawCellText('*EMAIL THE DESIGN BEFORE MANUFACTURING*', tableX, y, tableWidth, h, { bold: true, centered: true });
    y -= h;

    // === ROW 3: DIE SIZE ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(col2X, y, y - h);
    drawCellText('DIE SIZE', col1X, y, col2X - col1X, h, { bold: true });
    drawCellText(textValue(values, 'DIE_SIZE'), col2X, y, tableX + tableWidth - col2X, h);
    y -= h;

    // === ROW 4: No OF CAV / PRESS ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(col2X, y, y - h);
    drawLineV(col3X, y, y - h);
    drawLineV(col4X, y, y - h);
    drawCellText('No OF CAV', col1X, y, col2X - col1X, h, { bold: true });
    drawCellText(textValue(values, 'NO_OF_CAV'), col2X, y, col3X - col2X, h);
    drawCellText('PRESS', col3X, y, col4X - col3X, h, { bold: true });
    drawCellText(textValue(values, 'PRESS'), col4X, y, tableX + tableWidth - col4X, h);
    y -= h;

    // === ROW 5: SOLID / HOLLOW ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(col2X, y, y - h);
    drawLineV(col3X, y, y - h);
    drawLineV(col4X, y, y - h);
    drawCellText('SOLID', col1X, y, col2X - col1X, h, { bold: true });
    drawCellText(textValue(values, 'SOLID'), col2X, y, col3X - col2X, h);
    drawCellText('HOLLOW', col3X, y, col4X - col3X, h, { bold: true });
    drawCellText(textValue(values, 'HOLLOW'), col4X, y, tableX + tableWidth - col4X, h);
    y -= h;

    // === ROW 6: BOLSTER No / INSERT No ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(col2X, y, y - h);
    drawLineV(col3X, y, y - h);
    drawLineV(col4X, y, y - h);
    drawCellText('BOLSTER No,', col1X, y, col2X - col1X, h, { bold: true });
    drawCellText(textValue(values, 'BOLSTER_NO'), col2X, y, col3X - col2X, h);
    drawCellText('INSERT No,', col3X, y, col4X - col3X, h, { bold: true });
    drawCellText(textValue(values, 'INSERT_NO'), col4X, y, tableX + tableWidth - col4X, h);
    y -= h;

    // === ROW 7: SIZE / SIZE ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(col2X, y, y - h);
    drawLineV(col3X, y, y - h);
    drawLineV(col4X, y, y - h);
    drawCellText('SIZE', col1X, y, col2X - col1X, h, { bold: true });
    drawCellText(textValue(values, 'BOLSTER_SIZE'), col2X, y, col3X - col2X, h);
    drawCellText('SIZE', col3X, y, col4X - col3X, h, { bold: true });
    drawCellText(textValue(values, 'INSERT_SIZE'), col4X, y, tableX + tableWidth - col4X, h);
    y -= h;

    // === ROW 8: REQUESTED DELIVERY DATE ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(midX, y, y - h);
    drawCellText('REQUESTED DELIVERY DATE', tableX, y, midX - tableX, h, { bold: true });
    drawCellText(textValue(values, 'DELIVERY_DATE'), midX, y, tableX + tableWidth - midX, h);
    y -= h;

    // === ROW 9: 3D MODULE FOR SIMULATION ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(midX, y, y - h);
    drawCellText('3D MODULE FOR SIMULATION', tableX, y, midX - tableX, h, { bold: true });
    drawCellText(textValue(values, 'THREE_D_MODULE'), midX, y, tableX + tableWidth - midX, h);
    y -= h;

    // === ROW 10: MODE OF SHIPMENT ===
    h = rowH;
    drawRect(tableX, y - h, tableWidth, h);
    drawLineV(midX, y, y - h);
    drawCellText('MODE OF SHIPMENT', tableX, y, midX - tableX, h, { bold: true });
    drawCellText(textValue(values, 'SHIPMENT'), midX, y, tableX + tableWidth - midX, h);
    y -= h;

    // === ROW 11: NOTE ===
    h = noteH;
    drawRect(tableX, y - h, tableWidth, h);
    const pct = textValue(values, 'PROFILE_WEIGHT_PCT');
    const filler = pct || '...........';
    drawCellText(`NOTE: PROFILE WEIGHT SHOULD START FROM ${filler}%`, tableX, y, tableWidth, h, { bold: true });
    y -= h;

    // === ROW 12: FINISH ===
    h = finishH;
    drawRect(tableX, y - h, tableWidth, h);
    const textY = y - h / 2 - fontSize * 0.35;
    let cx = tableX + 1.5 * MM;
    page.drawText('FINISH', { x: cx, y: textY, font: fontBold, size: fontSize, color: BLACK });
    cx += 9 * MM;

    const boxSize = 2.2 * MM;
    const boxY = y - h / 2 - boxSize / 2;

    // Mill
    page.drawText('Mill', { x: cx, y: textY, font: fontBold, size: fontSize, color: BLACK });
    cx += 5 * MM;
    drawRect(cx, boxY, boxSize, boxSize);
    if (isTruthy(values?.FINISH_MILL)) drawCheckMark(cx, boxY, boxSize);
    cx += boxSize + 3.5 * MM;

    // Anodizing
    page.drawText('Anodizing', { x: cx, y: textY, font: fontBold, size: fontSize, color: BLACK });
    cx += 9 * MM;
    drawRect(cx, boxY, boxSize, boxSize);
    if (isTruthy(values?.FINISH_ANODIZING)) drawCheckMark(cx, boxY, boxSize);
    cx += boxSize + 3.5 * MM;

    // Powder coating (two lines)
    page.drawText('Powder', { x: cx, y: textY + 1.5, font: fontBold, size: smallFont, color: BLACK });
    page.drawText('coating', { x: cx, y: textY - 2, font: fontBold, size: smallFont, color: BLACK });
    cx += 7.5 * MM;
    drawRect(cx, boxY, boxSize, boxSize);
    if (isTruthy(values?.FINISH_POWDER)) drawCheckMark(cx, boxY, boxSize);

    const bytes = await pdf.save();
    return Buffer.from(bytes);
}

const VALUE_KEYS = [
    'SUPPLIER', 'DATE', 'DIE_SIZE', 'NO_OF_CAV', 'PRESS',
    'SOLID', 'HOLLOW', 'BOLSTER_NO', 'INSERT_NO',
    'BOLSTER_SIZE', 'INSERT_SIZE', 'DELIVERY_DATE',
    'THREE_D_MODULE', 'SHIPMENT', 'PROFILE_WEIGHT_PCT',
    'FINISH_MILL', 'FINISH_ANODIZING', 'FINISH_POWDER',
];

module.exports = { generateBackupOrderPdf, VALUE_KEYS };
