// core/snapshot.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// Serializes the visible board configuration to the plain-text snapshot format
// consumed by the Settings "Take Snapshot" export. Only face-up / revealed
// cards are shown; the stock (always face-down or empty) is intentionally
// omitted per the snapshot spec.

import { SUITS } from './Card.js';

/**
 * Map a suit to its single-letter abbreviation used in the snapshot.
 * @type {Record<import('./Card.js').Suit, string>}
 */
const SUIT_LETTER = {
  hearts: 'h',
  diamonds: 'd',
  clubs: 'c',
  spades: 's',
};

/**
 * Render a card as its snapshot label: rank letter + suit letter.
 * Rank: Ace=A, 2–10 numeric, Jack=J, Queen=Q, King=K.
 * @param {{ suit: import('./Card.js').Suit, rank: number }} card
 * @returns {string}
 */
export function cardLabel(card) {
  const rank =
    card.rank === 1 ? 'A' : card.rank === 11 ? 'J' : card.rank === 12 ? 'Q' : card.rank === 13 ? 'K' : String(card.rank);
  return `${rank}${SUIT_LETTER[card.suit]}`;
}

/**
 * Render a pile of (already-ordered) cards as a comma list, or "empty".
 * @param {Array<{ suit: import('./Card.js').Suit, rank: number }>} cards
 * @returns {string}
 */
function pileLine(cards) {
  if (!cards || cards.length === 0) return 'empty';
  return cards.map(cardLabel).join(', ');
}

/**
 * The mode token for the Game Mode line and the filename: the seed number when
 * this is a winning (seeded) deal, otherwise the string "random".
 * @param {import('./GameState.js').GameState} state
 * @returns {string}
 */
export function snapshotModeToken(state) {
  return state.seed != null ? String(state.seed) : 'random';
}

/**
 * Build the plain-text snapshot of the currently visible board.
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {string}
 */
export function buildSnapshotText(state) {
  const drawCount = state.drawCount != null ? state.drawCount : 1;
  const gameMode = state.seed != null ? String(state.seed) : 'Random';
  const lines = [];

  lines.push(`# Klondike, ${drawCount}`);
  lines.push(`# Game Mode: ${gameMode}`);
  lines.push('');

  lines.push('# Foundations (left to right, 1–4)');
  state.foundations.forEach((f, i) => {
    lines.push(`F${i + 1}: ${pileLine(f)}`);
  });

  lines.push('');
  lines.push('# Waste (left to right is bottom-most to top-most)');
  lines.push(`Waste: ${pileLine(state.waste)}`);

  lines.push('');
  lines.push('# Tableau (piles 1–7, left to right; only face-up cards shown, listed top to bottom)');
  state.tableau.forEach((pile, i) => {
    // Only face-up cards are visible; tableau order is bottom→top, so reverse
    // the face-up slice to list top→bottom.
    const faceUp = pile.filter((c) => c.faceUp).reverse();
    lines.push(`${i + 1}: ${pileLine(faceUp)}`);
  });

  return lines.join('\n') + '\n';
}
