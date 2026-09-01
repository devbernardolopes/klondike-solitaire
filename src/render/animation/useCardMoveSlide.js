import { useLayoutEffect, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { dequeueFlip } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

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
    // Each moved card's wrapper <div> (Pile.jsx, `zIndex: i`) controls its
    // stacking order in the shared root stacking context. While sliding, a card
    // can pass over piles whose cards have a higher `i`, which would render the
    // moving card BEHIND them. Lift each moved wrapper above all resting cards
    // for the duration of the tween, preserving the run's own relative order via
    // `+base`, then restore the original z-index on completion.
    const movers = [];
    document.querySelectorAll('[data-card]').forEach((el) => {
      const id = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
      const oldRect = snapshot.get(id);
      if (!oldRect) return;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (dx === 0 && dy === 0) return;
      gsap.set(el, { x: dx, y: dy });
      const wrap = el.parentElement;
      const prevZ = wrap ? wrap.style.zIndex : '';
      if (wrap) {
        const base = parseInt(prevZ || '0', 10) || 0;
        wrap.style.zIndex = String(2000 + base);
      }
      moved.push(el);
      movers.push({ wrap, prevZ });
    });

    // During a deal, the cards being dealt fly out from the face-down stock. We
    // want them to appear BENEATH the remaining face-down stock cards (as if
    // pulled from under the pile) while they overlap the stock region, but still
    // ON TOP of every other pile (tableau/foundation/waste) as they land. The
    // stock pile wrapper has no z-index of its own, so it does not create a
    // stacking context; giving it a value above the movers' `2000 + base` groups
    // its face-down cards at that level, above the dealt cards, without touching
    // the movers' own lift (they stay above all other piles). Restored below.
    let stockWrap = null;
    let prevStockZ = '';
    if (type === 'deal') {
      stockWrap = document.querySelector('[data-pile="stock"]');
      if (stockWrap) {
        prevStockZ = stockWrap.style.zIndex;
        stockWrap.style.zIndex = '3000';
      }
    }

    // Nothing actually moved (e.g. a no-op capture): release the lock at once so
    // it never sticks.
    if (moved.length === 0) {
      if (stockWrap) stockWrap.style.zIndex = prevStockZ;
      useUiStore.getState().endTransition(tid);
      return;
    }

    let completed = false;
    const ghosts = [];
    const shouldGhost = (() => {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      } catch {}
      if (type === 'deal') return false;
      try {
        if (!useSettingsStore.getState().cardEffects) return false;
      } catch {}
      return type === 'move' || type === 'auto' || type === 'undo';
    })();
    const createGhosts = () => {
      if (!shouldGhost || moved.length === 0) return;
      const cap = MOTION.ghostTrail?.maxConcurrent ?? 8;
      const toSpawn = Math.min(moved.length, cap);
      for (let i = 0; i < toSpawn; i++) {
        const el = moved[i];
        try {
          const oldRect = snapshot.get(el.getAttribute('data-flip-id') || el.getAttribute('data-card'));
          if (!oldRect) continue;
          const g = el.cloneNode(true);
          g.style.position = 'fixed';
          g.style.left = `${oldRect.left}px`;
          g.style.top = `${oldRect.top}px`;
          g.style.width = `${oldRect.width}px`;
          g.style.height = `${oldRect.height}px`;
          g.style.margin = '0';
          g.style.pointerEvents = 'none';
          g.style.zIndex = '1400';
          g.style.opacity = String(MOTION.ghostTrail?.alpha ?? 0.18);
          g.removeAttribute('data-card');
          g.removeAttribute('data-flip-id');
          document.body.appendChild(g);
          ghosts.push(g);
          gsap.to(g, {
            opacity: 0,
            scale: MOTION.ghostTrail?.scale ?? 0.96,
            duration: (MOTION.ghostTrail?.duration ?? 0.35) * 0.9,
            ease: MOTION.ghostTrail?.ease ?? 'power2.out',
            delay: cfg.duration * 0.12,
            onComplete: () => { try { g.remove(); } catch {} },
          });
        } catch {}
      }
    };
    const tl = gsap.timeline({
      onComplete: () => {
        completed = true;
        moved.forEach((el) => gsap.set(el, { clearProps: 'scale,boxShadow,rotationZ' }));
        ghosts.forEach((g) => { try { g.remove(); } catch {} });
        movers.forEach(({ wrap, prevZ }) => {
          if (wrap) wrap.style.zIndex = prevZ;
        });
        if (stockWrap) stockWrap.style.zIndex = prevStockZ;
        const i = activeTweens.indexOf(tl);
        if (i >= 0) activeTweens.splice(i, 1);
        useUiStore.getState().endTransition(tid);
      },
    });
    const isLifted = type === 'move' || type === 'auto';
    if (isLifted) {
      const lift = MOTION.hoverLift ?? { scale: 1.02 };
      moved.forEach((el) => gsap.set(el, { scale: lift.scale ?? 1.02, rotationZ: gsap.utils.random(-0.6, 0.6), boxShadow: '0 14px 32px rgba(0,0,0,0.45), 0 5px 12px rgba(0,0,0,0.35)' }));
      createGhosts();
    }
    tl.to(moved, {
      x: 0,
      y: 0,
      scale: 1,
      rotationZ: 0,
      boxShadow: '0 4px 10px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.28)',
      duration: cfg.duration,
      ease: cfg.ease,
      stagger: cfg.stagger ?? 0,
      clearProps: isLifted ? '' : 'scale,boxShadow,rotationZ',
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
