import { useLayoutEffect, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { dequeueFlip } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';

const CONFIG_BY_TYPE = {
  // All generic card relocations (single cards and multi-card runs) share the
  // single, tweakable MOTION.move translation preset in motion.js. The stock→
  // waste draw is handled separately by useStockDrawSlide. The auto-complete
  // relocation uses its OWN MOTION.auto preset so it can be tuned independently
  // (faster/snappier) without affecting normal player moves.
  move: MOTION.move,
  auto: MOTION.auto,
  deal: MOTION.deal,
  recycle: MOTION.move,
  undo: MOTION.undo,
};

// Module-level registry of in-flight timelines. These are intentionally NOT tied
// to a single effect instance's cleanup, so a second move starting while the
// first is still sliding does NOT kill the first tween — the two animate
// concurrently (they always involve disjoint cards/piles, so they never
// visually interfere). Only the unmount effect below kills them.
const activeTweens = [];

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
    // Pull the next pending transition of a type this hook owns. Other types
    // (draw) are drained by useStockDrawSlide; a stale/unknown entry is left
    // untouched. Because each transition enqueues exactly one snapshot and the
    // effect runs once per state change, this drains one entry per commit.
    const entry =
      dequeueFlip('move') ||
      dequeueFlip('auto') ||
      dequeueFlip('recycle') ||
      dequeueFlip('deal') ||
      dequeueFlip('undo');
    if (!entry) return;
    const { tid, snapshot, type } = entry;
    const cfg = CONFIG_BY_TYPE[type];
    if (!cfg) {
      useUiStore.getState().endTransition(tid);
      return;
    }

    // Park every card that moved at its OLD position (via a transform offset),
    // then collect the nodes so we can tween them all together.
    const moved = [];
    document.querySelectorAll('[data-card]').forEach((el) => {
      const id = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
      const oldRect = snapshot.get(id);
      if (!oldRect) return;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (dx === 0 && dy === 0) return;
      gsap.set(el, { x: dx, y: dy });
      moved.push(el);
    });

    // Nothing actually moved (e.g. a no-op capture): release the lock at once so
    // it never sticks.
    if (moved.length === 0) {
      useUiStore.getState().endTransition(tid);
      return;
    }

    let completed = false;
    const tl = gsap.timeline({
      onComplete: () => {
        completed = true;
        const i = activeTweens.indexOf(tl);
        if (i >= 0) activeTweens.splice(i, 1);
        useUiStore.getState().endTransition(tid);
      },
    });
    tl.to(moved, {
      x: 0,
      y: 0,
      duration: cfg.duration,
      ease: cfg.ease,
      stagger: cfg.stagger ?? 0,
    });
    activeTweens.push(tl);

    // IMPORTANT: no cleanup that kills `tl` on effect re-run. A new transition
    // re-running this effect must start its OWN tween, not tear down the prior
    // in-flight ones. The only teardown happens on unmount (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, lastActionMeta]);

  // Tear down every in-flight tween only when the board unmounts, and release
  // any locks they held so a remount/route change can't leave the board stuck.
  // We deliberately do NOT cancel/snap tweens when the tab is hidden: a hidden
  // tab merely pauses requestAnimationFrame, so GSAP's tweens simply freeze in
  // place and resume smoothly (via GSAP's default lagSmoothing) when the tab is
  // refocused — no auto-complete step is skipped or jumped.
  useEffect(() => {
    return () => {
      activeTweens.forEach((t) => t.kill());
      activeTweens.length = 0;
      useUiStore.getState().clearAllTransitions();
    };
  }, []);
}
