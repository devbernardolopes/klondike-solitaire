// render/animation/useIdleWobble.js
// "Wobbly Cards" idle effect: a continuous, subtle, per-card rocking tilt
// (pure rotation around the card center) for resting face-up tableau cards.
// GSAP loop (not CSS) so each card gets an individual random phase, amplitude,
// and leg speed, and so cancellation is synchronous (kill + clearProps) the
// instant any interaction owns the card.
//
// Transform isolation: the tween targets a dedicated inner wrapper
// (`[data-wobble]` in CardView), NEVER the outer `[data-card]` node owned by
// dnd-kit drag transforms, playCardShake, or the Flip move pipeline. The
// wrapper carries no pointer handlers, so the effect never blocks interaction.

import { useEffect, useRef } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

// Module-level registry of live wobble tweens, keyed by card id, so a
// pointerdown / drag-start / shake can cancel THIS card's wobble
// synchronously (before the React commit that flips `enabled` to false).
const wobbleTweens = new Map(); // cardId -> { tween, node }

function rand(min, max) {
  if (!(max > min)) return min;
  return min + Math.random() * (max - min);
}

/**
 * Synchronously cancel a card's idle wobble (pointerdown, drag start, shake,
 * slide). Kills the GSAP tween WITHOUT firing its onComplete chain, then
 * clears the inline transform so no residual tilt collides with drag/Flip/shake.
 * Safe to call when no wobble is running (no-op).
 * @param {string} cardId
 */
export function killWobble(cardId) {
  if (!cardId) return;
  const rec = wobbleTweens.get(cardId);
  if (!rec) return;
  try {
    rec.tween?.kill();
  } catch {}
  try {
    if (rec.node) gsap.set(rec.node, { clearProps: 'transform' });
    else {
      const el = document.querySelector(`[data-wobble="${CSS.escape(cardId)}"]`);
      if (el) gsap.set(el, { clearProps: 'transform' });
    }
  } catch {}
  wobbleTweens.delete(cardId);
}

/** Kill every live wobble (deal reset / unmount / hard reset). */
export function killAllWobbles() {
  for (const cardId of Array.from(wobbleTweens.keys())) killWobble(cardId);
}

function readCfg() {
  const cfg = MOTION.wobble || {};
  const maxRotation = Math.max(0, cfg.maxRotation ?? 1.5);
  let durationMin = cfg.durationMin ?? 1.6;
  let durationMax = cfg.durationMax ?? 3.2;
  if (!(durationMin > 0)) durationMin = 0.4;
  if (!(durationMax >= durationMin)) durationMax = durationMin;
  return { maxRotation, durationMin, durationMax, ease: cfg.ease ?? 'sine.inOut' };
}

/**
 * Drive the idle wobble loop on an inner wrapper node.
 * @param {React.RefObject<HTMLElement>} ref wrapper node ([data-wobble])
 * @param {boolean} enabled result of shouldWobble() for this card right now
 * @param {string} cardId stable card id (registry key)
 */
export function useIdleWobble(ref, enabled, cardId) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const node = ref.current;
    if (!node || !cardId) return undefined;
    if (!enabled) {
      killWobble(cardId);
      return undefined;
    }
    const cfg = readCfg();
    if (cfg.maxRotation <= 0) return undefined;
    // A previous loop for this card (e.g. remount race) is replaced.
    killWobble(cardId);
    // Desync cards: each starts from a random tilt after a random pause so
    // the tableau never rocks in unison. The pivot is pinned to the card
    // center so the card tilts in place instead of orbiting.
    gsap.set(node, { rotation: rand(-cfg.maxRotation, cfg.maxRotation), transformOrigin: '50% 50%' });
    const state = { tween: null, dead: false };
    const swing = () => {
      if (state.dead || !enabledRef.current) return;
      // Re-read the preset per swing so the Leva debug panel retunes live.
      const live = readCfg();
      if (live.maxRotation <= 0) return;
      try {
        const el = ref.current;
        if (!el || !el.isConnected) return;
      } catch {}
      state.tween = gsap.to(node, {
        rotation: rand(-live.maxRotation, live.maxRotation),
        duration: rand(live.durationMin, live.durationMax),
        ease: live.ease,
        overwrite: 'auto',
        onComplete: swing,
      });
      // Keep the registry pointed at the latest leg so killWobble() always
      // cancels the in-flight tween, not a stale one.
      wobbleTweens.set(cardId, { tween: state.tween, node });
    };
    const starter = gsap.delayedCall(rand(0, 0.9), swing);
    wobbleTweens.set(cardId, { tween: starter, node });
    return () => {
      state.dead = true;
      try {
        starter.kill();
      } catch {}
      killWobble(cardId);
    };
  }, [ref, enabled, cardId]);
}
