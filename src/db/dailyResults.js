// db/dailyResults.js
// Per-day persistence for the Daily Challenge. One row per completed day
// (keyed by its YYYY-MM-DD date) holds the best score / fastest time / fewest
// moves achieved for that day. Used by the Daily Challenge calendar to mark
// completed days and show a day's best results in the side panel.

import { db } from './schema.js';

/**
 * @typedef {Object} DailyResult
 * @property {string} date        YYYY-MM-DD
 * @property {number} seed        the day's deal seed
 * @property {number} bestScore   best (max) score achieved
 * @property {number} bestTimeMs  fastest winning time in ms
 * @property {number} bestMoves   fewest moves in a win
 * @property {number} wins        how many times the day was completed
 */

/** All completed daily results. @returns {Promise<DailyResult[]>} */
export async function loadAllDailyResults() {
  return db.dailyResults.toArray();
}

/** A single day's result, or null if not yet completed. @param {string} date */
export async function getDailyResult(date) {
  const row = await db.dailyResults.get(date);
  return row || null;
}

/** Delete a day's result (rollback for a server-rejected win). @param {string} date */
export async function deleteDailyResult(date) {
  await db.dailyResults.delete(date);
}

/**
 * Record (or fold into) a completed daily result. Best score is maximized;
 * best time/moves are minimized. Returns the updated row.
 * @param {string} date  YYYY-MM-DD
 * @param {{seed:number, score:number, timeMs:number, moves:number}} result
 * @returns {Promise<DailyResult>}
 */
export async function saveDailyResult(date, { seed, score, timeMs, moves }) {
  const existing = await db.dailyResults.get(date);
  let next;
  if (!existing) {
    next = {
      date,
      seed,
      bestScore: score,
      bestTimeMs: timeMs,
      bestMoves: moves,
      wins: 1,
    };
  } else {
    next = {
      ...existing,
      seed: existing.seed ?? seed,
      bestScore: Math.max(existing.bestScore ?? 0, score),
      bestTimeMs: existing.bestTimeMs == null ? timeMs : Math.min(existing.bestTimeMs, timeMs),
      bestMoves: existing.bestMoves == null ? moves : Math.min(existing.bestMoves, moves),
      wins: (existing.wins || 0) + 1,
    };
  }
  await db.dailyResults.put(next);
  return next;
}

/**
 * Merge server-pulled daily rows with local Dexie rows for a profile pull.
 * Pure (no I/O) so it is unit-testable in isolation.
 *
 * Never strips: a local-only row is a win this device witnessed but the
 * server hasn't confirmed yet (the submit is still queued or the pull raced
 * the flush), so it must survive the pull — mirroring the events-side
 * applyWinPreservingMerge/keepCoveredSolves rule that a stale read can't
 * hide a locally-witnessed win. Server rows always survive (cross-device
 * truth). Dates present on both sides fold bests the same way the server
 * upsert does (score max, time/moves min, wins max, seed prefer local).
 * Explicit server rejections don't go through here: applyRejectedWin already
 * deletes/restores the Dexie row, so a rejected win is simply absent locally.
 * @param {Array<DailyResult>} serverRows
 * @param {Array<DailyResult>} localRows
 * @returns {Array<DailyResult>} merged rows, one per date
 */
export function mergeDailyResults(serverRows, localRows) {
  const merged = new Map();
  for (const r of serverRows || []) {
    if (r && r.date != null) merged.set(r.date, { ...r });
  }
  for (const local of localRows || []) {
    if (!local || local.date == null) continue;
    const server = merged.get(local.date);
    if (!server) {
      merged.set(local.date, { ...local });
      continue;
    }
    merged.set(local.date, {
      ...server,
      seed: local.seed ?? server.seed,
      bestScore: Math.max(server.bestScore ?? 0, local.bestScore ?? 0),
      bestTimeMs: server.bestTimeMs == null
        ? local.bestTimeMs
        : local.bestTimeMs == null ? server.bestTimeMs : Math.min(server.bestTimeMs, local.bestTimeMs),
      bestMoves: server.bestMoves == null
        ? local.bestMoves
        : local.bestMoves == null ? server.bestMoves : Math.min(server.bestMoves, local.bestMoves),
      wins: Math.max(server.wins || 0, local.wins || 0),
    });
  }
  return Array.from(merged.values());
}
