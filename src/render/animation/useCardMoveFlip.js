import { useLayoutEffect } from 'react';
import { Flip } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { flipBridge } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';

const CONFIG_BY_TYPE = {
  move: MOTION.move,
  draw: MOTION.move,
  auto: MOTION.move,
  deal: MOTION.deal,
};

export function useCardMoveFlip() {
  const state = useGameStore((s) => s.state);
  const lastActionMeta = useGameStore((s) => s.lastActionMeta);

  useLayoutEffect(() => {
    if (!flipBridge.current) return;
    const cfg = CONFIG_BY_TYPE[lastActionMeta.type] ?? MOTION.move;
    Flip.from(flipBridge.current, {
      duration: cfg.duration,
      ease: cfg.ease,
      stagger: cfg.stagger ?? 0,
      absolute: true,
    });
    flipBridge.current = null;
  }, [state, lastActionMeta]);
}
