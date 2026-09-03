// db/eventSelection.js
// Persists the player's currently-selected event deal per (eventId, pageNumber).
// One Dexie settings key per event id, value is JSON:
//   { '1': <dealId>, '2': <dealId>, ... }
// Same dual-store pattern as db/dailySelection.js: Dexie for durability plus a
// localStorage mirror with a module-level cache so the modal can resolve the
// initial selection synchronously on open (no flash-to-default on reload).

import { getSetting, setSetting } from './schema.js';

// Dexie `settings` key (durable, cross-session store per the app's data model).
const KEY_PREFIX = 'eventLastSelection:';
// localStorage mirror so the value is available *synchronously* on a hard
// reload, before Dexie (async) has been read.
const LS_PREFIX = 'klondike:eventLastSelection:';

function readLocalStorageObject(eventId) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LS_PREFIX + eventId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeLocalStorageObject(eventId, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_PREFIX + eventId, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

// In-memory mirror of persisted per-event selections so the Event Detail modal
// can resolve the initial selection synchronously on open (without awaiting
// the Dexie round-trip). Seeded lazily from localStorage on first read; kept
// in sync by load/save below.
//   Map<eventId, Record<string /*pageNumber*/, number /*dealId*/>>
const cache = new Map();

function seedCacheFromLocalStorage(eventId) {
  const obj = readLocalStorageObject(eventId);
  cache.set(eventId, obj || {});
  return cache.get(eventId);
}

/**
 * Async load — fetch the per-page selection map for an event from Dexie and
 * merge it over the localStorage seed (Dexie wins on conflict, since it is the
 * durable store). Result is cached in-memory.
 * @param {string} eventId
 * @returns {Promise<Record<string, number>>}
 */
export async function loadEventSelection(eventId) {
  const v = await getSetting(KEY_PREFIX + eventId, null);
  const fromDb = v ? safeParse(v) : null;
  const ls = readLocalStorageObject(eventId) || {};
  const merged = { ...ls, ...(fromDb || {}) };
  cache.set(eventId, merged);
  return merged;
}

/**
 * Synchronous mirror. Use this when a synchronous initial value is needed
 * (e.g. modal open time); pair with {@link loadEventSelection} on open to
 * ensure the cache is fresh from Dexie.
 * @param {string} eventId
 * @returns {Record<string, number>}
 */
export function loadEventSelectionSync(eventId) {
  if (!cache.has(eventId)) return seedCacheFromLocalStorage(eventId);
  return cache.get(eventId);
}

/**
 * Persist a single page's selection for an event. Writes through to both
 * Dexie (durable) and localStorage (sync mirror). No-op if the value did not
 * actually change.
 * @param {string} eventId
 * @param {number|string} pageNumber
 * @param {number} dealId
 */
export async function saveEventSelection(eventId, pageNumber, dealId) {
  const cur = loadEventSelectionSync(eventId);
  const key = String(pageNumber);
  if (cur[key] === dealId) return;
  const next = { ...cur, [key]: dealId };
  cache.set(eventId, next);
  writeLocalStorageObject(eventId, next);
  await setSetting(KEY_PREFIX + eventId, JSON.stringify(next));
}

/**
 * Wipe all persisted selections for an event. Currently unused by the UI;
 * exposed for tests and future "reset progress" affordances.
 * @param {string} eventId
 */
export function clearEventSelection(eventId) {
  cache.delete(eventId);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_PREFIX + eventId);
  } catch {
    /* ignore */
  }
}
