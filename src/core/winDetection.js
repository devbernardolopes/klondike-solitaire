// core/winDetection.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.

/**
 * A game is won when every foundation holds a complete 13-card suit run
 * (Ace→King), i.e. all 52 cards are off the tableau/stock/waste.
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {boolean}
 */
export function isWon(state) {
  const totalFoundationCards = state.foundations.reduce(
    (sum, f) => sum + f.length,
    0,
  );
  if (totalFoundationCards !== 52) return false;
  // Each foundation must be a complete, same-suit 1..13 run.
  return state.foundations.every((f) => {
    if (f.length !== 13) return false;
    const suit = f[0].suit;
    return f.every((c, i) => c.suit === suit && c.rank === i + 1);
  });
}
