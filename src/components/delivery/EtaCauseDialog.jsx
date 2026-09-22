import React, { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { CAUSES } from '../../utils/deliveryFollowup';
import { formatDate } from '../../utils/helpers';

// Asked when the order form saves a changed ETA over a real one. The server
// refuses the change without a cause, so this is the only way through.
export default function EtaCauseDialog({ theme, fromEta, toEta, onCancel, onConfirm }) {
  const [cause, setCause] = useState('');
  const [note, setNote] = useState('');
  const ready = !!cause && (cause !== 'other' || !!note.trim());
  const field = { width: '100%', padding: '9px 11px', background: theme?.inputBg || '#0F172A', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', color: theme?.text || '#F1F5F9', fontSize: '0.875rem', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-labelledby="eta-cause-title" style={{ background: theme?.cardBg || '#1E293B', borderRadius: '16px', width: '100%', maxWidth: '440px', border: `1px solid ${theme?.cardBorder || '#334155'}`, overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}`, background: 'rgba(217,119,6,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CalendarClock size={18} color="white" />
          </div>
          <div>
            <h3 id="eta-cause-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: theme?.text || '#F1F5F9' }}>Why did the ETA move?</h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: theme?.textDim || '#64748B' }}>
              {formatDate(fromEta)} → {toEta ? formatDate(toEta) : 'no date'}
            </p>
          </div>
        </div>
        <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gap: '10px' }}>
          <select aria-label="Cause" autoFocus value={cause} onChange={(e) => setCause(e.target.value)} style={field}>
            <option value="">Pick a cause…</option>
            {CAUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <textarea aria-label="Note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={cause === 'other' ? 'Say what the cause is (required)' : 'Note (optional)'} style={{ ...field, resize: 'vertical' }} />
        </div>
        <div style={{ padding: '0 1.5rem 1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', color: theme?.textDim || '#64748B', fontSize: '0.875rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" disabled={!ready} onClick={() => onConfirm({ cause, note: note.trim() })}
            style={{ padding: '8px 18px', background: ready ? '#D97706' : '#334155', border: 'none', borderRadius: '8px', color: 'white', fontSize: '0.875rem', cursor: ready ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
            Save with this cause
          </button>
        </div>
      </div>
    </div>
  );
}
