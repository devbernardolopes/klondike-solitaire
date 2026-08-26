// utils/serverTime.js
// Authoritative "today" source for the Daily Challenge calendar. We fetch the
// current UTC date from a public time API so the player cannot cheat the daily
// by rolling their device clock backwards/forwards. On ANY failure (offline,
// DNS error, non-200, malformed payload, timeout) we HARD-FALLBACK to a fixed
// date (2026-01-01) and NEVER fall back to the device clock — the product
// requirement is explicit that the device clock must never be trusted.

// Fixed fallback epoch (UTC ms) for 2026-01-01T00:00:00Z.
const FALLBACK_UTC = Date.UTC(2026, 0, 1);

// On a failed server fetch we must NOT collapse "today" down to the hard
// fallback (which equals the daily window anchor, 2026-01-01) — doing so marks
// every later day as "future" and disables the entire calendar. When we already
// have a known-good cached server time, keep it; only use the anchor as a last
// resort when there is no cached value at all (first-ever load, fully offline).
function fallbackNow() {
  return cachedServerNow != null ? cachedServerNow : FALLBACK_UTC;
}

// localStorage key holding the last server "now" (UTC ms) as a string, so it can
// be re-seeded synchronously on a full page reload (before any network call).
const LS_KEY_SERVER_NOW = 'klondike:serverNow';

// Read a synchronous, durable value from localStorage. Guarded so it is a no-op
// in non-browser environments (e.g. `node --test`) and when storage is blocked.
function readLocalStorageNumber(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Persist a value to localStorage, ignoring failures (quota/private mode).
function writeLocalStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

// Cache of the last successfully-fetched server "now" (UTC ms), so callers can
// resolve an authoritative date synchronously on repeat opens without paying the
// network round-trip every time. Seeded from localStorage at module load so a
// hard reload still has an (almost always correct) value before paint. Still
// sourced only from the server; the device clock is never used as a value.
let cachedServerNow = readLocalStorageNumber(LS_KEY_SERVER_NOW);

/** @returns {number} the hard-fallback epoch (UTC ms). */
export function getFallbackUTC() {
  return FALLBACK_UTC;
}

/**
 * Synchronously return the last known authoritative "now" (UTC ms), or null when
 * the server time has not yet been fetched this session. Callers should fall
 * back to {@link getFallbackUTC()} when this returns null.
 * @returns {number|null}
 */
export function getCachedServerNow() {
  return cachedServerNow;
}

/**
 * Fire-and-forget refresh of the cached server time. Resolves the network call
 * in the background and updates the cache; never rejects. Callers that need the
 * value synchronously should read {@link getCachedServerNow()} immediately and
 * treat this only as a later refinement.
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<number>}
 */
export async function refreshServerNow(timeoutMs = 4000) {
  const ms = await fetchServerNowRaw(timeoutMs);
  if (ms != null) return ms;
  return cachedServerNow != null ? cachedServerNow : getFallbackUTC();
}

/**
 * Convert a calendar date to a UTC epoch (ms). Month is 1-based.
 * @param {number} y  year
 * @param {number} m  month 1-12
 * @param {number} d  day 1-31
 * @returns {number} UTC epoch ms
 */
export function ymdToUTC(y, m, d) {
  return Date.UTC(y, m - 1, d);
}

/**
 * Convert a UTC epoch (ms) to a calendar date.
 * @param {number} ms
 * @returns {{y:number, m:number, d:number}}
 */
export function utcToYMD(ms) {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Low-level fetch of the authoritative current date (UTC) from a public time
 * API. Resolves with the server epoch (ms) on success, or `null` when the
 * request fails for any reason. On success it records the value in the cache
 * and localStorage. Callers that need a usable "today" even on failure should
 * use {@link fetchServerNow} / {@link refreshServerNow} instead.
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<number|null>}
 */
async function fetchServerNowRaw(timeoutMs = 4000) {
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    const res = await fetch('https://timeapi.io/api/Time/current/zone?timeZone=UTC', {
      signal: controller ? controller.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.year !== 'number' || typeof data.month !== 'number' || typeof data.day !== 'number') {
      return null;
    }
    const ms = Date.UTC(data.year, data.month - 1, data.day);
    if (!Number.isFinite(ms)) return null;
    cachedServerNow = ms;
    writeLocalStorage(LS_KEY_SERVER_NOW, ms);
    return ms;
  } catch {
    // Network failure, abort, parse error — anything. Never trust the device.
    return null;
  }
}

/**
 * Fetch the authoritative current date (UTC) from a public time API.
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<number>} UTC epoch ms (falls back to the last-known-good
 *   cached time, or the hard fallback, on error — so callers always get a
 *   usable value).
 */
export async function fetchServerNow(timeoutMs = 4000) {
  const ms = await fetchServerNowRaw(timeoutMs);
  return ms != null ? ms : fallbackNow();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Refresh the cached server time, retrying on failure with a fixed delay and a
 * bounded number of attempts so a flaky time API eventually resolves without
 * the user having to close and reopen the calendar. Cancellable via
 * `shouldCancel` (e.g. when the modal closes) to avoid stray updates/requests.
 * @param {{timeoutMs?:number, maxAttempts?:number, delayMs?:number, shouldCancel?:()=>boolean}} [opts]
 * @returns {Promise<number|null>} the authoritative epoch on success, or null
 *   if all attempts failed / were cancelled.
 */
export async function refreshServerNowWithRetry({
  timeoutMs = 4000,
  maxAttempts = 5,
  delayMs = 2000,
  shouldCancel = null,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (shouldCancel && shouldCancel()) return null;
    const ms = await fetchServerNowRaw(timeoutMs);
    if (ms != null) return ms;
    if (attempt < maxAttempts && !(shouldCancel && shouldCancel())) {
      await delay(delayMs);
    }
  }
  return null;
}
