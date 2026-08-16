import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

export function playWinCascade() {
  const cards = gsap.utils.toArray('[data-card]');
  if (cards.length === 0) return;
  // Kill any Flip.from tweens still in flight from the winning move / the
  // auto-complete moves just before it, and clear their leftover inline
  // transform/position, so the cascade is the sole animator. Otherwise Flip's
  // onComplete cleanup snaps cards back to rest, leaving some (e.g. the buried
  // "2" in a foundation stack) looking static while neighbours tumble.
  gsap.killTweensOf(cards);
  gsap.set(cards, { clearProps: 'transform,position' });

  // Foundation piles are rendered non-fanned: all 13 cards share one x/y and
  // stack, so only the top (King) is visible — buried cards translate with it
  // but stay hidden, appearing static. Fan each foundation card downward by its
  // pile index (read from the wrapper's zIndex) so the whole stack becomes a
  // visible column and every card — Ace, 2, …, King — clearly drops.
  const cardH = measureVar('var(--card-height)');
  for (const el of cards) {
    const pile = el.closest('[data-loc^="foundation"]');
    if (!pile) continue;
    const idx = parseInt(el.parentElement?.style.zIndex || '0', 10);
    const step = Math.max(
      8,
      Math.min(40, (window.innerHeight - el.getBoundingClientRect().top - MOTION.win.bottomMargin - cardH) / 12),
    );
    el._fanY = idx * step;
  }

  gsap.to(cards, {
    // Horizontal scatter so overlapping foundation stacks separate and every
    // card — including buried ones — is clearly seen moving.
    x: () => gsap.utils.random(-90, 90),
    // Per-card downward travel, clamped so no card's bottom edge crosses the
    // window bottom. flyDistance is the max fall; bottomMargin keeps the
    // rotated bounding box (and sub-pixel rounding) safely inside the viewport.
    // Foundation cards add their fan offset (and their fall is reduced by the
    // same amount) so the fanned column still fits on screen.
    y: (i, el) => {
      const rect = el.getBoundingClientRect();
      const fan = el._fanY || 0;
      const maxFall = Math.max(0, window.innerHeight - (rect.top + fan) - MOTION.win.bottomMargin);
      const fall = Math.min(MOTION.win.flyDistance, Math.max(0, window.innerHeight - rect.bottom - MOTION.win.bottomMargin));
      return Math.min(fall, maxFall) + fan;
    },
    rotation: () => gsap.utils.random(-60, 60),
    stagger: MOTION.win.stagger,
    duration: MOTION.win.duration,
    ease: MOTION.win.ease,
  });
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

