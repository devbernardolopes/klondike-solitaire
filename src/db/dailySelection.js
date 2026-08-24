// db/dailySelection.js
// Persistence for the Daily Challenge "last selected day". Remembered across
// sessions so the calendar re-opens on the player's previously-picked day
// (only when it differs from today). Stored as a single keyed row in the
// `settings` table (reusing that generic key/value store).

import { getSetting, setSetting } from './schema.js';

const KEY = 'dailyLastSelection';

/** @returns {Promise<string|null>} the last-selected YYYY-MM-DD, or null */
export async function loadLastDailySelection() {
  return getSetting(KEY, null);
}

/** Persist the last-selected YYYY-MM-DD. */
export async function saveLastDailySelection(date) {
  await setSetting(KEY, date);
}
