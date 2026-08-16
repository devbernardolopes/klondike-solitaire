// components/Pile.jsx
// Generic pile: stock, waste, foundation, or tableau column.
// Renders a droppable area; cards stack with a fan offset for tableau columns.
// Also focusable for keyboard play: Enter on a focused pile moves the currently
// selected card here (or draws from stock for the stock pile).

import { useDroppable } from '@dnd-kit/core';
import CardView from './CardView.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { useUiStore, findCardLocator } from '../hooks/useUiStore.js';

/**
 * @param {object} props
 * @param {string} props.loc            pile locator ("stock" | "waste" | "foundation:i" | "tableau:i")
 * @param {Array<{id:string,suit:string,rank:number,color:string,faceUp:boolean}>} props.cards
 * @param {boolean} [props.fanned]      stack cards with a vertical offset (tableau)
 * @param {() => void} [props.onClick]   click handler (e.g. stock draw)
 * @param {string} [props.label]         placeholder label when empty
 * @param {Set<string>} [props.hiddenIds] card ids to hide (e.g. while shown in a DragOverlay)
 * @param {(cardId: string, from: string) => void} [props.onAutoMove]  tap-to-move handler for face-up cards
 * @param {{ cardH:number, fanUp:number, fanDown:number, avail:number }|null} [props.metrics] measured geometry for adaptive tableau spacing
 */
export default function Pile({ loc, cards, fanned = false, onClick, label, hiddenIds, onAutoMove, metrics }) {
  const { setNodeRef, isOver } = useDroppable({ id: loc, data: { loc } });
  const moveCard = useGameStore((s) => s.moveCard);
  const drawFromStock = useGameStore((s) => s.drawFromStock);
  const recycleStock = useGameStore((s) => s.recycleStock);
  const selectedCardId = useUiStore((s) => s.selectedCardId);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setAnnounce = useUiStore((s) => s.setAnnounce);

  const kind = loc.split(':')[0];

  // Adaptive tableau spacing: each card's vertical offset depends on whether it
  // is face-down (tight peek) or face-up (normal fan). The whole run is scaled
  // down to fit the available column height, never below 30% (floor), so a very
  // long pile stops before overflowing the screen but cards don't fully merge.
  let tops = null;
  let pileHeight = null;
  if (fanned && metrics && metrics.cardH) {
    const { cardH, fanUp, fanDown, avail } = metrics;
    const offs = cards.map((c) => (c.faceUp ? fanUp : fanDown));
    const used = offs.slice(0, Math.max(0, cards.length - 1)).reduce((a, b) => a + b, 0);
    const natural = cardH + used;
    const scale = avail > 0 && natural > avail ? Math.max(avail / natural, 0.3) : 1;
    tops = [];
    let acc = 0;
    for (let i = 0; i < cards.length; i++) {
      tops.push(acc);
      if (i < cards.length - 1) acc += offs[i] * scale;
    }
    pileHeight = cardH + used * scale;
  }
  const pileName =
    kind === 'stock'
      ? 'Stock'
      : kind === 'waste'
        ? 'Waste'
        : kind === 'foundation'
          ? `Foundation ${Number(loc.split(':')[1]) + 1}`
          : `Tableau ${Number(loc.split(':')[1]) + 1}`;

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (loc === 'stock') {
      if (onClick) onClick();
      return;
    }
    if (!selectedCardId) {
      setAnnounce(`Select a card first to move it to ${pileName}`);
      return;
    }
    const from = findCardLocator(useGameStore.getState().state, selectedCardId);
    if (!from) {
      clearSelection();
      setAnnounce('Selected card is no longer available');
      return;
    }
    const ok = moveCard(from, loc, selectedCardId);
    if (ok) {
      clearSelection();
      setAnnounce(`Moved card to ${pileName}`);
    } else {
      setAnnounce(`Cannot move that card to ${pileName}`);
    }
  };

  // Stock pile click draws (or recycles when empty); expose the same via keyboard.
  const handleClick = () => {
    if (onClick) onClick();
  };

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${pileName}${cards.length ? `, ${cards.length} cards` : ', empty'}`}
      style={{
        minWidth: 'var(--card-width)',
        minHeight: 'var(--card-height)',
        height: fanned
          ? pileHeight != null
            ? `${pileHeight}px`
            : `calc(var(--card-height) + ${Math.max(cards.length - 1, 0)} * var(--tableau-fan))`
          : 'var(--card-height)',
        position: 'relative',
        borderRadius: 'var(--card-radius)',
        border: isOver
          ? '2px dashed rgba(255,255,255,0.7)'
          : '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(0,0,0,0.12)',
        cursor: onClick ? 'pointer' : 'default',
        outlineOffset: 2,
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
            top: tops ? `${tops[i]}px` : fanned ? `calc(${i} * var(--tableau-fan))` : 0,
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
