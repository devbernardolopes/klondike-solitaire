// components/pendingStockDraw.js
// Pure consume-once queue for stock taps that land while the stock/waste slide
// lock is held (see Board.jsx `pendingDrawRef`). Extracted as a pure function
// (no React, no DOM) so the queue semantics have a single source of truth and
// can be unit-tested under node --test without needing jsdom.
//
// Contract:
//   - queue (tap while busy) sets the flag; flush (lock released) consumes it.
//   - flush fires at most ONCE per queued tap: the flag is cleared BEFORE the
//     blocked check, so a tap queued during win / game-over / playback is
//     dropped, never latched for later — and a consumed tap never re-fires on
//     subsequent busy→idle transitions (which would self-sustain into a
//     runaway draw loop).

/**
 * @param {{ current: boolean }} pendingRef  React ref holding the queued flag
 * @param {object} args
 * @param {boolean} args.stockWasteBusy  stock/waste slide lock still held
 * @param {boolean} args.blocked         won || isOver || playbackActive
 * @returns {boolean} true ⇔ the caller should perform one queued draw/recycle
 */
export function flushPendingStockDraw(pendingRef, { stockWasteBusy, blocked }) {
  if (stockWasteBusy || !pendingRef.current) return false;
  pendingRef.current = false;
  if (blocked) return false;
  return true;
}
