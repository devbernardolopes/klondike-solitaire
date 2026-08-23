// hooks/useGameStore.js
// Zustand store wiring UI to the framework-agnostic core.
// The store NEVER implements rules itself — it delegates to core/*.

import { create } from 'zustand';
import { deal } from '../core/dealer.js';
import { applyMove, undo as coreUndo } from '../core/moveEngine.js';
import { canMoveToTableau, canMoveToFoundation, getTableauRun, getAutoMoveTargets, findFoundationMove, isAllTableauFaceUp, DEST_ORDER } from '../core/rules.js';
import { isWon } from '../core/winDetection.js';
import { solveAsync, cancelAllSolves, STALE } from '../core/solverClient.js';
import { SOLVER_TIMEOUT, hasDeadEndMove, compressWinningSequence } from '../core/solver.js';
import { findHints } from '../core/hints.js';
import { buildStandardDeck, shuffle } from '../core/Deck.js';
import { createEmptyGameState } from '../core/GameState.js';
import { randomSolvableSeed, pickSolvableSeed } from '../core/solvablePool.js';
import { enqueueFlip } from '../render/animation/flipBridge.js';
import { cancelWinCascade } from '../render/animation/winCascade.js';
import { MOTION } from '../render/animation/motion.js';
import { useUiStore, whenTransitionDone } from './useUiStore.js';
import { useStatsStore } from './useStatsStore.js';
import { useSeedStore } from './useSeedStore.js';

// Capture the current on-screen rect of the cards being moved by this step
// (given via `animIds`) before the state change, so the render-layer hook can
// tween them from old → new positions after React re-renders (cards reparent
// between Pile components in the DOM tree). Stored as a Map<cardId, DOMRect>
// keyed by data-flip-id so the animation layer can compute each moved card's
// translation explicitly (robust to reparenting, unlike Flip matching across
// unmounted/remounted nodes). Snapshotting ONLY the moving cards (rather than
// every card on the board) is what makes the 'overlap' auto-complete mode safe:
// if a previous step's card is still mid-tween when this step captures, it is
// not in `animIds`, so its live transform is never re-grabbed and re-tweened.
// The snapshot is pushed onto a per-transition queue (not a single global slot)
// so several moves can animate concurrently without clobbering one another's
// starting positions. Returns the transition id so the caller can reserve the
// lock via beginTransition.
function captureFlip(type, animIds) {
  const rects = new Map();
  if (animIds && animIds.length) {
    const want = new Set(animIds);
    document.querySelectorAll('[data-card]').forEach((el) => {
      const id = el.getAttribute('data-flip-id') || el.getAttribute('data-card');
      if (want.has(id)) rects.set(id, el.getBoundingClientRect());
    });
  }
  return enqueueFlip(type, rects);
}

// Confirm a genuinely stuck position once the stock is exhausted (no draws left).
// We ask the off-thread solver whether ANY move is reachable through legal play
// including stock/waste cycling. "Reachable" means: a *progress* move (a foundation
// play or a tableau relocation that uncovers a face-down card) OR any waste/stock
// card that can relocate onto a tableau pile or foundation (even a non-covering
// shuffle, e.g. a red 8 onto a black 9). Only when the search fully exhausts the
// space with NEITHER kind of move reachable do we show the "no moves remaining"
// modal — so a position that can still cycle its waste onto the board is never
// falsely flagged, but one whose only moves are unwinnable tableau shuffles (no
// waste/stock relocation possible) still is. A budget-exceeded (unknown) result
// never asserts a dead end. The result is ignored if the board has changed in the
// meantime (reference guard) or the solve was superseded (STALE).
function checkDeadEnd(get, set, state) {
  // Cheap pre-filter: a progress move available right now means not stuck.
  if (hasDeadEndMove(state)) {
    useUiStore.getState().setNoMovesDialogOpen(false);
    return;
  }
  const captured = state; // each action mints a fresh state object
  const { promise } = solveAsync(state, { maxNodes: 500000, maxMs: 4000, goal: 'move' });
  promise.then((seq) => {
    if (seq === STALE) return;
    if (get().state !== captured) return; // state moved on; ignore stale result
    if (seq === SOLVER_TIMEOUT) {
      // Budget exceeded — unknown. Never assert a dead end on an unknown result.
      return;
    }
    if (seq === true) {
      // A legal move is reachable anywhere through cycling — not stuck.
      useUiStore.getState().setNoMovesDialogOpen(false);
    } else {
      // Search fully exhausted with no move reachable — a genuine dead end.
      useUiStore.getState().setNoMovesDialogOpen(true);
    }
  });
}

// Build the pre-deal layout (all 52 cards face-down in stock) from an already
// constructed, ordered deck. The SAME `deck` array must be reused for both the
// pre-deal and the later deal() call so the two states reference identical card
// ids — the deal animation matches cards by id between the snapshot and the
// dealt DOM, so mismatched ids would give every card dx===dy===0 and animate
// nothing (this was why the seed-based Winning Deal never animated while the
// order-based Random Shuffle did, since the latter reused one deck).
function preDealFromDeck(deck, seed) {
  const state = createEmptyGameState();
  if (seed !== undefined) state.seed = seed;
  state.drawCount = 1;
  state.stock = deck.map((c) => ({ ...c, faceUp: false }));
  state.startedAt = Date.now();
  return state;
}

// Shared animated-deal pipeline: build the deck ONCE, set a transient "pre-deal"
// (all cards face-down in stock) from it instantly, then on the next frame
// perform the real deal through the same Flip pipeline used by every other
// transition. The deck is reused for both steps so card ids line up and the
// animation tweens. Used by every new-game entry point (dealNewGame,
// replayGame, and the initial app-load deal) so the deal animation is identical
// regardless of mode.
function runAnimatedDeal(get, set, { seed, order, deck } = {}) {
  const usedDeck = deck ? deck.slice() : order ? order.slice() : shuffle(buildStandardDeck(), seed);
  const preDeal = preDealFromDeck(usedDeck, seed);
  const replaySpec = seed !== undefined ? { seed } : { order: usedDeck.map((c) => ({ ...c })) };
  set({ state: preDeal, autoMoveState: {}, replaySpec, lastActionMeta: { type: 'draw' } });
  requestAnimationFrame(() => {
    cancelAutoComplete(set);
    const next = deal({ order: usedDeck });
    if (seed !== undefined) next.seed = seed;
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
    const tid = captureFlip('deal', allIds);
    useUiStore.getState().beginTransition(tid, allIds, allLocs);
    set({ state: next, lastActionMeta: { type: 'deal' } });
  });
}

// The per-step pacing (mode + gap in ms) for auto-complete now lives in
// MOTION.autoComplete (see motion.js); these helpers below read it.
let autoCompleteTimer = null;
let activeSolveCancel = null;
// Bumped whenever an in-progress auto-complete is cancelled (deal/move/undo
// all call cancelAutoComplete). The async step loops capture this id and bail
// after an await if it changed, so a cancelled run never applies further moves
// after the user took over.
let autoCompleteRunId = 0;

function clearAutoCompleteTimer() {
  if (autoCompleteTimer !== null) {
    clearTimeout(autoCompleteTimer);
    autoCompleteTimer = null;
  }
}

// Resolve when a step may proceed. We await the rAF-driven tween completion so
// the step loop advances only after the relocation tween fully finishes. A
// hidden/background tab pauses requestAnimationFrame, so the tween (and thus
// this await) simply stalls until the tab is visible again — at which point
// GSAP's default lagSmoothing resumes the parked tween smoothly (no jump), the
// tween completes, and the loop continues animating to the win.
function awaitStepDone(tid) {
  if (tid == null) return Promise.resolve();
  return whenTransitionDone(tid);
}

// Clamp the user-facing auto-complete step delay (ms) to a sane range.
function clampStepDelay(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1000, Math.round(n)));
}

// Pause `delay` ms before the next auto-complete step. Always resolves via a
// timer (never synchronously) so that each step lands in its own macrotask —
// this lets React flush and useCardMoveSlide process exactly one transition per
// step. Crucially, even when delay is 0 the timer yields once, so an 'overlap'
// run with stepDelay 0 does NOT apply every remaining step in a single
// synchronous burst (which would collapse all transitions into one and skip the
// per-step animation entirely).
function gap(delay) {
  return new Promise((resolve) => {
    autoCompleteTimer = setTimeout(resolve, clampStepDelay(delay));
  });
}

// Apply one auto move to the store state with the usual Flip-capture + animation
// bookkeeping. Shared by the winning-sequence and greedy fallbacks. The move is
// always animated (a transition lock is held until its tween completes), so the
// step loop never outruns the visuals — even across a tab blur/refocus.
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
  const tid = captureFlip('auto', animIds);
  useUiStore.getState().beginTransition(tid, animIds, destLocs);
  set({ state: next, autoMoveState: {}, lastActionMeta: { type: 'auto' } });
  useStatsStore.getState().startTimerIfValid(cur);
  useStatsStore.getState().addMoves(1);
  return tid;
}

// Drive an auto-complete sequence step by step, honoring the pacing mode in
// MOTION.autoComplete. `makeStep()` applies the next move and returns its
// transition id (or null when no more moves remain). `hasNext()` reports whether
// another move is available WITHOUT applying it — used to decide when the run is
// finished and to release the `autoCompleting` lock only after the FINAL tween
// has actually landed (so no card is ever left mid-flight with interaction
// re-enabled).
//
// Pacing:
//   mode 'sequential' — each step awaits its relocation tween to fully land,
//     THEN waits `stepDelay` ms before the next step starts. This preserves the
//     original one-card-at-a-time behaviour (no two cards airborne at once).
//   mode 'overlap'    — each step waits only `stepDelay` ms after IT started
//     before the next step begins, so multiple cards can be in flight together.
//     The relocation tweens themselves still use MOTION.auto; only the cadence
//     changes. Safe because captureFlip now snapshots only the moving cards.
function runAutoSteps(get, set, makeStep, hasNext) {
  // Lock the whole board for the duration of the run so the player cannot
  // interact with cards mid-sequence.
  set({ autoCompleting: true });
  const run = autoCompleteRunId;
  const { mode } = MOTION.autoComplete;
  const delay = MOTION.autoComplete.stepDelay;
  const step = async () => {
    if (run !== autoCompleteRunId) return; // cancelled by a user action
    const tid = makeStep();
    if (tid == null) {
      autoCompleteTimer = null;
      set({ autoCompleting: false, autoCompletingToWin: false });
      return;
    }
    const more = hasNext();
    if (!more) {
      // Final step: always wait for its tween to land before releasing the lock.
      await awaitStepDone(tid);
      if (run !== autoCompleteRunId) return;
      autoCompleteTimer = null;
      set({ autoCompleting: false, autoCompletingToWin: false });
      return;
    }
    if (mode === 'overlap') {
      // Start the next step `delay` ms after THIS step began; do NOT await the
      // current tween, so cards can be airborne concurrently.
      await gap(delay);
      if (run !== autoCompleteRunId) return;
      step();
    } else {
      // Sequential: wait for the current tween to fully land, then the gap.
      await awaitStepDone(tid);
      if (run !== autoCompleteRunId) return;
      await gap(delay);
      if (run !== autoCompleteRunId) return;
      step();
    }
  };
  step();
}

// Make safe, obvious foundation moves one at a time until none remain. Cheap and
// synchronous; used when the full solver has no win to prove (or when hidden
// cards remain and we never want to pay for the search). Steps are paced by
// runAutoSteps per MOTION.autoComplete (sequential by default, so no two cards
// ever animate concurrently — this is what prevents the "jumping" artefact where
// cards appeared to bounce between piles mid-flight in the old engine).
function runGreedy(get, set) {
  const visited = new Set();
  const signature = (s) => [
    s.waste.map((c) => c.id).join(','),
    s.foundations.map((p) => p.map((c) => c.id).join(',')).join('|'),
    s.tableau.map((p) => p.map((c) => c.id).join(',')).join('|'),
  ].join('##');
  const makeStep = () => {
    const cur = get().state;
    const sig = signature(cur);
    if (visited.has(sig)) return null; // cycle guard
    visited.add(sig);
    const fm = findFoundationMove(cur);
    if (!fm) return null;
    return applyAutoStep(get, set, { type: 'moveCards', from: fm.from, to: fm.to, cardIds: [fm.cardId] });
  };
  const hasNext = () => {
    const cur = get().state;
    const sig = signature(cur);
    if (visited.has(sig)) return false;
    return findFoundationMove(cur) != null;
  };
  runAutoSteps(get, set, makeStep, hasNext);
}

// Animate the solver's winning move sequence one step at a time. Steps are paced
// by runAutoSteps per MOTION.autoComplete (sequential by default, so a moved
// stack is never re-grabbed while still in flight — the source of the old
// "jumping" artefact).
function runWinSequence(get, set, seq) {
  const cursor = { i: 0 };
  const makeStep = () => {
    if (cursor.i >= seq.length) return null;
    const move = seq[cursor.i++];
    return applyAutoStep(get, set, move);
  };
  const hasNext = () => cursor.i < seq.length;
  runAutoSteps(get, set, makeStep, hasNext);
}

// Cancel any in-progress auto-complete run (animation and the off-thread solver)
// and drop the "autoCompleting" flag so a user action (or a later obvious-win
// state) can re-trigger it.
function cancelAutoComplete(set) {
  clearAutoCompleteTimer();
  autoCompleteRunId += 1; // invalidate any in-flight async step loop
  if (activeSolveCancel) {
    activeSolveCancel();
    activeSolveCancel = null;
  }
  cancelAllSolves();
  set({ autoCompleting: false, autoCompletingToWin: false });
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

// The initial game is dealt from a solvable pool seed (i.e. Winning Deal mode).
// Capture that seed so "Replay this Game" can reproduce it.
const INITIAL_SEED = randomSolvableSeed();

// The initial game's deck, built ONCE and shared between the pre-deal snapshot
// and the dealt layout so their card ids match (otherwise the deal animation
// would have nothing to tween). preDealFromDeck reuses this same deck.
const INITIAL_DECK = shuffle(buildStandardDeck(), INITIAL_SEED);
const INITIAL_PREDEAL = preDealFromDeck(INITIAL_DECK, INITIAL_SEED);

// Guards the one-time animated initial deal so React StrictMode (which double-
// invokes mount effects) cannot trigger two overlapping deals.
let initialDealDone = false;

export const useGameStore = create((set, get) => ({
  // Start as a pre-deal (all cards face-down in stock) so the very first game
  // can animate its deal on load via initialDeal() rather than appearing
  // instantly. The pre-deal and the dealt state share INITIAL_DECK's card ids.
  state: INITIAL_PREDEAL,
  // True while an auto-complete sequence is animating, so the Board trigger
  // effect doesn't re-run the (expensive) solver on every step of the run.
  autoCompleting: false,
  // True ONLY while the auto-complete "to completion" (solver-proven winning)
  // sequence is actually animating — i.e. runWinSequence. Never set for the
  // greedy "peel a few safe moves" fallback. Drives the centered "Autocomplete"
  // banner, which must not appear for non-winning auto-moves/auto-completes.
  autoCompletingToWin: false,
  // Remembers the last auto-move destination per card id so repeated clicks
  // cycle through the valid slots in DEST_ORDER. Reset on new game / undo.
  autoMoveState: {},
  // Captures exactly how the current game was dealt so "Replay this Game" can
  // reproduce it: `{ seed }` for Winning Deal, `{ order }` (the full 52-card
  // shuffled order) for Random Shuffle. Set by dealNewGame / replayGame.
  replaySpec: { seed: INITIAL_SEED },
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
    useUiStore.getState().clearHints();
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
    runAnimatedDeal(get, set, { seed: seed !== undefined ? seed : undefined });
  },

  /**
   * Deal a fresh game from a specific, user-supplied seed in Winning Deal mode.
   * The seed must already be a valid pool seed (validated by the UI before
   * calling); if it is not, the caller should not invoke this action. Mirrors the
   * 'winning' branch of dealNewGame but uses the supplied seed verbatim so the
   * exact requested deal is reproduced.
   *
   * @param {number} seed
   */
  dealWithSeed: (seed) => {
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().clearHints();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size > 0) return;
    useUiStore.getState().setLastNewGameMode('winning');
    useStatsStore.getState().resetStats();
    runAnimatedDeal(get, set, { seed });
  },

  /**
   * Animate the initial game on app load. The store starts as a pre-deal, so the
   * first Winning Deal (a fixed, pre-determined seed) plays the same deal
   * animation as a user-initiated new game instead of appearing instantly.
   * Guarded so React StrictMode's double-invoked mount effect deals only once.
   */
  initialDeal: () => {
    if (initialDealDone) return;
    initialDealDone = true;
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().clearHints();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size > 0) return;
    useUiStore.getState().setLastNewGameMode('winning');
    useStatsStore.getState().resetStats();
    runAnimatedDeal(get, set, { seed: INITIAL_SEED, deck: INITIAL_DECK });
  },

  /**
   * Restart the current game identically. Uses the captured `replaySpec`:
   *  - Winning Deal (seed)   → re-deal with the same seed.
   *  - Random Shuffle (order)→ re-deal with the exact same card order.
   * Falls back to dealNewGame(lastNewGameMode) if no spec is recorded.
   */
  replayGame: () => {
    const spec = get().replaySpec;
    if (!spec) {
      get().dealNewGame(useUiStore.getState().lastNewGameMode);
      return;
    }
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().clearHints();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size > 0) return;
    useUiStore.getState().setLastNewGameMode(spec.seed !== undefined ? 'winning' : 'random');
    useStatsStore.getState().resetStats();
    runAnimatedDeal(get, set, spec.seed !== undefined ? { seed: spec.seed } : { order: spec.order });
  },

  /**
   * Draw from stock to waste. No-op if stock is empty (UI should offer recycle).
   */
  drawFromStock: () => {
    const { state } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return;
    if (get().autoCompleting) return;
    if (state.stock.length === 0) return;
    // Only block while the stock/waste pair is itself animating (a draw slides a
    // card stock→waste). Other, unrelated moves don't block drawing.
    const { animatingLocs } = useUiStore.getState();
    if (animatingLocs.has('stock') || animatingLocs.has('waste')) return;
    const drawnId = state.stock[state.stock.length - 1].id;
    const tid = captureFlip('draw', [drawnId]);
    useUiStore.getState().beginTransition(tid, [drawnId], ['stock', 'waste']);
    const next = applyMove(state, { type: 'draw' });
    set({ state: next, lastActionMeta: { type: 'draw' } });
    useUiStore.getState().clearHints();
    useStatsStore.getState().startTimerIfValid(state);
    useStatsStore.getState().addMoves(1);
    if (next.stock.length === 0 && !isWon(next)) {
      checkDeadEnd(get, set, next);
    }
  },

  /**
   * Recycle waste back into the stock.
   */
  recycleStock: () => {
    const { state } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return;
    if (get().autoCompleting) return;
    // Recycle slides every waste card back into the stock, so block only while
    // the stock/waste pair is already animating.
    const { animatingLocs } = useUiStore.getState();
    if (animatingLocs.has('stock') || animatingLocs.has('waste')) return;
    const movingIds = state.waste.map((c) => c.id);
    const tid = captureFlip('recycle', movingIds);
    useUiStore.getState().beginTransition(tid, movingIds, ['stock', 'waste']);
    set({ state: applyMove(state, { type: 'recycle' }), lastActionMeta: { type: 'recycle' } });
    useUiStore.getState().clearHints();
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
    const { state } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return false;
    if (get().autoCompleting) return false;
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
    // Manual drag-and-drop: the DragOverlay already showed the card in hand at
    // the drop target, so don't snapshot/capture a slide from the source pile
    // (that would make the real card jump back and re-slide). Just snap it into
    // the destination and skip the animating lock so the next move is immediate.
    if (opts.metaType === 'drag') {
      set({ state: next, lastActionMeta: { type: 'move' } });
      useUiStore.getState().clearHints();
      useStatsStore.getState().startTimerIfValid(state);
      useStatsStore.getState().addMoves(1);
      if (next.stock.length === 0 && !isWon(next)) {
        checkDeadEnd(get, set, next);
      }
      return true;
    }
    const tid = captureFlip(opts.metaType ?? 'move', moveIds);
    useUiStore.getState().beginTransition(tid, moveIds, [to]);
    set({ state: next, lastActionMeta: { type: opts.metaType ?? 'move' } });
    useUiStore.getState().clearHints();
    useStatsStore.getState().startTimerIfValid(state);
    useStatsStore.getState().addMoves(1);
    if (next.stock.length === 0 && !isWon(next)) {
      checkDeadEnd(get, set, next);
    }
    return true;
  },

  undo: () => {
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    const { state } = get();
    if (get().autoCompleting) return;
    if (state.moveHistory.length === 0 || useStatsStore.getState().isOver) return;
    // Undo doesn't animate and would corrupt an in-flight tween, so block it
    // whenever any card is still moving.
    if (useUiStore.getState().animatingCards.size > 0) return;
    const next = coreUndo(state);
    set({ state: next, autoMoveState: {}, lastActionMeta: { type: 'undo' } });
    useUiStore.getState().clearHints();
    useStatsStore.getState().addMoves(1);
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
    if (get().autoCompleting) return false;
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
    get().moveCard(from, chosen, cardId, { metaType: 'move' });
    return true;
  },

  /**
   * Auto-complete: greedily move every visible, top-most card (waste top and
   * face-up tableau tops) onto a valid foundation until no more such moves
   * exist. Moves are paced one at a time per MOTION.autoComplete (mode + step
   * delay) so the user sees the cards arrive. Each move is a
   * normal history entry, so Undo steps back through them individually.
   *
   * Only one auto-complete may run at a time; any user action (deal / move /
   * undo) cancels the in-progress animation via clearAutoCompleteTimer.
   *
   * @returns {boolean} whether at least one move was started
   */
  autoComplete: (force = false) => {
    useUiStore.getState().clearHints();
    if (autoCompleteTimer !== null) return false;
    if (isWon(get().state) || useStatsStore.getState().isOver) return false;
    // User-initiated auto-complete is blocked while an animation is in flight
    // (no interaction during animation). The automatic trigger from an
    // obvious-win state passes force:true because that state is reached BY an
    // animating move, and the running sequence keeps the lock held itself.
    if (!force && useUiStore.getState().animatingCards.size > 0) return false;

    const state = get().state;

    // Hard lock: auto-complete must never shuffle cards between tableau columns.
    // Prove a full win using FOUNDATION moves only (draw/recycle of stock/waste
    // are still permitted for plain peeling, but no tableau→tableau relocation).
    // If no such win is provable (e.g. a buried card can only be exposed by
    // parking a run elsewhere), silently fall back to the greedy foundation loop
    // and leave the board to the player — no column bounces, no stall. Drawing
    // through stock/waste is allowed here (the manual trigger may have cards to
    // peel); the auto-trigger additionally forbids recycling (see Board.jsx).
    set({ autoCompleting: true });
    const run = autoCompleteRunId;
    // Hidden cards remain somewhere in the tableau: there is no point paying for
    // the expensive worker solver (it can't prove a full win with unknown stock
    // order), so peel the safe foundation moves instantly via the greedy loop.
    // This skips the ~1s search delay on a fresh deal / mid-game double-tap and
    // matches the documented autoComplete gating. The solver is only worth
    // running once the tableau is fully revealed (see isAutoCompletable).
    if (!isAllTableauFaceUp(state)) {
      runGreedy(get, set);
      return true;
    }
    let solveResult;
    try {
      solveResult = solveAsync(state, { allowTableau: false, maxNodes: 200000, maxMs: 2000 });
    } catch {
      // The solver plumbing (worker creation / main-thread fallback) should
      // never throw, but if it somehow does, release the lock and peel the safe
      // foundation moves so the board stays usable and the run can be retried.
      set({ autoCompleting: false, autoCompletingToWin: false });
      runGreedy(get, set);
      return true;
    }
    const { promise, cancel } = solveResult;
    activeSolveCancel = cancel;
    promise.then((seq) => {
      activeSolveCancel = null;
      // A user action (deal/move/undo) may have cancelled us while the
      // worker was busy; if the run id changed, abandon the result entirely.
      if (run !== autoCompleteRunId) return;
      if (seq === STALE) {
        set({ autoCompleting: false, autoCompletingToWin: false });
        return;
      }
      if (Array.isArray(seq)) {
        // Strip redundant tableau shuffles (none should remain under the
        // allowTableau:false lock, but the compressor is defensive) so a stack
        // isn't bounced between piles during the auto-complete animation.
        // This is the genuine "to completion" run — flag it so the centered
        // "Autocomplete" banner shows for the duration of the winning line.
        set({ autoCompletingToWin: true });
        runWinSequence(get, set, compressWinningSequence(seq, state));
      } else {
        set({ autoCompleting: false, autoCompletingToWin: false });
        runGreedy(get, set);
      }
    });
    return true;
  },

  isWon: () => isWon(get().state),
  canUndo: () => !get().autoCompleting && get().state.moveHistory.length > 0,

  /**
   * Hint affordance: surface the currently-visible legal moves. Toggles — if
   * hints are already shown, calling again clears them. Computes the hints from
   * the live core state and pushes them to the UI store for highlighting, plus
   * an aria-live announcement so screen-reader users learn whether any move
   * exists ("N moves available" / "No moves available right now").
   */
  showHints: () => {
    if (get().autoCompleting) return;
    const ui = useUiStore.getState();
    if (ui.hints.length > 0) {
      ui.clearHints();
      ui.setAnnounce('Hints cleared');
      return;
    }
    const hints = findHints(get().state);
    ui.setHints(hints);
    ui.setAnnounce(
      hints.length > 0
        ? `Hint: ${hints.length} move${hints.length === 1 ? '' : 's'} available`
        : 'No moves available right now',
    );
  },
}));

/** Convenience selector for raw core state. */
export const selectGameState = (s) => s.state;
