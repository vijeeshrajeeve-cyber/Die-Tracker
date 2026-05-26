import React from 'react';

const normalizeOrderUrgency = (raw) => {
  const s = String(raw ?? 'NORMAL').trim().toUpperCase().replace(/\s+/g, '_');
  if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
  if (s === 'URGENT') return 'URGENT';
  return 'NORMAL';
};

export function DieAttentionLabels({ order, dense }) {
  const top = normalizeOrderUrgency(order?.Urgency) === 'TOP_URGENT';
  const spec = !!(order?.specialFollowUp === true || order?.specialFollowUp === 1);
  if (!top && !spec) return null;

  const chipBase = {
    display: 'inline-block',
    borderRadius: dense ? '4px' : '6px',
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    fontSize: dense ? '0.58rem' : '0.65rem',
    padding: dense ? '2px 5px' : '3px 8px',
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: dense ? 3 : 6, alignItems: 'center', marginBottom: dense ? 2 : 4, lineHeight: 1.2 }}>
      {top && <span style={{ ...chipBase, background: 'rgba(239,68,68,0.22)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.35)' }}>Top urgent</span>}
      {spec && <span style={{ ...chipBase, background: 'rgba(245,158,11,0.18)', color: '#FBBF24', border: '1px solid rgba(245,158,11,0.35)' }}>Special follow-up</span>}
    </div>
  );
}

export { normalizeOrderUrgency };
export default DieAttentionLabels;
