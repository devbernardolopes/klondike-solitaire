import { useLayoutEffect, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { dequeueFlip } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';
import { spawnTrailCascade, clearAllGhostTrails } from './ghostTrail.js';
import { buildBounceSteps } from './useCardMoveSlideBounce.js';

const CONFIG_BY_TYPE = {
  // All generic card relocations (single cards and multi-card runs) share the
  // single, tweakable MOTION.move translation preset in motion.js. The stock→
  // waste draw is handled separately by useStockDrawSlide. The auto-complete
  // relocation uses its OWN MOTION.auto preset so it can be tuned independently
  // (faster/snappier) without affecting normal player moves.
  move: MOTION.move,
  auto: MOTION.auto,
  deal: MOTION.deal,
  recycle: MOTION.recycle,
  undo: MOTION.undo,
};

// Module-level registry of in-flight slide timelines, keyed by card id. Multi-
// card runs share ONE tween, so every card id in the run points to the same
// record. These are intentionally NOT tied to a single effect instance's
// cleanup, so a second move starting while the first is still sliding does
// NOT kill the first tween — the two animate concurrently (they always
// involve disjoint cards/piles, so they never visually interfere). Only the
// unmount effect below kills them.
//
// The Map shape (vs. the prior flat array) is what lets cancelSlideTween()
// below interrupt a specific card mid-slide (e.g. when the player undoes a
// move that is still animating) without disturbing other in-flight tweens.
const activeTweens = new Map(); // cardId -> { tl, tid, cardIds:Set, moved, movers, stockWrap, prevStockZ }

// Module-level registry of ghost echo DOM elements created by createGhosts().
// Cleaned up on unmount so a killed tween (or component unmount) does not
// orphan ghost elements in the DOM. (Trail segments live in ghostTrail.js.)
const ghostEls = new Set();

// Per-card registry of the currently-active echo, so that an echo for a card
// returning to a position where one is still playing is CANCELLED in favor
// of the new one (avoids two echoes on the same card in the same spot when
// the user spams tap+undo). The TRAIL is NOT subject to this dedup — per
// spec, trail segments always fade organically and are never cancelled.
const activeEchoByCard = new Map(); // cardId -> { el, tween, oldRect }

function rectsApproxEqual(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.left - b.left) < 1
      && Math.abs(a.top - b.top) < 1
      && Math.abs(a.width - b.width) < 1
      && Math.abs(a.height - b.height) < 1;
}

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

/**
 * Cancel the in-flight slide tween for the given card ids. Kills the
 * timeline WITHOUT firing its onComplete, leaving the inline `x`/`y`
 * transform on each DOM node so the next snapshot
 * (e.g. an undo's `enqueueFlip('undo', ...)`) reads the live mid-slide
 * position via `getBoundingClientRect()`. Releases the per-tween
 * transition lock via `endTransition(tid)` so the destination pile is
 * unlocked and a new tween can `beginTransition` cleanly.
 *
 * Multi-card runs share ONE tween, so killing the timeline once cleans
 * up every card id registered against it. Other in-flight tweens (for
 * cards NOT in `cardIds`) keep running and keep their locks — only the
 * matching tween's tid is released.
 *
 * No-op if no tween matches the given ids. Mirrors `cancelDrawSlide` in
 * `useStockDrawSlide.js`. The killed tween's `onComplete` is skipped, so
 * the zIndex restoration and the `clearProps: 'scale,boxShadow,rotationZ'`
 * cleanup the tween would normally perform are left for the NEXT tween
 * (e.g. the undo's) to handle. Ghost echoes and ghost trail segments
 * (which own their own timelines via `activeEchoByCard` and
 * `ghostTrail.js`) are unaffected; they self-remove on their own.
 *
 * @param {string[]|Set<string>} cardIds
 */
export function cancelSlideTween(cardIds) {
  if (!cardIds) return;
  const seenTweens = new Set();
  const seenTids = new Set();
  for (const id of cardIds) {
    const rec = activeTweens.get(id);
    if (!rec) continue;
    if (!seenTweens.has(rec.tl)) {
      seenTweens.add(rec.tl);
      try { rec.tl.kill(); } catch {}
    }
    if (!seenTids.has(rec.tid)) {
      seenTids.add(rec.tid);
      try { useUiStore.getState().endTransition(rec.tid); } catch {}
    }
  }
  // Deregister every id we touched. We do this in a second pass so the
  // lookup-and-fire loop above stays simple.
  for (const id of cardIds) activeTweens.delete(id);
}

export function useCardMoveSlide() {
  const state = useGameStore((s) => s.state);
  const lastActionMeta = useGameStore((s) => s.lastActionMeta);

  useLayoutEffect(() => {
    // Pull the next pending transition of a type this hook owns. Other types
    // (draw) are drained by useStockDrawSlide; a stale/unknown entry is left
    // untouched. Because each transition enqueues exactly one snapshot and the
    // effect runs once per state change, this drains one entry per commit.
    let entry;
    while ((entry =
      dequeueFlip('move') ||
      dequeueFlip('auto') ||
      dequeueFlip('recycle') ||
      dequeueFlip('deal') ||
      dequeueFlip('undo'))) {
    const { tid, snapshot, type } = entry;
    const cfg = CONFIG_BY_TYPE[type];
    if (!cfg) {
      useUiStore.getState().endTransition(tid);
      return;
    }

    // Park every card that moved at its OLD position (via a transform offset),
    // then collect the nodes so we can tween them all together.
    // Iterate the SNAPSHOT (the moved card ids) directly instead of scanning
    // the full DOM for every [data-card] node — this is O(moved) rather than
    // O(all cards on the board) and avoids a getBoundingClientRect() per
    // non-moved card on every move animation.
    const moved = [];
    // Each moved card's wrapper <div> (Pile.jsx, `zIndex: i`) controls its
    // stacking order in the shared root stacking context. While sliding, a card
    // can pass over piles whose cards have a higher `i`, which would render the
    // moving card BEHIND them. Lift each moved wrapper above all resting cards
    // for the duration of the tween, preserving the run's own relative order via
    // `+base`, then restore the original z-index on completion.
    const movers = [];
    for (const [id, oldRect] of snapshot) {
      const el = document.querySelector(`[data-flip-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (dx === 0 && dy === 0) continue;
      gsap.set(el, { x: dx, y: dy });
      const wrap = el.parentElement;
      const prevZ = wrap ? wrap.style.zIndex : '';
      if (wrap) {
        const base = parseInt(prevZ || '0', 10) || 0;
        wrap.style.zIndex = String(2000 + base);
      }
      moved.push(el);
      movers.push({ wrap, prevZ });
    }

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
      if (type === 'recycle') return false; // explicit: stock→waste recycle never echoes
      if (type === 'drag') return false;    // explicit: manual drag never echoes
      try {
        const s = useSettingsStore.getState();
        if (!s.cardEffects) return false;
        if (!s.ghostEcho) return false;
      } catch {}
      return type === 'move' || type === 'auto' || type === 'undo';
    })();
    // Ghost trail — ALWAYS fires on drag (per spec: "Drag should YES trigger trail
    // always"). Other rules match Ghost Echo: no deal / recycle / draw. drag
    // passes 'move' as the transition type (via metaType: 'drag' in useDragEngine),
    // so it falls under the 'move' branch below.
    const shouldTrail = (() => {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      } catch {}
      if (type === 'deal') return false;
      if (type === 'recycle') return false;
      // No explicit `if (type === 'drag') return false` here — trail fires on drag.
      try {
        const s = useSettingsStore.getState();
        if (!s.cardEffects) return false;
        if (!s.ghostTrail) return false;
      } catch {}
      return type === 'move' || type === 'auto' || type === 'undo';
    })();
    const shouldBounce = (() => {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      } catch {}
      if (!useSettingsStore.getState().cardEffects) return false;
      if (!useSettingsStore.getState().bounce) return false;
      if (moved.length !== 1) return false;
      return type === 'move' || type === 'auto';
    })();
    const createGhosts = () => {
      if (!shouldGhost || moved.length === 0) return;
      const cap = MOTION.ghostEcho?.maxConcurrent ?? 8;
      const toSpawn = Math.min(moved.length, cap);
      for (let i = 0; i < toSpawn; i++) {
        const el = moved[i];
        try {
          const cardId = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
          const oldRect = snapshot.get(cardId);
          if (!oldRect) continue;
          // Per-card dedup: if there's already an echo for this card at the
          // same position, cancel it before spawning the new one (so the user
          // never sees two echoes on the same card in the same spot when
          // spamming tap+undo).
          const existing = activeEchoByCard.get(cardId);
          if (existing && rectsApproxEqual(existing.oldRect, oldRect)) {
            try { existing.tween.kill(); } catch {}
            try { existing.el.remove(); } catch {}
            ghostEls.delete(existing.el);
            activeEchoByCard.delete(cardId);
          }
          const g = el.cloneNode(true);
          g.style.position = 'fixed';
          g.style.left = `${oldRect.left}px`;
          g.style.top = `${oldRect.top}px`;
          g.style.width = `${oldRect.width}px`;
          g.style.height = `${oldRect.height}px`;
          g.style.margin = '0';
          g.style.pointerEvents = 'none';
          g.style.zIndex = '1400';
          g.style.opacity = String(MOTION.ghostEcho?.alpha ?? 0.18);
          // Strip the inline transform GSAP applied to the source (so the
          // source could be parked at its old position via translate). Without
          // this, the clone inherits the source's transform and renders at
          // oldRect + transform = newRect instead of the intended oldRect.
          g.style.transform = 'none';
          g.style.removeProperty('translate');
          g.removeAttribute('data-card');
          g.removeAttribute('data-flip-id');
          document.body.appendChild(g);
          ghosts.push(g);
          ghostEls.add(g);
          const tween = gsap.to(g, {
            opacity: 0,
            scale: MOTION.ghostEcho?.scale ?? 0.96,
            duration: (MOTION.ghostEcho?.duration ?? 0.35) * 0.9,
            ease: MOTION.ghostEcho?.ease ?? 'power2.out',
            delay: cfg.duration * 0.12,
            onComplete: () => {
              try { g.remove(); } catch {}
              ghostEls.delete(g);
              // Only clear the per-card registry if it still points at us
              // (a newer echo may have replaced us already).
              const cur = activeEchoByCard.get(cardId);
              if (cur && cur.el === g) activeEchoByCard.delete(cardId);
            },
          });
          activeEchoByCard.set(cardId, { el: g, tween, oldRect });
        } catch {}
      }
    };
    // Multi-segment ghost trail. Spawns N clones per moved card at fractions
    // along the oldRect→newRect path. Newest segment has full alpha and
    // scale.start; oldest is alpha * 0.2 and scale.end. The new tween spawned
    // for the same card at the same position cancels the previous one.
    const createGhostTrail = () => {
      if (!shouldTrail || moved.length === 0) return;
      // Delegate to the shared trail pipeline in ghostTrail.js. The pipeline
      // owns its own segment lifecycle (clones, fades, DOM cap, organic
      // disposal) and is also used by the continuous drag trail, so cascade
      // and continuous drags share the same underlying bookkeeping.
      for (let i = 0; i < moved.length; i++) {
        const el = moved[i];
        const cardId = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
        const sourceRect = snapshot.get(cardId);
        if (!sourceRect) continue;
        const targetRect = el.getBoundingClientRect();
        spawnTrailCascade({ sourceEl: el, sourceRect, targetRect });
      }
    };
    const bounceCfg = MOTION.bounce;
     // Capture every card id participating in this tween so the registry
     // can dereference them in onComplete (and so cancelSlideTween can
     // find this tween by any one of them).
     const cardIds = moved.map((el) => el.getAttribute('data-flip-id') || el.getAttribute('data-card'));
     const tl = gsap.timeline({
       onComplete: () => {
         completed = true;
         moved.forEach((el) => gsap.set(el, { clearProps: 'scale,boxShadow,rotationZ' }));
         ghosts.forEach((g) => { try { g.remove(); } catch {} ghostEls.delete(g); });
         movers.forEach(({ wrap, prevZ }) => {
           if (wrap) wrap.style.zIndex = prevZ;
         });
         if (stockWrap) stockWrap.style.zIndex = prevStockZ;
         // Deregister every card id this tween owned. Only delete if the
         // registered record still points at THIS tween (cancelSlideTween
         // may have already removed the entry, in which case this is a
         // no-op — and importantly, endTransition was already called by
         // the cancel path, so we must not call it again here).
         let deregisterTid = true;
         for (const id of cardIds) {
           const cur = activeTweens.get(id);
           if (cur && cur.tl === tl) {
             activeTweens.delete(id);
           } else if (cur && cur.tl !== tl) {
             // cancelSlideTween swapped in a different tween for this id;
             // leave it alone, and skip endTransition below since the
             // prior call already handled it.
             deregisterTid = false;
           }
         }
         if (deregisterTid) {
           useUiStore.getState().endTransition(tid);
         }
       },
     });
    if (shouldBounce && bounceCfg) {
      // Bounce no longer pre-applies scale/rotation/boxShadow here — those
      // are now applied AT the moment of landing (positioned at cfg.duration
      // below), so the card slides normally and only pops when it arrives.
      createGhosts();
    } else if (shouldGhost) {
      createGhosts();
    }
    // Trail always runs after echo (if echo is enabled) so they don't fight
    // for the same source — the echo sits at the origin, the trail leads
    // toward the new position.
    if (shouldTrail) createGhostTrail();
    tl.to(moved, {
      x: 0,
      y: 0,
      duration: cfg.duration,
      ease: cfg.ease,
      stagger: cfg.stagger ?? 0,
    });
    // Post-slide bounce. The helper (./useCardMoveSlideBounce.js) is the
    // single source of truth for the step shape and the cfg.duration
    // position — exhaustively unit-tested to lock in the
    // "lands-then-pops-then-settles" sequence. Editing the timing here
    // without updating the helper is a regression.
    const bounceSteps = buildBounceSteps({ cfg, bounceCfg, shouldBounce });
    for (const step of bounceSteps) {
      tl.to(moved, { ...step.props, duration: step.duration, ease: step.ease, stagger: 0 }, step.position);
    }
    // Register this tween against every card id it owns. cancelSlideTween
    // looks up by card id; multi-card runs share one record so all the
    // affected ids map to the same tl/tid. Deregistration happens in the
    // tl's onComplete (or via cancelSlideTween, which removes its own
    // entries and skips endTransition in the onComplete branch).
    const slideRec = { tl, tid, cardIds: new Set(cardIds) };
    for (const id of cardIds) activeTweens.set(id, slideRec);

    // IMPORTANT: no cleanup that kills `tl` on effect re-run. A new transition
    // re-running this effect must start its OWN tween, not tear down the prior
    // in-flight ones. The only teardown happens on unmount (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [state, lastActionMeta]);

  // Kill every slide tween only when the board unmounts.
  useEffect(() => {
    return () => {
      for (const rec of activeTweens.values()) {
        try { rec.tl.kill(); } catch {}
      }
      activeTweens.clear();
      ghostEls.forEach((g) => { try { g.remove(); } catch {} });
      ghostEls.clear();
      activeEchoByCard.clear();
      clearAllGhostTrails();
      useUiStore.getState().clearAllTransitions();
    };
  }, []);
}
