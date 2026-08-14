// components/CardView.jsx
// Renders a single card. This pass uses a plain colored div with rank/suit text.
// The real deck renderer (Sprite/Procedural) will plug in here later — see TODO.

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
 * @param {string} props.from  pile locator the card currently lives in
 * @param {number} [props.zIndex]
 */
export default function CardView({ card, from, zIndex = 0 }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { from, cardId: card.id },
    disabled: !card.faceUp,
  });

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
        ref={setNodeRef}
        style={{
          ...base,
          background: 'var(--card-back-bg)',
          opacity: isDragging ? 0.4 : 1,
        }}
        aria-label="face-down card"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
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
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
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
