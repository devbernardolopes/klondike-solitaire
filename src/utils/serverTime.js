// utils/serverTime.js
// Authoritative "today" source for the Daily Challenge calendar. We fetch the
// current UTC date from a public time API so the player cannot cheat the daily
// by rolling their device clock backwards/forwards. On ANY failure (offline,
// DNS error, non-200, malformed payload, timeout) we HARD-FALLBACK to a fixed
// date (2026-01-01) and NEVER fall back to the device clock — the product
// requirement is explicit that the device clock must never be trusted.

// Fixed fallback epoch (UTC ms) for 2026-01-01T00:00:00Z.
const FALLBACK_UTC = Date.UTC(2026, 0, 1);

// Cache of the last successfully-fetched server "now" (UTC ms), so callers can
// resolve an authoritative date synchronously on repeat opens without paying the
// network round-trip every time. Still sourced only from the server; the device
// clock is never used as a value.
let cachedServerNow = null;

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
  const ms = await fetchServerNow(timeoutMs);
  if (Number.isFinite(ms)) cachedServerNow = ms;
  return ms;
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
 * Fetch the authoritative current date (UTC) from a public time API.
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<number>} UTC epoch ms (falls back to FALLBACK_UTC on error)
 */
export async function fetchServerNow(timeoutMs = 4000) {
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
    if (!res || !res.ok) return FALLBACK_UTC;
    const data = await res.json();
    if (!data || typeof data.year !== 'number' || typeof data.month !== 'number' || typeof data.day !== 'number') {
      return FALLBACK_UTC;
    }
    const ms = Date.UTC(data.year, data.month - 1, data.day);
    if (!Number.isFinite(ms)) return FALLBACK_UTC;
    cachedServerNow = ms;
    return ms;
  } catch {
    // Network failure, abort, parse error — anything. Never trust the device.
    return FALLBACK_UTC;
  }
}
