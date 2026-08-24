// hooks/useUiStore.js
// Tiny UI-only store for keyboard accessibility: which card is "selected"
// (focused + highlighted) and a live-region announcement string for screen
// readers. Not part of core/GameState and not persisted.

import { create } from 'zustand';

// Module-level registry of transition-completion callbacks, keyed by transition
// id. The animation layer calls endTransition(tid) once a move's tween finishes;
// a caller awaiting whenTransitionDone(tid) is resolved then. Kept outside the
// store so awaiters don't need the store's set/get plumbing.
const transitionDone = new Map();

/**
 * Resolve when the transition with the given id finishes animating (i.e. when
 * endTransition(tid) is next called). Used by the auto-complete loop to chain
 * steps only after the previous step's tween fully completed, so no two steps
 * ever animate concurrently (which would cause visible jitter / "jumping").
 * @param {number} tid
 * @returns {Promise<void>}
 */
export function whenTransitionDone(tid) {
  return new Promise((resolve) => {
    transitionDone.set(tid, resolve);
  });
}

/** @internal fire any registered completion callback for a finished transition. */
function fireTransitionDone(tid) {
  const cb = transitionDone.get(tid);
  if (cb) {
    transitionDone.delete(tid);
    cb();
  }
}

export const useUiStore = create((set) => ({
  selectedCardId: null,
  announce: '',
  noMovesDialogOpen: false,

  // Currently-displayed move hints (set by the Hint affordance). Each entry is
  // { from, to, cardId } from core/hints.js. Empty when no hints are shown.
  hints: [],

  // True while a dnd-kit drag is in progress. Used to keep CardView's own
  // tap→auto-move from firing on the same gesture as a drag, which could
  // relocate/hide a card mid-drag and leave it stuck invisible. Not part of
  // core/GameState and not persisted.
  isDragging: false,

  /** Set the in-progress drag flag (shared between useDragEngine and CardView). */
  setIsDragging: (v) => set({ isDragging: v }),

  // Granular in-flight animation locks. Instead of a single global "board is
  // busy" flag, we track exactly which cards are currently moving and which
  // pile locators are busy as a destination. Components then block interaction
  // only for the cards/locators in these sets — so a normal move animates while
  // the rest of the board stays fully interactive. The win cascade uses
  // `fullLock` (set in winCascade.js) to block everything, and `won` already
  // blocks everything in the components regardless.
  animatingCards: new Set(),
  animatingLocs: new Set(),
  // Map of transition id → { cards:Set, locs:Set } so endTransition can release
  // exactly the cards/locs a finished move had reserved.
  activeTransitions: {},
  fullLock: false,

  /**
   * Reserve the cards/locators a transition is about to animate. Called by the
   * store action right before it mutates state (synchronously, so the lock is
   * held before React re-renders the new layout).
   * @param {number} tid  transition id from captureFlip
   * @param {string[]} cardIds  cards physically in flight
   * @param {string[]} locs  destination pile locators made busy
   */
  beginTransition: (tid, cardIds, locs) =>
    set((s) => {
      const cards = new Set(s.animatingCards);
      const locsSet = new Set(s.animatingLocs);
      cardIds.forEach((id) => cards.add(id));
      locs.forEach((l) => locsSet.add(l));
      return {
        animatingCards: cards,
        animatingLocs: locsSet,
        activeTransitions: { ...s.activeTransitions, [tid]: { cards: new Set(cardIds), locs: new Set(locs) } },
      };
    }),

  /**
   * Release the cards/locators reserved by a finished transition. Recomputes
   * the union sets from the remaining active transitions so concurrent moves
   * don't stomp on each other.
   * @param {number} tid
   */
  endTransition: (tid) =>
    set((s) => {
      const active = { ...s.activeTransitions };
      delete active[tid];
      const cards = new Set();
      const locsSet = new Set();
      Object.values(active).forEach((t) => {
        t.cards.forEach((id) => cards.add(id));
        t.locs.forEach((l) => locsSet.add(l));
      });
      fireTransitionDone(tid);
      return { animatingCards: cards, animatingLocs: locsSet, activeTransitions: active };
    }),

  /** Drop every in-flight transition (used on unmount / hard reset). */
  clearAllTransitions: () =>
    set({ animatingCards: new Set(), animatingLocs: new Set(), activeTransitions: {} }),

  /** Set the all-encompassing lock used by the win cascade / deal reset. */
  setFullLock: (v) => set({ fullLock: v }),

  // New Game mode-picker dialog state + the last mode chosen, so the "no valid
  // moves" recovery path can re-deal with the same mode without re-prompting.
  newGameDialogOpen: false,
  lastNewGameMode: 'winning', // 'winning' | 'random'

  // Options/settings modal (Theme / Deck / Hand).
  settingsDialogOpen: false,

  // Keyboard-shortcuts help modal (opened on top of the Settings modal).
  helpDialogOpen: false,

  // Statistics modal showing cumulative games-played/won, best score/time/moves.
  statsDialogOpen: false,

  // "Game Over" modal shown when a hard limit (60:00 or 999 moves) is hit.
  gameOverDialogOpen: false,

  // "Enter Seed" modal: user types a specific Winning-Deal seed number to
  // (re)start that exact, pre-verified solvable deal.
  seedInputDialogOpen: false,

  // Daily Challenge calendar modal: month/year navigation + per-day status and
  // a "Play" button that starts the selected day's deal. `dailyChallengeOrigin`
  // records what opened it so dismissal can return to the right place:
  //   - 'newgame' → closing returns to the New Game picker beneath it
  //   - 'win'     → closing leaves no modal (the Win modal already dismissed)
  dailyChallengeDialogOpen: false,
  dailyChallengeOrigin: 'newgame', // 'newgame' | 'win'

  // Win summary modal: shown when the game is won. Carries the just-finished
  // game's score/time/moves plus which of them beat the stored best (so the
  // modal can highlight new records). Populated by the win effect in Board.jsx.
  winDialogOpen: false,
  winSummary: null, // { score, timeMs, moves, newScore, newTime, newMoves }

  /** Mark a card as the keyboard-selected card. */
  selectCard: (id) => set({ selectedCardId: id }),

  /** Show/hide the "no valid moves remaining" dialog. */
  setNoMovesDialogOpen: (open) => set({ noMovesDialogOpen: open }),

  /** Show/hide the New Game mode-picker dialog. */
  setNewGameDialogOpen: (open) => set({ newGameDialogOpen: open }),

  /** Show/hide the options/settings dialog. */
  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),

  /** Show/hide the keyboard-shortcuts help dialog. */
  setHelpDialogOpen: (open) => set({ helpDialogOpen: open }),

  /** Show/hide the Statistics dialog. */
  setStatsDialogOpen: (open) => set({ statsDialogOpen: open }),

  /** Show/hide the Game Over dialog. */
  setGameOverDialogOpen: (open) => set({ gameOverDialogOpen: open }),

  /** Show/hide the "Enter Seed" dialog. */
  setSeedInputDialogOpen: (open) => set({ seedInputDialogOpen: open }),

  /** Show/hide the Daily Challenge calendar modal. */
  setDailyChallengeDialogOpen: (open) => set({ dailyChallengeDialogOpen: open }),

  /** Set which surface opened the Daily Challenge modal. */
  setDailyChallengeOrigin: (origin) => set({ dailyChallengeOrigin: origin }),

  /** Show the win summary modal with the given summary payload. */
  setWinDialog: (summary) => set({ winDialogOpen: true, winSummary: summary }),

  /** Dismiss the win summary modal. */
  closeWinDialog: () => set({ winDialogOpen: false }),

  /** Record which mode was last used, so the "no valid moves" recovery path can reuse it. */
  setLastNewGameMode: (mode) => set({ lastNewGameMode: mode }),

  // Which kind of game is currently being played, and (for daily challenges)
  // the calendar date string. Drives the top-left label and the Win modal's
  // "Return to Daily Challenge" affordance. Set by the deal actions in
  // useGameStore (winning / random / daily / event).
  currentGameKind: null, // 'winning' | 'random' | 'daily' | 'event' | null
  currentDailyDate: null, // YYYY-MM-DD when kind === 'daily'

  /**
   * Record the kind of game just dealt (and the daily date when relevant).
   * @param {'winning'|'random'|'daily'|'event'} kind
   * @param {string|null} [date]  the daily date when kind === 'daily'
   */
  setCurrentGame: (kind, date = null) => set({ currentGameKind: kind, currentDailyDate: date }),

  /** Clear the current selection (after a move or on new game). */
  clearSelection: () => set({ selectedCardId: null }),

  /** Show a set of move hints (replaces any currently shown). */
  setHints: (list) => set({ hints: list }),

  /** Clear all move hints. */
  clearHints: () => set({ hints: [] }),

  /** Update the aria-live announcement text. */
  setAnnounce: (text) => set({ announce: text }),
}));

/**
 * Whether any modal/dialog is currently open. Used to suppress global game
 * keyboard shortcuts (see Board.jsx) so typing in e.g. the Seed Input field
 * never triggers a game action.
 * @param {object} s  a useUiStore state snapshot
 * @returns {boolean}
 */
export const isAnyModalOpen = (s) =>
  s.newGameDialogOpen ||
  s.settingsDialogOpen ||
  s.helpDialogOpen ||
  s.statsDialogOpen ||
  s.noMovesDialogOpen ||
  s.gameOverDialogOpen ||
  s.seedInputDialogOpen ||
  s.winDialogOpen ||
  s.dailyChallengeDialogOpen;

/**
 * Locate the pile a card currently lives in.
 * @param {import('../core/GameState.js').GameState} state
 * @param {string} cardId
 * @returns {string|null} pile locator or null if not found
 */
export function findCardLocator(state, cardId) {
  for (let i = 0; i < state.tableau.length; i++) {
    if (state.tableau[i].some((c) => c.id === cardId)) return `tableau:${i}`;
  }
  if (state.waste.some((c) => c.id === cardId)) return 'waste';
  for (let i = 0; i < state.foundations.length; i++) {
    if (state.foundations[i].some((c) => c.id === cardId)) return `foundation:${i}`;
  }
  if (state.stock.some((c) => c.id === cardId)) return 'stock';
  return null;
}
