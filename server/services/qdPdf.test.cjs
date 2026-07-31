'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFName } = require('pdf-lib');
const { generateQdPdf, buildDelayLine, delayCellText } = require('./qdPdf.cjs');

// Smallest valid 1x1 PNG — enough for pdf-lib to embed.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'qd-form-template.pdf');
const templateBytes = fs.readFileSync(TEMPLATE_PATH);

const baseQd = {
  qd_no: '2026PH-04', die_no: '30601-201', profile_number: '30601', supplier: 'Phoenix',
  raised_date: '2026-06-04', press: 'P2', die_type: 'Hollow', die_size: '475x280',
  no_of_cavity: '1', tooling: 'BOL 30587', no_of_trials: '5', no_of_corrections: '4',
  issue_detail: 'Heavy blend observed on the profile after trial production.',
  manufacturing_defect: 'No', die_performance: 'Yes',
  recommended_action: 'Provide a replacement FOC dieplate on an urgent basis.',
  prepared_by: 'Veera', supplier_acceptance: null, closed_at: null,
};

// Reads back every text run pdf-lib wrote, so a test can assert on what the
// generated form actually says.
async function textOf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(content.items.map((i) => i.str).join(' '));
  }
  return pages;
}

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

// The QD is a certification record: the standard form is two US Letter pages,
// and nothing about a particular QD may reflow it.
test('the form is exactly two US Letter pages, whatever the QD holds', async () => {
  for (const opts of [
    { files: [], billets: [], fileBytes: new Map() },
    { files: [], billets: [{ billet: 'first', alloy: '6063' }], fileBytes: new Map() },
  ]) {
    const doc = await PDFDocument.load(await generateQdPdf(baseQd, opts));
    assert.equal(doc.getPageCount(), 2);
    const { width, height } = doc.getPage(0).getSize();
    assert.deepEqual([Math.round(width), Math.round(height)], [612, 792]);
  }
});

test('the printed form wording matches the template, on the template pages', async () => {
  const [p1, p2] = await textOf(await generateQdPdf(baseQd, { files: [], billets: [], fileBytes: new Map(), templateBytes }));
  for (const label of ['DATE', 'QD #', 'Quality Discrepancy', 'Part-A (To be filled by Gulfex Team)',
    'Production Parameters', 'Any Delay', 'observed', 'Manufacturing Defect', 'Die Performance']) {
    assert.ok(p1.includes(label), `page 1 is missing "${label}"`);
  }
  for (const label of ['Profile Image', 'Approved design', 'Recommended Action :',
    'Part-B (To be filled by Supplier)', 'Quality Discrepancy Acceptance', 'YES', 'NO', 'ETA',
    'Action Taken', 'Supplier Comments/Corrective Action',
    'Note- Quality Discrepancy should be closed within 10 Working Days',
    'Name', 'Signature', 'Prepared By', 'Authorized By', 'Received By (Supplier)']) {
    assert.ok(p2.includes(label), `page 2 is missing "${label}"`);
  }
});

// The template PDF carries the letterhead artwork; embedding that region must
// not drag the template's own printed labels into the text layer behind ours.
test('the embedded letterhead adds no hidden duplicate of the form labels', async () => {
  const [p1] = await textOf(await generateQdPdf(baseQd, { files: [], billets: [], fileBytes: new Map(), templateBytes }));
  assert.equal(p1.match(/Part-A \(To be filled by Gulfex Team\)/g).length, 1);
  assert.equal(p1.match(/Production Parameters/g).length, 1);
});

test('the sign-off names come from the QD, not the template', async () => {
  const qd = { ...baseQd, prepared_by: 'Jaypee', approved_by_name: 'A. Reviewer' };
  const [, p2] = await textOf(await generateQdPdf(qd, { files: [], billets: [], fileBytes: new Map(), templateBytes }));
  assert.ok(p2.includes('Jaypee'));
  assert.ok(p2.includes('A. Reviewer'));
  assert.ok(!p2.includes('Imran Mulla'), 'the template\'s sample signatory leaked into the output');
});

test('generateQdPdf renders every uploaded image, annexing what the form has no room for', async () => {
  const cats = ['profile_image', 'approved_design', 'trial_photo', 'general'];
  const files = [];
  const fileBytes = new Map();
  for (let i = 1; i <= 14; i++) {
    files.push({ id: i, original_name: `img${i}.png`, mime_type: 'image/png', category: cats[i % cats.length] });
    fileBytes.set(i, PNG_1x1);
  }
  const loaded = await PDFDocument.load(await generateQdPdf(baseQd, { files, billets: [], fileBytes }));
  // Two template cells plus eight working-area slots; the rest must be annexed
  // rather than dropped, so the form grows past its fixed two pages.
  assert.ok(loaded.getPageCount() >= 3, `expected an annexure, got ${loaded.getPageCount()} page(s)`);
});

test('text too long for a fixed box is reprinted in full on the annexure', async () => {
  const detail = Array.from({ length: 40 }, (_, i) => `Observation ${i + 1} recorded during the trial run.`).join(' ');
  const bytes = await generateQdPdf({ ...baseQd, issue_detail: detail }, { files: [], billets: [], fileBytes: new Map() });
  const pages = await textOf(bytes);
  assert.equal(pages.length, 3, 'expected an annexure page');
  assert.ok(pages[0].includes('continued on annexure'), 'the clipped box does not say it continues');
  assert.ok(pages[2].includes('Observation 40 recorded during the trial run.'), 'the annexure lost the tail of the text');
});

// Counts image XObjects on a page — with no uploaded files, the only images on
// page 2 are the signatures, so this says exactly how many were drawn.
async function imagesOnPage(bytes, pageIndex) {
  const doc = await PDFDocument.load(bytes);
  const xobjects = doc.getPage(pageIndex).node.Resources()?.lookup(PDFName.of('XObject'));
  if (!xobjects) return 0;
  let n = 0;
  for (const [, ref] of xobjects.entries()) {
    const obj = doc.context.lookup(ref);
    if (obj?.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') n += 1;
  }
  return n;
}

// Submitting for approval signs the Prepared By row; approving signs the
// Authorized By row. Parsed without a zone so the expected text is the same
// wherever the test runs.
const SUBMITTED_AT = new Date('2026-07-27T14:32:00');
const APPROVED_AT = new Date('2026-07-28T09:05:00');
const SIGNED_QD = {
  ...baseQd,
  prepared_by: 'Jaypee', approved_by_name: 'A. Reviewer',
  submitted_at: SUBMITTED_AT, approved_at: APPROVED_AT,
};
const BOTH_SIGNATURES = {
  prepared: { mimeType: 'image/png', bytes: PNG_1x1 },
  authorized: { mimeType: 'image/png', bytes: PNG_1x1 },
};
const noFiles = { files: [], billets: [], fileBytes: new Map() };

test('each signatory\'s signature is drawn in the Signature column', async () => {
  const bytes = await generateQdPdf(SIGNED_QD, { ...noFiles, signatures: BOTH_SIGNATURES });
  assert.equal(await imagesOnPage(bytes, 1), 2);
});

// A signature asserts that a named person signed. Without the name there is
// nothing for the mark to attach to, so it must not be drawn.
test('a signature is never drawn against an empty Name cell', async () => {
  const bytes = await generateQdPdf(
    { ...SIGNED_QD, approved_by_name: '' },
    { ...noFiles, signatures: BOTH_SIGNATURES },
  );
  assert.equal(await imagesOnPage(bytes, 1), 1);
});

test('a QD with no signatures on file renders the sign-off table blank', async () => {
  assert.equal(await imagesOnPage(await generateQdPdf(SIGNED_QD, noFiles), 1), 0);
  assert.equal(await imagesOnPage(await generateQdPdf(SIGNED_QD, { ...noFiles, signatures: {} }), 1), 0);
});

test('each sign-off is dated in the column beside the signature', async () => {
  const [, p2] = await textOf(await generateQdPdf(SIGNED_QD, { ...noFiles, signatures: BOTH_SIGNATURES }));
  assert.ok(p2.includes('Date & Time'), 'the date column is unlabelled');
  assert.ok(p2.includes('2026-07-27 14:32'), 'the submit date is missing');
  assert.ok(p2.includes('2026-07-28 09:05'), 'the approve date is missing');
});

// A Draft is nobody's finished work yet, and an unapproved QD has not been
// authorised — signing either would assert an act that never happened.
test('nothing is signed or dated until the act is recorded', async () => {
  const draft = { ...SIGNED_QD, submitted_at: null, approved_at: null };
  const bytes = await generateQdPdf(draft, { ...noFiles, signatures: BOTH_SIGNATURES });
  assert.equal(await imagesOnPage(bytes, 1), 0);
  const [, p2] = await textOf(bytes);
  assert.ok(!p2.includes('2026-07-27 14:32'));
});

test('approving signs only the Authorized By row when the QD was never submitted', async () => {
  const bytes = await generateQdPdf({ ...SIGNED_QD, submitted_at: null }, { ...noFiles, signatures: BOTH_SIGNATURES });
  assert.equal(await imagesOnPage(bytes, 1), 1);
});

// The QD recorded the act whether or not that person ever uploaded an image.
test('the date is stamped even when the signatory has no signature on file', async () => {
  const [, p2] = await textOf(await generateQdPdf(SIGNED_QD, noFiles));
  assert.ok(p2.includes('2026-07-27 14:32'));
});

test('an unreadable signature leaves the cell blank instead of failing the PDF', async () => {
  const bytes = await generateQdPdf(SIGNED_QD, {
    ...noFiles,
    signatures: { prepared: { mimeType: 'image/png', bytes: Buffer.from('not a png') } },
  });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  assert.equal(await imagesOnPage(bytes, 1), 0);
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

test('buildDelayLine renders each billet that has an answer', () => {
  assert.equal(
    buildDelayLine([
      { billet: 'first', any_delay_observed: 'No' },
      { billet: 'last', any_delay_observed: 'Yes', any_delay_details: 'press held 20 min for billet change' },
    ]),
    'Delay observed - 1st billet: No · Last billet: Yes - press held 20 min for billet change'
  );
});

test('buildDelayLine is empty when neither billet answered, so existing PDFs are unchanged', () => {
  assert.equal(buildDelayLine([]), '');
  assert.equal(buildDelayLine([{ billet: 'first', billet_temp: '502' }]), '');
  assert.equal(buildDelayLine([{ billet: 'first', any_delay_observed: '   ' }]), '');
});

test('buildDelayLine drops details under a No and tolerates legacy uppercase', () => {
  assert.equal(
    buildDelayLine([{ billet: 'first', any_delay_observed: 'NO', any_delay_details: 'stale note' }]),
    'Delay observed - 1st billet: NO'
  );
  assert.equal(
    buildDelayLine([{ billet: 'last', any_delay_observed: 'YES', any_delay_details: 'die change' }]),
    'Delay observed - Last billet: YES - die change'
  );
});

test('delayCellText stacks the answers for the template\'s narrow column', () => {
  assert.equal(
    delayCellText([
      { billet: 'first', any_delay_observed: 'No', any_delay_details: 'ignored under a No' },
      { billet: 'last', any_delay_observed: 'Yes', any_delay_details: '3 minutes delay in Billet 5' },
    ]),
    '1st: No\nLast: Yes - 3 minutes delay in Billet 5'
  );
  assert.equal(delayCellText([]), '');
});
