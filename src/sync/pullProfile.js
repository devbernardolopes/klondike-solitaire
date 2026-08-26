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
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useStatisticsStore } from '../hooks/useStatisticsStore.js';
import { useSeedStore } from '../hooks/useSeedStore.js';

export async function pullRemoteProfile() {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(
      'games_played, games_won, current_streak, best_streak, ' +
        'highest_score, lowest_time_ms, lowest_moves, lowest_undos, coins',
    )
    .single();
  if (profileError) throw profileError;

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
  });

  // Coins ride along on every pull trigger (no separate coin path needed).
  useAuthStore.setState({ coins: profile.coins ?? 0 });

  const { data: seedRows, error: seedsError } = await supabase
    .from('played_seeds')
    .select('seed');
  if (seedsError) throw seedsError;
  await db.playedSeeds.put({ key: 'won', seeds: seedRows.map((r) => r.seed) });

  const { data: dailyRows, error: dailyError } = await supabase
    .from('daily_results')
    .select('date, seed, best_score, best_time_ms, best_moves, wins');
  if (dailyError) throw dailyError;
  await db.dailyResults.clear();
  await db.dailyResults.bulkPut(
    dailyRows.map((d) => ({
      date: d.date,
      seed: d.seed,
      bestScore: d.best_score,
      bestTimeMs: d.best_time_ms,
      bestMoves: d.best_moves,
      wins: d.wins,
    })),
  );

  // Refresh in-memory state so the UI reflects the pull immediately.
  await useStatisticsStore.getState().init();
  await useSeedStore.getState().init();
}
