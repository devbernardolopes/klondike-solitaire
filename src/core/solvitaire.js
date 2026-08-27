// core/solvitaire.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// Serializes the START configuration of a deal to the plain-text Solvitaire
// format described in `.other/solvitaire.md`. Unlike `snapshot.js`, every card
// is exposed (face-down cards are NOT hidden as "00"), and the layout always
// reflects the initial deal — never the current board arrangement.
//
// The Solvitaire reader treats each file line as a deal "round". For round r
// (0-indexed) the line lists the cards dealt to columns r..6 (so columns 0..r-1
// are skipped). Mapping our pile p (bottom→top array Q[p]) onto that layout
// means `row_r[p] = Q[p][r]` for p in r..6. The reader then rebuilds pile p from
// the cards it sees in column p across the rounds, which reproduces Q[p] exactly
// (bottom→top), so the exported deal is identical to the game's starting board.

import { SUITS } from './Card.js';

/**
 * Map a suit to its single-letter abbreviation used in the Solvitaire layout.
 * @type {Record<import('./Card.js').Suit, string>}
 */
const SUIT_LETTER = {
  hearts: 'h',
  diamonds: 'd',
  clubs: 'c',
  spades: 's',
};

/**
 * Render a card as its Solvitaire label: rank letter + suit letter. Rank:
 * Ace=A, 2–10 numeric, Jack=J, Queen=Q, King=K. All cards are exposed
 * regardless of face orientation.
 * @param {{ suit: import('./Card.js').Suit, rank: number }} card
 * @returns {string}
 */
export function cardLabel(card) {
  const rank =
    card.rank === 1 ? 'A' : card.rank === 11 ? 'J' : card.rank === 12 ? 'Q' : card.rank === 13 ? 'K' : String(card.rank);
  return `${rank}${SUIT_LETTER[card.suit]}`;
}

/**
 * Build the plain-text Solvitaire export of a deal's START configuration.
 *
 * @param {import('./GameState.js').GameState} initialState  the dealt (initial) state
 * @returns {string}
 */
export function buildSolvitaireText(initialState) {
  const drawCount = initialState.drawCount != null ? initialState.drawCount : 1;
  const lines = [];

  // Variant line: klondike plus 1 or 3 for the draw count.
  lines.push(`klondike,${drawCount}`);

  // Tableau rows: round r lists columns r..6 (each pile's r-th card from the
  // bottom). Indent by r*4 spaces so column r aligns under its column.
  const tableau = initialState.tableau;
  for (let r = 0; r < 7; r++) {
    const cells = [];
    for (let p = r; p < 7; p++) {
      const pile = tableau[p];
      const card = pile && pile[r];
      if (card) cells.push(cardLabel(card));
    }
    lines.push(`${' '.repeat(r * 4)}${cells.join(',')},`);
  }

  // Pack line: the remaining 24 cards in deal order (stock, bottom→top).
  const pack = initialState.stock.map((c) => cardLabel(c)).join(',');
  lines.push(`${pack},`);

  return lines.join('\n') + '\n';
}
