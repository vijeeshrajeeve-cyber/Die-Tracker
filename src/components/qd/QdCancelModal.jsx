import React, { useState } from 'react';
import { X } from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import useDialog from '../../hooks/useDialog';
import { QD_UNNUMBERED } from '../../utils/constants';

// Withdraws a QD that has not been approved. One required reason; nothing is
// deleted, so there is no second confirmation.
export default function QdCancelModal({ qd, theme = {}, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useDialog({ open: true, onClose, closeOnEscape: true });

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const inputBg = theme.inputBg || '#09090b';
  const canGo = !!reason.trim() && !busy;

  const submit = async () => {
    if (!canGo) return;
    setBusy(true);
    setError('');
    try {
      const r = await qualityDiscrepanciesAPI.cancel(qd.id, reason.trim());
      await onDone(r);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not cancel this QD');
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Cancel QD" tabIndex={-1} onClick={(e) => e.stopPropagation()}
        style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 460, maxWidth: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'qdSlideIn 0.2s ease-out', color: text, outline: 'none' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>Cancel QD</div>
            <div style={{ fontSize: '0.8rem', color: dim, marginTop: 6 }}>{qd.qd_no || QD_UNNUMBERED} · die {qd.die_no}</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ width: 32, height: 32, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: muted, lineHeight: 1.5 }}>
            This QD leaves the approval queue. Nothing is deleted — it stays readable under "Show cancelled".
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }} htmlFor="qd-cancel-reason">
              Reason <span style={{ color: '#FCA5A5' }}>*</span>
            </label>
            <input id="qd-cancel-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="e.g. Raised twice against the same die"
              style={{ padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%' }} />
          </div>
          {error && <div style={{ fontSize: '0.78rem', color: '#FCA5A5' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${border}` }}>
          <button onClick={onClose}
            style={{ padding: '9px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: muted, fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }}>Keep</button>
          <button onClick={submit} disabled={!canGo}
            style={{ padding: '9px 18px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: canGo ? 'pointer' : 'not-allowed', opacity: canGo ? 1 : 0.55 }}>
            {busy ? 'Cancelling…' : 'Cancel QD'}
          </button>
        </div>
      </div>
    </div>
  );
}
