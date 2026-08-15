// components/Pile.jsx
// Generic pile: stock, waste, foundation, or tableau column.
// Renders a droppable area; cards stack with a fan offset for tableau columns.

import { useDroppable } from '@dnd-kit/core';
import CardView from './CardView.jsx';

/**
 * @param {object} props
 * @param {string} props.loc            pile locator ("stock" | "waste" | "foundation:i" | "tableau:i")
 * @param {Array<{id:string,suit:string,rank:number,color:string,faceUp:boolean}>} props.cards
 * @param {boolean} [props.fanned]      stack cards with a vertical offset (tableau)
 * @param {() => void} [props.onClick]   click handler (e.g. stock draw)
 * @param {string} [props.label]         placeholder label when empty
 * @param {Set<string>} [props.hiddenIds] card ids to hide (e.g. while shown in a DragOverlay)
 * @param {(cardId: string, from: string) => void} [props.onAutoMove]  tap-to-move handler for face-up cards
 */
export default function Pile({ loc, cards, fanned = false, onClick, label, hiddenIds, onAutoMove }) {
  const { setNodeRef, isOver } = useDroppable({ id: loc, data: { loc } });

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      style={{
        minWidth: 'var(--card-width)',
        minHeight: 'var(--card-height)',
        height: fanned
          ? `calc(var(--card-height) + ${Math.max(cards.length - 1, 0)} * var(--tableau-fan))`
          : 'var(--card-height)',
        position: 'relative',
        borderRadius: 'var(--card-radius)',
        border: isOver
          ? '2px dashed rgba(255,255,255,0.7)'
          : '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(0,0,0,0.12)',
        cursor: onClick ? 'pointer' : 'default',
      }}
      data-loc={loc}
    >
      {cards.length === 0 && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 12,
          }}
        >
          {label ?? ''}
        </span>
      )}

      {cards.map((card, i) => (
        <div
          key={card.id}
          style={{
            position: 'absolute',
            top: fanned ? `calc(${i} * var(--tableau-fan))` : 0,
            left: 0,
            width: 'var(--card-width)',
            zIndex: i,
          }}
        >
          <CardView
            card={card}
            from={loc}
            zIndex={i}
            hidden={hiddenIds ? hiddenIds.has(card.id) : false}
            onAutoMove={onAutoMove}
          />
        </div>
      ))}
    </div>
  );
}
