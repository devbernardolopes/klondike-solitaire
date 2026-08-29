// render/animation/useModalEnter.js
// Reusable modal entrance animation. A modal's panel grows from a reduced,
// centered size up to its full size (plus a slight overshoot pop) using the
// `modalEnter` preset in motion.js. The hook reports whether the entrance is
// still running via `entering` so the caller can block dismissal/interaction
// until the animation completes. Any future modal opts in by calling this hook
// and gating its own dismiss with the returned `entering`.

import { useLayoutEffect, useState } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

/**
 * Run the configured entrance animation on `panelEl`.
 * @param {HTMLElement} panelEl  the modal panel element to animate
 * @param {object} [opts]
 * @param {() => void} [opts.onComplete]  fired once the entrance finishes
 */
export function playModalEnter(panelEl, { onComplete } = {}) {
  if (!panelEl) return;
  const m = MOTION.modalEnter;
  gsap.fromTo(
    panelEl,
    { scale: m.fromScale, opacity: m.fromOpacity, transformOrigin: 'center center' },
    {
      scale: m.toScale,
      opacity: m.toOpacity,
      duration: m.duration,
      ease: m.ease,
      onComplete: () => onComplete?.(),
    },
  );
}

/**
 * Animate a modal's panel in whenever `open` flips true, and report whether the
 * entrance is still running via `entering` so the caller can block
 * dismissal/interaction until it finishes. `onEnterDone` fires once the entrance
 * completes (use it for focus, aria updates, etc.).
 *
 * Uses `useLayoutEffect` so `entering` becomes true BEFORE paint — this avoids a
 * one-frame flash of the full-size panel and guarantees dismissal is gated on the
 * very first paintable frame.
 *
 * @param {object} props
 * @param {React.RefObject<HTMLElement>} props.panelRef  ref to the panel element
 * @param {boolean} props.open  whether the modal is currently open
 * @param {() => void} [props.onEnterDone]  fired when the entrance finishes
 * @returns {boolean} `entering` — true while the entrance animation runs
 */
export function useModalEnter({ panelRef, open, onEnterDone } = {}) {
  const [entering, setEntering] = useState(false);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const el = panelRef?.current;
    if (!el) return undefined;
    setEntering(true);
    playModalEnter(el, {
      onComplete: () => {
        setEntering(false);
        onEnterDone?.();
      },
    });
    // No cleanup that kills the tween: if the modal closes mid-entrance the
    // component unmounts and the leftover inline transform is discarded with it.
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return entering;
}
