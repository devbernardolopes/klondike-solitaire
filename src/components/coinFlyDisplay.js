// components/coinFlyDisplay.js
// Pure display helper for the win coin flight. While the flight is active the
// Toolbar masks the (already fully-credited) store balance with a progressive
// count so the user sees +1 per landing; otherwise the store value shows.
// Extracted pure so it is exhaustively unit-testable under node --test.

/**
 * @param {object} args
 * @param {number} args.coins   store balance (fully credited underneath)
 * @param {object} [args.flight] coinFlight slice from useUiStore
 * @returns {number} the balance number to render
 */
export function visibleCoins({ coins, flight }) {
  if (!flight || !flight.active) return coins;
  const landed = Math.max(0, Math.min(flight.landed ?? 0, flight.total ?? 0));
  return (flight.base ?? 0) + landed;
}
