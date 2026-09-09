// hooks/useStatisticsStore.js
// Persisted, cumulative game statistics backed by the Dexie `stats` table
// (see db/stats.js). Loaded asynchronously on app start; updated through the
// db helpers so values survive reloads and aggregate across sessions.

import { create } from 'zustand';
import { loadStats, addWin, addGamePlayed, recordLoss as dbRecordLoss, removeWin, resetStats, saveStats } from '../db/stats.js';
import { getDailyResult } from '../db/dailyResults.js';
import { getWinSnapshot, saveWinSnapshot, clearWinSnapshot } from '../db/winSnapshots.js';
import { useSeedStore } from './useSeedStore.js';
import { revertOptimisticSolve } from '../repo/specialEventsRepository.js';
// Imported lazily (only used inside finalizeGame at call-time) so the circular
// reference with useStatsStore never resolves during module evaluation.
import { useStatsStore } from './useStatsStore.js';
import { enqueue } from '../sync/syncEngine.js';
import { useAuthStore, WIN_COIN_REWARD } from '../hooks/useAuthStore.js';
import { db } from '../db/schema.js';
import { applyOptimisticSolve, cloneDetail, findNextUnsolvedDealOnPage } from '../repo/specialEventsProgress.js';
import { getCachedEventDetailSync, patchCachedEventDealSolved } from '../repo/specialEventsRepository.js';
import { saveEventSelection, saveLastViewedPage } from '../db/eventSelection.js';
import { useUiStore } from './useUiStore.js';

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
  /**
   * Fold a won game into the aggregates. Persists and refreshes state so the
   * Statistics modal updates live. eventDealReplayed is true when the won
   * event deal was already solved (a replay) — the deal selector then stays
   * in place instead of advancing to the next unsolved deal on the page.
    * @param {{score:number, timeMs:number, moves:number, undos:number,
    *   seed?:number, gameKind?:'winning'|'random'|'daily'|'event', dailyDate?:string|null,
    *   eventDealId?:number|null, eventId?:string|null, eventDealReplayed?:boolean,
    *   pageBonus?:number}} win
    */
  recordWin: async ({ score, timeMs, moves, undos, seed, gameKind, dailyDate, eventDealId, eventId, eventDealReplayed, coinTotal, pageBonus, achievementTelemetry }) => {
    // Snapshot the pre-win row (plus the side effects below) keyed by gameId
    // so a server-rejected optimistic win (over-limit) can be rolled back
    // exactly in applyRejectedWin. Best-effort: a snapshot failure must never
    // block the win itself.
    const gameId = achievementTelemetry?.gameId ?? null;
    let prevStats = null;
    let prevDaily = null;
    let seedAdded = false;
    try {
      prevStats = await loadStats();
      if (gameKind === 'daily' && dailyDate) {
        prevDaily = await getDailyResult(dailyDate);
      }
      if (gameKind === 'winning' && seed != null) {
        seedAdded = !useSeedStore.getState().playedSeeds.includes(seed);
      }
    } catch {}
    const stats = await addWin({ score, timeMs, moves, undos });
    set({ stats, gameWon: true });
    if (gameId != null && prevStats) {
      try {
        await saveWinSnapshot({
          gameId,
          prevStats,
          seedAdded,
          seed: seed ?? null,
          gameKind: gameKind ?? null,
          dailyDate: gameKind === 'daily' ? (dailyDate ?? null) : null,
          prevDaily,
          eventDealId: gameKind === 'event' ? (eventDealId ?? null) : null,
          // Predicted page-completion bonus (0 when none): lets the flush
          // reconcile compare against the same optimistic total the win-time
          // UI displayed (deal award + page bonus).
          pageBonus: gameKind === 'event' ? (Number(pageBonus) || 0) : 0,
        });
      } catch {}
    }
    // Parallel remote-sync path: one RPC folds the win into game_results, coins,
    // streak, personal bests, achievement checks, played-seed tracking, Daily
    // Challenge results, and — when eventDealId is set — Special Events deal/page/
    // event completion, atomically server-side. Dexie remains the read source of truth.
    enqueue('submit_game_result', {
      p_won: true,
      p_moves: moves,
      p_duration_ms: timeMs,
      p_score: score,
      p_undos: undos,
      p_seed: seed ?? null,
      p_game_kind: gameKind ?? null,
      p_daily_date: dailyDate ?? null,
      p_event_deal_id: eventDealId ?? null,
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
    // Optimistic local coin bump for instant UI feedback, using the
    // prospective total computed from the cached reward config (Board passes
    // it in; falls back to the legacy flat constant). The authoritative
    // balance is computed server-side on flush and reconciled via the
    // coins_* breakdown (see sync/operations.js), with hydrateProfile() as
    // the backstop on next boot.
    useAuthStore.getState().addCoinsOptimistic(
      Number.isFinite(coinTotal) ? coinTotal : WIN_COIN_REWARD,
    );
    if (gameKind === 'event' && eventDealId != null) {
      try {
        patchCachedEventDealSolved(eventDealId);
      } catch {}
      try {
        const cached = eventId ? getCachedEventDetailSync(eventId) : null;
        // Same-page-only target (never another page), and no advance at all
        // when replaying an already-solved deal.
        const target = cached && !eventDealReplayed ? findNextUnsolvedDealOnPage(cached, eventDealId) : null;
        if (cached && target) {
          saveEventSelection(cached.id, target.pageNumber, target.deal.id).catch(() => {});
          saveLastViewedPage(cached.id, target.pageNumber).catch(() => {});
        }
      } catch {}
      (async () => {
        try {
          const rows = await db.eventCatalogCache.toArray();
          for (const row of rows) {
            const detail = row.detail;
            if (!detail || !detail.pages) continue;
            const hasDeal = detail.pages.some((p) => p.deals.some((d) => d.id === eventDealId));
            if (!hasDeal) continue;
            const cloned = cloneDetail(detail);
            applyOptimisticSolve(cloned, eventDealId);
            await db.eventCatalogCache.put({ eventId: cloned.id, detail: cloned, updatedAt: Date.now() });
            try {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('event-detail-optimistic', { detail: { eventId: cloned.id, dealId: eventDealId } }));
              }
            } catch {}
            if (!eventId) {
              try {
                const target = eventDealReplayed ? null : findNextUnsolvedDealOnPage(cloned, eventDealId);
                if (target) {
                  saveEventSelection(cloned.id, target.pageNumber, target.deal.id).catch(() => {});
                  saveLastViewedPage(cloned.id, target.pageNumber).catch(() => {});
                }
              } catch {}
            }
            break;
          }
        } catch {}
      })();
    }
  },

  /** Increment the total-games-played counter. */
  recordGamePlayed: async () => {
    const stats = await addGamePlayed();
    set({ stats });
    enqueue('record_game_started', { p_game_id: useStatsStore.getState().achievementTelemetry.gameId });
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
    // Lazy import: useGameStore pulls a JSON/i18n chain that plain node --test
    // cannot load, and it closes a static useGameStore <-> useStatisticsStore
    // cycle. recordLoss callers stub this out in tests, so the import only
    // resolves on real loss paths (browser/Vite handles the JSON fine).
    const { useGameStore } = await import('./useGameStore.js');
    const gameStore = useGameStore.getState();
    const ui = useUiStore.getState();
    const gameKind = ui.currentGameKind ?? gameStore.replaySpec?.kind ?? null;

    // Calculate moves: use session.moves if valid, otherwise fall back to
    // the game state's move history length (covers edge cases where the
    // moves counter was reset or not properly incremented).
    const moves = session.moves > 0 ? session.moves : Math.max(0, gameStore.state.moveHistory.length);

    // Calculate duration: use session.getElapsedMs() if startTime is set,
    // otherwise fall back to the deal start time from replaySpec if available.
    const durationMs = session.startTime != null
      ? session.getElapsedMs()
      : (gameStore.replaySpec?.seed !== undefined
          ? /* winning/random deal: use game start approximated from seed */
            0
          : null);

    enqueue('submit_game_result', {
      p_won: false,
      p_moves: moves,
      p_duration_ms: durationMs,
      p_score: session.score,
      p_undos: session.undos,
      p_seed: gameStore.state?.seed ?? gameStore.replaySpec?.seed ?? null,
      p_game_kind: gameKind,
      p_daily_date: gameKind === 'daily' ? (ui.currentDailyDate ?? gameStore.replaySpec?.date ?? null) : null,
      p_game_id: telemetry?.gameId ?? null,
      p_hint_used: telemetry?.hintUsed ?? false,
      p_undo_used: (telemetry?.undoUsed ?? false) || session.undos > 0,
      p_tableau_to_tableau_moves: telemetry?.tableauToTableauMoves ?? 0,
      p_foundation_moves: telemetry?.foundationMoves ?? 0,
      p_foundation_to_tableau_moves: telemetry?.foundationToTableauMoves ?? 0,
      p_recycle_count: telemetry?.recycleCount ?? 0,
      p_foundation_first_eligible: telemetry?.foundationFirstEligible ?? true,
      p_ace_collector_eligible: telemetry?.aceCollectorEligible ?? true,
      p_aces_to_foundation: telemetry?.aceIdsToFoundation?.length ?? 0,
      p_ace_ids_to_foundation: telemetry?.aceIdsToFoundation ?? [],
      p_event_deal_id: gameKind === 'event' ? (ui.currentEventDealId ?? gameStore.replaySpec?.eventDealId ?? null) : null,
    });
  },

  /**
   * Roll back an optimistic win the server rejected as over-limit
   * (limit_rejected). Restores the exact pre-win stats snapshot, then applies
   * the loss the rejected game actually was (streak broken, best kept) —
   * mirroring the server, which records the row as a loss. Also reverts the
   * win's side effects: played-seed entry, daily best fold, and optimistic
   * event solve. Coins need no handling here: the server returns
   * coins_awarded 0 and the existing delta-reconcile subtracts the optimistic
   * bump. Achievements need none either: the server suppresses unlocks for
   * rejected wins. Does NOT enqueue anything — the server already recorded
   * the loss via the rejected row. Never throws.
   * @param {{gameId:string|null, payload?:object}} args
   */
  applyRejectedWin: async ({ gameId, payload = {} }) => {
    try {
      const snap = await getWinSnapshot(gameId).catch(() => null);
      if (snap?.prevStats) {
        await saveStats(snap.prevStats);
        const stats = await dbRecordLoss();
        set({ stats, gameWon: false });
        if (snap.seedAdded && snap.seed != null) {
          try {
            useSeedStore.getState().removePlayedSeed(snap.seed);
          } catch {}
        }
        if (snap.dailyDate) {
          try {
            const { db } = await import('../db/schema.js');
            if (snap.prevDaily) {
              await db.dailyResults.put(snap.prevDaily);
            } else {
              await db.dailyResults.delete(snap.dailyDate);
            }
          } catch {}
        }
        if (snap.eventDealId != null) {
          try {
            revertOptimisticSolve(snap.eventDealId);
          } catch {}
        }
      } else {
        const stats = await removeWin({
          score: payload?.p_score ?? 0,
          timeMs: payload?.p_duration_ms ?? 0,
          moves: payload?.p_moves ?? 0,
          undos: payload?.p_undos ?? 0,
        });
        set({ stats, gameWon: false });
        if (payload?.p_game_kind === 'winning' && payload?.p_seed != null) {
          try {
            useSeedStore.getState().removePlayedSeed(payload.p_seed);
          } catch {}
        }
        if (payload?.p_event_deal_id != null) {
          try {
            revertOptimisticSolve(payload.p_event_deal_id);
          } catch {}
        }
      }
    } catch {}
    try {
      await clearWinSnapshot(gameId);
    } catch {}
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
