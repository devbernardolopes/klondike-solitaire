// components/modalBackdrop.js
//
// Robust outside-click detection for modal dialogs. The naive pattern of
// closing the modal on `onPointerDown` whenever `e.target === e.currentTarget`
// misfires with native form controls (e.g. a <select> inside the panel): some
// browsers deliver the option's `pointerdown` to the element physically under
// the dropdown — the modal backdrop — which then closes the dialog.
//
// This tracks where the gesture *started* (pointerdown target) and only closes
// on pointerup when BOTH the down and up targets are the backdrop itself, i.e.
// a genuine backdrop tap. A <select> interaction begins on the control (inside
// the panel), so it is never treated as an outside click.

import { useRef } from 'react';
import { markModalDismissed } from '../utils/modalDismissGuard.js';

/**
 * @param {() => void} onClose  invoked when a real outside click is detected
 * @returns {{ onPointerDown: (e: PointerEvent) => void, onPointerUp: (e: PointerEvent) => void }}
 */
export function useModalBackdrop(onClose) {
  const downTarget = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    downTarget.current = e.target;
  };

  const onPointerUp = (e) => {
    if (e.button !== 0) return;
    const backdrop = e.currentTarget;
    if (downTarget.current === backdrop && e.target === backdrop) {
      // Mark a short guard window BEFORE closing so the synthesized click at the
      // end of this same touch gesture can't re-trigger a toolbar FAB that was
      // underneath the backdrop (marking must be synchronous, not via React state).
      markModalDismissed();
      onClose();
    }
    downTarget.current = null;
  };

  return { onPointerDown, onPointerUp };
}
