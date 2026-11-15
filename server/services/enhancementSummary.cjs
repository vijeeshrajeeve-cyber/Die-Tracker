'use strict';
// Analytics -> Enhancements: how design enhancement projects are going.
// Pure `summarise` (the PDF and Excel reports build on its output) plus a thin
// loader. Cancelled projects appear in no total and no list.
//
// Period rules: a project is "started" on the local day of created_at and
// "completed" on final_verdict_date. "Open" and "awaiting life review" are
// counted as they stood at the period's `to` date. A blank number is null, so
// averages only use projects that have both the baseline and the actual.

const { localDay } = require('./dates.cjs');
const { projectState } = require('./designEnhancement.cjs');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// created_at is a TIMESTAMPTZ (Date); DATE columns arrive as 'YYYY-MM-DD'.
function dayOf(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : localDay(value);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : localDay(d);
}

function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > last) break;
    out.push({ month: key, started: 0, achieved: 0, partly: 0, notAchieved: 0 });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const trio = (r, key, trialKey) => ({
  baseline: num(r[`baseline_${key}`]),
  target: num(r[`target_${key}`]),
  actual: num(r[trialKey]),
});

function projectRow(r, state) {
  return {
    die_order_id: r.die_order_id,
    die_no: r.die_no,
    supplier: r.supplier,
    current_issue: r.current_issue,
    productivity: trio(r, 'productivity_kgh', 'trial_productivity_kgh'),
    recovery: trio(r, 'recovery_pct', 'trial_recovery_pct'),
    failure: trio(r, 'failure_pct', 'actual_failure_pct'),
    trial_verdict: r.trial_verdict || null,
    final_verdict: r.final_verdict || null,
    final_verdict_date: dayOf(r.final_verdict_date),
    state,
  };
}

function average(projects, key) {
  const both = projects.map((p) => p[key]).filter((n) => n.baseline !== null && n.actual !== null);
  if (!both.length) return { baseline: null, actual: null, change: null, count: 0 };
  const baseline = both.reduce((s, n) => s + n.baseline, 0) / both.length;
  const actual = both.reduce((s, n) => s + n.actual, 0) / both.length;
  return { baseline, actual, change: actual - baseline, count: both.length };
}

// rows: design_enhancements joined with their die order (die_no, supplier,
// status, sample_status). from/to: 'YYYY-MM-DD', inclusive.
function summarise(rows, { from, to }) {
  const months = monthsBetween(from, to);
  const slot = (day) => (day ? months.find((m) => m.month === day.slice(0, 7)) : undefined);
  const inPeriod = (day) => Boolean(day) && day >= from && day <= to;

  const started = [];
  const completed = [];
  const open = [];
  let awaiting = 0;
  const counts = { Achieved: 0, 'Partly achieved': 0, 'Not achieved': 0 };

  for (const r of rows || []) {
    const state = projectState(r, r);
    if (state === 'Cancelled') continue;
    const created = dayOf(r.created_at);
    const finished = dayOf(r.final_verdict_date);

    if (inPeriod(created)) {
      started.push(projectRow(r, state));
      slot(created).started += 1;
    }
    if (r.final_verdict && inPeriod(finished)) {
      completed.push(projectRow(r, state));
      if (r.final_verdict in counts) counts[r.final_verdict] += 1;
      const m = slot(finished);
      if (r.final_verdict === 'Achieved') m.achieved += 1;
      else if (r.final_verdict === 'Partly achieved') m.partly += 1;
      else if (r.final_verdict === 'Not achieved') m.notAchieved += 1;
    }
    // As it stood at `to`: a verdict given after `to` had not happened yet.
    if (created && created <= to && !(r.final_verdict && finished && finished <= to)) {
      const asOf = projectState({ ...r, final_verdict: null }, r);
      open.push(projectRow(r, asOf));
      if (asOf === 'Awaiting life review') awaiting += 1;
    }
  }

  const achieved = counts.Achieved;
  return {
    totals: {
      started: started.length,
      completed: completed.length,
      achieved,
      partly: counts['Partly achieved'],
      notAchieved: counts['Not achieved'],
      successRate: completed.length ? achieved / completed.length : null,
      awaitingLifeReview: awaiting,
      open: open.length,
    },
    months,
    averages: {
      productivity: average(completed, 'productivity'),
      recovery: average(completed, 'recovery'),
      failure: average(completed, 'failure'),
    },
    completed,
    started,
    open,
  };
}

async function loadEnhancementSummary(client, { from, to }) {
  const { rows } = await client.query(
    `SELECT e.*, o.die_no, o.supplier, o.status, o.sample_status
       FROM design_enhancements e JOIN die_orders o ON o.id = e.die_order_id`
  );
  return summarise(rows, { from, to });
}

module.exports = { summarise, loadEnhancementSummary };
