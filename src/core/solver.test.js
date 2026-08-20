// core/solver.test.js
// Tests for the auto-complete solver: it must prove wins (including ones that
// require tableau shuffles and stock cycling) and replay to a cleared board,
// and report null when no win is provable. Also covers the isAutoCompletable
// trigger gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { findWinningSequence, findReachableProgress, isAutoCompletable, SOLVER_TIMEOUT } from './solver.js';
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

test('budget-exceeded search returns SOLVER_TIMEOUT, not null', () => {
  const c = (suit, rank, id, faceUp = true) => createCard(suit, rank, { faceUp, id });
  const s = createEmptyGameState();
  // A board with real (non-progress) moves — a hQ/sK build loop — but no
  // foundation move and no face-down to uncover, so no progress is ever
  // reachable. A tiny node budget forces an abort before the loop is explored,
  // exercising the SOLVER_TIMEOUT sentinel (distinct from a definitive `false`).
  s.foundations[0] = Array.from({ length: 13 }, (_, i) => c('spades', i + 1, `sp${i + 1}`));
  s.foundations[1] = Array.from({ length: 13 }, (_, i) => c('clubs', i + 1, `cl${i + 1}`));
  s.foundations[2] = Array.from({ length: 13 }, (_, i) => c('diamonds', i + 1, `d${i + 1}`));
  s.foundations[3] = Array.from({ length: 10 }, (_, i) => c('hearts', i + 1, `h${i + 1}`));
  // spades built only to 11 (sK=13 can't go), hearts only to 10 (hQ=12 can't go).
  s.foundations[0][10] = c('spades', 11, 'sp11'); // ensure spades top is 11
  s.foundations[0] = s.foundations[0].slice(0, 11);
  s.tableau = [[c('hearts', 12, 'hQ'), c('spades', 13, 'sK')], [], [], [], [], [], []];
  const seq = findReachableProgress(s, { maxNodes: 2 });
  assert.equal(seq, SOLVER_TIMEOUT);
  assert.ok(!Array.isArray(seq));
});
