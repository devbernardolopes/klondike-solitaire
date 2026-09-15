// utils/formatCoins.js
// Hybrid coin-balance formatting for the top HUD. Exact grouped digits up to
// COMPACT_THRESHOLD, compact K/M notation above so wide balances never squeeze
// the Time/Moves columns or collide with the side buttons at 360px widths.
// The full exact value always survives in the HUD `title` + `aria-label`.

export const COINS_COMPACT_THRESHOLD = 100000;

/**
 * Coerce any coin value to a safe non-negative integer for display.
 * @param {unknown} value
 * @returns {number}
 */
function toSafeCoins(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * Exact grouped form, e.g. 99999 -> "99,999" (locale-aware).
 * @param {unknown} value coin balance
 * @param {string} [locale='en']
 * @returns {string}
 */
export function formatCoinsFull(value, locale = 'en') {
  const safe = toSafeCoins(value);
  try {
    return new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 0 }).format(safe);
  } catch {
    return String(safe);
  }
}

/**
 * HUD short form: exact grouped below the threshold, compact above
 * (100000 -> "100K", 1234567 -> "1.2M", locale-aware).
 * @param {unknown} value coin balance
 * @param {string} [locale='en']
 * @returns {string}
 */
export function formatCoinsShort(value, locale = 'en') {
  const safe = toSafeCoins(value);
  if (safe < COINS_COMPACT_THRESHOLD) return formatCoinsFull(safe, locale);
  try {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(safe);
  } catch {
    return formatCoinsFull(safe, locale);
  }
}
