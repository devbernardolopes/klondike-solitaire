import { useLayoutEffect, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { dequeueFlip } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

// Module-level registry of the in-flight draw tween, keyed by the drawn card's
// id. Kept out of the effect's per-run cleanup so a concurrent, unrelated move
// (which re-runs this effect) can't kill the still-sliding draw. The store
// guards draws while stock/waste are busy, so at most one draw animates at a
// time anyway; the registry exists purely to survive effect re-runs and to let
// a mid-slide tap cancel THIS card's slide (see cancelDrawSlide). Killed only
// on unmount or explicit cancel.
const drawTweens = new Map(); // cardId -> { tl, tid, cardNode, inner, wrap, prevWrapZ }

/**
 * Cancel a card's in-flight stock→waste slide (e.g. because the player tapped
 * it to auto-move it elsewhere). Kills the GSAP timeline WITHOUT firing its
 * onComplete (so the leftover inline transform stays on the node, letting
 * useCardMoveSlide snapshot the mid-slide position and animate from there),
 * then releases the slide lock so moveCard's subsequent transition can run.
 * @param {string} cardId
 */
export function cancelDrawSlide(cardId) {
  const rec = drawTweens.get(cardId);
  if (!rec) return;
  try { rec.tl.kill(); } catch {}
  try {
    if (rec.cardNode) gsap.set(rec.cardNode, { clearProps: 'x,y,zIndex' });
    if (rec.inner) gsap.set(rec.inner, { clearProps: 'rotateY' });
    if (rec.wrap) rec.wrap.style.zIndex = rec.prevWrapZ;
  } catch {}
  drawTweens.delete(cardId);
  useUiStore.getState().endDrawSlide(cardId);
  useUiStore.getState().endTransition(rec.tid);
}

export function cancelAllDrawSlides() {
  if (drawTweens.size === 0) return;
  const ui = useUiStore.getState();
  drawTweens.forEach((rec, cardId) => {
    try { rec.tl.kill(); } catch {}
    try {
      if (rec.cardNode) gsap.set(rec.cardNode, { clearProps: 'x,y,zIndex' });
      if (rec.inner) gsap.set(rec.inner, { clearProps: 'rotateY' });
      if (rec.wrap) rec.wrap.style.zIndex = rec.prevWrapZ;
    } catch {}
    drawTweens.delete(cardId);
    try { ui.endDrawSlide(cardId); } catch {}
    try { ui.endTransition(rec.tid); } catch {}
  });
}

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
    let entry;
    while ((entry = dequeueFlip('draw'))) {
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

    // The drawn card id — used to promote the lock from the flip phase to the
    // slide phase (and to let a mid-slide tap cancel THIS card's slide).
    const drawnId = cardNode.getAttribute('data-card');

    const sRect = stockPile.getBoundingClientRect();
    const wRect = wastePile.getBoundingClientRect();
    const rawDx = sRect.left - wRect.left;
    const handedness = (() => { try { return useSettingsStore.getState().handedness; } catch { return 'right'; } })();
    const dir = Math.sign(rawDx) || (handedness === 'right' ? 1 : -1);
    const overshoot = Math.max(0, MOTION.draw.overshoot ?? 0);
    const startX = rawDx + dir * overshoot;
    const dx = rawDx;
    const dy = sRect.top - wRect.top;

    const flip = MOTION.flipCard;
    const slide = MOTION.draw;
    const shouldFlipOvershoot = (() => {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      } catch {}
      try {
        const s = useSettingsStore.getState();
        if (!s.cardEffects) return false;
        if (!s.flipOvershoot) return false;
      } catch {}
      return true;
    })();

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
        drawTweens.delete(drawnId);
        useUiStore.getState().endDrawSlide(drawnId);
        useUiStore.getState().endTransition(tid);
      },
    });
    // Phase 1: flip face-up in place at the stock pile.
    tl.to(inner, {
      rotateY: 0,
      duration: flip.duration,
      ease: shouldFlipOvershoot ? flip.ease : 'power2.out',
    });
    // Phase 2: slide horizontally to the waste pile position. When this slide
    // begins, promote the card from the fully-locked flip phase to the slide
    // phase (flip stays locked; slide blocks drag but allows a tap auto-move).
    tl.to(
      cardNode,
      {
        x: 0,
        y: 0,
        duration: slide.duration,
        ease: slide.ease,
        onStart: () => useUiStore.getState().promoteDrawToSlide(drawnId, tid),
      },
      '>'
    );
    drawTweens.set(drawnId, { tl, tid, cardNode, inner, wrap, prevWrapZ });
    // No per-rerun cleanup that kills `tl`: see the module-level registry note.
    }
  }, [state, lastActionMeta]);

  // Kill the draw tween only when the board unmounts.
  useEffect(() => {
    return () => {
      cancelAllDrawSlides();
    };
  }, []);
}
