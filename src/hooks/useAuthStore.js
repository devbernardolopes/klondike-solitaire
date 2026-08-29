// hooks/useAuthStore.js
// Auth session state backed by the shared Supabase client (see lib/supabaseClient).
// Establishes a silent anonymous session on app start so later steps have a stable
// userId to sync against. Loads asynchronously via init(); never throws or blocks
// gameplay — a fresh offline install simply ends init() with ready:true and an
// authError set, and the app remains fully playable. Future auth-linking steps
// build on the onAuthStateChange subscription wired here.

import { create } from 'zustand';
import { supabase } from '../lib/supabaseClient.js';
import { clearQueuedOps } from '../db/syncQueue.js';
import { resetStats } from '../db/stats.js';
import { savePlayedSeeds } from '../db/playedSeeds.js';
import { db } from '../db/schema.js';

// Guard so concurrent callers (App boot + the sync engine's ensureSignedIn)
// share a single in-flight init rather than racing two signInAnonymously calls.
let initPromise = null;

/** Flat coin reward for a win. Must match the amount hardcoded in the
 *  submit_game_result Postgres function (klondike_supabase_migration_002.sql,
 *  section 8). If that ever changes to a variable reward, this becomes
 *  purely an optimistic estimate reconciled on next boot — not a problem
 *  today since both sides use the same flat constant. */
export const WIN_COIN_REWARD = 10;

/**
 * @typedef {Object} AuthState
 * @property {string|null} userId        Supabase user id, or null when signed out
 * @property {boolean} isAnonymous       true for anonymous sessions
 * @property {boolean} ready             true once init() has resolved (success or failure)
 * @property {string|null} displayName    profile display name, or null
 * @property {{message:string}|null} linkConflict  active Google-link conflict, or null
 * @property {string|null} authError     last auth error message, or null
 * @property {() => Promise<void>} init  establish/resume the session
 */

const userShape = (user) => ({
  userId: user ? user.id : null,
  isAnonymous: user ? (user.is_anonymous ?? true) : true,
});

// Set the session-derived fields and fetch the profile's display name. The
// profile query is best-effort: a network failure (offline) must not make
// init() reject, so it is swallowed and displayName/coins simply stay null.
const hydrateProfile = async (user, set) => {
  set({ ...userShape(user), ready: true });
  try {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, coins, coins_earned_total, coins_spent_total, display_name_updated_at')
      .eq('id', user.id)
      .single();
    if (data) {
      set({
        displayName: data.display_name,
        coins: data.coins ?? 0,
        coinsEarnedTotal: data.coins_earned_total ?? 0,
        coinsSpentTotal: data.coins_spent_total ?? 0,
        displayNameUpdatedAt: data.display_name_updated_at,
      });
    }
  } catch {
    // Offline / profile missing — leave displayName/coins at prior values.
  }
};

export const useAuthStore = create((set, get) => ({
  userId: null,
  isAnonymous: true,
  ready: false,
  displayName: null,
  displayNameUpdatedAt: null,
  coins: 0,
  coinsEarnedTotal: 0,
  coinsSpentTotal: 0,
  ownedItemIds: [],
  linkConflict: null,
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
          await hydrateProfile(session.user, set);
          return;
        }
      } catch {
        // No cached session (or offline) — fall through to anonymous sign-in.
      }

      try {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        if (data?.user) {
          await hydrateProfile(data.user, set);
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

  /** Begin linking the current anonymous session to a Google identity. */
  linkWithGoogle: async () => {
    localStorage.setItem('klondike:pendingLink', '1');
    await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // Browser navigates to Google here; nothing after this normally runs.
  },

  /**
   * Resolve a detected link conflict (see checkAuthRedirectResult).
   * `accept: true` adopts the already-linked account's data per the agreed
   * merge policy, discarding this session's queued-but-unsynced ops.
   * `accept: false` just dismisses the dialog; nothing changes.
   * @param {boolean} accept
   */
  resolveLinkConflict: async (accept) => {
    set({ linkConflict: null });
    if (!accept) return;
    await clearQueuedOps();
    localStorage.setItem('klondike:pendingProfilePull', '1');
    await supabase.auth.signOut();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // Browser navigates to Google again here — this is expected: adopting
    // the other account is a real sign-in, not a local state change.
  },

  // Optimistic local bump for instant UI feedback after a win — the real,
  // tamper-proof balance still comes from Supabase and is what wins on the
  // next hydrateProfile() call (every boot). A coin award always credits both
  // the balance and the lifetime-earned total together (mirrors
  // submit_game_result crediting coins and coins_earned_total in the same
  // update). Purchases are the only place coins decrease, and coins_spent_total
  // is bumped separately in purchaseItem() below since only that path knows the
  // price paid.
  addCoinsOptimistic: (amount) =>
    set((s) => ({ coins: s.coins + amount, coinsEarnedTotal: s.coinsEarnedTotal + amount })),

  /** Live availability check while typing — debounce the caller, not this. */
  checkDisplayNameAvailable: async (name) => {
    const { data, error } = await supabase.rpc('check_display_name_available', {
      p_display_name: name,
    });
    if (error) throw error;
    return data;
  },

  /**
   * @param {string} name
   * @throws with a human-readable message (format/cooldown/uniqueness —
   *   all produced server-side by rename_display_name) on failure.
   */
  renameDisplayName: async (name) => {
    const { error } = await supabase.rpc('rename_display_name', {
      p_display_name: name,
    });
    if (error) throw new Error(error.message);
    set({ displayName: name, displayNameUpdatedAt: new Date().toISOString() });
  },

  /**
   * Buys an item via purchase_item(); throws with the server's message
   * (insufficient coins / already owned / unknown item) on failure.
   * On success, coins/ownedItemIds are set from the RPC's own return
   * value — never computed client-side.
   * @param {string} itemId
   * @param {number} price  item's price, for the optimistic coinsSpentTotal
   *   bump — coins itself is still taken from the RPC's return value.
   */
  purchaseItem: async (itemId, price) => {
    const { data, error } = await supabase.rpc('purchase_item', { p_item_id: itemId });
    if (error) throw new Error(error.message);
    set((s) => ({
      coins: data.coins,
      coinsSpentTotal: s.coinsSpentTotal + price,
      ownedItemIds: s.ownedItemIds.includes(itemId)
        ? s.ownedItemIds
        : [...s.ownedItemIds, itemId],
    }));
    return data;
  },

  /**
   * Leave a linked account. There's no true "logged out" state in this app —
   * this clears local caches and the not-yet-synced queue (which belonged to
   * the departing identity) and immediately establishes a brand-new anonymous
   * session, exactly like a first-ever launch.
   *
   * Callers must also refresh useStatisticsStore/useSeedStore's in-memory
   * state afterward (this store can't import them — see file header note).
   */
  signOut: async () => {
    await clearQueuedOps();
    await resetStats();
    await savePlayedSeeds([]);
    await db.dailyResults.clear();
    set({ coins: 0, displayName: null });
    await supabase.auth.signOut();
    await get().init();
  },
}));
