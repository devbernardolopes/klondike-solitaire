// core/rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { hasProgressMove, hasAnyValidMove, findFoundationMove, getAutoMoveTargets } from './rules.js';
import { findReachableMove, SOLVER_TIMEOUT } from './solver.js';

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
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true);
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
  const res = findReachableMove(s);
  assert.ok(res === true || res === SOLVER_TIMEOUT, `expected reachable move or unknown, got ${res}`);
});

/**
 * Regression: a relocation move buried in the waste (8d that can build onto 9c)
 * must NOT be treated as a dead end. The user reported the "no moves remaining"
 * modal firing prematurely on this board (Game Mode 348) even though 8d is
 * reachable after a recycle+draw and can move to pile 6. Because 8d->9c is a
 * plain tableau relocation (not a foundation/uncover), the OLD "progress" detector
 * missed it. The detector must now report a reachable move.
 */
function buildBoard348() {
  const s = createEmptyGameState();
  s.foundations[0] = [up('diamonds', 1, 'Ad'), up('diamonds', 2, '2d'), up('diamonds', 3, '3d'), up('diamonds', 4, '4d')];
  s.foundations[1] = [up('spades', 1, 'As')];
  s.foundations[2] = [up('clubs', 1, 'Ac'), up('clubs', 2, '2c'), up('clubs', 3, '3c')];
  s.foundations[3] = [];
  // Waste listed bottom->top; 8d is the 3rd card and can build onto pile 6's 9c.
  s.waste = [
    up('spades', 10, '10s'), up('diamonds', 6, '6d'), up('diamonds', 8, '8d'),
    up('hearts', 2, '2h'), up('hearts', 8, '8h'), up('hearts', 9, '9h'),
    up('diamonds', 9, '9d'), up('spades', 3, '3s'), up('spades', 8, '8s'),
    up('spades', 13, 'Ks'), up('hearts', 6, '6h'), up('spades', 7, '7s'),
  ];
  s.tableau[0] = [up('spades', 5, 't1-5s')];
  s.tableau[1] = [up('spades', 11, 't2-Js')];
  s.tableau[2] = [
    up('hearts', 3, 't3-3h'), up('spades', 4, 't3-4s'), up('diamonds', 5, 't3-5d'),
    up('clubs', 6, 't3-6c'), up('diamonds', 7, 't3-7d'), up('clubs', 8, 't3-8c'),
  ];
  s.tableau[3] = [up('spades', 12, 't4-Qs'), up('diamonds', 13, 't4-Kd')];
  s.tableau[4] = [up('clubs', 11, 't5-Jc'), up('hearts', 12, 't5-Qh')];
  s.tableau[5] = [up('clubs', 9, 't6-9c')];
  s.tableau[6] = [up('clubs', 5, 't7-5c')];
  return s;
}

test('board 348: an immediate move (Js->Qh) plus the buried 8d->9c keep it alive', () => {
  const s = buildBoard348();
  // At the root Js can build onto Qh, so the cheap pre-filter already sees a
  // legal move and suppresses the modal. This proves the real board 348 is NOT a
  // dead end (the old code wrongly flagged it because it only counted "progress"
  // moves at the root).
  assert.equal(hasAnyValidMove(s), true);
  // And the buried relocation 8d->9c is reachable through cycling too.
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true);
});

/**
 * The exact old-bug scenario: a position where there is NO immediate legal move
 * at the root (so the detector must use its solver/worker path), yet a useful
 * relocation is reachable after a recycle+draw. The OLD "progress" detector
 * missed this (8d->9c is not a foundation/uncover move) and wrongly fired the
 * modal. The new "any reachable move" detector must report it as alive.
 */
function buildBuriedRelocationNoRootMove() {
  const s = createEmptyGameState();
  s.foundations[0] = [up('diamonds', 1, 'd1')];
  s.foundations[1] = [up('clubs', 1, 'c1')];
  s.foundations[2] = [up('hearts', 1, 'h1')];
  s.foundations[3] = [up('spades', 1, 's1')];
  // Waste bottom->top: 8d is buried under 7s (the top). 7s cannot move anywhere,
  // so the root has no legal move, forcing the solver path.
  s.waste = [up('diamonds', 8, '8d'), up('spades', 7, '7s')];
  s.tableau[5] = [up('clubs', 9, '9c')]; // lone black 9, the target for 8d
  // Remaining columns: same-color ascending tops so nothing can stack; no empties.
  s.tableau[0] = [up('clubs', 5, 'c5')];
  s.tableau[1] = [up('clubs', 6, 'c6')];
  s.tableau[2] = [up('clubs', 7, 'c7')];
  s.tableau[3] = [up('clubs', 8, 'c8')];
  s.tableau[4] = [up('clubs', 10, 'c10')];
  s.tableau[6] = [up('clubs', 11, 'c11')];
  return s;
}

test('buried relocation with no root move: reachable move suppresses dead end', () => {
  const s = buildBuriedRelocationNoRootMove();
  assert.equal(hasAnyValidMove(s), false); // forces the worker/solver path
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true);
});

/**
 * Regression: an Ace sitting on a foundation must NOT auto-move back down to a
 * tableau on a tap/click (it would land on a 2). A non-Ace foundation card may
 * still auto-move to a valid tableau slot. Dragging from foundation to tableau
 * is unaffected (it validates through moveCard, not getAutoMoveTargets).
 */
function buildFoundationAceBoard() {
  const s = createEmptyGameState();
  // Aces on two foundations — top card of each is the Ace.
  s.foundations[0] = [up('diamonds', 1, 'Ad')];
  s.foundations[1] = [up('spades', 1, 'As')];
  // A black 2 ready to receive a red Ace in a tableau column.
  s.tableau[0] = [up('clubs', 2, '2c')];
  return s;
}

test('foundation Ace does not auto-move to a tableau on tap', () => {
  const s = buildFoundationAceBoard();
  const targets = getAutoMoveTargets(s, 'foundation:0', 'Ad');
  assert.equal(targets.length, 0);
  const targets2 = getAutoMoveTargets(s, 'foundation:1', 'As');
  assert.equal(targets2.length, 0);
});

test('non-Ace foundation card may still auto-move to a valid tableau', () => {
  const s = createEmptyGameState();
  // A 3 on a foundation (below it a 2) and a black 4 in a tableau to receive it.
  s.foundations[0] = [up('diamonds', 2, '2d'), up('hearts', 3, '3h')];
  s.tableau[0] = [up('spades', 4, '4s')];
  const targets = getAutoMoveTargets(s, 'foundation:0', '3h');
  assert.ok(targets.includes('tableau:0'), `expected tableau:0 in ${targets}`);
});
