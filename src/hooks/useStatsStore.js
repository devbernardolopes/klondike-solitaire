// hooks/useStatsStore.js
// In-memory game session stats: moves, score, and the play timer.
// Not persisted to the DB (per product decision). The timer is timestamp-based
// so elapsed time stays accurate even when the tab loses focus (rAF pauses, but
// the displayed value is always recomputed from real wall-clock timestamps).

import { create } from 'zustand';
import { hasAnyValidMove } from '../core/rules.js';

export const useStatsStore = create((set, get) => ({
  moves: 0,
  score: 0, // not implemented yet — stays 0
  startTime: null, // epoch ms when the clock started (first valid interaction)
  endTime: null, // epoch ms when the clock stopped (on win)

  /** Reset all stats for a fresh game. */
  resetStats: () => set({ moves: 0, score: 0, startTime: null, endTime: null }),

  /**
   * Start the timer if it isn't already running and at least one valid move
   * exists in the current state.
   * @param {import('../core/GameState.js').GameState} state
   */
  startTimerIfValid: (state) => {
    if (get().startTime !== null) return;
    if (!hasAnyValidMove(state)) return;
    set({ startTime: Date.now() });
  },

  /** Add one (or more) moves to the counter. */
  addMoves: (n = 1) => set((s) => ({ moves: s.moves + n })),

  /** Freeze the clock (e.g. when the game is won). */
  stopTimer: () => {
    const { startTime, endTime } = get();
    if (startTime !== null && endTime === null) set({ endTime: Date.now() });
  },
}));
