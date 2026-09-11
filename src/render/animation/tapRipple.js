import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

let layerEl = null;
const liveEls = new Set();

function getLayer() {
  try {
    if (layerEl && document.body.contains(layerEl)) return layerEl;
    layerEl = document.createElement('div');
    layerEl.setAttribute('aria-hidden', 'true');
    layerEl.setAttribute('data-tap-ripple-layer', 'true');
    layerEl.style.position = 'fixed';
    layerEl.style.inset = '0';
    layerEl.style.width = '100%';
    layerEl.style.height = '100%';
    layerEl.style.pointerEvents = 'none';
    layerEl.style.zIndex = '2500';
    layerEl.style.overflow = 'hidden';
    document.body.appendChild(layerEl);
    return layerEl;
  } catch {
    return null;
  }
}

export function shouldRipple() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {}
  try {
    const s = useSettingsStore.getState();
    if (!s.cardEffects) return false;
    if (!s.tapRipple) return false;
  } catch {
    return false;
  }
  return true;
}

export function playTapRipple({ x, y }) {
  if (x == null || y == null) return;
  if (!shouldRipple()) return;
  const cfg = MOTION.tapRipple;
  if (!cfg) return;
  const layer = getLayer();
  if (!layer) return;
  if (liveEls.size >= (cfg.maxConcurrent ?? 20)) {
    const oldest = liveEls.values().next().value;
    if (oldest) {
      try { oldest._rippleTween?.kill(); } catch {}
      try { oldest.remove(); } catch {}
      liveEls.delete(oldest);
    }
  }
  let el = null;
  try {
    el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    const size = cfg.size ?? 56;
    el.style.position = 'absolute';
    el.style.left = `${x - size / 2}px`;
    el.style.top = `${y - size / 2}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = '50%';
    el.style.border = '2px solid rgba(255,255,255,0.9)';
    el.style.boxShadow = '0 0 12px rgba(52,214,255,0.55), inset 0 0 8px rgba(52,214,255,0.35)';
    el.style.pointerEvents = 'none';
    layer.appendChild(el);
  } catch {
    return;
  }
  liveEls.add(el);
  try {
    el._rippleTween = gsap.fromTo(
      el,
      { scale: 0.4, opacity: cfg.alpha ?? 0.45 },
      {
        scale: 1.4,
        opacity: 0,
        duration: cfg.duration ?? 0.35,
        ease: cfg.ease ?? 'power2.out',
        onComplete: () => { try { el.remove(); } catch {} liveEls.delete(el); },
      }
    );
  } catch {
    try { el.remove(); } catch {}
    liveEls.delete(el);
  }
}

export function clearTapRipples() {
  liveEls.forEach((el) => { try { el.remove(); } catch {} });
  liveEls.clear();
}
