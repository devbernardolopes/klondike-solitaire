// sync/operations.js
// Registry of sync operation handlers the engine knows how to flush. Each
// handler receives the queued op's payload and is responsible for one Supabase
// RPC call. It must throw on failure (the engine catches it, marks the op
// failed, and stops the flush so ordering is preserved). It resolves on success.
//
// This step registers only the no-arg `record_game_started` RPC to prove the
// pipe; later steps add the real stats/seed/daily/state operations here.

import { supabase } from '../lib/supabaseClient.js';

/**
 * @typedef {Object} OperationHandler
 * @property {(payload: Object) => Promise<void>} handler  throws on failure
 */

export const operations = {
  record_game_started: async () => {
    const { error } = await supabase.rpc('record_game_started');
    if (error) throw error;
  },
};
