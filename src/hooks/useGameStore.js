// hooks/useGameStore.js
// Zustand store wiring UI to the framework-agnostic core.
// The store NEVER implements rules itself — it delegates to core/*.

import { create } from 'zustand';
import { deal } from '../core/dealer.js';
import { applyMove, undo as coreUndo, redo as coreRedo } from '../core/moveEngine.js';
import { canMoveToTableau, canMoveToFoundation, getTableauRun, getAutoMoveTargets, findFoundationMove, hasAnyValidMove, isAllTableauFaceUp, DEST_ORDER } from '../core/rules.js';
import { isWon } from '../core/winDetection.js';
import { solveAsync, cancelAllSolves, STALE } from '../core/solverClient.js';
import { buildStandardDeck, shuffle } from '../core/Deck.js';
import { createEmptyGameState } from '../core/GameState.js';
import { randomSolvableSeed, pickSolvableSeed } from '../core/solvablePool.js';
import { enqueueFlip } from '../render/animation/flipBridge.js';
import { cancelWinCascade } from '../render/animation/winCascade.js';
import { useUiStore } from './useUiStore.js';
import { useStatsStore } from './useStatsStore.js';
import { useSeedStore } from './useSeedStore.js';

// Capture the current on-screen rect of every card node before a state change so
// the render-layer hook can tween from old → new positions after React
// re-renders (cards reparent between Pile components in the DOM tree). Stored as a
// Map<cardId, DOMRect> keyed by data-flip-id so the animation layer can compute
// each moved card's translation explicitly (robust to reparenting, unlike Flip
// matching across unmounted/remounted nodes). The snapshot is pushed onto a
// per-transition queue (not a single global slot) so several moves can animate
// concurrently without clobbering one another's starting positions.
// Returns the transition id so the caller can reserve the lock via beginTransition.
function captureFlip(type) {
  const rects = new Map();
  document.querySelectorAll('[data-card]').forEach((el) => {
    const id = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
    rects.set(id, el.getBoundingClientRect());
  });
  return enqueueFlip(type, rects);
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
let activeSolveCancel = null;

function clearAutoCompleteTimer() {
  if (autoCompleteTimer !== null) {
    clearTimeout(autoCompleteTimer);
    autoCompleteTimer = null;
  }
}

// Apply one auto move to the store state with the usual Flip-capture + animation
// bookkeeping. Shared by the winning-sequence and greedy fallbacks.
function applyAutoStep(get, set, move) {
  const cur = get().state;
  const next = applyMove(cur, move);
  // The winning solver sequence mixes moveCards / draw / recycle moves. draw and
  // recycle descriptors carry no cardIds/to, so derive the animated card ids and
  // destination locator from the move type (mirrors drawFromStock/recycleStock).
  let animIds = [];
  let destLocs = [];
  if (move.type === 'moveCards') {
    animIds = move.cardIds;
    destLocs = [move.to];
  } else if (move.type === 'draw') {
    const drawn = cur.stock[cur.stock.length - 1];
    animIds = drawn ? [drawn.id] : [];
    destLocs = ['waste'];
  } else if (move.type === 'recycle') {
    animIds = cur.waste.map((c) => c.id);
    destLocs = ['stock'];
  }
  // Enqueue as 'auto' (the type useCardMoveSlide actually consumes) so the tween
  // starts and endTransition releases the lock. The animIds/destLocs above are
  // still derived from the real move.type to avoid the undefined-cardIds crash.
  const tid = captureFlip('auto');
  useUiStore.getState().beginTransition(tid, animIds, destLocs);
  set({ state: next, redoStack: [], autoMoveState: {}, lastActionMeta: { type: 'auto' } });
  useStatsStore.getState().startTimerIfValid(cur);
  useStatsStore.getState().addMoves(1);
}

// Make safe, obvious foundation moves one at a time until none remain. Cheap and
// synchronous; used when the full solver has no win to prove (or when hidden
// cards remain and we never want to pay for the search).
function runGreedy(get, set) {
  const visited = new Set();
  const step = () => {
    const cur = get().state;
    const sig = [
      cur.waste.map((c) => c.id).join(','),
      cur.foundations.map((p) => p.map((c) => c.id).join(',')).join('|'),
      cur.tableau.map((p) => p.map((c) => c.id).join(',')).join('|'),
    ].join('##');
    if (visited.has(sig)) {
      autoCompleteTimer = null;
      set({ autoCompleting: false });
      return;
    }
    visited.add(sig);
    const fm = findFoundationMove(cur);
    if (fm) {
      applyAutoStep(get, set, { type: 'moveCards', from: fm.from, to: fm.to, cardIds: [fm.cardId] });
      autoCompleteTimer = setTimeout(step, AUTO_COMPLETE_DELAY);
      return;
    }
    autoCompleteTimer = null;
    set({ autoCompleting: false });
  };
  step();
}

// Animate the solver's winning move sequence one step at a time.
function runWinSequence(get, set, seq) {
  let i = 0;
  const step = () => {
    if (i >= seq.length) {
      autoCompleteTimer = null;
      set({ autoCompleting: false });
      return;
    }
    const move = seq[i++];
    applyAutoStep(get, set, move);
    autoCompleteTimer = setTimeout(step, AUTO_COMPLETE_DELAY);
  };
  step();
}

// Cancel any in-progress auto-complete run (animation and the off-thread solver)
// and drop the "autoCompleting" flag so a user action (or a later obvious-win
// state) can re-trigger it.
function cancelAutoComplete(set) {
  clearAutoCompleteTimer();
  if (activeSolveCancel) {
    activeSolveCancel();
    activeSolveCancel = null;
  }
  cancelAllSolves();
  set({ autoCompleting: false });
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
  state: deal({ seed: randomSolvableSeed() }),
  redoStack: [],
  // True while an auto-complete sequence is animating, so the Board trigger
  // effect doesn't re-run the (expensive) solver on every step of the run.
  autoCompleting: false,
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
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    // Abort any in-flight win cascade immediately and release its global lock,
    // so a new-game request mid-fall is honored instead of being dropped. Only
    // block on real in-flight per-card transitions (a stray move being clobbered
    // by the deal reset).
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size > 0) return;
    useUiStore.getState().setLastNewGameMode(mode);
    useStatsStore.getState().resetStats();
    const seed =
      mode === 'winning'
        ? (() => {
            const { seed: s, exhausted } = pickSolvableSeed(useSeedStore.getState().playedSeeds);
            if (exhausted) useSeedStore.getState().resetPlayed();
            return s;
          })()
        : undefined;
    const preDeal = buildPreDealState(seed !== undefined ? seed : undefined);
    set({ state: preDeal, redoStack: [], autoMoveState: {}, lastActionMeta: { type: 'draw' } });
    requestAnimationFrame(() => {
      cancelAutoComplete(set);
      const next = deal(seed !== undefined ? { seed } : {});
      const allIds = [
        ...next.stock,
        ...next.waste,
        ...next.foundations.flat(),
        ...next.tableau.flat(),
      ].map((c) => c.id);
      const allLocs = [
        'stock',
        'waste',
        ...next.foundations.map((_, i) => `foundation:${i}`),
        ...next.tableau.map((_, i) => `tableau:${i}`),
      ];
      const tid = captureFlip('deal');
      useUiStore.getState().beginTransition(tid, allIds, allLocs);
      set({ state: next, lastActionMeta: { type: 'deal' } });
    });
  },

  /**
   * Draw from stock to waste. No-op if stock is empty (UI should offer recycle).
   */
  drawFromStock: () => {
    const { state, redoStack } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return;
    if (state.stock.length === 0) return;
    // Only block while the stock/waste pair is itself animating (a draw slides a
    // card stock→waste). Other, unrelated moves don't block drawing.
    const { animatingLocs } = useUiStore.getState();
    if (animatingLocs.has('stock') || animatingLocs.has('waste')) return;
    const drawnId = state.stock[state.stock.length - 1].id;
    const tid = captureFlip('draw');
    useUiStore.getState().beginTransition(tid, [drawnId], ['stock', 'waste']);
    const next = applyMove(state, { type: 'draw' });
    set({ state: next, redoStack, lastActionMeta: { type: 'draw' } });
    useStatsStore.getState().startTimerIfValid(state);
    useStatsStore.getState().addMoves(1);
    if (next.stock.length === 0 && !isWon(next) && !hasAnyValidMove(next)) {
      useUiStore.getState().setNoMovesDialogOpen(true);
    }
  },

  /**
   * Recycle waste back into the stock.
   */
  recycleStock: () => {
    const { state, redoStack } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return;
    // Recycle slides every waste card back into the stock, so block only while
    // the stock/waste pair is already animating.
    const { animatingLocs } = useUiStore.getState();
    if (animatingLocs.has('stock') || animatingLocs.has('waste')) return;
    const movingIds = state.waste.map((c) => c.id);
    const tid = captureFlip('recycle');
    useUiStore.getState().beginTransition(tid, movingIds, ['stock', 'waste']);
    set({ state: applyMove(state, { type: 'recycle' }), redoStack, lastActionMeta: { type: 'recycle' } });
    useStatsStore.getState().startTimerIfValid(state);
    useStatsStore.getState().addMoves(1);
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
    cancelAutoComplete(set);
    const { state, redoStack } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return false;
    if (from === to) return false;
    // Granular blocking: only refuse if a card being moved here is still in
    // flight, or if the destination (or a pile currently receiving another
    // card) is busy. The source pile stays interactive so the rest of the
    // board can be played during an unrelated animation.
    const { animatingCards, animatingLocs } = useUiStore.getState();
    if (animatingLocs.has(to) || animatingLocs.has(from)) return false;

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
    // Refuse if any card we'd lift is still animating in flight.
    if (moveIds.some((id) => animatingCards.has(id))) return false;

    const destPile = readPile(state, to);
    // Foundations accept only a single card; tableau accepts a run.
    const valid =
      to.startsWith('foundation')
        ? moveIds.length === 1 && canMoveToFoundation(movingCard, destPile)
        : canMoveToTableau(movingCard, destPile);
    if (!valid) return false;

    const next = applyMove(state, { type: 'moveCards', from, to, cardIds: moveIds });
    const tid = captureFlip(opts.metaType ?? 'move');
    useUiStore.getState().beginTransition(tid, moveIds, [to]);
    set({ state: next, redoStack: [], lastActionMeta: { type: opts.metaType ?? 'move' } });
    useStatsStore.getState().startTimerIfValid(state);
    useStatsStore.getState().addMoves(1);
    return true;
  },

  undo: () => {
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    const { state, redoStack } = get();
    if (state.moveHistory.length === 0 || useStatsStore.getState().isOver) return;
    // Undo/redo don't animate and would corrupt an in-flight tween, so block
    // them whenever any card is still moving.
    if (useUiStore.getState().animatingCards.size > 0) return;
    const history = state.moveHistory.slice();
    const last = history[history.length - 1];
    const next = coreUndo(state);
    set({ state: next, redoStack: [...redoStack, last], autoMoveState: {}, lastActionMeta: { type: 'undo' } });
    useStatsStore.getState().addMoves(1);
  },

  redo: () => {
    cancelAutoComplete(set);
    const { state, redoStack } = get();
    if (redoStack.length === 0 || useStatsStore.getState().isOver) return;
    if (useUiStore.getState().animatingCards.size > 0) return;
    const stack = redoStack.slice();
    const record = stack.pop();
    const next = coreRedo(state, record);
    set({ state: next, redoStack: stack, autoMoveState: {}, lastActionMeta: { type: record.type === 'draw' ? 'draw' : 'move' } });
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
    if (isWon(state) || useStatsStore.getState().isOver) return false;
    // moveCard enforces the granular per-card / per-pile lock, so autoMove only
    // needs to bail on a won/over game here; the actual busy check happens there.
    const targets = getAutoMoveTargets(state, from, cardId);
    if (targets.length === 0) return false;

    const last = autoMoveState[cardId];
    // Tap auto-move cycles through every legal destination in DEST_ORDER,
    // including reversing back to the pile the card just came from. This mirrors
    // drag behavior (a dragged card can always be moved back) and guarantees a
    // card is never stranded when the source is its only legal slot. Cycling is
    // user-driven, so A→B→A→B ping-pong (between two mutually-valid piles) is
    // intentional and identical to what dragging already permits.
    let candidates = targets;

    let chosen;
    if (last && from === last.dest) {
      const li = DEST_ORDER.indexOf(last.dest);
      chosen = candidates.find((t) => DEST_ORDER.indexOf(t) > li) ?? candidates[0];
    } else {
      chosen = candidates[0];
    }
    if (!chosen) return false;

    set({ autoMoveState: { ...autoMoveState, [cardId]: { dest: chosen, source: from } } });
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
  autoComplete: (force = false) => {
    if (autoCompleteTimer !== null) return false;
    if (isWon(get().state) || useStatsStore.getState().isOver) return false;
    // User-initiated auto-complete is blocked while an animation is in flight
    // (no interaction during animation). The automatic trigger from an
    // obvious-win state passes force:true because that state is reached BY an
    // animating move, and the running sequence keeps the lock held itself.
    if (!force && useUiStore.getState().animatingCards.size > 0) return false;

    const state = get().state;

    // Hidden cards remain: never run the expensive solver. Just make safe,
    // obvious foundation moves instantly and stop (matches "instant greedy only").
    if (!isAllTableauFaceUp(state)) {
      runGreedy(get, set);
      return autoCompleteTimer !== null;
    }

    // All tableau revealed: prove a full win off the main thread. The solver may
    // require cycling the still-present stock/waste; if no win is provable it
    // silently falls back to the greedy foundation loop (no announcement),
    // matching the requested "keep silent on stall" behavior.
    set({ autoCompleting: true });
    const { promise, cancel } = solveAsync(state, { maxNodes: 200000, maxMs: 2000 });
    activeSolveCancel = cancel;
    promise.then((seq) => {
      activeSolveCancel = null;
      if (seq === STALE) {
        set({ autoCompleting: false });
        return;
      }
      if (seq && seq.length > 0) {
        runWinSequence(get, set, seq);
      } else {
        set({ autoCompleting: false });
        runGreedy(get, set);
      }
    });
    return true;
  },

  isWon: () => isWon(get().state),
  canUndo: () => get().state.moveHistory.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));

/** Convenience selector for raw core state. */
export const selectGameState = (s) => s.state;
