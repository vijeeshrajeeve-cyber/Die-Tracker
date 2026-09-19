export const SAMPLE_STATUSES = ['Pending', 'Sample Submitted', 'Approved', 'Rejected', 'On hold'];

// A die is late when more than this many days pass between receiving it and
// submitting the sample — or, while it is still unsubmitted, between receiving
// it and today.
export const SUBMISSION_TARGET_DAYS = 7;

// Five raw statuses, three stages. On hold has not been submitted yet, so it
// waits with Pending; Rejected was submitted and expects a re-trial, so it stays
// with Sample Submitted. The raw status is still what rows and pills show.
export const STAGES = ['Pending', 'Sample Submitted', 'Approved'];
const STAGE_OF = {
  'Pending': 'Pending',
  'On hold': 'Pending',
  'Sample Submitted': 'Sample Submitted',
  'Rejected': 'Sample Submitted',
  'Approved': 'Approved',
};
export const stageOf = (status) => STAGE_OF[status || 'Pending'] || 'Pending';

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole calendar days from a 'YYYY-MM-DD…' value, read as a date rather than
// an instant so the Dubai offset can never shift it by one.
const dayNumber = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
};

// Adds the derived fields the page sorts, bands and counts by. `days` is null
// when the received date is missing: an unknown wait is not a zero-day wait,
// and it is never counted as late.
export const enrichSample = (sample, today) => {
  const status = sample.status || 'Pending';
  const received = dayNumber(sample.die_received_date);
  // An approved die with no submission date (a skipped trial, an import) has
  // stopped waiting, but its submission day is unknown — not today.
  const end = dayNumber(sample.submission_date) ?? (status === 'Approved' ? null : dayNumber(today));
  const days = received === null || end === null ? null : Math.max(0, end - received);
  return {
    ...sample,
    status,
    profile: sample.profile || String(sample.die || '').split('-')[0],
    stage: stageOf(status),
    days,
    late: status !== 'Approved' && days !== null && days > SUBMISSION_TARGET_DAYS,
  };
};

export const plantOf = (sample) => (sample.plant || '').trim();

export const scopeSampleFollowups = (records, { search = '', plant = 'All' } = {}) => {
  const query = search.trim().toLowerCase();
  return records.filter(row =>
    (plant === 'All' || plantOf(row) === plant) &&
    (!query || [row.die, row.profile, row.customer, row.corrector]
      .some(value => String(value || '').toLowerCase().includes(query)))
  );
};

// Missing values sort last in every direction.
const lastIfMissing = (a, b, compare) => {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  return compare(a, b);
};
const byDaysDesc = (a, b) => lastIfMissing(a.days, b.days, (x, y) => y - x);

export const sortSampleFollowups = (records, sort) => [...records].sort((a, b) => {
  if (sort === 'received') {
    return lastIfMissing(dayNumber(a.die_received_date), dayNumber(b.die_received_date), (x, y) => y - x);
  }
  if (sort === 'plant') {
    return plantOf(a).localeCompare(plantOf(b), undefined, { numeric: true }) || byDaysDesc(a, b);
  }
  return byDaysDesc(a, b);
});

const BANDS = {
  'Pending': [
    { key: 'late', label: 'Overdue · past the 7-day line', tone: 'late', test: r => r.late },
    { key: 'inside', label: 'Still inside 7 days', tone: 'inside', test: r => !r.late },
  ],
  'Sample Submitted': [
    { key: 'late', label: 'Took more than 7 days', tone: 'late', test: r => r.late },
    { key: 'inside', label: 'Submitted inside 7 days', tone: 'inside', test: r => !r.late },
  ],
  'Approved': [
    { key: 'closed', label: 'Approved and closed', tone: 'closed', test: () => true },
  ],
};

// Groups one stage's (already sorted) rows around the 7-day line. Empty bands
// are dropped rather than shown with a zero.
export const bandsFor = (stage, rows) => (BANDS[stage] || [])
  .map(({ test, ...band }) => ({ ...band, rows: rows.filter(test) }))
  .filter(band => band.rows.length > 0);

export const stageSummary = (rows) => Object.fromEntries(STAGES.map(stage => {
  const inStage = rows.filter(r => r.stage === stage);
  return [stage, { count: inStage.length, late: inStage.filter(r => r.late).length }];
}));

const mean = (values) => (values.length
  ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
  : null);

// Mean received→submitted days for dies submitted in the last 90 days, and in
// the 90 days before that. Null when a window has no submissions — the card
// then says so instead of showing an invented number.
export const daysToSubmission = (rows, today) => {
  const now = dayNumber(today);
  const windowOf = (lo, hi) => rows
    .filter(r => r.days !== null && r.submission_date)
    .filter(r => { const d = dayNumber(r.submission_date); return d !== null && d > now - hi && d <= now - lo; })
    .map(r => r.days);
  return { current: mean(windowOf(0, 90)), previous: mean(windowOf(90, 180)) };
};

// Late dies against each plant's open (not yet approved) dies. Approved dies
// can never be late, so counting them would bury the ratio: a plant with 190
// closed dies would show 3 late as a sliver. Plants with nothing open drop out.
export const lateByPlant = (rows) => {
  const plants = new Map();
  for (const row of rows.filter(r => r.stage !== 'Approved')) {
    const plant = plantOf(row) || 'No plant';
    const entry = plants.get(plant) || { plant, late: 0, total: 0 };
    entry.total += 1;
    if (row.late) entry.late += 1;
    plants.set(plant, entry);
  }
  // Unnamed plants go last so the real plants read in order.
  return [...plants.values()].sort((a, b) =>
    (a.plant === 'No plant') - (b.plant === 'No plant') ||
    a.plant.localeCompare(b.plant, undefined, { numeric: true }));
};

// Whole days from a stored date to today; null when the date is missing.
export const daysSince = (value, today) => {
  const from = dayNumber(value);
  const to = dayNumber(today);
  return from === null || to === null ? null : Math.max(0, to - from);
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const sampleStatusClass = (status) => ({
  Pending: 'pending', 'Sample Submitted': 'submitted', Approved: 'approved',
  Rejected: 'rejected', 'On hold': 'hold',
}[status || 'Pending'] || 'hold');
