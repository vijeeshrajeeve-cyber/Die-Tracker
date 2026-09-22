import { BUCKETS } from './view';

export default function DeadlineFilters({ bucket, counts, onChange }) {
  return <div className="wq-buckets" role="group" aria-label="Filter by deadline">
    {BUCKETS.map(({ key, label, hint }) => <button type="button" key={key}
      aria-pressed={bucket === key} className={`wq-bucket wq-tone-${key}${bucket === key ? ' is-selected' : ''}`}
      onClick={() => onChange(bucket === key ? 'all' : key)}>
      <span className="wq-bucket-label"><span className="wq-dot" />{label}</span>
      <strong>{counts?.[key] ?? '—'}</strong><small>{hint}</small>
    </button>)}
  </div>;
}
