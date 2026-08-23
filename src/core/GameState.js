// core/GameState.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// This file documents the canonical shape of a Klondike game state via JSDoc.
// The shape is self-documenting so the agent picking up the next task knows
// exactly what fields exist and how piles are structured.

/**
 * @typedef {Object} CardRef
 * A card is the object produced by core/Card.js: { id, suit, rank, color, faceUp }.
 */

/**
 * @typedef {Object} Move
 * @property {string} type            // e.g. 'tableau', 'foundation', 'waste-to-tableau', 'stock-to-waste', 'recycle-stock'
 * @property {string} [from]          // pile locator, see PileLocator
 * @property {string} [to]            // pile locator
 * @property {string[]} [cardIds]     // ids of the cards moved (ordered)
 * @property {*} [meta]               // optional payload (e.g. flipped-card flag)
 */

/**
 * Pile locator string format: "<kind>:<index>".
 *  - "stock"            single stock pile (no index)
 *  - "waste"            single waste pile (no index)
 *  - "foundation:0..3"  one of 4 foundation piles
 *  - "tableau:0..6"     one of 7 tableau columns
 */

/**
 * @typedef {Object} GameState
 * @property {CardRef[]} stock                 // face-down draw pile (top = last element)
 * @property {CardRef[]} waste                 // face-up discard pile (top = last element)
 * @property {CardRef[][]} foundations         // length 4, each an array of face-up cards (bottom→top)
 * @property {CardRef[][]} tableau             // length 7, each an array of cards (bottom→top)
 * @property {Move[]} moveHistory              // chronological list of applied moves (for undo)
 * @property {number} [seed]                   // seed used to deal this game (if any)
 * @property {number} [drawCount=1]            // cards turned from stock per draw (snapshot header)
 * @property {number} [startedAt]              // epoch ms when the game began
 */

/**
 * Create a fresh, empty GameState. Used by dealer.js to populate a new game.
 * @returns {GameState}
 */
export function createEmptyGameState() {
  return {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    moveHistory: [],
    drawCount: 1,
  };
}
