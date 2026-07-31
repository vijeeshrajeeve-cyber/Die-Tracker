import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

const DialogContext = createContext(null);

// The provider has to render inside DieOrderingSystem, because that is where
// `theme` is defined — which leaves DieOrderingSystem itself outside its own
// context, unable to use the hook for its own six call sites. Registering the
// handlers on a module singleton (the react-hot-toast approach) sidesteps that
// and lets every one of the 38 replaced calls read the same way, hook or not.
const handlers = { confirm: null, notify: null };

// eslint-disable-next-line react-refresh/only-export-components
export const dialogs = {
  confirm: (options) => (handlers.confirm
    ? handlers.confirm(options)
    // No provider mounted (tests, an error boundary above us): refuse rather
    // than silently resolving true and running a destructive action unasked.
    : Promise.resolve(false)),
  notify: (message, type, options) => handlers.notify?.(message, type, options),
};

/**
 * Imperative replacements for window.confirm and window.alert.
 *
 *   const { confirm, notify } = useDialogs();
 *   if (!(await confirm({ title: 'Delete order', message: '…' }))) return;
 *   notify('Order deleted', 'success');
 *
 * Kept imperative on purpose: the 38 native calls being replaced were all
 * inline inside event handlers, and an imperative promise swaps in without
 * restructuring any of them into render-time state.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDialogs() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs must be used inside <DialogProvider>');
  return ctx;
}

const TOAST_TONES = {
  success: { accent: '#10B981', ring: 'rgba(16,185,129,0.18)', Icon: CheckCircle },
  error: { accent: '#EF4444', ring: 'rgba(239,68,68,0.18)', Icon: AlertTriangle },
  info: { accent: '#60A5FA', ring: 'rgba(96,165,250,0.18)', Icon: Info },
};

// Errors stay up longer — they usually carry a message worth reading.
const DURATION = { success: 3500, info: 4500, error: 7000 };

let toastSeq = 0;

export default function DialogProvider({ theme = {}, children }) {
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);
  const resolveRef = useRef(null);
  const timers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback((message, type = 'info', options = {}) => {
    const id = ++toastSeq;
    const text = message instanceof Error ? message.message : String(message ?? '');
    setToasts((list) => [...list, { id, message: text, type, title: options.title }]);
    const ms = options.duration ?? DURATION[type] ?? 4500;
    timers.current.set(id, setTimeout(() => dismissToast(id), ms));
    return id;
  }, [dismissToast]);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    resolveRef.current = resolve;
    setConfirmState({ tone: 'danger', confirmLabel: 'Confirm', ...options });
  }), []);

  const settle = useCallback((answer) => {
    setConfirmState(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(answer);
  }, []);

  const value = useMemo(() => ({ confirm, notify, dismissToast }), [confirm, notify, dismissToast]);

  // Point the module singleton at this instance for as long as it is mounted.
  useEffect(() => {
    handlers.confirm = confirm;
    handlers.notify = notify;
    return () => {
      handlers.confirm = null;
      handlers.notify = null;
    };
  }, [confirm, notify]);

  return (
    <DialogContext.Provider value={value}>
      {children}

      <ConfirmDialog
        {...(confirmState || {})}
        open={!!confirmState}
        theme={theme}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />

      {createPortal(
        <div
          // Announced politely so a screen reader hears the outcome of an action
          // it did not otherwise get told about.
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10001, display: 'flex', flexDirection: 'column', gap: 8,
            width: 'min(460px, calc(100vw - 32px))', pointerEvents: 'none',
          }}
        >
          {toasts.map((toast) => {
            const { accent, ring, Icon } = TOAST_TONES[toast.type] || TOAST_TONES.info;
            return (
              <div
                key={toast.id}
                style={{
                  pointerEvents: 'auto',
                  display: 'flex', alignItems: 'flex-start', gap: 11,
                  padding: '11px 12px 11px 13px',
                  background: theme.cardBg || '#131316',
                  border: `1px solid ${theme.cardBorder || '#27272a'}`,
                  borderLeft: `3px solid ${accent}`,
                  borderRadius: 10,
                  boxShadow: theme.shadowLg || '0 16px 40px rgba(0,0,0,0.45)',
                  color: theme.text || '#fafafa',
                  animation: 'toastIn 0.22s cubic-bezier(0.32,0.72,0,1)',
                }}
              >
                <span style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 6, marginTop: 1,
                  background: ring, color: accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={13} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {toast.title && (
                    <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 2 }}>{toast.title}</div>
                  )}
                  <div style={{
                    fontSize: 13, lineHeight: 1.45,
                    color: toast.title ? (theme.textMuted || '#a1a1aa') : (theme.text || '#fafafa'),
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {toast.message}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                  style={{
                    flexShrink: 0, background: 'transparent', border: 'none', padding: 2,
                    borderRadius: 5, color: theme.textDim || '#71717a', cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </DialogContext.Provider>
  );
}
