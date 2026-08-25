// db/dailySelection.js
// Persistence for the Daily Challenge "last selected day". Remembered across
// sessions so the calendar re-opens on the player's previously-picked day
// (only when it differs from today). Stored as a single keyed row in the
// `settings` table (reusing that generic key/value store).

import { getSetting, setSetting } from './schema.js';

// Dexie `settings` key (durable, cross-session store per the app's data model).
const KEY = 'dailyLastSelection';
// localStorage mirror so the value is available *synchronously* on a hard reload,
// before Dexie (async) has been read — this is what lets the calendar open on
// the correct month with no flash.
const LS_KEY = 'klondike:dailyLastSelection';

function readLocalStorageString(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeLocalStorageString(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// In-memory mirror of the persisted last selection so the Daily Challenge modal
// can resolve its initial selection synchronously on open (without awaiting the
// Dexie round-trip). Seeded from localStorage at module load for zero-flash
// reloads; kept in sync by load/save below.
let cachedLastSelection = readLocalStorageString(LS_KEY);

/** @returns {Promise<string|null>} the last-selected YYYY-MM-DD, or null */
export async function loadLastDailySelection() {
  const v = await getSetting(KEY, null);
  // Trust Dexie when it holds a value; otherwise keep the localStorage seed.
  cachedLastSelection = v != null ? v : cachedLastSelection;
  return cachedLastSelection;
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

/** Persist the last-selected YYYY-MM-DD (Dexie + localStorage mirror). */
export async function saveLastDailySelection(date) {
  cachedLastSelection = date;
  writeLocalStorageString(LS_KEY, date);
  await setSetting(KEY, date);
}
