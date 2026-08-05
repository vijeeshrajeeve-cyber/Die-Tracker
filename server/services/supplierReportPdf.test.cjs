'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateSupplierReportPdf } = require('./supplierReportPdf.cjs');

// Reads back every text run pdf-lib wrote, so a test can assert what the
// document actually says. Same helper qdPdf.test.cjs uses.
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

const metrics = [
  { key: 'ordersPlaced', label: 'Orders Placed', unit: '', scored: false, decimals: 0 },
  { key: 'dieLife', label: 'Avg Die Life', unit: 'MT', scored: true, lowerBetter: false, ten: 77, zero: 20, target: 77, weight: 0.25, decimals: 1 },
  { key: 'dieFailure', label: 'Die Failure Rate', unit: '%', scored: true, lowerBetter: true, ten: 19, zero: 40, target: 19, weight: 0.20, decimals: 1 },
  { key: 'deliveryLeadTime', label: 'Avg Delivery Lead Time', unit: 'days', scored: true, lowerBetter: true, ten: 30, zero: 55, target: 30, weight: 0.20, decimals: 0 },
];

const baseReport = {
  supplier: 'PDTMC',
  period: { from: '2026-08-01', to: '2026-08-31', frequency: 'Monthly', year: 2026, month: 'Aug' },
  metrics,
  snapshot: { ordersPlaced: 12, dieLife: 64.4, dieFailure: 12.5, deliveryLeadTime: 27 },
  scores: { dieLife: 7.8, dieFailure: 10, deliveryLeadTime: 10 },
  trend: [
    { month: 'Jun', dieLife: 60, dieFailure: 15, deliveryLeadTime: 30, ordersPlaced: 4 },
    { month: 'Jul', dieLife: 70, dieFailure: 10, deliveryLeadTime: 28, ordersPlaced: 5 },
    { month: 'Aug', dieLife: 64.4, dieFailure: 12.5, deliveryLeadTime: 27, ordersPlaced: 3 },
  ],
  rating: { score: 8.9, contributing: 3, band: { label: 'Exceptional', color: '#16A34A', bg: '#F0FDF4' } },
  previous: {
    label: 'Jul 2026',
    snapshot: { ordersPlaced: 9, dieLife: 58.2, dieFailure: 17.0, deliveryLeadTime: 31 },
  },
  dieLifeRows: [
    { month: 6, avgDieLifeMt: 60, diesInService: 10, diesFailed: 2 },
    { month: 7, avgDieLifeMt: 70, diesInService: 20, diesFailed: 2 },
  ],
};

test('generateSupplierReportPdf returns a non-empty PDF', async () => {
  const bytes = await generateSupplierReportPdf(baseReport, {});
  assert.ok(bytes.length > 1000);
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), '%PDF');
});

test('page 1 names the supplier, the period and the rating', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  assert.match(pages[0], /PDTMC/);
  assert.match(pages[0], /Aug 2026/);
  assert.match(pages[0], /8\.9/);
  assert.match(pages[0], /Exceptional/);
});

test('page 1 prints the target each metric was judged against', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  // The document must be self-documenting: a supplier reading it next year has
  // to see the thresholds that applied, not have to trust them.
  assert.match(pages[0], /Avg Die Life/);
  assert.match(pages[0], /77/);
});

test('a metric with no data prints "Not recorded" rather than 0', async () => {
  const report = { ...baseReport, snapshot: { ...baseReport.snapshot, dieLife: null }, scores: { ...baseReport.scores, dieLife: null } };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.match(pages[0], /Not recorded/);
});

test('every page carries a footer naming the supplier and its page number', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  for (let i = 0; i < pages.length; i++) {
    assert.match(pages[i], new RegExp(`Page ${i + 1} of ${pages.length}`), `page ${i + 1} has no footer`);
  }
});

test('the document survives a supplier with no rating at all', async () => {
  const report = { ...baseReport, rating: null, snapshot: { ordersPlaced: 0 }, scores: {}, dieLifeRows: [], trend: [] };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.match(pages[0], /Not enough data/);
});

test('the matrix page lists each month with its counts', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  const matrix = pages.find((p) => /Dies In Service/.test(p));
  assert.ok(matrix, 'no matrix section found');
  assert.match(matrix, /Jun/);
  assert.match(matrix, /Jul/);
});

test('the matrix total is weighted, agreeing with the score on page 1', async () => {
  // 10 dies at 60 MT and 20 at 70 MT weights to 66.7, not the simple mean 65.
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  const matrix = pages.find((p) => /Dies In Service/.test(p));
  assert.match(matrix, /66\.7/);
});

test('no matrix section when nothing was ever entered', async () => {
  const report = { ...baseReport, dieLifeRows: [] };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.ok(!pages.some((p) => /Dies In Service/.test(p)), 'an empty table is worse than no table');
});

test('a metric with no trend data produces no chart', async () => {
  const report = { ...baseReport, trend: [{ month: 'Aug', dieLife: null, dieFailure: null, deliveryLeadTime: null, ordersPlaced: 0 }] };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.ok(!pages.some((p) => /Not enough data/.test(p)),
    'the browser export wasted a page on five of these');
});

test('comments are printed over the name of whoever generated the report', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {
    comments: 'Delivery has improved. Please hold the trial ratio below 1.5 next quarter.',
    preparedBy: 'Vijeesh',
  }));
  const joined = pages.join(' ');
  assert.match(joined, /Comments/i);
  assert.match(joined, /hold the trial ratio/);
  assert.match(joined, /Vijeesh/);
});

test('no comments section when none were written', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  assert.ok(!/Comments & Action Points/i.test(pages.join(' ')));
});

test('long comments wrap instead of running off the page', async () => {
  const long = 'The delivery lead time is the priority for the coming quarter and we expect it held under thirty days. '.repeat(8);
  const bytes = await generateSupplierReportPdf(baseReport, { comments: long, preparedBy: 'Vijeesh' });
  const pages = await textOf(bytes);
  assert.match(pages.join(' '), /priority for the coming quarter/);
});

test('a character outside WinAnsi does not crash the generator', async () => {
  // StandardFonts throw on unencodable characters. A supplier name or a comment
  // pasted from Word will contain them sooner or later.
  const report = { ...baseReport, supplier: 'PDTMC — 中文' };
  const bytes = await generateSupplierReportPdf(report, { comments: 'Target ≤ 30 days · confirmed' });
  assert.ok(bytes.length > 1000);
});

test('an unrecorded month is absent from the trend line, not plotted as zero', async () => {
  // Number(null) is 0 and 0 is finite, so a Number.isFinite-only filter turns
  // every blank month into a point on the floor -- telling a supplier their die
  // life was 0 MT before anyone started recording it.
  const { trendable } = require('./supplierReportPdf.cjs');
  const report = {
    metrics,
    trend: [
      { month: 'Jan', dieLife: null, dieFailure: null, deliveryLeadTime: 28 },
      { month: 'Feb', dieLife: null, dieFailure: null, deliveryLeadTime: 26 },
      { month: 'Mar', dieLife: 60, dieFailure: 12, deliveryLeadTime: 27 },
      { month: 'Apr', dieLife: 70, dieFailure: 14, deliveryLeadTime: 25 },
    ],
  };
  const charts = trendable(report);
  const dieLife = charts.find((c) => c.metric.key === 'dieLife');
  assert.equal(dieLife.points.length, 2, 'only the two recorded months may be plotted');
  assert.deepEqual(dieLife.points.map((p) => p.month), ['Mar', 'Apr']);
  assert.ok(!dieLife.points.some((p) => p.value === 0), 'no blank month became a zero');
});

test('a metric with fewer than two recorded months gets no chart at all', async () => {
  const { trendable } = require('./supplierReportPdf.cjs');
  const report = {
    metrics,
    trend: [
      { month: 'Jan', dieLife: null, deliveryLeadTime: 28 },
      { month: 'Feb', dieLife: 65, deliveryLeadTime: 26 },
    ],
  };
  const charts = trendable(report);
  assert.ok(!charts.some((c) => c.metric.key === 'dieLife'), 'one point is not a trend');
  assert.ok(charts.some((c) => c.metric.key === 'deliveryLeadTime'));
});

test('each card reports movement against the supplier own previous period', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  // Die life rose 64.4 from 58.2 -- an improvement of 6.2, and the label must
  // name the period compared against so the figure is checkable.
  assert.match(pages[0], /6\.2/);
  assert.match(pages[0], /Jul 2026/);
  assert.match(pages[0], /better/);
});

test('a worse metric is reported as worse, not hidden', async () => {
  // Delivery went 31 -> 27 days, which is better; flip it so it worsens.
  const report = { ...baseReport, snapshot: { ...baseReport.snapshot, deliveryLeadTime: 38 } };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.match(pages[0], /worse/);
});

test('no movement line when the previous period has no figure', async () => {
  const report = { ...baseReport, previous: { label: 'Jul 2026', snapshot: {} } };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.ok(!/better than|worse than/.test(pages[0]), 'nothing to compare means no claim');
});

test('the document explains how the score is calculated', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  assert.match(pages[0], /HOW THE SCORE IS CALCULATED/i);
  assert.match(pages[0], /renormalised|excluded/i);
});

test('the scorecard carries two sign-off lines', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  assert.match(pages[0], /Prepared by/i);
  assert.match(pages[0], /Gulf Extrusion/);
  assert.match(pages[0], /Supplier acknowledgement/i);
});

test('the footer marks the document confidential on every page', async () => {
  const pages = await textOf(await generateSupplierReportPdf(baseReport, {}));
  for (const page of pages) assert.match(page, /CONFIDENTIAL/);
});

test('an unscored metric gets no movement claim', async () => {
  // Order volume is labelled "not scored"; saying it got better contradicts
  // that on the same card.
  const report = {
    ...baseReport,
    snapshot: { ...baseReport.snapshot, ordersPlaced: 252 },
    previous: { label: 'Jan-Dec 2025', snapshot: { ordersPlaced: 0, dieLife: 58.2 } },
  };
  const pages = await textOf(await generateSupplierReportPdf(report, {}));
  assert.ok(!/252 better than/.test(pages[0]), 'order volume must not be judged');
  assert.match(pages[0], /better than Jan-Dec 2025/, 'scored metrics still compare');
});
