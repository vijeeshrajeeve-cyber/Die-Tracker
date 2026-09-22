import { ArrowUpRight, Inbox } from 'lucide-react';
import { BUCKETS, dateLabel, deadlineState, ownerLabel, sourceLabel } from './view';

export default function WorkQueueTable({ items, loading, onSelect, scope }) {
  if (!items.length) return <div className="wq-empty">
    <Inbox size={32} aria-hidden="true" />
    <h2>{loading ? 'Loading your work…' : scope === 'mine' ? 'No matching work assigned to you' : 'No matching work items'}</h2>
    <p>{loading ? 'Checking current stages and deadlines.' : 'Try another scope or clear your filters. New stage work appears here automatically.'}</p>
  </div>;
  return <div className="wq-table-scroll" tabIndex={0} role="region" aria-label="Work items">
    <table className="wq-table">
      <thead><tr><th>Die / profile</th><th>Next action</th><th>Owner</th><th>Deadline</th><th><span className="wq-sr-only">Actions</span></th></tr></thead>
      <tbody>{items.map(item => {
        const state = deadlineState(item);
        return <tr key={item.id}>
          <td><button className="wq-record-link" type="button" onClick={() => onSelect(item.id)}>{item.die_no || item.profile || `Record ${item.source_id}`}</button>
            <small>{item.plant || 'Plant not set'}{item.supplier ? ` · ${item.supplier}` : ''}</small></td>
          <td><strong>{item.stage_label || item.stage_key}</strong><small>{sourceLabel(item.source_kind)}{item.occurrence ? ` · occurrence ${item.occurrence}` : ''}</small></td>
          <td><span className={item.owner_id ? '' : 'wq-muted'}>{ownerLabel(item)}</span>
            {item.owner_mode === 'source' && <small>From source workflow</small>}</td>
          <td><span className={`wq-status wq-tone-${state}`}>{BUCKETS.find(b => b.key === state)?.label || state}</span>
            <small>{item.due_at || item.due_date ? `${dateLabel(item.due_date || item.due_at, item.timezone)} · ${item.cutoff || '17:00'}` : item.setup_reason || 'Deadline not available'}</small>
            {item.first_breached_at && state !== 'overdue' && <small className="wq-breach">Earlier breach recorded</small>}</td>
          <td><button type="button" className="wq-button wq-button-small" onClick={() => onSelect(item.id)} aria-label={`Open ${item.die_no || item.profile || item.source_id}: ${item.stage_label || item.stage_key}`}>Open<ArrowUpRight size={14} aria-hidden="true" /></button></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
