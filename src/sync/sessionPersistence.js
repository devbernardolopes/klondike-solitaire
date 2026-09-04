// sync/sessionPersistence.js
// Persists the in-progress game per user, per device — locally (Dexie, the
// primary/fast restore path) and as a Supabase mirror through the existing
// offline-first sync queue. One subscriber to both game and stats stores covers
// every mutation (deal/undo/draw/recycle/move/auto/autoComplete) with no
// per-action wiring, and clearing on game end is structural (delete the row).

import { supabase } from '../lib/supabaseClient.js';
import { shallow } from 'zustand/shallow';
import { useGameStore } from '../hooks/useGameStore.js';
import { createAchievementTelemetry, useStatsStore } from '../hooks/useStatsStore.js';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { useUiStore } from '../hooks/useUiStore.js';
import { enqueue } from './syncEngine.js';
import {
  saveActiveSession,
  getActiveSession,
  clearActiveSession,
} from '../db/activeSession.js';
import { getSetting, setSetting } from '../db/schema.js';

const DEDUPE_KEY = 'game_session';
const DEVICE_ID_KEY = 'deviceId';

// Trailing debounce (ms) on the *remote* enqueue only. The local Dexie write is
// immediate (cheap, and the fast restore path); this lets a burst of legitimate
// rapid changes (deal stagger, auto-complete cascade) settle into a single
// Supabase upsert instead of firing one awaited network call per change.
const REMOTE_DEBOUNCE_MS = 400;
let saveTimer = null;

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
    achievement_telemetry: stats.achievementTelemetry,
    start_time: stats.startTime,
    paused_accum_ms: stats.pausedAccumMs,
  };
}

/** Persist the in-progress session locally (immediate) and queue the Supabase
 *  mirror on a trailing debounce. */
function saveSession() {
  try {
    const p = buildPayload();
    const { board_state, replay_spec, moves, score, undos, achievement_telemetry, start_time, paused_accum_ms } = p;
    saveActiveSession({ boardState: board_state, replaySpec: replay_spec, moves, score, undos, achievementTelemetry: achievement_telemetry, startTime: start_time, pausedAccumMs: paused_accum_ms });
    // Coalesce bursts into a single remote upsert.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      enqueue('save_game_session', p, DEDUPE_KEY);
    }, REMOTE_DEBOUNCE_MS);
  } catch {
    // deviceId not ready or a transient read failure — the next change re-saves.
  }
}

/** Clear the session locally (synchronously) and queue the Supabase delete. */
function clearSession() {
  // Cancel any pending debounced save so it cannot fire after the clear and
  // re-add a save row that the clear is about to delete.
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  clearActiveSession();
  try {
    enqueue('clear_game_session', { device_id: getDeviceId() }, DEDUPE_KEY);
  } catch {
    /* deviceId not ready — nothing queued, local row already cleared */
  }
}

/**
 * Subscribe to both stores. The handlers fire only when a *persistable* field
 * changes (board `state` for the game store; the counters/start/end/pause-accum
 * for the stats store) — NOT on internal bookkeeping like `autoCompleting`,
 * `autoMoveState`, `lastActionMeta`, or `pausedAt` (which flips on every tab
 * blur/focus but is not itself something worth persisting; `pausedAccumMs` is).
 * Returns an unsubscribe function.
 */
export function initSessionPersistence() {
  const handler = () => {
    if (useStatsStore.getState().endTime !== null) {
      clearSession();
    } else {
      saveSession();
    }
  };
  const unsubGame = useGameStore.subscribe((s) => s.state, handler);
  const unsubStats = useStatsStore.subscribe(
    (s) => [s.moves, s.score, s.undos, s.achievementTelemetry, s.startTime, s.endTime, s.isOver, s.pausedAccumMs],
    handler,
    { equalityFn: shallow },
  );
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
        .select('game_id, board_state, replay_spec, moves, score, undos, hint_used, undo_used, tableau_to_tableau_moves, foundation_moves, foundation_to_tableau_moves, recycle_count, foundation_first_eligible, ace_collector_eligible, aces_to_foundation, ace_ids_to_foundation, start_time, paused_accum_ms, updated_at')
        .eq('device_id', getDeviceId())
        .maybeSingle();
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
  // `currentGameKind` is UI-only, so reconstruct it from the persisted replay
  // description before App marks bootstrap complete. Older sessions may not
  // have stored the kind; order-based specs are random, seeded specs are the
  // legacy Winning Deal shape.
  const restoredKind = replaySpec?.kind
    ?? (Array.isArray(replaySpec?.order)
      ? 'random'
      : replaySpec?.seed !== undefined ? 'winning' : null);
  const restoredDate = restoredKind === 'daily' ? (replaySpec?.date ?? null) : null;
  const restoredEventDealId = restoredKind === 'event' ? (replaySpec?.eventDealId ?? null) : null;
  const restoredEventId = restoredKind === 'event' ? (replaySpec?.eventId ?? null) : null;
  const restoredEventTitle = restoredKind === 'event' ? (replaySpec?.eventTitle ?? null) : null;
  const moves = row.moves ?? 0;
  const score = row.score ?? 0;
  const undos = row.undos ?? 0;
  const achievementTelemetry = row.achievementTelemetry ?? (row.game_id
    ? {
        gameId: row.game_id,
        hintUsed: row.hint_used ?? false,
        undoUsed: row.undo_used ?? undos > 0,
        tableauToTableauMoves: row.tableau_to_tableau_moves ?? 0,
        foundationMoves: row.foundation_moves ?? 0,
        foundationToTableauMoves: row.foundation_to_tableau_moves ?? 0,
        recycleCount: row.recycle_count ?? 0,
        foundationFirstEligible: row.foundation_first_eligible ?? true,
        aceCollectorEligible: row.ace_collector_eligible ?? true,
        acesToFoundation: row.aces_to_foundation ?? row.ace_ids_to_foundation?.length ?? 0,
        aceIdsToFoundation: row.ace_ids_to_foundation ?? [],
      }
    : createAchievementTelemetry());
  const startTime = row.startTime ?? row.start_time ?? null;
  const basePaused = row.pausedAccumMs ?? row.paused_accum_ms ?? 0;
  const pausedAccumMs =
    startTime === null ? basePaused : basePaused + Math.max(0, Date.now() - savedAtMs);

  useGameStore.setState({ state: boardState, replaySpec });
  useUiStore.getState().setCurrentGame(restoredKind, restoredDate, restoredEventDealId);
  if (restoredKind === 'event' && restoredEventId) {
    useUiStore.getState().setCurrentEventMeta(restoredEventId, restoredEventTitle);
  }
  useStatsStore.setState({
    moves,
    score,
    undos,
    achievementTelemetry,
    startTime,
    pausedAccumMs,
    endTime: null,
    isOver: false,
    pausedAt: null,
  });

  const endTime = row.endTime ?? row.end_time ?? null;
  const isUnstartedDeal =
    moves === 0 &&
    startTime === null &&
    endTime === null &&
    !row.isOver &&
    replaySpec &&
    (replaySpec.seed !== undefined || Array.isArray(replaySpec.order)) &&
    !useGameStore.getState().isWon();
  if (isUnstartedDeal) useGameStore.getState().replayRestoredDeal(replaySpec);

  // Mirror the restored row back into local Dexie so subsequent closes restore
  // from the fast path (and the elapsed-gap baseline resets to now).
  try {
    saveActiveSession({ boardState, replaySpec, moves, score, undos, achievementTelemetry, startTime, pausedAccumMs });
  } catch {
    /* non-fatal */
  }
}
