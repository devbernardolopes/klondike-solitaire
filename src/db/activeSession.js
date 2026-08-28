// db/activeSession.js
// Persistence for the single in-progress game on this device. A single keyed row
// in the Dexie `activeSession` table holds the board + runtime counters so an
// in-progress game survives a tab close / refresh without a network round trip.
// The Supabase mirror (game_sessions) is pushed through the sync queue; this
// local row is the primary restore path and the source of truth offline.

import { db } from './schema.js';

const KEY = 'current';

/**
 * Persist the in-progress session. `savedAt` is stamped at write time so a later
 * restore can fold the closed duration into the pause accounting.
 * @param {Object} row
 * @param {Object} row.boardState
 * @param {Object} row.replaySpec
 * @param {number} row.moves
 * @param {number} row.score
 * @param {number} row.undos
 * @param {number|null} row.startTime
 * @param {number} row.pausedAccumMs
 * @returns {Promise<void>}
 */
export async function saveActiveSession(row) {
  await db.activeSession.put({ key: KEY, ...row, savedAt: Date.now() });
}

/**
 * @returns {Promise<Object|undefined>} the saved session row, or undefined
 */
export async function getActiveSession() {
  return db.activeSession.get(KEY);
}

/**
 * Remove the saved session (called when a game ends).
 * @returns {Promise<void>}
 */
export async function clearActiveSession() {
  await db.activeSession.delete(KEY);
}
