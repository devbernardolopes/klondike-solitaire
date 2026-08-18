// hooks/useStatisticsStore.js
// Persisted, cumulative game statistics backed by the Dexie `stats` table
// (see db/stats.js). Loaded asynchronously on app start; updated through the
// db helpers so values survive reloads and aggregate across sessions.

import { create } from 'zustand';
import { loadStats, addWin, addGamePlayed, resetStats } from '../db/stats.js';

const EMPTY = {
  totalGamesPlayed: 0,
  totalGamesWon: 0,
  highestScore: 0,
  lowestTimeMs: null,
  lowestMoves: null,
};

export const useStatisticsStore = create((set) => ({
  stats: { ...EMPTY },
  loaded: false,

  /** Load persisted cumulative stats from Dexie. Safe to call once on mount. */
  init: async () => {
    const stats = await loadStats();
    set({ stats, loaded: true });
  },

  /**
   * Fold a won game into the aggregates. Persists and refreshes state so the
   * Statistics modal updates live.
   * @param {{score:number, timeMs:number, moves:number}} win
   */
  recordWin: async ({ score, timeMs, moves }) => {
    const stats = await addWin({ score, timeMs, moves });
    set({ stats });
  },

  /** Increment the total-games-played counter. */
  recordGamePlayed: async () => {
    const stats = await addGamePlayed();
    set({ stats });
  },

  /** Clear all cumulative statistics. */
  reset: async () => {
    const stats = await resetStats();
    set({ stats });
  },
}));
