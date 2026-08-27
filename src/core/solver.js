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
 * @param {{ allowTableau?: boolean, allowDraw?: boolean }} [opts]
 *   - allowTableau (default true): when false, tableau→tableau relocations are
 *     excluded. Used by auto-complete, which must never shuffle cards between
 *     columns (the only legal moves become foundations + stock draw/recycle).
 *   - allowDraw (default true): when false, draw/recycle stock moves are
 *     excluded. Used by the auto-trigger gate, which must prove a win without
 *     needing to recycle the waste back into the stock.
 * @returns {Array<object>}
 */
function enumerateMoves(s, opts = {}) {
  const moves = [];

  // (a) Foundation moves: waste top + face-up tableau tops. Always generated —
  // these are always progress and the backbone of a clean auto-complete.
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

  // (b) Tableau-to-tableau runs (used to unblock foundation moves). Excluded by
  // the auto-complete hard-lock: the user forbids any column-to-column shuffle.
  if (opts.allowTableau !== false) {
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
  }

  // (c) Stock cycling — models drawing through and recycling the waste.
  if (opts.allowDraw !== false) {
    if (s.stock.length > 0) {
      moves.push({ type: 'draw' });
    } else if (s.waste.length > 0) {
      moves.push({ type: 'recycle' });
    }
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
 * @param {{ maxNodes?: number, maxMs?: number, allowTableau?: boolean, allowDraw?: boolean }} [opts]
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
    for (const move of enumerateMoves(s, opts)) {
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

  // (c2) Foundation -> tableau retreats. A card on top of a foundation is a
  // legal move back onto the tableau in standard Klondike, and doing so can
  // unlock buried cards (e.g. retreating a foundation card to expose a run it
  // was blocking). The dead-end reachability search must consider these or it
  // will falsely flag a player as stuck when their only out is such a retreat.
  // We skip retreats onto an EMPTY column: a foundation card has no card beneath
  // it, so placing it on an empty column frees nothing and never enables a
  // foundation play or a face-down uncover — it only explodes the search space
  // (every King-topped foundation could be dropped on each of the 7 empty
  // columns) without ever contributing to a genuine rescue.
  for (let i = 0; i < s.foundations.length; i++) {
    const fPile = s.foundations[i];
    if (fPile.length === 0) continue;
    const card = fPile[fPile.length - 1];
    for (let j = 0; j < s.tableau.length; j++) {
      if (s.tableau[j].length === 0) continue;
      if (!canMoveToTableau(card, s.tableau[j])) continue;
      moves.push({ type: 'moveCards', from: `foundation:${i}`, to: `tableau:${j}`, cardIds: [card.id] });
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

/**
 * Can the current waste top be moved onto any tableau pile or foundation right
 * now? Used so a position is not flagged as stuck merely because its only moves
 * are waste/stock relocations that uncover nothing and reach no foundation (e.g.
 * a `4c` from the waste landing on a `5`). The caller's reachability search
 * cycles the stock/waste, so every buried waste/stock card is eventually tested
 * as the waste top. (A foundation play here is already subsumed by
 * `hasProgressMove`, but it is included for completeness.)
 * @param {import('./GameState.js').GameState} s
 * @returns {boolean}
 */
function wasteTopCanMove(s) {
  if (s.waste.length === 0) return false;
  const top = s.waste[s.waste.length - 1];
  for (let i = 0; i < s.tableau.length; i++) {
    if (canMoveToTableau(top, s.tableau[i])) return true;
  }
  for (let i = 0; i < s.foundations.length; i++) {
    if (canMoveToFoundation(top, s.foundations[i])) return true;
  }
  return false;
}

/** Does `s` have an immediate *meaningful* move available right now? Meaningful
 * = a progress move (foundation play or a tableau relocation that uncovers a
 * face-down card — see `hasProgressMove` in rules.js) OR a waste/stock card that
 * can be relocated to a tableau/foundation (even if it uncovers nothing). The
 * latter keeps "shuffle-only" positions whose waste still has a playable card
 * (e.g. `4c` onto a `5`) from being treated as stuck. Used as the cheap
 * pre-filter for the "no moves remaining" detector. */
export function hasDeadEndMove(s) {
  return hasProgressMove(s) || wasteTopCanMove(s);
}

/**
 * Progress check for the dead-end reachability search. A move is "progress" iff
 * it is a genuine foundation play or a tableau relocation that uncovers a
 * face-down card. The subtlety: a card that was *retreated* from a foundation
 * onto the tableau earlier in the current search path (`s` carries the set of
 * such "on loan" ids) is NOT credited with progress when it climbs back onto its
 * foundation — that would be a no-op cycle (foundation→tableau→foundation) and
 * must not, on its own, keep a position "alive". Genuine rescues (e.g. a retreat
 * that lets a buried run be uncovered) still count because the uncovering
 * relocation is real progress regardless of the loan set.
 *
 * @param {import('./GameState.js').GameState} s
 * @param {Set<string>} loan  ids currently retreated from a foundation (on loan)
 */
function hasProgressMoveWithLoan(s, loan) {
  // 1. Foundation plays from visible sources, skipping cards on loan (a loaned
  // card's only legal foundation is its own, so this precisely suppresses the
  // foundation→tableau→foundation no-op).
  const candidates = [];
  if (s.waste.length > 0) candidates.push(s.waste[s.waste.length - 1]);
  s.tableau.forEach((pile, i) => {
    if (pile.length > 0 && pile[pile.length - 1].faceUp) {
      candidates.push(pile[pile.length - 1]);
    }
  });
  for (const card of candidates) {
    if (loan.has(card.id)) continue;
    for (let i = 0; i < s.foundations.length; i++) {
      if (canMoveToFoundation(card, s.foundations[i])) return true;
    }
  }

  // 2. A tableau relocation that uncovers a face-down card (always progress).
  for (let i = 0; i < s.tableau.length; i++) {
    const pile = s.tableau[i];
    for (const card of pile) {
      if (!card.faceUp) continue;
      const run = getTableauRun(pile, card.id);
      if (!run) continue;
      const idx = pile.findIndex((c) => c.id === run[0].id);
      const uncovers = idx > 0 && !pile[idx - 1].faceUp;
      if (!uncovers) continue;
      for (let b = 0; b < s.tableau.length; b++) {
        if (b === i) continue;
        if (canMoveToTableau(run[0], s.tableau[b])) return true;
      }
    }
  }
  return false;
}

/** Carry the on-loan set forward across a transition. */
function nextLoan(s, loan, move) {
  if (!move || move.type !== 'moveCards') return loan;
  const from = String(move.from);
  if (from.startsWith('foundation')) {
    const id = move.cardIds[move.cardIds.length - 1];
    const n = new Set(loan);
    n.add(id);
    return n;
  }
  if (String(move.to).startsWith('foundation')) {
    const id = move.cardIds[move.cardIds.length - 1];
    if (loan.has(id)) {
      const n = new Set(loan);
      n.delete(id);
      return n;
    }
  }
  return loan;
}

/**
 * Is *any* meaningful move reachable from this state through legal moves
 * (including stock draws / waste recycling)? A position is a dead end only when
 * NEITHER a progress move NOR a waste/stock relocation is *ever* reachable — i.e.
 * when the stock/waste is fully exhausted and no card there (nor any tableau
 * play) can change anything. Concretely, the search is "alive" at a state if:
 *   - a progress move is available right now, OR
 *   - the current waste top can be moved to a tableau pile or foundation.
 * The search explores all transitions (foundation, waste->tableau,
 * tableau->tableau, draw/recycle), using non-meaningful moves only as
 * transitions, so a relocation that *leads to* a later meaningful move keeps the
 * position alive.
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

  function search(s, depth, loan) {
    if (hasProgressMoveWithLoan(s, loan) || wasteTopCanMove(s)) return true;
    if (nodes++ > maxNodes || Date.now() - start > maxMs) {
      aborted = true;
      return false;
    }
    if (depth > 256) return false; // bound pathological recursion
    const sig = signature(s) + '|' + [...loan].sort().join(',');
    if (visited.has(sig)) return false;
    visited.add(sig);
    for (const move of enumerateDeadEndMoves(s)) {
      const nLoan = nextLoan(s, loan, move);
      if (search(applyMove(s, move), depth + 1, nLoan)) return true;
    }
    return false;
  }

  return search(state, 0, new Set()) ? true : aborted ? SOLVER_TIMEOUT : false;
}

/**
 * Edge case for the "No More Moves" modal: the board is fully drained (stock
 * AND waste both empty) and the last move was a foundation play from a *visible*
 * source — the waste or a tableau column (i.e. the player just peeled the last
 * waste/tableau card up onto a foundation and there is nothing left to draw).
 * This is the classic "solved-or-stuck with no cards remaining to reveal"
 * moment, and it must reliably surface the dead-end modal.
 *
 * Returns:
 *  - `true`  when the position matches this edge case AND no meaningful move is
 *             reachable from here (a genuine dead end),
 *  - `false` when the position matches this edge case but a move is still
 *             reachable (don't show the modal),
 *  - `null`  when the position does NOT match this edge case (caller should fall
 *             back to the general dead-end detector, which also handles the
 *             fully-drained case after a non-foundation last move).
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {boolean|null}
 */
export function isDrainedFoundationDeadEnd(state) {
  if (state.stock.length !== 0 || state.waste.length !== 0) return null;
  const last = state.moveHistory[state.moveHistory.length - 1];
  const lastWasFoundationFromVisible =
    last && last.type === 'moveCards' &&
    typeof last.to === 'string' && last.to.startsWith('foundation') &&
    (last.from === 'waste' || (typeof last.from === 'string' && last.from.startsWith('tableau')));
  if (!lastWasFoundationFromVisible) return null;
  // A drained board's search space is tiny (only tableau relocations remain), so
  // a synchronous solve is both safe and instant here — giving the modal an
  // immediate, deterministic result instead of waiting on the async worker.
  // Only a definitive `false` (search fully exhausted, no move reachable) is a
  // dead end; a `true` (move reachable) or SOLVER_TIMEOUT (unknown) is not.
  const reachable = findReachableMove(state, { maxNodes: 200000, maxMs: 1500 });
  return reachable === false;
}

/**
 * Decide whether auto-complete-to-completion should auto-fire for `state`, and if
 * so, with which solver options. Returns the options object (always
 * `{ allowTableau: false, allowDraw: false }` — foundation moves only, never a
 * column-to-column relocation and never a stock recycle) when the board is in an
 * "obviously finishable" state, or `null` when it must NOT auto-fire.
 *
 * Firing is permitted only when the STOCK is empty (so no waste→stock recycle is
 * ever required) AND one of:
 *   - hidden === 0: the tableau is fully revealed, OR
 *   - hidden === 1 AND the waste is ALSO empty: exactly one face-down card
 *     remains. Because the stock and waste are both empty, that single buried card
 *     is always covered by a face-up card of a higher rank and a different suit;
 *     moving that covering card to its foundation flips the buried card, which
 *     then also ascends — so a foundation-only solve suffices and no column
 *     relocation is ever needed.
 *
 * Any other shape (more than one hidden card, or exactly one hidden card but the
 * waste still holds cards) returns `null`: a column shuffle would be required to
 * expose the buried card(s), which the auto-complete hard-lock forbids.
 *
 * @param {import('./GameState.js').GameState} state
 * @returns {{ allowTableau: boolean, allowDraw: boolean } | null}
 */
export function getAutoFireSolveOptions(state) {
  if (isWon(state)) return null;
  if (state.stock.length !== 0) return null;
  const hidden = state.tableau.reduce((n, p) => n + p.filter((c) => !c.faceUp).length, 0);
  const eligible = hidden === 0 || (hidden === 1 && state.waste.length === 0);
  if (!eligible) return null;
  return Array.isArray(findWinningSequence(state, { allowTableau: false, allowDraw: false }))
    ? { allowTableau: false, allowDraw: false }
    : null;
}
