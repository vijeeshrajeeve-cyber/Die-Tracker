import React from 'react';
import { ClipboardCheck } from 'lucide-react';

// "These are waiting on you." Rendered as nothing when the queue is empty —
// unlike FocPendingPanel, whose zero is itself an answer, an empty approval
// queue is just noise on a page you are already looking at.
export default function ApprovalQueueBanner({ qds = [], theme = {}, onOpen }) {
  if (!qds.length) return null;

  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  return (
    <div style={{ border: '1px solid rgba(234,179,8,0.35)', background: 'rgba(234,179,8,0.08)', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
      <style>{`.qd-approval-row:hover { background: rgba(234,179,8,0.10); }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <ClipboardCheck size={16} style={{ color: '#EAB308' }} />
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#EAB308', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Awaiting your approval
        </span>
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: '#EAB308', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {qds.length}
        </span>
      </div>
      {qds.map((q) => (
        <div key={q.id} className="qd-approval-row" onClick={() => onOpen && onOpen(q.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 6px', borderRadius: 8, cursor: onOpen ? 'pointer' : 'default' }}>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: text, minWidth: 96 }}>{q.qd_no || '—'}</span>
          <span style={{ fontSize: 12.5, color: muted }}>Die {q.die_no}</span>
          <span style={{ fontSize: 12.5, color: muted }}>{q.supplier}</span>
          <span style={{ fontSize: 11.5, color: dim, marginLeft: 'auto' }}>
            {q.prepared_by ? `from ${q.prepared_by}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
