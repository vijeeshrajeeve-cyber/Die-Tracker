import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { deliveryFollowupsAPI } from '../../api';
import { formatDate } from '../../utils/helpers';
import useDialog from '../../hooks/useDialog';
import { CAUSES, needsCause, normalizeEta } from '../../utils/deliveryFollowup';

// Quick ETA entry from an In Manufacturing row. Moving an ETA that was
// already a real date asks why, as the follow-up drawer does.

export default function SetEtaDialog({ order, theme, onClose, onSaved }) {
  const current = normalizeEta(order.ETA);
  const [eta, setEta] = useState(current || '');
  const [cause, setCause] = useState('');
  const [causeNote, setCauseNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const firstField = useRef(null);
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !saving });

  useEffect(() => { firstField.current?.focus(); }, []);

  const showCause = !!eta && needsCause(order.ETA, eta);

  const submit = async (e) => {
    e.preventDefault();
    if (!normalizeEta(eta)) { setError('Pick the ETA date'); return; }
    if (normalizeEta(eta) === current) { onClose(); return; }
    if (showCause) {
      if (!CAUSES.some((c) => c.value === cause)) { setError('Pick the cause of the ETA change'); return; }
      if (cause === 'other' && !causeNote.trim()) { setError('Say what the other cause is'); return; }
    }
    setSaving(true);
    setError('');
    try {
      const result = await deliveryFollowupsAPI.setEta(order.id, {
        eta, cause: showCause ? cause : undefined, causeNote: showCause ? causeNote : undefined,
      });
      onSaved(result);
    } catch (err) {
      setError(err.message || 'Could not save the ETA');
      setSaving(false);
    }
  };

  const field = { width: '100%', padding: '9px 11px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', boxSizing: 'border-box' };
  const label = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: theme.textMuted, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="set-eta-title" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(380px, 100%)', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', boxShadow: '0 16px 40px rgba(0,0,0,0.3)' }}>
        <header style={{ padding: '1rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <h2 id="set-eta-title" style={{ margin: 0, fontSize: '1rem', color: theme.text }}>Set ETA · <span style={{ fontFamily: 'monospace' }}>{order['DIE NO']}</span></h2>
            <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: theme.textMuted }}>
              {order.Supplier || 'No supplier'} · current {current ? formatDate(current) : (order.ETA || 'none')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer', padding: '4px' }}><X size={20} /></button>
        </header>
        <form onSubmit={submit} style={{ display: 'grid', gap: '10px', padding: '1rem 1.25rem' }}>
          <div>
            <label style={label} htmlFor="set-eta-date">ETA</label>
            <input ref={firstField} id="set-eta-date" type="date" value={eta} onChange={(e) => setEta(e.target.value)} style={field} />
          </div>
          {showCause && (
            <div style={{ display: 'grid', gap: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)' }}>
              <div>
                <label style={label} htmlFor="set-eta-cause">Why did the ETA move?</label>
                <select id="set-eta-cause" value={cause} onChange={(e) => setCause(e.target.value)} style={field}>
                  <option value="">Pick a cause…</option>
                  {CAUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={label} htmlFor="set-eta-cause-note">Cause note{cause === 'other' ? ' (required)' : ' (optional)'}</label>
                <input id="set-eta-cause-note" type="text" value={causeNote} onChange={(e) => setCauseNote(e.target.value)} style={field} />
              </div>
            </div>
          )}
          {error && <p role="alert" style={{ margin: 0, color: '#DC2626', fontSize: '0.8rem' }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: '9px 16px', borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, background: 'transparent', color: theme.text, cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#0F766E', color: 'white', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save ETA'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
