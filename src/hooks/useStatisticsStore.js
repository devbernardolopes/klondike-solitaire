// hooks/useStatisticsStore.js
// Persisted, cumulative game statistics backed by the Dexie `stats` table
// (see db/stats.js). Loaded asynchronously on app start; updated through the
// db helpers so values survive reloads and aggregate across sessions.

import { create } from 'zustand';
import { loadStats, addWin, addGamePlayed, recordLoss as dbRecordLoss, resetStats } from '../db/stats.js';
// Imported lazily (only used inside finalizeGame at call-time) so the circular
// reference with useStatsStore never resolves during module evaluation.
import { useStatsStore } from './useStatsStore.js';
import { enqueue } from '../sync/syncEngine.js';
import { useAuthStore, WIN_COIN_REWARD } from '../hooks/useAuthStore.js';

const EMPTY = {
  totalGamesPlayed: 0,
  totalGamesWon: 0,
  highestScore: 0,
  lowestTimeMs: null,
  lowestMoves: null,
  lowestUndos: null,
  currentStreak: 0,
  bestStreak: 0,
  totalTimeMsWon: 0,
  totalMovesWon: 0,
};

export const useStatisticsStore = create((set, get) => ({
  stats: { ...EMPTY },
  loaded: false,
  // Runtime-only flag: true once the current game has been recorded as a win.
  // Used to decide whether finalizing the game (on the next deal) is a loss.
  gameWon: false,

  /** Load persisted cumulative stats from Dexie. Safe to call once on mount. */
  init: async () => {
    const stats = await loadStats();
    set({ stats, loaded: true, gameWon: false });
  },

  /**
   * Fold a won game into the aggregates. Persists and refreshes state so the
   * Statistics modal updates live.
   * @param {{score:number, timeMs:number, moves:number, undos:number,
   *   seed?:number, gameKind?:'winning'|'random'|'daily', dailyDate?:string|null}} win
   */
  recordWin: async ({ score, timeMs, moves, undos, seed, gameKind, dailyDate, achievementTelemetry }) => {
    const stats = await addWin({ score, timeMs, moves, undos });
    set({ stats, gameWon: true });
    // Parallel remote-sync path: one RPC folds the win into game_results, coins,
    // streak, personal bests, achievement checks, played-seed tracking, and Daily
    // Challenge results atomically server-side. Dexie remains the read source of truth.
    enqueue('submit_game_result', {
      p_won: true,
      p_moves: moves,
      p_duration_ms: timeMs,
      p_score: score,
      p_undos: undos,
      p_seed: seed ?? null,
      p_game_kind: gameKind ?? null,
      p_daily_date: dailyDate ?? null,
      p_game_id: achievementTelemetry?.gameId ?? null,
      p_hint_used: achievementTelemetry?.hintUsed ?? false,
      p_undo_used: achievementTelemetry?.undoUsed ?? undos > 0,
      p_tableau_to_tableau_moves: achievementTelemetry?.tableauToTableauMoves ?? 0,
      p_foundation_moves: achievementTelemetry?.foundationMoves ?? 0,
      p_foundation_to_tableau_moves: achievementTelemetry?.foundationToTableauMoves ?? 0,
      p_recycle_count: achievementTelemetry?.recycleCount ?? 0,
      p_foundation_first_eligible: achievementTelemetry?.foundationFirstEligible ?? true,
      p_ace_collector_eligible: achievementTelemetry?.aceCollectorEligible ?? true,
      p_aces_to_foundation: achievementTelemetry?.aceIdsToFoundation?.length ?? 0,
    });
    // Optimistic local coin bump for instant UI feedback; the authoritative
    // balance is re-synced from Supabase on the next boot via hydrateProfile().
    useAuthStore.getState().addCoinsOptimistic(WIN_COIN_REWARD);
  },

  /** Increment the total-games-played counter. */
  recordGamePlayed: async () => {
    const stats = await addGamePlayed();
    set({ stats });
    enqueue('record_game_started', {});
  },

  /**
   * End a losing (non-winning) game: the current streak is broken, the best
   * streak is preserved. Invoked both when a game is abandoned mid-play (from
   * finalizeGame) and when a hard limit ends the game at game-over time (from
   * useStatsStore.freeze), so a loss ends the streak the moment it's decided.
   * @returns {Promise<CumulativeStats>} the updated row
   */
  recordLoss: async () => {
    const stats = await dbRecordLoss();
    set({ stats, gameWon: false });
    const session = useStatsStore.getState();
    const telemetry = session.achievementTelemetry;
    enqueue('submit_game_result', {
      p_won: false,
      p_moves: session.moves,
      p_duration_ms: session.getElapsedMs(),
      p_score: session.score,
      p_undos: session.undos,
      p_game_id: telemetry.gameId,
      p_hint_used: telemetry.hintUsed,
      p_undo_used: telemetry.undoUsed || session.undos > 0,
      p_tableau_to_tableau_moves: telemetry.tableauToTableauMoves,
      p_foundation_moves: telemetry.foundationMoves,
      p_foundation_to_tableau_moves: telemetry.foundationToTableauMoves,
      p_recycle_count: telemetry.recycleCount,
      p_foundation_first_eligible: telemetry.foundationFirstEligible,
      p_ace_collector_eligible: telemetry.aceCollectorEligible,
      p_aces_to_foundation: telemetry.aceIdsToFoundation.length,
    });
  },

  /**
   * Finalize the game that is about to be replaced by a new deal. A loss is
   * recorded (current streak broken, best kept) ONLY when the replaced game was
   * abandoned mid-play — i.e. its timer was running and it had neither been won
   * nor already ended by a limit. A game that was never started isn't a real
   * game, and a game that already ended had its outcome recorded at that moment
   * (recordWin on a win; recordLoss via useStatsStore.freeze on a limit), so
   * neither should re-record the streak here. The won flag is always cleared
   * for the next game.
   */
  finalizeGame: async () => {
    const { gameWon } = get();
    if (gameWon) {
      set({ gameWon: false });
      return;
    }
    const s = useStatsStore.getState();
    const inProgress = s.startTime !== null && s.endTime === null && !s.isOver;
    if (inProgress) {
      await get().recordLoss();
    }
    set({ gameWon: false });
  },

  /**
   * Clear all cumulative statistics, both locally (Dexie) and on the server
   * (via the `reset_statistics` RPC, flushed by the offline-first sync queue).
   * The caller is responsible for any in-progress game: discarding and re-dealing
   * it must be done separately (e.g. useGameStore.replayGame) so the reset does
   * not count the abandoned game as played.
   */
  reset: async () => {
    const stats = await resetStats();
    enqueue('reset_statistics', {});
    set({ stats });
  },
}));
