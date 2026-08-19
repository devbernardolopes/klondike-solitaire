import { useLayoutEffect } from 'react';
import { Flip } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { flipBridge } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';
import { useUiStore } from '../../hooks/useUiStore.js';

const CONFIG_BY_TYPE = {
  // All generic card relocations (single cards and multi-card runs) share the
  // single, tweakable MOTION.move translation preset in motion.js.
  move: MOTION.move,
  auto: MOTION.move,
  deal: MOTION.deal,
  recycle: MOTION.move,
};

export function useCardMoveFlip() {
  const state = useGameStore((s) => s.state);
  const lastActionMeta = useGameStore((s) => s.lastActionMeta);

  useLayoutEffect(() => {
    // The stock → waste draw is animated by useStockDrawSlide (flip-then-slide),
    // which discards the captured Flip state; don't run the generic pipeline for it.
    if (!flipBridge.current || !CONFIG_BY_TYPE[lastActionMeta.type]) {
      flipBridge.current = null;
      return;
    }
    const cfg = CONFIG_BY_TYPE[lastActionMeta.type];
    Flip.from(flipBridge.current, {
      duration: cfg.duration,
      ease: cfg.ease,
      stagger: cfg.stagger ?? 0,
      absolute: true,
      // Release the global animation lock once this relocation tween finishes.
      onComplete: () => useUiStore.getState().endAnimating(),
    });
    flipBridge.current = null;
  }, [state, lastActionMeta]);
}
