// hooks/useGameStore.js
// Zustand store wiring UI to the framework-agnostic core.
// The store NEVER implements rules itself — it delegates to core/*.

import { create } from 'zustand';
import { deal } from '../core/dealer.js';
import { applyMove, undo as coreUndo, redo as coreRedo } from '../core/moveEngine.js';
import { canMoveToTableau, canMoveToFoundation, getTableauRun } from '../core/rules.js';
import { isWon } from '../core/winDetection.js';

/**
 * Read a pile array from state by locator.
 * @param {import('../core/GameState.js').GameState} s
 * @param {string} loc
 */
function readPile(s, loc) {
  if (loc === 'stock') return s.stock;
  if (loc === 'waste') return s.waste;
  const [kind, idx] = loc.split(':');
  return kind === 'foundation' ? s.foundations[Number(idx)] : s.tableau[Number(idx)];
}

export const useGameStore = create((set, get) => ({
  state: deal(),
  redoStack: [],

  /**
   * Deal a fresh game. Optional seed for deterministic dealing/testing.
   * @param {number} [seed]
   */
  dealNewGame: (seed) => set({ state: deal(seed !== undefined ? { seed } : {}), redoStack: [] }),

  /**
   * Draw from stock to waste. No-op if stock is empty (UI should offer recycle).
   */
  drawFromStock: () => {
    const { state, redoStack } = get();
    set({ state: applyMove(state, { type: 'draw' }), redoStack });
  },

  /**
   * Recycle waste back into the stock.
   */
  recycleStock: () => {
    const { state, redoStack } = get();
    set({ state: applyMove(state, { type: 'recycle' }), redoStack });
  },

  /**
   * Move cards from one pile to another. Validates against core/rules.js.
   * Defaults to moving the single top card of `from`.
   *
   * @param {string} from  locator
   * @param {string} to    locator
   * @param {string} [cardId]  specific card id to move (must be a movable top card/run)
   * @returns {boolean} whether the move was applied
   */
  moveCard: (from, to, cardId) => {
    const { state, redoStack } = get();
    if (from === to) return false;

    const srcPile = readPile(state, from);

    // Determine the run of cards being moved.
    //  - Tableau sources: any face-up card may lift the valid run beneath it
    //    (a descending alternating-color sequence). getTableauRun validates it.
    //  - Stock / waste / foundation sources: only the single top card moves.
    let run;
    if (cardId) {
      const idx = srcPile.findIndex((c) => c.id === cardId);
      if (idx === -1) return false;
      if (from.startsWith('tableau')) {
        run = getTableauRun(srcPile, cardId);
        if (!run) return false;
      } else {
        if (idx !== srcPile.length - 1) return false;
        run = [srcPile[idx]];
      }
    } else {
      if (srcPile.length === 0) return false;
      run = [srcPile[srcPile.length - 1]];
    }

    // cardIds are ordered top→bottom, as expected by core/moveEngine.applyMoveCards.
    const moveIds = run.map((c) => c.id).reverse();
    const movingCard = run[0]; // bottom of the run is what lands on the destination
    if (!movingCard || !movingCard.faceUp) return false;

    const destPile = readPile(state, to);
    // Foundations accept only a single card; tableau accepts a run.
    const valid =
      to.startsWith('foundation')
        ? moveIds.length === 1 && canMoveToFoundation(movingCard, destPile)
        : canMoveToTableau(movingCard, destPile);
    if (!valid) return false;

    const next = applyMove(state, { type: 'moveCards', from, to, cardIds: moveIds });
    set({ state: next, redoStack: [] });
    return true;
  },

  undo: () => {
    const { state, redoStack } = get();
    if (state.moveHistory.length === 0) return;
    const history = state.moveHistory.slice();
    const last = history[history.length - 1];
    const next = coreUndo(state);
    set({ state: next, redoStack: [...redoStack, last] });
  },

  redo: () => {
    const { state, redoStack } = get();
    if (redoStack.length === 0) return;
    const stack = redoStack.slice();
    const record = stack.pop();
    const next = coreRedo(state, record);
    set({ state: next, redoStack: stack });
  },

  isWon: () => isWon(get().state),
  canUndo: () => get().state.moveHistory.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));

/** Convenience selector for raw core state. */
export const selectGameState = (s) => s.state;
