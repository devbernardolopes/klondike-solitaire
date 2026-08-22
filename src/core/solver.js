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
  hasProgressMove,
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
 * Replay a move list from a start state and report whether it reaches a won
 * position. Pure and defensive: an illegal move (one that became impossible
 * after another was removed) throws inside applyMove, which we treat as a
 * non-winning line so the removed move is kept.
 * @param {Array<object>} seq
 * @param {import('./GameState.js').GameState} startState
 * @returns {boolean}
 */
function replaysToWin(seq, startState) {
  try {
    let s = startState;
    for (const move of seq) s = applyMove(s, move);
    return isWon(s);
  } catch {
    return false;
  }
}

/**
 * Remove redundant moves from a *winning* move sequence. A move is redundant if
 * deleting it still leaves a line that applies legally (via the real move engine)
 * and reaches a won state. This strips "shuffle" churn — e.g. a run moved
 * tableau:X→tableau:Y to expose a card, then back tableau:Y→tableau:X — when the
 * round-trip wasn't required for the win, so auto-complete doesn't visibly bounce
 * a stack between piles. Foundation moves and stock draw/recycle steps are never
 * considered redundant (they are always progress) and are left untouched.
 *
 * The function only ever *removes* moves proven safe (the remaining line is
 * re-validated through the real move engine and must still win), so it can never
 * make a winnable line unwinnable.
 *
 * Two idioms are handled:
 *  1. A single move whose removal doesn't break any later move's locator — dropped
 *     directly.
 *  2. A back-and-forth "shuttle" of the SAME card-set (P→Q then Q→P). Removing one
 *     leg alone breaks the later move's `from` locator, so both legs must be removed
 *     together; because the card returns to its original pile, later moves that
 *     reference it stay consistent. Re-validated, so only genuinely redundant
 *     shuttles are dropped.
 *
 * @param {Array<object>} seq  winning move descriptors (core/moveEngine format)
 * @param {import('./GameState.js').GameState} startState  state the seq begins from
 * @returns {Array<object>} a (possibly shorter) winning sequence
 */
/** Is `m` a pure tableau→tableau relocation? (Foundation/draw/recycle moves are
 * never considered for compression — they are always progress and left untouched.) */
function isTableauMove(m) {
  return (
    m.type === 'moveCards' &&
    typeof m.from === 'string' && m.from.startsWith('tableau') &&
    typeof m.to === 'string' && m.to.startsWith('tableau')
  );
}

/** Do two moves share at least one card id? Used to detect that a run which left
 * a column in move `a` is the same run that came back in move `b` (even if `b`
 * also carries extra cards that piled on top of it in between). */
function sharesCard(a, b) {
  const sa = new Set(a.cardIds || []);
  for (const id of b.cardIds || []) if (sa.has(id)) return true;
  return false;
}

/** Drop a single tableau→tableau move if the remaining line still wins. */
function dropSingleTableauMove(seq, startState) {
  for (let i = 0; i < seq.length; i++) {
    if (!isTableauMove(seq[i])) continue;
    const trial = seq.slice(0, i).concat(seq.slice(i + 1));
    if (replaysToWin(trial, startState)) return trial;
  }
  return null;
}

/** Drop an entire tableau→tableau relocation excursion: a run leaves column P in
 * move `a`, and a later move `b` brings (at least one of) its cards back to P.
 * Removing every tableau→tableau move in the span [a..b] leaves the run where it
 * started, so any in-between parking (multi-step cycles P→Q→R→P, or a run that
 * grew by picking up other cards before returning) is collapsed. Re-validated
 * through the real move engine, so the win is preserved or the drop is rejected. */
function dropReturnToOrigin(seq, startState) {
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i];
    if (!isTableauMove(a)) continue;
    const p = a.from; // the column the run departed
    for (let j = i + 1; j < seq.length; j++) {
      const b = seq[j];
      if (!isTableauMove(b)) continue;
      // b lands a card that left P back onto P → the excursion can be collapsed.
      if (b.to === p && sharesCard(a, b)) {
        const trial = [];
        for (let k = 0; k < seq.length; k++) {
          if (k >= i && k <= j && isTableauMove(seq[k])) continue;
          trial.push(seq[k]);
        }
        if (replaysToWin(trial, startState)) return trial;
      }
    }
  }
  return null;
}

/** Drop a maximal contiguous block of pure tableau→tableau relocations (bounded
 * by foundation/draw/recycle moves or the ends). Catches lateral churn that never
 * returns to an origin column but is nonetheless redundant — e.g. two alternating
 * shuffles that simply cancel out. Re-validated, so a block that contains a move
 * actually required to expose a card is kept intact. */
function dropChurnBlock(seq, startState) {
  let k = 0;
  while (k < seq.length) {
    if (!isTableauMove(seq[k])) {
      k++;
      continue;
    }
    const start = k;
    while (k < seq.length && isTableauMove(seq[k])) k++;
    const end = k - 1; // inclusive
    const trial = seq.slice(0, start).concat(seq.slice(end + 1));
    if (replaysToWin(trial, startState)) return trial;
  }
  return null;
}

export function compressWinningSequence(seq, startState) {
  if (!Array.isArray(seq) || seq.length === 0) return seq;
  let reduced = seq.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const afterSingle = dropSingleTableauMove(reduced, startState);
    if (afterSingle) {
      reduced = afterSingle;
      changed = true;
      continue;
    }
    const afterReturn = dropReturnToOrigin(reduced, startState);
    if (afterReturn) {
      reduced = afterReturn;
      changed = true;
      continue;
    }
    const afterBlock = dropChurnBlock(reduced, startState);
    if (afterBlock) {
      reduced = afterBlock;
      changed = true;
    }
  }
  return reduced;
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

/** Does `s` have an immediate *progress* move available right now? A progress
 * move is a foundation play or a tableau relocation that uncovers a face-down
 * card (see `hasProgressMove` in rules.js). Used as the cheap pre-filter for the
 * "no moves remaining" detector: if a progress move is available immediately we
 * can skip the (more expensive) reachability search. Note the semantics changed
 * from "any moveCards" to "progress move" so shuffle-only positions (e.g. a
 * non-covering King-to-empty relocation) are correctly treated as stuck. */
export function hasDeadEndMove(s) {
  return hasProgressMove(s);
}

/**
 * Is *any* progress move reachable from this state through legal moves
 * (including stock draws / waste recycling)? This is the right question for the
 * "no moves remaining" detector under progress-move semantics: a position is a
 * dead end only when no *meaningful* (foundation or face-down-uncovering) move
 * is *ever* reachable, not when a full win is merely unprovable. A plain
 * non-covering tableau relocation (e.g. a red 8 onto a black 9 that uncovers
 * nothing) does NOT count as alive — such a position IS stuck even though a
 * shuffle exists. The search continues past non-progress moves (including
 * whole-pile shuffles, which it uses only as transitions) so a relocation that
 * *leads to* a later progress move still keeps the position alive. In other
 * words: the terminal test is "is there a progress move right now?", evaluated
 * at every reachable state.
 *
 * Returns:
 *  - `true`  if a progress move is reachable,
 *  - `false` if the search fully exhausted the space with no progress move
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
    if (hasProgressMove(s)) return true;
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
