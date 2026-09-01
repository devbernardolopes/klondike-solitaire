import { useLayoutEffect, useRef, useEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

let layerEl = null;
let activeCount = 0;
const MAX = 80;

function getLayer() {
  try {
    if (layerEl && document.body.contains(layerEl)) return layerEl;
    layerEl = document.createElement('div');
    layerEl.setAttribute('aria-hidden', 'true');
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

function spawnAt(x, y, cfg) {
  const layer = getLayer();
  if (!layer) return;
  for (let i = 0; i < cfg.count; i++) {
    if (activeCount >= MAX) return;
    const angle = (Math.PI * 2 * i) / cfg.count + Math.random() * 0.5;
    const radius = cfg.radius * (0.5 + Math.random() * 0.5);
    const tx = Math.cos(angle) * radius;
    const ty = Math.sin(angle) * radius;
    const el = document.createElement('div');
    el.textContent = '✦';
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${cfg.size}px`;
    el.style.height = `${cfg.size}px`;
    el.style.marginLeft = `${-cfg.size / 2}px`;
    el.style.marginTop = `${-cfg.size / 2}px`;
    el.style.color = i % 2 === 0 ? '#ffd54a' : '#fff8e1';
    el.style.fontSize = `${cfg.size}px`;
    el.style.fontWeight = 700;
    el.style.lineHeight = '1';
    el.style.textAlign = 'center';
    el.style.textShadow = '0 0 6px rgba(255,213,74,0.9)';
    layer.appendChild(el);
    activeCount++;
    const release = () => {
      activeCount = Math.max(0, activeCount - 1);
      try { el.remove(); } catch {}
    };
    try {
      gsap.fromTo(el, { x: 0, y: 0, scale: 0.2, rotation: 0, autoAlpha: 1 }, { x: tx, y: ty, scale: 1.1, rotation: (Math.random() * 2 - 1) * cfg.spin, autoAlpha: 0, duration: cfg.duration, ease: cfg.ease, onComplete: release });
    } catch { release(); }
  }
}

export function useUncoverSparkle() {
  const cardEffects = useSettingsStore((s) => s.cardEffects);
  const prevFaceUp = useRef(new Map());
  useLayoutEffect(() => {
    const nodes = document.querySelectorAll('[data-card]');
    for (const el of nodes) {
      const tracked = el.getAttribute('data-card');
      const faceUp = el.querySelector('.card-flip-inner')?.style.transform !== 'rotateY(180deg)';
      const was = prevFaceUp.current.get(tracked);
      if (cardEffects && useSettingsStore.getState().uncover && was === false && faceUp === true) {
        const locEl = el.closest('[data-loc^="tableau"]');
        if (locEl) {
          const r = el.getBoundingClientRect();
          spawnAt(r.left + r.width / 2, r.top + r.height / 2, MOTION.uncover);
        }
      }
      prevFaceUp.current.set(tracked, faceUp);
    }
  });

  useEffect(() => () => { if (layerEl) { layerEl.remove(); layerEl = null; } }, []);
}

export function triggerUncoverSparkle(cardId) {
  try {
    const settings = useSettingsStore.getState();
    if (!settings.cardEffects || !settings.uncover) return;
    const el = document.querySelector(`[data-card="${cardId}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    spawnAt(r.left + r.width / 2, r.top + r.height / 2, MOTION.uncover);
  } catch {}
}
