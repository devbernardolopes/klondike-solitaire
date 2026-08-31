// components/Pile.jsx
// Generic pile: stock, waste, foundation, or tableau column.
// Renders a droppable area; cards stack with a fan offset for tableau columns.
// Also focusable for keyboard play: Enter on a focused pile moves the currently
// selected card here (or draws from stock for the stock pile).

import { useDroppable } from '@dnd-kit/core';
import CardView from './CardView.jsx';
import { useGameStore } from '../hooks/useGameStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useUiStore, findCardLocator } from '../hooks/useUiStore.js';
import { isWon } from '../core/winDetection.js';

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
  const won = useGameStore((s) => isWon(s.state));
  const sessionOver = useStatsStore((s) => s.isOver);
  const hints = useUiStore((s) => s.hints);
  const draggingFrom = useUiStore((s) => s.draggingFrom);
  const draggingCard = useUiStore((s) => s.draggingCard);
  // While an auto-complete (toward the win) is animating, the whole board is
  // locked — the player must not interact with piles mid-sequence.
  const autoCompleting = useGameStore((s) => s.autoCompleting);
  // Block this pile only when it is the busy destination of an in-flight move.
  // Source piles and all other piles stay fully interactive.
  const isAnimating = useUiStore((s) => s.animatingLocs.has(loc));
  const animatingCards = useUiStore((s) => s.animatingCards);
  const locked = won || sessionOver || isAnimating || autoCompleting;

  const kind = loc.split(':')[0];
  const isHintTarget = hints.some((h) => h.to === loc);
  const isHintSource = hints.some((h) => h.from === loc);

  // Whether to show the dashed drop-target highlight while a drag is hovering
  // this pile. Rendered as a top-layer overlay (see below) so it sits above all
  // cards; we gate it here so it never appears on illegal/unwanted targets:
  //   - stock: never
  //   - waste: only when the dragged card came from the waste
  //   - empty foundation: only when the dragged (lead) card is an Ace
  //   - everything else (tableau, non-empty foundation): whenever hovered
  let showHover = isOver;
  if (kind === 'stock') {
    showHover = false;
  } else if (kind === 'waste') {
    showHover = isOver && draggingFrom === 'waste';
  } else if (kind === 'foundation' && cards.length === 0) {
    showHover = isOver && !!draggingCard && draggingCard.rank === 1;
  }

  // Adaptive tableau spacing: each card's vertical offset depends on whether it
  // is face-down (tight peek) or face-up (normal fan). The run compresses to fit
  // the available column height: face-down peeks shrink first (they only need to
  // read as a stack), then the face-up fan, with a final proportional guard that
  // guarantees no overflow regardless of pile depth.
  const FAN_DOWN_MIN = 3;     // px — face-down cards just need to read as "a stack"
  const FAN_UP_SOFT_MIN = 14; // px — preferred floor so rank/suit stay legible

  const freezeVisual = fanned && isAnimating && cards.some((c) => animatingCards.has(c.id));
  const effectiveCardsForVisual = freezeVisual ? cards.filter((c) => !animatingCards.has(c.id)) : null;
  const effectiveLenForVisual = freezeVisual ? effectiveCardsForVisual.length : cards.length;

  let tops = null;
  let pileHeight = null;
  if (fanned && metrics && metrics.cardH) {
    const { cardH, fanUp: fanUpMax, fanDown: fanDownMax, avail } = metrics;
    const offsetCount = Math.max(0, cards.length - 1);
    let nDown = 0, nUp = 0;
    for (let i = 0; i < offsetCount; i++) {
      if (cards[i].faceUp) nUp++; else nDown++;
    }

    let fanDown = fanDownMax;
    let fanUp = fanUpMax;
    const naturalExtra = nDown * fanDownMax + nUp * fanUpMax;

    if (avail > 0 && naturalExtra > avail) {
      const savingsNeeded = naturalExtra - avail;
      const maxDownSavings = nDown * (fanDownMax - FAN_DOWN_MIN);
      if (nDown > 0 && maxDownSavings >= savingsNeeded) {
        fanDown = fanDownMax - savingsNeeded / nDown;
      } else {
        fanDown = FAN_DOWN_MIN;
        const remaining = avail - nDown * FAN_DOWN_MIN;
        const strictFanUp = nUp > 0 ? Math.max(remaining / nUp, 0) : fanUpMax;
        const withSoftFloor = Math.max(strictFanUp, FAN_UP_SOFT_MIN);
        const fitsWithSoftFloor = nDown * FAN_DOWN_MIN + nUp * withSoftFloor <= avail;
        fanUp = fitsWithSoftFloor ? withSoftFloor : strictFanUp;
      }
    }

    const finalExtra = nDown * fanDown + nUp * fanUp;
    if (avail > 0 && finalExtra > avail) {
      const guardScale = avail / finalExtra;
      fanDown *= guardScale;
      fanUp *= guardScale;
    }

    tops = [];
    let acc = 0;
    for (let i = 0; i < cards.length; i++) {
      tops.push(acc);
      if (i < cards.length - 1) acc += cards[i].faceUp ? fanUp : fanDown;
    }
    pileHeight = cardH + acc;
  }

  let visualPileHeight = null;
  if (fanned && freezeVisual && metrics && metrics.cardH) {
    const { cardH, fanUp: fanUpMax, fanDown: fanDownMax, avail } = metrics;
    const effLen = effectiveLenForVisual;
    const offsetCount = Math.max(0, effLen - 1);
    let nDown = 0, nUp = 0;
    for (let i = 0; i < offsetCount; i++) {
      if (effectiveCardsForVisual[i].faceUp) nUp++; else nDown++;
    }
    let fanDown = fanDownMax;
    let fanUp = fanUpMax;
    const naturalExtra = nDown * fanDownMax + nUp * fanUpMax;
    if (avail > 0 && naturalExtra > avail) {
      const savingsNeeded = naturalExtra - avail;
      const maxDownSavings = nDown * (fanDownMax - FAN_DOWN_MIN);
      if (nDown > 0 && maxDownSavings >= savingsNeeded) fanDown = fanDownMax - savingsNeeded / nDown;
      else {
        fanDown = FAN_DOWN_MIN;
        const remaining = avail - nDown * FAN_DOWN_MIN;
        const strictFanUp = nUp > 0 ? Math.max(remaining / nUp, 0) : fanUpMax;
        const withSoftFloor = Math.max(strictFanUp, FAN_UP_SOFT_MIN);
        const fitsWithSoftFloor = nDown * FAN_DOWN_MIN + nUp * withSoftFloor <= avail;
        fanUp = fitsWithSoftFloor ? withSoftFloor : strictFanUp;
      }
    }
    const finalExtra = nDown * fanDown + nUp * fanUp;
    if (avail > 0 && finalExtra > avail) {
      const guardScale = avail / finalExtra;
      fanDown *= guardScale;
      fanUp *= guardScale;
    }
    let effAcc = 0;
    for (let i = 0; i < effLen - 1; i++) effAcc += effectiveCardsForVisual[i].faceUp ? fanUp : fanDown;
    visualPileHeight = effLen === 0 ? cardH : cardH + effAcc;
  } else if (fanned && freezeVisual) {
    visualPileHeight = null;
  } else {
    visualPileHeight = pileHeight;
  }

  // Position a hint highlight so its TOP edge starts at the relevant card
  // rather than at the top of the whole pile (which would also ring the
  // face-down cards stacked above). `findHints` always records the source
  // `cardId` as the column's top card, so the "from" rectangle sits on the
  // moving card; the "to" rectangle sits on the landing slot (current top card,
  // or pile start when the target is empty). This block is placed after the
  // `tops`/`pileHeight` declarations above so those `let` bindings are already
  // initialized (no Temporal Dead Zone access).
  const cardHVal =
    metrics && metrics.cardH ? `${metrics.cardH}px` : 'var(--card-height)';
  const topForIndex = (i) =>
    tops && tops.length
      ? `${tops[i]}px`
      : fanned
        ? `calc(${i} * var(--tableau-fan))`
        : 0;

  // Each distinct source card in this pile is the top of its own movable run, so
  // each gets its own highlight rectangle. (They may nest, since a run always
  // extends to the top of the column — that nesting correctly shows multiple
  // distinct "from" moves starting at different levels.)
  const sourceCardIds = isHintSource
    ? [...new Set(hints.filter((h) => h.from === loc).map((h) => h.cardId))]
    : [];

  const targetStartIdx = cards.length > 0 ? cards.length - 1 : 0;
  const targetTop = topForIndex(targetStartIdx);
  const targetHeight = cardHVal;

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
    if (locked) return;
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
      data-pile={loc}
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
        border: fanned ? '1px solid transparent' : 'var(--pile-empty-border, 1px solid rgba(255,255,255,0.18))',
        background: fanned ? 'transparent' : 'var(--pile-empty-bg, rgba(0,0,0,0.12))',
        boxShadow: fanned ? 'none' : 'var(--pile-empty-shadow, none)',
        cursor: onClick && !locked ? 'pointer' : 'default',
        outlineOffset: 2,
      }}
      data-loc={loc}
    >
      {fanned && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 'var(--card-width)',
            height:
              visualPileHeight != null
                ? `${visualPileHeight}px`
                : `calc(var(--card-height) + ${Math.max(effectiveLenForVisual - 1, 0)} * var(--tableau-fan))`,
            borderRadius: 'var(--card-radius)',
            border: 'var(--pile-empty-border, 1px solid rgba(255,255,255,0.18))',
            background: 'var(--pile-empty-bg, rgba(0,0,0,0.12))',
            boxShadow: 'var(--pile-empty-shadow, none)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}
      {kind === 'foundation' && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.42)',
            fontFamily: 'system-ui, sans-serif',
            fontWeight: 700,
            fontSize: 'calc(var(--card-width) * 0.5)',
            lineHeight: 1,
            userSelect: 'none',
            pointerEvents: 'none',
            zIndex: 0,
            textShadow: '0 1px 6px rgba(0,0,0,0.35)',
            opacity: cards.length === 0 ? 1 : 0.18,
          }}
        >
          A
        </span>
      )}
      {kind !== 'foundation' && cards.length === 0 && (
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

      {sourceCardIds.map((cid) => {
        const idx = cards.findIndex((c) => c.id === cid);
        if (idx < 0) return null;
        const top = topForIndex(idx);
        const height = tops && tops.length
          ? `${pileHeight - tops[idx]}px`
          : fanned
            ? `calc(${Math.max(cards.length - 1 - idx, 0)} * var(--tableau-fan) + var(--card-height))`
            : cardHVal;
        return (
          <div
            key={cid}
            className="hint-source"
            aria-hidden="true"
            style={{
              position: 'absolute',
              top,
              left: 0,
              width: 'var(--card-width)',
              height,
              borderRadius: 'var(--card-radius)',
              pointerEvents: 'none',
              zIndex: 1000,
            }}
          />
        );
      })}
      {isHintTarget && (
        <div
          className="hint-target"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: targetTop,
            left: 0,
            width: 'var(--card-width)',
            height: targetHeight,
            borderRadius: 'var(--card-radius)',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        />
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

      {/* Dashed drop-target highlight. Rendered as an absolutely-positioned
          overlay (not the container border) so it draws ABOVE all stacked
          cards, and so toggling it causes no layout shift (it takes no space
          and the container keeps a constant 1px border). `showHover` already
          encodes the stock/waste/empty-foundation rules above. */}
      {showHover && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            boxSizing: 'border-box',
            borderRadius: 'var(--card-radius)',
            border: '2px dashed rgba(255,255,255,0.9)',
            pointerEvents: 'none',
            // Kept below the DragOverlay (which renders the card(s) being
            // dragged) and below all modals (z-index 3000+), but above the
            // in-pile cards so the highlight still reads on top of the stack.
            zIndex: 900,
          }}
        />
      )}

      {/* Stock count badge: number of face-down cards still in the stock, shown
          bottom-left of the pile. Hidden once the stock is empty (the empty
          state keeps its own ↻ recycle affordance). `cards` for the stock pile
          is exactly the face-down stock array, so its length is the count. */}
      {kind === 'stock' && cards.length > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            zIndex: 950,
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            borderRadius: 6,
            padding: '1px 5px',
            fontSize: 12,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            userSelect: 'none',
          }}
        >
          {cards.length}
        </span>
      )}
    </div>
  );
}
