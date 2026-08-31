// hooks/useToastStore.js
// Drives the single-toast, FIFO-queued achievement toast. One toast visible at a
// time; additional pushes queue and show in order. Each toast dwells 5s once it
// has slid into place, then fades out; the next queued toast (if any) then
// slides in. The actual slide/fade tweens live in ToastHost.jsx (DOM/GSAP
// concern); this store owns the phase machine and the 5s dwell timer.

import { create } from 'zustand';
import { supabase } from '../lib/supabaseClient.js';

const FIVE_SECONDS_MS = 5000;

// Module-level so dismiss()/clearActive() can cancel a pending dwell timer that
// belongs to no single store snapshot.
let dwellTimer = null;

let toastSeq = 0;

/**
 * @typedef {Object} Toast
 * @property {number} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} [image]  resolved public URL
 */

export const useToastStore = create((set, get) => ({
  config: { enabled: true, position: 'top-center' },
  loaded: false,
  queue: /** @type {Toast[]} */ ([]),
  active: /** @type {Toast|null} */ (null),
  // 'idle' | 'entering' | 'shown' | 'fading'
  phase: 'idle',

  /**
   * Fetch the global toast_config row once at boot. On any failure (missing env,
   * network error, no row) fall back to { enabled:true, position:'top-center' } —
   * never an error state, matching AchievementsModal's pattern.
   */
  initConfig: async () => {
    const fallback = { enabled: true, position: 'top-center' };
    try {
      if (!supabase) {
        set({ config: fallback, loaded: true });
        return;
      }
      const { data, error } = await supabase
        .from('toast_config')
        .select('enabled, position')
        .eq('id', 1)
        .single();
      if (error || !data) {
        set({ config: fallback, loaded: true });
        return;
      }
      set({
        config: { enabled: Boolean(data.enabled), position: data.position || 'top-center' },
        loaded: true,
      });
    } catch {
      set({ config: fallback, loaded: true });
    }
  },

  /**
   * Queue a toast. Silent no-op when config.enabled is false. Promotes to active
   * immediately when nothing is currently showing.
   * @param {Omit<Toast, 'id'>} toast
   */
  push: (toast) => {
    const { config } = get();
    if (!config.enabled) return;
    const next = { ...toast, id: ++toastSeq };
    set((s) => {
      const queue = [...s.queue, next];
      if (s.active) return { queue };
      const [first, ...rest] = queue;
      return { queue: rest, active: first, phase: 'entering' };
    });
  },

  /** Dismiss the active toast early (only meaningful while shown). */
  dismiss: () => {
    if (get().phase !== 'shown') return;
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    set({ phase: 'fading' });
  },

  // Called by ToastHost once the slide-in tween completes: start the 5s dwell.
  markShown: () => {
    if (get().phase !== 'entering') return;
    set({ phase: 'shown' });
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      if (get().phase === 'shown') set({ phase: 'fading' });
    }, FIVE_SECONDS_MS);
  },

  // Called by ToastHost once the fade-out tween completes: advance the queue.
  clearActive: () => {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    const s = get();
    const [next, ...rest] = s.queue;
    if (next) {
      set({ active: next, queue: rest, phase: 'entering' });
    } else {
      set({ active: null, queue: [], phase: 'idle' });
    }
  },
}));
