import { useLayoutEffect, useRef } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { useSettingsStore } from '../../hooks/useSettingsStore.js';

function spawnShimmer(cardEl) {
  if (!cardEl) return;
  try {
    const settings = useSettingsStore.getState();
    if (!settings.cardEffects || !settings.shimmer) return;
  } catch {}
  try {
    const shimmer = document.createElement('div');
    shimmer.setAttribute('aria-hidden', 'true');
    shimmer.style.position = 'absolute';
    shimmer.style.left = '0';
    shimmer.style.top = '0';
    shimmer.style.width = '100%';
    shimmer.style.height = '100%';
    shimmer.style.borderRadius = 'var(--card-radius)';
    shimmer.style.overflow = 'hidden';
    shimmer.style.pointerEvents = 'none';
    shimmer.style.zIndex = '5';
    const sweep = document.createElement('div');
    sweep.style.position = 'absolute';
    sweep.style.top = '-20%';
    sweep.style.left = '-60%';
    sweep.style.width = '55%';
    sweep.style.height = '140%';
    sweep.style.background = 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%)';
    sweep.style.transform = 'skewX(-12deg)';
    shimmer.appendChild(sweep);
    cardEl.style.position = 'relative';
    cardEl.appendChild(shimmer);
    gsap.fromTo(sweep, { x: '-10%' }, { x: '260%', duration: MOTION.shimmer.duration, ease: MOTION.shimmer.ease, onComplete: () => { try { shimmer.remove(); } catch {} } });
  } catch {}
}

export function useCardFaceFlip(nodeRef, faceUp) {
  const prev = useRef(faceUp);
  const cardRef = useRef(null);
  useLayoutEffect(() => {
    if (prev.current === faceUp) return;
    const flippingToUp = faceUp === true;
    const shouldBounceFlip = (() => {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      } catch {}
      try {
        const s = useSettingsStore.getState();
        if (!s.cardEffects) return false;
        if (!s.bounce) return false;
      } catch {}
      return true;
    })();
    gsap.fromTo(
      nodeRef.current,
      { rotateY: faceUp ? -180 : 0 },
      {
        rotateY: faceUp ? 0 : -180,
        duration: MOTION.flipCard.duration,
        ease: shouldBounceFlip ? MOTION.flipCard.ease : 'power2.out',
        onComplete: () => {
          if (flippingToUp && nodeRef.current) {
            const cardEl = nodeRef.current.closest('[data-card]');
            if (cardEl) spawnShimmer(cardEl);
          }
        },
      }
    );
    prev.current = faceUp;
  }, [faceUp]);
}
