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

import { eventImageUrl, onEventImageError } from '../utils/eventImage.js';

export default function EventDealGrid({ page, onPlayDeal, disabled }) {
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

        if (deal.solved) {
          return (
            <div
              key={deal.id}
              aria-label={`Deal ${deal.position} — solved`}
              style={{
                backgroundImage: `url(${imageUrl})`,
                backgroundSize: `${gridSize * 100}% ${gridSize * 100}%`,
                backgroundPosition: `${posX}% ${posY}%`,
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
            disabled={disabled}
            onClick={() => onPlayDeal(deal)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: gridSize >= 5 ? 13 : 16,
              fontWeight: 700,
              border: 'none',
              background: 'var(--ui-modal-btn-bg)',
              color: 'var(--ui-modal-fg)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {deal.position}
          </button>
        );
      })}
    </div>
  );
}
