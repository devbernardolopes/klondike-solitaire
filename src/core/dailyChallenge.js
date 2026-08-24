// core/dailyChallenge.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
// Daily seeds are pre-generated offline (scripts/generateFeatures.mjs) and
// bundled here. Dates outside the bundled window return null; the caller may
// fall back to on-demand generation (future enhancement).

import data from '../data/dailyChallenge.json' with { type: 'json' };

const SEEDS = (data && data.seeds) || {};

/** The bundled window anchor (YYYY-MM-DD). @returns {string|null} */
export function getDailyAnchor() {
  return (data && data.anchor) || null;
}

/** Number of years covered by the bundled window. @returns {number} */
export function getDailyWindowYears() {
  return data && typeof data.windowYears === 'number' ? data.windowYears : 0;
}

/** All bundled date strings, sorted ascending. @returns {string[]} */
export function listBundledDates() {
  return Object.keys(SEEDS).sort();
}

/**
 * Resolve the pre-generated solvable seed for a calendar date.
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {number|null} the seed, or null when the date is not bundled.
 */
export function seedForDate(dateStr) {
  return Object.prototype.hasOwnProperty.call(SEEDS, dateStr) ? SEEDS[dateStr] : null;
}

/** Whether a date has a pre-generated seed bundled. @param {string} dateStr */
export function isDateBundled(dateStr) {
  return seedForDate(dateStr) !== null;
}
