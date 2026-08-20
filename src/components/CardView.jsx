// components/CardView.jsx
// Renders a single card. Face/back art comes from the active deck renderer
// (see render/deck/deckRegistry.js); the two faces live inside a 3D flip
// container so face-up/face-down transitions animate.

import { useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useCardFaceFlip } from '../render/animation/useCardFaceFlip.js';
import { playCardShake } from '../render/animation/playCardShake.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { isWon } from '../core/winDetection.js';
import { getDeck } from '../render/deck/deckRegistry.js';

const RANK_LABEL = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};

function rankLabel(rank) {
  return RANK_LABEL[rank] ?? String(rank);
}

/**
 * @param {object} props
 * @param {{ id: string, suit: string, rank: number, color: string, faceUp: boolean }} props.card
 * @param {number} [props.zIndex]
 * @param {import('react').Ref<any>} [props.innerRef]  ref attached to the flip-inner node (for the 3D face flip)
 */
export function CardFace({ card, zIndex = 0, innerRef }) {
  const base = {
    width: 'var(--card-width)',
    height: 'var(--card-height)',
    borderRadius: 'var(--card-radius)',
    border: 'var(--card-border)',
    boxShadow: 'var(--card-shadow)',
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
  };

  const deck = useSettingsStore((s) => s.deck);
  const faceImg = useMemo(
    () => getDeck(deck).renderCard(card.suit, card.rank),
    [card.suit, card.rank, deck],
  );
  const backImg = useMemo(() => getDeck(deck).renderBack(), [deck]);

  const front = (
    <div
      style={{
        ...base,
        backgroundImage: `url(${faceImg})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        userSelect: 'none',
      }}
      aria-label={`${rankLabel(card.rank)} of ${card.suit}`}
    />
  );

  const back = (
    <div
      style={{
        ...base,
        backgroundImage: `url(${backImg})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        transform: 'rotateY(180deg)',
      }}
      aria-label="face-down card"
    />
  );

  // The card is face-up by default (front showing). The face-flip hook rotates
  // the inner container on a faceUp toggle; both faces stay mounted for the
  // whole game so Flip node tracking is never broken.
  return (
    <div
      className="card-flip-container"
      style={{
        width: 'var(--card-width)',
        height: 'var(--card-height)',
        position: 'relative',
        perspective: '1000px',
      }}
    >
      <div
        className="card-flip-inner"
        ref={innerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          transform: card.faceUp ? 'rotateY(0deg)' : 'rotateY(180deg)',
        }}
      >
        {front}
        {back}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {{ id: string, suit: string, rank: number, color: string, faceUp: boolean }} props.card
 * @param {string} props.from  pile locator the card currently lives in
 * @param {number} [props.zIndex]
 * @param {boolean} [props.hidden]  hide this card (e.g. while its run is shown in a DragOverlay)
 * @param {(cardId: string, from: string) => void} [props.onAutoMove]  invoked on a tap (no drag)
 */
// Tap (click) detection that does not interfere with dnd-kit dragging: a pointer
// movement below this distance is treated as a tap → auto-move; >= the PointerSensor
// activation distance (8px) is a drag. Kept strictly below 8 to avoid overlap.
const CLICK_DISTANCE = 6;

export default function CardView({ card, from, zIndex = 0, hidden = false, onAutoMove }) {
  const won = useGameStore((s) => isWon(s.state));
  const isOver = useStatsStore((s) => s.isOver);
  // Block only this card if it is the one physically in flight. Every other
  // card stays interactive during an unrelated animation.
  const isAnimating = useUiStore((s) => s.animatingCards.has(card.id));
  const locked = won || isOver || isAnimating;
  const selectedCardId = useUiStore((s) => s.selectedCardId);
  const selectCard = useUiStore((s) => s.selectCard);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: card.id,
    data: { from, cardId: card.id },
    disabled: !card.faceUp || locked,
  });

  const flipRef = useRef(null);
  useCardFaceFlip(flipRef, card.faceUp);

  const downPos = useRef(null);

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    listeners?.onPointerDown?.(e);
    downPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e) => {
    if (e.button !== 0) return;
    listeners?.onPointerUp?.(e);
    if (!card.faceUp || locked || !onAutoMove || !downPos.current) return;
    // Never auto-move on the same gesture as a drag: doing so mid-drag relocates
    // and hides the dragged card (see useDragEngine/Board hiddenIds), which can
    // leave it stuck invisible. The drag lifecycle owns the move in that case.
    if (useUiStore.getState().isDragging) return;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    if (Math.hypot(dx, dy) < CLICK_DISTANCE) {
      const ok = onAutoMove(from, card.id);
      if (!ok) playCardShake(e.currentTarget);
    }
    downPos.current = null;
  };

  // Keyboard: focusing a card selects it (highlight); Enter/Space performs the
  // same one-tap auto-move as a pointer tap. The drag PointerSensor (threshold
  // 8px) means a keyboard activation never triggers a drag.
  const handleFocus = () => {
    if (card.faceUp && !locked) selectCard(card.id);
  };
  const handleKeyDown = (e) => {
    if (!card.faceUp || locked || !onAutoMove) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clearSelection();
      const ok = onAutoMove(from, card.id);
      if (ok) {
        setAnnounce(`Auto-moved ${rankLabel(card.rank)} of ${card.suit}`);
      } else {
        setAnnounce(`No valid move for ${rankLabel(card.rank)} of ${card.suit}`);
        playCardShake(e.currentTarget);
      }
    }
  };

  const selected = selectedCardId === card.id && !locked;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      tabIndex={card.faceUp && !locked ? 0 : -1}
      role="button"
      data-card={card.id}
      data-flip-id={card.id}
      style={{
        visibility: hidden ? 'hidden' : 'visible',
        cursor: locked ? 'default' : 'grab',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
        outline: selected ? '3px solid var(--card-text-red, #ffd54a)' : 'none',
        outlineOffset: 2,
      }}
      aria-label={`${rankLabel(card.rank)} of ${card.suit}${card.faceUp ? '' : ' (face down)'}`}
      aria-pressed={selected}
    >
      <CardFace card={card} zIndex={zIndex} innerRef={flipRef} />
    </div>
  );
}
