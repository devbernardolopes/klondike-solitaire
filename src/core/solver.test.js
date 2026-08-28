// core/solver.test.js
// Tests for the auto-complete solver: it must prove wins (including ones that
// require tableau shuffles and stock cycling) and replay to a cleared board,
// and report null when no win is provable. Also covers the getAutoFireSolveOptions
// trigger gate (when auto-complete-to-completion may auto-fire).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { findWinningSequence, findReachableMove, hasDeadEndMove, getAutoFireSolveOptions, isDrainedFoundationDeadEnd, SOLVER_TIMEOUT, compressWinningSequence } from './solver.js';
import { applyMove } from './moveEngine.js';
import { isWon } from './winDetection.js';
import { findFoundationMove, isAllTableauFaceUp, hasAnyValidMove, wouldGreedyComplete } from './rules.js';

// A state is "fully cleared" when every card sits on a foundation as a valid
// 1..n same-suit run and the board (tableau/stock/waste) is empty. Used instead
// of isWon (which requires all 52) for sub-deal test states.
function isFullyCleared(s) {
  if (s.tableau.some((p) => p.length > 0)) return false;
  if (s.stock.length > 0 || s.waste.length > 0) return false;
  return s.foundations.every((f) => {
    if (f.length === 0) return true;
    const suit = f[0].suit;
    return f.every((c, i) => c.suit === suit && c.rank === i + 1);
  });
}

function replay(state, seq) {
  let cur = state;
  for (const move of seq) cur = applyMove(cur, move);
  return cur;
}

test('obvious-win (all 52 cards, stock+waste empty): solver wins', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  // Three complete foundations, hearts built to 10, hearts J/Q/K waiting on tableau.
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `s${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [
    [c('hearts', 11, 'hJ')],
    [c('hearts', 12, 'hQ')],
    [c('hearts', 13, 'hK')],
    [], [], [], [],
  ];
  assert.equal(isWon(s), false);

  const seq = findWinningSequence(s);
  assert.ok(seq && seq.length > 0, 'expected a winning sequence');
  assert.equal(isWon(replay(s, seq)), true, 'replay must reach a full win');
  assert.deepEqual(getAutoFireSolveOptions(s), { allowTableau: false, allowDraw: false });
});

test('getAutoFireSolveOptions: a single face-down card that cannot be cleared (no covering play) does not auto-fire', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `s${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [[c('hearts', 11, 'hJ')], [c('hearts', 12, 'hQ')], [c('hearts', 13, 'hK')], [], [], [], []];
  s.tableau[0][0] = { ...s.tableau[0][0], faceUp: false };
  assert.equal(getAutoFireSolveOptions(s), null);
});

test('getAutoFireSolveOptions: exactly one face-down card covered by a playable face-up card (waste empty) auto-fires', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 8 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  // Full 52-card board: the only buried card is h10, covered by h9 (lower rank, a
  // valid descending placement). Moving h9 to its foundation flips h10, which then
  // also ascends; the remaining hearts (h11-h13) sit face-up elsewhere. Foundation-
  // only, no column relocation, so it must fire.
  s.tableau = [
    [c('hearts', 10, 'h10', false), c('hearts', 9, 'h9')],
    [c('hearts', 11, 'h11')],
    [c('hearts', 12, 'h12')],
    [c('hearts', 13, 'h13')],
    [], [], [],
  ];
  assert.equal(s.waste.length, 0);
  assert.deepEqual(getAutoFireSolveOptions(s), { allowTableau: false, allowDraw: false });
});

test('getAutoFireSolveOptions: exactly one face-down card but waste still has cards does NOT auto-fire', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 8 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [[c('hearts', 10, 'h10', false), c('hearts', 9, 'h9')], [], [], [], [], [], []];
  s.waste = [c('clubs', 1, 'cA')];
  assert.equal(getAutoFireSolveOptions(s), null);
});

test('getAutoFireSolveOptions: more than one face-down card does NOT auto-fire', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 8 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  // Two buried cards, both coverable — but >1 hidden must never auto-fire.
  s.tableau = [
    [c('hearts', 10, 'h10', false), c('hearts', 9, 'h9')],
    [c('clubs', 10, 'c10', false), c('clubs', 9, 'c9')],
    [], [], [], [], [],
  ];
  assert.equal(getAutoFireSolveOptions(s), null);
});

test('winnable deal with cards still in stock: solver models drawing', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  // Three complete foundations plus hearts built to 10 = 49 cards. The remaining
  // hearts J/Q/K are split: J sits on the tableau (face-up), Q and K remain
  // face-down in the stock. Stock top (last element) is hQ so it draws first.
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [[c('hearts', 11, 'hJ')], [], [], [], [], [], []];
  s.stock = [c('hearts', 13, 'hK', false), c('hearts', 12, 'hQ', false)];

  const seq = findWinningSequence(s);
  assert.ok(seq, 'expected the solver to find a win by drawing through the stock');
  assert.equal(isWon(replay(s, seq)), true);
});

test('requires a tableau-to-tableau shuffle to expose a foundation card', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[2] = Array.from({ length: 11 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`)); // up to 11
  s.foundations[3] = Array.from({ length: 9 }, (_, i) => c('hearts', i + 1, `h${i + 1}`)); // up to 9
  // col0 bottom->top: h10 buried under hJ. hJ is NOT a King and its foundation
  // predecessor (h10) is buried, so its only legal move is onto a black 12 in
  // another column (c12 in col1) — a forced tableau-to-tableau shuffle. Note
  // c12 itself is foundation-playable, but playing it first dead-ends (hJ would
  // have no landing), so the solver must use it as a landing instead.
  s.tableau = [
    [c('hearts', 10, 'h10'), c('hearts', 11, 'hJ')],
    [c('clubs', 12, 'c12')],
    [c('hearts', 12, 'hQ')],
    [c('hearts', 13, 'hK')],
    [c('clubs', 13, 'cK')],
    [], [],
  ];

  const seq = findWinningSequence(s);
  assert.ok(seq, 'expected the solver to shuffle hJ onto c12 to expose h10');
  assert.equal(isWon(replay(s, seq)), true);
  // Confirm a tableau-to-tableau move was actually part of the solution.
  const hadTableauMove = seq.some((m) => m.type === 'moveCards' && String(m.to).startsWith('tableau:'));
  assert.equal(hadTableauMove, true, 'winning line must include a tableau-to-tableau move');
});

test('non-winnable state returns null (not a throw)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = [c('hearts', 1, 'hA')];
  // h3 is buried under c2; no clubs Ace exists, so c2 can never be placed and
  // h3 (needing a 2) stays blocked — unsolvable.
  s.tableau = [
    [c('clubs', 2, 'c2'), c('hearts', 3, 'h3')],
    [c('clubs', 4, 'c4')],
    [], [], [], [], [],
  ];
  const seq = findWinningSequence(s, { maxNodes: 5000 });
  assert.equal(seq, null);
  assert.equal(getAutoFireSolveOptions(s), null);
});

test('a non-progress relocation (King->empty) is now a dead end (progress semantics)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  // hQ on sK, with empty columns available: sK can move to an empty column — that
  // is a legal but non-progress move (it uncovers nothing and no foundation play
  // exists). Under progress semantics the position IS stuck.
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.foundations[0][10] = c('spades', 11, 'sp11');
  s.foundations[0] = s.foundations[0].slice(0, 11);
  s.tableau = [[c('hearts', 12, 'hQ'), c('spades', 13, 'sK')], [], [], [], [], [], []];
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), false);
});

test('budget-exceeded search returns SOLVER_TIMEOUT, not null (findWinningSequence)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  // A board with real moves (hQ/sK build loop, sK can move to an empty column)
  // but no immediate win. A tiny node budget forces an abort before the space is
  // explored, exercising the SOLVER_TIMEOUT sentinel (distinct from `false`/`null`).
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.foundations[0][10] = c('spades', 11, 'sp11');
  s.foundations[0] = s.foundations[0].slice(0, 11);
  s.tableau = [[c('hearts', 12, 'hQ'), c('spades', 13, 'sK')], [], [], [], [], [], []];
  const seq = findWinningSequence(s, { maxNodes: 1 });
  assert.equal(seq, SOLVER_TIMEOUT);
  assert.ok(!Array.isArray(seq));
});

/**
 * Whole-pile-to-empty relocations must NOT count as a move for the dead-end
 * detector. A column whose only "move" is shifting the whole pile onto an empty
 * column is effectively stuck (it uncovers nothing and advances nothing).
 */
test('a whole-pile-to-empty relocation is not a meaningful move', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  // Pile 0 is a full King-led run; pile 1 is an empty column. The only legal
  // move is relocating pile 0 onto pile 1 — pointless.
  s.tableau = [
    [c('spades', 13, 'sK'), c('hearts', 12, 'hQ'), c('spades', 11, 'sJ'), c('hearts', 10, 'h10')],
    [], [], [], [], [], [],
  ];
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), false);
});

/**
 * A genuine dead end: two King-led columns that cannot cross-build (a King
 * cannot land on the other column's top) and no empty columns / stock / waste.
 * Nothing can move, so the detector must report a dead end.
 */
test('genuine dead end with no cross-build shows the modal', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = [c('hearts', 1, 'h1')];
  s.foundations[1] = [c('clubs', 1, 'c1')];
  s.foundations[2] = [c('diamonds', 1, 'd1')];
  s.foundations[3] = [c('spades', 1, 's1')];
  s.tableau = [
    [c('clubs', 13, 'cK'), c('diamonds', 12, 'dQ'), c('clubs', 11, 'cJ'), c('diamonds', 10, 'd10')],
    [c('spades', 13, 'sK'), c('hearts', 12, 'hQ'), c('spades', 11, 'sJ'), c('hearts', 10, 'h10')],
    [], [], [], [], [],
  ];
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), false);
});

/**
 * Edge case for the "No More Moves" modal: the board is fully drained (stock
 * AND waste empty) and the last move was a foundation play from a visible source
 * (waste or a tableau column). When nothing meaningful remains, the modal must
 * fire (returns `true`); when a move is still reachable it must not (returns
 * `false`); and the predicate must return `null` whenever the edge case does not
 * apply (last move was a tableau->tableau shuffle, or cards remain to draw).
 */
test('isDrainedFoundationDeadEnd: true after a tableau->foundation play with no moves left', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = [c('hearts', 1, 'h1')];
  s.foundations[1] = [c('clubs', 1, 'c1')];
  s.foundations[2] = [c('diamonds', 1, 'd1')];
  s.foundations[3] = [c('spades', 1, 's1')];
  s.tableau = [
    [c('clubs', 13, 'cK'), c('diamonds', 12, 'dQ'), c('clubs', 11, 'cJ'), c('diamonds', 10, 'd10')],
    [c('spades', 13, 'sK'), c('hearts', 12, 'hQ'), c('spades', 11, 'sJ'), c('hearts', 10, 'h10')],
    [], [], [], [], [],
  ];
  s.stock = [];
  s.waste = [];
  s.moveHistory = [{ type: 'moveCards', from: 'tableau:0', to: 'foundation:0', cardIds: ['h2'] }];
  assert.equal(isDrainedFoundationDeadEnd(s), true);
});

test('isDrainedFoundationDeadEnd: true after a waste->foundation play with no moves left', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = [c('hearts', 1, 'h1')];
  s.foundations[1] = [c('clubs', 1, 'c1')];
  s.foundations[2] = [c('diamonds', 1, 'd1')];
  s.foundations[3] = [c('spades', 1, 's1')];
  s.tableau = [
    [c('clubs', 13, 'cK'), c('diamonds', 12, 'dQ'), c('clubs', 11, 'cJ'), c('diamonds', 10, 'd10')],
    [c('spades', 13, 'sK'), c('hearts', 12, 'hQ'), c('spades', 11, 'sJ'), c('hearts', 10, 'h10')],
    [], [], [], [], [],
  ];
  s.stock = [];
  s.waste = [];
  s.moveHistory = [{ type: 'moveCards', from: 'waste', to: 'foundation:0', cardIds: ['h2'] }];
  assert.equal(isDrainedFoundationDeadEnd(s), true);
});

test('isDrainedFoundationDeadEnd: null when last move was tableau->tableau', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = [c('hearts', 1, 'h1')];
  s.foundations[1] = [c('clubs', 1, 'c1')];
  s.foundations[2] = [c('diamonds', 1, 'd1')];
  s.foundations[3] = [c('spades', 1, 's1')];
  s.tableau = [
    [c('clubs', 13, 'cK'), c('diamonds', 12, 'dQ'), c('clubs', 11, 'cJ'), c('diamonds', 10, 'd10')],
    [c('spades', 13, 'sK'), c('hearts', 12, 'hQ'), c('spades', 11, 'sJ'), c('hearts', 10, 'h10')],
    [], [], [], [], [],
  ];
  s.stock = [];
  s.waste = [];
  s.moveHistory = [{ type: 'moveCards', from: 'tableau:0', to: 'tableau:1', cardIds: ['x'] }];
  assert.equal(isDrainedFoundationDeadEnd(s), null);
});

test('isDrainedFoundationDeadEnd: null when stock still has cards', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = [c('hearts', 1, 'h1')];
  s.foundations[1] = [c('clubs', 1, 'c1')];
  s.foundations[2] = [c('diamonds', 1, 'd1')];
  s.foundations[3] = [c('spades', 1, 's1')];
  s.tableau = [
    [c('clubs', 13, 'cK'), c('diamonds', 12, 'dQ'), c('clubs', 11, 'cJ'), c('diamonds', 10, 'd10')],
    [c('spades', 13, 'sK'), c('hearts', 12, 'hQ'), c('spades', 11, 'sJ'), c('hearts', 10, 'h10')],
    [], [], [], [], [],
  ];
  s.stock = [c('spades', 5, 's5', false)];
  s.waste = [];
  s.moveHistory = [{ type: 'moveCards', from: 'tableau:0', to: 'foundation:0', cardIds: ['h2'] }];
  assert.equal(isDrainedFoundationDeadEnd(s), null);
});

test('isDrainedFoundationDeadEnd: false when a win is still reachable', () => {
  // Drained board (stock + waste empty) where the four Kings sit on the tableau
  // tops and every lower rank is already on its foundation. Moving each King home
  // wins, so this is NOT a dead end under the win-proving detector.
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  const suits = ['clubs', 'spades', 'hearts', 'diamonds'];
  suits.forEach((suit, i) => {
    s.foundations[i] = [];
    for (let r = 1; r <= 12; r++) s.foundations[i].push(c(suit, r, `${suit[0]}${r}`));
  });
  s.tableau = [
    [c('clubs', 13, 'Kc')],
    [c('spades', 13, 'Ks')],
    [c('hearts', 13, 'Kh')],
    [c('diamonds', 13, 'Kd')],
    [], [], [],
  ];
  s.stock = [];
  s.waste = [];
  s.moveHistory = [{ type: 'moveCards', from: 'waste', to: 'foundation:0', cardIds: ['x'] }];
  assert.equal(isDrainedFoundationDeadEnd(s), false);
});

/**
 * Regression: the board reported as a dead end (Game Mode 25016), with empty
 * stock AND empty waste. Under the corrected dead-end detector — which now
 * counts foundation->tableau *retreats* as legal moves — this position is NOT
 * a dead end: a foundation retreat unlocks a buried run, so a move is reachable
 * and the "no moves" modal must stay hidden. (Earlier versions ignored
 * foundation retreats and wrongly flagged this stuck; that was the same class
 * of bug as the waste->tableau false positive, so this assertion tracks the
 * corrected behavior.)
 */
test('reported board (Game Mode 25016) has a foundation-retreat rescue (not a dead end)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  // Tableau arrays are BOTTOM->TOP in core; the bug report listed TOP->BOTTOM,
  // so each column below is the report reversed.
  const s = createEmptyGameState();
  s.stock = [];
  s.waste = [];
  s.foundations[0] = [c('clubs', 1, 'Ac'), c('clubs', 2, '2c')];
  s.foundations[1] = [c('spades', 1, 'As'), c('spades', 2, '2s'), c('spades', 3, '3s')];
  s.foundations[2] = [c('hearts', 1, 'Ah'), c('hearts', 2, '2h'), c('hearts', 3, '3h'), c('hearts', 4, '4h'), c('hearts', 5, '5h')];
  s.foundations[3] = [];
  s.tableau = [
    [c('spades', 13, 'Ks'), c('diamonds', 12, 'Qd'), c('clubs', 11, 'Jc'), c('hearts', 10, '10h'), c('clubs', 9, '9c'), c('diamonds', 8, '8d'), c('clubs', 7, '7c'), c('diamonds', 6, '6d'), c('clubs', 5, '5c'), c('diamonds', 4, '4d'), c('clubs', 3, '3c'), c('diamonds', 2, '2d')],
    [c('diamonds', 13, 'Kd'), c('clubs', 12, 'Qc'), c('hearts', 11, 'Jh'), c('spades', 10, '10s'), c('diamonds', 9, '9d'), c('clubs', 8, '8c'), c('hearts', 7, '7h'), c('clubs', 6, '6c'), c('diamonds', 5, '5d'), c('clubs', 4, '4c'), c('diamonds', 3, '3d')],
    [c('hearts', 13, 'Kh'), c('spades', 12, 'Qs'), c('diamonds', 11, 'Jd'), c('clubs', 10, '10c'), c('hearts', 9, '9h'), c('spades', 8, '8s'), c('diamonds', 7, '7d'), c('spades', 6, '6s')],
    [c('clubs', 13, 'Kc'), c('hearts', 12, 'Qh')],
    [],
    [],
    [c('diamonds', 1, 'Ad', false), c('spades', 4, '4s', false), c('spades', 11, 'Js', false), c('diamonds', 10, '10d'), c('spades', 9, '9s'), c('hearts', 8, '8h'), c('spades', 7, '7s'), c('hearts', 6, '6h'), c('spades', 5, '5s')],
  ];
  // The trap: hasAnyValidMove counts the King-shuffle as a move, so the modal
  // must NOT be driven by it. The detector now considers foundation retreats and
  // proves a (retreat-enabled) move IS reachable, so the modal must NOT appear.
  assert.equal(hasAnyValidMove(s), true);
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true);
});

/**
 * The board reported as a dead end (Game Mode: Random) actually has a legal
 * move — 8s (column 7) builds onto 9h (column 3) — so the "no moves" modal
 * correctly stays hidden. Captured as a regression so the detector keeps
 * recognizing it as alive.
 */
function buildReportedRandomBoard() {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 7 }, (_, i) => c('hearts', i + 1, `fh${i + 1}`));
  s.foundations[1] = Array.from({ length: 9 }, (_, i) => c('clubs', i + 1, `fc${i + 1}`));
  s.foundations[2] = Array.from({ length: 3 }, (_, i) => c('diamonds', i + 1, `fd${i + 1}`));
  s.foundations[3] = Array.from({ length: 5 }, (_, i) => c('spades', i + 1, `fs${i + 1}`));
  // Tableau, bottom->top. Reported top->bottom; first listed = top.
  s.tableau[0] = [c('clubs', 13, 'cK'), c('diamonds', 12, 'dQ'), c('clubs', 11, 'cJ'), c('diamonds', 10, 'd10')];
  s.tableau[1] = [
    c('spades', 13, 'sK'), c('hearts', 12, 'hQ'), c('spades', 11, 'sJ'), c('hearts', 10, 'h10'),
    c('spades', 9, 's9'), c('hearts', 8, 'h8'), c('spades', 7, 's7'), c('hearts', 6, 'h6'),
  ];
  s.tableau[2] = [
    c('hearts', 13, 'hK'), c('clubs', 12, 'cQ'), c('hearts', 11, 'hJ'), c('clubs', 10, 'c10'), c('hearts', 9, 'h9'),
  ];
  s.tableau[3] = [c('diamonds', 13, 'dK'), c('spades', 12, 'sQ')];
  s.tableau[4] = [];
  s.tableau[5] = [];
  s.tableau[6] = [
    c('diamonds', 5, 'd5', false), c('spades', 6, 's6', false), c('diamonds', 7, 'd7', false),
    c('spades', 10, 's10'), c('diamonds', 9, 'd9'), c('spades', 8, 's8'),
    c('diamonds', 7, 'd7b'), c('spades', 6, 's6b'), c('diamonds', 5, 'd5b'),
  ];
  return s;
}

test('reported random board with only a non-progress 8s->9h shuffle is a genuine dead end', () => {
  const s = buildReportedRandomBoard();
  // The only *tableau* moves are non-covering relocations (e.g. 8s->9h) that
  // uncover nothing and reach no foundation play, and the only foundation retreat
  // available (e.g. 5h onto a 6) is a no-op: it cannot uncover the buried cards
  // in column 7 (its run has no red-J landing) and the only follow-up is returning
  // the card to its foundation. Correctly excluding such no-op loops, this position
  // is genuinely stuck and the modal must appear.
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), false);
});

/**
 * Regression for the false "No More Moves" modal reported against a board where
 * moving 9c from the waste onto pile 1 (on top of 10h) was wrongly flagged as a
 * dead end. The position is NOT stuck: from here a foundation retreat rescues it
 * — 8d (foundation 4) onto 9c (pile 1), then 7d (foundation 4) onto 8c (pile 3),
 * which unlocks 6s (pile 6) and reveals buried cards. The dead-end detector must
 * consider foundation->tableau retreats and report a move is reachable.
 *
 * Constructed as the board AFTER the 9c->pile1 move: stock and waste empty, the
 * 7 tableau columns as reported, and the four foundations as reported.
 * Core tableau arrays are BOTTOM->TOP; the report listed TOP->BOTTOM, so each is
 * reversed below.
 */
test('regression: waste->tableau followed by foundation retreat is not a dead end', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.stock = [];
  s.waste = [];
  s.foundations[0] = [c('hearts', 1, 'Ah'), c('hearts', 2, '2h')];
  s.foundations[1] = [c('clubs', 1, 'Ac'), c('clubs', 2, '2c'), c('clubs', 3, '3c'), c('clubs', 4, '4c')];
  s.foundations[2] = [c('spades', 1, 'As'), c('spades', 2, '2s'), c('spades', 3, '3s'), c('spades', 4, '4s')];
  s.foundations[3] = [
    c('diamonds', 1, 'Ad'), c('diamonds', 2, '2d'), c('diamonds', 3, '3d'), c('diamonds', 4, '4d'),
    c('diamonds', 5, '5d'), c('diamonds', 6, '6d'), c('diamonds', 7, '7d'), c('diamonds', 8, '8d'),
  ];
  s.tableau = [
    // pile 1: 9c (just placed) on top of 10h, Js, Qd, Ks
    [c('spades', 13, 'Ks'), c('diamonds', 12, 'Qd'), c('spades', 11, 'Js'), c('hearts', 10, '10h'), c('clubs', 9, '9c')],
    [c('hearts', 13, 'Kh'), c('clubs', 12, 'Qc'), c('hearts', 11, 'Jh'), c('clubs', 10, '10c'), c('hearts', 9, '9h'), c('spades', 8, '8s'), c('hearts', 7, '7h'), c('clubs', 6, '6c'), c('hearts', 5, '5h')],
    [c('diamonds', 13, 'Kd'), c('spades', 12, 'Qs'), c('diamonds', 11, 'Jd'), c('clubs', 10, '10s'), c('diamonds', 9, '9d'), c('clubs', 8, '8c')],
    [c('clubs', 13, 'Kc')],
    // pile 5: three face-down then 10d,9s,8h,7c,6h,5s,4h (top)
    [c('spades', 4, 'h5a', false), c('diamonds', 4, 'h5b', false), c('hearts', 4, 'h5c', false), c('diamonds', 10, '10d'), c('spades', 9, '9s'), c('hearts', 8, '8h'), c('clubs', 7, '7c'), c('hearts', 6, '6h'), c('spades', 5, '5s'), c('hearts', 4, '4h')],
    // pile 6: two face-down then 6s (top)
    [c('clubs', 2, 'h6a', false), c('diamonds', 2, 'h6b', false), c('spades', 6, '6s')],
    [],
  ];

  // The cheap pre-filter sees no immediate progress/waste move, which is exactly
  // why this position reaches the async dead-end detector in the first place.
  assert.equal(hasDeadEndMove(s), false);
  // A move IS reachable via a foundation retreat (8d->pile1 ...), so the modal
  // must NOT appear.
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true);
});

/**
 * Dead-end regression for the "no valid moves" dialog (reported 2026-08-22,
 * Game Mode: Random). The original report described reaching a stuck position
 * after relocating the 4c/3h run from column 7 onto the 5h in column 3: stock
 * is empty and no card can reach a foundation, so the only tableau move (the
 * 4c+3h run, column 7 -> column 3) never frees 4c for its foundation because
 * 3h has no other legal home.
 *
 * The literal card data originally transcribed for that report was NOT actually
 * a dead end (4c reached the clubs A,2,3 foundation and several cross-column
 * runs remained playable), so it could not lock in the bug. This helper builds a
 * faithful minimal reconstruction of the same scenario — empty stock, a 4c/3h
 * run that shuffles onto a 5h — and applies that exact move, producing a
 * position that is genuinely stuck (verified: hasDeadEndMove === false AND
 * findReachableMove === false; the only remaining "move" is recycling the lone
 * waste card, which never creates a real play). The store must re-ask
  * evaluateDeadEnd after the move that reaches this position (see useGameStore.js
  * moveCard fix) so the modal fires.
 */
function buildStuckAfter4c3hShuffleBoard() {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();

  s.foundations[0] = [c('spades', 1, 'fsA')];
  s.foundations[1] = [c('diamonds', 1, 'fdA'), c('diamonds', 2, 'fd2')];
  s.foundations[2] = [c('clubs', 1, 'fcA'), c('clubs', 2, 'fc2')]; // no 3c: 4c cannot reach foundation
  s.foundations[3] = [];

  s.waste = [c('diamonds', 4, 'w4d')];
  s.stock = [];

  // Exposed cards are all red and low-rank so no cross-column rank+1 landing
  // exists, and no foundation play is reachable. Board is bottom->top.
  s.tableau[0] = [c('hearts', 13, 't0Kh'), c('hearts', 2, 't0_2h')];
  s.tableau[1] = [c('hearts', 12, 't1Qh'), c('hearts', 3, 't1_3h')];
  s.tableau[2] = [c('hearts', 11, 't2Jh'), c('hearts', 4, 't2_4h')];
  s.tableau[3] = [c('hearts', 5, 't3_5h')];
  s.tableau[4] = [c('hearts', 10, 't4_10h'), c('diamonds', 2, 't4_2d')];
  s.tableau[5] = [c('hearts', 9, 't5_9h'), c('hearts', 3, 't5_3h')];
  s.tableau[6] = [
    c('spades', 4, 'hidden_p7', false),
    c('hearts', 6, 't7_6h'), c('clubs', 4, 't7_4c'), c('hearts', 3, 't7_3h'),
  ];

  // Apply the reported shuffle: relocate the 4c/3h run from column 7 onto the
  // 5h in column 3, reaching the stuck position.
  return applyMove(s, { type: 'moveCards', from: 'tableau:6', to: 'tableau:3', cardIds: ['t7_3h', 't7_4c'] });
}

test('board reached after the 4c/3h column-7 -> column-3 shuffle is a genuine dead end', () => {
  const s = buildStuckAfter4c3hShuffleBoard();
  // No *tableau* move uncovers anything and no foundation play is reachable from
  // the visible cards. A foundation card CAN be retreated onto the tableau (e.g.
  // 2c onto a 3), but such a retreat is a no-op: it cannot uncover the buried
  // card (still blocked by the 6h, which has no black-7 landing) and the only
  // follow-up is returning the card to its foundation. With foundation retreats
  // correctly excluded from "progress", this position is genuinely stuck, so the
  // modal must appear.
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), false);
});

/**
 * Genuine dead-end regression: even with foundation->tableau retreats now
 * considered, a board where EVERY tableau pile is topped by a King (Kings can
 * only move onto an empty column, and there are none) and every foundation top
 * is too low to retreat onto any tableau top has literally no reachable move.
 * This pins down that the detector still reports a real dead end (so the modal
 * still shows for boards that are truly hopeless) and that foundation retreats
 * did not make the detector declare "never stuck".
 */
test('genuine dead end: all-Kings tableau, no retreat possible', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.stock = [];
  s.waste = [];
  // Foundation tops are rank 1 — a retreat needs a rank-2 opposite-color tableau
  // top, but every tableau top is a King (rank 13), so no retreat exists.
  s.foundations[0] = [c('clubs', 1, 'Ac')];
  s.foundations[1] = [c('spades', 1, 'As')];
  s.foundations[2] = [c('hearts', 1, 'Ah')];
  s.foundations[3] = [c('diamonds', 1, 'Ad')];
  // Each pile: a face-up card beneath a King. Kings cannot relocate (no empty
  // column) so the buried card can never be uncovered, and no foundation play is
  // available (tops are all Kings; waste empty).
  s.tableau = [
    [c('clubs', 5, 'b0'), c('spades', 13, 'K0')],
    [c('hearts', 5, 'b1'), c('hearts', 13, 'K1')],
    [c('diamonds', 5, 'b2'), c('clubs', 13, 'K2')],
    [c('spades', 5, 'b3'), c('diamonds', 13, 'K3')],
    [c('clubs', 5, 'b4'), c('hearts', 13, 'K4')],
    [c('hearts', 5, 'b5'), c('clubs', 13, 'K5')],
    [c('diamonds', 5, 'b6'), c('spades', 13, 'K6')],
  ];
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), false);
});

// Faithful reconstruction of user-reported dead-end boards (top-to-bottom tableau
// order per the report; '00' = a face-down card). The buried cards beneath the
// immovable covering runs can never be uncovered, so all four foundations stay
// blocked and the position is genuinely unwinnable.
function buildDeadEndBoard(foundations, waste, tableaus) {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const sm = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
  const rm = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
  let bd = 0;
  const tok = (t) => {
    if (t === '00') return c('spades', 1, 'bd' + bd++, false);
    const r = t.slice(0, -1);
    const s = t.slice(-1);
    return c(sm[s], rm[r], s + r);
  };
  const fArr = foundations.map((list) => list.split(',').map((x) => x.trim()).filter(Boolean).map(tok));
  const wArr = waste.split(',').map((x) => x.trim()).filter(Boolean).map(tok);
  const tArr = tableaus.map((list) => {
    const toks = list.split(',').map((x) => x.trim()).filter(Boolean);
    const fds = toks.filter((t) => t === '00').length;
    const ups = toks.filter((t) => t !== '00');
    const pile = [];
    for (let i = 0; i < fds; i++) pile.push(tok('00'));
    for (let i = ups.length - 1; i >= 0; i--) pile.push(tok(ups[i])); // top = ups[0]
    return pile;
  });
  const s = createEmptyGameState();
  s.stock = [];
  s.waste = wArr;
  s.foundations = fArr;
  s.tableau = tArr;
  return s;
}

test('Game Mode 6683 is a genuine dead end (no winning line reachable)', () => {
  const s = buildDeadEndBoard(
    ['Ah,2h,3h', 'As,2s,3s,4s,5s', 'Ad', 'Ac,2c,3c'],
    '8d,10c,9c',
    [
      '5h,6s,7h,8s,9d,10s,Jh,Qc,Kh',
      '6h,7s,8h,9s,10d,Jc,Qd,Ks',
      'Qs,Kd',
      'Js,Qh,Kc',
      '',
      '3d,4c,5d,6c,7d,8c,9h,00,00',
      '5c,6d,7c,00,00,00',
    ]
  );
  // The cheap pre-filter correctly sees no immediate progress move...
  assert.equal(hasDeadEndMove(s), false);
  // ...but the legacy move-existence detector is fooled: a foundation retreat
  // (e.g. 5s/4s off spades) enables a lateral 4c->clubs foundation play, so
  // findReachableMove wrongly reports the position as alive.
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true);
  // The win-prover correctly proves NO winning line is reachable -> dead end.
  assert.equal(findWinningSequence(s, { maxNodes: 500000, maxMs: 4000 }), null);
  // The fully-drained synchronous edge case must also report a dead end.
  const drained = {
    ...s,
    stock: [],
    waste: [],
    moveHistory: [{ type: 'moveCards', from: 'waste', to: 'foundation:0', cardIds: ['x'] }],
  };
  assert.equal(isDrainedFoundationDeadEnd(drained), true);
});

test('Game Mode 6471 is a genuine dead end (no winning line reachable)', () => {
  const s = buildDeadEndBoard(
    ['Ad,2d,3d', 'Ac', 'Ah,2h', ''],
    '5c,Jd,6d,3c',
    [
      '3s,4d,5s,6h,7s,8h,9s,10h,Js',
      '8d,9c,10d,Jc,Qh,Kc',
      '8s,9h,10s,Jh,Qs,Kh',
      '',
      '6s,00,00,00',
      '2s,3h,4s,00',
      '4c,5h,6c,7d,8c,9d,10c,00,00,00,00,00,00',
    ]
  );
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), true); // legacy detector fooled
  assert.equal(findWinningSequence(s, { maxNodes: 500000, maxMs: 4000 }), null); // win-prover: dead end
});

test('compressWinningSequence never breaks a win and can drop redundant tableau shuffles', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  // Full 52-card state that is one step pattern away from a win: the hearts
  // king/queen are on the tableau, the rest of every suit is on its foundation.
  s.foundations[0] = Array.from({ length: 12 }, (_, i) => c('spades', i + 1, `s${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 11 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [
    [c('hearts', 12, 'hQ')], // hQ: can go to foundation:3, or bounce to tableau:1
    [c('spades', 13, 'sK')], // sK: goes to foundation:0
    [c('hearts', 13, 'hK')], // hK: goes to foundation:3
    [], [], [], [],
  ];
  assert.equal(isWon(s), false);

  // A winning line that needlessly shuttles hQ between tableau:0 and tableau:1
  // (a round-trip) before sending it to the foundation. The round-trip is pure
  // churn: hQ can reach its foundation straight from tableau:0.
  const seq = [
    { type: 'moveCards', from: 'tableau:0', to: 'tableau:1', cardIds: ['hQ'] }, // hQ -> t1
    { type: 'moveCards', from: 'tableau:1', to: 'tableau:0', cardIds: ['hQ'] }, // hQ -> t0 (return)
    { type: 'moveCards', from: 'tableau:0', to: 'foundation:3', cardIds: ['hQ'] }, // hQ -> f3
    { type: 'moveCards', from: 'tableau:1', to: 'foundation:0', cardIds: ['sK'] }, // sK -> f0
    { type: 'moveCards', from: 'tableau:2', to: 'foundation:3', cardIds: ['hK'] }, // hK -> f3
  ];
  assert.equal(isWon(replay(s, seq)), true, 'hand-built sequence must win');

  const out = compressWinningSequence(seq, s);
  assert.ok(out.length < seq.length, 'redundant shuffle should be removed');
  assert.equal(isWon(replay(s, out)), true, 'compressed sequence must still win');
});

test('compressWinningSequence collapses a multi-step tableau cycle (P→Q→R→P)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 12 }, (_, i) => c('spades', i + 1, `s${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 11 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [[c('hearts', 12, 'hQ')], [c('spades', 13, 'sK')], [c('hearts', 13, 'hK')], [], [], [], []];

  // hQ needlessly cycles 0→1→2→0 (a 3-column cycle returning to its origin)
  // before going to its foundation; the whole cycle is pure churn and must be
  // collapsed (the old code only caught the direct 0→1→0 round-trip).
  const seq = [
    { type: 'moveCards', from: 'tableau:0', to: 'tableau:1', cardIds: ['hQ'] },
    { type: 'moveCards', from: 'tableau:1', to: 'tableau:2', cardIds: ['hQ'] },
    { type: 'moveCards', from: 'tableau:2', to: 'tableau:0', cardIds: ['hQ'] },
    { type: 'moveCards', from: 'tableau:0', to: 'foundation:3', cardIds: ['hQ'] },
    { type: 'moveCards', from: 'tableau:1', to: 'foundation:0', cardIds: ['sK'] },
    { type: 'moveCards', from: 'tableau:2', to: 'foundation:3', cardIds: ['hK'] },
  ];
  assert.equal(isWon(replay(s, seq)), true, 'hand-built cycle sequence must win');

  const out = compressWinningSequence(seq, s);
  assert.ok(out.length < seq.length, 'redundant cycle should be removed');
  assert.equal(isWon(replay(s, out)), true, 'compressed sequence must still win');
  const remainingTableau = out.filter((m) => m.type === 'moveCards' && String(m.to).startsWith('tableau:'));
  assert.equal(remainingTableau.length, 0, 'no tableau churn should remain');
});

test('compressWinningSequence preserves a genuinely required tableau shuffle from the solver', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[2] = Array.from({ length: 11 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[3] = Array.from({ length: 9 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [
    [c('hearts', 10, 'h10'), c('hearts', 11, 'hJ')],
    [c('clubs', 12, 'c12')],
    [c('hearts', 12, 'hQ')],
    [c('hearts', 13, 'hK')],
    [c('clubs', 13, 'cK')],
    [], [],
  ];
  const seq = findWinningSequence(s);
  assert.ok(seq, 'solver must find a win');
  assert.equal(isWon(replay(s, seq)), true);
  assert.equal(seq.some((m) => m.type === 'moveCards' && String(m.to).startsWith('tableau:')), true, 'solver line must use a tableau shuffle');
  const out = compressWinningSequence(seq, s);
  assert.equal(isWon(replay(s, out)), true, 'compressed line must still win');
  // The forced shuffle (hJ onto c12 to expose h10) is the only way to win, so it
  // must survive compression — this guards against over-aggressive removal.
  assert.equal(out.some((m) => m.type === 'moveCards' && String(m.to).startsWith('tableau:')), true, 'required shuffle must not be dropped');
});

test('compressWinningSequence is a no-op for an already-minimal foundation-only line', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `s${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [
    [c('hearts', 11, 'hJ')],
    [c('hearts', 12, 'hQ')],
    [c('hearts', 13, 'hK')],
    [], [], [], [],
  ];
  const seq = findWinningSequence(s);
  assert.ok(seq && seq.length > 0);
  const out = compressWinningSequence(seq, s);
  assert.equal(out.length, seq.length, 'no redundant moves to remove');
  assert.equal(isWon(replay(s, out)), true);
});

test('solver flips the last face-down card when the only way to expose it needs a tableau relocation', () => {
  // Near-endgame precondition from the report: stock and waste both empty, every
  // card face-up EXCEPT exactly one face-down card (the hearts Jack at the bottom
  // of column 0). The Jack is buried under the clubs Queen, and the Queen is NOT
  // yet foundation-playable (its predecessor, the clubs Jack, is still on the
  // tableau). So a foundation-only greedy auto-complete would make NO move at all
  // and stall — the face-down Jack is never exposed. The win requires relocating
  // the Queen onto the hearts King (a tableau move), which flips the exposed Jack,
  // and only THEN can the suits be completed. This is exactly the
  // "auto-complete stalls before flipping" bug.
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 10 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));   // clubs 1..10
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));   // hearts 1..10

  // Valid descending-alternating columns; only hJ is face-down.
  s.tableau = [
    [c('hearts', 11, 'hJ', false), c('clubs', 12, 'cQ')], // hJ face-down, cQ on top
    [c('clubs', 11, 'cJ'), c('hearts', 12, 'hQ')],
    [c('clubs', 13, 'cK')],
    [c('hearts', 13, 'hK')],
    [], [], [],
  ];

  assert.equal(s.stock.length, 0);
  assert.equal(s.waste.length, 0);
  assert.equal(isAllTableauFaceUp(s), false, 'precondition: one face-down card remains');

  // Foundation-only greedy cannot move a single card here, so it stalls.
  let greedy = s;
  let guard = 0;
  while (guard++ < 50) {
    const fm = findFoundationMove(greedy);
    if (!fm) break;
    greedy = applyMove(greedy, { type: 'moveCards', from: fm.from, to: fm.to, cardIds: [fm.cardId] });
  }
  assert.equal(isWon(greedy), false, 'foundation-only greedy cannot finish this board');

  // The solver, by contrast, must prove a full win — which is only possible if it
  // relocates a card, flips the exposed hJ, and clears the board.
  const seq = findWinningSequence(s);
  assert.ok(Array.isArray(seq), 'solver must find a winning line');
  assert.equal(isWon(replay(s, seq)), true, 'winning line must clear the board (face-down flipped)');
  assert.equal(
    seq.some((m) => m.type === 'moveCards' && String(m.to).startsWith('tableau:')),
    true,
    'win requires a tableau relocation to expose the face-down card',
  );
  // The once-face-down card must end flipped on its foundation (proving it was exposed).
  const hJFinal = replay(s, seq).foundations.flat().find((card) => card.id === 'hJ');
  assert.ok(hJFinal && hJFinal.faceUp, 'the once-face-down card must be flipped and on a foundation');
});

/**
 * Hard-lock tests for auto-complete: with `allowTableau: false` the solver must
 * never plan a column-to-column shuffle, and the auto-trigger (getAutoFireSolveOptions)
 * must only fire when a foundation-only win is provable from an empty stock.
 */

test('hard-lock: a foundation-only win (empty stock) contains zero tableau moves', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  // Remaining hearts sit on the waste (top) and two tableau tops — all directly
  // foundation-playable, no column shuffle, no recycling required.
  s.waste = [c('hearts', 11, 'hJ')];
  s.tableau = [[c('hearts', 12, 'hQ')], [c('hearts', 13, 'hK')], [], [], [], [], []];
  const seq = findWinningSequence(s, { allowTableau: false, allowDraw: false });
  assert.ok(Array.isArray(seq) && seq.length > 0, 'expected a winning sequence with no tableau moves');
  assert.equal(isWon(replay(s, seq)), true);
  const hadTableauMove = seq.some((m) => m.type === 'moveCards' && String(m.to).startsWith('tableau:'));
  assert.equal(hadTableauMove, false, 'hard-lock line must contain zero tableau-to-tableau moves');
});

test('hard-lock: a win requiring a tableau shuffle returns null (no tableau moves allowed)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[2] = Array.from({ length: 11 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[3] = Array.from({ length: 9 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  // h10 buried under hJ; its only exposure is a forced tableau relocation.
  s.tableau = [
    [c('hearts', 10, 'h10'), c('hearts', 11, 'hJ')],
    [c('clubs', 12, 'c12')],
    [c('hearts', 12, 'hQ')],
    [c('hearts', 13, 'hK')],
    [c('clubs', 13, 'cK')],
    [], [],
  ];
  const seq = findWinningSequence(s, { allowTableau: false, allowDraw: false });
  assert.equal(seq, null, 'with tableau moves forbidden, no win is provable');
});

test('hard-lock: a win reachable only by drawing stock still needs zero tableau moves', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [[c('hearts', 11, 'hJ')], [], [], [], [], [], []];
  s.stock = [c('hearts', 13, 'hK', false), c('hearts', 12, 'hQ', false)]; // hQ draws first
  const seq = findWinningSequence(s, { allowTableau: false });
  assert.ok(Array.isArray(seq) && seq.length > 0, 'expected a draw-driven winning sequence with no tableau moves');
  assert.equal(isWon(replay(s, seq)), true);
  const hadTableauMove = seq.some((m) => m.type === 'moveCards' && String(m.to).startsWith('tableau:'));
  assert.equal(hadTableauMove, false, 'line must contain zero tableau-to-tableau moves');
});

test('getAutoFireSolveOptions: false while stock is non-empty even if fully face-up', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [[c('hearts', 11, 'hJ')], [c('hearts', 12, 'hQ')], [c('hearts', 13, 'hK')], [], [], [], []];
  s.stock = [c('clubs', 1, 'cA', false)];
  assert.equal(getAutoFireSolveOptions(s), null, 'a non-empty stock must block the auto-trigger');
});

test('getAutoFireSolveOptions: fires when stock empty and a foundation-only win is provable', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.waste = [c('hearts', 11, 'hJ')];
  s.tableau = [[c('hearts', 12, 'hQ')], [c('hearts', 13, 'hK')], [], [], [], [], []];
  assert.deepEqual(getAutoFireSolveOptions(s), { allowTableau: false, allowDraw: false }, 'foundation-only win with empty stock should auto-fire');
});

test('getAutoFireSolveOptions: false when the foundation-only win needs a tableau relocation', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[2] = Array.from({ length: 11 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[3] = Array.from({ length: 9 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [
    [c('hearts', 10, 'h10'), c('hearts', 11, 'hJ')],
    [c('clubs', 12, 'c12')],
    [c('hearts', 12, 'hQ')],
    [c('hearts', 13, 'hK')],
    [c('clubs', 13, 'cK')],
    [], [],
  ];
  assert.equal(getAutoFireSolveOptions(s), null, 'a board needing a tableau shuffle must NOT auto-fire');
});

// Simulate the greedy "auto-move visible cards" peel: repeatedly apply the next
// foundation move (exactly what the manual autoComplete does via runGreedy). It
// must NEVER draw from or recycle the stock, and must never relocate between
// tableau columns — only waste-top / face-up tableau-tops to foundations.
function greedyPeel(state, maxSteps = 200) {
  const moves = [];
  let cur = state;
  for (let i = 0; i < maxSteps; i++) {
    const fm = findFoundationMove(cur);
    if (!fm) break;
    const move = { type: 'moveCards', from: fm.from, to: fm.to, cardIds: [fm.cardId] };
    moves.push(move);
    cur = applyMove(cur, move);
  }
  return { state: cur, moves };
}

test('greedy foundation peel never touches the stock (no draw, no recycle)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 5 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.tableau = [
    [c('clubs', 6, 'cl6')],
    [c('clubs', 7, 'cl7')],
    [], [], [], [], [],
  ];
  // Stock and waste both populated so any stock interaction would be detectable.
  s.stock = [c('spades', 1, 'sA', false), c('spades', 2, 's2', false)];
  s.waste = [c('clubs', 8, 'cl8')];
  const before = s.stock.length;
  const { moves } = greedyPeel(s);
  assert.ok(moves.length > 0, 'should peel at least the waste-top and tableau-tops');
  assert.equal(s.stock.length, before, 'stock must be untouched by a greedy peel');
  assert.ok(
    moves.every((m) => m.type === 'moveCards' && String(m.to).startsWith('foundation')),
    'every greedy move must be a foundation move',
  );
});

test('a foundation-only winning sequence (allowTableau:false, allowDraw:false) contains no draw/recycle moves', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.waste = [c('hearts', 11, 'hJ')];
  s.tableau = [[c('hearts', 12, 'hQ')], [c('hearts', 13, 'hK')], [], [], [], [], []];
  const seq = findWinningSequence(s, { allowTableau: false, allowDraw: false });
  assert.ok(Array.isArray(seq), 'expected a winning sequence');
  assert.ok(
    seq.every((m) => m.type === 'moveCards' && String(m.to).startsWith('foundation')),
    'foundation-only solve must contain only foundation moves (no draw/recycle)',
  );
});

test('wouldGreedyComplete: true when a foundation-only peel with buried cards finishes the game', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  // h11 (face-up, top) covers two buried hearts; the peel sends h11 to its
  // foundation, flipping both buried cards which then also ascend. Stock/waste
  // empty → foundation-only. (Tableau arrays are bottom→top, so the face-up
  // covering card is last.)
  s.tableau = [[], [], [], [], [], [c('hearts', 13, 'h13', false), c('hearts', 12, 'h12', false), c('hearts', 11, 'h11')], []];
  assert.equal(s.stock.length, 0);
  assert.equal(wouldGreedyComplete(s), true, 'a peel that clears the board must report completion');
});

test('wouldGreedyComplete: false when finishing would require drawing from the stock', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  // Same shape as the completing board, but the last heart sits in the (non-empty)
  // stock, which a greedy peel never draws from — so it cannot finish.
  s.tableau = [[], [], [], [], [], [c('hearts', 12, 'h12', false), c('hearts', 11, 'h11')], []];
  s.stock = [c('hearts', 13, 'h13', false)];
  assert.equal(wouldGreedyComplete(s), false, 'a board needing a stock draw must NOT report completion');
});

