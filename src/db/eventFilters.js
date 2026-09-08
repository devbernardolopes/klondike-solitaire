// db/eventFilters.js
// Persistence for the Special Events list filter toggles (active years +
// "not completed only"). Remembered across sessions so the list re-opens
// with the player's last-used filter, even after a full page reload.
// Stored as a single object in the `settings` table (reusing that generic
// key/value store), mirrored in localStorage for synchronous access.

import { getSetting, setSetting } from './schema.js';

// Dexie `settings` key (durable, cross-session store per the app's data model).
const KEY = 'specialEventsFilters';
// localStorage mirror so the value is available *synchronously* on a hard
// reload, before Dexie (async) has been read — the list opens with the right
// filter on first paint instead of flashing the unfiltered default.
const LS_KEY = 'klondike:specialEventsFilters';

function readLocalStorageObject(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalStorageObject(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// Normalize any stored/loaded value into { years: number[], notCompletedOnly: boolean }.
function sanitize(v) {
  const years = Array.isArray(v?.years)
    ? v.years.filter((y) => Number.isFinite(y)).map((y) => Number(y))
    : [];
  return { years, notCompletedOnly: v?.notCompletedOnly === true };
}

// In-memory mirror, seeded from localStorage at module load for zero-flash
// reloads; kept in sync by load/save below.
let cachedFilters = sanitize(readLocalStorageObject(LS_KEY));

/** @returns {Promise<{years:number[],notCompletedOnly:boolean}>} the persisted filters */
export async function loadEventFilters() {
  const v = await getSetting(KEY, null);
  // Trust Dexie when it holds a value; otherwise keep the localStorage seed.
  if (v != null) {
    cachedFilters = sanitize(v);
    writeLocalStorageObject(LS_KEY, cachedFilters);
  }
  return { years: [...cachedFilters.years], notCompletedOnly: cachedFilters.notCompletedOnly };
}

/**
 * Synchronously return the persisted filters from the in-memory cache. Use
 * this when a synchronous initial value is needed; pair with
 * {@link loadEventFilters} to populate the cache on open.
 * @returns {{years:number[],notCompletedOnly:boolean}}
 */
export function loadEventFiltersSync() {
  return { years: [...cachedFilters.years], notCompletedOnly: cachedFilters.notCompletedOnly };
}

/** Persist the filters (Dexie + localStorage mirror). */
export async function saveEventFilters(filters) {
  cachedFilters = sanitize(filters);
  writeLocalStorageObject(LS_KEY, cachedFilters);
  await setSetting(KEY, cachedFilters);
}
