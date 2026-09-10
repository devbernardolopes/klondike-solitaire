// db/favoriteDeals.js
// Local mirror of Supabase favorite_deals (see supabase/
// klondike_supabase_migration_034.sql). One row per favorited seed —
// seeds are globally unique across deal modes, so the seed alone is the
// identity. The game_kind + daily/event context ride along so replaying
// a favorite restores the exact deal mode.
//
// Offline-first: every favorite/unfavorite writes Dexie immediately and
// enqueues an outbox op; the server converges on flush. Reads merge the
// server snapshot with still-queued ops (see repo/favoritesRepository.js
// mergeFavorites) so unflushed changes survive a pull.

import { db } from './schema.js';

/**
 * @typedef {Object} FavoriteDeal
 * @property {number} seed            deal seed (primary key)
 * @property {string} gameKind        'winning' | 'random' | 'daily' | 'event'
 * @property {string|null} dailyDate  YYYY-MM-DD when gameKind === 'daily'
 * @property {number|null} eventDealId  special_event_deals.id when gameKind === 'event'
 * @property {string|null} eventId    special_events.id when gameKind === 'event'
 * @property {string} favoritedAt     ISO timestamp when favorited (server created_at after pull)
 */

/** All locally-mirrored favorites. @returns {Promise<FavoriteDeal[]>} */
export async function loadFavoriteDeals() {
  return db.favoriteDeals.toArray();
}

/** A single favorite, or null. @param {number} seed */
export async function getFavoriteDeal(seed) {
  const row = await db.favoriteDeals.get(seed);
  return row || null;
}

/**
 * Record a favorite locally (optimistic write; the outbox op converges the server).
 * Re-favoriting keeps the original favoritedAt so the list date stays stable.
 * @param {Omit<FavoriteDeal, 'favoritedAt'> & { favoritedAt?: string }} fav
 * @returns {Promise<FavoriteDeal>} the stored row
 */
export async function saveFavoriteDeal(fav) {
  const existing = await db.favoriteDeals.get(fav.seed);
  const next = {
    seed: fav.seed,
    gameKind: fav.gameKind ?? 'winning',
    dailyDate: fav.dailyDate ?? null,
    eventDealId: fav.eventDealId ?? null,
    eventId: fav.eventId ?? null,
    favoritedAt: existing?.favoritedAt ?? fav.favoritedAt ?? new Date().toISOString(),
  };
  await db.favoriteDeals.put(next);
  return next;
}

/** Remove a favorite locally (optimistic; the outbox op converges the server). @param {number} seed */
export async function deleteFavoriteDeal(seed) {
  await db.favoriteDeals.delete(seed);
}

/**
 * Replace the local mirror with merged rows after a server pull.
 * Pure replacement — callers must pass the already-merged list (server
 * snapshot + still-queued ops re-applied, see mergeFavorites) so unflushed
 * local changes are never stripped by a stale read.
 * @param {FavoriteDeal[]} rows
 */
export async function replaceFavoriteDeals(rows) {
  await db.favoriteDeals.clear();
  if (rows && rows.length > 0) await db.favoriteDeals.bulkPut(rows);
}
