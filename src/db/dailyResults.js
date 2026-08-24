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
