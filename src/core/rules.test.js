// core/rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { hasProgressMove, hasAnyValidMove, findFoundationMove } from './rules.js';
import { findReachableProgress, SOLVER_TIMEOUT } from './solver.js';

// Build a face-up card quickly.
const up = (suit, rank, id) => ({ id: id ?? `${suit}-${rank}`, suit, rank, faceUp: true });
// Build a face-down card (identity irrelevant — it is buried / locked).
const down = (suit, rank, id) => ({ id: id ?? `down-${suit}-${rank}`, suit, rank, faceUp: false });

/**
 * Construct the exact dead-end board from the bug report:
 *  - stock empty, waste = 8s
 *  - foundations partially built
 *  - tableau columns 1-4 are only King/run shuffles
 *  - columns 5 and 7 hide face-down cards that can never be uncovered
 * @returns {import('./GameState.js').GameState}
 */
function buildReportedBoard() {
  const s = createEmptyGameState();
  s.foundations[0] = [up('diamonds', 1), up('diamonds', 2), up('diamonds', 3), up('diamonds', 4), up('diamonds', 5)];
  s.foundations[1] = [up('spades', 1), up('spades', 2), up('spades', 3)];
  s.foundations[2] = [up('clubs', 1), up('clubs', 2), up('clubs', 3), up('clubs', 4), up('clubs', 5), up('clubs', 6), up('clubs', 7)];
  s.foundations[3] = [up('hearts', 1), up('hearts', 2), up('hearts', 3), up('hearts', 4), up('hearts', 5), up('hearts', 6), up('hearts', 7), up('hearts', 8), up('hearts', 9)];
  s.waste = [up('spades', 8, 'waste-8s')];
  s.tableau[0] = [up('spades', 6), up('diamonds', 7), up('clubs', 8), up('diamonds', 9), up('spades', 10), up('hearts', 11), up('clubs', 12), up('hearts', 13)];
  s.tableau[1] = [up('diamonds', 11), up('spades', 12), up('diamonds', 13)];
  s.tableau[2] = [up('spades', 13)];
  s.tableau[3] = [up('clubs', 9), up('diamonds', 10), up('spades', 11), up('hearts', 12), up('clubs', 13)];
  s.tableau[4] = [up('spades', 5), up('diamonds', 6), up('spades', 7), up('diamonds', 8), up('spades', 9), down('clubs', 2, 'c5a'), down('clubs', 3, 'c5b')];
  s.tableau[5] = [];
  s.tableau[6] = [up('clubs', 11), down('hearts', 2, 'c7a'), down('hearts', 3, 'c7b')];
  return s;
}

test('reported dead-end board: hasAnyValidMove true but hasProgressMove false', () => {
  const s = buildReportedBoard();
  // The old predicate still sees King-shuffle relocations as "moves".
  assert.equal(hasAnyValidMove(s), true);
  // The progress-aware predicate correctly reports no real move.
  assert.equal(hasProgressMove(s), false);
});

test('reported board 1: progress IS reachable (modal must NOT show)', () => {
  const s = buildReportedBoard();
  // The user originally suspected this was a dead end, but it is not: the run
  // above 8c in column 1 can be moved off, exposing 8c, which then plays to the
  // clubs foundation (F3 needs 8c). So a progress move is reachable and the
  // "no moves" modal must NOT appear for this board.
  assert.equal(findReachableProgress(s, { maxNodes: 500000, maxMs: 4000 }), true);
});

test('a move that uncovers a face-down card counts as progress', () => {
  const s = createEmptyGameState();
  // col0: a buried face-down card with a 9s on top; col1: a red 10d to receive it.
  s.tableau[0] = [down('hearts', 5, 'x'), up('spades', 9, 'nine')];
  s.tableau[1] = [up('diamonds', 10, 'ten')];
  assert.equal(hasProgressMove(s), true);
});

test('only a King-to-empty relocation is NOT progress', () => {
  const s = createEmptyGameState();
  s.tableau[0] = [up('hearts', 13, 'king')]; // empty foundations -> can't go up
  s.tableau[1] = []; // only destination is the empty column (a shuffle)
  assert.equal(findFoundationMove(s), null);
  assert.equal(hasProgressMove(s), false);
});

/**
 * Regression: a winnable board where the only useful card (Qs) is buried in the
 * waste and surfaces only after a recycle+draw. The "no moves" detector must NOT
 * treat this as a dead end — the solver should either prove a win or report an
 * unknown (SOLVER_TIMEOUT), never a definitive null.
 */
function buildWinnableWasteCycleBoard() {
  const s = createEmptyGameState();
  s.foundations[0] = [up('hearts', 1), up('hearts', 2)];
  s.foundations[1] = [up('diamonds', 1), up('diamonds', 2), up('diamonds', 3), up('diamonds', 4), up('diamonds', 5)];
  s.foundations[2] = [up('clubs', 1), up('clubs', 2)];
  s.foundations[3] = [];
  s.waste = [
    up('spades', 12, 'w-Qs'),
    up('diamonds', 8, 'w-8d'),
    up('clubs', 10, 'w-10c'),
    up('spades', 2, 'w-2s'),
    up('clubs', 3, 'w-3c'),
    up('spades', 13, 'w-Ks'),
    up('spades', 7, 'w-7s'),
    up('diamonds', 7, 'w-7d'),
    up('diamonds', 11, 'w-Jd'),
    up('clubs', 9, 'w-9c'),
  ];
  s.tableau[0] = [up('spades', 4), up('hearts', 5), up('clubs', 6), up('hearts', 7), up('spades', 8), up('hearts', 9), up('spades', 10), up('hearts', 11), up('clubs', 12), up('diamonds', 13)];
  s.tableau[1] = [up('spades', 6)];
  s.tableau[2] = [up('clubs', 5), up('hearts', 6), up('clubs', 7), up('hearts', 8), up('spades', 9), up('hearts', 10), up('clubs', 11), up('diamonds', 12), up('clubs', 13)];
  s.tableau[3] = [up('spades', 11), up('hearts', 12)];
  s.tableau[4] = [up('hearts', 13)];
  s.tableau[5] = [up('spades', 5), up('diamonds', 6)];
  s.tableau[6] = [up('clubs', 8), up('diamonds', 9)];
  return s;
}

test('winnable waste-cycle board: progress is reachable (no false dead end)', () => {
  const s = buildWinnableWasteCycleBoard();
  // Qs surfaces after a recycle+draw and can build onto pile 5's Kh, and from
  // there further moves are possible. The dead-end detector must NOT conclude
  // this is stuck — it should report reachable progress (or, at worst, an
  // unknown timeout), never a definitive dead end.
  const res = findReachableProgress(s);
  assert.ok(res === true || res === SOLVER_TIMEOUT, `expected reachable progress or unknown, got ${res}`);
});
