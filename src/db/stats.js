// db/stats.js
// Cumulative, persisted game statistics. A single keyed row in the Dexie
// `stats` table holds running aggregates; every win adds to it (never
// overwrites) and reset zeroes it out. This matches the product requirement
// that score/time/moves are always *added* on win and fully cleared on reset.

import { db } from './schema.js';

const KEY = 'cumulative';

const EMPTY = {
  totalGamesPlayed: 0,
  totalGamesWon: 0,
  highestScore: 0,
  lowestTimeMs: null,
  lowestMoves: null,
  lowestUndos: null,
  currentStreak: 0,
  bestStreak: 0,
  totalTimeMsWon: 0,
  totalMovesWon: 0,
};

/**
 * @typedef {Object} CumulativeStats
 * @property {number} totalGamesPlayed
 * @property {number} totalGamesWon
 * @property {number} highestScore   best score among won games (0 if unimplemented)
 * @property {number|null} lowestTimeMs  fastest winning time in ms (null = none yet)
 * @property {number|null} lowestMoves   fewest moves in a win (null = none yet)
 * @property {number|null} lowestUndos   fewest undos in a win (null = none yet)
 * @property {number} currentStreak   consecutive wins in progress
 * @property {number} bestStreak       highest currentStreak ever reached
 */

/** @returns {Promise<CumulativeStats>} */
export async function loadStats() {
  const row = await db.stats.get(KEY);
  if (!row) return { ...EMPTY };
  const { key, ...rest } = row;
  return { ...EMPTY, ...rest };
}

/**
 * Persist the full stats row.
 * @param {CumulativeStats} stats
 * @returns {Promise<void>}
 */
export async function saveStats(stats) {
  await db.stats.put({ key: KEY, ...stats });
}

/**
 * Fold a won game into the cumulative aggregates.
 * @param {{score:number, timeMs:number, moves:number, undos:number}} win
 * @returns {Promise<CumulativeStats>} the updated row
 */
export async function addWin({ score, timeMs, moves, undos }) {
  const cur = await loadStats();
  const streak = (cur.currentStreak || 0) + 1;
  const next = {
    ...cur,
    totalGamesWon: cur.totalGamesWon + 1,
    highestScore: Math.max(cur.highestScore, score),
    lowestTimeMs: cur.lowestTimeMs == null ? timeMs : Math.min(cur.lowestTimeMs, timeMs),
    lowestMoves: cur.lowestMoves == null ? moves : Math.min(cur.lowestMoves, moves),
    lowestUndos: cur.lowestUndos == null ? undos : Math.min(cur.lowestUndos, undos),
    currentStreak: streak,
    // Best is raised immediately whenever a new record streak is reached, so the
    // Statistics modal can highlight the current streak the moment it equals/exceeds best.
    bestStreak: Math.max(cur.bestStreak || 0, streak),
    totalTimeMsWon: (cur.totalTimeMsWon || 0) + timeMs,
    totalMovesWon: (cur.totalMovesWon || 0) + moves,
    totalGamesPlayed: cur.totalGamesPlayed,
  };
  await saveStats(next);
  return next;
}

/**
 * End a losing (non-winning) game: the current streak is broken, but the best
 * streak achieved so far is preserved.
 * @returns {Promise<CumulativeStats>} the updated row
 */
export async function recordLoss() {
  const cur = await loadStats();
  const next = { ...cur, currentStreak: 0 };
  await saveStats(next);
  return next;
}

/**
 * Increment the total-games-played counter (fired when a new game's timer
 * starts). Does not touch win aggregates.
 * @returns {Promise<CumulativeStats>} the updated row
 */
export async function addGamePlayed() {
  const cur = await loadStats();
  const next = { ...cur, totalGamesPlayed: cur.totalGamesPlayed + 1 };
  await saveStats(next);
  return next;
}

/**
 * Clear every cumulative stat (games won, games played, best score/time/moves).
 * @returns {Promise<CumulativeStats>} the zeroed row
 */
export async function resetStats() {
  const next = { ...EMPTY };
  await saveStats(next);
  return next;
}
