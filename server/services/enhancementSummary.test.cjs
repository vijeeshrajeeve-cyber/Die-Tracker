'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarise, loadEnhancementSummary } = require('./enhancementSummary.cjs');

const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const row = (o) => ({
  die_order_id: 1, die_no: 'D-1', supplier: 'Alpha', status: 'In Manufacturing', sample_status: null,
  current_issue: 'Weld lines', created_at: '2026-02-10T08:00:00', failure_assessment_required: false,
  baseline_productivity_kgh: '100', baseline_recovery_pct: '70', baseline_failure_pct: '10',
  target_productivity_kgh: '120', target_recovery_pct: '75', target_failure_pct: null,
  trial_productivity_kgh: null, trial_recovery_pct: null, trial_verdict: null,
  actual_failure_pct: null, final_verdict: null, final_verdict_date: null, ...o,
});
const done = (o) => row({ trial_verdict: 'Achieved', final_verdict: 'Achieved', final_verdict_date: '2026-03-15', ...o });

test('a cancelled project counts in no total and no list', () => {
  const s = summarise([done({ status: 'CANCELLED' }), row({ die_order_id: 2, status: 'Cancelled' })], YEAR);
  assert.deepEqual(s.totals, { started: 0, completed: 0, achieved: 0, partly: 0, notAchieved: 0, successRate: null, awaitingLifeReview: 0, open: 0 });
  assert.equal(s.started.length + s.completed.length + s.open.length, 0);
  assert.equal(s.months.every((m) => m.started === 0 && m.achieved === 0), true);
});

test('a project completed in March counts in March by its final verdict date, not created_at', () => {
  const s = summarise([done({ created_at: '2025-11-02T08:00:00', final_verdict_date: '2026-03-15' })], YEAR);
  assert.equal(s.totals.completed, 1);
  assert.equal(s.totals.started, 0);
  const march = s.months.find((m) => m.month === '2026-03');
  assert.equal(march.achieved, 1);
  assert.equal(march.started, 0);
  assert.equal(s.months.find((m) => m.month === '2025-11'), undefined);
});

test('successRate is achieved over completed, and null with nothing completed', () => {
  assert.equal(summarise([row({})], YEAR).totals.successRate, null);
  const s = summarise([
    done({ die_order_id: 1 }),
    done({ die_order_id: 2, final_verdict: 'Partly achieved' }),
    done({ die_order_id: 3, final_verdict: 'Not achieved' }),
    done({ die_order_id: 4, final_verdict: 'Achieved' }),
  ], YEAR);
  assert.equal(s.totals.completed, 4);
  assert.equal(s.totals.achieved, 2);
  assert.equal(s.totals.partly, 1);
  assert.equal(s.totals.notAchieved, 1);
  assert.equal(s.totals.successRate, 0.5);
});

test('averages skip a project with a null actual and report the right count', () => {
  const s = summarise([
    done({ die_order_id: 1, trial_productivity_kgh: '130', trial_recovery_pct: '80', actual_failure_pct: '5' }),
    done({ die_order_id: 2, trial_productivity_kgh: '110', trial_recovery_pct: null, actual_failure_pct: null, baseline_productivity_kgh: '90' }),
  ], YEAR);
  assert.deepEqual(s.averages.productivity, { baseline: 95, actual: 120, change: 25, count: 2 });
  assert.deepEqual(s.averages.recovery, { baseline: 70, actual: 80, change: 10, count: 1 });
  assert.deepEqual(s.averages.failure, { baseline: 10, actual: 5, change: -5, count: 1 });
});

test('averages are null when no completed project has both values', () => {
  const s = summarise([done({})], YEAR);
  assert.deepEqual(s.averages.productivity, { baseline: null, actual: null, change: null, count: 0 });
});

test('months has twelve entries for a full year, empty months included', () => {
  const s = summarise([row({ created_at: '2026-05-03T08:00:00' })], YEAR);
  assert.equal(s.months.length, 12);
  assert.equal(s.months[0].month, '2026-01');
  assert.equal(s.months[11].month, '2026-12');
  assert.deepEqual(s.months[0], { month: '2026-01', started: 0, achieved: 0, partly: 0, notAchieved: 0 });
  assert.equal(s.months[4].started, 1);
});

test('open and awaiting life review are counted at the end of the period', () => {
  const s = summarise([
    row({ die_order_id: 1 }),
    row({ die_order_id: 2, trial_verdict: 'Achieved', failure_assessment_required: true }),
    done({ die_order_id: 3, final_verdict_date: '2026-09-01' }),
    done({ die_order_id: 4, final_verdict_date: '2026-03-01' }),
  ], { from: '2026-01-01', to: '2026-06-30' });
  // Order 3 was still open on 30 June; order 4 was done by then.
  assert.equal(s.totals.open, 3);
  assert.equal(s.totals.awaitingLifeReview, 1);
  assert.equal(s.totals.completed, 1);
  const later = summarise([row({ die_order_id: 2, trial_verdict: 'Achieved', failure_assessment_required: true })], YEAR);
  assert.equal(later.totals.awaitingLifeReview, 1);
  assert.equal(later.open[0].state, 'Awaiting life review');
});

test('a trial verdict given after the period ends does not make a project awaiting its life review in it', () => {
  const r = row({ die_order_id: 2, trial_verdict: 'Achieved', trial_verdict_date: '2026-09-01', failure_assessment_required: true });
  const s = summarise([r], { from: '2026-01-01', to: '2026-06-30' });
  assert.equal(s.totals.open, 1);
  assert.equal(s.totals.awaitingLifeReview, 0);
  assert.equal(s.open[0].state, 'Open');
  const after = summarise([r], YEAR);
  assert.equal(after.totals.awaitingLifeReview, 1);
  const before = summarise([{ ...r, trial_verdict_date: '2026-05-01T08:00:00' }], { from: '2026-01-01', to: '2026-06-30' });
  assert.equal(before.totals.awaitingLifeReview, 1);
});

test('a project created after the period ends is not open in it', () => {
  const s = summarise([row({ created_at: '2026-08-01T08:00:00' })], { from: '2026-01-01', to: '2026-06-30' });
  assert.equal(s.totals.open, 0);
});

test('project rows carry the order, the three numbers and the state', () => {
  const s = summarise([done({ trial_productivity_kgh: '130', trial_recovery_pct: '80', actual_failure_pct: '5', target_failure_pct: '8' })], YEAR);
  assert.deepEqual(s.completed[0], {
    die_order_id: 1, die_no: 'D-1', profile: 'D', supplier: 'Alpha', current_issue: 'Weld lines',
    productivity: { baseline: 100, target: 120, actual: 130 },
    recovery: { baseline: 70, target: 75, actual: 80 },
    failure: { baseline: 10, target: 8, actual: 5 },
    trial_verdict: 'Achieved', final_verdict: 'Achieved', final_verdict_date: '2026-03-15', state: 'Completed',
  });
});

test('created_at is read as a local day', () => {
  const at = new Date(2026, 0, 1, 0, 30); // 00:30 local on 1 January
  const s = summarise([row({ created_at: at })], YEAR);
  assert.equal(s.months[0].started, 1);
});

test('loadEnhancementSummary queries the joined rows and summarises them', async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: [done({})] }; } };
  const s = await loadEnhancementSummary(client, YEAR);
  assert.equal(s.totals.completed, 1);
  assert.match(calls[0], /design_enhancements/);
});

test('each project row carries the profile: the die number before its first dash', () => {
  const s = summarise([
    row({ die_order_id: 1, die_no: '29663-253' }),
    row({ die_order_id: 2, die_no: 'D-1' }),
    row({ die_order_id: 3, die_no: '  090001-801 ' }),
    row({ die_order_id: 4, die_no: 'NODASH' }),
    row({ die_order_id: 5, die_no: null }),
  ], YEAR);
  assert.deepEqual(s.started.map((p) => p.profile), ['29663', 'D', '090001', 'NODASH', null]);
});
