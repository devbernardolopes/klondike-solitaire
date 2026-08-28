// components/ToastHost.jsx
// Renders the single active achievement toast (per useToastStore). Handles the
// GSAP slide-in (top slides down, bottom slides up) and the fade-out on
// dismiss/timeout, delegating phase transitions back to the store. Rendered once
// in App.jsx above every modal (zIndex 5000).

import { useEffect, useRef } from 'react';
import { gsap } from '../render/animation/gsapSetup.js';
import { MOTION } from '../render/animation/motion.js';
import { useToastStore } from '../hooks/useToastStore.js';
import { t } from '../i18n/strings.js';
import { ACHIEVEMENT_PLACEHOLDER, onAchievementImageError } from '../utils/achievementImage.js';

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
    alignItems: 'center',
    gap: 10,
    transform: 'translateX(-50%)', // base centering; GSAP owns the live transform
    background: 'var(--card-face-bg, #fff)',
    color: 'var(--card-text-black, #111)',
    border: '1px solid var(--card-border, #ccc)',
    borderRadius: 10,
    boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
    padding: '10px 14px',
    opacity: 0, // GSAP autoAlpha takes over once the slide-in tween starts
    maxWidth: 'min(90vw, 360px)',
    fontSize: 14,
    fontWeight: 600,
  };

  return (
    <div style={containerStyle}>
      <div ref={cardRef} style={cardStyle} onClick={() => dismiss()} role="status" aria-live="polite">
        <img
          src={active.image || ACHIEVEMENT_PLACEHOLDER}
          alt=""
          onError={onAchievementImageError}
          style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }}
        />
        <span>{t(active.messageKey, active.params)}</span>
      </div>
    </div>
  );
}
