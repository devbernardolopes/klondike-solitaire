// sync/operations.js
// Registry of sync operation handlers the engine knows how to flush. Each
// handler receives the queued op's payload and is responsible for one Supabase
// RPC call. It must throw on failure (the engine catches it, marks the op
// failed, and stops the flush so ordering is preserved). It resolves on success.
//
// This step registers only the no-arg `record_game_started` RPC to prove the
// pipe; later steps add the real stats/seed/daily/state operations here.

import { supabase } from '../lib/supabaseClient.js';
import { pushFavorite, pushUnfavorite } from '../repo/favoritesRepository.js';
import { useAchievementEventsStore } from '../hooks/useAchievementEventsStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useToastStore, TOAST_PRIORITY } from '../hooks/useToastStore.js';
import i18n from '../i18n/index.js';
import { computeReward } from '../core/coinRewards.js';
import { getRewardConfigSync } from '../repo/rewardRulesRepository.js';
import { refreshLimitRules } from '../repo/limitRulesRepository.js';
import { clearWinSnapshot, getWinSnapshot } from '../db/winSnapshots.js';
import { formatTime } from '../utils/formatTime.js';

/**
 * @typedef {Object} OperationHandler
 * @property {(payload: Object) => Promise<void>} handler  throws on failure
 */

export const operations = {
  record_game_started: async (payload = {}) => {
    const { data, error } = await supabase.rpc('record_game_started', payload);
    if (error) throw error;
    const ids = data?.newly_unlocked_achievement_ids;
    if (Array.isArray(ids) && ids.length > 0) {
      useAchievementEventsStore.getState().announce(ids);
    }
  },

  record_game_abandoned: async () => {
    const { error } = await supabase.rpc('record_game_abandoned');
    if (error) throw error;
  },

  reset_statistics: async () => {
    const { error } = await supabase.rpc('reset_statistics');
    if (error) throw error;
  },

  submit_game_result: async (payload) => {
    const { data, error } = await supabase.rpc('submit_game_result', payload);
    // Throw on failure exactly as before — ordering/retry behavior in the sync
    // engine must not change.
    if (error) throw error;
    // submit_game_result now returns { newly_unlocked_achievement_ids }. Hand
    // any newly-unlocked ids to the achievement event store. This signal flows
    // through the offline-first sync queue, so it may fire long after the win
    // itself (a later boot / after reconnect) — the future toast consumer must
    // not assume it fires mid-game.
    const ids = data?.newly_unlocked_achievement_ids;
    if (Array.isArray(ids) && ids.length > 0) {
      useAchievementEventsStore.getState().announce(ids);
    }
    // Reconcile the optimistic coin display with the authoritative server
    // breakdown. The win-time UI already bumped the prospective total
    // (computed from the cached reward config); the server recomputed from
    // its live tables, so any drift — config retuned while offline,
    // rate-capped, or implausible submission paying 0 — is corrected here by
    // the exact delta (usually 0, i.e. a no-op). Duplicate-delivery acks
    // carry no coins_* keys by design and are skipped: adjusting twice would
    // corrupt the balance. hydrateProfile()/pull remains the backstop.
    try {
      const serverTotal = data?.coins_awarded;
      if (!Number.isFinite(serverTotal)) return;
      const expected = computeReward(
        {
          gameKind: payload?.p_game_kind ?? null,
          durationMs: payload?.p_duration_ms,
          moves: payload?.p_moves,
        },
        getRewardConfigSync(),
      ).total;
      // Page-completion bonus: the server awards it separately (profile bump
      // + event_progress.page_coins_awarded) while the win-time UI folded it
      // into the optimistic total. Add both sides only when the ack carries
      // the page term — duplicate-delivery acks have neither coins_* nor
      // event_progress by design and stay skipped. The win snapshot holds
      // this client's prediction (0 when none was shown).
      let serverWithPage = serverTotal;
      let expectedWithPage = expected;
      const serverPage = data?.event_progress?.page_coins_awarded;
      if (Number.isFinite(serverPage)) {
        serverWithPage += serverPage;
        try {
          const snap = await getWinSnapshot(payload?.p_game_id);
          expectedWithPage += Number(snap?.pageBonus) || 0;
        } catch {}
      }
      const delta = serverWithPage - expectedWithPage;
      if (delta !== 0) {
        useAuthStore.getState().addCoinsOptimistic(delta);
      }
    } catch {}
    // A claimed win is always flushed (even a rejected one), so its pre-win
    // snapshot is no longer needed once the server has judged it.
    try {
      await clearWinSnapshot(payload?.p_game_id);
    } catch {}
    // Over-limit win rejected by the server (migration_033): roll back the
    // optimistic win (stats/seed/daily/event) and tell the player. The coin
    // bump above already self-corrected (serverTotal 0 minus the bump), the
    // game_results row was recorded as a loss (history stays truthful), and
    // no achievements were unlocked server-side. This handler only runs on
    // flush, so the message surfaces exactly when the user gets online.
    // Lazy import: useStatisticsStore pulls a syncEngine chain that closes a
    // static cycle back to this module; the import only resolves here at
    // flush time (same pattern as recordLoss in useStatisticsStore).
    if (data?.limit_rejected === true) {
      try {
        const { useStatisticsStore } = await import('../hooks/useStatisticsStore.js');
        await useStatisticsStore.getState().applyRejectedWin({ gameId: payload?.p_game_id, payload });
      } catch {}
      // Converge the enforcement cache to the limits that judged this win.
      try {
        await refreshLimitRules();
      } catch {}
      try {
        const maxMoves = data?.limit_max_moves;
        const maxTimeMs = data?.limit_max_time_ms;
        const overMoves = Number.isFinite(payload?.p_moves) && Number.isFinite(maxMoves) && payload.p_moves > maxMoves;
        useToastStore.getState().push({
          name: i18n.t('toasts.limitRejected.title'),
          description: i18n.t('toasts.limitRejected.desc', overMoves
            ? { limit: i18n.t('toasts.limitRejected.moves', { count: maxMoves }) }
            : { limit: i18n.t('toasts.limitRejected.time', { time: formatTime(maxTimeMs) }) }),
          priority: TOAST_PRIORITY.COINS,
        });
      } catch {}
    }
  },

  // Upsert the in-progress session for this (user, device). Keyed by
  // (user_id, device_id) so every save targets the same row.
  save_game_session: async (payload) => {
    const userId = useAuthStore.getState().userId;
    if (!userId) return; // flush only proceeds once a userId exists
    const telemetry = payload.achievement_telemetry ?? {};
    const { error } = await supabase
      .from('game_sessions')
      .upsert(
        {
          user_id: userId,
          device_id: payload.device_id,
          game_id: telemetry.gameId ?? globalThis.crypto?.randomUUID?.(),
          board_state: payload.board_state,
          replay_spec: payload.replay_spec,
          moves: payload.moves,
          score: payload.score,
          undos: payload.undos,
          hint_used: telemetry.hintUsed,
          undo_used: telemetry.undoUsed,
          tableau_to_tableau_moves: telemetry.tableauToTableauMoves,
          foundation_moves: telemetry.foundationMoves,
          foundation_to_tableau_moves: telemetry.foundationToTableauMoves,
          recycle_count: telemetry.recycleCount,
          foundation_first_eligible: telemetry.foundationFirstEligible,
          ace_collector_eligible: telemetry.aceCollectorEligible,
          aces_to_foundation: telemetry.acesToFoundation ?? telemetry.aceIdsToFoundation?.length ?? 0,
          ace_ids_to_foundation: telemetry.aceIdsToFoundation ?? [],
          start_time: payload.start_time,
          paused_accum_ms: payload.paused_accum_ms,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,device_id' }
      );
    if (error) throw error;
  },

  // Delete the saved session for this (user, device). The local row is deleted
  // synchronously by the caller; this mirrors the deletion to Supabase.
  clear_game_session: async (payload) => {
    const userId = useAuthStore.getState().userId;
    if (!userId) return;
    const { error } = await supabase
      .from('game_sessions')
      .delete()
      .eq('user_id', userId)
      .eq('device_id', payload.device_id);
    if (error) throw error;
  },

  // Mirror a favorite to Supabase. The local Dexie row is written
  // synchronously by the caller; this converges the server on flush.
  add_favorite: async (payload) => {
    await pushFavorite(payload ?? {});
  },

  // Mirror an unfavorite to Supabase (same local-first contract as above).
  remove_favorite: async (payload) => {
    await pushUnfavorite(payload?.seed);
  },
};
