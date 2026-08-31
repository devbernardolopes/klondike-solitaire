// core/dailyChallenge.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
// Daily seeds are pre-generated offline (scripts/generateFeatures.mjs) and
// bundled here. Dates outside the bundled window return null; the caller may
// fall back to on-demand generation (future enhancement).

import data from '../data/dailyChallenge.json' with { type: 'json' };

const FALLBACK_SEEDS = (data && data.seeds) || {};
const FALLBACK_ANCHOR = (data && data.anchor) || null;
const FALLBACK_WINDOW_YEARS = data && typeof data.windowYears === 'number' ? data.windowYears : 0;

/** The bundled window anchor (YYYY-MM-DD). @returns {string|null} */
export function getDailyAnchor(seedsMap = null) {
  if (seedsMap) {
    const keys = Object.keys(seedsMap).sort();
    return keys[0] || FALLBACK_ANCHOR;
  }
  return FALLBACK_ANCHOR;
}

/** Number of years covered by the bundled window. @returns {number} */
export function getDailyWindowYears(seedsMap = null) {
  if (seedsMap) {
    const keys = Object.keys(seedsMap).sort();
    if (keys.length === 0) return 0;
    const start = keys[0];
    const end = keys[keys.length - 1];
    const s = start.split('-').map(Number);
    const e = end.split('-').map(Number);
    const startMs = Date.UTC(s[0], s[1] - 1, s[2]);
    const endMs = Date.UTC(e[0], e[1] - 1, e[2]);
    const days = Math.round((endMs - startMs) / 86400000) + 1;
    return Math.ceil(days / 365);
  }
  return FALLBACK_WINDOW_YEARS;
}

/** All bundled date strings, sorted ascending. @returns {string[]} */
export function listBundledDates(seedsMap = null) {
  const src = seedsMap || FALLBACK_SEEDS;
  return Object.keys(src).sort();
}

/**
 * Resolve the pre-generated solvable seed for a calendar date.
 * @param {string} dateStr  YYYY-MM-DD
 * @param {Record<string,number>} [seedsMap]  optional injected map; defaults to bundled fallback
 * @returns {number|null} the seed, or null when the date is not bundled.
 */
export function seedForDate(dateStr, seedsMap = null) {
  const src = seedsMap || FALLBACK_SEEDS;
  return Object.prototype.hasOwnProperty.call(src, dateStr) ? src[dateStr] : null;
}

/** Whether a date has a pre-generated seed bundled. @param {string} dateStr */
export function isDateBundled(dateStr, seedsMap = null) {
  return seedForDate(dateStr, seedsMap) !== null;
}

// ---- Calendar / range helpers (framework-agnostic, UTC arithmetic) ----

/** Parse a YYYY-MM-DD string into {y,m,d} (numbers). */
function parseYMD(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return { y, m, d };
}

/** Format a {y,m,d} triple into a zero-padded YYYY-MM-DD string. */
function fmtYMD(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Convert a YYYY-MM-DD string to a UTC epoch (ms). */
export function dateToUTC(dateStr) {
  const { y, m, d } = parseYMD(dateStr);
  return Date.UTC(y, m - 1, d);
}

/**
 * The full supported window as { start, end } (both YYYY-MM-DD, inclusive).
 * Derived from the bundled anchor + windowYears so it stays correct across
 * leap years (Date.UTC handles Feb 29) and multi-year windows.
 * @returns {{start:string, end:string}}
 */
export function getSupportedRange() {
  const start = getDailyAnchor();
  const wy = getDailyWindowYears();
  if (!start || !wy) return { start: '', end: '' };
  const s = parseYMD(start);
  // end = anchor + windowYears, minus one day.
  const endMs = Date.UTC(s.y + wy, s.m - 1, s.d) - 86400000;
  const e = utcToYMDfromMS(endMs);
  return { start, end: fmtYMD(e.y, e.m, e.d) };
}

function utcToYMDfromMS(ms) {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** List every year covered by the supported window (ascending). @returns {number[]} */
export function listSupportedYears() {
  const { start, end } = getSupportedRange();
  if (!start || !end) return [];
  const a = parseYMD(start);
  const b = parseYMD(end);
  const years = [];
  for (let y = a.y; y <= b.y; y++) years.push(y);
  return years;
}

/**
 * Whether a (year, month) pair falls within the supported window.
 * @param {number} y
 * @param {number} m  1-12
 */
export function isSupportedYM(y, m) {
  const { start, end } = getSupportedRange();
  if (!start || !end) return false;
  const a = parseYMD(start);
  const b = parseYMD(end);
  const idx = y * 12 + (m - 1);
  const ai = a.y * 12 + (a.m - 1);
  const bi = b.y * 12 + (b.m - 1);
  return idx >= ai && idx <= bi;
}

/** Strict chronological comparison: is `a` strictly after `b`? */
export function isAfter(a, b) {
  return dateToUTC(a) > dateToUTC(b);
}

/** Whether a date is inside the supported window (inclusive of both ends). */
export function withinSupported(dateStr) {
  const { start, end } = getSupportedRange();
  if (!start || !end) return false;
  return !isAfter(start, dateStr) && !isAfter(dateStr, end);
}

/**
 * Add (or subtract) `delta` months to a (year, month) pair, rolling the year
 * over at the boundaries. Returns { y, m } with m in 1-12.
 * @param {number} y
 * @param {number} m  1-12
 * @param {number} delta  positive or negative integer
 * @returns {{y:number, m:number}}
 */
export function addMonths(y, m, delta) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Number of days in a given month (correct across leap years). */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Format a (year, month) into its YYYY-MM key. */
export function ymKey(y, m) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** Zero-padded YYYY-MM-DD for a (y,m,d) triple. */
export function toDateStr(y, m, d) {
  return fmtYMD(y, m, d);
}
