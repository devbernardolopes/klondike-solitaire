// hooks/useStatsStore.js
// In-memory game session stats: moves, score, and the play timer.
// Not persisted to the DB (per product decision). The timer is timestamp-based
// and PAUSES when the tab loses focus: hidden time is excluded via a running
// `pausedAccumMs` + `pausedAt` pair, so the displayed elapsed (recomputed from
// real wall-clock timestamps) reflects only actively-focused play time.

import { create } from 'zustand';
import { hasAnyValidMove } from '../core/rules.js';
import { useStatisticsStore } from './useStatisticsStore.js';

// Hard limits that end the game. Reaching either freezes the session so only a
// new game can continue (timer stops, moves stop, interactions lock).
export const MAX_TIME_MS = 60 * 60 * 1000; // 60:00
export const MAX_MOVES = 999;

export const useStatsStore = create((set, get) => ({
  moves: 0,
  score: 0, // not implemented yet — stays 0
  startTime: null, // epoch ms when the clock started (first valid interaction)
  endTime: null, // epoch ms when the clock stopped (on win or limit)
  isOver: false, // true once a limit is hit — locks all interaction
  overReason: null, // 'time' | 'moves' — which limit ended the game
  // Focus-loss pause bookkeeping: `pausedAt` is the epoch ms at which the tab
  // became hidden while the clock was running (null when focused), and
  // `pausedAccumMs` is the total hidden time already folded in. Elapsed is
  // always `now - startTime` minus this excluded span.
  pausedAt: null,
  pausedAccumMs: 0,

  /** Reset all stats for a fresh game. */
  resetStats: () =>
    set({
      moves: 0,
      score: 0,
      startTime: null,
      endTime: null,
      isOver: false,
      overReason: null,
      pausedAt: null,
      pausedAccumMs: 0,
    }),

  /**
   * Pause/resume the clock in step with tab focus. Called on `visibilitychange`
   * (and once on mount). When the tab is hidden while the clock runs we record
   * `pausedAt`; when it becomes visible again we fold the hidden span into
   * `pausedAccumMs` so it is excluded from elapsed time. A frozen/stopped clock
   * is unaffected (it has no live running time to pause).
   * @param {boolean} focused  true when the tab is visible/focused
   */
  setFocused: (focused) => {
    const { startTime, endTime, isOver, pausedAt, pausedAccumMs } = get();
    if (startTime === null || endTime !== null || isOver) {
      // Nothing live to pause. Clear any stale marker defensively.
      if (pausedAt !== null) set({ pausedAt: null });
      return;
    }
    if (!focused) {
      if (pausedAt === null) set({ pausedAt: Date.now() });
    } else if (pausedAt !== null) {
      const accumulated = pausedAccumMs + (Date.now() - pausedAt);
      set({ pausedAt: null, pausedAccumMs: accumulated });
    }
  },

  /**
   * Elapsed actively-focused play time in ms (excludes hidden spans). Clamped to
   * >= 0. `now` defaults to Date.now() but callers may pass a tick timestamp so
   * the value is consistent with a render pass.
   * @param {number} [now]
   * @returns {number}
   */
  getElapsedMs: (now = Date.now()) => {
    const { startTime, endTime, pausedAt, pausedAccumMs } = get();
    if (startTime === null) return 0;
    const end = endTime ?? now;
    const paused = pausedAccumMs + (pausedAt !== null ? now - pausedAt : 0);
    return Math.max(0, end - startTime - paused);
  },

  /**
   * Freeze the session: lock interaction and stop the clock. The 999th move is
   * still applied before this fires (caller increments first), so the counter
   * reads exactly MAX_MOVES. For the time limit we pin endTime so the display
   * reads exactly 60:00 rather than a slightly-over 250ms-tick value.
   * @param {'time'|'moves'} reason
   */
  freeze: (reason) => {
    const { isOver, startTime, endTime } = get();
    // The clock already stopped (a win pinned endTime) — never let a hard limit
    // overwrite the win state and flip isOver on.
    if (isOver || endTime !== null) return;
    // Fold any in-progress focus pause before pinning the end time so the final
    // elapsed reflects only actively-focused play.
    if (get().pausedAt !== null) get().setFocused(true);
    set({ isOver: true, overReason: reason });
    if (startTime !== null && endTime === null) {
      set({ endTime: reason === 'time' ? startTime + MAX_TIME_MS : Date.now() });
    }
  },

  /**
   * Called on each timer tick to freeze once elapsed crosses the time limit.
   * Uses paused-adjusted elapsed so hidden time never counts toward the limit.
   */
  checkTimeLimit: () => {
    const { isOver, startTime, endTime } = get();
    // Don't re-evaluate the time limit once the clock has stopped — a win pins
    // endTime without setting isOver, so isOver alone is not enough to bail out.
    if (isOver || startTime === null || endTime !== null) return;
    if (get().getElapsedMs() >= MAX_TIME_MS) get().freeze('time');
  },

  /**
   * Start the timer if it isn't already running and at least one valid move
   * exists in the current state.
   * @param {import('../core/GameState.js').GameState} state
   */
  startTimerIfValid: (state) => {
    if (get().startTime !== null) return;
    if (!hasAnyValidMove(state)) return;
    set({ startTime: Date.now() });
    // A new game's clock has just begun — count it as a game played. This fires
    // exactly once per game because we early-returned above when already running.
    useStatisticsStore.getState().recordGamePlayed();
  },

  /** Add one (or more) moves to the counter. Freezes at the move limit. */
  addMoves: (n = 1) => {
    const { isOver, moves } = get();
    if (isOver) return;
    const next = moves + n;
    set({ moves: next });
    if (next >= MAX_MOVES) get().freeze('moves');
  },

  /** Freeze the clock (e.g. when the game is won). */
  stopTimer: () => {
    const { startTime, endTime } = get();
    if (startTime !== null && endTime === null) {
      // Fold any in-progress focus pause before pinning the end time so the
      // final elapsed reflects only actively-focused play.
      if (get().pausedAt !== null) get().setFocused(true);
      set({ endTime: Date.now() });
    }
  },
}));
