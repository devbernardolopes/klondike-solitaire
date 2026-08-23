// utils/formatTime.js
// Formats a millisecond duration as a compact "M:SS" clock string. Used by the
// win modal to display the finished game's elapsed time. The game caps play at
// 60:00, so minutes never overflow two digits in practice.

/**
 * @param {number} ms  duration in milliseconds
 * @returns {string}  e.g. "4:21" (or "0:00" for <= 0)
 */
export function formatTime(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
