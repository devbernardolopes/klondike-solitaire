// components/Board.jsx
// Lays out stock / waste / foundations (top row) and 7 tableau columns (below)
// using a responsive CSS grid. DnD context is wired here via useDragEngine.

import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useGameStore } from '../hooks/useGameStore.js';
import { useDragEngine } from '../hooks/useDragEngine.js';
import Pile from './Pile.jsx';
import { CardFace } from './CardView.jsx';

/**
 * Presentational stacked run shown floating under the cursor while dragging
 * a multi-card tableau run (bottom→top order).
 * @param {{ cards: Array<{id:string, suit:string, rank:number, color:string, faceUp:boolean}> }} props
 */
function RunPreview({ cards }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 'var(--card-width)',
        height: `calc(var(--card-height) + ${Math.max(cards.length - 1, 0)} * var(--tableau-fan))`,
      }}
    >
      {cards.map((card, i) => (
        <div
          key={card.id}
          style={{
            position: 'absolute',
            top: `calc(${i} * var(--tableau-fan))`,
            left: 0,
            width: 'var(--card-width)',
            zIndex: i,
          }}
        >
          <CardFace card={card} zIndex={i} />
        </div>
      ))}
    </div>
  );
}

export default function Board() {
  const state = useGameStore((s) => s.state);
  const drawFromStock = useGameStore((s) => s.drawFromStock);
  const recycleStock = useGameStore((s) => s.recycleStock);
  const autoMove = useGameStore((s) => s.autoMove);
  const { sensors, onDragStart, onDragEnd, onDragCancel, activeRun } =
    useDragEngine();

  const onStockClick = () => {
    if (state.stock.length > 0) drawFromStock();
    else if (state.waste.length > 0) recycleStock();
  };

  const hiddenIds = activeRun ? new Set(activeRun.map((c) => c.id)) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, var(--card-width))',
          gap: 'clamp(6px, 1.2vw, 14px)',
          justifyContent: 'center',
          padding: 'clamp(8px, 2vw, 20px)',
          maxWidth: '100%',
        }}
      >
        {/* Top row: stock, waste, spacer x2, 4 foundations */}
        <Pile
          loc="stock"
          cards={state.stock}
          onClick={onStockClick}
          label={state.stock.length === 0 ? '↻' : ''}
          hiddenIds={hiddenIds}
        />
        <Pile loc="waste" cards={state.waste} label="W" hiddenIds={hiddenIds} onAutoMove={autoMove} />
        <div />
        {state.foundations.map((pile, i) => (
          <Pile
            key={`f${i}`}
            loc={`foundation:${i}`}
            cards={pile}
            label={`F${i + 1}`}
            hiddenIds={hiddenIds}
            onAutoMove={autoMove}
          />
        ))}

        {/* Tableau: 7 columns */}
        {state.tableau.map((pile, i) => (
          <Pile
            key={`t${i}`}
            loc={`tableau:${i}`}
            cards={pile}
            fanned
            label={`T${i + 1}`}
            hiddenIds={hiddenIds}
            onAutoMove={autoMove}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeRun ? <RunPreview cards={activeRun} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
