import React from 'react';
import useDialog from '../../hooks/useDialog';
import FindToolingPanel from './FindToolingPanel';

// Find tooling in its own window over the order form: the matching toolings on the left, the
// similar profiles on the right, each scrolling on its own, so the form behind keeps its place.
// Takes FindToolingPanel's props; `note` is an optional line under the panel's header (the
// backup form's "Current tooling: …"); `footer` says what the form holds now.
export default function FindToolingWindow({ c, onClose, note = null, footer = null, ...panelProps }) {
  const dialogRef = useDialog({ open: true, onClose });
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: c.overlay || 'rgba(0, 0, 0, 0.55)' }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Find tooling"
        style={{
          display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 1320, height: '92vh', borderRadius: 16, overflow: 'hidden',
          background: c.inset, border: `1px solid ${c.border}`, boxShadow: c.shadowLg || '0 24px 64px rgba(0, 0, 0, 0.45)', color: c.text,
        }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <FindToolingPanel {...panelProps} c={c} onClose={onClose} wide note={note} />
        </div>
        <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: `1px solid ${c.border}`, background: c.bg }}>
          <div role="status" style={{ flex: 1, minWidth: 0, fontSize: 12, color: c.muted, overflowWrap: 'anywhere' }}>{footer}</div>
          <button
            type="button"
            onClick={onClose}
            style={{ flexShrink: 0, padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: c.primary, color: c.primaryText || '#fff', border: `1px solid ${c.primary}` }}
          >
            Back to the form
          </button>
        </footer>
      </div>
    </div>
  );
}
