import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useUiStore } from '../../hooks/useUiStore.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

// "No valid move" feedback: a short horizontal jitter on the card that decays
// back to rest. On finish we clear the inline transform so it never collides
// with dnd-kit's drag transforms or the Flip position pipeline.

// Module-level registry of in-flight shake tweens, keyed by card id, so a
// mid-shake tap can cancel THIS card's shake (see cancelShake).
const shakeTweens = new Map(); // cardId -> { tl }

/**
 * Cancel a card's in-flight shake (e.g. because the player tapped it to
 * auto-move it now that a valid target exists). Kills the GSAP timeline WITHOUT
 * firing its onComplete, then releases the shake lock so moveCard can run.
 * @param {string} cardId
 */
export function cancelShake(cardId) {
  const rec = shakeTweens.get(cardId);
  if (!rec) return;
  rec.tl.kill();
  shakeTweens.delete(cardId);
  useUiStore.getState().removeShaking(cardId);
}

export function playCardShake(node) {
  if (!node) return;
  if (gsap.isTweening(node)) return;
  const cardId = node.getAttribute('data-card');
  if (!cardId) return;
  // Gated by the user setting. When disabled we early-out BEFORE the
  // `addShaking` lock + `gsap.timeline(...)` allocation, so a spam-tapper
  // who has shakes off pays nothing for invalid taps.
  try {
    if (!useSettingsStore.getState().cardShake) return;
  } catch {
    /* settings store unavailable — fall through and play */
  }
  const ui = useUiStore.getState();
  ui.addShaking(cardId);
  const { duration, distance } = MOTION.shake;
  const tl = gsap.timeline({
    onComplete: () => {
      gsap.set(node, { clearProps: 'transform' });
      shakeTweens.delete(cardId);
      useUiStore.getState().removeShaking(cardId);
    },
  })
    .to(node, { x: -distance, duration: duration * 0.15, ease: 'power2.out' })
    .to(node, { x: distance, duration: duration * 0.2 })
    .to(node, { x: -distance * 0.6, duration: duration * 0.2 })
    .to(node, { x: distance * 0.6, duration: duration * 0.2 })
    .to(node, { x: 0, duration: duration * 0.25, ease: 'power2.inOut' });
  shakeTweens.set(cardId, { tl });
}
