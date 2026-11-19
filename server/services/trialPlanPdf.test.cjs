'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateTrialPlanPdf, fit, wrap } = require('./trialPlanPdf.cjs');
const publishing = require('./trialPlanPublish.cjs');

// Reads back every text run pdf-lib wrote. Same helper supplierReportPdf.test.cjs uses.
async function textOf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(content.items.map((i) => i.str).join(' ').replace(/\s+/g, ' '));
  }
  return pages;
}

const entry = (over) => ({
  id: 1, position: 1, entry_type: 'Trial', urgent: false, die_no: '32140-401', press: 'PRESS 4',
  customer: 'Customer B', alloy: '6063', tooling: 'i-15781', corrector: 'erive', out_of_queue_reason: null, ...over,
});

const view = (entries, plan = { status: 'published', revision: 1, published_by: 5 }) => ({
  date: '2026-11-20', plant: 'GEX 1', plan, entries,
});

test('the schedule is a titled, referenced document with trials and supervised runs apart', async () => {
  const bytes = await generateTrialPlanPdf(view([
    entry({ id: 1, press: 'PRESS 6', die_no: '30755-601', urgent: true }),
    entry({ id: 2, press: 'PRESS 4' }),
    entry({ id: 3, press: 'PRESS 5', die_no: '06177-502', entry_type: 'Supervised', customer: 'Customer C' }),
  ], { status: 'published', revision: 2, published_at: new Date(2026, 10, 19, 15, 42) }), { publishedBy: 'A. Planner', generatedAt: new Date(2026, 10, 19, 16, 0) });
  const [page] = await textOf(bytes);
  assert.match(page, /DAILY DIE TRIAL SCHEDULE/);
  assert.match(page, /GEX 1 \| Trial date: Friday, 20 November 2026/);
  assert.match(page, /Reference TS-GEX1-20261120/);
  assert.match(page, /Revision 02/);
  assert.match(page, /Issued 19 Nov 2026, 15:42/);
  assert.match(page, /1 of 1/);
  assert.match(page, /DIE TRIALS 2/);
  assert.match(page, /SUPERVISED RUNS 1/);
  assert.match(page, /PUBLISHED BY A\. Planner/);
  assert.match(page, /2\. SUPERVISED RUNS - DAY SHIFT ONLY/);
  assert.match(page, /URGENT/);
  assert.match(page, /RESULT INITIALS/);
  assert.match(page, /4\. APPROVAL/);
  assert.match(page, /Name: A\. Planner/);
  // Trials by press, then the supervised section after them.
  assert.ok(page.indexOf('32140-401') < page.indexOf('30755-601'));
  assert.ok(page.indexOf('30755-601') < page.indexOf('06177-502'));
});

test('each press has its own band with its counts, and S/N runs on across presses', async () => {
  const [page] = await textOf(await generateTrialPlanPdf(view([
    entry({ id: 1, press: 'PRESS 4', die_no: '1-401', urgent: true }),
    entry({ id: 2, press: 'PRESS 4', die_no: '2-401' }),
    entry({ id: 3, press: 'PRESS 6', die_no: '3-401' }),
  ])));
  assert.match(page, /PRESS 4 2 dies \| 1 urgent 1 1-401 .* 2 2-401 .* PRESS 6 1 die 3 3-401/);
  // The press is the band, not a column.
  assert.doesNotMatch(page, /S\/N PRESS/);
});

test('a press that runs over a page break is named again as continued', async () => {
  const many = Array.from({ length: 40 }, (_, i) => entry({ id: i + 1, position: i + 1, press: 'PRESS 4', die_no: `4${String(i).padStart(4, '0')}-401` }));
  const pages = await textOf(await generateTrialPlanPdf(view(many)));
  assert.ok(pages.length >= 2);
  assert.match(pages[1], /PRESS 4 40 dies \| continued/);
});

test('a draft prints as a draft, never with a revision number', async () => {
  const [page] = await textOf(await generateTrialPlanPdf(view([entry()], { status: 'draft', revision: 0 })));
  assert.match(page, /Revision Draft/);
  assert.match(page, /Issued Not published/);
});

test('a die planned out of the queue carries its reason in Remarks', async () => {
  const [page] = await textOf(await generateTrialPlanPdf(view([
    entry({ out_of_queue_reason: 'Re-trial after correction' }),
  ])));
  assert.match(page, /Normal Re-trial after correction/);
});

test('a long plan runs onto more pages, each titled and numbered', async () => {
  const many = Array.from({ length: 60 }, (_, i) => entry({ id: i + 1, position: i + 1, die_no: `3${String(i).padStart(4, '0')}-401` }));
  const pages = await textOf(await generateTrialPlanPdf(view(many)));
  assert.ok(pages.length >= 2);
  assert.match(pages.at(-1), new RegExp(`Page ${pages.length} of ${pages.length}`));
  assert.match(pages[1], /DAILY DIE TRIAL SCHEDULE/);
  assert.match(pages[1], /1\. DIE TRIALS \(continued\)/);
  assert.match(pages[1], new RegExp(`2 of ${pages.length}`));
});

test('a long customer name wraps inside its cell', () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  return PDFDocument.create().then(d => d.embedFont(StandardFonts.Helvetica)).then((font) => {
    const lines = wrap('Al Jazeera Aluminium Profiles Manufacturing LLC and a much longer tail', font, 8.4, 120);
    assert.equal(lines.length, 2);
    assert.ok(lines.every(l => font.widthOfTextAtSize(l, 8.4) <= 120));
    assert.ok(lines[1].endsWith('...'));
  });
});

test('characters the PDF font cannot draw do not stop the schedule', async () => {
  const [page] = await textOf(await generateTrialPlanPdf(view([entry({ customer: 'Gulf → Extrusions — Co ✓' })])));
  assert.match(page, /Gulf/);
});

test('a value too wide for its column is cut with an ellipsis', async () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const out = fit('Gulf Extrusions Co .(L.L.C) and a much longer tail', font, 9, 80);
  assert.ok(out.endsWith('...'));
  assert.ok(font.widthOfTextAtSize(out, 9) <= 80);
});

// ── The email that goes out on publish ───────────────────────────────────

const fakeClient = (template) => ({
  query: async (sql) => {
    if (/FROM email_templates/.test(sql)) return { rows: template ? [template] : [] };
    throw new Error(`unexpected query ${sql}`);
  },
});
const TEMPLATE = {
  subject_template: 'Trial schedule {{plant}} - {{date}}',
  body_template: 'The trial schedule for {{plant}} on {{date}} is attached.',
  default_to: 'press@example.test', default_cc: '',
};

test('with no recipients the email is skipped and says where to set them', async () => {
  let sent = false;
  const out = await publishing.emailPlan(fakeClient({ ...TEMPLATE, default_to: ' ' }), view([entry()]), new Uint8Array([1]), {
    send: async () => { sent = true; },
  });
  assert.equal(out.status, 'skipped');
  assert.match(out.message, /"Trial Plan - GEX 1" in Settings/);
  assert.equal(sent, false);
});

test('the email goes to the plant list with the PDF attached', async () => {
  let mail;
  const out = await publishing.emailPlan(fakeClient(TEMPLATE), view([entry()]), new Uint8Array([37, 80]), {
    send: async (m) => { mail = m; },
  });
  assert.equal(out.status, 'sent');
  assert.equal(mail.to, 'press@example.test');
  assert.equal(mail.subject, 'Trial schedule GEX 1 - 2026-11-20');
  assert.equal(mail.attachments[0].filename, 'Trial-schedule-GEX-1-2026-11-20.pdf');
  assert.match(mail.body, /32140-401/);
  assert.match(mail.body, /Customer B/);
});

test('a re-published plan says it replaces the earlier schedule', async () => {
  let mail;
  await publishing.emailPlan(fakeClient(TEMPLATE), view([entry()], { status: 'published', revision: 2 }), new Uint8Array([1]), {
    send: async (m) => { mail = m; },
  });
  assert.match(mail.subject, /\(revision 2\)$/);
  assert.match(mail.body, /replaces the schedule sent earlier/);
});

test('a mail failure is reported, not thrown', async () => {
  const out = await publishing.emailPlan(fakeClient(TEMPLATE), view([entry()]), new Uint8Array([1]), {
    send: async () => { throw new Error('SMTP sending is not enabled'); },
  });
  assert.equal(out.status, 'failed');
  assert.match(out.message, /published but the email failed: SMTP sending is not enabled/);
});

test('names in the email body are escaped', () => {
  const body = publishing.emailBody(view([entry({ customer: '<b>Acme</b>' })]), 'Hi');
  assert.match(body, /&lt;b&gt;Acme/);
});

test('a carried-over die says where it came from and why in Remarks', async () => {
  const { carryNote } = require('./trialPlanPdf.cjs');
  assert.equal(carryNote({ carried_from_date: '2026-11-20', carry_reason: 'Alloy shortage' }), 'Carry over from 20th Nov because of Alloy shortage');
  assert.equal(carryNote({ carried_from_date: '2026-11-21', carry_reason: null }), 'Carry over from 21st Nov');
  assert.equal(carryNote({ carried_from_date: '2026-11-12' }), 'Carry over from 12th Nov');
  assert.equal(carryNote({}), '');
  const [page] = await textOf(await generateTrialPlanPdf(view([
    entry({ urgent: true, carried_from_date: '2026-11-20', carry_reason: 'Alloy shortage' }),
  ])));
  assert.match(page, /URGENT Carry over from 20th Nov because of Alloy shortage/);
});

test('the Issued time is the true publish instant passed in, not the raw column', async () => {
  const issued = new Date(2026, 10, 19, 21, 51);
  const [page] = await textOf(await generateTrialPlanPdf(view([entry()], { status: 'published', revision: 1, published_at: new Date(2026, 10, 19, 17, 51) }), { issuedAt: issued }));
  assert.match(page, /Issued 19 Nov 2026, 21:51/);
});
