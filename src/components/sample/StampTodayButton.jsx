import React, { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { dialogs } from '../ui/DialogProvider';
import { advanceStatus } from '../../utils/sampleStatus';
import { todayLocal } from '../../utils/today.js';
import { formatDate } from '../../utils/helpers';

const day = (v) => (v ? String(v).slice(0, 10) : '');

// Stamps today's date on one field and advances Status when the ladder allows.
//
// The two move together or not at all: one save, and declining the overwrite
// confirm abandons both. The toast always names what happened to the status,
// including when nothing moved — otherwise a user on a Rejected record would
// assume the status followed the date.
export default function StampTodayButton({
  sf, dateField, snakeDateField, targetStatus, label,
  currentDate, currentStatus, onSave, setToast, compact = false,
}) {
  const [busy, setBusy] = useState(false);

  const notify = (message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 5000 : 4000);
  };

  const stamp = async () => {
    const value = todayLocal();
    const existing = day(currentDate);

    if (existing && existing !== value) {
      const ok = await dialogs.confirm({
        title: `Replace the ${label.toLowerCase()}?`,
        message: `This record already has ${formatDate(existing)}. Replace it with today, ${formatDate(value)}?`,
        confirmLabel: 'Replace date',
        tone: 'warning',
      });
      if (!ok) return;
    }

    const newStatus = advanceStatus(currentStatus, targetStatus);
    setBusy(true);
    try {
      await onSave(sf, { dateField, snakeDateField, dateValue: value, newStatus });
      notify(
        newStatus
          ? `${label} set to ${formatDate(value)} — status moved to ${newStatus}`
          : `${label} set to ${formatDate(value)} — status unchanged`,
        'success'
      );
    } catch (error) {
      notify(`Failed to set ${label.toLowerCase()}: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

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
