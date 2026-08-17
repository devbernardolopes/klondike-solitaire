// core/rules.assist.test.js
// Regression test for the auto-complete "assist" search bouncing a run between
// two tableau columns. Reproduces the reported board:
//   Foundations: 2h, 3s, -, -
//   Waste: 7d   Stock: (face-down, irrelevant)
//   Tableau (bottom→top):
//     1: Kc
//     2: Jh
//     3: 6d, 5s, 4h, 3c, 2d
//     4: Jc, 10h, 9s, 8d, 7c, 6h, 5s, 4h
//     5: 4s, 3d
//     6: Qc, Jd, 10s
//     7: 4c
// The assist search must return the genuinely-useful move 3d→pile7 (which
// unblocks 4s→foundation), NOT a pointless 3c,2d shuffle between pile 3 and 4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { findAssistTableauMove, findFoundationMove } from './rules.js';
import { getTableauRun } from './rules.js';
import { applyMove } from './moveEngine.js';

function buildReportedState() {
  const c = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });
  const fd = (suit, rank, id) => createCard(suit, rank, { faceUp: false, id });
  const s = createEmptyGameState();
  s.foundations[0] = [c('hearts', 2, '2h')];
  s.foundations[1] = [c('spades', 3, '3s')];
  s.waste = [c('diamonds', 7, '7d')];
  // Non-empty face-down stock (contents irrelevant to the search).
  s.stock = [fd('clubs', 1, 'stock1'), fd('diamonds', 1, 'stock2')];
  s.tableau = [
    [c('clubs', 13, 'Kc')],
    [c('hearts', 11, 'Jh')],
    [c('diamonds', 6, '6d'), c('spades', 5, '5s'), c('hearts', 4, '4h'), c('clubs', 3, '3c'), c('diamonds', 2, '2d')],
    [c('clubs', 11, 'Jc'), c('hearts', 10, '10h'), c('spades', 9, '9s'), c('diamonds', 8, '8d'), c('clubs', 7, '7c'), c('hearts', 6, '6h'), c('spades', 5, '5s2'), c('hearts', 4, '4h2')],
    [c('spades', 4, '4s'), c('diamonds', 3, '3d')],
    [c('clubs', 12, 'Qc'), c('diamonds', 11, 'Jd'), c('spades', 10, '10s')],
    [c('clubs', 4, '4c')],
  ];
  return s;
}

test('findAssistTableauMove returns the useful 3d→pile7 move, not a pile3⇄pile4 shuffle', () => {
  const state = buildReportedState();
  // Sanity: no foundation move is directly available (that's why assist runs).
  assert.equal(findFoundationMove(state), null);

  const move = findAssistTableauMove(state);
  assert.ok(move, 'expected an assist move to be found');

  // It must NOT be the pointless 3c,2d bounce between columns 2 and 3.
  const isPile3Shuffle =
    (move.fromCol === 2 && move.toCol === 3) || (move.fromCol === 3 && move.toCol === 2);
  assert.equal(isPile3Shuffle, false, 'assist must not bounce 3c,2d between pile 3 and 4');

  // It SHOULD be 3d leaving column 4 (pile 5) onto column 6 (pile 7).
  assert.equal(move.fromCol, 4);
  assert.equal(move.cardId, '3d');
  assert.equal(move.toCol, 6);
});

test('the assist move actually unblocks a foundation move', () => {
  const state = buildReportedState();
  const move = findAssistTableauMove(state);
  assert.ok(move);

  const run = getTableauRun(state.tableau[move.fromCol], move.cardId);
  const cardIds = run.map((card) => card.id).reverse();
  const next = applyMove(state, {
    type: 'moveCards',
    from: `tableau:${move.fromCol}`,
    to: `tableau:${move.toCol}`,
    cardIds,
  });

  // After the assist move, 4s should be exposed on pile 5 and ready for the
  // foundation (3s → 4s).
  const fm = findFoundationMove(next);
  assert.ok(fm, 'assist move should unblock a foundation move');
  assert.equal(fm.from, 'tableau:4');
  assert.equal(fm.cardId, '4s');
  assert.equal(fm.to, 'foundation:1');
});
