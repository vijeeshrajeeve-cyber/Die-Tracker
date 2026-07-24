'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { generateQdPdf } = require('./qdPdf.cjs');

// Smallest valid 1x1 PNG — enough for pdf-lib to embed.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const baseQd = {
  qd_no: '2026PH-04', die_no: '30601-201', profile_number: '30601', supplier: 'Phoenix',
  raised_date: '2026-06-04', press: 'P2', die_type: 'Hollow', die_size: '475x280',
  no_of_cavity: '1', tooling: 'BOL 30587', no_of_trials: '5', no_of_corrections: '4',
  issue_detail: 'Heavy blend observed on the profile after trial production.',
  manufacturing_defect: 'No', die_performance: 'Yes',
  recommended_action: 'Provide a replacement FOC dieplate on an urgent basis.',
  prepared_by: 'Veera', supplier_acceptance: null, closed_at: null,
};

test('generateQdPdf returns a non-empty PDF for a fully-populated QD', async () => {
  const bytes = await generateQdPdf(baseQd, { files: [], billets: [
    { billet: 'first', billet_temp: '502', running_pressure: '167' },
    { billet: 'last',  billet_temp: '498', running_pressure: '162' },
  ], fileBytes: new Map() });
  assert.ok(bytes.length > 800);
  // PDF magic header
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});

test('generateQdPdf tolerates missing optional fields and no images', async () => {
  const bytes = await generateQdPdf({ qd_no: '2026PH-05', die_no: 'x' }, { files: [], billets: [], fileBytes: new Map() });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});

test('generateQdPdf renders every uploaded image across categories, paginating (regression: not just 2 slots)', async () => {
  const cats = ['profile_image', 'approved_design', 'trial_photo', 'general'];
  const files = [];
  const fileBytes = new Map();
  for (let i = 1; i <= 8; i++) {
    files.push({ id: i, original_name: `img${i}.png`, mime_type: 'image/png', category: cats[i % cats.length] });
    fileBytes.set(i, PNG_1x1);
  }
  const bytes = await generateQdPdf(baseQd, { files, billets: [], fileBytes });
  const loaded = await PDFDocument.load(bytes);
  // The old renderer had two fixed slots on one page; eight images must now
  // overflow onto at least a second page instead of being dropped.
  assert.ok(loaded.getPageCount() >= 2, `expected pagination for 8 images, got ${loaded.getPageCount()} page(s)`);
});

test('generateQdPdf sanitizes non-WinAnsi characters (em dash, curly quotes) without throwing', async () => {
  const qd = {
    ...baseQd,
    issue_detail: 'Die surface shows a "blend" defect — the supplier’s die soak was insufficient; profile’s "corner radius" is off – needs correction.',
    recommended_action: 'Replace the die — the client’s tolerance is tight – use “bullet” nose design.',
  };
  const bytes = await generateQdPdf(qd, { files: [], billets: [], fileBytes: new Map() });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});
