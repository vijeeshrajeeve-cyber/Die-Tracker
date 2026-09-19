import React from 'react';
import { CalendarCheck } from 'lucide-react';
import { useStampToday } from './useStampToday';

export default function StampTodayButton({ compact = false, label, ...options }) {
  const { stamp, busy } = useStampToday({ label, ...options });

  return (
    <button
      onClick={stamp}
      disabled={busy}
      title={`Set ${label} to today`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: compact ? '4px 6px' : '8px 12px',
        background: 'rgba(8,145,178,0.15)', border: '1px solid #0891B2',
        borderRadius: '6px', color: '#0891B2', fontWeight: 600,
        fontSize: compact ? '0.7rem' : '0.8rem',
        cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <CalendarCheck size={compact ? 12 : 14} />
      {compact ? '' : 'Today'}
    </button>
  );
}
