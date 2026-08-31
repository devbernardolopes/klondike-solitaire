// sync/operations.js
// Registry of sync operation handlers the engine knows how to flush. Each
// handler receives the queued op's payload and is responsible for one Supabase
// RPC call. It must throw on failure (the engine catches it, marks the op
// failed, and stops the flush so ordering is preserved). It resolves on success.
//
// This step registers only the no-arg `record_game_started` RPC to prove the
// pipe; later steps add the real stats/seed/daily/state operations here.

import { supabase } from '../lib/supabaseClient.js';
import { useAchievementEventsStore } from '../hooks/useAchievementEventsStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';

/**
 * @typedef {Object} OperationHandler
 * @property {(payload: Object) => Promise<void>} handler  throws on failure
 */

export const operations = {
  record_game_started: async () => {
    const { error } = await supabase.rpc('record_game_started');
    if (error) throw error;
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
  },

  // Upsert the in-progress session for this (user, device). Keyed by
  // (user_id, device_id) so every save targets the same row.
  save_game_session: async (payload) => {
    const userId = useAuthStore.getState().userId;
    if (!userId) return; // flush only proceeds once a userId exists
    const { error } = await supabase
      .from('game_sessions')
      .upsert(
        {
          user_id: userId,
          device_id: payload.device_id,
          board_state: payload.board_state,
          replay_spec: payload.replay_spec,
          moves: payload.moves,
          score: payload.score,
          undos: payload.undos,
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

  record_event_win: async (payload) => {
    const { error } = await supabase.rpc('record_event_win', { p_event_id: payload.event_id, p_seed: payload.seed });
    if (error) throw error;
  },
};
