// components/CardView.jsx
// Renders a single card. Face/back art comes from the active deck renderer
// (see render/deck/deckRegistry.js); the two faces live inside a 3D flip
// container so face-up/face-down transitions animate.

import { useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { useCardFaceFlip } from '../render/animation/useCardFaceFlip.js';
import { playCardShake } from '../render/animation/playCardShake.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { isWon } from '../core/winDetection.js';
import { getDeck } from '../render/deck/deckRegistry.js';
import { getCardBack } from '../render/deck/cardBackRegistry.js';

const RANK_I18N_KEY = {
  1: 'ace',
  11: 'jack',
  12: 'queen',
  13: 'king',
};

function rankKey(rank) {
  return RANK_I18N_KEY[rank] ?? null;
}

function rankLabel(rank) {
  const k = rankKey(rank);
  return k ?? String(rank);
}

function cardAriaString(t, card) {
  const k = rankKey(card.rank);
  const rank = k ? t(`cards.${k}`) : String(card.rank);
  const suit = t(`cards.suit.${card.suit}`);
  return t('cards.aria', { rank, suit });
}

/**
 * @param {object} props
 * @param {{ id: string, suit: string, rank: number, color: string, faceUp: boolean }} props.card
 * @param {number} [props.zIndex]
 * @param {import('react').Ref<any>} [props.innerRef]  ref attached to the flip-inner node (for the 3D face flip)
 */
export function CardFace({ card, zIndex = 0, innerRef }) {
  const { t } = useTranslation();
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
  const cardBack = useSettingsStore((s) => s.cardBack);
  const faceImg = useMemo(
    () => getDeck(deck).renderCard(card.suit, card.rank),
    [card.suit, card.rank, deck],
  );
  const backImg = useMemo(() => {
    if (cardBack !== 'default') {
      const back = getCardBack(cardBack);
      if (back) return back.renderBack();
    }
    return getDeck(deck).renderBack();
  }, [deck, cardBack]);

  const front = (
    <div
      style={{
        ...base,
        backgroundImage: `url(${faceImg})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        userSelect: 'none',
      }}
      aria-label={cardAriaString(t, card)}
    />
  );

  const back = (
    <div
      style={{
        ...base,
        backgroundImage: `url(${backImg})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        border: card.faceUp ? base.border : 'var(--card-back-border, var(--card-border))',
        boxShadow: card.faceUp ? base.boxShadow : 'var(--card-back-shadow, var(--card-shadow))',
        transform: 'rotateY(180deg)',
      }}
      aria-label={t('cards.faceDown')}
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
  const { t } = useTranslation();
  const won = useGameStore((s) => isWon(s.state));
  const isOver = useStatsStore((s) => s.isOver);
  // While an auto-complete (toward the win) is animating, the whole board is
  // locked — the player must not grab cards mid-sequence.
  const autoCompleting = useGameStore((s) => s.autoCompleting);
  // Block only this card if it is the one physically in flight. Every other
  // card stays interactive during an unrelated animation.
  const isAnimating = useUiStore((s) => s.animatingCards.has(card.id));
  // Mid-draw-slide (flip done, still gliding to waste) or mid-shake. These are
  // NOT fully locked: drag is blocked, but a tap may auto-move (cancel+move) if
  // a valid target exists. See handlePointerUp / handleKeyDown.
  const isSliding = useUiStore((s) => s.slidingCards.has(card.id));
  const isShaking = useUiStore((s) => s.shakingCards.has(card.id));
  // Global / flip locks that fully block the card (no tap, no drag).
  const hardBlock = won || isOver || autoCompleting || isAnimating;
  // Drag is blocked during flip, slide, and shake.
  const dragDisabled = !card.faceUp || hardBlock || isSliding || isShaking;
  const locked = hardBlock;
  const selectedCardId = useUiStore((s) => s.selectedCardId);
  const highlightCard = useSettingsStore((s) => s.highlightCard);
  const selectCard = useUiStore((s) => s.selectCard);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: card.id,
    data: { from, cardId: card.id },
    disabled: dragDisabled,
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
    // Any tap on a card is an interaction, so dismiss the transient "No hints
    // available" banner immediately (regardless of whether the tap yields a
    // valid move). Taps on empty board space never reach a card's handler, so
    // they correctly leave the banner up.
    useUiStore.getState().dismissNoHintsBanner();
    if (!card.faceUp || hardBlock || !onAutoMove || !downPos.current) return;
    // Never auto-move on the same gesture as a drag: doing so mid-drag relocates
    // and hides the dragged card (see useDragEngine/Board hiddenIds), which can
    // leave it stuck invisible. The drag lifecycle owns the move in that case.
    if (useUiStore.getState().isDragging) return;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    if (Math.hypot(dx, dy) < CLICK_DISTANCE) {
      // Flip phase: fully locked — ignore the tap entirely.
      if (isAnimating) {
        downPos.current = null;
        return;
      }
      // Slide / shake: a tap MAY auto-move (if a valid target now exists) but
      // must NEVER drag and must NEVER shake on a miss — invalid taps do nothing.
      if (isSliding || isShaking) {
        onAutoMove(from, card.id);
        downPos.current = null;
        return;
      }
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
    if (!card.faceUp || hardBlock || !onAutoMove) return;
    // A keyboard activation of a card is an interaction; dismiss the banner.
    useUiStore.getState().dismissNoHintsBanner();
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clearSelection();
      // Flip phase: fully locked.
      if (isAnimating) return;
      // Slide / shake: keyboard acts like a tap — may auto-move, never shakes.
      if (isSliding || isShaking) {
        const ok = onAutoMove(from, card.id);
        if (ok) setAnnounce(t('cards.autoMoved', { card: cardAriaString(t, card) }));
        return;
      }
      const ok = onAutoMove(from, card.id);
      if (ok) {
        setAnnounce(t('cards.autoMoved', { card: cardAriaString(t, card) }));
      } else {
        setAnnounce(t('cards.noValidMove', { card: cardAriaString(t, card) }));
        playCardShake(e.currentTarget);
      }
    }
  };

  const selected = selectedCardId === card.id && !locked && highlightCard;

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
        cursor: dragDisabled ? 'default' : 'grab',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
        outline: selected ? '3px solid var(--card-text-red, #ffd54a)' : 'none',
        outlineOffset: 2,
      }}
      aria-label={`${cardAriaString(t, card)}${card.faceUp ? '' : t('cards.faceDownSuffix')}`}
      aria-pressed={selected}
    >
      <CardFace card={card} zIndex={zIndex} innerRef={flipRef} />
    </div>
  );
}
