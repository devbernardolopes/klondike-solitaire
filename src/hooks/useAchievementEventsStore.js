// hooks/useAchievementEventsStore.js
// Minimal, in-memory event source for achievement-unlock signals. The toast UI
// (a later phase) will subscribe to `queue` to surface newly-unlocked
// achievements. This phase only produces the signal so it exists and is
// observable.
//
// IMPORTANT timing reality: announce() is fed from the offline-first sync
// queue (submit_game_result flows through src/sync/syncEngine.js). That means
// the unlock signal can arrive well after the win itself — on a later app boot,
// or only after the device reconnects. Any future consumer MUST NOT assume this
// fires mid-game; it is an out-of-band signal, not a synchronous win callback.

import { create } from 'zustand';

let seq = 0;

export const useAchievementEventsStore = create((set, get) => ({
  // Array of { seq, ids } where `ids` is the array of newly-unlocked
  // achievement ids reported by an RPC. Consumers drain it via consume().
  queue: [],

  /** Record a batch of newly-unlocked achievement ids. */
  announce: (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    set((s) => ({ queue: [...s.queue, { seq: ++seq, ids }] }));
  },

  /** Remove and return the entire pending queue (for the toast phase). */
  consume: () => {
    const q = get().queue;
    if (q.length) set({ queue: [] });
    return q;
  },

  /** Clear the queue without consuming it. */
  clear: () => set({ queue: [] }),
}));
