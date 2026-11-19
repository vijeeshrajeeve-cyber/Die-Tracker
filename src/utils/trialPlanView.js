// Pure helpers for the Trial Plan and Summary tabs of Sample Followup. The
// server owns the rules (what is a valid entry, when a plan locks, how the
// totals are counted); this file only shapes what the page shows.

const pad2 = (n) => String(n).padStart(2, '0');

// Calendar arithmetic on 'YYYY-MM-DD', anchored at UTC so a time zone can never
// move the answer by a day. Mirrors addDays in server/services/trialPlans.cjs.
export const addDays = (isoDay, days) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utcOf = (isoDay) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

// 'Thu 19 Nov 2026'
export const formatPlanDate = (isoDay) => {
  if (!isoDay) return '';
  const date = utcOf(isoDay);
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

// '19 Nov'
export const formatShortDate = (isoDay) => {
  if (!isoDay) return '';
  const date = utcOf(isoDay);
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
};

// How a day relates to today, in the words the date bar uses.
export const relativeDayLabel = (isoDay, today) => {
  if (isoDay === today) return 'Today';
  if (isoDay === addDays(today, 1)) return 'Tomorrow';
  if (isoDay === addDays(today, -1)) return 'Yesterday';
  return isoDay < today ? 'Past plan' : 'Future plan';
};

// The reporting week is Monday to Saturday. A Sunday belongs to the week that
// ended the day before, so it is never a week on its own.
export const WEEK_DAYS = 6;

export const periodRange = (kind, anchor) => {
  if (kind === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    const from = `${y}-${pad2(m)}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from, to: `${y}-${pad2(m)}-${pad2(last)}` };
  }
  const weekday = utcOf(anchor).getUTCDay(); // 0 Sun .. 6 Sat
  const back = weekday === 0 ? 6 : weekday - 1;
  const from = addDays(anchor, -back);
  return { from, to: addDays(from, WEEK_DAYS - 1) };
};

// The period just before the one that starts at `from`.
export const previousPeriod = (kind, from) => periodRange(kind, addDays(from, -1));
export const nextPeriod = (kind, to) => periodRange(kind, addDays(to, kind === 'week' ? 2 : 1));

export const periodLabel = (kind, { from, to }) => {
  if (kind === 'month') {
    const date = utcOf(from);
    return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  return `${formatShortDate(from)} – ${formatShortDate(to)} ${utcOf(to).getUTCFullYear()}`;
};

// Die numbers are written with either a hyphen or an underscore.
export const dieKey = (value) => String(value || '').trim().replace(/_/g, '-').toLowerCase();

const numericCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// A die is waiting for trial when it has reached the plant and its sample has
// not been submitted yet.
export const isWaitingForTrial = (sample) => Boolean(sample) && sample.stage === 'Pending' && Boolean(sample.die_received_date);

// The "Available to plan" list: waiting dies not already on this day's plan,
// longest wait first.
export const availableToPlan = (samples, entries, { plant = 'All' } = {}) => {
  const planned = new Set((entries || []).map(e => dieKey(e.die_no)));
  return (samples || [])
    .filter(s => isWaitingForTrial(s) && s.die && !planned.has(dieKey(s.die)))
    .filter(s => plant === 'All' || (s.plant || '').trim() === plant)
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || numericCompare(String(a.die), String(b.die)));
};

// Every die, in any stage, matching a search; for "Add another die".
export const searchSamples = (samples, query, entries, limit = 8) => {
  const q = dieKey(query);
  if (!q) return [];
  const planned = new Set((entries || []).map(e => dieKey(e.die_no)));
  return (samples || [])
    .filter(s => s.die && !planned.has(dieKey(s.die)))
    .filter(s => [s.die, s.customer].some(v => dieKey(v).includes(q)))
    .slice(0, limit);
};

// A Trial entry for a die that is not waiting for trial (submitted, approved,
// or with no record in the app) has to say why it is on the plan. A supervised
// run is a production run, not a trial, so it needs no reason.
export const needsOutOfQueueReason = (sample, entryType) => entryType === 'Trial' && !isWaitingForTrial(sample);

// Which record a trial written from the plan hangs off.
export const parentOf = (sample) => {
  if (!sample) return {};
  if (sample._source === 'order' && sample._order?.id) return { die_order_id: sample._order.id };
  if (sample._source === 'standalone' && sample._raw?.id) return { sample_followup_id: sample._raw.id };
  return {};
};

// The new entry, copied from the die record. Tooling comes from the die's
// tooling links; alloy from the last time the die was planned.
export const entryFromSample = (sample, { toolings = [], alloy = null, entryType = 'Trial', urgent = false, reason = null } = {}) => ({
  die_no: sample.die,
  entry_type: entryType,
  urgent,
  ...parentOf(sample),
  plant: sample.plant || null,
  press: sample.press || null,
  customer: sample.customer || null,
  corrector: sample.corrector || null,
  tooling: toolings.filter(Boolean).join(', ').slice(0, 120) || null,
  alloy: alloy || null,
  out_of_queue_reason: reason || null,
});

// The editable fields of an entry, as the PUT expects them.
export const editableFields = (entry) => ({
  entry_type: entry.entry_type,
  urgent: Boolean(entry.urgent),
  plant: entry.plant || '',
  press: entry.press || '',
  customer: entry.customer || '',
  alloy: entry.alloy || '',
  tooling: entry.tooling || '',
  corrector: entry.corrector || '',
  out_of_queue_reason: entry.out_of_queue_reason || '',
});

// Entries grouped under their press, presses in number order.
export const groupByPress = (entries) => {
  const groups = new Map();
  for (const entry of entries || []) {
    const press = (entry.press || '').trim() || 'No press';
    if (!groups.has(press)) groups.set(press, []);
    groups.get(press).push(entry);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'No press') - (b === 'No press') || numericCompare(a, b))
    .map(([press, rows]) => ({
      press,
      rows,
      trials: rows.filter(r => r.entry_type !== 'Supervised').length,
      supervised: rows.filter(r => r.entry_type === 'Supervised').length,
    }));
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const pressNote = ({ trials, supervised }) =>
  [trials ? plural(trials, 'trial') : null, supervised ? `${supervised} supervised` : null].filter(Boolean).join(' · ');

// die_no -> 'also on Press 5' for each entry whose tooling is planned on
// another press the same day.
export const toolingClashNotes = (entries, checks) => {
  const notes = new Map();
  for (const check of checks || []) {
    if (check.kind !== 'tooling') continue;
    for (const entry of entries || []) {
      if (!check.dies.includes(entry.die_no)) continue;
      const own = (entry.press || '').trim() || 'No press';
      const others = check.presses.filter(p => p !== own);
      if (others.length) notes.set(entry.die_no, `also on ${others.join(', ')}`);
    }
  }
  return notes;
};

// One sentence per check, for the card above the plan.
export const checkSentence = (check) => {
  if (check.kind === 'tooling') {
    return `${check.tooling} is planned on ${check.presses.join(' and ')} the same day.`;
  }
  if (check.kind === 'corrector') {
    return `${check.corrector} has ${check.count} dies on this plan.`;
  }
  return '';
};

// The result chip for an entry: label and tone.
export const resultOf = (entry) => {
  const supervised = entry.entry_type === 'Supervised';
  if (entry.outcome === 'OK') return { label: supervised ? 'Run OK' : 'OK', tone: 'ok' };
  if (entry.outcome === 'Not OK') {
    return { label: entry.fail_reason ? `Not OK · ${shortReason(entry.fail_reason)}` : 'Not OK', tone: 'bad' };
  }
  if (entry.outcome === 'Not run') return { label: 'Not run', tone: 'neutral' };
  return { label: 'Awaiting result', tone: 'waiting' };
};

const SHORT_REASONS = {
  'Dimension Out of Spec': 'Dimension',
  'Aesthetic Out of Spec': 'Aesthetic',
};
export const shortReason = (reason) => SHORT_REASONS[reason] || reason;

// '25%' or '—' for a ratio the server could not compute (nothing to divide by).
export const showPct = (value) => (value === null || value === undefined ? '—' : `${value}%`);

// The change against the previous period, as text and direction. `better` is
// which way is good for this figure.
export const delta = (current, previous, { better = 'up', unit = '' } = {}) => {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const diff = current - previous;
  if (diff === 0) return { text: 'same as before', tone: 'flat' };
  const good = better === 'up' ? diff > 0 : diff < 0;
  return { text: `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit} vs previous`, tone: good ? 'good' : 'bad' };
};

// The rows for an Excel export of one day's plan.
export const planExportRows = (entries) => groupByPress(entries).flatMap(group => group.rows.map(entry => ({
  press: group.press,
  die_no: entry.die_no,
  customer: entry.customer || '',
  entry_type: entry.entry_type,
  urgent: entry.urgent ? 'Yes' : '',
  alloy: entry.alloy || '',
  tooling: entry.tooling || '',
  corrector: entry.corrector || '',
  out_of_queue_reason: entry.out_of_queue_reason || '',
  result: entry.outcome ? resultOf(entry).label : '',
  comments: entry.comments || '',
})));
