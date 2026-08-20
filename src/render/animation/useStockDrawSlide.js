import { useLayoutEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { flipBridge } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';

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
    // The store captured a Flip snapshot for this action; we animate manually,
    // so discard it to avoid a stale snapshot being reused by later moves.
    flipBridge.current = null;

    const wastePile = document.querySelector('[data-loc="waste"]');
    const stockPile = document.querySelector('[data-loc="stock"]');
    // drawFromStock already acquired the lock; release it if we can't animate.
    if (!wastePile || !stockPile) {
      useUiStore.getState().endAnimating();
      return;
    }

    // The freshly drawn card is the last [data-card] child of the waste pile
    // (cards render in array order; the most recent draw is appended last).
    const cards = wastePile.querySelectorAll('[data-card]');
    const cardNode = cards[cards.length - 1];
    if (!cardNode) {
      useUiStore.getState().endAnimating();
      return;
    }
    const inner = cardNode.querySelector('.card-flip-inner');
    if (!inner) {
      useUiStore.getState().endAnimating();
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

    // Track whether the timeline actually finished. The store action already
    // called beginAnimating(); the matching endAnimating() must run once. We do
    // it in onComplete, and ALSO in cleanup ONLY if the timeline did NOT complete
    // (e.g. the effect was torn down by an unmount before it finished). Without
    // this guard, the previous draw's cleanup endAnimating() would cancel the
    // *current* draw's beginAnimating() (which was issued in the store action),
    // releasing the lock mid flip+slide and letting a fast tap auto-move the
    // in-flight card. See the root-cause note in the PR/commit.
    let completed = false;
    const tl = gsap.timeline({
      onComplete: () => {
        completed = true;
        useUiStore.getState().endAnimating();
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

    return () => {
      tl.kill();
      // Reset the card to its resting state so a torn-down effect never leaves
      // it parked at the stock pile or face-down.
      gsap.set(cardNode, { x: 0, y: 0, clearProps: 'zIndex' });
      gsap.set(inner, { rotateY: 0 });
      if (wrap) wrap.style.zIndex = prevWrapZ;
      if (!completed) useUiStore.getState().endAnimating();
    };
  }, [state, lastActionMeta]);
}
