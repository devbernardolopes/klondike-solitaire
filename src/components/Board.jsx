// components/Board.jsx
// Lays out stock / waste / foundations (top row) and 7 tableau columns (below)
// using a responsive CSS grid. DnD context is wired here via useDragEngine.

import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../hooks/useGameStore.js';
import { useDragEngine } from '../hooks/useDragEngine.js';
import { useUiStore, isAnyModalOpen } from '../hooks/useUiStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';
import { useSettingsStore } from '../hooks/useSettingsStore.js';
import { saveDailyResult } from '../db/dailyResults.js';
import { useCardMoveSlide } from '../render/animation/useCardMoveSlide.js';
import { useStockDrawSlide } from '../render/animation/useStockDrawSlide.js';
import { useFoundationParticles } from '../render/animation/useFoundationParticles.js';
import { playWinCascade } from '../render/animation/winCascade.js';
import { isWon } from '../core/winDetection.js';
import { solveAsync, STALE } from '../core/solverClient.js';
import { getAutoFireSolveOptions } from '../core/solver.js';
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
  const scale = avail > 0 && natural > avail ? avail / natural : 1;
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
      const avail = Math.max(0, board.clientHeight - 2 * cardH - gap - 2 * pad - 8);
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
  const dealNewGame = useGameStore((s) => s.dealNewGame);
  const showHints = useGameStore((s) => s.showHints);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const setAnnounce = useUiStore((s) => s.setAnnounce);
  const announce = useUiStore((s) => s.announce);
  const handedness = useSettingsStore((s) => s.handedness);
  const isOver = useStatsStore((s) => s.isOver);
  const autoCompleting = useGameStore((s) => s.autoCompleting);
  const autoCompletingToWin = useGameStore((s) => s.autoCompletingToWin);
  const won = isWon(state);
  // `anyAnimating` = some card is still in flight (used to block global actions
  // like new-game/undo/auto-complete). `stockWasteBusy` only blocks
  // draw/recycle. Card/pile-level interaction is gated per-card / per-pile by
  // the components themselves, so non-involved cards stay playable mid-animation.
  const anyAnimating = useUiStore((s) => s.animatingCards.size > 0);
  const stockWasteBusy = useUiStore(
    (s) => s.animatingLocs.has('stock') || s.animatingLocs.has('waste'),
  );
  const locked = won || isOver || anyAnimating || autoCompleting;
  const { sensors, onDragStart, onDragEnd, onDragCancel, activeRun } =
    useDragEngine();

  // Plays the move/relocation translation after each pile-mutating state change
  // so cards tween
  // between piles even when they reparent across Pile components.
  useCardMoveSlide();
  useStockDrawSlide();
  useFoundationParticles();

  // Win-state cascade: fire once on the false → true transition of isWon.
  const wasWon = useRef(false);
  useEffect(() => {
    if (won && !wasWon.current) {
      clearSelection();
      playWinCascade();
      useStatsStore.getState().stopTimer();
      // Snapshot the finished game and the PREVIOUS bests (before recordWin
      // mutates them) so we can flag which stats are new records.
      const { startTime, moves, score, undos } = useStatsStore.getState();
      const durationMs = startTime == null ? 0 : useStatsStore.getState().getElapsedMs();
      const prev = useStatisticsStore.getState().stats;
      const newScore = score > prev.highestScore;
      const newTime = prev.lowestTimeMs == null || durationMs < prev.lowestTimeMs;
      const newMoves = prev.lowestMoves == null || moves < prev.lowestMoves;
      const newUndos = prev.lowestUndos == null || undos < prev.lowestUndos;
      // The current game's kind + (for daily) date, so the Win modal can show
      // the daily banner and a "Return to Daily Challenge" affordance, and so we
      // can persist the day's best result below.
      const uiState = useUiStore.getState();
      const gameKind = uiState.currentGameKind;
      const dailyDate = uiState.currentDailyDate;
      const gameState = useGameStore.getState().state;
      useUiStore.getState().setWinDialog({
        score,
        timeMs: durationMs,
        moves,
        undos,
        newScore,
        newTime,
        newMoves,
        newUndos,
        bestScore: prev.highestScore,
        bestTimeMs: prev.lowestTimeMs,
        bestMoves: prev.lowestMoves,
        bestUndos: prev.lowestUndos,
        dailyDate: gameKind === 'daily' ? dailyDate : null,
        seed: gameState.seed,
      });
      // Persist the just-won game's stats cumulatively. The timer is frozen
      // above, so endTime is final for this game. Runs after the snapshot so the
      // new-record flags reflect the values the player actually beat.
      useStatisticsStore.getState().recordWin({ score, timeMs: durationMs, moves, undos });
      // If this was a Winning Deal (it carries a pool seed), remember the seed
      // so it isn't re-dealt until the whole pool has been won. Daily/Event
      // seeds are NOT pool seeds and must never be added here.
      if (gameKind === 'winning' && gameState.seed !== undefined) {
        useSeedStore.getState().addPlayedSeed(gameState.seed);
      }
      // Fold a Daily Challenge win into that day's best result. Daily wins also
      // count in the global cumulative stats (handled by recordWin above).
      if (gameKind === 'daily' && dailyDate) {
        saveDailyResult(dailyDate, { seed: gameState.seed, score, timeMs: durationMs, moves });
      }
    }
    wasWon.current = won;
  }, [won]);

  // Auto-trigger auto-complete once a clean, zero-column-shuffle win is provable.
  // The trigger condition and the winning line are decided by core
  // `getAutoFireSolveOptions`: it returns solver options (always
  // foundation-only / no-recycle) when the board is in an "obviously
  // finishable" state — stock empty AND (tableau fully revealed, OR exactly one
  // face-down card with an empty waste) — and otherwise returns null so the
  // board is left to the player. We then prove the win off-thread (Web Worker,
  // never blocks) and, if proven, hand the EXACT sequence back to the store via
  // autoComplete(true, { seq }) so it runs without re-solving (which would
  // otherwise risk re-introducing a recycle). Skips while a run is already
  // animating (autoCompleting) and discards stale results when the state changes
  // before the worker replies.
  //
  // `autoCompleting` is in the deps so that when a manual greedy double-click
  // peel finishes and releases the lock, this effect re-runs: if the peeled
  // board has now reached a fireable state, the to-completion run takes over
  // (with the banner) — per the rule that the banner appears on the trigger, not
  // necessarily on the user's double-click.
  useEffect(() => {
    if (won) return;
    if (useGameStore.getState().autoCompleting) return;
    // Skip the transient pre-deal state: its tableau is empty (vacuously
    // "all face-up"), so we'd start an auto-complete on a state that is about
    // to be replaced by the real deal — which would throw mid-sequence.
    if (state.tableau.every((p) => p.length === 0) && state.foundations.every((p) => p.length === 0)) return;
    const fireOpts = getAutoFireSolveOptions(state);
    if (!fireOpts) return;
    const snapshot = state;
    let solveResult;
    try {
      solveResult = solveAsync(state, { ...fireOpts, maxNodes: 200000, maxMs: 2000 });
    } catch {
      // If the solver is unavailable, simply don't auto-fire; the board stays
      // interactive and the player can trigger auto-complete manually.
      return undefined;
    }
    const { promise, cancel } = solveResult;
    promise.then((seq) => {
      if (seq === STALE) return;
      if (useGameStore.getState().state !== snapshot) return;
      if (Array.isArray(seq) && seq.length > 0) {
        setAnnounce('Auto-completing to foundations');
        useGameStore.getState().autoComplete(true, { seq });
      }
    });
    return () => cancel();
  }, [state, won, autoCompleting]);

  // Global keyboard shortcuts (single-letter, no modifiers). Cards and piles
  // handle their own Enter/Space activation, so these never conflict with them.
  useEffect(() => {
    const onKey = (e) => {
       if (e.metaKey || e.ctrlKey || e.altKey) return;
       // Never fire game shortcuts while any modal/dialog is open — e.g. typing
       // letters into the Seed Input field must not trigger new-game/draw/etc.
       if (isAnyModalOpen(useUiStore.getState())) return;
        // New game / undo / auto-complete are blocked while anything is
       // still animating (or the game is over). Draw/recycle are handled below
       // with their own narrower stock/waste lock so they stay usable during an
       // unrelated move.
        if (anyAnimating || isOver || autoCompleting) return;
        if (e.key === 'n' || e.key === 'N') {
           clearSelection();
           // If a game is in progress (timer started, not yet finished), ask
           // for confirmation before discarding progress. A game that hasn't
           // started or has already finished deals immediately with no prompt.
           const stats = useStatsStore.getState();
           const timerRunning = stats.startTime !== null && stats.endTime === null && !stats.isOver;
           if (timerRunning) {
             useUiStore.getState().setConfirmNewGameDialogOpen(true);
             setAnnounce('Confirm new game');
           } else {
             setAnnounce('New game dealt');
             dealNewGame(useUiStore.getState().lastNewGameMode);
           }
           return;
        }
       if (won) return;
       switch (e.key.toLowerCase()) {
        case 'd':
          clearSelection();
          if (stockWasteBusy) return;
          if (useGameStore.getState().state.stock.length > 0) drawFromStock();
          else if (useGameStore.getState().state.waste.length > 0) recycleStock();
          setAnnounce('Drew from stock');
          break;
        case 'r':
          clearSelection();
          if (stockWasteBusy) return;
          recycleStock();
          setAnnounce('Recycled waste to stock');
          break;
         case 'u':
           clearSelection();
           undo();
           setAnnounce('Undo');
           break;
          case 'a':
           clearSelection();
           autoComplete();
           setAnnounce('Auto-completing to foundations');
           break;
         case 'h':
           clearSelection();
           showHints();
           break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [won, isOver, anyAnimating, autoCompleting, stockWasteBusy, drawFromStock, recycleStock, undo, autoComplete, dealNewGame, showHints, clearSelection, setAnnounce]);

  const onStockClick = () => {
    if (won || isOver) return;
    if (stockWasteBusy) return;
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
    if (locked || e.button !== 0) return;
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
      {/* Centered "Autocomplete" banner shown while the game is auto-moving
          everything to the foundations. It is only rendered while auto-complete
          is running AND the game is not yet won, so it vanishes the instant the
          win state is reached (all cards on all four foundations). */}
      {autoCompletingToWin && !won && (
        <div className="auto-complete-banner" role="status" aria-live="polite">
          Autocomplete
        </div>
      )}
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
        {/* Top row: order depends on handedness. Left-handed = current layout
            (stock/waste on the left, foundations on the right). Right-handed
            mirrors it (foundations on the left, stock/waste on the right). */}
        {handedness === 'right'
          ? [
              ...state.foundations.map((pile, i) => (
                <Pile
                  key={`f${i}`}
                  loc={`foundation:${i}`}
                  cards={pile}
                  hiddenIds={hiddenIds}
                  onAutoMove={autoMove}
                />
              )),
              <div key="spacer" />,
              <Pile key="waste" loc="waste" cards={state.waste} hiddenIds={hiddenIds} onAutoMove={autoMove} />,
              <Pile
                key="stock"
                loc="stock"
                cards={state.stock}
                onClick={onStockClick}
                label={state.stock.length === 0 ? '↻' : ''}
                hiddenIds={hiddenIds}
              />,
            ]
          : [
              <Pile
                key="stock"
                loc="stock"
                cards={state.stock}
                onClick={onStockClick}
                label={state.stock.length === 0 ? '↻' : ''}
                hiddenIds={hiddenIds}
              />,
              <Pile key="waste" loc="waste" cards={state.waste} hiddenIds={hiddenIds} onAutoMove={autoMove} />,
              <div key="spacer" />,
              ...state.foundations.map((pile, i) => (
                <Pile
                  key={`f${i}`}
                  loc={`foundation:${i}`}
                  cards={pile}
                  hiddenIds={hiddenIds}
                  onAutoMove={autoMove}
                />
              )),
            ]}

        {/* Tableau: 7 columns */}
        {state.tableau.map((pile, i) => (
          <Pile
            key={`t${i}`}
            loc={`tableau:${i}`}
            cards={pile}
            fanned
            metrics={metrics}
            hiddenIds={hiddenIds}
            onAutoMove={autoMove}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null} zIndex={1500}>
        {activeRun ? <RunPreview cards={activeRun} metrics={metrics} /> : null}
      </DragOverlay>
    </DndContext>
    </div>
  );
}
