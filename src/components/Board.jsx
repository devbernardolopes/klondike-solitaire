// components/Board.jsx
// Lays out stock / waste / foundations (top row) and 7 tableau columns (below)
// using a responsive CSS grid. DnD context is wired here via useDragEngine.

import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useDragEngine } from '../hooks/useDragEngine.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { useCardMoveFlip } from '../render/animation/useCardMoveFlip.js';
import { playWinCascade } from '../render/animation/winCascade.js';
import { isWon } from '../core/winDetection.js';
import Pile from './Pile.jsx';
import { CardFace } from './CardView.jsx';

// Resolve a CSS length expression (clamp()/calc()/var()) to a pixel number by
// mounting a hidden probe element. Custom-property tokens are NOT pre-resolved
// by getComputedStyle, so this is the reliable way to read --tableau-fan etc.
// Cache by expression and invalidate on viewport/resize changes.
const _fanMetricCache = new Map();
function measureVar(expr) {
  if (_fanMetricCache.has(expr)) return _fanMetricCache.get(expr);
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;height:${expr};`;
  document.body.appendChild(probe);
  const px = probe.offsetHeight;
  document.body.removeChild(probe);
  _fanMetricCache.set(expr, px);
  return px;
}
function clearFanMetrics() {
  _fanMetricCache.clear();
}

/**
 * Presentational stacked run shown floating under the cursor while dragging
 * a multi-card tableau run (bottom→top order).
 * @param {{ cards: Array<{id:string, suit:string, rank:number, color:string, faceUp:boolean}> }} props
 * @param {{ cardH:number, fanUp:number, fanDown:number, avail:number }} [props.metrics]
 */
function RunPreview({ cards, metrics }) {
  const { cardH, fanUp, avail } = metrics || {};
  // The lifted run is always face-up; compute a fit scale the same way Pile does
  // so the floating stack matches the source column's compressed spacing.
  const offs = (cardH ? cards.map(() => fanUp) : null);
  const used = offs ? offs.slice(0, Math.max(0, cards.length - 1)).reduce((a, b) => a + b, 0) : 0;
  const natural = cardH ? cardH + used : 0;
  const scale = avail > 0 && natural > avail ? Math.max(avail / natural, 0.3) : 1;
  const tops = [];
  let acc = 0;
  for (let i = 0; i < cards.length; i++) {
    tops.push(acc);
    if (i < cards.length - 1) acc += (cardH ? fanUp : 0) * scale;
  }
  return (
    <div
      style={{
        position: 'relative',
        width: 'var(--card-width)',
        height: cardH ? `${cardH + used * scale}px` : `calc(var(--card-height) + ${Math.max(cards.length - 1, 0)} * var(--tableau-fan))`,
      }}
    >
      {cards.map((card, i) => (
        <div
          key={card.id}
          style={{
            position: 'absolute',
            top: cardH ? `${tops[i]}px` : `calc(${i} * var(--tableau-fan))`,
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
  const boardRef = useRef(null);
  const [metrics, setMetrics] = useState(null);

  // Measure the card/fan geometry and the available vertical space for a
  // tableau column so piles can compress their fan to fit the screen. Re-runs
  // on board resize (and viewport resize) so spacing re-fits and restores.
  useLayoutEffect(() => {
    const measure = () => {
      const board = boardRef.current;
      if (!board) return;
      clearFanMetrics();
      const cardH = measureVar('var(--card-height)');
      const fanUp = measureVar('var(--tableau-fan)');
      const fanDown = measureVar('var(--tableau-fan-down)');
      const gap = measureVar('clamp(6px, 1.2vw, 14px)');
      const pad = measureVar('clamp(8px, 2vw, 20px)');
      const avail = Math.max(0, board.clientHeight - cardH - gap - 2 * pad - 8);
      setMetrics({ cardH, fanUp, fanDown, avail });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (boardRef.current) ro.observe(boardRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const recycleStock = useGameStore((s) => s.recycleStock);
  const autoMove = useGameStore((s) => s.autoMove);
  const autoComplete = useGameStore((s) => s.autoComplete);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const announce = useUiStore((s) => s.announce);
  const { sensors, onDragStart, onDragEnd, onDragCancel, activeRun } =
    useDragEngine();

  // Plays Flip.from() after each pile-mutating state change so cards tween
  // between piles even when they reparent across Pile components.
  useCardMoveFlip();

  // Win-state cascade: fire once on the false → true transition of isWon.
  const won = isWon(state);
  const wasWon = useRef(false);
  useEffect(() => {
    if (won && !wasWon.current) {
      clearSelection();
      playWinCascade();
    }
    wasWon.current = won;
  }, [won]);

  // Global keyboard shortcuts (single-letter, no modifiers). Cards and piles
  // handle their own Enter/Space activation, so these never conflict with them.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        clearSelection();
        setAnnounce('New game dealt');
        dealNewGame();
        return;
      }
      if (won) return;
      switch (e.key.toLowerCase()) {
        case 'd':
          clearSelection();
          if (useGameStore.getState().state.stock.length > 0) drawFromStock();
          else if (useGameStore.getState().state.waste.length > 0) recycleStock();
          setAnnounce('Drew from stock');
          break;
        case 'r':
          clearSelection();
          recycleStock();
          setAnnounce('Recycled waste to stock');
          break;
        case 'u':
          clearSelection();
          undo();
          setAnnounce('Undo');
          break;
        case 'e':
          clearSelection();
          redo();
          setAnnounce('Redo');
          break;
        case 'a':
          clearSelection();
          autoComplete();
          setAnnounce('Auto-completing to foundations');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [won, drawFromStock, recycleStock, undo, redo, autoComplete, dealNewGame, clearSelection, setAnnounce]);

  const onStockClick = () => {
    if (won) return;
    if (state.stock.length > 0) drawFromStock();
    else if (state.waste.length > 0) recycleStock();
  };

  // Double-tap / double-click detection on the board background only (not on a
  // card — cards keep their single-tap auto-move). Two taps within DOUBLE_TAP_MS
  // and a distance tolerance trigger auto-complete. Touch taps drift more than
  // mouse clicks, so the tolerance is widened for touch input.
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_DISTANCE_MOUSE = 6;
  const DOUBLE_TAP_DISTANCE_TOUCH = 24;
  const lastTap = useRef(null);
  const handleBoardPointerUp = (e) => {
    if (won || e.button !== 0) return;
    if (e.target.closest('[data-card]')) return;
    const now = Date.now();
    const tap = { x: e.clientX, y: e.clientY, t: now };
    const prev = lastTap.current;
    lastTap.current = tap;
    const maxDistance =
      e.pointerType === 'touch'
        ? DOUBLE_TAP_DISTANCE_TOUCH
        : DOUBLE_TAP_DISTANCE_MOUSE;
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(tap.x - prev.x, tap.y - prev.y) < maxDistance
    ) {
      lastTap.current = null;
      autoComplete();
    }
  };

  const hiddenIds = activeRun ? new Set(activeRun.map((c) => c.id)) : null;

  return (
    <div
      ref={boardRef}
      onPointerUp={handleBoardPointerUp}
      style={{ flex: 1, minHeight: '100%', width: '100%', touchAction: 'manipulation', overflow: 'hidden' }}
    >
      {/* Screen-reader live region for keyboard/shortcut feedback. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announce}
      </div>
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
            metrics={metrics}
            label={`T${i + 1}`}
            hiddenIds={hiddenIds}
            onAutoMove={autoMove}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeRun ? <RunPreview cards={activeRun} metrics={metrics} /> : null}
      </DragOverlay>
    </DndContext>
    </div>
  );
}
