// hooks/useSeedStore.js
// In-memory mirror of the persisted set of won Winning-Deal seeds (Dexie
// `playedSeeds` table, see db/playedSeeds.js). Loaded on app start; reads are
// synchronous so dealNewGame can exclude already-won seeds without awaiting.
// Reset of the statistics store never touches this data.

import { create } from 'zustand';
import { loadPlayedSeeds, savePlayedSeeds } from '../db/playedSeeds.js';

export const useSeedStore = create((set, get) => ({
  playedSeeds: [],
  loaded: false,

  /** Load the persisted won-seed set from Dexie. Safe to call once on mount. */
  init: async () => {
    const seeds = await loadPlayedSeeds();
    set({ playedSeeds: seeds, loaded: true });
  },

  /**
   * Record a won Winning-Deal seed. No-op if already present. Updates state
   * synchronously and persists through to Dexie.
   * @param {number} seed
   */
  addPlayedSeed: (seed) => {
    if (get().playedSeeds.includes(seed)) return;
    const next = [...get().playedSeeds, seed];
    set({ playedSeeds: next });
    savePlayedSeeds(next);
  },

  /** Clear the won-seed set so every pool seed becomes available again. */
  resetPlayed: () => {
    set({ playedSeeds: [] });
    savePlayedSeeds([]);
  },
}));
