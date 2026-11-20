'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateSampleStatusPdf } = require('./sampleStatusReportPdf.cjs');

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

const row = (over = {}) => ({
  die: '32140-401', customer: 'Customer B', dieType: 'Solid', supplier: 'Supplier X',
  receivedDate: '2026-11-10', status: 'Pending', days: 3, late: false, rejectedWait: null,
  submittedToday: false, lastTrialDate: '2026-11-18', daysSinceTrial: 2, trialCount: 1,
  legacyTrialCount: 0, corrector: 'erive', latest: 'Not OK - shape', ...over,
});

const counts = (over = {}) => ({ inTrial: 0, late: 0, submittedToday: 0, trialsToday: 0, trialsOk: 0, trialsNotOk: 0, ...over });

const report = (rows, plant = 'GEX 1') => ({
  reportDate: '2026-11-20', plantFilter: 'All',
  totals: counts({ inTrial: rows.length }),
  plants: [{
    plant,
    counts: counts({ inTrial: 2, late: 1, submittedToday: 1, trialsToday: 1, trialsNotOk: 1 }),
    presses: [{ press: 'PRESS 4', rows }],
  }],
});

const opts = { generatedAt: new Date(2026, 10, 20, 18, 0) };

test('titled and dated', async () => {
  const [page] = await textOf(await generateSampleStatusPdf(report([row()]), opts));
  assert.match(page, /SAMPLE STATUS/);
  assert.match(page, /Report date Friday, 20 November 2026/);
  assert.match(page, /Issued 20 Nov 2026, 18:00/);
  assert.match(page, /1 of 1/);
});

test('summary per plant', async () => {
  const [page] = await textOf(await generateSampleStatusPdf(report([row()]), opts));
  assert.match(page, /GEX 1 In trial 2 - Late 1 - Submitted today 1 - Trials today 1 \(0 OK \/ 1 Not OK\)/);
});

test('rows show late, rejected and submitted today', async () => {
  const [page] = await textOf(await generateSampleStatusPdf(report([
    row({ die: 'A-1', days: 9, late: true }),
    row({ die: 'B-2', status: 'Rejected', days: 12, rejectedWait: 12 }),
    row({ die: 'C-3', submittedToday: true, latest: 'Submitted today', lastTrialDate: null, daysSinceTrial: null }),
  ]), opts));
  assert.match(page, /9 LATE/);
  assert.match(page, /Rejected - 12 d/);
  assert.match(page, /Submitted today/);
  assert.match(page, /18 Nov \(2 d ago\)/);
});

test('long or undrawable comments are cut and do not break rendering', async () => {
  const tail = 'ZZTAILZZ';
  const latest = `Not OK \u2192 ${'long comment \uD83D\uDE00 '.repeat(40)}${tail}`;
  const [page] = await textOf(await generateSampleStatusPdf(report([row({ latest })]), opts));
  assert.match(page, /Not OK/);
  assert.ok(!page.includes(tail));
});

test('many rows paginate with repeated headers and no empty page', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => row({ die: `D-${String(i).padStart(3, '0')}` }));
  const pages = await textOf(await generateSampleStatusPdf(report(rows), opts));
  assert.ok(pages.length >= 2);
  for (const p of pages) assert.match(p, /Die #/);
  assert.match(pages.at(-1), /D-0\d\d/);
  assert.match(pages.at(-1), new RegExp(`${pages.length} of ${pages.length}`));
});

test('empty report', async () => {
  const pages = await textOf(await generateSampleStatusPdf(
    { reportDate: '2026-11-20', plantFilter: 'All', totals: counts(), plants: [] }, opts));
  assert.equal(pages.length, 1);
  assert.match(pages[0], /No dies in trial\./);
});
