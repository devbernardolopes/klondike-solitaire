import { useLayoutEffect, useRef } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';

export function useCardFaceFlip(nodeRef, faceUp) {
  const prev = useRef(faceUp);
  useLayoutEffect(() => {
    if (prev.current === faceUp) return;
    gsap.fromTo(
      nodeRef.current,
      { rotateY: faceUp ? -180 : 0 },
      { rotateY: faceUp ? 0 : -180, duration: MOTION.flipCard.duration, ease: MOTION.flipCard.ease }
    );
    prev.current = faceUp;
  }, [faceUp]);
}
