// View rules for the Simulation page. The server already worked out each
// die's stage, its working days and whether it is late (it owns the working
// calendar); this module only filters, sorts, bands and summarises.

export const SIM_STAGES = ['awaiting_model', 'model_received', 'prep_done', 'in_house_mod'];
export const LATE_STAGES = ['model_received', 'prep_done'];
export const TARGET_WORKING_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
};

export const scopeDies = (dies, { search = '', plant = 'All' } = {}) => {
  const term = search.trim().toLowerCase();
  return dies.filter(d => {
    if (plant && plant !== 'All' && (d.plant || '') !== plant) return false;
    if (!term) return true;
    return [d.die_no, d.order_no, d.supplier].some(v => String(v || '').toLowerCase().includes(term));
  });
};

const byText = (a, b) => String(a || '').localeCompare(String(b || ''));

export const sortDies = (dies, sort) => [...dies].sort((a, b) => {
  if (sort === 'newest') return byText(b.stage_since, a.stage_since);
  if (sort === 'plant') return byText(a.plant, b.plant) || byText(a.die_no, b.die_no);
  return (Number(b.late) - Number(a.late)) || ((b.days_on_stage ?? -1) - (a.days_on_stage ?? -1));
});

export const bandsFor = (stage, rows) => {
  const bands = LATE_STAGES.includes(stage)
    ? [
      { key: 'late', label: `Past the ${TARGET_WORKING_DAYS}-day target`, tone: 'late', rows: rows.filter(r => r.late) },
      { key: 'open', label: 'Within target', tone: 'open', rows: rows.filter(r => !r.late) },
    ]
    : [{ key: 'waiting', label: stage === 'awaiting_model' ? 'Waiting on the supplier' : 'Being modified in-house', tone: 'open', rows }];
  return bands.filter(b => b.rows.length);
};

export const stageSummary = (dies) => Object.fromEntries(SIM_STAGES.map(stage => {
  const rows = dies.filter(d => d.stage === stage);
  return [stage, { count: rows.length, late: rows.filter(d => d.late).length }];
}));

// `rounds` are the server's recent_rounds: every completed round of the last
// 180 days, including dies that have since left Simulation.
const completedRounds = (rounds) => rounds
  .filter(r => r.sim_completed_date)
  .map(r => ({ ...r, day: dayNumber(r.sim_completed_date) }));

const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

// Days run back from today: the last 90 days are (today-90, today].
export const modelToResult = (recent, today) => {
  const now = dayNumber(today);
  const rounds = completedRounds(recent).filter(r => r.model_to_result_days !== null && r.model_to_result_days !== undefined);
  const inWindow = (r, from, to) => r.day > now - to && r.day <= now - from;
  return {
    current: mean(rounds.filter(r => inWindow(r, 0, 90)).map(r => r.model_to_result_days)),
    previous: mean(rounds.filter(r => inWindow(r, 90, 180)).map(r => r.model_to_result_days)),
  };
};

export const topReason = (recent, today) => {
  const now = dayNumber(today);
  const notOk = completedRounds(recent).filter(r => r.result === 'Not OK' && r.day > now - 90 && r.day <= now);
  if (!notOk.length) return null;
  const counts = new Map();
  notOk.forEach(r => counts.set(r.fail_reason, (counts.get(r.fail_reason) || 0) + 1));
  const [reason, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { reason, count, total: notOk.length };
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
