'use strict';
// Data core of the daily Sample Status report: every die still in trial, by
// plant and press. Pure apart from loadSampleStatus, which only reads.

const { plantName } = require('./trialPlans.cjs');
const { todayLocal } = require('./dates.cjs');

// Same figure as SUBMISSION_TARGET_DAYS in src/utils/sampleFollowupView.js.
const SUBMISSION_TARGET_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_PLANT = 'No plant';
const NO_PRESS = 'No press';

const text = (v) => String(v ?? '').trim();

// Whole calendar days from a 'YYYY-MM-DD…' value, read as a date, not an instant.
const dayNumber = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
};
// The day itself ('YYYY-MM-DD') or null when the value is not a date.
const dayOf = (value) => {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || '').trim());
  return match ? match[1] : null;
};
const span = (from, to) => {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : Math.max(0, b - a);
};

// Same rule as belongsInSampleFollowup in src/utils/sampleFollowupView.js.
function belongsInSampleFollowup({ receivedDate, orderStatus }) {
  if (!text(receivedDate)) return false;
  const status = text(orderStatus).toUpperCase();
  return status !== 'CANCELLED' && status !== 'HOLD';
}

const emptyCounts = () => ({ inTrial: 0, late: 0, submittedToday: 0, trialsToday: 0, trialsOk: 0, trialsNotOk: 0 });

const trialLine = (t) => [
  `T${t.trialNo} ${t.result === 'OK' ? 'OK' : 'Not OK'}`,
  text(t.failReason),
  text(t.comments),
].filter(Boolean).join(' · ');

const GROUP_ORDER = { late: 0, waiting: 1, rejected: 2, submittedToday: 3 };
const desc = (a, b) => (b - a);
const nullLast = (a, b, cmp) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : cmp(a, b));

function buildSampleStatus({ rows, trials, reportDate, plant = 'All' }) {
  const trialsByParent = new Map();
  for (const t of trials || []) {
    const key = `${t.source}:${t.parentId}`;
    if (!trialsByParent.has(key)) trialsByParent.set(key, []);
    trialsByParent.get(key).push(t);
  }

  const groups = new Map(); // plant -> { counts, presses: Map }
  const groupFor = (name) => {
    if (!groups.has(name)) groups.set(name, { plant: name, counts: emptyCounts(), presses: new Map() });
    return groups.get(name);
  };

  for (const r of rows || []) {
    if (!belongsInSampleFollowup(r)) continue;
    const plantLabel = plantName(r.plant) || NO_PLANT;
    if (plant !== 'All' && plantLabel !== plant) continue;

    const status = text(r.status) || 'Pending';
    const submission = dayOf(r.submissionDate);
    const rejected = status === 'Rejected';
    // A Rejected die submitted today is still a Rejected die, not a fresh submission.
    const submittedToday = !rejected && submission === reportDate;
    const listed = status === 'Pending' || status === 'On hold' || rejected || submittedToday;
    // A die that is not Approved-and-gone still counts its trials today, so
    // trials are tallied for every row of the page, listed or not.
    const own = (trialsByParent.get(`${r.source}:${r.id}`) || []).slice()
      .sort((a, b) => a.trialNo - b.trialNo);
    const today = own.filter(t => dayOf(t.trialDate) === reportDate);
    // No empty plant sections: a plant appears only with a listed die or a trial today.
    if (!today.length && (!listed || status === 'Approved')) continue;
    const group = groupFor(plantLabel);
    for (const t of today) {
      group.counts.trialsToday += 1;
      if (t.result === 'OK') group.counts.trialsOk += 1; else group.counts.trialsNotOk += 1;
    }
    if (!listed || status === 'Approved') continue;

    const end = submission ?? reportDate;
    const days = span(r.receivedDate, end);
    const late = (status === 'Pending' || status === 'On hold') && !submittedToday && days !== null && days > SUBMISSION_TARGET_DAYS;
    const rejectedWait = rejected ? span(submission, reportDate) : null;
    const latestTrial = own[own.length - 1];
    const legacy = Number(r.legacyTrials) || 0;
    const lastTrialDate = latestTrial ? dayOf(latestTrial.trialDate) : null;

    let latest;
    if (submittedToday) latest = 'Submitted today';
    else if (latestTrial) latest = trialLine(latestTrial);
    else latest = text(r.remark) || 'No trial yet';

    const row = {
      die: text(r.die),
      customer: text(r.customer),
      dieType: text(r.dieType),
      supplier: text(r.supplier),
      receivedDate: text(r.receivedDate),
      status,
      days,
      late,
      rejectedWait,
      submittedToday,
      lastTrialDate,
      daysSinceTrial: lastTrialDate ? span(lastTrialDate, reportDate) : null,
      trialCount: own.length,
      legacyTrialCount: !own.length && legacy > 0 ? legacy : null,
      corrector: text(r.corrector),
      latest,
    };
    row._rank = submittedToday ? GROUP_ORDER.submittedToday : rejected ? GROUP_ORDER.rejected
      : late ? GROUP_ORDER.late : GROUP_ORDER.waiting;

    const pressLabel = text(r.press) || NO_PRESS;
    if (!group.presses.has(pressLabel)) group.presses.set(pressLabel, []);
    group.presses.get(pressLabel).push(row);
    if (submittedToday) group.counts.submittedToday += 1; else group.counts.inTrial += 1;
    if (late) group.counts.late += 1;
  }

  const byPlant = (a, b) => (a === NO_PLANT) - (b === NO_PLANT) || a.localeCompare(b, undefined, { numeric: true });
  const byPress = (a, b) => (a === NO_PRESS) - (b === NO_PRESS) || a.localeCompare(b, undefined, { numeric: true });
  const inPress = (a, b) => a._rank - b._rank || (
    a._rank === GROUP_ORDER.rejected ? desc(a.rejectedWait ?? 0, b.rejectedWait ?? 0)
      : a._rank === GROUP_ORDER.submittedToday ? 0
        : nullLast(a.days, b.days, desc));

  const plants = [...groups.values()]
    .sort((a, b) => byPlant(a.plant, b.plant))
    .map(g => ({
      plant: g.plant,
      counts: g.counts,
      presses: [...g.presses.entries()]
        .sort((a, b) => byPress(a[0], b[0]))
        .map(([press, list]) => ({
          press,
          rows: list.sort(inPress).map(({ _rank, ...row }) => row),
        })),
    }));

  const totals = emptyCounts();
  for (const p of plants) for (const k of Object.keys(totals)) totals[k] += p.counts[k];
  return { reportDate, plantFilter: plant, totals, plants };
}

async function loadSampleStatus(db, { reportDate = todayLocal(), plant = 'All' } = {}) {
  const orders = await db.query(
    `SELECT id, die_no, plant, press, customer_name, die_type, supplier, die_received_date, submission_date,
            sample_status, status AS order_status, corrector, no_of_trial, sample_remark
       FROM die_orders`
  );
  const standalone = await db.query(
    `SELECT id, profile, plant, press, customer, supplier, die_received_date, submission_date,
            status AS sample_status, corrector, no_of_trial, remark
       FROM sample_followups`
  );
  const trialRows = await db.query(
    `SELECT die_order_id, sample_followup_id, trial_no, trial_date, result, fail_reason, comments
       FROM sample_trials`
  );

  const rows = [
    ...orders.rows.map(o => ({
      source: 'order', id: o.id, die: o.die_no, plant: o.plant, press: o.press, customer: o.customer_name,
      dieType: o.die_type, supplier: o.supplier, receivedDate: o.die_received_date, submissionDate: o.submission_date,
      status: o.sample_status, orderStatus: o.order_status, corrector: o.corrector,
      legacyTrials: o.no_of_trial, remark: o.sample_remark,
    })),
    ...standalone.rows.map(s => ({
      source: 'standalone', id: s.id, die: s.profile, plant: s.plant, press: s.press, customer: s.customer,
      dieType: '', supplier: s.supplier, receivedDate: s.die_received_date, submissionDate: s.submission_date,
      status: s.sample_status, orderStatus: null, corrector: s.corrector,
      legacyTrials: s.no_of_trial, remark: s.remark,
    })),
  ].filter(belongsInSampleFollowup);

  const trials = trialRows.rows.map(t => ({
    source: t.die_order_id != null ? 'order' : 'standalone',
    parentId: t.die_order_id != null ? t.die_order_id : t.sample_followup_id,
    trialNo: t.trial_no,
    trialDate: t.trial_date,
    result: t.result,
    failReason: t.fail_reason,
    comments: t.comments,
  }));

  return buildSampleStatus({ rows, trials, reportDate, plant });
}

module.exports = { belongsInSampleFollowup, buildSampleStatus, loadSampleStatus, SUBMISSION_TARGET_DAYS };
