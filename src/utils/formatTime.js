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
