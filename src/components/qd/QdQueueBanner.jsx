import React from 'react';
import { ClipboardCheck, CornerUpLeft } from 'lucide-react';

// One bucket of "things you owe", rendered as nothing when empty — unlike
// FocPendingPanel, whose zero is itself an answer, an empty queue is just noise
// on a page you are already looking at.
const TONES = {
  amber: { border: 'rgba(234,179,8,0.35)', bg: 'rgba(234,179,8,0.08)', fg: '#EAB308', hover: 'rgba(234,179,8,0.10)', Icon: ClipboardCheck },
  red:   { border: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.08)', fg: '#F87171', hover: 'rgba(239,68,68,0.10)', Icon: CornerUpLeft },
};

export default function QdQueueBanner({ title, tone = 'amber', qds = [], theme = {}, onOpen }) {
  if (!qds.length) return null;

  const t = TONES[tone] || TONES.amber;
  const Icon = t.Icon;
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const rowClass = `qd-queue-row-${tone}`;

  return (
    <div style={{ border: `1px solid ${t.border}`, background: t.bg, borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
      <style>{`.${rowClass}:hover { background: ${t.hover}; }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <Icon size={16} style={{ color: t.fg }} />
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: t.fg, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.fg, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {qds.length}
        </span>
      </div>
      {qds.map((q) => (
        <div key={q.id} className={rowClass} onClick={() => onOpen && onOpen(q.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 6px', borderRadius: 8, cursor: onOpen ? 'pointer' : 'default' }}>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: text, minWidth: 96 }}>{q.qd_no || '—'}</span>
          <span style={{ fontSize: 12.5, color: muted }}>Die {q.die_no}</span>
          <span style={{ fontSize: 12.5, color: muted }}>{q.supplier}</span>
          {/* Why it came back, so the raiser can triage without opening each one. */}
          <span style={{ fontSize: 11.5, color: dim, marginLeft: 'auto', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {q.sent_back_reason ? q.sent_back_reason : (q.prepared_by ? `from ${q.prepared_by}` : '')}
          </span>
        </div>
      ))}
    </div>
  );
}
