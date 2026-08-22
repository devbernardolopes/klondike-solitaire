// core/solver.test.js
// Tests for the auto-complete solver: it must prove wins (including ones that
// require tableau shuffles and stock cycling) and replay to a cleared board,
// and report null when no win is provable. Also covers the isAutoCompletable
// trigger gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { findWinningSequence, findReachableMove, hasDeadEndMove, isAutoCompletable, SOLVER_TIMEOUT, compressWinningSequence } from './solver.js';
import { applyMove } from './moveEngine.js';
import { isWon } from './winDetection.js';

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
  assert.equal(isAutoCompletable(s), true);
});

test('isAutoCompletable is false while a tableau card is still face-down', () => {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const s = createEmptyGameState();
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `s${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.tableau = [[c('hearts', 11, 'hJ')], [c('hearts', 12, 'hQ')], [c('hearts', 13, 'hK')], [], [], [], []];
  s.tableau[0][0] = { ...s.tableau[0][0], faceUp: false };
  assert.equal(isAutoCompletable(s), false);
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
  assert.equal(isAutoCompletable(s), false);
});

test('a reachable relocation move is NOT a dead end (any-move semantics)', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  // hQ on sK, with empty columns available: sK can move to an empty column — that
  // is a legal (if non-progress) move, so the position is NOT stuck.
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  s.foundations[0][10] = c('spades', 11, 'sp11');
  s.foundations[0] = s.foundations[0].slice(0, 11);
  s.tableau = [[c('hearts', 12, 'hQ'), c('spades', 13, 'sK')], [], [], [], [], [], []];
  const seq = findReachableMove(s, { maxNodes: 2 });
  assert.equal(seq, true);
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

test('reported random board has a real move (8s->9h), modal stays hidden', () => {
  const s = buildReportedRandomBoard();
  assert.equal(hasDeadEndMove(s), true);
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
 * checkDeadEnd after the move that reaches this position (see useGameStore.js
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
  assert.equal(hasDeadEndMove(s), false);
  assert.equal(findReachableMove(s, { maxNodes: 500000, maxMs: 4000 }), false);
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

