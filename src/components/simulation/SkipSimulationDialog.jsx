import React, { useState } from 'react';
import useDialog from '../../hooks/useDialog';

const REASON_MAX = 500;

// Simulation was required but will not be run. The reason is the record of
// why, so it is required; the order keeps "Simulation required". Rendered only
// while open, so the reason starts empty each time.
export default function SkipSimulationDialog({ dieNo, busy, onSkip, onClose }) {
  const [reason, setReason] = useState('');
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !busy });
  const ready = reason.trim() !== '' && !busy;

  const submit = (event) => {
    event.preventDefault();
    if (ready) onSkip(reason.trim());
  };

  return (
    <div className="sim-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form ref={dialogRef} className="sf-card sim-dialog sim-step-form" role="dialog" aria-modal="true"
        aria-labelledby="sim-skip-title" onSubmit={submit}>
        <h2 id="sim-skip-title">Skip simulation for {dieNo || 'this die'}</h2>
        <p className="sf-dim">The order moves to Design Approval and stays marked Simulation required.</p>
        <div className="sf-field">
          <label htmlFor="sim-skip-reason">Reason</label>
          <textarea id="sim-skip-reason" rows={3} value={reason} maxLength={REASON_MAX} required
            placeholder="Why is this die not being simulated?" onChange={e => setReason(e.target.value)} />
        </div>
        <div className="sim-dialog-actions">
          <button type="button" className="sf-button sf-button-sm" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="sf-button sf-button-sm sf-button-accent" disabled={!ready}>
            {busy ? 'Saving…' : 'Skip simulation'}
          </button>
        </div>
      </form>
    </div>
  );
}
