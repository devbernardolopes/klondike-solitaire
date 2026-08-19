import { useLayoutEffect } from 'react';
import { gsap } from './gsapSetup.js';
import { MOTION } from './motion.js';
import { flipBridge } from './flipBridge.js';
import { useGameStore } from '../../hooks/useGameStore.js';

/**
 * Stock → waste draw animation: the revealed card flips face-up in place at the
 * stock pile and THEN glides horizontally to the waste pile. The horizontal
 * direction follows the board layout, which already mirrors with the Hand
 * orientation (right-handed = waste left of stock → slide left; left-handed =
 * reverse). All tweakable values live in MOTION.draw (slide) and MOTION.flipCard
 * (reveal) in motion.js.
 *
 * This takes over the `draw` action so the generic Flip pipeline in
 * useCardMoveFlip is skipped for it.
 */
export function useStockDrawSlide() {
  const state = useGameStore((s) => s.state);
  const lastActionMeta = useGameStore((s) => s.lastActionMeta);

  useLayoutEffect(() => {
    if (lastActionMeta.type !== 'draw') return;
    // The store captured a Flip snapshot for this action; we animate manually,
    // so discard it to avoid a stale snapshot being reused by later moves.
    flipBridge.current = null;

    const wastePile = document.querySelector('[data-loc="waste"]');
    const stockPile = document.querySelector('[data-loc="stock"]');
    if (!wastePile || !stockPile) return;

    // The freshly drawn card is the last [data-card] child of the waste pile
    // (cards render in array order; the most recent draw is appended last).
    const cards = wastePile.querySelectorAll('[data-card]');
    const cardNode = cards[cards.length - 1];
    if (!cardNode) return;
    const inner = cardNode.querySelector('.card-flip-inner');
    if (!inner) return;

    const sRect = stockPile.getBoundingClientRect();
    const wRect = wastePile.getBoundingClientRect();
    const dx = sRect.left - wRect.left;
    const dy = sRect.top - wRect.top;
    const dir = Math.sign(dx) || 1;
    const startX = dx + dir * MOTION.draw.overshoot;

    const flip = MOTION.flipCard;
    const slide = MOTION.draw;

    // Park the card at the stock pile position (face-down) before animating.
    gsap.set(cardNode, { x: startX, y: dy, zIndex: 1000 });
    gsap.set(inner, { rotateY: -180 });

    const tl = gsap.timeline();
    // Phase 1: flip face-up in place at the stock pile.
    tl.to(inner, {
      rotateY: 0,
      duration: flip.duration,
      ease: flip.ease,
    });
    // Phase 2: slide horizontally to the waste pile position.
    tl.to(
      cardNode,
      { x: 0, y: 0, duration: slide.duration, ease: slide.ease },
      '>'
    );

    return () => tl.kill();
  }, [state, lastActionMeta]);
}
