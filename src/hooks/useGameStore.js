// hooks/useGameStore.js
// Zustand store wiring UI to the framework-agnostic core.
// The store NEVER implements rules itself — it delegates to core/*.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { deal } from '../core/dealer.js';
import { applyMove, undo as coreUndo } from '../core/moveEngine.js';
import { canMoveToTableau, canMoveToFoundation, getTableauRun, getAutoMoveTargets, findFoundationMove, wouldGreedyComplete, DEST_ORDER } from '../core/rules.js';
import { isWon } from '../core/winDetection.js';
import { solveAsync, cancelAllSolves, STALE } from '../core/solverClient.js';
import { SOLVER_TIMEOUT, hasDeadEndMove, compressWinningSequence, isDrainedFoundationDeadEnd, isDeadEndCandidate } from '../core/solver.js';
import { findHints } from '../core/hints.js';
import { buildStandardDeck, shuffle } from '../core/Deck.js';
import { createEmptyGameState } from '../core/GameState.js';
import { randomSolvableSeed, pickSolvableSeed } from '../core/solvablePool.js';
import { randomUnusedSeed, knownSeedCount, buildKnownSet } from '../core/randomSeed.js';
import { seedForDate } from '../core/dailyChallenge.js';
import { getUsedRandomSeedsSet, addUsedRandomSeed, clearUsedRandomSeeds } from '../db/usedRandomSeeds.js';
import { getWinningPool, getDailyMap } from '../repo/seedRepository.js';
import { fetchAllEventSeeds } from '../repo/specialEventsRepository.js';
import { enqueueFlip } from '../render/animation/flipBridge.js';
import { enqueueParticle } from '../render/animation/particleBridge.js';
import { cancelDrawSlide } from '../render/animation/useStockDrawSlide.js';
import { cancelSlideTween } from '../render/animation/useCardMoveSlide.js';
import { cancelShake } from '../render/animation/playCardShake.js';
import { cancelWinCascade } from '../render/animation/winCascade.js';
import { triggerUncoverSparkle } from '../render/animation/useUncoverSparkle.js';
import { shouldFireUncoverSparkle } from '../render/animation/shouldFireUncoverSparkle.js';
import { MOTION } from '../render/animation/motion.js';
import i18n from '../i18n/index.js';
import { useUiStore, whenTransitionDone, warnDealBlocked } from './useUiStore.js';
import { useStatsStore } from './useStatsStore.js';
import { useStatisticsStore } from './useStatisticsStore.js';
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
    // Iterate the moved ids directly instead of scanning the full DOM and
    // filtering — O(moved) instead of O(all cards).
    for (const id of animIds) {
      const el = document.querySelector(`[data-flip-id="${CSS.escape(id)}"]`);
      if (el) rects.set(id, el.getBoundingClientRect());
    }
  }
  return enqueueFlip(type, rects);
}

// Evaluate whether the current position is a genuine dead end and show/hide the
// "No More Moves" modal accordingly. Called after every state mutation so the
// modal is reliable regardless of which action reached the position.
//
// The rule (the "when" to show the modal): show it ONLY when the board is fully
// drained — the stock AND the waste are both empty — and no immediate move exists.
// That is the sole moment the player truly has no action left, so "No More Moves"
// is literally true. While any card remains in the stock (a draw is available) or
// in the waste (a recycle-then-draw is always available, and may surface a
// playable card such as a King onto an empty column), the player is not out of
// options, so the modal stays hidden and the solver is skipped.
//
// For a fully-drained position we then ask the off-thread solver whether a
// *winning line* is still reachable. The detector proves a dead end only when the
// solver exhausts the reachable space with NO winning line — i.e. the position
// cannot be completed, even though some pointless shuffles (e.g. a foundation
// retreat, or a waste card onto a same-color-clamped run) may still be legal.
// Such shuffles must NOT keep the game "alive": a fully-drained position whose
// only moves are unwinnable tableau/foundation reshuffles is a genuine dead end.
// A budget-exceeded (unknown) result never asserts a dead end. The result is
// ignored if the board has changed in the meantime (reference guard) or the solve
// was superseded (STALE).
function evaluateDeadEnd(get, set, state) {
  // A won game is never a dead end.
  if (isWon(state)) {
    useUiStore.getState().setNoMovesDialogOpen(false);
    return;
  }
  // Undoing is deliberate backward navigation; never surface the no-moves modal
  // as a consequence of an undo (the player may be mid-reversal, re-drawing or
  // recycling the stock). Only forward actions (draw/recycle/move/auto/deal) may
  // open it. lastActionMeta lives on the store, NOT on the core GameState passed
  // in as `state`, so it must be read via get().
  if (get().lastActionMeta?.type === 'undo') {
    return;
  }
  // The "No More Moves" modal is only a candidate once the board is fully drained
  // (stock AND waste empty) with no immediate move available: that is the only
  // moment the player truly has no action left. While any card remains in the
  // stock (a draw is available) or in the waste (a recycle-then-draw is always
  // available, and may expose a playable card), the player is not out of options —
  // never surface the modal, and skip the expensive solver.
  if (!isDeadEndCandidate(state)) {
    useUiStore.getState().setNoMovesDialogOpen(false);
    return;
  }
  // Edge case: fully drained (stock AND waste empty) with the last move being a
  // foundation play from a visible source (waste or a tableau column). This is
  // the classic "solved-or-stuck, nothing left to draw" moment — decide it
  // immediately and synchronously so the modal is deterministic and never lost
  // to an async worker round-trip. When the drained board's last move was NOT a
  // foundation play, this returns null and we fall through to the general (async)
  // solver below.
  const drained = isDrainedFoundationDeadEnd(state);
  if (drained !== null) {
    useUiStore.getState().setNoMovesDialogOpen(drained === true);
    return;
  }
  const captured = state; // each action mints a fresh state object
  const { promise } = solveAsync(state, { maxNodes: 500000, maxMs: 4000, goal: 'win' });
  promise.then((seq) => {
    if (seq === STALE) return;
    if (get().state !== captured) return; // state moved on; ignore stale result
    if (get().lastActionMeta?.type === 'undo') return; // never assert dead-end after undo
    if (seq === SOLVER_TIMEOUT) {
      // Budget exceeded — unknown. Never assert a dead end on an unknown result.
      return;
    }
    if (seq) {
      // A winning line is reachable through legal play — not stuck.
      useUiStore.getState().setNoMovesDialogOpen(false);
    } else {
      // Search fully exhausted with no winning line reachable — a genuine dead end.
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
function runAnimatedDeal(get, set, { seed, order, deck, kind, date, eventDealId, eventId, eventTitle } = {}) {
  const usedDeck = deck ? deck.slice() : order ? order.slice() : shuffle(buildStandardDeck(), seed);
  const preDeal = preDealFromDeck(usedDeck, seed);
  // Replay preserves the originating game kind (date for Daily, deal id for
  // Special Events) so a replayed Random deal stays labeled "Random", is never
  // misclassified as Winning, and a resumed Event deal still reports the right
  // deal id on win.
  const replaySpec = {
    ...(seed !== undefined ? { seed } : { order: usedDeck.map((c) => ({ ...c })) }),
    kind,
    date,
    eventDealId,
    eventId,
    eventTitle,
  };
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
    useStatsStore.getState().recordMove({
      from: move.from,
      to: move.to,
      card: findCardInState(cur, move.cardIds[0]),
    });
  } else if (move.type === 'draw') {
    const drawn = cur.stock[cur.stock.length - 1];
    animIds = drawn ? [drawn.id] : [];
    destLocs = ['waste'];
  } else if (move.type === 'recycle') {
    animIds = cur.waste.map((c) => c.id);
    destLocs = ['stock'];
    useStatsStore.getState().recordRecycle();
  }
  // Enqueue as 'auto' (the type useCardMoveSlide actually consumes) so the tween
  // starts and endTransition releases the lock. The animIds/destLocs above are
  // still derived from the real move.type to avoid the undefined-cardIds crash.
  const tid = captureFlip('auto', animIds);
  useUiStore.getState().beginTransition(tid, animIds, destLocs);
  set({ state: next, autoMoveState: {}, lastActionMeta: { type: 'auto' } });
  // Burst particles when an auto step lands a card on a foundation (covers both
  // the greedy peel and every step of the solver win sequence).
  if (move.type === 'moveCards' && move.to.startsWith('foundation')) {
    const card = findCardInState(cur, move.cardIds[0]);
    if (card) enqueueParticle(card.suit, move.to);
  }
  // Uncover Sparkle is suppressed during auto-complete (the win cascade +
  // confetti provide the celebration; per-step sparkles would be visual
  // noise). Pass 'auto' so the helper short-circuits — see
  // shouldFireUncoverSparkle.js.
  shouldFireUncoverSparkle({
    moveRecord: next.moveHistory[next.moveHistory.length - 1],
    actionType: 'auto',
    trigger: triggerUncoverSparkle,
  });
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
      // The run finished with nothing left to play — re-evaluate for a dead end
      // (a greedy peel can exhaust every safe foundation move and leave a stuck
      // board, which the per-step applyAutoStep path does not check).
      evaluateDeadEnd(get, set, get().state);
      return;
    }
    const more = hasNext();
    if (!more) {
      // Final step: always wait for its tween to land before releasing the lock.
      await awaitStepDone(tid);
      if (run !== autoCompleteRunId) return;
      autoCompleteTimer = null;
      set({ autoCompleting: false, autoCompletingToWin: false });
      // The run finished with nothing left to play — re-evaluate for a dead end.
      evaluateDeadEnd(get, set, get().state);
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

/** Find a card by id anywhere in a GameState (used to read a card's suit). */
function findCardInState(s, cardId) {
  const piles = [s.stock, s.waste, ...s.foundations, ...s.tableau];
  for (const pile of piles) {
    const found = pile.find((c) => c.id === cardId);
    if (found) return found;
  }
  return null;
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

export const useGameStore = create(subscribeWithSelector((set, get) => ({
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
  dealNewGame: async (mode = 'random') => {
    useUiStore.getState().dismissNoHintsBanner();
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().closeWinDialog();
    useUiStore.getState().clearHints();
    useStatisticsStore.getState().finalizeGame();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size + useUiStore.getState().slidingCards.size > 0) { warnDealBlocked('dealNewGame'); return; }
    useUiStore.getState().setLastNewGameMode(mode);
    useStatsStore.getState().resetStats();
    let seed;
    if (mode === 'winning') {
      const pool = await getWinningPool();
      const { seed: s, exhausted } = pickSolvableSeed(useSeedStore.getState().playedSeeds, pool);
      if (exhausted) useSeedStore.getState().resetPlayed();
      seed = s;
    } else {
      const [pool, dailyMap, events] = await Promise.all([getWinningPool(), getDailyMap(), fetchAllEventSeeds()]);
      const known = buildKnownSet({ winningPool: pool, dailyMap, events });
      const used = getUsedRandomSeedsSet();
      if (used.size >= 0x100000000 - knownSeedCount(known)) clearUsedRandomSeeds();
      const s = randomUnusedSeed(getUsedRandomSeedsSet(), known);
      addUsedRandomSeed(s);
      seed = s;
    }
    useUiStore.getState().setCurrentGame(mode);
    runAnimatedDeal(get, set, { seed, kind: mode });
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
    // Finalize the game we're replacing: a non-win in progress ends the streak.
    useStatisticsStore.getState().finalizeGame();
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().clearHints();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size + useUiStore.getState().slidingCards.size > 0) { warnDealBlocked('dealWithSeed'); return; }
    useUiStore.getState().setLastNewGameMode('winning');
    useStatsStore.getState().resetStats();
    useUiStore.getState().setCurrentGame('winning');
    runAnimatedDeal(get, set, { seed, kind: 'winning' });
  },

  /**
   * Deal the Daily Challenge for a specific calendar date (YYYY-MM-DD). The seed
   * is fetched from Supabase (cached 24h, fallback to bundled JSON).
   *
   * @param {string} date
   * @returns {Promise<boolean>} whether the game was dealt
   */
  dealDaily: async (date) => {
    useUiStore.getState().dismissNoHintsBanner();
    const dailyMap = await getDailyMap();
    const seed = seedForDate(date, dailyMap);
    if (seed == null) return false;
    cancelAutoComplete(set);
    useStatisticsStore.getState().finalizeGame();
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().clearHints();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size + useUiStore.getState().slidingCards.size > 0) { warnDealBlocked('dealDaily'); return false; }
    useUiStore.getState().setLastNewGameMode('winning');
    useStatsStore.getState().resetStats();
    useUiStore.getState().setCurrentGame('daily', date);
    runAnimatedDeal(get, set, { seed, kind: 'daily', date });
    return true;
  },

  /**
   * Deal a specific Special Events grid deal. Unlike the other curated deal
   * modes, the caller already knows the exact seed and deal id (from the
   * reveal grid) — there's no pool/index lookup. `eventDealId` rides along in
   * replaySpec/currentEventDealId so a win can still be attributed to the
   * right row in event_deal_progress even if the app is closed and reopened
   * before the deal is finished.
   *
   * @param {number} seed
   * @param {number} eventDealId  special_event_deals.id
   * @param {string} [eventId]  special_events.id (for reload survival of the win-ribbon / Return button)
   * @param {string} [eventTitle]  human title (same)
   */
  dealSpecialEventDeal: (seed, eventDealId, eventId = null, eventTitle = null) => {
    cancelAutoComplete(set);
    useStatisticsStore.getState().finalizeGame();
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().clearHints();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size + useUiStore.getState().slidingCards.size > 0) { warnDealBlocked('dealSpecialEventDeal'); return; }
    useUiStore.getState().setLastNewGameMode('winning');
    useStatsStore.getState().resetStats();
    useUiStore.getState().setCurrentGame('event', null, eventDealId);
    if (eventId) useUiStore.getState().setCurrentEventMeta(eventId, eventTitle);
    runAnimatedDeal(get, set, { seed, kind: 'event', eventDealId, eventId, eventTitle });
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
    if (useUiStore.getState().animatingCards.size + useUiStore.getState().slidingCards.size > 0) { warnDealBlocked('initialDeal'); return; }
    useUiStore.getState().setLastNewGameMode('winning');
    useStatsStore.getState().resetStats();
    useUiStore.getState().setCurrentGame('winning');
    runAnimatedDeal(get, set, { seed: INITIAL_SEED, deck: INITIAL_DECK, kind: 'winning' });
  },

  /** Replay a persisted deal that had not started before the page closed. */
  replayRestoredDeal: (spec) => {
    if (!spec || (spec.seed === undefined && !Array.isArray(spec.order))) return false;
    const kind = spec.kind ?? (Array.isArray(spec.order) ? 'random' : 'winning');
    const date = kind === 'daily' ? (spec.date ?? null) : null;
    const eventDealId = kind === 'event' ? (spec.eventDealId ?? null) : null;
    const eventId = kind === 'event' ? (spec.eventId ?? null) : null;
    const eventTitle = kind === 'event' ? (spec.eventTitle ?? null) : null;
    runAnimatedDeal(
      get,
      set,
      spec.seed !== undefined
        ? { seed: spec.seed, kind, date, eventDealId, eventId, eventTitle }
        : { order: spec.order, kind, date, eventDealId, eventId, eventTitle },
    );
    return true;
  },

  /**
   * Restart the current game identically. Uses the captured `replaySpec`:
   *  - Winning Deal (seed)   → re-deal with the same seed.
   *  - Random Shuffle (order)→ re-deal with the exact same card order.
   * Falls back to dealNewGame(lastNewGameMode) if no spec is recorded.
   */
  replayGame: () => {
    useUiStore.getState().dismissNoHintsBanner();
    const spec = get().replaySpec;
    if (!spec) {
      get().dealNewGame(useUiStore.getState().lastNewGameMode);
      return;
    }
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    useUiStore.getState().closeWinDialog();
    useUiStore.getState().clearHints();
    // Finalize the game we're replacing: a non-win ends the streak (best kept).
    useStatisticsStore.getState().finalizeGame();
    cancelWinCascade();
    if (useUiStore.getState().animatingCards.size + useUiStore.getState().slidingCards.size > 0) { warnDealBlocked('replayGame'); return; }
    // Preserve the originating kind (and date for Daily) captured at deal time,
    // rather than inferring it from seed presence — a Random deal now carries a
    // seed too, so seed-presence would wrongly label it a Winning Deal.
    const kind = spec.kind || (spec.seed !== undefined ? 'winning' : 'random');
    const date = spec.date || null;
    useUiStore.getState().setLastNewGameMode(kind === 'random' ? 'random' : 'winning');
    useUiStore.getState().setCurrentGame(kind, date, spec.eventDealId);
    if (kind === 'event' && spec.eventId) useUiStore.getState().setCurrentEventMeta(spec.eventId, spec.eventTitle);
    useStatsStore.getState().resetStats();
    runAnimatedDeal(
      get,
      set,
      spec.seed !== undefined ? { seed: spec.seed, kind, date, eventDealId: spec.eventDealId, eventId: spec.eventId, eventTitle: spec.eventTitle } : { order: spec.order, kind, date, eventDealId: spec.eventDealId, eventId: spec.eventId, eventTitle: spec.eventTitle },
    );
  },

  /**
   * Draw from stock to waste. No-op if stock is empty (UI should offer recycle).
   */
  drawFromStock: () => {
    useUiStore.getState().dismissNoHintsBanner();
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
    evaluateDeadEnd(get, set, next);
  },

  /**
   * Recycle waste back into the stock.
   */
  recycleStock: () => {
    useUiStore.getState().dismissNoHintsBanner();
    const { state } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return;
    if (get().autoCompleting) return;
    // Klondike rule: the waste may only be recycled back into the stock when the
    // stock is empty. If the stock is non-empty, a draw is still available, so a
    // recycle is illegal — ignore it rather than merging waste into stock.
    if (state.stock.length > 0) return;
    // Recycle slides every waste card back into the stock, so block only while
    // the stock/waste pair is already animating.
    const { animatingLocs } = useUiStore.getState();
    if (animatingLocs.has('stock') || animatingLocs.has('waste')) return;
    const movingIds = state.waste.map((c) => c.id);
    useStatsStore.getState().recordRecycle();
    const tid = captureFlip('recycle', movingIds);
    useUiStore.getState().beginTransition(tid, movingIds, ['stock', 'waste']);
    set({ state: applyMove(state, { type: 'recycle' }), lastActionMeta: { type: 'recycle' } });
    evaluateDeadEnd(get, set, get().state);
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
    useUiStore.getState().dismissNoHintsBanner();
    cancelAutoComplete(set);
    const { state } = get();
    if (isWon(state) || useStatsStore.getState().isOver) return false;
    if (get().autoCompleting) return false;
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

    // Rules validity (pure, state-only — independent of any in-flight animation).
    const destPile = readPile(state, to);
    // Foundations accept only a single card; tableau accepts a run.
    const valid =
      to.startsWith('foundation')
        ? moveIds.length === 1 && canMoveToFoundation(movingCard, destPile)
        : canMoveToTableau(movingCard, destPile);
    if (!valid) return false;

    // Granular blocking: only refuse if the destination (or a pile currently
    // receiving another card) is busy, or if any moved card is still in flight
    // on an UNRELATED animation. The source pile stays interactive so the rest
    // of the board can be played during an unrelated animation.
    const { animatingCards, animatingLocs, slidingCards, shakingCards } = useUiStore.getState();
    if (animatingLocs.has(to) || animatingLocs.has(from)) return false;
    if (moveIds.some((id) => animatingCards.has(id))) return false;

    // The move is genuinely applicable. If any moved card is mid-draw-slide or
    // mid-shake, cancel that animation now (releasing its lock) so this move's
    // own transition can take over. This runs ONLY after the validity + non-busy
    // checks above passed, so a tap on a sliding/shaking card with no real move
    // does NOTHING — the slide/shake keeps running rather than snapping into
    // place or re-triggering.
    moveIds.forEach((id) => {
      if (slidingCards.has(id)) cancelDrawSlide(id);
      if (shakingCards.has(id)) cancelShake(id);
    });

    const next = applyMove(state, { type: 'moveCards', from, to, cardIds: moveIds });
    useStatsStore.getState().recordMove({ from, to, card: movingCard });
    // Burst particles from the foundation the card just reached (manual drag and
    // tap auto-move both land here). The animation layer reads this after commit.
    if (to.startsWith('foundation')) {
      enqueueParticle(movingCard.suit, to);
    }
    // Manual drag-and-drop: the DragOverlay already showed the card in hand at
    // the drop target, so don't snapshot/capture a slide from the source pile
    // (that would make the real card jump back and re-slide). Just snap it into
    // the destination and skip the animating lock so the next move is immediate.
    if (opts.metaType === 'drag') {
      set({ state: next, lastActionMeta: { type: 'move' } });
      shouldFireUncoverSparkle({
        moveRecord: next.moveHistory[next.moveHistory.length - 1],
        actionType: 'move',
        trigger: triggerUncoverSparkle,
      });
      useUiStore.getState().clearHints();
      useStatsStore.getState().startTimerIfValid(state);
      useStatsStore.getState().addMoves(1);
      evaluateDeadEnd(get, set, next);
      return true;
    }
    const tid = captureFlip(opts.metaType ?? 'move', moveIds);
    useUiStore.getState().beginTransition(tid, moveIds, [to]);
    set({ state: next, lastActionMeta: { type: opts.metaType ?? 'move' } });
    shouldFireUncoverSparkle({
      moveRecord: next.moveHistory[next.moveHistory.length - 1],
      actionType: 'move',
      trigger: triggerUncoverSparkle,
    });
    useUiStore.getState().clearHints();
    useStatsStore.getState().startTimerIfValid(state);
    useStatsStore.getState().addMoves(1);
    evaluateDeadEnd(get, set, next);
    return true;
  },

  undo: () => {
    useUiStore.getState().dismissNoHintsBanner();
    cancelAutoComplete(set);
    useUiStore.getState().setNoMovesDialogOpen(false);
    const { state } = get();
    if (get().autoCompleting) return null;
    if (state.moveHistory.length === 0 || useStatsStore.getState().isOver) return null;
    // No longer a hard guard on animatingCards/slidingCards: the user can
    // undo a move while its slide tween is still in flight. We cancel the
    // specific tween(s) for the affected cards below, which kills the
    // timeline WITHOUT firing its onComplete and leaves the inline x/y
    // transform on the node. The next snapshot (captureFlip below) then
    // reads the live mid-slide position via getBoundingClientRect() and
    // the undo tween animates from "where the card is right now" back to
    // its origin pile. Other in-flight tweens (for cards NOT being
    // undone) are left untouched and keep their locks.
    const last = state.moveHistory[state.moveHistory.length - 1];
    useStatsStore.getState().recordUndo();
    if (last.type === 'moveCards') {
      useStatsStore.getState().recordMove({
        from: last.to,
        to: last.from,
        card: findCardInState(state, last.cardIds[0]),
      });
    }
    let undoIds = [];
    let undoDest = [];
    if (last.type === 'moveCards') {
      undoIds = last.cardIds.slice();
      undoDest = [last.from];
    } else if (last.type === 'draw') {
      const returned = state.waste[state.waste.length - 1];
      undoIds = returned ? [returned.id] : [];
      undoDest = ['stock'];
    } else if (last.type === 'recycle') {
      undoIds = state.stock.map((c) => c.id);
      undoDest = ['waste'];
    }
    // Cancel any in-flight slide/draw tween that targets one of the cards
    // we are about to undo. The killed tween's inline x/y transform stays
    // on the node, so the snapshot's getBoundingClientRect() reads the
    // live mid-slide position. The matching destination-pile lock is
    // released by endTransition() inside cancelSlideTween. Other in-
    // flight tweens (for cards NOT in undoIds) keep running and keep
    // their locks.
    if (undoIds.length > 0) {
      try { cancelSlideTween(undoIds); } catch {}
      // For draw undos the card may still be on the useStockDrawSlide
      // timeline (its own registry). cancelDrawSlide kills the tween,
      // leaves the inline transform, and releases the slide lock so
      // captureFlip can re-begin.
      try {
        for (const id of undoIds) cancelDrawSlide(id);
      } catch {}
    }
    const next = coreUndo(state);
    let tid = null;
    if (undoIds.length > 0) {
      tid = captureFlip('undo', undoIds);
      useUiStore.getState().beginTransition(tid, undoIds, undoDest);
    }
    set({ state: next, autoMoveState: {}, lastActionMeta: { type: 'undo' } });
    evaluateDeadEnd(get, set, next);
    useUiStore.getState().clearHints();
    useStatsStore.getState().addMoves(1);
    useStatsStore.getState().addUndos(1);
    return tid;
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
    useUiStore.getState().dismissNoHintsBanner();
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
   * @param {boolean} [force]  bypass the in-flight-animation guard (used by the
   *   automatic trigger, which reaches the state via an animating move).
   * @param {{ seq?: Array<object> }} [opts]  when `seq` (a proven winning move
   *   list) is supplied, the store runs THAT sequence directly instead of
   *   re-solving — this is how the Board auto-trigger hands over the line it
   *   already proved (so the no-recycle / no-column-shuffle guarantees it proved
   *   are preserved, and we don't pay for a second worker solve).
   * @returns {boolean} whether at least one move was started
   */
  autoComplete: (force = false, opts = {}) => {
    useUiStore.getState().dismissNoHintsBanner();
    useUiStore.getState().clearHints();
    if (autoCompleteTimer !== null) return false;
    if (isWon(get().state) || useStatsStore.getState().isOver) return false;
    // User-initiated auto-complete is blocked while an animation is in flight
    // (no interaction during animation). The automatic trigger from an
    // obvious-win state passes force:true because that state is reached BY an
    // animating move, and the running sequence keeps the lock held itself.
    if (!force && useUiStore.getState().animatingCards.size + useUiStore.getState().slidingCards.size > 0) { warnDealBlocked('autoComplete'); return false; }

    const state = get().state;

    // Fast path: a pre-proven winning sequence was handed in (the auto-trigger
    // already proved it with the foundation-only / no-recycle solver options).
    // Run it directly as the "to completion" run — this is the ONLY path that
    // sets `autoCompletingToWin`, so the centered banner appears for the whole
    // winning line. No re-solve, no chance of a recycle slipping back in.
    if (opts && Array.isArray(opts.seq)) {
      set({ autoCompleting: true, autoCompletingToWin: true });
      runWinSequence(get, set, compressWinningSequence(opts.seq, state));
      return true;
    }

    // Manual trigger (double-click / 'a' key / toolbar button): peel every
    // currently-playable foundation move from the waste top and the face-up
    // tableau tops. This is foundation-only and NEVER draws from or recycles the
    // stock — the stock must never be touched automatically. The full
    // "to completion" run (with the centered banner) is handled exclusively by
    // the automatic trigger in Board.jsx, which only fires when the stock is
    // empty AND a foundation-only win is provable, and hands the proven sequence
    // in via `opts.seq` above. If this greedy peel happens to empty the board
    // (or reach a stock-empty, foundation-only-winnable state), the Board effect
    // re-evaluates and takes over the to-completion run with the banner.
    // Show the banner whenever this peel will actually finish the game, so a
    // double-click that completes the board still gets the "Autocomplete" label.
    if (wouldGreedyComplete(state)) set({ autoCompletingToWin: true });
    runGreedy(get, set);
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
    useStatsStore.getState().markHintUsed();
    const ui = useUiStore.getState();
    if (ui.hints.length > 0) {
      ui.clearHints();
      ui.setAnnounce(i18n.t('board.hintsCleared'));
      return;
    }
    const hints = findHints(get().state);
    if (hints.length === 0) {
      // The current visible board has no moves the hint system recognizes —
      // show the transient "No hints available" banner (it self-dismisses after
      // 3s and won't restart if the hint action is re-triggered while up).
      ui.showNoHintsBanner();
      ui.setAnnounce(i18n.t('board.noMoves'));
      return;
    }
    ui.setHints(hints);
    ui.setAnnounce(i18n.t('board.hintAvailable', {count: hints.length}));
  },
})));

/** Convenience selector for raw core state. */
export const selectGameState = (s) => s.state;
