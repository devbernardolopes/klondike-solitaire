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
  recycle: MOTION.recycle,
  undo: MOTION.undo,
};

// Module-level registry of in-flight timelines. These are intentionally NOT tied
// to a single effect instance's cleanup, so a second move starting while the
// first is still sliding does NOT kill the first tween — the two animate
// concurrently (they always involve disjoint cards/piles, so they never
// visually interfere). Only the unmount effect below kills them.
const activeTweens = [];

// Module-level registry of ghost DOM elements created by createGhosts().
// Cleaned up on unmount so a killed tween (or component unmount) does not
// orphan ghost elements in the DOM.
const ghostEls = new Set();

// Module-level registry of trail segment DOM elements created by
// createGhostTrail(). Cleaned up on unmount like the echo set.
const trailEls = new Set();

// Per-card registry of the currently-active echo and trail, so that an echo
// or trail for a card returning to a position where one is still playing
// is CANCELLED in favor of the new one (avoids two echoes on the same card
// in the same spot when the user spams tap/undo). Keyed by cardId, each
// entry stores the elements and tweens to kill if a new echo/trail is
// spawned for the same card at the same position.
const activeEchoByCard = new Map(); // cardId -> { el, tween, oldRect: {left,top,width,height} }
const activeTrailByCard = new Map(); // cardId -> { els: HTMLElement[], tweens: GSAPTween[], oldRect: DOMRect }

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
      const tcfg = MOTION.ghostTrail;
      if (!tcfg) return;
      const segments = tcfg.segments ?? 5;
      const segmentInterval = tcfg.segmentInterval ?? 0.03;
      const segmentDuration = tcfg.duration / segments;
      const alpha = tcfg.alpha ?? 0.25;
      const scaleStart = tcfg.scale?.start ?? 1.0;
      const scaleEnd = tcfg.scale?.end ?? 0.94;
      const maxConcurrent = tcfg.maxConcurrent ?? 24;
      const z = type === 'drag' ? '1450' : '1400'; // drag trail sits above echoes
      for (let i = 0; i < moved.length; i++) {
        const el = moved[i];
        try {
          const cardId = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
          const oldRect = snapshot.get(cardId);
          if (!oldRect) continue;
          const newRect = el.getBoundingClientRect();
          const dx = newRect.left - oldRect.left;
          const dy = newRect.top - oldRect.top;
          if (dx === 0 && dy === 0) continue; // same-pile reshuffle — no trail needed
          // Per-card dedup (same rule as echo).
          const existing = activeTrailByCard.get(cardId);
          if (existing && rectsApproxEqual(existing.oldRect, oldRect)) {
            for (const tw of existing.tweens) { try { tw.kill(); } catch {} }
            for (const e of existing.els) { try { e.remove(); } catch {} trailEls.delete(e); }
            activeTrailByCard.delete(cardId);
          }
          const els = [];
          const tweens = [];
          for (let s = 0; s < segments; s++) {
            if (trailEls.size >= maxConcurrent) break;
            // fraction 1/segments..segments/segments — oldest first.
            const fraction = (s + 1) / segments;
            const left = oldRect.left + dx * fraction;
            const top = oldRect.top + dy * fraction;
            // Newest segment (fraction→1) has the highest opacity; oldest has
            // alpha * 0.2 (matches "almost 100% transparency at the tail").
            const opacity = alpha * (1 - fraction * 0.8);
            const scale = scaleStart - (scaleStart - scaleEnd) * fraction;
            const seg = el.cloneNode(true);
            seg.style.position = 'fixed';
            seg.style.left = `${left}px`;
            seg.style.top = `${top}px`;
            seg.style.width = `${oldRect.width}px`;
            seg.style.height = `${oldRect.height}px`;
            seg.style.margin = '0';
            seg.style.pointerEvents = 'none';
            seg.style.zIndex = z;
            seg.style.opacity = String(opacity);
            seg.style.transform = 'none';
            seg.style.removeProperty('translate');
            seg.removeAttribute('data-card');
            seg.removeAttribute('data-flip-id');
            document.body.appendChild(seg);
            els.push(seg);
            trailEls.add(seg);
            const tw = gsap.to(seg, {
              opacity: 0,
              scale: scale * 0.92,
              duration: segmentDuration,
              ease: tcfg.ease ?? 'power2.out',
              delay: s * segmentInterval,
              onComplete: () => {
                try { seg.remove(); } catch {}
                trailEls.delete(seg);
                // Only clear the per-card registry if all our segments are done
                // AND the entry still points at us.
                const cur = activeTrailByCard.get(cardId);
                if (cur && cur.els === els) {
                  const stillOurs = cur.tweens.includes(tw);
                  if (!stillOurs || cur.tweens.every((t) => t.paused() || t.progress() >= 1)) {
                    activeTrailByCard.delete(cardId);
                  }
                }
              },
            });
            tweens.push(tw);
          }
          if (els.length) {
            activeTrailByCard.set(cardId, { els, tweens, oldRect });
          }
        } catch {}
      }
    };
    const bounceCfg = MOTION.bounce;
     const tl = gsap.timeline({
       onComplete: () => {
         completed = true;
         moved.forEach((el) => gsap.set(el, { clearProps: 'scale,boxShadow,rotationZ' }));
         ghosts.forEach((g) => { try { g.remove(); } catch {} ghostEls.delete(g); });
         movers.forEach(({ wrap, prevZ }) => {
           if (wrap) wrap.style.zIndex = prevZ;
         });
         if (stockWrap) stockWrap.style.zIndex = prevStockZ;
         const i = activeTweens.indexOf(tl);
         if (i >= 0) activeTweens.splice(i, 1);
         useUiStore.getState().endTransition(tid);
       },
     });
    if (shouldBounce && bounceCfg) {
      moved.forEach((el) => gsap.set(el, { scale: bounceCfg.scale ?? 1.06, rotationZ: gsap.utils.random(-(bounceCfg.rotation ?? 0.8), bounceCfg.rotation ?? 0.8), boxShadow: bounceCfg.boxShadow ?? '0 14px 32px rgba(0,0,0,0.45), 0 5px 12px rgba(0,0,0,0.35)' }));
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
    if (shouldBounce && bounceCfg) {
      tl.to(moved, {
        scale: 1,
        rotationZ: 0,
        boxShadow: '0 4px 10px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.28)',
        duration: bounceCfg.duration ?? 0.20,
        ease: bounceCfg.ease ?? 'back.out(0.6)',
        stagger: 0,
      }, 0);
    }
    activeTweens.push(tl);

    // IMPORTANT: no cleanup that kills `tl` on effect re-run. A new transition
    // re-running this effect must start its OWN tween, not tear down the prior
    // in-flight ones. The only teardown happens on unmount (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [state, lastActionMeta]);

  // Kill the draw tween only when the board unmounts.
  useEffect(() => {
    return () => {
      activeTweens.forEach((t) => t.kill());
      activeTweens.length = 0;
      ghostEls.forEach((g) => { try { g.remove(); } catch {} });
      ghostEls.clear();
      trailEls.forEach((g) => { try { g.remove(); } catch {} });
      trailEls.clear();
      activeEchoByCard.clear();
      activeTrailByCard.clear();
      useUiStore.getState().clearAllTransitions();
    };
  }, []);
}
