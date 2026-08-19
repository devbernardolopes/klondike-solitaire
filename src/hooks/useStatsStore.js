// hooks/useStatsStore.js
// In-memory game session stats: moves, score, and the play timer.
// Not persisted to the DB (per product decision). The timer is timestamp-based
// so elapsed time stays accurate even when the tab loses focus (rAF pauses, but
// the displayed value is always recomputed from real wall-clock timestamps).

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

  /** Reset all stats for a fresh game. */
  resetStats: () => set({ moves: 0, score: 0, startTime: null, endTime: null, isOver: false, overReason: null }),

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
    set({ isOver: true, overReason: reason });
    if (startTime !== null && endTime === null) {
      set({ endTime: reason === 'time' ? startTime + MAX_TIME_MS : Date.now() });
    }
  },

  /**
   * Called on each timer tick to freeze once elapsed crosses the time limit.
   */
  checkTimeLimit: () => {
    const { isOver, startTime, endTime } = get();
    // Don't re-evaluate the time limit once the clock has stopped — a win pins
    // endTime without setting isOver, so isOver alone is not enough to bail out.
    if (isOver || startTime === null || endTime !== null) return;
    if (Date.now() - startTime >= MAX_TIME_MS) get().freeze('time');
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
    if (startTime !== null && endTime === null) set({ endTime: Date.now() });
  },
}));
