// components/CardView.jsx
// Renders a single card. This pass uses a plain colored div with rank/suit text.
// The real deck renderer (Sprite/Procedural) will plug in here later — see TODO.

import { useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';

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
 */
export function CardFace({ card, zIndex = 0 }) {
  const base = {
    width: 'var(--card-width)',
    height: 'var(--card-height)',
    borderRadius: 'var(--card-radius)',
    border: 'var(--card-border)',
    boxShadow: 'var(--card-shadow)',
    position: 'relative',
    zIndex,
  };

  if (!card.faceUp) {
    return (
      <div
        style={{ ...base, background: 'var(--card-back-bg)' }}
        aria-label="face-down card"
      />
    );
  }

  return (
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
      style={{ visibility: hidden ? 'hidden' : 'visible', cursor: 'grab' }}
      aria-label={`${rankLabel(card.rank)} of ${card.suit}`}
    >
      <CardFace card={card} zIndex={zIndex} />
    </div>
  );
}
