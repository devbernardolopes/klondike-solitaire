// components/ToastHost.jsx
// Renders the single active achievement toast (per useToastStore). Handles the
// GSAP slide-in (top slides down, bottom slides up) and the fade-out on
// dismiss/timeout, delegating phase transitions back to the store. Rendered once
// in App.jsx above every modal (zIndex 5000).

import { useEffect, useRef } from 'react';
import { gsap } from '../render/animation/gsapSetup.js';
import { MOTION } from '../render/animation/motion.js';
import { useToastStore } from '../hooks/useToastStore.js';
import { onAchievementImageError } from '../utils/achievementImage.js';

export default function ToastHost() {
  const active = useToastStore((s) => s.active);
  const phase = useToastStore((s) => s.phase);
  const position = useToastStore((s) => s.config.position);
  const markShown = useToastStore((s) => s.markShown);
  const clearActive = useToastStore((s) => s.clearActive);
  const dismiss = useToastStore((s) => s.dismiss);
  const cardRef = useRef(null);

  // Slide-in whenever a new toast becomes active in the 'entering' phase.
  useEffect(() => {
    if (!active || phase !== 'entering' || !cardRef.current) return;
    const el = cardRef.current;
    const slide = MOTION.toast.slide;
    const fromY = position === 'top-center' ? -slide.distance : slide.distance;
    gsap.fromTo(
      el,
      { y: fromY, xPercent: -50, autoAlpha: 0 },
      {
        y: 0,
        xPercent: -50,
        autoAlpha: 1,
        duration: slide.duration,
        ease: slide.ease,
        onComplete: () => markShown(),
      }
    );
  }, [active, phase, position, markShown]);

  // Fade-out when entering the 'fading' phase.
  useEffect(() => {
    if (phase !== 'fading' || !cardRef.current) return;
    const el = cardRef.current;
    const fade = MOTION.toast.fade;
    gsap.to(el, {
      autoAlpha: 0,
      duration: fade.duration,
      ease: fade.ease,
      onComplete: () => clearActive(),
    });
  }, [phase, clearActive]);

  if (!active) return null;

  const isTop = position === 'top-center';

  const containerStyle = {
    position: 'fixed',
    left: '50%',
    [isTop ? 'top' : 'bottom']: 16,
    zIndex: 5000,
    pointerEvents: 'none',
  };

  const cardStyle = {
    pointerEvents: 'auto',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    transform: 'translateX(-50%)',
    background: 'var(--ui-modal-panel-bg, #fbfbf7)',
    color: 'var(--ui-modal-panel-fg, #1a1a1a)',
    border: 'var(--ui-modal-panel-border, 1px solid rgba(0,0,0,0.25))',
    borderRadius: 'var(--ui-modal-panel-radius, 10px)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '14px 16px',
    opacity: 0,
    maxWidth: 'min(90vw, 380px)',
    minWidth: 280,
  };

  return (
    <div style={containerStyle}>
      <div ref={cardRef} style={cardStyle} onClick={() => dismiss()} role="status" aria-live="polite">
        {active.image ? (
          <img
            src={active.image}
            alt=""
            onError={onAchievementImageError}
            style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }}
          />
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: 1.25 }}>{active.name}</div>
          {active.description ? (
            <div style={{ fontSize: 13, fontWeight: 400, textAlign: 'left', opacity: 0.9, lineHeight: 1.35 }}>{active.description}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
