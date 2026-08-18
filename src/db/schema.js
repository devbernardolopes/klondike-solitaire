// db/schema.js
// Dexie schema for local persistence: game history, settings, best times.
// Settings read/write is wired through useSettingsStore; game history is not
// yet saved on game-over (TODO: wire saveGame() + best-times query).

import Dexie from 'dexie';

/**
 * @typedef {Object} GameRecord
 * @property {number} [id]          auto-increment primary key
 * @property {number} startedAt     epoch ms
 * @property {number} [finishedAt]  epoch ms (absent if not finished)
 * @property {number} moves         total moves applied
 * @property {boolean} won
 * @property {number} durationMs    elapsed time
 * @property {number} [seed]        deal seed if deterministic
 */

/**
 * @typedef {Object} SettingRecord
 * @property {string} key
 * @property {*} value
 */

export const db = new Dexie('klondike-solitaire');
db.version(1).stores({
  // primary key `++id`; indexed fields for common queries
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
});
// v2 adds the cumulative `stats` table (single keyed row of aggregates).
db.version(2).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
});
// v3 adds the `playedSeeds` table (single keyed row of won Winning-Deal seeds).
// Kept separate from `stats` so a statistics reset never clears it.
db.version(3).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
  playedSeeds: 'key',
});

/**
 * Insert a finished/abandoned game record.
 * @param {Omit<GameRecord, 'id'>} record
 * @returns {Promise<number>} the new row id
 */
export async function saveGame(record) {
  return db.games.add(record);
}

/**
 * Read a single setting value.
 * @param {string} key
 * @param {*} [fallback]
 * @returns {Promise<*>}
 */
export async function getSetting(key, fallback = undefined) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}

/**
 * Write a single setting value.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
