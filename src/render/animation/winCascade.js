import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

export function playWinCascade() {
  const cards = gsap.utils.toArray('[data-card]');
  gsap.to(cards, {
    y: `+=${MOTION.win.flyDistance}`,
    rotation: () => gsap.utils.random(-35, 35),
    stagger: MOTION.win.stagger,
    duration: MOTION.win.duration,
    ease: MOTION.win.ease,
  });
}
