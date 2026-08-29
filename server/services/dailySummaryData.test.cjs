'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const data = require('./dailySummaryData.cjs');

// ── parseStageDate ──────────────────────────────────────────────────────────

test('parseStageDate accepts ISO dates', () => {
  assert.equal(data.parseStageDate('2026-08-28'), '2026-08-28');
});

test('parseStageDate accepts an ISO timestamp, keeping the date half', () => {
  assert.equal(data.parseStageDate('2026-08-28T00:00:00.000Z'), '2026-08-28');
});

test('parseStageDate accepts DD/MM/YYYY and DD-MM-YYYY, zero-padding', () => {
  assert.equal(data.parseStageDate('28/08/2026'), '2026-08-28');
  assert.equal(data.parseStageDate('5/8/2026'), '2026-08-05');
  assert.equal(data.parseStageDate('28-08-2026'), '2026-08-28');
});

test('parseStageDate accepts a Date object, since DATE columns come back as one', () => {
  assert.equal(data.parseStageDate(new Date(2026, 7, 28)), '2026-08-28');
});

// pr_entry and oracle_entry are free text (saved through sanitizeString, not
// sanitizeDate) so they really do contain things like this.
test('parseStageDate rejects free text and empties rather than guessing', () => {
  for (const junk of ['done', 'YES', '', '   ', null, undefined, 'N/A', '2026-13-45']) {
    assert.equal(data.parseStageDate(junk), null, `expected null for ${JSON.stringify(junk)}`);
  }
});

// ── STAGES ──────────────────────────────────────────────────────────────────

test('STAGES covers the eleven reported stages, in report order', () => {
  assert.deepEqual(data.STAGES.map(s => s.key), [
    'requested', 'ordered', 'design_received', 'design_approved',
    'pr_created', 'oracle_entry', 'design_to_ems', 'die_received',
    'sample_new', 'sample_backup', 'sample_other',
  ]);
});

test('every stage names a real die_orders column and carries a label', () => {
  for (const s of data.STAGES) {
    assert.ok(s.column, `${s.key} has no column`);
    assert.ok(s.label, `${s.key} has no label`);
    assert.equal(typeof s.match, 'function', `${s.key} has no match predicate`);
  }
});

test('the sample stages split on type, and other-type catches the rest', () => {
  const byKey = Object.fromEntries(data.STAGES.map(s => [s.key, s]));
  assert.equal(byKey.sample_new.match({ type: 'N' }), true);
  assert.equal(byKey.sample_new.match({ type: 'B' }), false);
  assert.equal(byKey.sample_backup.match({ type: 'B' }), true);
  for (const type of ['T', 'C', 'H', '', null, undefined]) {
    assert.equal(byKey.sample_other.match({ type }), true,
      `type ${JSON.stringify(type)} must land in other, not vanish`);
  }
  assert.equal(byKey.sample_other.match({ type: 'N' }), false);
});

test('only sample_other is optional; every other row renders even at zero', () => {
  const optional = data.STAGES.filter(s => s.optional).map(s => s.key);
  assert.deepEqual(optional, ['sample_other']);
});

// ── stageDateOf ─────────────────────────────────────────────────────────────

test('stageDateOf reads the stage column and applies the match predicate', () => {
  const byKey = Object.fromEntries(data.STAGES.map(s => [s.key, s]));
  const row = { submission_date: '2026-08-28', type: 'N' };
  assert.equal(data.stageDateOf(row, byKey.sample_new), '2026-08-28');
  assert.equal(data.stageDateOf(row, byKey.sample_backup), null,
    'a New submission must not also count as Backup');
});

test('stageDateOf returns null for an unparseable value', () => {
  const pr = data.STAGES.find(s => s.key === 'pr_created');
  assert.equal(data.stageDateOf({ pr_entry: 'done' }, pr), null);
});

// ── buildActivity ───────────────────────────────────────────────────────────

const order = (over = {}) => ({
  id: 1, die_no: 'D-100', order_no: 'PO-1', type: 'N', status: 'DONE',
  created_at: new Date('2026-01-01'), die_requested_date: null, ordered_date: null,
  design_received_date: null, three_d_model_received_date: null,
  design_approved_date: null, pr_entry: null, oracle_entry: null,
  design_to_ems_date: null, die_received_date: null, submission_date: null,
  ...over,
});

const countOf = (result, key) => result.activity.find(a => a.key === key)?.count;

test('a stage dated on the report date is counted', () => {
  const r = data.buildActivity({
    rows: [order({ id: 1, design_received_date: '2026-08-28' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 1);
  assert.equal(r.activityTotal, 1);
});

test('a stage dated on another day is not counted', () => {
  const r = data.buildActivity({
    rows: [order({ design_received_date: '2026-08-27' })],
    reported: new Set(['1:design_received']), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 0);
  assert.equal(r.late.length, 0);
});

test('one order can contribute to several stages on the same day', () => {
  const r = data.buildActivity({
    rows: [order({ ordered_date: '2026-08-28', design_received_date: '2026-08-28' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'ordered'), 1);
  assert.equal(countOf(r, 'design_received'), 1);
  assert.equal(r.activityTotal, 2);
});

test('samples split New from Backup, and neither claims the other', () => {
  const r = data.buildActivity({
    rows: [
      order({ id: 1, type: 'N', submission_date: '2026-08-28' }),
      order({ id: 2, type: 'B', submission_date: '2026-08-28' }),
      order({ id: 3, type: 'B', submission_date: '2026-08-28' }),
    ],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'sample_new'), 1);
  assert.equal(countOf(r, 'sample_backup'), 2);
});

test('every non-optional stage renders at zero; sample_other only when non-zero', () => {
  const quiet = data.buildActivity({ rows: [], reported: new Set(), reportDate: '2026-08-28' });
  assert.equal(quiet.activity.length, data.STAGES.length - 1, 'sample_other is hidden at zero');
  assert.ok(quiet.activity.every(a => a.count === 0));

  const withOther = data.buildActivity({
    rows: [order({ type: 'T', submission_date: '2026-08-28' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(withOther, 'sample_other'), 1);
});

test('an unreported earlier stage is listed as recorded late, not counted', () => {
  const r = data.buildActivity({
    rows: [order({ die_no: 'D-777', design_received_date: '2026-08-25' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 0, 'a late entry must not inflate the headline');
  assert.equal(r.lateTotal, 1);
  assert.deepEqual(r.late[0], {
    dieNo: 'D-777', orderNo: 'PO-1', stageLabel: 'Designs received', stageDate: '2026-08-25',
  });
});

test('re-running the same day gives the same counts, not zeros', () => {
  // The ledger stops a stage being reported twice as LATE. It must not gag the
  // headline count, or the second run of a day would claim nothing happened.
  const r = data.buildActivity({
    rows: [order({ id: 9, design_received_date: '2026-08-28' })],
    reported: new Set(['9:design_received']), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 1);
});

test('a stage counted on its own day never resurfaces as late', () => {
  const rows = [order({ id: 9, design_received_date: '2026-08-28' })];
  const first = data.buildActivity({ rows, reported: new Set(), reportDate: '2026-08-28' });
  const ledger = new Set(first.commits.map(c => `${c.orderId}:${c.stage}`));
  const next = data.buildActivity({ rows, reported: ledger, reportDate: '2026-08-29' });
  assert.equal(next.lateTotal, 0, "yesterday's report already carried it");
});

test('an earlier stage already in the ledger is silent', () => {
  const r = data.buildActivity({
    rows: [order({ id: 42, design_received_date: '2026-08-25' })],
    reported: new Set(['42:design_received']), reportDate: '2026-08-28',
  });
  assert.equal(r.lateTotal, 0);
});

test('a stage dated in the future is neither counted nor called late', () => {
  const r = data.buildActivity({
    rows: [order({ design_received_date: '2026-09-30' })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'design_received'), 0);
  assert.equal(r.lateTotal, 0);
  assert.equal(r.commits.length, 0, 'a future date must not be marked reported');
});

test('the late list is capped for display but counted in full', () => {
  const rows = [];
  for (let i = 1; i <= data.LATE_LIST_LIMIT + 5; i++) {
    rows.push(order({ id: i, die_no: `D-${i}`, design_received_date: '2026-08-20' }));
  }
  const r = data.buildActivity({ rows, reported: new Set(), reportDate: '2026-08-28' });
  assert.equal(r.late.length, data.LATE_LIST_LIMIT);
  assert.equal(r.lateTotal, data.LATE_LIST_LIMIT + 5);
  assert.equal(r.commits.length, data.LATE_LIST_LIMIT + 5,
    'every late stage is ledgered, including the ones not listed');
});

test('commits cover both the counted and the late stages', () => {
  const r = data.buildActivity({
    rows: [
      order({ id: 1, design_received_date: '2026-08-28' }),
      order({ id: 2, ordered_date: '2026-08-20' }),
    ],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.deepEqual(r.commits.sort((a, b) => a.orderId - b.orderId), [
    { orderId: 1, stage: 'design_received', stageDate: '2026-08-28' },
    { orderId: 2, stage: 'ordered', stageDate: '2026-08-20' },
  ]);
});

test('unreadable free-text dates are reported as a footnote, not dropped in silence', () => {
  const r = data.buildActivity({
    rows: [
      order({ id: 1, pr_entry: 'done' }),
      order({ id: 2, pr_entry: 'YES' }),
      order({ id: 3, pr_entry: '2026-08-28' }),
      order({ id: 4, oracle_entry: 'n/a' }),
    ],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.equal(countOf(r, 'pr_created'), 1);
  assert.deepEqual(r.unparseable, [
    { label: 'PRs created', count: 2 },
    { label: 'Oracle entries done', count: 1 },
  ]);
});

test('an empty free-text column is not an unreadable value', () => {
  const r = data.buildActivity({
    rows: [order({ pr_entry: '' }), order({ id: 2, pr_entry: null })],
    reported: new Set(), reportDate: '2026-08-28',
  });
  assert.deepEqual(r.unparseable, []);
});

// ── buildPending ────────────────────────────────────────────────────────────

const pendingFor = (result, status) => result.find(p => p.status === status);

test('pending covers every pipeline status, in flow order, and excludes CANCELLED', () => {
  const p = data.buildPending([], '2026-08-29');
  assert.deepEqual(p.map(x => x.status), [
    'PENDING FOR ORDERING', 'AWAITING FOR DESIGN', 'UNDER SIMULATION',
    'PENDING FOR DESIGN APPROVAL', 'PENDING FOR PR', 'PENDING FOR ORACLE ENTRY',
    'PENDING FOR DESIGN TO EMS', 'DONE', 'DIE RECEIVED', 'HOLD',
  ]);
  assert.equal(pendingFor(p, 'CANCELLED'), undefined);
});

test('a cancelled order is counted in no pending row', () => {
  const p = data.buildPending([order({ status: 'CANCELLED' })], '2026-08-29');
  assert.equal(p.reduce((n, x) => n + x.count, 0), 0);
});

test('an unknown status is ignored rather than inventing a row', () => {
  const p = data.buildPending([order({ status: 'SOMETHING ELSE' })], '2026-08-29');
  assert.equal(p.reduce((n, x) => n + x.count, 0), 0);
});

test('oldest waiting days is measured from the previous stage date', () => {
  const p = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: '2026-08-19' }),
    order({ id: 2, status: 'PENDING FOR PR', design_approved_date: '2026-08-27' }),
  ], '2026-08-29');
  const row = pendingFor(p, 'PENDING FOR PR');
  assert.equal(row.count, 2);
  assert.equal(row.oldestDays, 10, 'the oldest of the two, not the newest');
});

test('design approval falls back to the 3D model date when there is no design date', () => {
  const p = data.buildPending([
    order({ status: 'PENDING FOR DESIGN APPROVAL', three_d_model_received_date: '2026-08-27' }),
  ], '2026-08-29');
  assert.equal(pendingFor(p, 'PENDING FOR DESIGN APPROVAL').oldestDays, 2);
});

test('a missing stage date falls back through requested date, then created_at', () => {
  const viaRequested = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: null, die_requested_date: '2026-08-24' }),
  ], '2026-08-29');
  assert.equal(pendingFor(viaRequested, 'PENDING FOR PR').oldestDays, 5);

  const viaCreated = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: null, die_requested_date: null,
            created_at: new Date('2026-08-27T10:00:00') }),
  ], '2026-08-29');
  assert.equal(pendingFor(viaCreated, 'PENDING FOR PR').oldestDays, 2);
});

test('with no date at all the age is null, never a fabricated zero', () => {
  const p = data.buildPending([
    order({ status: 'PENDING FOR PR', design_approved_date: null,
            die_requested_date: null, created_at: null }),
  ], '2026-08-29');
  const row = pendingFor(p, 'PENDING FOR PR');
  assert.equal(row.count, 1);
  assert.equal(row.oldestDays, null);
});

test('an empty stage has a zero count and a null age', () => {
  const row = pendingFor(data.buildPending([], '2026-08-29'), 'PENDING FOR PR');
  assert.equal(row.count, 0);
  assert.equal(row.oldestDays, null);
});

// ── buildReport and the ledger ──────────────────────────────────────────────

const fakeDb = (results = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM die_orders/.test(sql)) return { rows: results.orders || [] };
      if (/FROM daily_report_ledger/.test(sql)) return { rows: results.ledger || [] };
      return { rows: [] };
    },
  };
};

test('buildReport with commit:false writes nothing to the ledger', async () => {
  const db = fakeDb({ orders: [order({ design_received_date: '2026-08-28' })] });
  const report = await data.buildReport(db, {
    reportDate: '2026-08-28', today: '2026-08-29', commit: false,
  });
  assert.equal(report.activity.find(a => a.key === 'design_received').count, 1);
  assert.equal(db.calls.filter(c => /INSERT INTO daily_report_ledger/.test(c.sql)).length, 0,
    'a preview must never consume ledger rows');
});

test('buildReport with commit:true inserts every reported stage, idempotently', async () => {
  const db = fakeDb({ orders: [order({ design_received_date: '2026-08-28' })] });
  await data.buildReport(db, { reportDate: '2026-08-28', today: '2026-08-29', commit: true });
  const insert = db.calls.find(c => /INSERT INTO daily_report_ledger/.test(c.sql));
  assert.ok(insert, 'commit:true must write the ledger');
  assert.match(insert.sql, /ON CONFLICT \(order_id, stage\) DO NOTHING/,
    're-running the same day must not duplicate rows');
  assert.deepEqual(insert.params.slice(0, 3), [1, 'design_received', '2026-08-28']);
});

test('buildReport commits nothing when there was nothing to report', async () => {
  const db = fakeDb({ orders: [] });
  await data.buildReport(db, { reportDate: '2026-08-28', today: '2026-08-29', commit: true });
  assert.equal(db.calls.filter(c => /INSERT INTO daily_report_ledger/.test(c.sql)).length, 0);
});

test('buildReport treats already-ledgered rows as reported', async () => {
  const db = fakeDb({
    orders: [order({ id: 7, design_received_date: '2026-08-20' })],
    ledger: [{ order_id: 7, stage: 'design_received' }],
  });
  const report = await data.buildReport(db, {
    reportDate: '2026-08-28', today: '2026-08-29', commit: false,
  });
  assert.equal(report.lateTotal, 0);
});

test('the order query selects every column the report needs', async () => {
  const db = fakeDb();
  await data.fetchOrders(db);
  const { sql } = db.calls[0];
  for (const col of ['id', 'die_no', 'order_no', 'type', 'status', 'created_at',
    'three_d_model_received_date', ...data.STAGES.map(s => s.column)]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});

// The server keeps its own copy of the status vocabulary rather than importing
// across the src/ boundary. STATUS_CONFIG's own comment records the two copies
// having already drifted once; this is what stops it happening again.
const fs = require('node:fs');
const path = require('node:path');

test('the pending statuses match the frontend status vocabulary', () => {
  const constants = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'constants.js'), 'utf8');
  const block = constants.slice(constants.indexOf('export const STATUS_CONFIG'));
  const frontend = [...block.slice(0, block.indexOf('};')).matchAll(/^\s*'([^']+)':\s*\{/gm)]
    .map(m => m[1]);

  const server = data.PENDING_STAGES.map(s => s.status);
  assert.deepEqual([...server].sort(), frontend.filter(s => s !== 'CANCELLED').sort(),
    'PENDING_STAGES must cover every status in STATUS_CONFIG except CANCELLED');
});
