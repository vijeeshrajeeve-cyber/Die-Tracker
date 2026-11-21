'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateSampleApprovalPdf } = require('./sampleApprovalReportPdf.cjs');

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

const NOTE = 'Rejections are counted where the status change was recorded in the app.';

const wrow = (over = {}) => ({
  die: '32140-401', plant: 'GEX 1', press: 'PRESS 4', submittedDate: '2026-11-01',
  daysWaiting: 5, overdue: false, trialCount: 2, legacyTrialCount: null,
  corrector: 'erive', remark: 'Waiting for customer feedback', ...over,
});

const group = (customer, rows) => {
  const known = rows.map((r) => r.daysWaiting).filter((d) => d !== null);
  return {
    customer, count: rows.length, overdue: rows.filter((r) => r.overdue).length,
    oldestDays: known.length ? Math.max(...known) : null, rows,
  };
};

const report = (over = {}) => ({
  reportDate: '2026-12-01', month: '2026-11', monthLabel: 'November 2026', targetDays: 14,
  header: { waiting: 3, overdue: 1, approved: 2, avgDays: 6.5 },
  waiting: [group('ABC Ltd', [wrow({ die: 'A-1', daysWaiting: 21, overdue: true }), wrow({ die: 'A-2' })])],
  lastMonth: {
    rows: [{ customer: 'ABC Ltd', approved: 2, rejected: 1, avgDays: 6.5 }],
    total: { approved: 2, rejected: 1, avgDays: 6.5 },
  },
  footnotes: { excludedFromAverage: 0, rejectionsNote: NOTE },
  ...over,
});

const opts = { generatedAt: new Date(2026, 11, 1, 8, 0) };

test('titled with month and target', async () => {
  const [page] = await textOf(await generateSampleApprovalPdf(report(), opts));
  assert.match(page, /SAMPLE APPROVAL FOLLOWUP/);
  assert.match(page, /Report month November 2026/);
  assert.match(page, /Issued 01 Dec 2026, 08:00/);
  assert.match(page, /Target 14 days/);
  assert.match(page, /1 of 1/);
  assert.match(page, /Waiting now 3 - Overdue 1 - Approved in November 2 - Avg days to approval 6\.5/);
});

test('waiting section says it is as of the issue date', async () => {
  const [page] = await textOf(await generateSampleApprovalPdf(report(), opts));
  assert.match(page, /WAITING FOR APPROVAL - as of 1 Dec 2026/);
});

test('customer band and overdue', async () => {
  const [page] = await textOf(await generateSampleApprovalPdf(report(), opts));
  assert.match(page, /ABC Ltd 2 waiting, 1 overdue - oldest 21 d/);
  assert.match(page, /21 OVERDUE/);
  assert.match(page, /Die # Plant Press Submitted Days Trials Corrector Last remark/);
});

test('unknown waits show a dash, never a zero', async () => {
  const r = report({ waiting: [group('No customer', [wrow({ die: 'Z-9', daysWaiting: null })])] });
  const [page] = await textOf(await generateSampleApprovalPdf(r, opts));
  assert.match(page, /No customer 1 waiting, 0 overdue - oldest - d?/);
  assert.ok(!/oldest 0/.test(page));
});

test('last month table with total and null average', async () => {
  const [page] = await textOf(await generateSampleApprovalPdf(report(), opts));
  assert.match(page, /LAST MONTH - November 2026/);
  assert.match(page, /Customer Approved Rejected Avg days to approval/);
  assert.match(page, /Total 2 1 6\.5/);
  const none = report({
    header: { waiting: 0, overdue: 0, approved: 0, avgDays: null },
    lastMonth: {
      rows: [{ customer: 'ABC Ltd', approved: 0, rejected: 0, avgDays: null }],
      total: { approved: 0, rejected: 0, avgDays: null },
    },
  });
  const [p2] = await textOf(await generateSampleApprovalPdf(none, opts));
  assert.match(p2, /Total 0 0 -/);
  assert.match(p2, /Avg days to approval -/);
});

test('footnotes', async () => {
  const [a] = await textOf(await generateSampleApprovalPdf(report(), opts));
  assert.ok(a.includes(NOTE));
  assert.ok(!/no usable submission date/.test(a));
  const [b] = await textOf(await generateSampleApprovalPdf(
    report({ footnotes: { excludedFromAverage: 2, rejectionsNote: NOTE } }), opts));
  assert.ok(b.includes(NOTE));
  assert.match(b, /2 approval\(s\) had no usable submission date and are not in the averages\./);
});

test('empty report', async () => {
  const pages = await textOf(await generateSampleApprovalPdf(report({
    header: { waiting: 0, overdue: 0, approved: 0, avgDays: null },
    waiting: [], lastMonth: { rows: [], total: { approved: 0, rejected: 0, avgDays: null } },
  }), opts));
  assert.equal(pages.length, 1);
  assert.match(pages[0], /No samples are waiting for approval\./);
  assert.match(pages[0], /No approvals or rejections in November 2026\./);
});

test('many waiting rows paginate with repeated headers and no empty page', async () => {
  const mk = (name, n) => group(name, Array.from({ length: n }, (_, i) =>
    wrow({ die: `${name[0]}-${String(i).padStart(3, '0')}`, daysWaiting: 30 - i, overdue: true })));
  const r = report({ waiting: [mk('Alpha', 25), mk('Beta', 25), mk('Gamma', 20)] });
  const pages = await textOf(await generateSampleApprovalPdf(r, opts));
  assert.ok(pages.length >= 2);
  for (const p of pages) assert.match(p, /Die #|Customer/);
  assert.ok(pages.at(-1).length > 300);
  assert.match(pages.at(-1), new RegExp(`${pages.length} of ${pages.length}`));
  assert.match(pages.at(-1), /LAST MONTH/);
});

test('the Last month table, Total and notes stay together, never a lone footnote page', async () => {
  // Sweep the amount of waiting content so the page break lands in every position near the foot.
  for (let n = 10; n <= 40; n++) {
    const rows = Array.from({ length: n }, (_, i) => wrow({ die: `Q-${i}`, daysWaiting: 20 - (i % 10) }));
    const r = report({
      waiting: [group('ABC Ltd', rows)],
      lastMonth: {
        rows: [{ customer: 'ABC Ltd', approved: 2, rejected: 1, avgDays: 6.5 }, { customer: 'XYZ Co', approved: 1, rejected: 0, avgDays: 3 }],
        total: { approved: 3, rejected: 1, avgDays: 5 },
      },
    });
    const pages = await textOf(await generateSampleApprovalPdf(r, opts));
    const last = pages.at(-1);
    assert.ok(last.includes(NOTE), `n=${n}: notes on the last page`);
    assert.match(last, /Total 3 1 5\.0/, `n=${n}: Total on the last page`);
    assert.match(last, /XYZ Co 1 0 3\.0/, `n=${n}: last data row beside Total`);
  }
});
