// core/toastDuration.js
// Framework-agnostic toast-duration helpers (plain JS: no React, DOM, or UI
// imports). The Toast Duration setting lives in useSettingsStore (persisted
// via Dexie with a `klondike:toastDuration` localStorage first-paint mirror);
// useToastStore reads that mirror at dwell-start time so neither store has to
// import the other (importing the settings store would pull i18n/JSON into
// node --test, which plain Node cannot load).

/** Minimum toast dwell, in whole seconds (slider floor). */
export const TOAST_DURATION_MIN = 1;

/** Maximum toast dwell, in whole seconds (slider ceiling). */
export const TOAST_DURATION_MAX = 5;

/** Default toast dwell, in whole seconds. Matches the historical hardcoded dwell. */
export const TOAST_DURATION_DEFAULT = 5;

/** localStorage first-paint mirror key for the persisted setting. */
export const TOAST_DURATION_LS_KEY = 'klondike:toastDuration';

/**
 * Clamp any value to a whole-second toast duration within
 * [TOAST_DURATION_MIN, TOAST_DURATION_MAX]. Absent or non-numeric input falls
 * back to the default so a missing/corrupt persisted value can never break
 * the dwell timer (and a fresh install keeps the historical 5s dwell).
 * @param {*} v
 * @returns {number}
 */
export function clampToastDuration(v) {
  if (v == null || v === '') return TOAST_DURATION_DEFAULT;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return TOAST_DURATION_DEFAULT;
  return Math.min(TOAST_DURATION_MAX, Math.max(TOAST_DURATION_MIN, n));
}
