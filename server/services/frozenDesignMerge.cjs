'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// Pure: from frozen_design_files rows, resolve absolute paths of the PDF files only.
// Non-PDF attachments (DWG/STEP/images) are skipped — they can't be merged into a PDF.
function pdfPathsFromFiles(files, root) {
  const base = path.resolve(root);
  return (files || [])
    .filter((f) => /\.pdf$/i.test(f.original_name || f.stored_path || ''))
    .map((f) => path.resolve(root, f.stored_path))
    .filter((p) => p.startsWith(base)); // guard against path escape
}

// Append the pages of each PDF at pdfPaths onto the base PDF buffer. Missing or
// unreadable files are skipped (best-effort) so a bad attachment never blocks the order.
async function mergePdfs(baseBuffer, pdfPaths) {
  if (!pdfPaths || pdfPaths.length === 0) return baseBuffer;
  const base = await PDFDocument.load(baseBuffer);
  for (const p of pdfPaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const src = await PDFDocument.load(fs.readFileSync(p));
      const pages = await base.copyPages(src, src.getPageIndices());
      pages.forEach((pg) => base.addPage(pg));
    } catch (e) {
      console.error('Frozen design PDF merge skipped for', p, '-', e.message);
    }
  }
  return Buffer.from(await base.save());
}

module.exports = { pdfPathsFromFiles, mergePdfs };
