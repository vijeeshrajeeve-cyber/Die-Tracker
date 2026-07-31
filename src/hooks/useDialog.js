import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

// Only elements the user can actually reach: skip anything hidden by display,
// visibility or a zero-size box (collapsed sections, off-screen helpers).
const visibleFocusable = (root) => Array.from(root?.querySelectorAll(FOCUSABLE) || [])
  .filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);

/**
 * The four things every modal in this app was missing.
 *
 * Of 21 components rendering a `position: fixed; inset: 0` overlay, two handled
 * Escape and none did the rest — so a keyboard user could Tab straight out of a
 * dialog into the page behind it, with no visible focus ring to tell them.
 *
 *   const dialogRef = useDialog({ open, onClose });
 *   ...
 *   <div role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
 *
 * Provides:
 *   - Escape closes (unless `closeOnEscape: false` — use for dialogs mid-submit)
 *   - Tab and Shift+Tab cycle inside the dialog instead of escaping it
 *   - initial focus moves into the dialog, and returns to the trigger on close
 *   - background scroll locks while the dialog is open
 *
 * Nested dialogs are handled by a counter on the body, so closing an inner
 * dialog does not unlock scrolling for the outer one still on screen.
 */
export default function useDialog({ open, onClose, closeOnEscape = true, autoFocus = true }) {
  const dialogRef = useRef(null);
  const restoreFocusTo = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusTo.current = document.activeElement;
    // Captured for the cleanup closure: refs are attached during render, so
    // this is already the dialog node, and reading `.current` at teardown time
    // would race with React having nulled it.
    const dialogNode = dialogRef.current;

    const depth = Number(document.body.dataset.dialogDepth || 0) + 1;
    document.body.dataset.dialogDepth = String(depth);
    document.body.dataset.dialogOpen = 'true';

    // Only the top-most open dialog reacts to keys. Without this the QD drawer,
    // which registers first, would swallow the Escape meant for a status modal
    // opened inside it — and close the drawer instead.
    const isTopmost = () => Number(document.body.dataset.dialogDepth || 0) === depth;

    if (autoFocus) {
      // After paint, so content rendered in the same commit is present.
      requestAnimationFrame(() => {
        const node = dialogRef.current;
        if (!node) return;
        if (node.contains(document.activeElement)) return;
        (visibleFocusable(node)[0] || node).focus?.();
      });
    }

    const onKeyDown = (e) => {
      if (!isTopmost()) return;
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const node = dialogRef.current;
      if (!node) return;
      const items = visibleFocusable(node);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      // Focus outside the dialog (or on the container itself) means the cycle
      // has been broken — pull it back to whichever end Tab was heading for.
      if (!node.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);

      const remaining = Math.max(0, Number(document.body.dataset.dialogDepth || 1) - 1);
      if (remaining === 0) {
        delete document.body.dataset.dialogDepth;
        delete document.body.dataset.dialogOpen;
      } else {
        document.body.dataset.dialogDepth = String(remaining);
      }

      // Only steal focus back if it is still inside the dialog we are tearing
      // down; if the app has already moved it somewhere deliberate, leave it.
      const target = restoreFocusTo.current;
      if (target?.isConnected && typeof target.focus === 'function') {
        const active = document.activeElement;
        if (!active || active === document.body || dialogNode?.contains(active)) {
          target.focus();
        }
      }
    };
  }, [open, onClose, closeOnEscape, autoFocus]);

  return dialogRef;
}
