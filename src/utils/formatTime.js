// utils/formatTime.js
// Formats a millisecond duration as a compact "M:SS" clock string. Used by the
// win modal to display the finished game's elapsed time. The game caps play at
// 60:00, so minutes never overflow two digits in practice.

/**
 * @param {number} ms  duration in milliseconds
 * @returns {string}  e.g. "04:21" (or "00:00" for <= 0)
 */
export function formatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}
