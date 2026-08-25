// hooks/useStatisticsStore.js
// Persisted, cumulative game statistics backed by the Dexie `stats` table
// (see db/stats.js). Loaded asynchronously on app start; updated through the
// db helpers so values survive reloads and aggregate across sessions.

import { create } from 'zustand';
import { loadStats, addWin, addGamePlayed, recordLoss as dbRecordLoss, resetStats } from '../db/stats.js';
// Imported lazily (only used inside finalizeGame at call-time) so the circular
// reference with useStatsStore never resolves during module evaluation.
import { useStatsStore } from './useStatsStore.js';

const EMPTY = {
  totalGamesPlayed: 0,
  totalGamesWon: 0,
  highestScore: 0,
  lowestTimeMs: null,
  lowestMoves: null,
  lowestUndos: null,
  currentStreak: 0,
  bestStreak: 0,
};

export const useStatisticsStore = create((set, get) => ({
  stats: { ...EMPTY },
  loaded: false,
  // Runtime-only flag: true once the current game has been recorded as a win.
  // Used to decide whether finalizing the game (on the next deal) is a loss.
  gameWon: false,

  /** Load persisted cumulative stats from Dexie. Safe to call once on mount. */
  init: async () => {
    const stats = await loadStats();
    set({ stats, loaded: true, gameWon: false });
  },

  /**
   * Fold a won game into the aggregates. Persists and refreshes state so the
   * Statistics modal updates live.
   * @param {{score:number, timeMs:number, moves:number, undos:number}} win
   */
  recordWin: async ({ score, timeMs, moves, undos }) => {
    const stats = await addWin({ score, timeMs, moves, undos });
    set({ stats, gameWon: true });
  },

  /** Increment the total-games-played counter. */
  recordGamePlayed: async () => {
    const stats = await addGamePlayed();
    set({ stats });
  },

  /**
   * Finalize the game that is about to be replaced by a new deal. A loss is
   * recorded (current streak broken, best kept) ONLY when the replaced game was
   * abandoned mid-play — i.e. its timer was running and it had neither been won
   * nor already ended by a limit. A game that was never started isn't a real
   * game, and a game that already ended (win or limit) had its outcome recorded
   * elsewhere, so neither should reset the streak here. The won flag is always
   * cleared for the next game.
   */
  finalizeGame: async () => {
    const { gameWon } = get();
    if (gameWon) {
      set({ gameWon: false });
      return;
    }
    const s = useStatsStore.getState();
    const inProgress = s.startTime !== null && s.endTime === null && !s.isOver;
    if (inProgress) {
      const stats = await dbRecordLoss();
      set({ stats });
    }
    set({ gameWon: false });
  },

  /**
   * Clear all cumulative statistics.
   * @param {boolean} [countCurrentGame]  when true (a game is in progress, i.e.
   *   its timer is running), Total Games Played is set to 1 so the ongoing game
   *   is still counted instead of being wiped to 0.
   */
  reset: async (countCurrentGame = false) => {
    const stats = await resetStats();
    if (countCurrentGame) {
      const withPlayed = await addGamePlayed();
      set({ stats: withPlayed });
    } else {
      set({ stats });
    }
  },
}));
