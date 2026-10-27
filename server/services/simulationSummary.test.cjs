'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarise, loadSimulationSummary } = require('./simulationSummary.cjs');

const TODAY = '2026-10-27'; // a Tuesday
const round = (o) => ({
  order_id: 1, round_no: 1, model_received_date: null, sim_completed_date: null, result: null,
  fail_reason: null, modification: null, modification_done_date: null,
  updated_at: '2026-10-27T10:00:00', plant: 'P1', ...o,
});

test('a simulation is a round with a completed date, OK or Not OK, in YTD and MTD by that date', () => {
  const s = summarise({
    today: TODAY,
    rounds: [
      round({ order_id: 1, model_received_date: '2026-10-05', sim_completed_date: '2026-10-06', result: 'OK' }),
      round({ order_id: 2, model_received_date: '2026-03-02', sim_completed_date: '2026-03-03', result: 'Not OK', fail_reason: 'Weld seam quality', modification: 'Supplier' }),
      round({ order_id: 3, model_received_date: '2026-10-26', prep_done_date: '2026-10-26' }), // not finished
      round({ order_id: 4, model_received_date: '2025-12-29', sim_completed_date: '2025-12-30', result: 'OK' }), // last year
    ],
  });
  assert.equal(s.ytd.simulations, 2);
  assert.equal(s.mtd.simulations, 1);
  assert.equal(s.ytd.ok, 1);
  assert.equal(s.ytd.not_ok, 1);
});

test('simulations per die divides by die orders with a simulation in the period, counting revision rounds', () => {
  const s = summarise({
    today: TODAY,
    rounds: [
      round({ order_id: 1, round_no: 1, sim_completed_date: '2026-09-10', result: 'Not OK', fail_reason: 'Other', modification: 'Supplier' }),
      round({ order_id: 1, round_no: 2, sim_completed_date: '2026-10-12', result: 'Not OK', fail_reason: 'Other', modification: 'In-house', modification_done_date: '2026-10-13' }),
      round({ order_id: 1, round_no: 3, sim_completed_date: '2026-10-14', result: 'OK' }),
      round({ order_id: 2, round_no: 1, sim_completed_date: '2026-10-20', result: 'OK' }),
    ],
  });
  assert.equal(s.ytd.simulations, 4);
  assert.equal(s.ytd.dies, 2);
  assert.equal(s.ytd.per_die, 2);
  // October alone: order 1 had two, order 2 one.
  assert.equal(s.mtd.per_die, 1.5);
});

test('no simulations gives null averages and rates, never zero', () => {
  const s = summarise({ today: TODAY, rounds: [] });
  assert.equal(s.ytd.simulations, 0);
  assert.equal(s.ytd.per_die, null);
  assert.equal(s.ytd.avg_lead_days, null);
  assert.equal(s.ytd.on_time_rate, null);
  assert.equal(s.ytd.first_pass_rate, null);
  assert.equal(s.tracking_since, null);
  assert.equal(s.months.length, 10);
  assert.equal(s.months[0].avg_lead_days, null);
});

test('in-house modifications count on their Modification done date, not the Not OK date', () => {
  const s = summarise({
    today: TODAY,
    rounds: [
      round({ order_id: 1, sim_completed_date: '2026-09-30', result: 'Not OK', fail_reason: 'Other', modification: 'In-house', modification_done_date: '2026-10-01' }),
      round({ order_id: 2, sim_completed_date: '2026-10-20', result: 'Not OK', fail_reason: 'Other', modification: 'In-house' }), // not done yet
      round({ order_id: 3, sim_completed_date: '2026-10-21', result: 'Not OK', fail_reason: 'Other', modification: 'Supplier' }),
    ],
  });
  assert.equal(s.ytd.in_house, 1);
  assert.equal(s.mtd.in_house, 1);
  assert.equal(s.months[8].in_house, 0); // September: decided then, done in October
  assert.equal(s.ytd.supplier, 1);
});

test('lead time is working days model received -> completed, Sundays and holidays skipped, averaged by month', () => {
  const calendars = { P1: { weekdays: [1, 2, 3, 4, 5, 6], holidays: ['2026-10-14'] } };
  const s = summarise({
    today: TODAY,
    calendarFor: (p) => calendars[p] || {},
    rounds: [
      // Sat -> Mon: Sunday skipped, 1 working day.
      round({ order_id: 1, model_received_date: '2026-10-10', sim_completed_date: '2026-10-12', result: 'OK' }),
      // Tue -> Thu with Wed a holiday: 1 working day.
      round({ order_id: 2, model_received_date: '2026-10-13', sim_completed_date: '2026-10-15', result: 'OK' }),
      // Mon -> Thu: 3 working days, late.
      round({ order_id: 3, model_received_date: '2026-10-19', sim_completed_date: '2026-10-22', result: 'OK' }),
      // No model date (a legacy round): counted as a simulation, not in the lead average.
      round({ order_id: 4, sim_completed_date: '2026-10-23', result: 'OK' }),
    ],
  });
  const oct = s.months[9];
  assert.equal(oct.simulations, 4);
  assert.equal(oct.lead_measured, 3);
  assert.equal(oct.avg_lead_days, 5 / 3);
  assert.equal(oct.on_time, 2);
  assert.equal(oct.on_time_rate, 2 / 3);
});

test('first pass: OK in the first finished round with no revision raised before it', () => {
  const s = summarise({
    today: TODAY,
    rounds: [
      round({ order_id: 1, sim_completed_date: '2026-10-01', result: 'OK', updated_at: '2026-10-01T09:00:00' }),
      round({ order_id: 2, round_no: 1, sim_completed_date: '2026-10-02', result: 'Not OK', fail_reason: 'Other', modification: 'In-house', modification_done_date: '2026-10-03' }),
      round({ order_id: 2, round_no: 2, sim_completed_date: '2026-10-05', result: 'OK' }),
      // Round 1 on tracking, but the design was already sent back before it.
      round({ order_id: 3, sim_completed_date: '2026-10-06', result: 'OK', updated_at: '2026-10-06T09:00:00' }),
      // Revised only after passing (rejected at Design Approval): still a first pass.
      round({ order_id: 4, sim_completed_date: '2026-10-07', result: 'OK', updated_at: '2026-10-07T09:00:00' }),
    ],
    revisions: [
      { order_id: 3, created_at: '2026-09-15T12:00:00' },
      { order_id: 4, created_at: '2026-10-09T12:00:00' },
    ],
  });
  assert.equal(s.ytd.passed, 4);
  assert.equal(s.ytd.first_pass, 2);
  assert.equal(s.ytd.first_pass_rate, 0.5);
});

test('Not OK reasons are YTD counts, most frequent first', () => {
  const notOk = (order_id, fail_reason, d) => round({ order_id, sim_completed_date: d, result: 'Not OK', fail_reason, modification: 'Supplier' });
  const s = summarise({
    today: TODAY,
    rounds: [
      notOk(1, 'Weld seam quality', '2026-10-01'),
      notOk(2, 'Die deflection / stress too high', '2026-10-02'),
      notOk(3, 'Weld seam quality', '2026-05-02'),
      notOk(4, 'Weld seam quality', '2025-11-02'), // last year
    ],
  });
  assert.deepEqual(s.reasons, [
    { reason: 'Weld seam quality', count: 2 },
    { reason: 'Die deflection / stress too high', count: 1 },
  ]);
});

test('tracking_since is the first recorded simulation; months run Jan to the current month', () => {
  const s = summarise({
    today: TODAY,
    rounds: [round({ sim_completed_date: '2026-10-26', result: 'OK' }), round({ order_id: 2, sim_completed_date: '2026-10-27', result: 'OK' })],
  });
  assert.equal(s.tracking_since, '2026-10-26');
  assert.deepEqual(s.months.map(m => m.label), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
  assert.equal(s.year, 2026);
  assert.equal(s.target_working_days, 1);
});

test('loadSimulationSummary reads rounds, revisions and calendars', async () => {
  const seen = [];
  const client = {
    query: async (sql, params) => {
      const q = sql.replace(/\s+/g, ' ');
      seen.push(q);
      if (/FROM work_queue_calendars/.test(q)) return { rows: [{ plant: '', weekdays: [1, 2, 3, 4, 5, 6], holidays: [] }] };
      if (/FROM simulation_rounds r JOIN die_orders o/.test(q)) {
        return { rows: [round({ order_id: 9, model_received_date: '2026-10-26', sim_completed_date: '2026-10-27', result: 'OK' })] };
      }
      if (/FROM order_revisions/.test(q)) { assert.deepEqual(params, [[9]]); return { rows: [] }; }
      throw new Error(`unexpected query ${q}`);
    },
  };
  const s = await loadSimulationSummary(client, TODAY);
  assert.equal(s.mtd.simulations, 1);
  assert.equal(s.mtd.avg_lead_days, 1);
  assert.equal(s.mtd.first_pass, 1);
  assert.equal(seen.length, 3);
});
