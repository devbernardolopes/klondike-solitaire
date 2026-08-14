// components/Board.jsx
// Lays out stock / waste / foundations (top row) and 7 tableau columns (below)
// using a responsive CSS grid. DnD context is wired here via useDragEngine.

import { DndContext } from '@dnd-kit/core';
import { useGameStore } from '../hooks/useGameStore.js';
import { useDragEngine } from '../hooks/useDragEngine.js';
import Pile from './Pile.jsx';

export default function Board() {
  const state = useGameStore((s) => s.state);
  const drawFromStock = useGameStore((s) => s.drawFromStock);
  const recycleStock = useGameStore((s) => s.recycleStock);
  const { sensors, onDragStart, onDragEnd, onDragCancel, activeId } = useDragEngine();

  const onStockClick = () => {
    if (state.stock.length > 0) drawFromStock();
    else if (state.waste.length > 0) recycleStock();
  };

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
        />
        <Pile loc="waste" cards={state.waste} label="W" />
        <div />
        {state.foundations.map((pile, i) => (
          <Pile key={`f${i}`} loc={`foundation:${i}`} cards={pile} label={`F${i + 1}`} />
        ))}

        {/* Tableau: 7 columns */}
        {state.tableau.map((pile, i) => (
          <Pile key={`t${i}`} loc={`tableau:${i}`} cards={pile} fanned label={`T${i + 1}`} />
        ))}
      </div>
    </DndContext>
  );
}
