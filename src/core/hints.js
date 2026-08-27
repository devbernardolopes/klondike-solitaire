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
 * Each hint is `{ from, to, cardId }` where `cardId` is the grabbable/moving card
 * — for a waste pile it is the top card, and for a tableau column it is the top
 * of the run being moved (which may be a *buried* card, not the column top). This
 * is what lets the UI anchor the "from" highlight to the actual run.
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
    for (const card of pile) {
      if (!card.faceUp) continue;
      for (const to of getAutoMoveTargets(state, from, card.id)) {
        // An Ace already placed on a foundation must never be hinted to relocate
        // to another (empty) foundation pile — that is a meaningless shuffle.
        // (Defensive: foundations are never a hint source, but keep the guard.)
        if (
          from.startsWith('foundation') &&
          to.startsWith('foundation') &&
          card.rank === 1
        ) {
          continue;
        }
        // Tableau -> tableau: drop "buried-run reshuffles" that make no progress.
        // A t->t hint is meaningful only if it (a) uncovers a face-down card in
        // the source, (b) empties the source column (frees it — e.g. a
        // whole-column move), or (c) moves the column's current top card (a
        // normal re-stack). A mid-column run moved onto another non-empty column
        // that reveals nothing new and frees nothing is a pure lateral shuffle —
        // advisory-only and never required, so omit it from the hints.
        if (to.startsWith('tableau')) {
          const idx = pile.indexOf(card);
          const revealsHidden = idx > 0 && !pile[idx - 1].faceUp;
          const emptiesSource = idx === 0;
          const isColumnTop = card.id === pile[pile.length - 1].id;
          if (!revealsHidden && !emptiesSource && !isColumnTop) continue;
        }
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
        // Record the actual grabbable card (top of its run) — for a tableau
        // this may be a buried card, not the column's top. The UI uses cardId to
        // anchor the "from" highlight rectangle to the start of the moved run.
        add(from, to, card.id);
      }
    }
  });

  return hints;
}
