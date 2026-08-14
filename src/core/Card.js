// core/Card.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.

/**
 * @typedef {('hearts'|'diamonds'|'clubs'|'spades')} Suit
 * @typedef {1|2|3|4|5|6|7|8|9|10|11|12|13} Rank  // 1 = Ace, 11 = Jack, 12 = Queen, 13 = King
 * @typedef {('red'|'black')} Color
 */

/**
 * @type {ReadonlyArray<Suit>}
 */
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

/**
 * @type {ReadonlyArray<Rank>}
 */
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/**
 * @param {Suit} suit
 * @returns {Color}
 */
export function colorOf(suit) {
  return suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
}

let _idCounter = 0;

/**
 * Create a card with a stable unique id. Suit+rank is NOT unique on its own
 * because face-down duplicates can exist across piles during dev/testing, so we
 * mint an incrementing id. Provide `id` to override (used by tests / serialization).
 *
 * @param {Suit} suit
 * @param {Rank} rank
 * @param {object} [opts]
 * @param {boolean} [opts.faceUp=false]
 * @param {string} [opts.id]  // override id (e.g. when reconstructing from storage)
 * @returns {{ id: string, suit: Suit, rank: Rank, color: Color, faceUp: boolean }}
 */
export function createCard(suit, rank, { faceUp = false, id } = {}) {
  if (!SUITS.includes(suit)) {
    throw new Error(`Invalid suit: ${suit}`);
  }
  if (!RANKS.includes(rank)) {
    throw new Error(`Invalid rank: ${rank}`);
  }
  const cardId = id ?? `card-${++_idCounter}`;
  return {
    id: cardId,
    suit,
    rank,
    color: colorOf(suit),
    faceUp,
  };
}

/**
 * Reset the internal id counter. Primarily for deterministic unit tests.
 */
export function __resetIdCounter() {
  _idCounter = 0;
}
