import { useLayoutEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { flipBridge } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';

const CONFIG_BY_TYPE = {
  // All generic card relocations (single cards and multi-card runs) share the
  // single, tweakable MOTION.move translation preset in motion.js. The stock→
  // waste draw is handled separately by useStockDrawSlide.
  move: MOTION.move,
  auto: MOTION.move,
  deal: MOTION.deal,
  recycle: MOTION.move,
};

/**
 * Card-relocation animation for EVERY move except the stock→waste draw. Instead
 * of GSAP Flip (which fails to produce a delta for reparented cards), this
 * computes each moved card's translation explicitly from the rects captured by
 * captureFlip() and tweens the (already re-rendered) node from its old position
 * to its new one. The translation therefore follows the real old→new path — it
 * is naturally DIAGONAL whenever the source and destination differ on both axes
 * — and a multi-card run lifts and lands as a RIGID BLOCK (every card in it
 * tweens in parallel, with the clicked card leading). All timing lives in
 * MOTION.move (duration / ease / stagger), so motion.js is the single source.
 */
export function useCardMoveSlide() {
  const state = useGameStore((s) => s.state);
  const lastActionMeta = useGameStore((s) => s.lastActionMeta);

  useLayoutEffect(() => {
    const oldRects = flipBridge.current;
    // The stock → waste draw is animated by useStockDrawSlide, which discards the
    // captured rects; don't run the generic pipeline for it. Other untracked
    // types (undo/redo) have no relocation animation either.
    if (!oldRects || !CONFIG_BY_TYPE[lastActionMeta.type]) {
      flipBridge.current = null;
      return;
    }
    const cfg = CONFIG_BY_TYPE[lastActionMeta.type];

    // Park every card that moved at its OLD position (via a transform offset),
    // then collect the nodes so we can tween them all together.
    const moved = [];
    document.querySelectorAll('[data-card]').forEach((el) => {
      const id = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
      const oldRect = oldRects.get(id);
      if (!oldRect) return;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (dx === 0 && dy === 0) return;
      gsap.set(el, { x: dx, y: dy });
      moved.push(el);
    });

    flipBridge.current = null;

    // Nothing actually moved (e.g. a no-op capture): release the lock at once so
    // it never sticks.
    if (moved.length === 0) {
      useUiStore.getState().endAnimating();
      return;
    }

    const tl = gsap.timeline({
      onComplete: () => useUiStore.getState().endAnimating(),
    });
    tl.to(moved, {
      x: 0,
      y: 0,
      duration: cfg.duration,
      ease: cfg.ease,
      stagger: cfg.stagger ?? 0,
    });

    return () => {
      tl.kill();
      // Reset any card we parked back to its resting state so a torn-down effect
      // never leaves it offset from its destination.
      moved.forEach((el) => gsap.set(el, { clearProps: 'transform' }));
      useUiStore.getState().endAnimating();
    };
  }, [state, lastActionMeta]);
}
