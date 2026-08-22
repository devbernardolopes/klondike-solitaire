// core/dealer.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.

import { buildStandardDeck, shuffle } from './Deck.js';
import { createEmptyGameState } from './GameState.js';

/**
 * Deal a new Klondike game.
 *
 * Standard Klondike layout:
 *  - 7 tableau columns; column i (0-indexed) receives i+1 cards. The last card
 *    dealt to each column is face-up, the rest face-down.
 *  - Remaining 24 cards form the stock (face-down). Waste and foundations start empty.
 *
 * @param {object} [opts]
 * @param {number} [opts.seed]  if provided, the shuffle is deterministic.
 * @param {object[]} [opts.order]  if provided, the exact 52-card ordered deck to
 *   deal from (skips shuffling). Used to re-deal an identical Random Shuffle.
 * @param {number} [opts.drawCount=1]  cards turned from stock per draw.
 * @returns {import('./GameState.js').GameState}
 */
export function deal(opts = {}) {
  const { seed, order, drawCount = 1 } = opts;
  const deck = order ? order.slice() : shuffle(buildStandardDeck(), seed);

  const state = createEmptyGameState();
  if (seed !== undefined) state.seed = seed;
  state.drawCount = drawCount;

  let cursor = 0;
  for (let col = 0; col < 7; col++) {
    const count = col + 1;
    const pile = [];
    for (let r = 0; r < count; r++) {
      const card = deck[cursor++];
      // last card in the column is face-up
      pile.push({ ...card, faceUp: r === count - 1 });
    }
    state.tableau[col] = pile;
  }

  // Remaining cards become the face-down stock.
  const stock = deck.slice(cursor).map((c) => ({ ...c, faceUp: false }));
  state.stock = stock;

  state.startedAt = Date.now();
  return state;
}
