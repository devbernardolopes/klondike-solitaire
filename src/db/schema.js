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
// v4 adds the `dailyResults` table: one row per completed Daily Challenge day,
// keyed by its YYYY-MM-DD date, holding that day's best score/time/moves.
db.version(4).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
  playedSeeds: 'key',
  dailyResults: 'date',
});
// v5 adds the `syncQueue` table: the offline-first outbox of pending sync
// operations (see db/syncQueue.js / sync/syncEngine.js). Each row is one RPC
// op flushed in id order; unknown types are dropped rather than blocking the queue.
db.version(5).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
  playedSeeds: 'key',
  dailyResults: 'date',
  syncQueue: '++id, type, createdAt',
});
// v6 adds the `usedRandomSeeds` table: one row per Random-Shuffle seed that has
// already been dealt, so deals never repeat. Keyed by the seed itself.
db.version(6).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
  playedSeeds: 'key',
  dailyResults: 'date',
  syncQueue: '++id, type, createdAt',
  usedRandomSeeds: 'seed',
});
// v7 adds the `activeSession` table (single keyed row holding the in-progress
// game for fast offline restore) and a `dedupeKey` index on `syncQueue` so the
// offline-first outbox can collapse same-key ops (only the latest matters).
db.version(7).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
  playedSeeds: 'key',
  dailyResults: 'date',
  syncQueue: '++id, type, createdAt, dedupeKey',
  activeSession: 'key',
  usedRandomSeeds: 'seed',
});
// v8 adds the `seedCache` table: cached remote seed pools with 24h TTL
// so the app works offline (Supabase -> Dexie -> bundled fallback).
db.version(8).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
  playedSeeds: 'key',
  dailyResults: 'date',
  syncQueue: '++id, type, createdAt, dedupeKey',
  activeSession: 'key',
  usedRandomSeeds: 'seed',
  seedCache: 'key',
});
// v9 adds the `eventProgress` table: per-event win tracking for progressive image reveal.
// One row per eventId; wonSeeds is the set of seeds (by index) already completed.
db.version(9).stores({
  games: '++id, startedAt, finishedAt, won, durationMs',
  settings: 'key',
  stats: 'key',
  playedSeeds: 'key',
  dailyResults: 'date',
  syncQueue: '++id, type, createdAt, dedupeKey',
  activeSession: 'key',
  usedRandomSeeds: 'seed',
  seedCache: 'key',
  eventProgress: 'eventId',
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
 * Read multiple setting values in a single IndexedDB transaction via
 * `bulkGet`. Returns an array in the same order as `keys`. Each entry is
 * the stored value, or the per-key fallback from `fallbackMap` (or the
 * scalar `fallback`) when the key is missing.
 * @param {string[]} keys
 * @param {Record<string, *>|*} [fallbackMap]  per-key default values, or a
 *   single default to use for any missing key when a per-key entry is absent.
 * @returns {Promise<Array<*>>}
 */
export async function getSettings(keys, fallbackMap) {
  if (!keys || keys.length === 0) return [];
  const rows = await db.settings.bulkGet(keys);
  return rows.map((row, i) => {
    if (row) return row.value;
    const key = keys[i];
    if (fallbackMap && typeof fallbackMap === 'object' && !Array.isArray(fallbackMap) && key in fallbackMap) {
      return fallbackMap[key];
    }
    return fallbackMap;
  });
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
