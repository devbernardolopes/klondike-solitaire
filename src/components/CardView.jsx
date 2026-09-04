import { memo, useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { useCardFaceFlip } from '../render/animation/useCardFaceFlip.js';
import { playCardShake } from '../render/animation/playCardShake.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
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

export function cardAriaString(t, card) {
  const k = rankKey(card.rank);
  const rank = k ? t(`cards.${k}`) : String(card.rank);
  const suit = t(`cards.suit.${card.suit}`);
  return t('cards.aria', { rank, suit });
}

export const CardFace = memo(function CardFace({ card, zIndex = 0, innerRef, ariaLabel, faceDownLabel }) {
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
      aria-label={ariaLabel}
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
      aria-label={faceDownLabel}
    />
  );

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
});

const CLICK_DISTANCE = 6;

function CardViewBase({ card, from, zIndex = 0, hidden = false, onAutoMove, hardBlockBase = false, highlightCard = true, won = false }) {
  const { t, i18n } = useTranslation();
  const isAnimating = useUiStore((s) => s.animatingCards.has(card.id));
  const isSliding = useUiStore((s) => s.slidingCards.has(card.id));
  const isShaking = useUiStore((s) => s.shakingCards.has(card.id));
  const isSelected = useUiStore((s) => s.selectedCardId === card.id);
  const selectCard = useUiStore((s) => s.selectCard);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const hardBlock = (hardBlockBase || won) || isAnimating;
  const dragDisabled = !card.faceUp || hardBlock || isSliding || isShaking;
  const locked = hardBlock;
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: card.id,
    data: { from, cardId: card.id },
    disabled: dragDisabled,
  });

  const flipRef = useRef(null);
  useCardFaceFlip(flipRef, card.faceUp);

  const downPos = useRef(null);

  const cardAria = useMemo(() => cardAriaString(t, card), [t, i18n.language, card.id, card.suit, card.rank]);
  const faceDownLabel = useMemo(() => t('cards.faceDown'), [t, i18n.language]);
  const containerAriaLabel = useMemo(() => `${cardAria}${card.faceUp ? '' : t('cards.faceDownSuffix')}`, [cardAria, card.faceUp, t, i18n.language]);

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    listeners?.onPointerDown?.(e);
    downPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e) => {
    if (e.button !== 0) return;
    listeners?.onPointerUp?.(e);
    useUiStore.getState().dismissNoHintsBanner();
    if (!card.faceUp || hardBlock || !onAutoMove || !downPos.current) return;
    if (useUiStore.getState().isDragging) return;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    if (Math.hypot(dx, dy) < CLICK_DISTANCE) {
      if (isAnimating) {
        downPos.current = null;
        return;
      }
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

  const handleFocus = () => {
    if (card.faceUp && !locked) selectCard(card.id);
  };
  const handleKeyDown = (e) => {
    if (!card.faceUp || hardBlock || !onAutoMove) return;
    useUiStore.getState().dismissNoHintsBanner();
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clearSelection();
      if (isAnimating) return;
      if (isSliding || isShaking) {
        const ok = onAutoMove(from, card.id);
        if (ok) setAnnounce(t('cards.autoMoved', { card: cardAria }));
        return;
      }
      const ok = onAutoMove(from, card.id);
      if (ok) {
        setAnnounce(t('cards.autoMoved', { card: cardAria }));
      } else {
        setAnnounce(t('cards.noValidMove', { card: cardAria }));
        playCardShake(e.currentTarget);
      }
    }
  };

  const selected = isSelected && !locked && highlightCard;

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
      aria-label={containerAriaLabel}
      aria-pressed={selected}
    >
      <CardFace card={card} zIndex={zIndex} innerRef={flipRef} ariaLabel={cardAria} faceDownLabel={faceDownLabel} />
    </div>
  );
}

const CardView = memo(CardViewBase);
export default CardView;
