// core/rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { hasProgressMove, hasAnyValidMove, findFoundationMove } from './rules.js';
import { findWinningSequence } from './solver.js';

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

test('reported dead-end board: solver proves no winning line', () => {
  const s = buildReportedBoard();
  // With the stock exhausted and only King shuffles available, no win is
  // provable — so the "no moves remaining" modal should be shown.
  assert.equal(findWinningSequence(s), null);
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
