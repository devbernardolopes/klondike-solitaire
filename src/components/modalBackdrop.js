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
//
// Synthesized-click suppression: when a modal is dismissed by an outside tap,
// mobile browsers still fire a `click` for that same gesture at the element now
// underneath the backdrop — the very trigger that opened the modal (a toolbar
// FAB, an achievement row, a Settings sub-button, …). Without intervention that
// click instantly re-opens the modal we just closed. We swallow that one click
// centrally here so NO trigger button ever needs its own guard. The listener is
// armed synchronously during `pointerup` and runs in the capture phase *before*
// React's root-delegated listener, so the stray click never reaches the
// underlying handler. It disarms after the first click, or after a short safety
// window on desktop (where no such synthesized click is fired).

import { useRef } from 'react';

// How long the swallow listener stays armed when no synthesized click arrives
// (e.g. desktop, where the click lands on the removed backdrop instead). Must
// outlast the gap between pointerup (close) and the stray click (a few ms on
// mobile), yet short enough that a deliberate re-tap well after dismiss works.
const DISMISS_SWALLOW_MS = 350;

let swallowHandler = null;
let swallowTimer = null;

/** Arm a one-shot capture listener that swallows the next stray backdrop click. */
function swallowNextBackdropClick() {
  if (swallowHandler) return; // already armed from a recent dismiss

  const disarm = () => {
    if (swallowTimer) {
      clearTimeout(swallowTimer);
      swallowTimer = null;
    }
    if (swallowHandler) {
      window.removeEventListener('click', swallowHandler, true);
      swallowHandler = null;
    }
  };

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    disarm();
  };

  swallowHandler = handler;
  window.addEventListener('click', handler, true);
  // Safety net for platforms that don't synthesize a click after dismiss.
  swallowTimer = setTimeout(disarm, DISMISS_SWALLOW_MS);
}

// A gesture that begins while the modal is non-dismissable (e.g. a Win-modal
// tap landing on the backdrop through the still-animating, pointer-through
// panel) must never close it, even if the modal becomes dismissable before
// lift-off — so dismissability is captured at pointerdown, not pointerup.

/**
 * @param {() => void} onClose  invoked when a real outside click is detected
 * @param {() => boolean} [isDismissable]  defaults to always dismissable;
 *   pass e.g. `() => !entering` for modals with a non-interactive entrance
 * @returns {{ onPointerDown: (e: PointerEvent) => void, onPointerUp: (e: PointerEvent) => void }}
 */
export function useModalBackdrop(onClose, isDismissable) {
  const downTarget = useRef(null);
  const downDismissable = useRef(false);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    downTarget.current = e.target;
    try {
      downDismissable.current = isDismissable ? isDismissable() : true;
    } catch {
      downDismissable.current = true;
    }
  };

  const onPointerUp = (e) => {
    if (e.button !== 0) return;
    const backdrop = e.currentTarget;
    let upDismissable = true;
    try {
      upDismissable = isDismissable ? isDismissable() : true;
    } catch {}
    if (downDismissable.current && upDismissable && downTarget.current === backdrop && e.target === backdrop) {
      onClose();
      // Swallow the stray synthesized click that would otherwise land on the
      // trigger underneath the backdrop and instantly re-open this modal.
      swallowNextBackdropClick();
    }
    downTarget.current = null;
    downDismissable.current = false;
  };

  return { onPointerDown, onPointerUp };
}
