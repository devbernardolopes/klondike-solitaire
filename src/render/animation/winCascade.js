import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

export function playWinCascade() {
  const cards = gsap.utils.toArray('[data-card]');
  gsap.to(cards, {
    // Per-card downward travel, clamped so no card's bottom edge crosses the
    // window bottom. flyDistance remains the max fall (set in motion.js).
    y: (i, el) => {
      const rect = el.getBoundingClientRect();
      const remaining = window.innerHeight - rect.bottom;
      return Math.min(MOTION.win.flyDistance, Math.max(0, remaining));
    },
    rotation: () => gsap.utils.random(-35, 35),
    stagger: MOTION.win.stagger,
    duration: MOTION.win.duration,
    ease: MOTION.win.ease,
  });
}
