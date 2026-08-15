// core/rules.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// Standard Klondike rules implemented here (real logic, not stubs):
//  - Tableau builds DOWN in ALTERNATING color.
//  - Foundations build UP by SUIT starting from Ace (1).
//  - Only the top card of a pile, or a valid descending-alternating run, can move.

import { colorOf } from './Card.js';

/**
 * Fixed priority order of all possible destination slots for an auto-move.
 * Foundations come first (by index), then tableau columns (by index). The source
 * slot is always excluded at lookup time.
 * @type {string[]}
 */
export const DEST_ORDER = [
  'foundation:0', 'foundation:1', 'foundation:2', 'foundation:3',
  'tableau:0', 'tableau:1', 'tableau:2', 'tableau:3',
  'tableau:4', 'tableau:5', 'tableau:6',
];

/**
 * Read a pile array from a GameState by locator. Mirrors the store's readPile.
 * Returns `undefined` for an unrecognized locator (callers guard against this).
 * @param {import('./GameState.js').GameState} state
 * @param {string} loc
 * @returns {Array<{id:string, suit:string, rank:number, color:string, faceUp:boolean}>|undefined}
 */
function pileAt(state, loc) {
  if (!state || !loc) return undefined;
  if (loc === 'stock') return state.stock;
  if (loc === 'waste') return state.waste;
  const [kind, idxStr] = loc.split(':');
  if (kind === 'foundation') return state.foundations?.[Number(idxStr)];
  if (kind === 'tableau') return state.tableau?.[Number(idxStr)];
  return undefined;
}

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
 * Ordered list of valid destination locators for a one-click/tap auto-move of a
 * card (plus the run beneath it, for tableau sources). Order follows DEST_ORDER
 * (foundations first, then tableaus); the source slot is excluded.
 *
 * For waste/foundation sources only the top card is movable (a buried card there
 * cannot legally move), so a non-top card yields no targets.
 *
 * @param {import('./GameState.js').GameState} state
 * @param {string} from    source pile locator
 * @param {string} cardId  the clicked card's id
 * @returns {string[]} destination locators in DEST_ORDER priority
 */
export function getAutoMoveTargets(state, from, cardId) {
  const src = pileAt(state, from);
  if (!src) return [];
  let run;
  if (from.startsWith('tableau')) {
    run = getTableauRun(src, cardId);
    if (!run) return [];
  } else {
    // waste / foundation: only the top card can move
    if (src.length === 0 || src[src.length - 1].id !== cardId) return [];
    run = [src[src.length - 1]];
  }

  const movingCard = run[0];
  const targets = [];
  for (const loc of DEST_ORDER) {
    if (loc === from) continue;
    // A card already on a foundation should not hop to another (empty) foundation;
    // it only returns to a tableau. This keeps the cycle sensible (e.g. Ace on a
    // foundation goes back onto its tableau pile rather than to foundation:1).
    if (from.startsWith('foundation') && loc.startsWith('foundation')) continue;
    const dest = pileAt(state, loc);
    if (!dest) continue;
    const valid = loc.startsWith('foundation')
      ? run.length === 1 && canMoveToFoundation(movingCard, dest)
      : canMoveToTableau(movingCard, dest);
    if (valid) targets.push(loc);
  }
  return targets;
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

/**
 * Find the next single card that can be auto-moved onto a foundation from a
 * "visible, top-most" source. Per the auto-complete rules this only considers
 * the waste top and the face-up top card of each tableau column — never the
 * stock (face-down / not visible) nor cards already on a foundation.
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {{ from: string, to: string, cardId: string }|null}
 */
export function findFoundationMove(state) {
  const candidates = [];
  if (state.waste.length > 0) {
    candidates.push({ from: 'waste', card: state.waste[state.waste.length - 1] });
  }
  state.tableau.forEach((pile, i) => {
    if (pile.length > 0 && pile[pile.length - 1].faceUp) {
      candidates.push({ from: `tableau:${i}`, card: pile[pile.length - 1] });
    }
  });

  for (const { from, card } of candidates) {
    for (let i = 0; i < state.foundations.length; i++) {
      const to = `foundation:${i}`;
      if (canMoveToFoundation(card, state.foundations[i])) {
        return { from, to, cardId: card.id };
      }
    }
  }
  return null;
}
