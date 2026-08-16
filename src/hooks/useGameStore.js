// hooks/useGameStore.js
// Zustand store wiring UI to the framework-agnostic core.
// The store NEVER implements rules itself — it delegates to core/*.

import { create } from 'zustand';
import { deal } from '../core/dealer.js';
import { applyMove, undo as coreUndo, redo as coreRedo } from '../core/moveEngine.js';
import { canMoveToTableau, canMoveToFoundation, getTableauRun, getAutoMoveTargets, findFoundationMove, findAssistTableauMove, hasAnyValidMove, DEST_ORDER } from '../core/rules.js';
import { isWon } from '../core/winDetection.js';
import { buildStandardDeck, shuffle } from '../core/Deck.js';
import { createEmptyGameState } from '../core/GameState.js';
import { randomSolvableSeed } from '../core/solvablePool.js';
import { Flip } from '../render/animation/gsapSetup.js';
import { flipBridge } from '../render/animation/flipBridge.js';
import { useUiStore } from './useUiStore.js';

// Capture the current position/size of every card node before a state change so
// the render-layer Flip hook can tween from old → new positions after React
// re-renders (cards reparent between Pile components in the DOM tree).
function captureFlip() {
  flipBridge.current = Flip.getState('[data-card]');
}

// Build a transient "pre-deal" layout: all 52 shuffled cards sitting face-down
// in the stock, every other pile empty. The real deal() runs on the next frame
// so the deal animation flows through the same Flip pipeline. core/ is untouched
// — this only composes its pure building blocks.
function buildPreDealState(seed) {
  const deck = shuffle(buildStandardDeck(), seed !== undefined ? seed : undefined);
  const state = createEmptyGameState();
  if (seed !== undefined) state.seed = seed;
  state.stock = deck.map((c) => ({ ...c, faceUp: false }));
  state.startedAt = Date.now();
  return state;
}

// Delay (ms) between auto-complete move applications so the user sees cards
// fly to the foundations one at a time. Not persisted in state.
const AUTO_COMPLETE_DELAY = 140;
let autoCompleteTimer = null;

function clearAutoCompleteTimer() {
  if (autoCompleteTimer !== null) {
    clearTimeout(autoCompleteTimer);
    autoCompleteTimer = null;
  }
}

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
  // Remembers the last auto-move destination per card id so repeated clicks
  // cycle through the valid slots in DEST_ORDER. Reset on new game / undo / redo.
  autoMoveState: {},
  // UI-only bookkeeping tagging the kind of transition last applied, so the
  // animation layer can pick the right motion config. Not part of core/GameState.
  lastActionMeta: { type: 'move' },

  /**
   * Deal a fresh game. `mode` selects the dealing strategy:
   *  - 'winning' — uses a pre-verified solvable seed from solvablePool.js
   *  - 'random'  — unseeded, true-random (not guaranteed solvable)
   *
   * Sequences through a transient "pre-deal" layout (all cards in stock) set
   * instantly, then performs the real deal on the next animation frame so the
   * deal stagger flows through the same Flip pipeline as every other transition.
   *
   * @param {'winning'|'random'} [mode]
   */
  dealNewGame: (mode = 'random') => {
    clearAutoCompleteTimer();
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().setLastNewGameMode(mode);
    const seed = mode === 'winning' ? randomSolvableSeed() : undefined;
    const preDeal = buildPreDealState(seed !== undefined ? seed : undefined);
    set({ state: preDeal, redoStack: [], autoMoveState: {}, lastActionMeta: { type: 'draw' } });
    requestAnimationFrame(() => {
      captureFlip();
      set({ state: deal(seed !== undefined ? { seed } : {}), lastActionMeta: { type: 'deal' } });
    });
  },

  /**
   * Draw from stock to waste. No-op if stock is empty (UI should offer recycle).
   */
  drawFromStock: () => {
    const { state, redoStack } = get();
    if (isWon(state)) return;
    captureFlip();
    const next = applyMove(state, { type: 'draw' });
    set({ state: next, redoStack, lastActionMeta: { type: 'draw' } });
    if (next.stock.length === 0 && !isWon(next) && !hasAnyValidMove(next)) {
      useUiStore.getState().setNoMovesDialogOpen(true);
    }
  },

  /**
   * Recycle waste back into the stock.
   */
  recycleStock: () => {
    const { state, redoStack } = get();
    if (isWon(state)) return;
    captureFlip();
    set({ state: applyMove(state, { type: 'recycle' }), redoStack, lastActionMeta: { type: 'draw' } });
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
  moveCard: (from, to, cardId, opts = {}) => {
    clearAutoCompleteTimer();
    const { state, redoStack } = get();
    if (isWon(state)) return false;
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
    captureFlip();
    set({ state: next, redoStack: [], lastActionMeta: { type: opts.metaType ?? 'move' } });
    return true;
  },

  undo: () => {
    clearAutoCompleteTimer();
    useUiStore.getState().setNoMovesDialogOpen(false);
    const { state, redoStack } = get();
    if (state.moveHistory.length === 0) return;
    const history = state.moveHistory.slice();
    const last = history[history.length - 1];
    const next = coreUndo(state);
    set({ state: next, redoStack: [...redoStack, last], autoMoveState: {} });
  },

  redo: () => {
    clearAutoCompleteTimer();
    const { state, redoStack } = get();
    if (redoStack.length === 0) return;
    const stack = redoStack.slice();
    const record = stack.pop();
    const next = coreRedo(state, record);
    set({ state: next, redoStack: stack, autoMoveState: {} });
  },

  /**
   * One-click / one-tap auto-move. Moves the clicked face-up card (and, for a
   * tableau source, the valid run beneath it) to the next valid destination,
   * cycling through candidates in DEST_ORDER on repeated clicks.
   *
   * @param {string} from    source pile locator
   * @param {string} cardId  the clicked card's id
   * @returns {boolean} whether a move was applied
   */
  autoMove: (from, cardId) => {
    const { state, autoMoveState } = get();
    if (isWon(state)) return false;
    const targets = getAutoMoveTargets(state, from, cardId);
    if (targets.length === 0) return false;

    const last = autoMoveState[cardId];
    let chosen;
    if (last) {
      const li = DEST_ORDER.indexOf(last);
      chosen = targets.find((t) => DEST_ORDER.indexOf(t) > li) ?? targets[0];
    } else {
      chosen = targets[0];
    }

    set({ autoMoveState: { ...autoMoveState, [cardId]: chosen } });
    get().moveCard(from, chosen, cardId, { metaType: 'auto' });
    return true;
  },

  /**
   * Auto-complete: greedily move every visible, top-most card (waste top and
   * face-up tableau tops) onto a valid foundation until no more such moves
   * exist. Moves are applied one at a time with a small delay (see
   * AUTO_COMPLETE_DELAY) so the user sees the cards arrive. Each move is a
   * normal history entry, so Undo steps back through them individually.
   *
   * Only one auto-complete may run at a time; any user action (deal / move /
   * undo / redo) cancels the in-progress animation via clearAutoCompleteTimer.
   *
   * @returns {boolean} whether at least one move was started
   */
  autoComplete: () => {
    if (autoCompleteTimer !== null) return false;
    if (isWon(get().state)) return false;
    const step = () => {
      const cur = get().state;
      const foundationMove = findFoundationMove(cur);
      if (foundationMove) {
        const next = applyMove(cur, {
          type: 'moveCards',
          from: foundationMove.from,
          to: foundationMove.to,
          cardIds: [foundationMove.cardId],
        });
        captureFlip();
        set({ state: next, redoStack: [], autoMoveState: {}, lastActionMeta: { type: 'auto' } });
        autoCompleteTimer = setTimeout(step, AUTO_COMPLETE_DELAY);
        return;
      }
      // No direct foundation move — see if a short tableau shuffle unblocks one.
      const assist = findAssistTableauMove(cur);
      if (assist) {
        // applyMoveCards requires the FULL contiguous top run, not just the
        // starting card id — reconstruct it the same way moveCard does.
        const run = getTableauRun(cur.tableau[assist.fromCol], assist.cardId);
        const cardIds = run.map((c) => c.id).reverse();
        const next = applyMove(cur, {
          type: 'moveCards',
          from: `tableau:${assist.fromCol}`,
          to: `tableau:${assist.toCol}`,
          cardIds,
        });
        captureFlip();
        set({ state: next, redoStack: [], autoMoveState: {}, lastActionMeta: { type: 'auto' } });
        autoCompleteTimer = setTimeout(step, AUTO_COMPLETE_DELAY);
        return;
      }
      // Neither a foundation move nor a helpful tableau shuffle was found within
      // the search budget — stop gracefully, same as today. This should be rare
      // once isObviousWinState triggered the run, but is not treated as an error.
      autoCompleteTimer = null;
    };
    step();
    return autoCompleteTimer !== null;
  },

  isWon: () => isWon(get().state),
  canUndo: () => get().state.moveHistory.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));

/** Convenience selector for raw core state. */
export const selectGameState = (s) => s.state;
