// hooks/useFavoritesStore.js
// Favorited deals (Main Menu > Favorites + HUD heart toggle). Local-first
// mirror of Supabase favorite_deals (Dexie `favoriteDeals`, see
// db/favoriteDeals.js) synced through the offline-first outbox
// (add_favorite / remove_favorite ops, last-write-wins per seed via
// dedupeKey `favorite:<seed>`); the server converges on flush and the
// mirror is replaced by the merged snapshot on every pull.
//
// Reads are synchronous (isFavorite) so the HUD heart and the Favorites
// modal render without awaiting. The identity switch guard (favUserId)
// keeps one account's rows from ever showing under another identity.

import { create } from 'zustand';
import { enqueue } from '../sync/syncEngine.js';
import { useAuthStore } from './useAuthStore.js';
import { useGameStore } from './useGameStore.js';
import {
  loadFavoriteDeals,
  saveFavoriteDeal,
  deleteFavoriteDeal,
  replaceFavoriteDeals,
} from '../db/favoriteDeals.js';
import {
  fetchFavorites,
  listQueuedFavoriteOps,
  mergeFavorites,
} from '../repo/favoritesRepository.js';
import { resolveEventTitles } from '../repo/gameHistoryRepository.js';

function sortNewest(list) {
  return [...(list ?? [])].sort((a, b) => (
    a.favoritedAt < b.favoritedAt ? 1 : a.favoritedAt > b.favoritedAt ? -1 : 0
  ));
}

function toMirrorRow(entry) {
  return {
    seed: entry.seed,
    gameKind: entry.gameKind ?? 'winning',
    dailyDate: entry.dailyDate ?? null,
    eventDealId: entry.eventDealId ?? null,
    eventId: entry.eventId ?? null,
    favoritedAt: entry.favoritedAt,
    // Cached display data so offline rows still show the resolved event
    // title + deal number; re-resolved from the server on every refresh.
    eventTitle: entry.eventTitle ?? null,
    eventDealNumber: entry.eventDealNumber ?? null,
  };
}

export const useFavoritesStore = create((set, get) => ({
  favorites: [],
  loaded: false,
  refreshing: false,
  favUserId: null,

  /** Load the local mirror, then converge with the server best-effort. */
  init: async () => {
    const userId = useAuthStore.getState().userId;
    try {
      const local = await loadFavoriteDeals();
      set({ favorites: sortNewest(local), loaded: true, favUserId: userId });
    } catch {
      set({ loaded: true, favUserId: userId });
    }
    get().refresh().catch(() => {});
  },

  /**
   * Pull the server snapshot, merge with still-queued ops + the local
   * mirror, and replace both. Never throws — offline keeps the last-known
   * list. A changed identity clears first (cold load, never cross-account).
   */
  refresh: async () => {
    if (get().refreshing) return;
    const userId = useAuthStore.getState().userId;
    if (get().favUserId !== userId) {
      set({ favorites: [], favUserId: userId });
    }
    set({ refreshing: true });
    try {
      const [server, queued, local] = await Promise.all([
        fetchFavorites(),
        listQueuedFavoriteOps(),
        loadFavoriteDeals(),
      ]);
      const merged = mergeFavorites(server, local, queued);
      await resolveEventTitles(merged);
      await replaceFavoriteDeals(merged.map(toMirrorRow));
      set({ favorites: merged, loaded: true });
    } catch {
      // Offline / unauthenticated: keep the last-known local list.
      try {
        const local = await loadFavoriteDeals();
        set({ favorites: sortNewest(local), loaded: true });
      } catch {}
    } finally {
      set({ refreshing: false });
    }
  },

  /** Whether a seed is currently favorited (synchronous). @param {number|null} seed */
  isFavorite: (seed) => seed != null && get().favorites.some((f) => f.seed === seed),

  /**
   * Favorite a deal: local-first write + converging outbox op.
   * @param {object} fav  { seed, gameKind?, dailyDate?, eventDealId?, eventId? }
   * @returns {Promise<boolean>} false when there is no seed identity
   */
  favorite: async (fav) => {
    if (fav?.seed == null) return false;
    const stored = await saveFavoriteDeal({
      seed: fav.seed,
      gameKind: fav.gameKind ?? 'winning',
      dailyDate: fav.dailyDate ?? null,
      eventDealId: fav.eventDealId ?? null,
      eventId: fav.eventId ?? null,
    });
    set((s) => ({
      favorites: sortNewest([stored, ...s.favorites.filter((f) => f.seed !== fav.seed)]),
      loaded: true,
    }));
    await enqueue(
      'add_favorite',
      {
        seed: fav.seed,
        game_kind: fav.gameKind ?? 'winning',
        daily_date: fav.dailyDate ?? null,
        event_deal_id: fav.eventDealId ?? null,
        event_id: fav.eventId ?? null,
      },
      `favorite:${fav.seed}`,
    );
    return true;
  },

  /** Unfavorite a seed: local-first removal + converging outbox op. @param {number} seed */
  unfavorite: async (seed) => {
    if (seed == null) return;
    await deleteFavoriteDeal(seed);
    set((s) => ({ favorites: s.favorites.filter((f) => f.seed !== seed) }));
    await enqueue('remove_favorite', { seed }, `favorite:${seed}`);
  },

  /**
   * Favorite the currently-dealt game (identity + mode from its replaySpec).
   * @returns {Promise<boolean>} false when no deal is active / has no seed
   */
  favoriteCurrent: async () => {
    const spec = useGameStore.getState().replaySpec;
    if (!spec || spec.seed == null) return false;
    return get().favorite({
      seed: spec.seed,
      gameKind: spec.kind ?? 'winning',
      dailyDate: spec.date ?? null,
      eventDealId: spec.eventDealId ?? null,
      eventId: spec.eventId ?? null,
    });
  },

  /** Current deal's seed, or null when no deal is active. */
  currentSeed: () => useGameStore.getState().replaySpec?.seed ?? null,

  /** Drop all in-memory state (identity departure — the Dexie mirror is cleared by the caller). */
  reset: () => set({ favorites: [], loaded: false, refreshing: false, favUserId: null }),
}));
