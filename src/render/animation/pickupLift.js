import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

const lifted = new Map();

export function shouldLift() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {}
  try {
    const s = useSettingsStore.getState();
    if (!s.cardEffects) return false;
    if (!s.pickupLift) return false;
  } catch {
    return false;
  }
  return true;
}

export function liftRun(cardIds) {
  if (!cardIds || !shouldLift()) return;
  const cfg = MOTION.pickupLift;
  if (!cfg) return;
  for (const id of cardIds) {
    if (!id || lifted.has(id)) continue;
    let el = null;
    try {
      el = document.querySelector(`[data-flip-id="${CSS.escape(id)}"]`);
    } catch {
      continue;
    }
    if (!el) continue;
    try {
      gsap.to(el, {
        scale: cfg.scale ?? 1.05,
        boxShadow: cfg.boxShadow ?? '0 12px 28px rgba(0,0,0,0.45)',
        duration: cfg.duration ?? 0.12,
        ease: cfg.ease ?? 'power2.out',
        overwrite: 'auto',
      });
      lifted.set(id, el);
    } catch {}
  }
}

export function clearLift(cardIds) {
  const ids = cardIds ? Array.from(cardIds) : Array.from(lifted.keys());
  for (const id of ids) {
    const el = lifted.get(id);
    lifted.delete(id);
    if (!el) continue;
    try {
      if (el.isConnected) {
        gsap.to(el, { scale: 1, boxShadow: '0 4px 10px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.28)', duration: 0.12, ease: 'power2.out', overwrite: 'auto', onComplete: () => { try { gsap.set(el, { clearProps: 'scale,boxShadow' }); } catch {} } });
      }
    } catch {}
  }
}

export function clearAllLifts() {
  clearLift();
}
