import React from 'react';

const normalizeOrderUrgency = (raw) => {
  const s = String(raw ?? 'NORMAL').trim().toUpperCase().replace(/\s+/g, '_');
  if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
  if (s === 'URGENT') return 'URGENT';
  return 'NORMAL';
};

const chipStyle = (dense) => ({
  display: 'inline-block',
  borderRadius: dense ? '4px' : '6px',
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  fontSize: dense ? '0.58rem' : '0.65rem',
  padding: dense ? '2px 5px' : '3px 8px',
});

// The Design enhancement tag. Its colours come from CSS variables the app
// shell sets from the active theme (DieOrderingSystem), so one chip reads in
// both light and dark; the fallbacks are the dark values.
const ENHANCEMENT_STYLE = {
  background: 'var(--tag-enhancement-bg, rgba(31,111,176,0.22))',
  color: 'var(--tag-enhancement-fg, #7DB8E8)',
  border: '1px solid var(--tag-enhancement-border, rgba(125,184,232,0.4))',
};
// eslint-disable-next-line react-refresh/only-export-components
export const isEnhancementOrder = (order) => order?.designEnhancement === true || order?.designEnhancement === 1;

export function EnhancementTag({ dense }) {
  return <span style={{ ...chipStyle(dense), ...ENHANCEMENT_STYLE }}>Enhancement</span>;
}

export function DieAttentionLabels({ order, dense }) {
  const top = normalizeOrderUrgency(order?.Urgency) === 'TOP_URGENT';
  const spec = !!(order?.specialFollowUp === true || order?.specialFollowUp === 1);
  const enhancement = isEnhancementOrder(order);
  if (!top && !spec && !enhancement) return null;

  const chipBase = chipStyle(dense);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: dense ? 3 : 6, alignItems: 'center', marginBottom: dense ? 2 : 4, lineHeight: 1.2 }}>
      {top && <span style={{ ...chipBase, background: 'rgba(239,68,68,0.22)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.35)' }}>Top urgent</span>}
      {spec && <span style={{ ...chipBase, background: 'rgba(245,158,11,0.18)', color: '#FBBF24', border: '1px solid rgba(245,158,11,0.35)' }}>Special follow-up</span>}
      {enhancement && <EnhancementTag dense={dense} />}
    </div>
  );
}

export { normalizeOrderUrgency };
export default DieAttentionLabels;
