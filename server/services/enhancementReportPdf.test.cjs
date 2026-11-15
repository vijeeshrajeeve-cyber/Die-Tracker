'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarise } = require('./enhancementSummary.cjs');
const { generateEnhancementReportPdf } = require('./enhancementReportPdf.cjs');

// Reads back every text run the PDF holds, one string per page.
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

const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const row = (o) => ({
  die_order_id: 1, die_no: '29663-253', supplier: 'Alpha', status: 'In Manufacturing', sample_status: null,
  current_issue: 'Weld lines', created_at: '2026-02-10T08:00:00', failure_assessment_required: false,
  baseline_productivity_kgh: '100', baseline_recovery_pct: '70', baseline_failure_pct: '10',
  target_productivity_kgh: '120', target_recovery_pct: '75', target_failure_pct: null,
  trial_productivity_kgh: null, trial_recovery_pct: null, trial_verdict: null,
  actual_failure_pct: null, final_verdict: null, final_verdict_date: null, ...o,
});

test('an empty period renders a PDF that says so and holds no tables', async () => {
  const bytes = await generateEnhancementReportPdf(summarise([], YEAR), YEAR);
  assert.equal(Buffer.isBuffer(bytes), true);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  const pages = await textOf(bytes);
  assert.match(pages.join(' '), /No enhancement projects in this period/);
  assert.doesNotMatch(pages.join(' '), /COMPLETED IN PERIOD/);
});

test('a period with data prints the figures, the three groups and "not recorded" for blanks', async () => {
  const rows = [
    row({ die_order_id: 1, trial_productivity_kgh: '130', trial_verdict: 'Achieved', final_verdict: 'Achieved', final_verdict_date: '2026-03-15' }),
    row({ die_order_id: 2, die_no: '090001-801', created_at: '2026-04-02T08:00:00' }),
  ];
  const pages = (await textOf(await generateEnhancementReportPdf(summarise(rows, YEAR), YEAR))).join(' ');
  for (const need of ['ENHANCEMENT REPORT', 'PROJECTS STARTED', 'SUCCESS RATE', 'PROJECTS BY MONTH',
    'COMPLETED IN PERIOD (1)', 'STARTED IN PERIOD (2)', 'OPEN AT END OF PERIOD (1)', '29663-253', '29663', '090001']) {
    assert.ok(pages.includes(need), need);
  }
  assert.match(pages, /not recorded/);
  assert.doesNotMatch(pages, /No enhancement projects in this period/);
});

test('user text outside the PDF font range does not crash the generator', async () => {
  const rows = [row({ current_issue: 'Die “chatter” → ≥ 5 ✓ 圧力 ' + 'long '.repeat(80) })];
  const bytes = await generateEnhancementReportPdf(summarise(rows, YEAR), YEAR);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
});

test('a long list of projects continues on further pages', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => row({ die_order_id: i + 1, die_no: `1000${i}-253` }));
  const pages = await textOf(await generateEnhancementReportPdf(summarise(rows, YEAR), YEAR));
  assert.ok(pages.length > 2);
  assert.match(pages.join(' '), /continued/);
  assert.match(pages[pages.length - 1], new RegExp(`Page ${pages.length} of ${pages.length}`));
});

test('a multi-year period draws without error', async () => {
  const range = { from: '2020-01-01', to: '2026-12-31' };
  const rows = [row({ created_at: '2021-06-01T08:00:00' })];
  const bytes = await generateEnhancementReportPdf(summarise(rows, range), range);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
});
