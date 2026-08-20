import { useLayoutEffect, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { dequeueFlip } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';

// Module-level registry of the in-flight draw tween. Kept out of the effect's
// per-run cleanup so a concurrent, unrelated move (which re-runs this effect)
// can't kill the still-sliding draw. The store guards draws while stock/waste
// are busy, so at most one draw animates at a time anyway; the registry exists
// purely to survive effect re-runs. Killed only on unmount.
const activeDrawTweens = [];

/**
 * Stock → waste draw animation: the revealed card flips face-up in place at the
 * stock pile and THEN glides horizontally to the waste pile. The horizontal
 * direction follows the board layout, which already mirrors with the Hand
 * orientation (right-handed = waste left of stock → slide left; left-handed =
 * reverse). All tweakable values live in MOTION.draw (slide) and MOTION.flipCard
 * (reveal) in motion.js.
 *
 * This takes over the `draw` action so the generic relocation translate in
 * useCardMoveSlide is skipped for it.
 */
export function useStockDrawSlide() {
  const state = useGameStore((s) => s.state);
  const lastActionMeta = useGameStore((s) => s.lastActionMeta);

  useLayoutEffect(() => {
    if (lastActionMeta.type !== 'draw') return;
    // Drain THIS draw's snapshot. If none is queued, a different transition is
    // re-running the effect (e.g. a concurrent tableau move) — leave the
    // in-flight draw alone.
    const entry = dequeueFlip('draw');
    if (!entry) return;
    const { tid } = entry;

    const wastePile = document.querySelector('[data-loc="waste"]');
    const stockPile = document.querySelector('[data-loc="stock"]');
    // drawFromStock already acquired the lock; release it if we can't animate.
    if (!wastePile || !stockPile) {
      useUiStore.getState().endTransition(tid);
      return;
    }

    // The freshly drawn card is the last [data-card] child of the waste pile
    // (cards render in array order; the most recent draw is appended last).
    const cards = wastePile.querySelectorAll('[data-card]');
    const cardNode = cards[cards.length - 1];
    if (!cardNode) {
      useUiStore.getState().endTransition(tid);
      return;
    }
    const inner = cardNode.querySelector('.card-flip-inner');
    if (!inner) {
      useUiStore.getState().endTransition(tid);
      return;
    }

    // The freshly drawn card is parked (via a transform) at the stock pile's
    // position, but it still lives inside the WASTE pile's wrapper <div> (see
    // Pile.jsx). That wrapper is `position:absolute; z-index:<waste index>` and
    // forms its own stacking context, so the zIndex we set on cardNode below
    // only orders siblings INSIDE the wrapper — it does NOT lift the card above
    // the stock pile's own wrapper divs. For early draws the waste wrapper's
    // z-index is below the remaining stock wrappers, so the parked card renders
    // BEHIND the stock pile and its flip is invisible (only the slide into the
    // waste is seen). Raise the wrapper's z-index for the animation so the flip
    // plays on top of the stock pile for every draw, then restore it on cleanup.
    const wrap = cardNode.parentElement;
    const prevWrapZ = wrap ? wrap.style.zIndex : '';
    if (wrap) wrap.style.zIndex = '10000';

    const sRect = stockPile.getBoundingClientRect();
    const wRect = wastePile.getBoundingClientRect();
    const dx = sRect.left - wRect.left;
    const dy = sRect.top - wRect.top;
    const dir = Math.sign(dx) || 1;
    const startX = dx + dir * MOTION.draw.overshoot;

    const flip = MOTION.flipCard;
    const slide = MOTION.draw;

    // Park the card at the stock pile position (face-down) before animating.
    gsap.set(cardNode, { x: startX, y: dy, zIndex: 1000 });
    gsap.set(inner, { rotateY: -180 });

    const tl = gsap.timeline({
      onComplete: () => {
        // Reset the card to its resting state so a torn-down effect never leaves
        // it parked at the stock pile or face-down.
        gsap.set(cardNode, { x: 0, y: 0, clearProps: 'zIndex' });
        gsap.set(inner, { rotateY: 0 });
        if (wrap) wrap.style.zIndex = prevWrapZ;
        const i = activeDrawTweens.indexOf(tl);
        if (i >= 0) activeDrawTweens.splice(i, 1);
        useUiStore.getState().endTransition(tid);
      },
    });
    // Phase 1: flip face-up in place at the stock pile.
    tl.to(inner, {
      rotateY: 0,
      duration: flip.duration,
      ease: flip.ease,
    });
    // Phase 2: slide horizontally to the waste pile position.
    tl.to(
      cardNode,
      { x: 0, y: 0, duration: slide.duration, ease: slide.ease },
      '>'
    );
    activeDrawTweens.push(tl);
    // No per-rerun cleanup that kills `tl`: see the module-level registry note.
  }, [state, lastActionMeta]);

  // Kill the draw tween only when the board unmounts.
  useEffect(() => {
    return () => {
      activeDrawTweens.forEach((t) => t.kill());
      activeDrawTweens.length = 0;
    };
  }, []);
}
