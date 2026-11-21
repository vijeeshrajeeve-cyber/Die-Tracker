'use strict';
// Data core of the monthly Sample Approval Followup report: dies waiting for
// customer approval, plus last month's approvals and rejections per customer.
// Pure apart from loadSampleApproval, which only reads.

const { belongsInSampleFollowup, dayNumber, dayOf, loadFollowupRows } = require('./sampleStatusReportData.cjs');
const { todayLocal } = require('./dates.cjs');

const NO_CUSTOMER = 'No customer';
const REJECTIONS_NOTE = 'Rejections are counted where the status change was recorded in the app.';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

const text = (v) => String(v ?? '').trim();
const isMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ''));
const pad = (n) => String(n).padStart(2, '0');

function previousMonth(isoDay) {
  const [y, m] = String(isoDay).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}
const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};
const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  return [`${month}-01`, `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`];
};

// to - from in whole days, or null when either is unreadable or the result is negative.
// Unlike the Sample Status report there is no clamping to 0: a bad interval is unknown.
const interval = (from, to) => {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null || b < a ? null : b - a;
};
const average = (values) => (values.length
  ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
  : null);

const customerKey = (name) => text(name).replace(/\s+/g, ' ').toLowerCase();
const byDie = (a, b) => a.die.localeCompare(b.die, undefined, { numeric: true });
// Descending, with null last.
const nullLast = (a, b) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);

// One group per normalised customer; the display name is the most common spelling
// (whitespace collapsed, case kept), ties going to the row with the highest id.
function groupByCustomer(items) {
  const groups = new Map();
  for (const item of items) {
    const key = customerKey(item.customer);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([key, list]) => {
    const spellings = new Map();
    for (const it of list) {
      const spelling = text(it.customer).replace(/\s+/g, ' ');
      const s = spellings.get(spelling) || { count: 0, maxId: -Infinity };
      s.count += 1;
      s.maxId = Math.max(s.maxId, Number(it.id) || 0);
      spellings.set(spelling, s);
    }
    const best = [...spellings.entries()].sort((a, b) => b[1].count - a[1].count || b[1].maxId - a[1].maxId)[0];
    return { blank: key === '', name: key === '' ? NO_CUSTOMER : best[0], list };
  });
}

function buildSampleApproval({ rows, trials, rejections, reportDate, month, targetDays }) {
  const listed = (rows || []).filter(belongsInSampleFollowup);

  const trialsByParent = new Map();
  for (const t of trials || []) {
    const key = `${t.source}:${t.parentId}`;
    trialsByParent.set(key, (trialsByParent.get(key) || 0) + 1);
  }

  // Waiting: exactly 'Sample Submitted'.
  const waitingItems = listed.filter(r => text(r.status) === 'Sample Submitted').map(r => {
    const daysWaiting = interval(r.submissionDate, reportDate);
    const trialCount = trialsByParent.get(`${r.source}:${r.id}`) || 0;
    const legacy = Number(r.legacyTrials) || 0;
    return {
      id: r.id,
      customer: r.customer,
      die: text(r.die),
      plant: text(r.plant),
      press: text(r.press),
      submittedDate: dayOf(r.submissionDate) || '',
      daysWaiting,
      overdue: daysWaiting !== null && daysWaiting > targetDays,
      trialCount,
      legacyTrialCount: !trialCount && legacy > 0 ? legacy : null,
      corrector: text(r.corrector),
      remark: text(r.remark),
    };
  });
  const waiting = groupByCustomer(waitingItems).map(g => {
    const rowsOut = g.list.sort((a, b) => nullLast(a.daysWaiting, b.daysWaiting) || byDie(a, b))
      .map(({ id, customer, ...rest }) => rest);
    const known = rowsOut.map(r => r.daysWaiting).filter(d => d !== null);
    return {
      blank: g.blank,
      customer: g.name,
      count: rowsOut.length,
      overdue: rowsOut.filter(r => r.overdue).length,
      oldestDays: known.length ? Math.max(...known) : null,
      rows: rowsOut,
    };
  }).sort((a, b) => a.blank - b.blank || nullLast(a.oldestDays, b.oldestDays) || a.customer.localeCompare(b.customer))
    .map(({ blank, ...g }) => g);

  // Last month: approvals by approval date, rejections per die.
  const rejectedIds = new Set((rejections || []).map(r => String(r.orderId)));
  const stats = listed.map(r => {
    const approved = text(r.status) === 'Approved' && (dayOf(r.sampleApprovalDate) || '').slice(0, 7) === month;
    return {
      id: r.id,
      customer: r.customer,
      approved,
      days: approved ? interval(r.submissionDate, r.sampleApprovalDate) : null,
      rejected: r.source === 'order' && rejectedIds.has(String(r.id)),
    };
  }).filter(s => s.approved || s.rejected);

  const summarise = (list) => ({
    approved: list.filter(s => s.approved).length,
    rejected: list.filter(s => s.rejected).length,
    avgDays: average(list.filter(s => s.days !== null).map(s => s.days)),
  });
  const lastMonthRows = groupByCustomer(stats)
    .sort((a, b) => a.blank - b.blank || a.name.localeCompare(b.name))
    .map(g => ({ customer: g.name, ...summarise(g.list) }));
  const total = summarise(stats);

  return {
    reportDate,
    month,
    monthLabel: monthLabel(month),
    targetDays,
    header: {
      waiting: waitingItems.length,
      overdue: waitingItems.filter(r => r.overdue).length,
      approved: total.approved,
      avgDays: total.avgDays,
    },
    waiting,
    lastMonth: { rows: lastMonthRows, total },
    footnotes: {
      excludedFromAverage: stats.filter(s => s.approved && s.days === null).length,
      rejectionsNote: REJECTIONS_NOTE,
    },
  };
}

async function loadSampleApproval(db, { reportDate = todayLocal(), month = previousMonth(reportDate), targetDays = 14 } = {}) {
  const { rows, trials } = await loadFollowupRows(db);
  const [from, to] = monthRange(month);
  const found = await db.query(
    `SELECT DISTINCT order_id, MIN(changed_at::date) AS date FROM order_changes
      WHERE field_name = 'Sample Status' AND new_value = 'Rejected'
        AND changed_at::date BETWEEN $1 AND $2
      GROUP BY order_id`,
    [from, to]
  );
  const rejections = found.rows.map(r => ({ orderId: r.order_id, date: dayOf(r.date) || text(r.date) }));
  return buildSampleApproval({ rows, trials, rejections, reportDate, month, targetDays });
}

module.exports = { previousMonth, isMonth, monthLabel, buildSampleApproval, loadSampleApproval };
