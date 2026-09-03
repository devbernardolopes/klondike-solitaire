// db/eventSelection.js
// Persists the player's currently-selected event deal per (eventId, pageNumber),
// plus the last-viewed page per event. Two fields, same dual-store pattern as
// db/dailySelection.js (Dexie for durability + localStorage mirror + module-
// level cache for synchronous initial reads on open).
//
// 1. Per-page deal selection
//    One Dexie settings key per event id, value is JSON:
//      { '1': <dealId>, '2': <dealId>, ... }
//    Used to pre-select a tile when the modal opens so the player resumes on
//    the same deal (and the accent outline is correctly applied).
//
// 2. Last-viewed page
//    One Dexie settings key per event id, value is the pageNumber the player
//    was last looking at. Used to land the carousel on the right page when
//    the modal re-opens.

import { getSetting, setSetting } from './schema.js';

// Dexie `settings` keys (durable, cross-session store per the app's data model).
const KEY_PREFIX = 'eventLastSelection:';
const KEY_PREFIX_LASTVIEWED = 'eventLastViewedPage:';
// localStorage mirrors so the values are available *synchronously* on a hard
// reload, before Dexie (async) has been read.
const LS_PREFIX = 'klondike:eventLastSelection:';
const LS_PREFIX_LASTVIEWED = 'klondike:eventLastViewedPage:';

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

function readLocalStorageNumber(eventId) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LS_PREFIX_LASTVIEWED + eventId);
    if (!raw) return null;
    const n = JSON.parse(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLocalStorageNumber(eventId, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_PREFIX_LASTVIEWED + eventId, JSON.stringify(value));
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

// In-memory mirror of last-viewed page per event.
//   Map<eventId, number /*pageNumber*/ | null>
const lastViewedPageCache = new Map();

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
 * Wipe all persisted selections and the last-viewed page for an event.
 * Currently unused by the UI; exposed for tests and future "reset progress"
 * affordances.
 * @param {string} eventId
 */
export function clearEventSelection(eventId) {
  cache.delete(eventId);
  lastViewedPageCache.delete(eventId);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LS_PREFIX + eventId);
      localStorage.removeItem(LS_PREFIX_LASTVIEWED + eventId);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Async load — fetch the last-viewed page for an event from Dexie. Dexie wins
 * over localStorage on conflict.
 * @param {string} eventId
 * @returns {Promise<number|null>}
 */
export async function loadLastViewedPage(eventId) {
  const v = await getSetting(KEY_PREFIX_LASTVIEWED + eventId, null);
  const n = v ? JSON.parse(v) : null;
  const resolved = Number.isInteger(n) && n > 0 ? n : null;
  lastViewedPageCache.set(eventId, resolved);
  return resolved;
}

/**
 * Synchronous mirror of the last-viewed page for an event, seeded from
 * localStorage on first call. Pair with {@link loadLastViewedPage} on open
 * to ensure the cache is fresh from Dexie.
 * @param {string} eventId
 * @returns {number|null}
 */
export function loadLastViewedPageSync(eventId) {
  if (!lastViewedPageCache.has(eventId)) {
    const v = readLocalStorageNumber(eventId);
    lastViewedPageCache.set(eventId, v);
  }
  return lastViewedPageCache.get(eventId) ?? null;
}

/**
 * Persist the last-viewed page for an event. No-op if the value did not change.
 * @param {string} eventId
 * @param {number} pageNumber
 */
export async function saveLastViewedPage(eventId, pageNumber) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
  if (lastViewedPageCache.get(eventId) === pageNumber) return;
  lastViewedPageCache.set(eventId, pageNumber);
  writeLocalStorageNumber(eventId, pageNumber);
  await setSetting(KEY_PREFIX_LASTVIEWED + eventId, JSON.stringify(pageNumber));
}

