// utils/formatTime.js
// Formats a millisecond duration as a compact "MM:SS.hh" clock string. The game
// caps play at 30:00, so minutes never overflow two digits in practice.

/**
 * @param {number} ms  duration in milliseconds
 * @returns {string}  e.g. "04:21.37" (or "00:00.00" for <= 0)
 */
export function formatTime(ms) {
  const durationMs = Math.max(0, ms);
  const totalSec = Math.floor(durationMs / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  const hundredths = String(Math.floor((durationMs % 1000) / 10)).padStart(2, '0');
  return `${m}:${s}.${hundredths}`;
}

/**
 * HUD variant of formatTime with a `centiseconds` flag for the live clock.
 * When centiseconds is false the output drops the ".hh" suffix and renders
 * "MM:SS" — fewer digits, far less re-render churn for the user who has
 * disabled centiseconds in Settings (see Toolbar.jsx `useElapsed`).
 *
 * The full `formatTime` is kept untouched so all recorded values (snapshot
 * export, Solvitaire export, Win modal time, Statistics bests/averages,
 * Leaderboard) keep showing hundredths.
 *
 * @param {number} ms  duration in milliseconds
 * @param {object} [opts]
 * @param {boolean} [opts.centiseconds=true]  when false, omit the .hh suffix
 * @returns {string}  e.g. "04:21.37" (centiseconds) or "04:21" (no hundredths)
 */
export function formatTimeClock(ms, { centiseconds = true } = {}) {
  const durationMs = Math.max(0, ms);
  const totalSec = Math.floor(durationMs / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  if (!centiseconds) return `${m}:${s}`;
  const hundredths = String(Math.floor((durationMs % 1000) / 10)).padStart(2, '0');
  return `${m}:${s}.${hundredths}`;
}

