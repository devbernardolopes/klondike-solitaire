// core/snapshot.test.js
// Plain-text board snapshot serialization.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { buildSnapshotText, snapshotModeToken, cardLabel } from './snapshot.js';

// Helper: build a face-up card.
const up = (suit, rank) => createCard(suit, rank, { faceUp: true });
const down = (suit, rank) => createCard(suit, rank, { faceUp: false });

test('cardLabel uses rank+suit abbreviations', () => {
  assert.equal(cardLabel(up('hearts', 1)), 'Ah');
  assert.equal(cardLabel(up('spades', 13)), 'Ks');
  assert.equal(cardLabel(up('diamonds', 11)), 'Jd');
  assert.equal(cardLabel(up('clubs', 12)), 'Qc');
  assert.equal(cardLabel(up('hearts', 10)), '10h');
  assert.equal(cardLabel(up('spades', 2)), '2s');
  assert.equal(cardLabel(down('clubs', 13)), '00');
});

test('matches the documented example layout (winning deal)', () => {
  const s = createEmptyGameState();
  s.seed = 31550;
  s.drawCount = 3;
  s.foundations[0] = [up('hearts', 1), up('hearts', 2)];
  s.foundations[1] = [up('spades', 1), up('spades', 2), up('spades', 3)];
  s.waste = [up('diamonds', 1), up('diamonds', 7)];
  s.tableau[0] = [down('clubs', 13), up('clubs', 13)];
  s.tableau[1] = [up('hearts', 11)];
  s.tableau[2] = [up('diamonds', 2), up('clubs', 3), up('hearts', 4), up('spades', 5), up('diamonds', 6)];
  s.tableau[3] = [up('hearts', 4), up('spades', 5), up('hearts', 6), up('clubs', 7), up('diamonds', 8), up('spades', 9), up('hearts', 10), up('clubs', 11)];
  s.tableau[4] = [up('diamonds', 3), up('spades', 4)];
  s.tableau[5] = [up('spades', 10), up('diamonds', 11), up('clubs', 12)];
  s.tableau[6] = [up('clubs', 4)];

  const expected = [
    '# Klondike, 3',
    '# Game Mode: 31550',
    '',
    '# Foundations (left to right, 1–4)',
    'F1: Ah, 2h',
    'F2: As, 2s, 3s',
    'F3: empty',
    'F4: empty',
    '',
    '# Waste (left to right is bottom-most to top-most)',
    'Waste: Ad, 7d',
    '',
    '# Stock (all face-down; each card shown as 00)',
    'Stock: empty',
    '',
    '# Tableau (piles 1–7, left to right; listed top to bottom, face-down cards as 00)',
    '1: Kc, 00',
    '2: Jh',
    '3: 6d, 5s, 4h, 3c, 2d',
    '4: Jc, 10h, 9s, 8d, 7c, 6h, 5s, 4h',
    '5: 4s, 3d',
    '6: Qc, Jd, 10s',
    '7: 4c',
    '',
  ].join('\n');

  assert.equal(buildSnapshotText(s), expected);
});

test('snapshotModeToken returns seed for winning, random otherwise', () => {
  const winning = createEmptyGameState();
  winning.seed = 12345;
  assert.equal(snapshotModeToken(winning), '12345');

  const random = createEmptyGameState();
  assert.equal(snapshotModeToken(random), 'random');
});

test('random game mode line and empty piles render as empty', () => {
  const s = createEmptyGameState();
  s.drawCount = 1;
  s.foundations[2] = [up('hearts', 5)];
  s.waste = [];
  s.tableau[0] = [down('clubs', 13)]; // only face-down -> 00

  const text = buildSnapshotText(s);
  assert.match(text, /^# Klondike, 1$/m);
  assert.match(text, /^# Game Mode: Random$/m);
  assert.match(text, /^F3: 5h$/m);
  assert.match(text, /^Waste: empty$/m);
  assert.match(text, /^1: 00$/m);
});

test('stock pile serializes as a list of 00 placeholders', () => {
  const s = createEmptyGameState();
  s.stock = [down('hearts', 1), down('spades', 7), down('diamonds', 13)];
  const text = buildSnapshotText(s);
  assert.match(text, /^Stock: 00, 00, 00$/m);
});

test('face-down cards in tableau render as 00 within the column', () => {
  const s = createEmptyGameState();
  s.tableau[2] = [down('clubs', 5), up('hearts', 6), down('spades', 9), up('diamonds', 10)];
  const text = buildSnapshotText(s);
  // top→bottom after reversal: 10d, 00, 6h, 00
  assert.match(text, /^3: 10d, 00, 6h, 00$/m);
});
