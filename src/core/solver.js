// core/solver.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
//
// A real (bounded) solver for Klondike auto-complete. Unlike the old
// depth-capped heuristic, this proves whether a position can be played out to a
// win by searching the FULL state space (stock order is known in `state`, even
// though it is rendered face-down) including draw/recycle, foundation moves, and
// tableau-to-tableau runs. It returns the complete winning move list, or null
// if no win is found within the node/time budget.

import { applyMove } from './moveEngine.js';
import {
  getTableauRun,
  canMoveToTableau,
  canMoveToFoundation,
  isAllTableauFaceUp,
} from './rules.js';
import { isWon } from './winDetection.js';

/**
 * Canonical signature of a fully-known state. Covers every pile whose contents
 * change under any move we generate (stock, waste, foundations, tableau) so that
 * draw/recycle cycles and reversible tableau shuffles are detected and pruned.
 * @param {import('./GameState.js').GameState} s
 * @returns {string}
 */
function signature(s) {
  return (
    s.stock.map((c) => c.id).join(',') +
    '|' +
    s.waste.map((c) => c.id).join(',') +
    '|' +
    s.foundations.map((p) => p.map((c) => c.id).join(',')).join('|') +
    '|' +
    s.tableau.map((p) => p.map((c) => c.id).join(',')).join('|')
  );
}

/**
 * Enumerate every legal auto-complete move from a state, ordered foundations-first
 * (so the DFS stays shallow for the common case), then tableau shuffles, then
 * draw/recycle. Move descriptors are in core/moveEngine.js format.
 * @param {import('./GameState.js').GameState} s
 * @returns {Array<object>}
 */
function enumerateMoves(s) {
  const moves = [];

  // (a) Foundation moves: waste top + face-up tableau tops.
  const candidates = [];
  if (s.waste.length > 0) {
    candidates.push({ from: 'waste', card: s.waste[s.waste.length - 1] });
  }
  s.tableau.forEach((pile, i) => {
    if (pile.length > 0 && pile[pile.length - 1].faceUp) {
      candidates.push({ from: `tableau:${i}`, card: pile[pile.length - 1] });
    }
  });
  for (const { from, card } of candidates) {
    for (let i = 0; i < s.foundations.length; i++) {
      if (canMoveToFoundation(card, s.foundations[i])) {
        moves.push({ type: 'moveCards', from, to: `foundation:${i}`, cardIds: [card.id] });
      }
    }
  }

  // (b) Tableau-to-tableau runs (used to unblock foundation moves).
  for (let a = 0; a < s.tableau.length; a++) {
    const pile = s.tableau[a];
    for (const card of pile) {
      if (!card.faceUp) continue;
      const run = getTableauRun(pile, card.id);
      if (!run) continue;
      const cardIds = run.map((c) => c.id).reverse();
      for (let b = 0; b < s.tableau.length; b++) {
        if (b === a) continue;
        if (!canMoveToTableau(run[0], s.tableau[b])) continue;
        // Skip a pointless move of an entire pile onto an empty column.
        if (s.tableau[b].length === 0 && pile.length === run.length) continue;
        moves.push({ type: 'moveCards', from: `tableau:${a}`, to: `tableau:${b}`, cardIds });
      }
    }
  }

  // (c) Stock cycling — models drawing through and recycling the waste.
  if (s.stock.length > 0) {
    moves.push({ type: 'draw' });
  } else if (s.waste.length > 0) {
    moves.push({ type: 'recycle' });
  }

  return moves;
}

/**
 * Sentinel returned by findWinningSequence when the node/time budget is exceeded
 * before the search space was fully explored. This is deliberately distinct from
 * `null`: `null` means the search completed and provably found NO winning line,
 * whereas SOLVER_TIMEOUT means "unknown — gave up early". Callers must not treat
 * a timeout as a dead end (that would falsely report a winnable game as stuck).
 */
export const SOLVER_TIMEOUT = '__solver_timeout__';

/**
 * Find a complete winning move sequence for a (fully-known) state.
 * Bounded by node and time budgets:
 *  - returns the winning move array if one is proven,
 *  - returns `null` if the search fully exhausted the space with no win (a
 *    definitive dead end),
 *  - returns `SOLVER_TIMEOUT` if the budget was exceeded before exhaustion (the
 *    answer is unknown).
 *
 * @param {import('./GameState.js').GameState} state
 * @param {{ maxNodes?: number, maxMs?: number }} [opts]
 * @returns {Array<object>|null|typeof SOLVER_TIMEOUT} move descriptors, null, or timeout
 */
export function findWinningSequence(state, opts = {}) {
  const maxNodes = opts.maxNodes ?? 150000;
  const maxMs = opts.maxMs ?? 1500;
  const start = Date.now();
  const visited = new Set();
  const path = [];
  let nodes = 0;
  let aborted = false;

  function search(s) {
    if (isWon(s)) return true;
    if (nodes++ > maxNodes || Date.now() - start > maxMs) {
      aborted = true;
      return false;
    }
    const sig = signature(s);
    if (visited.has(sig)) return false;
    visited.add(sig);
    for (const move of enumerateMoves(s)) {
      path.push(move);
      if (search(applyMove(s, move))) return true;
      path.pop();
    }
    return false;
  }

  return search(state) ? path.slice() : aborted ? SOLVER_TIMEOUT : null;
}

/**
 * Comprehensive legal moves for the "no moves remaining" detector. Mirrors the
 * win solver's `enumerateMoves` but (a) also generates waste->tableau
 * relocations (e.g. a red 8 from the waste onto a black 9) and (b) skips the
 * pointless "move an entire pile onto an empty column" shuffle, which uncovers
 * nothing and never advances a foundation — counting it would make a genuinely
 * stuck position (where the only moves are King-shuffles of whole piles) look
 * alive. Draw/recycle are kept so a buried waste card can be cycled into play.
 */
function enumerateDeadEndMoves(s) {
  const moves = [];

  // (a) Foundation moves: waste top + face-up tableau tops.
  const candidates = [];
  if (s.waste.length > 0) {
    candidates.push({ from: 'waste', card: s.waste[s.waste.length - 1] });
  }
  s.tableau.forEach((pile, i) => {
    if (pile.length > 0 && pile[pile.length - 1].faceUp) {
      candidates.push({ from: `tableau:${i}`, card: pile[pile.length - 1] });
    }
  });
  for (const { from, card } of candidates) {
    for (let i = 0; i < s.foundations.length; i++) {
      if (canMoveToFoundation(card, s.foundations[i])) {
        moves.push({ type: 'moveCards', from, to: `foundation:${i}`, cardIds: [card.id] });
      }
    }
  }

  // (b) Waste -> tableau relocations (free the waste / build a run).
  if (s.waste.length > 0) {
    const card = s.waste[s.waste.length - 1];
    for (let i = 0; i < s.tableau.length; i++) {
      if (canMoveToTableau(card, s.tableau[i])) {
        moves.push({ type: 'moveCards', from: 'waste', to: `tableau:${i}`, cardIds: [card.id] });
      }
    }
  }

  // (c) Tableau -> tableau runs.
  for (let a = 0; a < s.tableau.length; a++) {
    const pile = s.tableau[a];
    for (const card of pile) {
      if (!card.faceUp) continue;
      const run = getTableauRun(pile, card.id);
      if (!run) continue;
      const cardIds = run.map((c) => c.id).reverse();
      for (let b = 0; b < s.tableau.length; b++) {
        if (b === a) continue;
        if (!canMoveToTableau(run[0], s.tableau[b])) continue;
        // Skip a pointless move of an entire pile onto an empty column.
        if (s.tableau[b].length === 0 && pile.length === run.length) continue;
        moves.push({ type: 'moveCards', from: `tableau:${a}`, to: `tableau:${b}`, cardIds });
      }
    }
  }

  // (d) Stock cycling — models drawing through and recycling the waste.
  if (s.stock.length > 0) {
    moves.push({ type: 'draw' });
  } else if (s.waste.length > 0) {
    moves.push({ type: 'recycle' });
  }

  return moves;
}

/** Is there any *meaningful* card-play move in `s`? Excludes the pointless
 * whole-pile-to-empty relocation. Used by the "no moves remaining" detector. */
export function hasDeadEndMove(s) {
  return enumerateDeadEndMoves(s).some((m) => m.type === 'moveCards');
}

/**
 * Is *any* meaningful legal card-play move reachable from this state through
 * legal moves (including stock draws / waste recycling)? This is the right
 * question for the "no moves remaining" detector: a position is a dead end only
 * when no meaningful move is *ever* reachable (after fully cycling the stock),
 * not when a full win is merely unprovable. A plain tableau relocation (e.g. a
 * red 8 onto a black 9) counts as a reachable move — such a position is NOT
 * stuck, even though it neither advances a foundation nor uncovers a face-down
 * card. The search continues past non-progress moves (including whole-pile
 * shuffles, which it uses only as transitions), so a relocation that merely
 * *leads to* a later useful move also keeps the position alive.
 *
 * Returns:
 *  - `true`  if a meaningful move is reachable,
 *  - `false` if the search fully exhausted the space with no meaningful move
 *            reachable (a definitive dead end),
 *  - `SOLVER_TIMEOUT` if the budget was exceeded before concluding (unknown).
 *
 * Note: stock draws / recycles themselves are NOT counted as moves (they change
 * nothing about card placement); only waste/tableau/foundation plays count.
 *
 * @param {import('./GameState.js').GameState} state
 * @param {{ maxNodes?: number, maxMs?: number }} [opts]
 * @returns {boolean|typeof SOLVER_TIMEOUT}
 */
export function findReachableMove(state, opts = {}) {
  const maxNodes = opts.maxNodes ?? 150000;
  const maxMs = opts.maxMs ?? 1500;
  const start = Date.now();
  const visited = new Set();
  let nodes = 0;
  let aborted = false;

  function search(s, depth) {
    if (hasDeadEndMove(s)) return true;
    if (nodes++ > maxNodes || Date.now() - start > maxMs) {
      aborted = true;
      return false;
    }
    if (depth > 256) return false; // bound pathological recursion
    const sig = signature(s);
    if (visited.has(sig)) return false;
    visited.add(sig);
    for (const move of enumerateDeadEndMoves(s)) {
      if (search(applyMove(s, move), depth + 1)) return true;
    }
    return false;
  }

  return search(state, 0) ? true : aborted ? SOLVER_TIMEOUT : false;
}

/**
 * Should the game auto-fire auto-complete right now? True only when the tableau
 * holds no hidden information (all face-up) AND a full win is provable from the
 * current state (which may require cycling the stock/waste). Keeping the
 * all-face-up gate prevents auto-firing from move 1 while still permitting stock
 * and waste to be non-empty.
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {boolean}
 */
export function isAutoCompletable(state) {
  if (isWon(state)) return false;
  if (!isAllTableauFaceUp(state)) return false;
  return Array.isArray(findWinningSequence(state));
}
