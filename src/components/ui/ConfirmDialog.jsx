import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, HelpCircle } from 'lucide-react';
import useDialog from '../../hooks/useDialog';

// Semantic, not brand: these survive a rebrand because they encode "this
// destroys something" rather than "this is our colour".
const TONES = {
  danger: { accent: '#EF4444', ring: 'rgba(239,68,68,0.16)', Icon: Trash2 },
  warning: { accent: '#F59E0B', ring: 'rgba(245,158,11,0.16)', Icon: AlertTriangle },
  neutral: { accent: '#71717a', ring: 'rgba(113,113,122,0.16)', Icon: HelpCircle },
};

/**
 * Replaces window.confirm. Unlike the native dialog this is themed, does not
 * block the JS thread, names the action on its own button ("Delete order"
 * rather than "OK"), and is keyboard-complete via useDialog.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
  theme = {},
}) {
  const titleId = useId();
  const descId = useId();
  // Escape must not dismiss a dialog whose action is already in flight.
  const dialogRef = useDialog({ open, onClose: onCancel, closeOnEscape: !busy });

  if (!open) return null;

  const { accent, ring, Icon } = TONES[tone] || TONES.danger;
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const surface = theme.cardBg || '#131316';
  const border = theme.cardBorder || '#27272a';

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: theme.overlayBg || 'rgba(0,0,0,0.62)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        animation: 'confirmOverlayIn 0.14s ease-out',
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        style={{
          background: surface,
          border: `1px solid ${border}`,
          borderRadius: 14,
          width: 440, maxWidth: '100%',
          boxShadow: theme.shadowLg || '0 16px 40px rgba(0,0,0,0.45)',
          color: text,
          outline: 'none',
          animation: 'confirmDialogIn 0.18s cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <div style={{ display: 'flex', gap: 14, padding: '20px 22px 4px' }}>
          <div style={{
            flexShrink: 0, width: 38, height: 38, borderRadius: 10,
            background: ring, color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={19} />
          </div>
          <div style={{ minWidth: 0, paddingTop: 2 }}>
            <h2 id={titleId} style={{ fontSize: 15.5, fontWeight: 650, margin: 0, letterSpacing: '-0.01em' }}>
              {title}
            </h2>
            <p id={descId} style={{ fontSize: 13.5, lineHeight: 1.5, color: muted, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
              {message}
            </p>
            {detail && (
              <p style={{
                fontSize: 12.5, lineHeight: 1.5, color: muted, margin: '10px 0 0',
                padding: '8px 10px', background: theme.inputBg || '#18181b',
                border: `1px solid ${border}`, borderRadius: 8, whiteSpace: 'pre-wrap',
              }}>
                {detail}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '18px 22px 20px' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13.5, fontWeight: 550,
              background: 'transparent', color: text,
              border: `1px solid ${border}`, cursor: busy ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13.5, fontWeight: 600,
              background: accent, color: '#fff', border: 'none',
              cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
