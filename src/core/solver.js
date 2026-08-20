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
 * Find a complete winning move sequence for a (fully-known) state, or null.
 * Bounded by node and time budgets; returns null if exceeded (callers treat
 * that as "no win proven", not an error).
 *
 * @param {import('./GameState.js').GameState} state
 * @param {{ maxNodes?: number, maxMs?: number }} [opts]
 * @returns {Array<object>|null} move descriptors consumable by applyMove, or null
 */
export function findWinningSequence(state, opts = {}) {
  const maxNodes = opts.maxNodes ?? 150000;
  const maxMs = opts.maxMs ?? 1500;
  const start = Date.now();
  const visited = new Set();
  const path = [];
  let nodes = 0;

  function search(s) {
    if (isWon(s)) return true;
    if (nodes++ > maxNodes || Date.now() - start > maxMs) return false;
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

  return search(state) ? path.slice() : null;
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
  return findWinningSequence(state) !== null;
}
