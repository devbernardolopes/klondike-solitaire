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
};
