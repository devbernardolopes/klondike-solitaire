// components/EventDealGrid.jsx
// Renders one page's deals as a square N x N grid. Solved deals have no
// button at all — just their slice of the page's postcard image, sliced via
// background-size/background-position (a standard CSS sprite-sheet trick: a
// single <img>-less div per cell, background-size scaled to gridSize x
// gridSize so each cell shows exactly 1/gridSize of the image, positioned by
// that cell's row/col). Unsolved deals are a solid numbered button — no
// image peeks through an unsolved cell at all, by design (the number is the
// only thing shown until it's actually won).
//
// Deal `position` (1-indexed) maps row-major, left-to-right top-to-bottom:
// position 1 = row 0/col 0, position 2 = row 0/col 1, ..., position
// gridSize+1 = row 1/col 0, etc. This is an authoring convention — deals
// must be inserted in that reading order for the revealed image to look
// right, since nothing in the schema enforces it.
//
// Clicking a tile no longer starts a deal. It only selects the tile (a
// 3px accent outline), and the EventDetailModal's footer "Play" button is
// what actually starts the game. The selection is persisted in
// db/eventSelection.js and survives modal close/reopen and page navigation.
//
// `locked: true` flips every cell into a non-interactive preview: no number,
// no number click handler, no selectable, just a centered Lock icon overlay
// so the player can see the upcoming grid layout (and any already-solved
// image slices) before unlocking. The grid container's layout, aspect ratio,
// gap, and border are unchanged from the unlocked branch so the carousel
// doesn't reflow when swiping between locked and unlocked pages.

import { Lock } from 'lucide-react';
import { eventImageUrl, onEventImageError } from '../utils/eventImage.js';

// Accent color for the selected-tile outline. Falls back to the modal's
// foreground color so it stays visible against any theme.
const SELECTED_OUTLINE = 'var(--ui-accent, var(--ui-modal-fg))';

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
                backgroundImage: deal.solved ? `url(${imageUrl})` : undefined,
                backgroundSize: deal.solved ? `${gridSize * 100}% ${gridSize * 100}%` : undefined,
                backgroundPosition: deal.solved ? `${posX}% ${posY}%` : undefined,
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
              {/* Hidden img just to trigger onEventImageError's placeholder swap consistently with the rest of the app */}
              <img src={imageUrl} onError={onEventImageError} alt="" style={{ display: 'none' }} />
            </div>
          );
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
