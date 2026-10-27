'use strict';

// Simulation process summary (Analytics -> Simulation). Every figure comes
// from simulation_rounds, which only exists from the step tracking release:
// the old "Simulation Complete" button kept one overwritten date per order, so
// nothing earlier can be counted per simulation and nothing here estimates it.
//
// Counting rules (user-confirmed 2026-10-27):
// - A simulation is a round with a Simulation completed date, OK or Not OK. It
//   falls in the month of that date.
// - Simulations per die = simulations in the period / die orders with at least
//   one simulation in the period. Rounds after a supplier revision count too.
// - An in-house modification counts on its Modification done date.
// - Lead time = working days from 3D model received to Simulation completed,
//   per round, averaged by the month the round finished.
// Extras: on-time rate (lead within the 1-working-day target), first-pass OK
// rate, and Not OK reasons.

const { strictDate, workingDaysBetween } = require('./workQueueCalendar.cjs');
const { TARGET_WORKING_DAYS } = require('./simulationRounds.cjs');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// DATE columns arrive as 'YYYY-MM-DD' (type parser 1082); tolerate a Date.
const day = (value) => {
  if (!value) return null;
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return strictDate(s) ? s : null;
};

const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
const rate = (part, whole) => (whole ? part / whole : null);

function periodFigures(done, modsDone, firstPassFlags) {
  const dies = new Set(done.map(r => r.order_id)).size;
  const measured = done.filter(r => r.lead_days !== null);
  const onTime = measured.filter(r => r.lead_days <= TARGET_WORKING_DAYS).length;
  const passed = done.filter(r => r.result === 'OK');
  const firstPass = passed.filter(r => firstPassFlags.get(r)).length;
  return {
    simulations: done.length,
    dies,
    per_die: dies ? done.length / dies : null,
    ok: passed.length,
    not_ok: done.filter(r => r.result === 'Not OK').length,
    in_house: modsDone.length,
    supplier: done.filter(r => r.result === 'Not OK' && r.modification === 'Supplier').length,
    avg_lead_days: mean(measured.map(r => r.lead_days)),
    lead_measured: measured.length,
    on_time: onTime,
    on_time_rate: rate(onTime, measured.length),
    passed: passed.length,
    first_pass: firstPass,
    first_pass_rate: rate(firstPass, passed.length),
  };
}

// rounds: simulation_rounds rows joined with the order's plant.
// revisions: { order_id, created_at } for the same orders.
// calendarFor(plant) gives the plant's working calendar.
function summarise({ rounds = [], revisions = [], calendarFor = () => ({}), today }) {
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);

  const all = rounds.map(r => {
    const model = day(r.model_received_date);
    const done = day(r.sim_completed_date);
    return {
      ...r,
      model_received_date: model,
      sim_completed_date: done,
      modification_done_date: day(r.modification_done_date),
      lead_days: model && done ? workingDaysBetween(model, done, calendarFor(r.plant)) : null,
    };
  });

  // First pass: the OK round is the die's first finished round, and no design
  // revision was raised on the order before it. The revision check catches dies
  // that went round before tracking started -- their first tracked round is
  // not their first simulation, and calling it a first pass would flatter.
  const revisedAt = new Map();
  revisions.forEach(v => {
    const at = new Date(v.created_at).getTime();
    if (!Number.isFinite(at)) return;
    revisedAt.set(v.order_id, Math.min(revisedAt.get(v.order_id) ?? Infinity, at));
  });
  const firstPassFlags = new Map();
  all.filter(r => r.result === 'OK' && r.sim_completed_date).forEach(r => {
    const earlier = all.some(o => o.order_id === r.order_id && o.sim_completed_date && o.round_no < r.round_no);
    const okAt = new Date(r.updated_at).getTime();
    const firstRevision = revisedAt.get(r.order_id);
    const revisedBefore = firstRevision !== undefined && (!Number.isFinite(okAt) || firstRevision < okAt);
    firstPassFlags.set(r, !earlier && !revisedBefore);
  });

  const doneIn = (prefix) => all.filter(r => r.sim_completed_date && r.sim_completed_date.startsWith(prefix) && r.sim_completed_date <= today);
  const modsIn = (prefix) => all.filter(r => r.modification === 'In-house' && r.modification_done_date
    && r.modification_done_date.startsWith(prefix) && r.modification_done_date <= today);

  const lastMonth = Number(today.slice(5, 7));
  const months = MONTH_LABELS.slice(0, lastMonth).map((label, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { month: key, label, ...periodFigures(doneIn(key), modsIn(key), firstPassFlags) };
  });

  const reasonCounts = new Map();
  doneIn(year).filter(r => r.result === 'Not OK').forEach(r => {
    reasonCounts.set(r.fail_reason, (reasonCounts.get(r.fail_reason) || 0) + 1);
  });
  const reasons = [...reasonCounts]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || String(a.reason).localeCompare(String(b.reason)));

  const tracked = all.map(r => r.sim_completed_date).filter(Boolean).sort();

  return {
    today,
    year: Number(year),
    target_working_days: TARGET_WORKING_DAYS,
    tracking_since: tracked[0] || null,
    ytd: periodFigures(doneIn(year), modsIn(year), firstPassFlags),
    mtd: periodFigures(doneIn(month), modsIn(month), firstPassFlags),
    months,
    reasons,
  };
}

// Working calendars by plant, '' for the global row (same lookup as the
// Simulation page, so lead times and late flags agree).
async function loadCalendars(client) {
  const { rows } = await client.query(
    'SELECT plant, weekdays, holidays::text[] AS holidays FROM work_queue_calendars'
  );
  const byPlant = new Map(rows.map(r => [r.plant || '', { weekdays: r.weekdays, holidays: r.holidays || [] }]));
  return (plant) => byPlant.get(plant || '') || byPlant.get('') || {};
}

// Every round with a finished step is loaded, not just this year's: first-pass
// needs a die's earlier rounds, and the table holds one row per round.
async function loadSimulationSummary(client, today) {
  const calendarFor = await loadCalendars(client);
  const { rows: rounds } = await client.query(
    `SELECT r.order_id, r.round_no, r.model_received_date, r.sim_completed_date, r.result,
            r.fail_reason, r.modification, r.modification_done_date, r.updated_at, o.plant
       FROM simulation_rounds r JOIN die_orders o ON o.id = r.order_id
      WHERE r.sim_completed_date IS NOT NULL OR r.modification_done_date IS NOT NULL`
  );
  const ids = [...new Set(rounds.map(r => r.order_id))];
  const { rows: revisions } = ids.length
    ? await client.query('SELECT order_id, created_at FROM order_revisions WHERE order_id = ANY($1)', [ids])
    : { rows: [] };
  return summarise({ rounds, revisions, calendarFor, today });
}

module.exports = { summarise, loadSimulationSummary };
