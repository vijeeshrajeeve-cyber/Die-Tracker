'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { generateDailySummaryPdf } = require('./dailySummaryPdf.cjs');

const report = (over = {}) => ({
  reportDate: '2026-08-28',
  activity: [
    { key: 'requested', label: 'Die orders requested', count: 3 },
    { key: 'ordered', label: 'Die orders placed', count: 0 },
  ],
  activityTotal: 3,
  late: [],
  lateTotal: 0,
  pending: [
    { status: 'PENDING FOR PR', label: 'Pending PR', count: 2, oldestDays: 11 },
    { status: 'HOLD', label: 'On Hold', count: 0, oldestDays: null },
  ],
  unparseable: [],
  ...over,
});

const opts = { generatedAt: new Date('2026-08-29T06:00:00'), timeZone: 'Asia/Dubai' };

const manyLate = (n) => {
  const late = [];
  for (let i = 0; i < n; i++) {
    late.push({ dieNo: `D-${i}`, orderNo: `PO-${i}`, stageLabel: 'Designs received', stageDate: '2026-08-20' });
  }
  return late;
};

test('renders a non-empty PDF', async () => {
  const bytes = await generateDailySummaryPdf(report(), opts);
  assert.ok(bytes.length > 1000);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});

// StandardFonts are WinAnsi and throw on anything outside it. The labels really
// do carry an em dash, so this is the crash that would take out the 06:00 run.
test('survives characters outside WinAnsi', async () => {
  const bytes = await generateDailySummaryPdf(report({
    activity: [{ key: 'sample_new', label: 'Samples submitted — New ≤ 5 · ok', count: 1 }],
    late: [{ dieNo: 'D—1', orderNo: 'PO‑9', stageLabel: 'Designs received', stageDate: '2026-08-20' }],
    lateTotal: 1,
  }), opts);
  assert.ok(bytes.length > 1000);
});

test('a day with no activity still renders every section', async () => {
  const bytes = await generateDailySummaryPdf(report({
    activity: [{ key: 'requested', label: 'Die orders requested', count: 0 }],
    activityTotal: 0,
  }), opts);
  assert.ok(bytes.length > 1000);
});

test('a missing logo degrades to an unbranded PDF rather than throwing', async () => {
  const bytes = await generateDailySummaryPdf(report(), { ...opts, logoBytes: null });
  assert.ok(bytes.length > 1000);
});

test('a corrupt logo is ignored rather than throwing', async () => {
  const bytes = await generateDailySummaryPdf(report(), {
    ...opts, logoBytes: Buffer.from('not a png'),
  });
  assert.ok(bytes.length > 1000);
});

test('the unparseable-date footnote renders', async () => {
  const bytes = await generateDailySummaryPdf(report({
    unparseable: [{ label: 'PRs created', count: 3 }],
  }), opts);
  assert.ok(bytes.length > 1000);
});

test('a long late list flows onto further pages', async () => {
  const bytes = await generateDailySummaryPdf(
    report({ late: manyLate(40), lateTotal: 40 }), opts);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, 'forty late rows do not fit on one page');
});

// pdf-lib cannot read text back, so assert on where the generator says it drew
// the block rather than on the rendered glyphs.
test('the sign-off block is on the last page, not page one', async () => {
  const bytes = await generateDailySummaryPdf(
    report({ late: manyLate(40), lateTotal: 40 }), opts);
  const doc = await PDFDocument.load(bytes);
  assert.equal(generateDailySummaryPdf.lastSignOffPageIndex, doc.getPageCount() - 1,
    'sign-off must land on the last page');
  assert.notEqual(generateDailySummaryPdf.lastSignOffPageIndex, 0,
    'a multi-page report must not sign off on page one');
});

test('a short report signs off on its only page', async () => {
  await generateDailySummaryPdf(report(), opts);
  assert.equal(generateDailySummaryPdf.lastSignOffPageIndex, 0);
});
