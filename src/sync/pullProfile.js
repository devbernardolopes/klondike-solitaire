// sync/pullProfile.js
// One-time pull of the *currently signed-in* Supabase account's data into local
// Dexie, overwriting what's there. Used right after a resolved link conflict —
// the local anonymous session's data is being deliberately abandoned in favor of
// an already-linked account's, so Dexie needs to be replaced to match it, not
// merged with it. It is also fired on every normal cross-device sync trigger
// (boot, tab refocus, Daily/New Game modal open), so coins/stats/seeds/dailies
// all stay current across devices.
//
// Daily Challenge reads db/dailyResults directly each time it opens, so nothing
// in-memory needs refreshing there. Coins are re-synced from Supabase on every
// pull (here) as well as on every boot via hydrateProfile(); they survive a
// local statistics reset by design (they live on useAuthStore, not the
// cumulative stats row).

import { supabase } from '../lib/supabaseClient.js';
import { db } from '../db/schema.js';
import { mergeDailyResults } from '../db/dailyResults.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';
import { applyResetMarker } from './factoryReset.js';

export async function pullRemoteProfile() {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(
      'games_played, games_won, current_streak, best_streak, ' +
        'highest_score, lowest_time_ms, lowest_moves, lowest_undos, ' +
        'total_time_ms_won, total_moves_won, coins, ' +
        'coins_earned_total, coins_spent_total, display_name, display_name_updated_at, ' +
        'factory_reset_at',
    )
    .single();
  if (profileError) throw profileError;

  // A Factory Reset on another device wipes the server; self-wipe first so
  // the rows pulled below (already the wiped truth) land on clean caches.
  // Best-effort — a failure here just falls through to the normal pull.
  try {
    await applyResetMarker(profile.factory_reset_at);
  } catch {}

  await db.stats.put({
    key: 'cumulative',
    totalGamesPlayed: profile.games_played,
    totalGamesWon: profile.games_won,
    highestScore: profile.highest_score,
    lowestTimeMs: profile.lowest_time_ms,
    lowestMoves: profile.lowest_moves,
    lowestUndos: profile.lowest_undos,
    currentStreak: profile.current_streak,
    bestStreak: profile.best_streak,
    totalTimeMsWon: profile.total_time_ms_won,
    totalMovesWon: profile.total_moves_won,
  });

  // Coins ride along on every pull trigger (no separate coin path needed).
  // The display name + its rename cooldown timestamp are refreshed too so the
  // Main Menu's rename affordance stays current across devices.
  const { data: ownedRows, error: ownedError } = await supabase
    .from('owned_items')
    .select('item_id');
  if (ownedError) throw ownedError;

  useAuthStore.setState({
    coins: profile.coins ?? 0,
    coinsEarnedTotal: profile.coins_earned_total ?? 0,
    coinsSpentTotal: profile.coins_spent_total ?? 0,
    displayName: profile.display_name,
    displayNameUpdatedAt: profile.display_name_updated_at,
    ownedItemIds: ownedRows.map((r) => r.item_id),
  });

  const { data: seedRows, error: seedsError } = await supabase
    .from('played_seeds')
    .select('seed');
  if (seedsError) throw seedsError;
  await db.playedSeeds.put({ key: 'won', seeds: seedRows.map((r) => r.seed) });

  const { data: dailyRows, error: dailyError } = await supabase
    .from('daily_results')
    .select('date, seed, best_score, best_time_ms, best_moves, wins');
  if (dailyError) throw dailyError;
  // Merge, never strip: a local-only row is a win this device witnessed but
  // the server hasn't confirmed yet (submit still queued or the pull raced
  // the flush) — replacing Dexie with server truth here used to unmark a
  // just-won day until the next pull. Server rejections bypass this: they go
  // through applyRejectedWin, which deletes/restores the Dexie row directly.
  const mergedDaily = mergeDailyResults(
    (dailyRows || []).map((d) => ({
      date: d.date,
      seed: d.seed,
      bestScore: d.best_score,
      bestTimeMs: d.best_time_ms,
      bestMoves: d.best_moves,
      wins: d.wins,
    })),
    await db.dailyResults.toArray(),
  );
  await db.dailyResults.clear();
  await db.dailyResults.bulkPut(mergedDaily);

  // Refresh in-memory state so the UI reflects the pull immediately.
  await useStatisticsStore.getState().init();
  await useSeedStore.getState().init();
}
