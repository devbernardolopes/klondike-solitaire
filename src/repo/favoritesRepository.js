// repo/favoritesRepository.js
// Read/write path for the Favorites view (Main Menu > Favorites).
// Supabase's favorite_deals table is the authority (see supabase/
// klondike_supabase_migration_034.sql); the local Dexie mirror
// (db/favoriteDeals.js) keeps the list available offline, and the sync
// outbox carries still-queued add/remove ops.
//
// Merge rule: start from the server snapshot, apply queued ops in flush
// order (last write per seed wins — the outbox already collapses those
// via dedupeKey), then fold in local-only rows whose add is still queued
// (unflushed optimistic writes). Anything else defers to the server
// snapshot, so an unfavorite flushed from another device stays unfavorited
// instead of resurrecting from a stale local mirror.

import { supabase } from '../lib/supabaseClient.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { listQueuedOps } from '../db/syncQueue.js';

/**
 * Map a favorite_deals server row to a FavoriteDeal entry.
 * @param {object} row
 * @returns {object} favorite entry
 */
export function serverRowToFavoriteEntry(row) {
  return {
    seed: row.seed,
    gameKind: row.game_kind ?? 'winning',
    dailyDate: row.daily_date ?? null,
    eventDealId: row.event_deal_id ?? null,
    eventId: row.event_id ?? null,
    favoritedAt: row.created_at,
    eventTitle: null,
    pending: false,
  };
}

/**
 * Merge a server snapshot with still-queued outbox ops and the local
 * mirror. Pure (no I/O) so it is unit-testable in isolation.
 * @param {object[]} serverRows  raw favorite_deals rows
 * @param {object[]} localRows  Dexie favoriteDeals rows
 * @param {object[]} queuedOps  raw syncQueue rows (id order)
 * @returns {object[]} merged entries, newest-favorited first
 */
export function mergeFavorites(serverRows, localRows, queuedOps) {
  const bySeed = new Map();
  for (const row of serverRows ?? []) {
    if (row == null || row.seed == null) continue;
    bySeed.set(row.seed, serverRowToFavoriteEntry(row));
  }
  const ops = (queuedOps ?? []).filter(
    (op) => op?.type === 'add_favorite' || op?.type === 'remove_favorite',
  );
  // Net queued effect per seed (last write wins, mirroring the outbox
  // dedupeKey collapse) for the local-fold decision below.
  const net = new Map();
  for (const op of ops) {
    const seed = op?.payload?.seed;
    if (seed == null) continue;
    if (op.type === 'add_favorite') {
      const p = op.payload ?? {};
      const prev = bySeed.get(seed);
      bySeed.set(seed, {
        seed,
        gameKind: p.game_kind ?? prev?.gameKind ?? 'winning',
        dailyDate: p.daily_date ?? prev?.dailyDate ?? null,
        eventDealId: p.event_deal_id ?? prev?.eventDealId ?? null,
        eventId: p.event_id ?? prev?.eventId ?? null,
        favoritedAt: prev?.favoritedAt ?? new Date(op.createdAt ?? Date.now()).toISOString(),
        eventTitle: prev?.eventTitle ?? null,
        pending: true,
      });
      net.set(seed, 'add');
    } else {
      bySeed.delete(seed);
      net.set(seed, 'remove');
    }
  }
  for (const local of localRows ?? []) {
    if (local == null || local.seed == null || bySeed.has(local.seed)) continue;
    // Local-only row: keep only while its add is still queued (an unflushed
    // optimistic write, possibly raced ahead of this pull). A flushed add
    // is on the server; a row deleted elsewhere stays deleted.
    if (net.get(local.seed) === 'add') bySeed.set(local.seed, { ...local, pending: true });
  }
  return [...bySeed.values()].sort((a, b) => (
    a.favoritedAt < b.favoritedAt ? 1 : a.favoritedAt > b.favoritedAt ? -1 : 0
  ));
}

/**
 * Fetch the caller's favorites, newest-favorited first. RLS scopes to the
 * caller automatically (favorite_deals_user_all).
 * @returns {Promise<object[]>} server rows
 */
export async function fetchFavorites() {
  if (!supabase) throw new Error('offline');
  const { data, error } = await supabase
    .from('favorite_deals')
    .select('seed, game_kind, daily_date, event_deal_id, event_id, created_at')
    .order('created_at', { ascending: false })
    .order('seed', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Mirror a favorite to Supabase (upsert — re-favoriting is idempotent and
 * keeps the original created_at). Used by the add_favorite op handler.
 * @param {object} fav  { seed, game_kind?, daily_date?, event_deal_id?, event_id? }
 */
export async function pushFavorite(fav) {
  const userId = useAuthStore.getState().userId;
  if (!userId) return;
  const { error } = await supabase
    .from('favorite_deals')
    .upsert(
      {
        user_id: userId,
        seed: fav.seed,
        game_kind: fav.game_kind ?? 'winning',
        daily_date: fav.daily_date ?? null,
        event_deal_id: fav.event_deal_id ?? null,
        event_id: fav.event_id ?? null,
      },
      { onConflict: 'user_id,seed' },
    );
  if (error) throw error;
}

/**
 * Mirror an unfavorite to Supabase. Used by the remove_favorite op handler.
 * @param {number} seed
 */
export async function pushUnfavorite(seed) {
  const userId = useAuthStore.getState().userId;
  if (!userId) return;
  const { error } = await supabase
    .from('favorite_deals')
    .delete()
    .eq('user_id', userId)
    .eq('seed', seed);
  if (error) throw error;
}

/**
 * List still-queued (not yet flushed) favorite ops for the merge.
 * Never throws — offline/empty outbox yields [].
 * @returns {Promise<object[]>}
 */
export async function listQueuedFavoriteOps() {
  try {
    const ops = await listQueuedOps();
    return (ops ?? []).filter((op) => op?.type === 'add_favorite' || op?.type === 'remove_favorite');
  } catch {
    return [];
  }
}
