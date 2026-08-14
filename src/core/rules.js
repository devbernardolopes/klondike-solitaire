// core/rules.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// Standard Klondike rules implemented here (real logic, not stubs):
//  - Tableau builds DOWN in ALTERNATING color.
//  - Foundations build UP by SUIT starting from Ace (1).
//  - Only the top card of a pile, or a valid descending-alternating run, can move.

import { colorOf } from './Card.js';

/**
 * Is a run of cards a valid descending, alternating-color sequence (a "tableau run")?
 * Empty array is considered a valid (trivially empty) run.
 *
 * @param {Array<{rank:number, suit:string, faceUp:boolean}>} cards  ordered bottom→top
 * @returns {boolean}
 */
export function isValidSequence(cards) {
  if (cards.length === 0) return true;
  // A run may only contain face-up cards.
  if (!cards.every((c) => c.faceUp)) return false;
  for (let i = 0; i < cards.length - 1; i++) {
    const upper = cards[i];
    const lower = cards[i + 1];
    // descending by one
    if (lower.rank !== upper.rank - 1) return false;
    // alternating color
    if (colorOf(upper.suit) === colorOf(lower.suit)) return false;
  }
  return true;
}

/**
 * Get the movable "run" starting at a specific face-up card in a tableau pile.
 * The run is every card from `cardId` up to the top of the pile. Returns
 * `null` if the card isn't found, is face-down, or the cards above it do not
 * form a valid descending alternating-color sequence (in which case the run
 * cannot be lifted together, per Klondike rules).
 *
 * @param {Array<{id:string, rank:number, suit:string, faceUp:boolean}>} pile  bottom→top
 * @param {string} cardId
 * @returns {Array<{id:string, rank:number, suit:string, faceUp:boolean}>|null}  bottom→top, or null
 */
export function getTableauRun(pile, cardId) {
  const idx = pile.findIndex((c) => c.id === cardId);
  if (idx === -1) return null;
  const run = pile.slice(idx);
  if (!run.every((c) => c.faceUp)) return null;
  if (!isValidSequence(run)) return null;
  return run;
}

/**
 * Can `card` be placed on the top of a tableau pile?
 * Target pile may be empty (any King allowed) or non-empty (must be descending + alt-color).
 *
 * @param {{rank:number, suit:string}} card
 * @param {Array<{rank:number, suit:string, faceUp:boolean}>} targetPile  bottom→top
 * @returns {boolean}
 */
export function canMoveToTableau(card, targetPile) {
  if (targetPile.length === 0) {
    // Empty column accepts only a King.
    return card.rank === 13;
  }
  const top = targetPile[targetPile.length - 1];
  if (!top.faceUp) return false;
  return card.rank === top.rank - 1 && colorOf(card.suit) !== colorOf(top.suit);
}

/**
 * Can `card` be placed on a foundation pile?
 * Foundation must build up by the same suit, starting from Ace (1).
 *
 * @param {{rank:number, suit:string}} card
 * @param {Array<{rank:number, suit:string}>} foundation  bottom→top, same suit assumed once started
 * @returns {boolean}
 */
export function canMoveToFoundation(card, foundation) {
  if (foundation.length === 0) {
    // Only an Ace starts a foundation.
    return card.rank === 1;
  }
  const top = foundation[foundation.length - 1];
  return card.suit === top.suit && card.rank === top.rank + 1;
}
