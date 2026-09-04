import { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import gsap from 'gsap';
import { eventImageUrl, onEventImageError } from '../utils/eventImage.js';
import { hasSeenDissolve, markSeenDissolve } from '../db/eventDissolveSeen.js';

const SELECTED_OUTLINE = 'var(--ui-accent, var(--ui-modal-fg))';

function SolvedTile({ deal, imageUrl, gridSize, posX, posY, isSelected, disabled, onSelectDeal, locked }) {
  const ref = useRef(null);
  const shouldDissolve = deal.solved && !hasSeenDissolve(deal.id);

  useEffect(() => {
    if (!shouldDissolve || !ref.current) return;
    gsap.fromTo(
      ref.current,
      { opacity: 0, filter: 'blur(6px)' },
      { opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power2.out' }
    );
    markSeenDissolve(deal.id);
  }, [shouldDissolve, deal.id]);

  const pillFontSize = gridSize >= 5 ? 14 : gridSize >= 4 ? 16 : gridSize >= 3 ? 18 : 20;

  if (locked) {
    return (
      <div
        key={deal.id}
        aria-hidden="true"
        ref={shouldDissolve ? ref : null}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--ui-modal-btn-bg)',
          backgroundImage: deal.solved ? `url(${imageUrl})` : undefined,
          backgroundSize: deal.solved ? `${gridSize * 100}% ${gridSize * 100}%` : undefined,
          backgroundPosition: deal.solved ? `${posX}% ${posY}%` : undefined,
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      >
        {deal.solved && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                background: 'rgba(0,0,0,0.45)',
                color: '#fff',
                borderRadius: 999,
                padding: '2px 8px',
                fontWeight: 700,
                fontSize: pillFontSize,
                lineHeight: 1,
              }}
            >
              {deal.position}
            </span>
          </span>
        )}
        <Lock size={28} style={{ color: 'var(--ui-modal-fg)', opacity: 0.85 }} />
      </div>
    );
  }

  return (
    <div
      key={deal.id}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`Deal ${deal.position} — solved`}
      aria-pressed={isSelected}
      onClick={() => { if (!disabled) onSelectDeal(deal); }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectDeal(deal);
        }
      }}
      ref={shouldDissolve ? ref : null}
      style={{
        position: 'relative',
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: `${gridSize * 100}% ${gridSize * 100}%`,
        backgroundPosition: `${posX}% ${posY}%`,
        cursor: disabled ? 'default' : 'pointer',
        outline: isSelected ? `3px solid ${SELECTED_OUTLINE}` : 'none',
        outlineOffset: isSelected ? '-3px' : 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            background: 'rgba(0,0,0,0.45)',
            color: '#fff',
            borderRadius: 999,
            padding: '2px 8px',
            fontWeight: 700,
            fontSize: pillFontSize,
            lineHeight: 1,
          }}
        >
          {deal.position}
        </span>
      </span>
      <img src={imageUrl} onError={onEventImageError} alt="" style={{ display: 'none' }} />
    </div>
  );
}

export default function EventDealGrid({ page, onSelectDeal, selectedDealId, disabled, locked }) {
  const { gridSize, imagePath, deals } = page;
  const imageUrl = eventImageUrl(imagePath);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
        gridTemplateRows: `repeat(${gridSize}, 1fr)`,
        gap: 4,
        aspectRatio: '1 / 1',
        width: '100%',
        maxWidth: 320,
        margin: '0 auto',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--ui-modal-btn-border)',
      }}
    >
      {deals.map((deal) => {
        const index = deal.position - 1;
        const row = Math.floor(index / gridSize);
        const col = index % gridSize;
        const posX = gridSize === 1 ? 0 : (col / (gridSize - 1)) * 100;
        const posY = gridSize === 1 ? 0 : (row / (gridSize - 1)) * 100;

        if (locked) {
          if (deal.solved) {
            return <SolvedTile key={deal.id} deal={deal} imageUrl={imageUrl} gridSize={gridSize} posX={posX} posY={posY} locked />;
          }
          return (
            <div
              key={deal.id}
              aria-hidden="true"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--ui-modal-btn-bg)',
                opacity: 0.6,
                pointerEvents: 'none',
              }}
            >
              <Lock size={28} style={{ color: 'var(--ui-modal-fg)', opacity: 0.85 }} />
            </div>
          );
        }

        const isSelected = deal.id === selectedDealId;

        if (deal.solved) {
          return <SolvedTile key={deal.id} deal={deal} imageUrl={imageUrl} gridSize={gridSize} posX={posX} posY={posY} isSelected={isSelected} disabled={disabled} onSelectDeal={onSelectDeal} />;
        }

        return (
          <button
            key={deal.id}
            type="button"
            aria-label={`Play deal ${deal.position}`}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onSelectDeal(deal)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: gridSize >= 5 ? 22 : gridSize >= 4 ? 28 : gridSize >= 3 ? 36 : 48,
              fontWeight: 700,
              border: 'none',
              background: 'var(--ui-modal-btn-bg)',
              color: 'var(--ui-modal-fg)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              outline: isSelected ? `3px solid ${SELECTED_OUTLINE}` : 'none',
              outlineOffset: isSelected ? '-3px' : 0,
            }}
          >
            {deal.position}
          </button>
        );
      })}
    </div>
  );
}
