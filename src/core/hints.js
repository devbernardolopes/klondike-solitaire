// core/hints.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// Enumerate the currently-visible legal moves ("hints") so the UI can highlight
// what is playable. Mirrors exactly what a human can see: the waste top and the
// face-up cards of each tableau column (each possibly carrying a run beneath it).
// Foundation moves, tableau-to-tableau runs, and waste->tableau relocations are
// all covered by rules.getAutoMoveTargets.
//
// Hints reflect *currently visible* moves only (they deliberately do NOT model
// buried stock/waste cards reachable after cycling) — this matches the player's
// mental model of "available moves" and the "No moves remaining" detector.

import { getAutoMoveTargets } from './rules.js';

/**
 * List every currently-available legal move from visible cards.
 * Each hint is `{ from, to, cardId }` where `cardId` is the grabbable card
 * (the top of the source waste pile, or the top of the source tableau column).
 * @param {import('./GameState.js').GameState} state
 * @returns {Array<{from:string, to:string, cardId:string}>}
 */
export function findHints(state) {
  const hints = [];
  const seen = new Set();
  const add = (from, to, cardId) => {
    const key = `${from}->${to}:${cardId}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push({ from, to, cardId });
  };

  if (state.waste.length > 0) {
    const card = state.waste[state.waste.length - 1];
    for (const to of getAutoMoveTargets(state, 'waste', card.id)) {
      add('waste', to, card.id);
    }
  }

  const isEmptyTableau = (loc) => {
    const m = /^tableau:(\d+)$/.exec(loc);
    if (!m) return false;
    const pileArr = state.tableau[Number(m[1])];
    return !!pileArr && pileArr.length === 0;
  };

  state.tableau.forEach((pile, i) => {
    if (pile.length === 0 || !pile[pile.length - 1].faceUp) return;
    const from = `tableau:${i}`;
    const topId = pile[pile.length - 1].id;
    for (const card of pile) {
      if (!card.faceUp) continue;
      for (const to of getAutoMoveTargets(state, from, card.id)) {
        // Exclude a King being "shuffled" from one tableau column onto an EMPTY
        // tableau column when doing so reveals no face-down card in its source
        // column — such a relocation is meaningless for solving the game. A King
        // move that flips a hidden card underneath is still a useful hint.
        if (
          card.rank === 13 &&
          from.startsWith('tableau') &&
          isEmptyTableau(to)
        ) {
          const idx = pile.indexOf(card);
          const revealsHidden = pile.slice(0, idx).some((c) => !c.faceUp);
          if (!revealsHidden) continue;
        }
        // An Ace already placed on a foundation must never be hinted to relocate
        // to another (empty) foundation pile — that is a meaningless shuffle.
        if (
          from.startsWith('foundation') &&
          to.startsWith('foundation') &&
          card.rank === 1
        ) {
          continue;
        }
        // Highlight the grabbable top card of the column, not a buried run card.
        add(from, to, topId);
      }
    }
  });

  return hints;
}
