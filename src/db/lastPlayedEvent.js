// db/lastPlayedEvent.js
// Persistence for the last-played Special Event (the event whose deal was
// most recently started — solving is not required). Drives the "Pin Last
// Played Event" list feature: the pinned row is resolved from this id.
// Stored in the generic `settings` table, mirrored in localStorage for
// synchronous access, exactly like db/eventFilters.js. Per-device only —
// never synced to the remote database. Wiped by Factory Reset.

import { db, getSetting, setSetting } from './schema.js';

// Dexie `settings` key (durable, cross-session store per the app's data model).
export const LAST_PLAYED_EVENT_KEY = 'specialEventsLastPlayed';
// localStorage mirror so the value is available *synchronously* on a hard
// reload, before Dexie (async) has been read.
export const LAST_PLAYED_EVENT_LS_KEY = 'klondike:specialEventsLastPlayed';

function readLocalStorageId(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return null;
    return raw;
  } catch {
    return null;
  }
}

function writeLocalStorageId(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value == null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {
    /* ignore */
  }
}

// In-memory mirror, seeded from localStorage at module load for zero-flash
// reloads; kept in sync by load/save below.
let cachedLastPlayedEventId = readLocalStorageId(LAST_PLAYED_EVENT_LS_KEY);

/** @returns {Promise<string|null>} the persisted last-played event id */
export async function loadLastPlayedEvent() {
  try {
    const v = await getSetting(LAST_PLAYED_EVENT_KEY, null);
    // Trust Dexie when it holds a value; otherwise keep the localStorage seed.
    if (v != null && v !== '') {
      cachedLastPlayedEventId = String(v);
      writeLocalStorageId(LAST_PLAYED_EVENT_LS_KEY, cachedLastPlayedEventId);
    }
  } catch {
    /* storage may be unavailable; the in-memory mirror stands in */
  }
  return cachedLastPlayedEventId;
}

/**
 * Synchronously return the persisted last-played event id from the in-memory
 * cache. Use this when a synchronous initial value is needed; pair with
 * {@link loadLastPlayedEvent} to populate the cache on open.
 * @returns {string|null}
 */
export function loadLastPlayedEventSync() {
  return cachedLastPlayedEventId;
}

/** Persist the last-played event id (Dexie + localStorage mirror). */
export async function saveLastPlayedEvent(eventId) {
  cachedLastPlayedEventId = eventId == null ? null : String(eventId);
  writeLocalStorageId(LAST_PLAYED_EVENT_LS_KEY, cachedLastPlayedEventId);
  try {
    if (cachedLastPlayedEventId == null) {
      await db.settings.delete(LAST_PLAYED_EVENT_KEY);
    } else {
      await setSetting(LAST_PLAYED_EVENT_KEY, cachedLastPlayedEventId);
    }
  } catch {
    /* storage may be unavailable; the mirrors above already hold it */
  }
}

/** Forget the last-played event (Factory Reset path). */
export function clearLastPlayedEvent() {
  cachedLastPlayedEventId = null;
  writeLocalStorageId(LAST_PLAYED_EVENT_LS_KEY, null);
  try {
    db.settings.delete(LAST_PLAYED_EVENT_KEY).catch(() => {});
  } catch {}
}
