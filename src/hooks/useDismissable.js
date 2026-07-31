import { useEffect } from 'react';

/**
 * Close-on-outside-click and close-on-Escape for popovers, dropdowns and menus.
 *
 * Generalised from DatePickerField, which was the only component in the app
 * getting this right — TopBar's two dropdowns could only be closed by clicking
 * their own trigger again, which is why they felt stuck.
 *
 * Pass every element that counts as "inside": typically the trigger and the
 * floating panel, since the panel is often portalled or absolutely positioned
 * outside the trigger's subtree.
 *
 *   const triggerRef = useRef(null);
 *   const panelRef = useRef(null);
 *   useDismissable(open, () => setOpen(false), [triggerRef, panelRef]);
 *
 * `mousedown` rather than `click`: it fires before focus moves, so a click that
 * lands on another control both closes this popover and activates that control,
 * instead of being swallowed as a dismiss.
 */
export default function useDismissable(open, onDismiss, refs = []) {
  useEffect(() => {
    if (!open) return undefined;

    const isInside = (target) => refs.some((ref) => ref?.current?.contains(target));

    const onPointerDown = (e) => {
      if (!isInside(e.target)) onDismiss();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
    // refs is a fresh array literal on most calls; its identity is not
    // meaningful, and the ref objects inside it are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss]);
}
