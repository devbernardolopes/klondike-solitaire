// render/animation/useFoundationParticles.js
//
// Spawns the foundation "suit burst": whenever a card lands on a foundation pile
// the store enqueues a particle event (suit + destination locator) on
// particleBridge. After each React commit this hook drains those events and,
// for each one, creates a short-lived overlay of suit-glyph sprites that explode
// outward from the foundation's center — starting slow and ACCELERATING to a
// radius while fading — then remove themselves.
//
// The effect is purely decorative: particles live in a fixed-position layer
// above the board and never touch the card DOM or the transition lock. It is
// gated by the `particles` settings flag.
//
// Mobile robustness: this subsystem is deliberately fault-isolated. Any
// device-specific failure (canvas encoding under memory pressure, a layout
// quirk, a GSAP edge case) is caught and degraded gracefully instead of
// throwing into React's commit phase and crashing the app. We also avoid
// `will-change` on the sprites (which would force each one into its own GPU
// compositor layer and exhaust mobile memory) and cap the number of live
// particles so a rapid burst of foundation arrivals (e.g. auto-complete) can
// never grow unbounded.

import { useLayoutEffect, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { drainParticles } from './particleBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';
import { getDeck } from '../deck/deckRegistry.js';

let layerEl = null;

// Global cap on concurrently-animating particles. Bursts that would exceed it
// are dropped, which bounds memory/CPU on low-power devices no matter how many
// foundation arrivals happen back-to-back.
const MAX_PARTICLES = 120;
let activeCount = 0;
let warned = false;

/** Lazily create (and keep) the fixed overlay that holds particle sprites. */
function getLayer() {
  try {
    if (layerEl && document.body.contains(layerEl)) return layerEl;
    layerEl = document.createElement('div');
    layerEl.setAttribute('aria-hidden', 'true');
    layerEl.style.position = 'fixed';
    // Explicit width/height alongside inset so older mobile engines that don't
    // support the `inset` shorthand still size the layer correctly.
    layerEl.style.inset = '0';
    layerEl.style.width = '100%';
    layerEl.style.height = '100%';
    layerEl.style.pointerEvents = 'none';
    layerEl.style.zIndex = '2500';
    layerEl.style.overflow = 'hidden';
    document.body.appendChild(layerEl);
    return layerEl;
  } catch {
    return null;
  }
}

/**
 * Compute the on-screen center of a foundation pile from its locator.
 * @param {string} loc  e.g. 'foundation:2'
 * @returns {{x:number, y:number}|null}
 */
function locCenter(loc) {
  try {
    const el = document.querySelector(`[data-loc="${loc}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  } catch {
    return null;
  }
}

/** Spawn a full burst for one event, respecting the global particle cap. */
function spawnBurst(layer, event, cfg) {
  const origin = locCenter(event.loc);
  if (!origin) return;

  let url;
  try {
    url = getDeck(event.deck).renderSuit(event.suit);
  } catch {
    return;
  }
  if (!url) return;

  for (let i = 0; i < cfg.count; i++) {
    if (activeCount >= MAX_PARTICLES) {
      // Out of budget: drop the rest of this burst (and any later events are
      // drained-and-discarded by the caller) rather than grow unbounded.
      return;
    }
    const angle = (Math.PI * 2 * i) / cfg.count + Math.random() * 0.4;
    const radius = cfg.radius * (0.7 + Math.random() * 0.3);
    const tx = Math.cos(angle) * radius;
    const ty = Math.sin(angle) * radius;

    let sprite;
    try {
      sprite = document.createElement('img');
      sprite.src = url;
      sprite.style.position = 'absolute';
      sprite.style.left = `${origin.x}px`;
      sprite.style.top = `${origin.y}px`;
      sprite.style.width = `${cfg.size}px`;
      sprite.style.height = `${cfg.size}px`;
      sprite.style.marginLeft = `${-cfg.size / 2}px`;
      sprite.style.marginTop = `${-cfg.size / 2}px`;
      layer.appendChild(sprite);
    } catch {
      continue;
    }

    activeCount++;
    const release = () => {
      activeCount = Math.max(0, activeCount - 1);
      try {
        sprite.remove();
      } catch {
        /* no-op */
      }
    };

    try {
      gsap.fromTo(
        sprite,
        { x: 0, y: 0, scale: 0.4, rotation: 0, autoAlpha: 1 },
        {
          x: tx,
          y: ty,
          scale: 1,
          rotation: (Math.random() * 2 - 1) * cfg.spin,
          autoAlpha: 0,
          duration: cfg.duration,
          ease: cfg.ease,
          onComplete: release,
        }
      );
    } catch {
      release();
    }
  }
}

export function useFoundationParticles() {
  const state = useGameStore((s) => s.state);
  const lastActionMeta = useGameStore((s) => s.lastActionMeta);
  const enabled = useSettingsStore((s) => s.particles);
  const deck = useSettingsStore((s) => s.deck);

  useLayoutEffect(() => {
    // When disabled, drain and discard so stale events don't accumulate and
    // fire in a burst the moment the toggle is turned back on.
    if (!enabled) {
      drainParticles();
      return;
    }
    const events = drainParticles();
    if (events.length === 0) return;

    const layer = getLayer();
    if (!layer) {
      // Couldn't create the overlay (extremely unlikely); don't crash.
      return;
    }
    const cfg = MOTION.particles;

    for (const { suit, loc } of events) {
      // Fault-isolated per event: one bad locator/deck can never take down the
      // rest of the app.
      try {
        spawnBurst(layer, { suit, loc, deck }, cfg);
      } catch (err) {
        if (!warned) {
          warned = true;
          // eslint-disable-next-line no-console
          console.warn('[particles] burst skipped:', err);
        }
      }
      // Stop spawning if we've hit the cap; discard any remaining queued events
      // so they don't fire in a delayed clump later.
      if (activeCount >= MAX_PARTICLES) {
        drainParticles();
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, lastActionMeta, enabled, deck]);

  // Tear down the overlay only on unmount so bursts from a prior commit are not
  // orphaned; nothing else needs cleanup.
  useEffect(() => {
    return () => {
      if (layerEl) {
        layerEl.remove();
        layerEl = null;
      }
    };
  }, []);
}
