import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useUiStore } from '../../hooks/useUiStore.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';
import { cancelAllDrawSlides } from './useStockDrawSlide.js';

/**
 * Drop every in-flight card-transition lock. A won board is about to be
 * celebrated (or already was) — no in-flight move animation is worth
 * preserving, and a stranded lock would otherwise jam every future deal
 * (all deal entry points bail while animatingCards/slidingCards are held).
 * Safe no-op when nothing is in flight.
 */
function releaseStaleDealLocks() {
  try { cancelAllDrawSlides(); } catch {}
  try { useUiStore.getState().clearAllTransitions(); } catch {}
}

// Module-level handles so a new-game request can abort an in-flight cascade.
let winTween = null;
let foundationPiles = [];

/**
 * Abort a running win cascade immediately (e.g. when the user starts a new
 * game mid-fall). Kills the tween, drops the temporary foundation z-index
 * lift and any leftover inline styles, and releases the global lock so the
 * deal can proceed without waiting for the animation to finish. Safe no-op
 * when no cascade is active.
 */
export function cancelWinCascade() {
  if (winTween) {
    winTween.kill();
    winTween = null;
  }
  if (foundationPiles.length) {
    foundationPiles.forEach((p) => { p.style.zIndex = ''; });
    foundationPiles = [];
  }
  const cards = gsap.utils.toArray('[data-card]');
  if (cards.length) gsap.set(cards, { clearProps: 'all' });
  try { document.querySelectorAll('[data-confetti-layer]').forEach((el) => el.remove()); } catch {}
  gsap.killTweensOf('[data-confetti-layer] div');
  useUiStore.getState().setFullLock(false);
}

export function playWinCascade() {
  let doFall = true;
  let doConfetti = true;
  try {
    const s = useSettingsStore.getState();
    doFall = !!s.winCascade;
    doConfetti = !!s.winEnhanced;
  } catch {}
  let prefersReduced = false;
  try { prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
  if (prefersReduced) doConfetti = false;
  if (!doFall && !doConfetti) {
    // Both effects are disabled (e.g. user toggled winCascade + winEnhanced off
    // since the previous win). Abort any in-flight cascade so its onComplete
    // doesn't later fire and drop the global lock, and so a leftover tween
    // doesn't keep animating cards against the user's preference. Still release
    // transition locks: with no cascade to bulk-clear them, a stranded lock
    // from play would otherwise jam every future deal until a page refresh.
    cancelWinCascade();
    releaseStaleDealLocks();
    return;
  }
  if (typeof document !== 'undefined' && document.hidden) {
    // Background-tab win: no visible DOM to animate against, but the game is
    // still won — release locks so a later deal can never be blocked by them.
    releaseStaleDealLocks();
    return;
  }

  // Kill any in-flight cascade from a previous win (e.g. rapid new-game)
  // so the old tween doesn't keep running and its onComplete corrupts state.
  if (winTween) {
    winTween.kill();
    winTween = null;
  }
  foundationPiles = [];

  if (doConfetti) {
    try { playConfetti(); } catch {}
  }
  if (!doFall) {
    // Cascade disabled but confetti on (a supported settings combo): no tween
    // runs to bulk-clear transition locks, so release them explicitly — a
    // stranded lock from play would otherwise jam every future deal.
    releaseStaleDealLocks();
    if (doConfetti) {
      try { useUiStore.getState().setFullLock(true); } catch {}
      setTimeout(() => { try { useUiStore.getState().setFullLock(false); } catch {} }, 2400);
    }
    return;
  }
  const cards = gsap.utils.toArray('[data-card]');
  if (cards.length === 0) return;
  foundationPiles = [];
  try { useUiStore.getState().setFullLock(true); } catch {}
  try { cancelAllDrawSlides(); } catch {}
  try { useUiStore.getState().clearAllTransitions(); } catch {}
  gsap.killTweensOf(cards);
  gsap.set(cards, { clearProps: 'transform,position' });
  const cardH = measureVar('var(--card-height)');
  const bottomMargin = MOTION.win.bottomMargin;
  let fanStep = 0;
  let uniformFall = 0;
  for (const el of cards) {
    const pile = el.closest('[data-loc^="foundation"]');
    if (!pile) continue;
    if (fanStep === 0) {
      const rect = el.getBoundingClientRect();
      const colH = Math.max(0, window.innerHeight - rect.top - bottomMargin - cardH);
      fanStep = Math.min(cardH, colH / 12);
      uniformFall = Math.max(0, colH - 12 * fanStep);
    }
    const idx = parseInt(el.parentElement?.style.zIndex || '0', 10);
    el._fanY = idx * fanStep;
    el._fallY = uniformFall;
    pile.style.zIndex = '2000';
    foundationPiles.push(pile);
  }
  const useEnhanced = !prefersReduced && !!MOTION.winEnhanced;
  if (useEnhanced) {
    winTween = gsap.timeline({
      onComplete: () => {
        winTween = null;
        try { useUiStore.getState().setFullLock(false); } catch {}
        foundationPiles.forEach((p) => { p.style.zIndex = ''; });
        foundationPiles = [];
      },
    });
    winTween.to(cards, {
      y: -22,
      scale: 1.03,
      rotation: (i, el) => (el._fanY != null ? 0 : gsap.utils.random(-8, 8)),
      duration: MOTION.winEnhanced.phase1.duration,
      ease: MOTION.winEnhanced.phase1.ease,
      stagger: { each: MOTION.winEnhanced.phase1.stagger, from: 'end' },
    }, 0);
    winTween.to(cards, {
      x: (i, el) => (el._fanY != null ? 0 : gsap.utils.random(-110, 110)),
      y: (i, el) => {
        if (el._fallY != null) return el._fallY + (el._fanY || 0);
        const rect = el.getBoundingClientRect();
        const maxFall = Math.max(0, window.innerHeight - rect.bottom - bottomMargin);
        return Math.min(MOTION.win.flyDistance, maxFall);
      },
      rotation: () => gsap.utils.random(-72, 72),
      scale: 0.98,
      duration: MOTION.winEnhanced.phase2.duration,
      ease: MOTION.winEnhanced.phase2.ease,
      stagger: { each: MOTION.winEnhanced.phase2.stagger, from: 'end' },
    }, MOTION.winEnhanced.phase1.duration * 0.6);
  } else {
    winTween = gsap.to(cards, {
      x: (i, el) => (el._fanY != null ? 0 : gsap.utils.random(-90, 90)),
      y: (i, el) => {
        if (el._fallY != null) return el._fallY + (el._fanY || 0);
        const rect = el.getBoundingClientRect();
        const maxFall = Math.max(0, window.innerHeight - rect.bottom - bottomMargin);
        return Math.min(MOTION.win.flyDistance, maxFall);
      },
      rotation: () => gsap.utils.random(-60, 60),
      stagger: { each: MOTION.win.stagger, from: 'end' },
      duration: MOTION.win.duration,
      ease: MOTION.win.ease,
      onComplete: () => {
        winTween = null;
        try { useUiStore.getState().setFullLock(false); } catch {}
        foundationPiles.forEach((p) => { p.style.zIndex = ''; });
        foundationPiles = [];
      },
    });
  }
}

function playConfetti() {
  const cfg = MOTION.confetti || {};
  const fallbackCount = MOTION.winEnhanced?.confettiCount;
  const count = window.innerWidth < 768 ? 18 : (cfg.count ?? fallbackCount ?? 32);
  const duration = cfg.duration ?? 1.1;
  const ease = cfg.ease ?? 'power2.in';
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('data-confetti-layer', 'true');
  layer.style.position = 'fixed';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  layer.style.zIndex = '2600';
  document.body.appendChild(layer);
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.style.position = 'absolute';
    dot.style.left = `${45 + Math.random() * 10}%`;
    dot.style.top = '42%';
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.background = ['#ffd54a', '#ff6b6b', '#4ecdc4', '#34d6ff', '#a8e6a3'][i % 5];
    dot.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
    layer.appendChild(dot);
    const tx = (Math.random() - 0.5) * window.innerWidth * 0.9;
    const ty = window.innerHeight * 0.55 + Math.random() * 220;
    gsap.fromTo(dot, { x: 0, y: 0, scale: 1, opacity: 1 }, { x: tx, y: ty, scale: 0.6, opacity: 0, rotation: Math.random() * 540, duration: duration + Math.random() * 0.6, ease, delay: 0.12 + Math.random() * 0.18, onComplete: () => { try { dot.remove(); } catch {} } });
  }
  setTimeout(() => { try { layer.remove(); } catch {} }, 2200);
}

// Resolve a CSS length expression (clamp()/calc()/var()) to a pixel number by
// mounting a hidden probe element. Used here to size the foundation fan step.
function measureVar(expr) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;height:${expr};`;
  document.body.appendChild(probe);
  const px = probe.offsetHeight;
  document.body.removeChild(probe);
  return px;
}

