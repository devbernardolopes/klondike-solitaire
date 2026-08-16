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
  gsap.to(cards, {
    // Horizontal scatter so overlapping foundation stacks separate and every
    // card — including buried ones — is clearly seen moving.
    x: () => gsap.utils.random(-90, 90),
    // Per-card downward travel, clamped so no card's bottom edge crosses the
    // window bottom. flyDistance is the max fall; bottomMargin keeps the
    // rotated bounding box (and sub-pixel rounding) safely inside the viewport.
    y: (i, el) => {
      const rect = el.getBoundingClientRect();
      const remaining = window.innerHeight - rect.bottom - MOTION.win.bottomMargin;
      return Math.min(MOTION.win.flyDistance, Math.max(0, remaining));
    },
    rotation: () => gsap.utils.random(-60, 60),
    stagger: MOTION.win.stagger,
    duration: MOTION.win.duration,
    ease: MOTION.win.ease,
  });
}
