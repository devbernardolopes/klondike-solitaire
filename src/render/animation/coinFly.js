// render/animation/coinFly.js
// Win coin flight: gold coin sprites arc one by one from the Win modal's
// center to the Toolbar coin balance, each landing ticking the DISPLAYED
// balance +1 (the store/DB award itself is untouched — the full amount is
// credited underneath immediately, and this only masks the display while
// active; see useUiStore.coinFlight + coinFlyDisplay.js).
//
// Coins accelerate along the sequence: coin i flies for
// firstDuration * accelFactor^i seconds with an ease-in homing leg, launched
// every stagger seconds. The sprite reuses the live Toolbar coin icon
// (cloned from [data-coin-balance]) so it is always the same glyph,
// tinted gold; a CSS circle is the fallback when the anchor isn't mounted.

import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

let layerEl = null;

/** Lazily create (and keep) the fixed overlay that holds flying coins. */
function getLayer() {
  try {
    if (layerEl && document.body.contains(layerEl)) return layerEl;
    layerEl = document.createElement('div');
    layerEl.setAttribute('aria-hidden', 'true');
    // Above the Win modal (z 3000) so coins read as flying out of it;
    // pointer-events none so the flight never steals taps.
    layerEl.style.position = 'fixed';
    layerEl.style.inset = '0';
    layerEl.style.width = '100%';
    layerEl.style.height = '100%';
    layerEl.style.pointerEvents = 'none';
    layerEl.style.zIndex = '3500';
    layerEl.style.overflow = 'hidden';
    document.body.appendChild(layerEl);
    return layerEl;
  } catch {
    return null;
  }
}

const GOLD = '#f0b429';

/**
 * Build one coin sprite: a clone of the Toolbar balance icon when available
 * (guaranteeing the same glyph), else a plain gold disc.
 * @param {number} size  sprite px
 * @returns {HTMLElement}
 */
function makeCoin(size) {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.margin = '0';
  el.style.pointerEvents = 'none';
  el.style.color = GOLD;
  let svg = null;
  try {
    svg = document.querySelector('[data-coin-balance] svg')?.cloneNode(true) ?? null;
  } catch {
    svg = null;
  }
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    // Lucide strokes use currentColor — force the gold tint on the clone.
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    el.appendChild(svg);
  } else {
    el.style.borderRadius = '50%';
    el.style.background = `radial-gradient(circle at 35% 30%, #ffe08a, ${GOLD} 65%, #9c6b00)`;
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
  }
  return el;
}

/**
 * Fly `count` coins from `from` to `to` (viewport-center coords), one by one,
 * each faster than the last. `onArrive(i)` fires per landing (drives the
 * displayed +1); `targetEl` gets a small scale pop per landing.
 *
 * @param {object} opts
 * @param {{x:number, y:number}} opts.from   launch center (viewport px)
 * @param {{x:number, y:number}} opts.to     destination center (viewport px)
 * @param {number} opts.count                coins to fly
 * @param {HTMLElement} [opts.targetEl]      balance anchor to pulse per landing
 * @param {(index:number) => void} [opts.onArrive]
 * @returns {{ promise: Promise<{landed:number, cancelled:boolean}>, cancel: () => void }}
 */
export function flyCoins({ from, to, count, targetEl, onArrive }) {
  const cfg = MOTION.coinFly;
  const total = Math.max(0, Math.floor(count ?? cfg?.count ?? 0));
  let cancelled = false;
  let landed = 0;
  const pending = new Set(); // delayedCalls + tweens, for cancel()
  let resolveDone;
  const promise = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const finish = () => {
    try {
      resolveDone({ landed, cancelled });
    } catch {}
  };

  if (total === 0 || !from || !to) {
    finish();
    return { promise, cancel: () => {} };
  }

  const layer = getLayer();
  if (!layer) {
    // No DOM to fly through (tests / fault isolation): report zero landings
    // so the caller falls back to the unmasked balance.
    finish();
    return { promise, cancel: () => {} };
  }

  const size = cfg?.size ?? 28;
  const firstDuration = cfg?.firstDuration ?? 0.9;
  const accelFactor = cfg?.accelFactor ?? 0.88;
  const stagger = cfg?.stagger ?? 0.12;
  const ease = cfg?.ease ?? 'power2.in';
  const arcHeight = cfg?.arcHeight ?? 60;
  const pop = cfg?.balancePop ?? 0.25;
  // Lobbed path: rise to a midpoint above the straight line, then home in.
  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - arcHeight };

  const landOne = (coin, index) => {
    if (cancelled) return;
    try {
      coin.remove();
    } catch {}
    landed += 1;
    try {
      onArrive?.(index);
    } catch {}
    // Scale-pop the balance anchor per landing; overwrite any in-flight pop
    // so rapid arrivals don't stack transforms, and clear afterwards so no
    // inline residue beats future CSS.
    if (targetEl) {
      try {
        gsap.fromTo(
          targetEl,
          { scale: 1 },
          {
            scale: 1 + pop,
            duration: 0.09,
            ease: 'power2.out',
            overwrite: 'auto',
            yoyo: true,
            repeat: 1,
            onComplete: () => {
              try {
                gsap.set(targetEl, { clearProps: 'scale' });
              } catch {}
            },
          },
        );
      } catch {}
    }
    if (landed >= total) finish();
  };

  for (let i = 0; i < total; i++) {
    const duration = firstDuration * Math.pow(accelFactor, i);
    const launch = () => {
      if (cancelled) return;
      let coin = null;
      try {
        coin = makeCoin(size);
        coin.style.left = `${from.x - size / 2}px`;
        coin.style.top = `${from.y - size / 2}px`;
        layer.appendChild(coin);
      } catch {
        return;
      }
      try {
        const tl = gsap.timeline({
          onComplete: () => landOne(coin, i),
        });
        tl.to(coin, {
          x: mid.x - from.x,
          y: mid.y - from.y,
          duration: duration * 0.45,
          ease: 'power2.out',
        }).to(coin, {
          x: to.x - from.x,
          y: to.y - from.y,
          duration: duration * 0.55,
          ease,
        });
        pending.add(tl);
      } catch {
        landOne(coin, i);
      }
    };
    try {
      const call = gsap.delayedCall(i * stagger, launch);
      pending.add(call);
    } catch {
      launch();
    }
  }

  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      for (const t of pending) {
        try {
          t.kill();
        } catch {}
      }
      pending.clear();
      try {
        layer.querySelectorAll('*').forEach((n) => {
          try {
            n.remove();
          } catch {}
        });
      } catch {}
      finish();
    },
  };
}
