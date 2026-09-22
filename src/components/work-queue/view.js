export const BUCKETS = [
  { key: 'overdue', label: 'Overdue', hint: 'Needs attention' },
  { key: 'today', label: 'Due today', hint: 'Before plant cutoff' },
  { key: 'upcoming', label: 'Upcoming', hint: 'Plan your next steps' },
  { key: 'setup', label: 'Needs setup', hint: 'Date or rule to review' },
  { key: 'paused', label: 'Paused', hint: 'Waiting with a reason' },
];

export function dateLabel(value, timezone = 'Asia/Dubai', includeTime = false) {
  if (!value) return 'Not set';
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const parsed = new Date(isDate ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return 'Date needs review';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: isDate ? 'UTC' : timezone,
      ...(!isDate && includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(parsed);
  } catch { return 'Timezone needs review'; }
}

export function deadlineState(item) {
  // The API classifies against its query snapshot and the plant's timezone.
  return item.deadline_state || item.bucket || (item.state === 'paused' ? 'paused' : 'setup');
}

export function sourceLabel(kind) {
  return ({ order: 'Order', sample: 'Standalone sample', sample_followup: 'Standalone sample', qd: 'Quality discrepancy' })[kind] || kind || 'Source record';
}

export const ownerLabel = item => item.owner_name || (item.owner_mode === 'eligible_approver' || (item.stage_key === 'qd_approval' && !item.owner_id) ? 'Eligible approver queue' : 'Unassigned');

export function deadlineBasis(item) {
  if (item.deadline_basis === 'eta' || item.deadline_basis === 'explicit_eta') return 'Supplier promise · update the ETA in the source record';
  const policy = item.policy_snapshot || {};
  const days = item.target_days || policy.target_days || policy.targetDays || policy.days;
  const basis = item.deadline_basis || policy.basis || policy.day_mode;
  if (days) return `${days} ${['calendar_days', 'calendar'].includes(basis) ? 'calendar' : 'working'} day${days === 1 ? '' : 's'} after stage entry`;
  return item.setup_reason || 'Stage deadline from its saved policy';
}
