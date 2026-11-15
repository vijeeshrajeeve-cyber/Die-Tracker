// Client mirror of server/services/supplierDieLife.cjs (aggregateDieLife and
// validateEntry). The two must give the same answers; dieLifeCalc.test.js
// compares them. A blank is null ("not recorded") and is never summed or
// scored as 0; a typed 0 is a real zero.

export const COUNT_FIELDS = [
  'tonnageMt', 'diesScrapped', 'diesInService', 'diesFailed',
  'newDiesReceived', 'newDieTrials', 'backupDiesReceived', 'backupDieTrials',
];

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function calcDieLife(rows) {
  const totals = {};
  for (const f of COUNT_FIELDS) totals[f] = null;
  const add = (key, v) => { if (v !== null) totals[key] = (totals[key] || 0) + v; };

  let lifeT = 0, lifeS = 0, lifeRows = 0;
  let run = 0, unloaded = 0, anyRun = false;
  let newR = 0, newT = 0, bkR = 0, bkT = 0;
  let newRows = 0, bkRows = 0;

  for (const r of rows || []) {
    const v = {};
    for (const f of COUNT_FIELDS) { v[f] = num(r[f]); add(f, v[f]); }

    if (v.tonnageMt !== null && v.diesScrapped !== null) {
      lifeT += v.tonnageMt; lifeS += v.diesScrapped; lifeRows += 1;
    }
    if (v.diesInService !== null) {
      run += v.diesInService; anyRun = true;
      unloaded += v.diesFailed === null ? 0 : v.diesFailed;
    }
    if (v.newDiesReceived !== null && v.newDieTrials !== null) { newR += v.newDiesReceived; newT += v.newDieTrials; newRows += 1; }
    if (v.backupDiesReceived !== null && v.backupDieTrials !== null) { bkR += v.backupDiesReceived; bkT += v.backupDieTrials; bkRows += 1; }
  }

  const noDiesScrapped = lifeRows > 0 && lifeS === 0;
  const dieLife = lifeRows > 0 && lifeS > 0 ? lifeT / lifeS : null;
  const dieFailure = run > 0 ? (unloaded / run) * 100 : null;
  const ratio = (t, d) => (d > 0 ? t / d : null);

  return {
    dieLife, noDiesScrapped, dieFailure,
    newTrialRatio: ratio(newT, newR),
    backupTrialRatio: ratio(bkT, bkR),
    trialRatio: ratio(newT + bkT, newR + bkR),
    totals,
    // The sums the figures above were actually calculated from: only rows that
    // had both halves of a pair. Printing these beside a figure means the
    // counts always divide to it. Null when no row qualified.
    paired: {
      tonnageMt: lifeRows > 0 ? lifeT : null,
      diesScrapped: lifeRows > 0 ? lifeS : null,
      diesInService: anyRun ? run : null,
      diesFailed: anyRun ? unloaded : null,
      newDiesReceived: newRows > 0 ? newR : null,
      newDieTrials: newRows > 0 ? newT : null,
      backupDiesReceived: bkRows > 0 ? bkR : null,
      backupDieTrials: bkRows > 0 ? bkT : null,
    },
  };
}

export function formatDieLife(result) {
  if (result && result.noDiesScrapped) return 'no dies scrapped';
  if (!result || result.dieLife == null) return 'not recorded';
  return result.dieLife.toFixed(1);
}

const WHOLE = ['diesScrapped', 'diesInService', 'diesFailed', 'newDiesReceived', 'newDieTrials', 'backupDiesReceived', 'backupDieTrials'];

// Same rules as validateEntry, as { field: message } so the grid can mark the
// cell. Empty object means the row can be saved.
export function rowErrors(row) {
  const errors = {};
  const v = {};
  for (const f of COUNT_FIELDS) {
    const n = num(row && row[f]);
    v[f] = n;
    if (n === null) continue;
    if (!Number.isFinite(n)) errors[f] = 'Must be a number';
    else if (n < 0) errors[f] = 'Cannot be negative';
    else if (WHOLE.includes(f) && !Number.isInteger(n)) errors[f] = 'Must be a whole number';
  }
  const none = (x) => x === null || x === 0;
  if (!errors.diesFailed && v.diesFailed !== null) {
    if (none(v.diesInService)) errors.diesFailed = 'Needs dies run above zero. Leave both blank if there is nothing to record';
    else if (v.diesFailed > v.diesInService) errors.diesFailed = 'More dies unloaded than dies run';
  }
  if (!errors.newDieTrials && v.newDieTrials !== null && none(v.newDiesReceived)) {
    errors.newDieTrials = 'Needs new dies received above zero';
  }
  if (!errors.backupDieTrials && v.backupDieTrials !== null && none(v.backupDiesReceived)) {
    errors.backupDieTrials = 'Needs backup dies received above zero';
  }
  return errors;
}

export const supplierKey = (s) => String(s || '').trim().toUpperCase();

// Rows are kept under supplierKey(name): the server compares suppliers
// trimmed and case-insensitively and may return a differently cased name.

// Which figures feed the calculated cells. All plants is read-only and the
// server works its figures out per plant row before summing; summing first and
// calculating afterwards gives a different answer when a pair is one-sided
// across plants. A single plant is calculated live from the typed counts.
export function calculatedFor({ readOnly, row, counts }) {
  if (readOnly && row && row.calculated) return row.calculated;
  return calcDieLife([counts]);
}
