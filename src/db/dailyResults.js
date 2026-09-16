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
 * @property {number} [lastTimeMs]  most recent winning time in ms (synced:
 *   stamped by submit_game_result on every daily win — migration 036 — and
 *   converged across devices by mergeDailyResults, latest lastWonAt wins)
 * @property {number} [lastMoves]   most recent winning move count (synced,
 *   always from the same win as lastTimeMs — never mixed across sides)
 * @property {string} [lastWonAt]   ISO timestamp of the most recent win
 *   (server now() on flush; local clock on optimistic save). Missing/null
 *   means "no known last win" (pre-036 row or never replayed) and loses to
 *   any present timestamp in the merge.
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
 * best time/moves are minimized; last time/moves always reflect this win.
 * Returns the updated row.
 * @param {string} date  YYYY-MM-DD
 * @param {{seed:number, score:number, timeMs:number, moves:number}} result
 * @returns {Promise<DailyResult>}
 */
export async function saveDailyResult(date, { seed, score, timeMs, moves }) {
  const existing = await db.dailyResults.get(date);
  // Optimistic stamp: the server overwrites lastWonAt with now() on flush,
  // which is the timestamp other devices converge on. Local clock skew only
  // matters for offline-vs-offline races before either side flushes.
  const lastWonAt = new Date().toISOString();
  let next;
  if (!existing) {
    next = {
      date,
      seed,
      bestScore: score,
      bestTimeMs: timeMs,
      bestMoves: moves,
      wins: 1,
      lastTimeMs: timeMs,
      lastMoves: moves,
      lastWonAt,
    };
  } else {
    next = {
      ...existing,
      seed: existing.seed ?? seed,
      bestScore: Math.max(existing.bestScore ?? 0, score),
      bestTimeMs: existing.bestTimeMs == null ? timeMs : Math.min(existing.bestTimeMs, timeMs),
      bestMoves: existing.bestMoves == null ? moves : Math.min(existing.bestMoves, moves),
      wins: (existing.wins || 0) + 1,
      lastTimeMs: timeMs,
      lastMoves: moves,
      lastWonAt,
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
 * Last-win fields are synced (migration 036 stamps them server-side on every
 * daily win): the side with the latest lastWonAt wins, atomically (time +
 * moves + stamp always come from the same win — never mixed across sides).
 * A missing/null lastWonAt means "no known last win" (pre-036 row or never
 * replayed) and loses to any present timestamp; when neither side has one
 * the keys stay absent so the panel reads "—".
 * Explicit server rejections don't go through here: applyRejectedWin already
 * deletes/restores the Dexie row, so a rejected win is simply absent locally.
 * @param {Array<DailyResult>} serverRows
 * @param {Array<DailyResult>} localRows
 * @returns {Array<DailyResult>} merged rows, one per date
 */
export function mergeDailyResults(serverRows, localRows) {
  const merged = new Map();
  for (const r of serverRows || []) {
    if (!r || r.date == null) continue;
    const copy = { ...r };
    // Normalize "no known last win" to absent keys (pre-036 rows arrive with
    // explicit nulls via the pull mapping); the panel treats both as "—",
    // but absent keeps the row shape identical to locally-saved ones.
    if (copy.lastTimeMs == null) delete copy.lastTimeMs;
    if (copy.lastMoves == null) delete copy.lastMoves;
    if (copy.lastWonAt == null) delete copy.lastWonAt;
    merged.set(copy.date, copy);
  }
  for (const local of localRows || []) {
    if (!local || local.date == null) continue;
    const server = merged.get(local.date);
    if (!server) {
      merged.set(local.date, { ...local });
      continue;
    }
    const mergedRow = {
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
    };
    // Synced Last (migration 036): latest lastWonAt wins, atomically. Either
    // side may carry a null/missing stamp (pre-036 row, or a locally saved
    // row from before this change) — that means "no known last win" and
    // always loses to a present timestamp. ISO-8601 strings compare
    // chronologically with plain >/<, so no Date parsing is needed.
    const serverStamp = server.lastWonAt ?? null;
    const localStamp = local.lastWonAt ?? null;
    const winner =
      serverStamp != null && (localStamp == null || serverStamp > localStamp)
        ? server
        : localStamp != null
          ? local
          : null;
    delete mergedRow.lastTimeMs;
    delete mergedRow.lastMoves;
    delete mergedRow.lastWonAt;
    if (winner) {
      if (winner.lastTimeMs != null) mergedRow.lastTimeMs = winner.lastTimeMs;
      if (winner.lastMoves != null) mergedRow.lastMoves = winner.lastMoves;
      if (winner.lastWonAt != null) mergedRow.lastWonAt = winner.lastWonAt;
    } else {
      // Legacy rows saved before lastWonAt existed carry a last win without
      // a stamp; neither side has a timestamp here (server pre-036 too), so
      // keep the locally-witnessed values rather than blanking them.
      if (local.lastTimeMs != null) mergedRow.lastTimeMs = local.lastTimeMs;
      if (local.lastMoves != null) mergedRow.lastMoves = local.lastMoves;
    }
    merged.set(local.date, mergedRow);
  }
  return Array.from(merged.values());
}
