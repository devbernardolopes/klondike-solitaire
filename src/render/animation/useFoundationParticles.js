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

import { useLayoutEffect, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { drainParticles } from './particleBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';
import { getDeck } from '../deck/deckRegistry.js';

let layerEl = null;

/** Lazily create (and keep) the fixed overlay that holds particle sprites. */
function getLayer() {
  if (layerEl && document.body.contains(layerEl)) return layerEl;
  layerEl = document.createElement('div');
  layerEl.setAttribute('aria-hidden', 'true');
  layerEl.style.position = 'fixed';
  layerEl.style.inset = '0';
  layerEl.style.pointerEvents = 'none';
  layerEl.style.zIndex = '2500';
  layerEl.style.overflow = 'hidden';
  document.body.appendChild(layerEl);
  return layerEl;
}

/**
 * Compute the on-screen center of a foundation pile from its locator.
 * @param {string} loc  e.g. 'foundation:2'
 * @returns {{x:number, y:number}|null}
 */
function locCenter(loc) {
  const el = document.querySelector(`[data-loc="${loc}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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
    const cfg = MOTION.particles;

    for (const { suit, loc } of events) {
      const origin = locCenter(loc);
      if (!origin) continue;

      const url = getDeck(deck).renderSuit(suit);
      for (let i = 0; i < cfg.count; i++) {
        const angle = (Math.PI * 2 * i) / cfg.count + Math.random() * 0.4;
        const radius = cfg.radius * (0.7 + Math.random() * 0.3);
        const tx = Math.cos(angle) * radius;
        const ty = Math.sin(angle) * radius;

        const sprite = document.createElement('img');
        sprite.src = url;
        sprite.style.position = 'absolute';
        sprite.style.left = `${origin.x}px`;
        sprite.style.top = `${origin.y}px`;
        sprite.style.width = `${cfg.size}px`;
        sprite.style.height = `${cfg.size}px`;
        sprite.style.marginLeft = `${-cfg.size / 2}px`;
        sprite.style.marginTop = `${-cfg.size / 2}px`;
        sprite.style.willChange = 'transform, opacity';
        layer.appendChild(sprite);

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
            onComplete: () => sprite.remove(),
          }
        );
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
