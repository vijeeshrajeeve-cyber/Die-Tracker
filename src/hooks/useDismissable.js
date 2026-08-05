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
 *
 * While open, a popover claims Escape by counting itself on the body — see
 * `popoverDepth` below.
 */

/**
 * How many popovers are open, tracked on the body so `useDialog` can see it
 * without the two hooks knowing about each other.
 *
 * Escape has to mean the innermost thing: dismissing a date picker inside a
 * modal must not also close the modal. Ordering alone cannot arrange that —
 * useDialog listens on `document` in the capture phase, so it reaches the key
 * before any React handler a popover could use to stop it. So the dialog asks
 * instead of racing: while this count is above zero, Escape belongs to the
 * popover and the dialog stands down. Closing the popover drops the count, and
 * the next Escape closes the dialog.
 *
 * A counter rather than a flag, so two popovers open at once (a menu over a
 * picker) still leave it set when only one of them closes.
 */
export const popoverDepth = () => Number(document.body.dataset.popoverDepth || 0);

export default function useDismissable(open, onDismiss, refs = []) {
  useEffect(() => {
    if (!open) return undefined;

    document.body.dataset.popoverDepth = String(popoverDepth() + 1);

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

      const remaining = Math.max(0, popoverDepth() - 1);
      if (remaining === 0) delete document.body.dataset.popoverDepth;
      else document.body.dataset.popoverDepth = String(remaining);
    };
    // refs is a fresh array literal on most calls; its identity is not
    // meaningful, and the ref objects inside it are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss]);
}
