// db/dailySelection.js
// Persistence for the Daily Challenge "last selected day". Remembered across
// sessions so the calendar re-opens on the player's previously-picked day
// (only when it differs from today). Stored as a single keyed row in the
// `settings` table (reusing that generic key/value store).

import { getSetting, setSetting } from './schema.js';

const KEY = 'dailyLastSelection';

// In-memory mirror of the persisted last selection so the Daily Challenge modal
// can resolve its initial selection synchronously on open (without awaiting the
// Dexie round-trip). Kept in sync by load/save below.
let cachedLastSelection = null;

/** @returns {Promise<string|null>} the last-selected YYYY-MM-DD, or null */
export async function loadLastDailySelection() {
  const v = await getSetting(KEY, null);
  cachedLastSelection = v;
  return v;
}

/**
 * Synchronously return the last-selected YYYY-MM-DD (or null) from the in-memory
 * cache. Use this when a synchronous initial value is needed; pair with
 * {@link loadLastDailySelection} to populate the cache on open.
 * @returns {string|null}
 */
export function loadLastDailySelectionSync() {
  return cachedLastSelection;
}

/** Persist the last-selected YYYY-MM-DD. */
export async function saveLastDailySelection(date) {
  cachedLastSelection = date;
  await setSetting(KEY, date);
}
