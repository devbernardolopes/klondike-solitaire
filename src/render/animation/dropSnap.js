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
    layerEl.setAttribute('data-drop-snap-layer', 'true');
    layerEl.style.position = 'fixed';
    layerEl.style.inset = '0';
    layerEl.style.width = '100%';
    layerEl.style.height = '100%';
    layerEl.style.pointerEvents = 'none';
    layerEl.style.zIndex = '2400';
    layerEl.style.overflow = 'hidden';
    document.body.appendChild(layerEl);
    return layerEl;
  } catch {
    return null;
  }
}

export function shouldSnap() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {}
  try {
    const s = useSettingsStore.getState();
    if (!s.cardEffects) return false;
    if (!s.dropSnap) return false;
  } catch {
    return false;
  }
  return true;
}

export function playDropSnap(rect) {
  if (!rect || !shouldSnap()) return;
  const cfg = MOTION.dropSnap;
  if (!cfg) return;
  const layer = getLayer();
  if (!layer) return;
  if (liveEls.size >= (cfg.maxConcurrent ?? 12)) {
    const oldest = liveEls.values().next().value;
    if (oldest) {
      try { oldest._snapTween?.kill(); } catch {}
      try { oldest.remove(); } catch {}
      liveEls.delete(oldest);
    }
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let el = null;
  try {
    el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    const size = cfg.size ?? 72;
    el.style.position = 'absolute';
    el.style.left = `${cx - size / 2}px`;
    el.style.top = `${cy - size / 2}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = 'calc(var(--card-radius) + 6px)';
    el.style.border = '2px solid rgba(255,213,74,0.95)';
    el.style.boxShadow = '0 0 16px rgba(255,213,74,0.6), inset 0 0 10px rgba(255,213,74,0.3)';
    el.style.pointerEvents = 'none';
    layer.appendChild(el);
  } catch {
    return;
  }
  liveEls.add(el);
  try {
    el._snapTween = gsap.fromTo(
      el,
      { scale: 0.7, opacity: cfg.alpha ?? 0.5 },
      {
        scale: 1.25,
        opacity: 0,
        duration: cfg.duration ?? 0.30,
        ease: cfg.ease ?? 'power2.out',
        onComplete: () => { try { el.remove(); } catch {} liveEls.delete(el); },
      }
    );
  } catch {
    try { el.remove(); } catch {}
    liveEls.delete(el);
  }
}

export function clearDropSnaps() {
  liveEls.forEach((el) => { try { el.remove(); } catch {} });
  liveEls.clear();
}
