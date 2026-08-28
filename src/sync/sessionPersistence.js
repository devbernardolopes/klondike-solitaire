// sync/sessionPersistence.js
// Persists the in-progress game per user, per device — locally (Dexie, the
// primary/fast restore path) and as a Supabase mirror through the existing
// offline-first sync queue. One subscriber to both game and stats stores covers
// every mutation (deal/undo/draw/recycle/move/auto/autoComplete) with no
// per-action wiring, and clearing on game end is structural (delete the row).

import { supabase } from '../lib/supabaseClient.js';
import { useGameStore } from '../hooks/useGameStore.js';
import { useStatsStore } from '../hooks/useStatsStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { enqueue } from './syncEngine.js';
import {
  saveActiveSession,
  getActiveSession,
  clearActiveSession,
} from '../db/activeSession.js';
import { getSetting, setSetting } from '../db/schema.js';

const DEDUPE_KEY = 'game_session';
const DEVICE_ID_KEY = 'deviceId';

let deviceId = null;

/**
 * Resolve (and persist) the per-device UUID once at boot. Reuses the existing
 * `settings` key-value table — no new table.
 * @returns {Promise<string>}
 */
export async function ensureDeviceId() {
  if (deviceId) return deviceId;
  let id = await getSetting(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await setSetting(DEVICE_ID_KEY, id);
  }
  deviceId = id;
  return deviceId;
}

/** Synchronous read of the resolved device id (call ensureDeviceId first). */
export function getDeviceId() {
  if (!deviceId) throw new Error('deviceId not initialized');
  return deviceId;
}

/** Build the persistence payload from the current stores. */
function buildPayload() {
  const game = useGameStore.getState();
  const stats = useStatsStore.getState();
  return {
    device_id: getDeviceId(),
    board_state: game.state,
    replay_spec: game.replaySpec,
    moves: stats.moves,
    score: stats.score,
    undos: stats.undos,
    start_time: stats.startTime,
    paused_accum_ms: stats.pausedAccumMs,
  };
}

/** Persist the in-progress session locally and queue the Supabase mirror. */
function saveSession() {
  try {
    const p = buildPayload();
    const { board_state, replay_spec, moves, score, undos, start_time, paused_accum_ms } = p;
    saveActiveSession({ boardState: board_state, replaySpec: replay_spec, moves, score, undos, startTime: start_time, pausedAccumMs: paused_accum_ms });
    enqueue('save_game_session', p, DEDUPE_KEY);
  } catch {
    // deviceId not ready or a transient read failure — the next change re-saves.
  }
}

/** Clear the session locally (synchronously) and queue the Supabase delete. */
function clearSession() {
  clearActiveSession();
  try {
    enqueue('clear_game_session', { device_id: getDeviceId() }, DEDUPE_KEY);
  } catch {
    /* deviceId not ready — nothing queued, local row already cleared */
  }
}

/**
 * Subscribe to both stores; on any change, save (if the game is still in
 * progress) or clear (if it has ended). Returns an unsubscribe function.
 */
export function initSessionPersistence() {
  const handler = () => {
    if (useStatsStore.getState().endTime !== null) {
      clearSession();
    } else {
      saveSession();
    }
  };
  const unsubGame = useGameStore.subscribe(handler);
  const unsubStats = useStatsStore.subscribe(handler);
  return () => {
    unsubGame();
    unsubStats();
  };
}

/**
 * Restore a saved session at boot. Reads Dexie first (common case, offline-
 * safe); falls back to Supabase only for a linked (non-anonymous) account whose
 * local Dexie was cleared (e.g. browser-profile reinstall).
 * @returns {Promise<boolean>} true if a session was restored
 */
export async function restoreSession() {
  const local = await getActiveSession();
  if (local) {
    applyRestore(local, local.savedAt);
    return true;
  }

  const { isAnonymous, userId } = useAuthStore.getState();
  if (!isAnonymous && userId && supabase) {
    try {
      const { data, error } = await supabase
        .from('game_sessions')
        .select('board_state, replay_spec, moves, score, undos, start_time, paused_accum_ms, updated_at')
        .eq('device_id', getDeviceId())
        .single();
      if (!error && data) {
        applyRestore(data, Date.parse(data.updated_at));
        return true;
      }
    } catch {
      /* fall through to "no session" */
    }
  }
  return false;
}

/**
 * Fold the closed duration into pause accounting and hydrate the stores.
 * Treats "the tab was closed" exactly like "the tab was hidden": elapsed time
 * does not jump forward by the closed duration.
 * @param {Object} row  local (camelCase) or Supabase (snake_case) row
 * @param {number} savedAtMs  epoch ms the row was written (local) / updated_at
 */
function applyRestore(row, savedAtMs) {
  const boardState = row.boardState ?? row.board_state;
  const replaySpec = row.replaySpec ?? row.replay_spec;
  const moves = row.moves ?? 0;
  const score = row.score ?? 0;
  const undos = row.undos ?? 0;
  const startTime = row.startTime ?? row.start_time ?? null;
  const basePaused = row.pausedAccumMs ?? row.paused_accum_ms ?? 0;
  const pausedAccumMs = basePaused + Math.max(0, Date.now() - savedAtMs);

  useGameStore.setState({ state: boardState, replaySpec });
  useStatsStore.setState({
    moves,
    score,
    undos,
    startTime,
    pausedAccumMs,
    endTime: null,
    isOver: false,
    pausedAt: null,
  });

  // Mirror the restored row back into local Dexie so subsequent closes restore
  // from the fast path (and the elapsed-gap baseline resets to now).
  try {
    saveActiveSession({ boardState, replaySpec, moves, score, undos, startTime, pausedAccumMs });
  } catch {
    /* non-fatal */
  }
}
