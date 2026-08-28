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

import { getAutoMoveTargets, canMoveToTableau } from './rules.js';

// --- Ace-focus hint helpers ---------------------------------------------------
// An Ace on a foundation is always correct progress; when any movable Ace can move
// to an empty foundation, the hint system narrows to a single Ace->foundation hint
// (see findHints). These helpers collect the candidates and pick WHICH Ace to show
// when several are visible.

// Movable Aces (waste top, or a tableau column's top card) that have an empty
// foundation to move to. Only top-of-pile / waste-top Aces are movable, so a
// buried face-up Ace is intentionally excluded.
function collectAceCandidates(state) {
  if (!state.foundations.some((f) => f.length === 0)) return [];
  const candidates = [];
  if (state.waste.length > 0) {
    const top = state.waste[state.waste.length - 1];
    if (top.rank === 1) candidates.push('waste');
  }
  state.tableau.forEach((pile, i) => {
    if (pile.length === 0) return;
    const top = pile[pile.length - 1];
    if (top.faceUp && top.rank === 1) candidates.push(`tableau:${i}`);
  });
  return candidates;
}

// Does moving the Ace off the top of tableau column `colIdx` free a face-up 2 that
// sits on a face-down card AND that 2 has a legal next move (priority-1 Ace)?
function aceFreesPlayableTwo(state, colIdx) {
  const pile = state.tableau[colIdx];
  const aceIdx = pile.length - 1;
  if (aceIdx < 1) return false; // no card beneath the Ace
  const two = pile[aceIdx - 1];
  if (!two.faceUp || two.rank !== 2) return false; // beneath must be a face-up 2
  if (aceIdx - 2 < 0) return false; // the 2 is at the bottom — nothing under it
  if (pile[aceIdx - 2].faceUp) return false; // the 2 must sit on a face-DOWN card
  // The 2 has a legal next move if it can drop on a 3 of opposite color on another
  // tableau column, or its own Ace is already on a foundation (so it can go up).
  for (let j = 0; j < state.tableau.length; j++) {
    if (j === colIdx) continue;
    const tp = state.tableau[j];
    if (tp.length === 0) continue;
    const top = tp[tp.length - 1];
    if (top.faceUp && canMoveToTableau(two, tp)) return true;
  }
  return state.foundations.some(
    (f) => f.length > 0 && f[0].rank === 1 && f[0].suit === two.suit
  );
}

// Pick the Ace to highlight when several are visible (req 2): among tableau Aces
// left->right, the first that frees a playable 2 (priority 1); else the first
// tableau Ace left->right (priority 2). A waste Ace only wins when it is the sole
// candidate — the caller handles that case directly.
function chooseAce(state, candidates) {
  const tableauAces = candidates
    .filter((l) => l.startsWith('tableau'))
    .map((l) => Number(l.split(':')[1]))
    .sort((a, b) => a - b);
  for (const i of tableauAces) {
    if (aceFreesPlayableTwo(state, i)) return `tableau:${i}`;
  }
  return `tableau:${tableauAces[0]}`;
}

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

  // An Ace belongs on a foundation, never on a tableau. For an Ace, drop every
  // tableau target and keep only the left-most empty foundation (getAutoMoveTargets
  // returns targets in DEST_ORDER, so the first foundation target is the left-most
  // empty one).
  const filterAceTargets = (targets) => {
    const f = targets.filter((t) => t.startsWith('foundation'));
    return f.length > 0 ? [f[0]] : [];
  };

  // Ace-focus: if any movable Ace can move to an empty foundation, the hint system
  // highlights ONLY a single Ace->foundation move and nothing else. This keeps the
  // board focused on the always-correct "send Aces home" progress and avoids
  // cluttering the highlight with other moves (req 1 + req 2).
  const aceCandidates = collectAceCandidates(state);
  if (aceCandidates.length > 0) {
    const chosen =
      aceCandidates.length === 1
        ? aceCandidates[0]
        : chooseAce(state, aceCandidates);
    const card =
      chosen === 'waste'
        ? state.waste[state.waste.length - 1]
        : (() => {
            const col = state.tableau[Number(chosen.split(':')[1])];
            return col[col.length - 1];
          })();
    const targets = filterAceTargets(getAutoMoveTargets(state, chosen, card.id));
    if (targets.length > 0) return [{ from: chosen, to: targets[0], cardId: card.id }];
    // Defensive: an empty foundation existed when candidates were collected, so a
    // foundation target must exist. Fall through to normal hints just in case.
  }

  if (state.waste.length > 0) {
    const card = state.waste[state.waste.length - 1];
    let targets = getAutoMoveTargets(state, 'waste', card.id);
    if (card.rank === 1) targets = filterAceTargets(targets);
    for (const to of targets) {
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
      let targets = getAutoMoveTargets(state, from, card.id);
      if (card.rank === 1) targets = filterAceTargets(targets);
      for (const to of targets) {
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
