// core/moveLog.test.js
// Compact move-log notation: draw / recycle / undo / single / run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { formatMove, formatUndo, shortLocator, moveCardLabel, serializeMoveLog } from './moveLog.js';

const up = (suit, rank, id) => createCard(suit, rank, { faceUp: true, id });

test('shortLocator maps canonical locators to human piles', () => {
  assert.equal(shortLocator('stock'), 'S');
  assert.equal(shortLocator('waste'), 'W');
  assert.equal(shortLocator('foundation:0'), 'F1');
  assert.equal(shortLocator('foundation:3'), 'F4');
  assert.equal(shortLocator('tableau:0'), 'T1');
  assert.equal(shortLocator('tableau:6'), 'T7');
  assert.equal(shortLocator('bogus'), null);
});

test('moveCardLabel always shows rank+suit', () => {
  assert.equal(moveCardLabel(up('hearts', 1, 'a')), 'Ah');
  assert.equal(moveCardLabel(up('spades', 10, 'b')), '10s');
  assert.equal(moveCardLabel(up('diamonds', 11, 'c')), 'Jd');
  assert.equal(moveCardLabel(up('clubs', 13, 'd')), 'Kc');
});

test('draw / recycle / undo lines', () => {
  const s = createEmptyGameState();
  assert.equal(formatMove(s, { type: 'draw' }), 'D');
  assert.equal(formatMove(s, { type: 'recycle' }), 'R');
  assert.equal(formatUndo(), 'U');
});

test('single-card move resolves the label from pre-move state', () => {
  const s = createEmptyGameState();
  s.waste = [up('hearts', 1, 'w-ah')];
  const line = formatMove(s, { type: 'moveCards', from: 'waste', to: 'foundation:0', cardIds: ['w-ah'] });
  assert.equal(line, 'Ah W->F1');
});

test('run move lists cards bottom->top (head first)', () => {
  const s = createEmptyGameState();
  // cardIds are top->bottom per moveEngine; display is head-first.
  s.tableau[2] = [up('hearts', 7, 'c7h'), up('spades', 6, 'c6s'), up('hearts', 5, 'c5h')];
  const line = formatMove(s, {
    type: 'moveCards',
    from: 'tableau:2',
    to: 'tableau:5',
    cardIds: ['c5h', 'c6s', 'c7h'],
  });
  assert.equal(line, '7h,6s,5h T3->T6');
});

test('formatMove never throws; unknown moves yield null', () => {
  const s = createEmptyGameState();
  assert.equal(formatMove(s, { type: 'nope' }), null);
  assert.equal(formatMove(s, null), null);
  assert.equal(formatMove(s, { type: 'moveCards', from: 'waste', to: 'foundation:0', cardIds: [] }), null);
});

test('serializeMoveLog joins lines and nulls on empty', () => {
  assert.equal(serializeMoveLog(['D', 'Ah W->F1', 'U']), 'D\nAh W->F1\nU');
  assert.equal(serializeMoveLog([]), null);
  assert.equal(serializeMoveLog(null), null);
});
