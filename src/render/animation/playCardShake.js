import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

// "No valid move" feedback: a short horizontal jitter on the card that decays
// back to rest. On finish we clear the inline transform so it never collides
// with dnd-kit's drag transforms or the Flip position pipeline.
export function playCardShake(node) {
  if (!node) return;
  const { duration, distance } = MOTION.shake;
  gsap.timeline({ onComplete: () => gsap.set(node, { clearProps: 'transform' }) })
    .to(node, { x: -distance, duration: duration * 0.15, ease: 'power2.out' })
    .to(node, { x: distance, duration: duration * 0.2 })
    .to(node, { x: -distance * 0.6, duration: duration * 0.2 })
    .to(node, { x: distance * 0.6, duration: duration * 0.2 })
    .to(node, { x: 0, duration: duration * 0.25, ease: 'power2.inOut' });
}
