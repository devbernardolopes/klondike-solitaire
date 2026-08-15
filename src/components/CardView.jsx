// components/CardView.jsx
// Renders a single card. This pass uses a plain colored div with rank/suit text.
// The real deck renderer (Sprite/Procedural) will plug in here later — see TODO.

import { useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useCardFaceFlip } from '../render/animation/useCardFaceFlip.js';

const SUIT_GLYPH = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

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

  const front = (
    <div
      style={{
        ...base,
        background: 'var(--card-face-bg)',
        color: card.color === 'red' ? 'var(--card-text-red)' : 'var(--card-text-black)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        padding: '4px 6px',
        fontWeight: 700,
        fontSize: 'clamp(12px, 2.4vw, 18px)',
        userSelect: 'none',
      }}
      aria-label={`${rankLabel(card.rank)} of ${card.suit}`}
      // TODO(next pass): swap this text placeholder for the active deck renderer
      // via getDeck(theme).renderCard(card.suit, card.rank) as a background-image.
    >
      <span>{rankLabel(card.rank)}</span>
      <span style={{ marginLeft: 2 }}>{SUIT_GLYPH[card.suit]}</span>
    </div>
  );

  const back = (
    <div
      style={{ ...base, background: 'var(--card-back-bg)', transform: 'rotateY(180deg)' }}
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
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: card.id,
    data: { from, cardId: card.id },
    disabled: !card.faceUp,
  });

  const flipRef = useRef(null);
  useCardFaceFlip(flipRef, card.faceUp);

  const downPos = useRef(null);

  const handlePointerDown = (e) => {
    listeners?.onPointerDown?.(e);
    downPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e) => {
    listeners?.onPointerUp?.(e);
    if (!card.faceUp || !onAutoMove || !downPos.current) return;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    if (Math.hypot(dx, dy) < CLICK_DISTANCE) onAutoMove(from, card.id);
    downPos.current = null;
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      data-card={card.id}
      style={{
        visibility: hidden ? 'hidden' : 'visible',
        cursor: 'grab',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
      }}
      aria-label={`${rankLabel(card.rank)} of ${card.suit}`}
    >
      <CardFace card={card} zIndex={zIndex} innerRef={flipRef} />
    </div>
  );
}
