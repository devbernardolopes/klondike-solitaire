// hooks/useAuthStore.js
// Auth session state backed by the shared Supabase client (see lib/supabaseClient).
// Establishes a silent anonymous session on app start so later steps have a stable
// userId to sync against. Loads asynchronously via init(); never throws or blocks
// gameplay — a fresh offline install simply ends init() with ready:true and an
// authError set, and the app remains fully playable. Future auth-linking steps
// build on the onAuthStateChange subscription wired here.

import { create } from 'zustand';
import { supabase } from '../lib/supabaseClient.js';

// Guard so concurrent callers (App boot + the sync engine's ensureSignedIn)
// share a single in-flight init rather than racing two signInAnonymously calls.
let initPromise = null;

/**
 * @typedef {Object} AuthState
 * @property {string|null} userId        Supabase user id, or null when signed out
 * @property {boolean} isAnonymous       true for anonymous sessions
 * @property {boolean} ready             true once init() has resolved (success or failure)
 * @property {string|null} authError     last auth error message, or null
 * @property {() => Promise<void>} init  establish/resume the session
 */

const userShape = (user) => ({
  userId: user ? user.id : null,
  isAnonymous: user ? (user.is_anonymous ?? true) : true,
});

export const useAuthStore = create((set, get) => ({
  userId: null,
  isAnonymous: true,
  ready: false,
  authError: null,

  /**
   * Establish or resume an anonymous auth session. Safe to call repeatedly;
   * concurrent calls share one in-flight attempt. Resolves with ready:true in
   * all cases; never rejects.
   */
  init: async () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          set({ ...userShape(session.user), ready: true });
          return;
        }
      } catch {
        // No cached session (or offline) — fall through to anonymous sign-in.
      }

      try {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        if (data?.user) {
          set({ ...userShape(data.user), ready: true });
          return;
        }
      } catch (e) {
        // Most likely no network on a brand-new install. Mark ready and record
        // the error without blocking the rest of the app's init sequence.
        set({ ready: true, authError: e?.message ?? 'Anonymous sign-in failed' });
        return;
      } finally {
        // Subscribe regardless of outcome so later auth changes stay in sync.
        supabase.auth.onAuthStateChange((_event, session) => {
          set(userShape(session?.user ?? null));
        });
      }
    })();
    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  },

  /**
   * Resolve once a user id is available, retrying init() if a previous attempt
   * failed (e.g. no network at boot). Used by the sync engine before every flush.
   * @returns {Promise<string|null>}
   */
  ensureSignedIn: async () => {
    const { userId } = get();
    if (userId) return userId;
    await get().init();
    return get().userId;
  },
}));
