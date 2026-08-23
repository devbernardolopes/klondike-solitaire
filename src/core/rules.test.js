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

test('fully-revealed King pile auto-moves to the LEFTMOST empty column only', () => {
  const s = createEmptyGameState();
  // King as the sole (fully-revealed) card on col2; cols 0, 1, 4 are empty.
  s.tableau[0] = [];
  s.tableau[1] = [];
  s.tableau[2] = [up('hearts', 13, 'king')];
  s.tableau[4] = [];
  const targets = getAutoMoveTargets(s, 'tableau:2', 'king');
  const emptyTargets = targets.filter((t) => t.startsWith('tableau') && s.tableau[Number(t.split(':')[1])].length === 0);
  // Exactly one empty-tableau target, and it is the leftmost empty (tableau:0).
  assert.equal(emptyTargets.length, 1);
  assert.equal(emptyTargets[0], 'tableau:0');
});

test('King that reveals a face-down card keeps all empty-column targets', () => {
  const s = createEmptyGameState();
  // King on top of col2 with a face-down card beneath it; cols 0, 1 are the only
  // empties. Every other column is filled so the count is deterministic.
  s.tableau[0] = [];
  s.tableau[1] = [];
  s.tableau[2] = [down('clubs', 5, 'hidden'), up('hearts', 13, 'king')];
  s.tableau[3] = [up('spades', 4, 'col3')];
  s.tableau[4] = [up('diamonds', 7, 'col4')];
  s.tableau[5] = [up('clubs', 9, 'col5')];
  s.tableau[6] = [up('hearts', 2, 'col6')];
  const targets = getAutoMoveTargets(s, 'tableau:2', 'king');
  const emptyTargets = targets.filter((t) => t.startsWith('tableau') && s.tableau[Number(t.split(':')[1])].length === 0);
  // Revealing move is meaningful, so both empties remain available.
  assert.equal(emptyTargets.length, 2);
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
 * Board 348 (Game Mode 348): 8d buried in the waste can build onto 9c after a
 * recycle+draw. Under ANY-move semantics that kept the game alive; under
 * PROGRESS semantics it is a plain tableau relocation that uncovers nothing and
 * reaches no foundation play, and there is no reachable foundation/uncover move
 * anywhere (the waste's 9h/8h can never be placed, 8c is deadlocked under 7d,
 * and there are no face-down cards). So the position is genuinely stuck and the
 * "no moves" modal must now appear.
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

test('board 348: non-progress 8d->9c waste relocation keeps it alive (waste rule)', () => {
  const s = buildBoard348();
  // hasAnyValidMove is true (Js can build onto Qh, and 8d->9c is reachable), but
  // none of those are *progress* moves. Under pure progress semantics this would be
  // a dead end; under the combined rule a waste card (8d) can relocate to a tableau
  // pile (9c), so the position is NOT stuck and findReachableMove must report alive.
  assert.equal(hasAnyValidMove(s), true);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true);
});

/**
 * A position where there is NO immediate legal move at the root (so the detector
 * must use its solver/worker path), and a relocation (8d->9c) is reachable after a
 * recycle+draw. Under progress semantics 8d->9c uncovers nothing and reaches no
 * foundation play, and no foundation/uncover move is reachable anywhere (7s can
 * never be placed, no face-down cards exist), so the position is a genuine dead
 * end and the modal must appear.
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

test('buried relocation with no root move: 8d->9c waste move keeps it alive', () => {
  const s = buildBuriedRelocationNoRootMove();
  assert.equal(hasAnyValidMove(s), false); // forces the worker/solver path
  // 8d is buried under 7s at the root, so there is no immediate legal move and the
  // detector must use its solver path. Once 7s is cycled, 8d becomes the waste top
  // and can relocate to the 9c pile. Under the combined alive rule (progress OR any
  // waste/stock relocation), the position is NOT stuck.
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
