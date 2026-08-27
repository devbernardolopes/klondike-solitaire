// core/hints.test.js
// Unit tests for the Hint affordance (core/hints.js).
// Run with `npm test` (node --test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { findHints } from './hints.js';

// Build the exact board reported by the user (F1=Ah, F2=6c, F3=3d, F4=empty,
// waste bottom->top Qd Qh 7s Js 10h 9s Kc 2s, tableau tops per report). The key
// missed move is 4s (pile 7 top) onto 5d (pile 6 top).
function buildReportedBoard() {
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false }); // face-down filler
  const st = createEmptyGameState();
  st.waste = [f('diamonds', 12), f('hearts', 12), f('spades', 7), f('spades', 11), f('hearts', 10), f('spades', 9), f('clubs', 13), f('spades', 2)];
  st.foundations = [
    [f('hearts', 1)],
    [f('clubs', 1), f('clubs', 2), f('clubs', 3), f('clubs', 4), f('clubs', 5), f('clubs', 6)],
    [f('diamonds', 1), f('diamonds', 2), f('diamonds', 3)],
    [],
  ];
  st.tableau = [
    [f('diamonds', 13), f('spades', 12)],
    [f('clubs', 10)],
    [d('spades', 2), d('spades', 3), f('clubs', 12)],
    [d('spades', 2), d('spades', 3), f('spades', 8)],
    [d('spades', 2), f('clubs', 11), f('diamonds', 10), f('clubs', 9), f('hearts', 8), f('clubs', 7), f('diamonds', 6), f('spades', 5), f('hearts', 4), f('spades', 3)],
    [d('spades', 2), d('spades', 3), d('spades', 4), d('spades', 5), f('diamonds', 5)],
    [d('spades', 2), d('spades', 3), d('spades', 4), f('spades', 10), f('hearts', 9), f('clubs', 8), f('diamonds', 7), f('spades', 6), f('hearts', 5), f('spades', 4)],
  ];
  st.stock = [];
  return st;
}

test('findHints surfaces the reported 4s -> 5d move', () => {
  const st = buildReportedBoard();
  const hints = findHints(st);
  assert.ok(hints.length > 0, 'expected at least one hint');
  // The missed move: pile 7 (tableau:6) top 4s -> pile 6 (tableau:5) 5d.
  const hit = hints.find((h) => h.from === 'tableau:6' && h.to === 'tableau:5');
  assert.ok(hit, 'expected a hint from tableau:6 to tableau:5');
  // Source highlight card is pile 7's top (4s).
  assert.equal(hit.cardId, st.tableau[6][st.tableau[6].length - 1].id);
});

test('findHints returns no hints for an empty board', () => {
  const st = createEmptyGameState();
  assert.deepEqual(findHints(st), []);
});

test('findHints excludes a King shuffled to an empty tableau that reveals nothing', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false });
  // A lone face-up King on tableau:0, an empty tableau:1.
  st.tableau = [
    [f('spades', 13)],
    [],
    [d('clubs', 2)], // filler so column 1 is the only empty one
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
  ];
  const hints = findHints(st);
  const hit = hints.find(
    (h) => h.from === 'tableau:0' && h.to === 'tableau:1'
  );
  assert.equal(hit, undefined, 'King -> empty tableau relocation must be excluded');
});

test('findHints keeps a King move to an empty tableau that flips a hidden card', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false });
  // King on top of tableau:0 with a face-down card beneath it; empty tableau:1.
  st.tableau = [
    [d('clubs', 5), f('spades', 13)],
    [],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
  ];
  const hints = findHints(st);
  const hit = hints.find(
    (h) => h.from === 'tableau:0' && h.to === 'tableau:1'
  );
  assert.ok(hit, 'King move that reveals a face-down card must remain a hint');
});

test('findHints never relocates an Ace already on a foundation to another foundation', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  st.foundations = [
    [f('hearts', 1)], // an Ace already on a foundation
    [],
    [],
    [],
  ];
  // No tableau/waste moves; only the foundation Ace could "move" — it must not.
  const hints = findHints(st);
  assert.equal(hints.length, 0);
});

test('findHints restricts a waste Ace to a single left-most empty foundation (no tableau 2)', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false });
  // Waste top is the Ah (Ace). Two empty foundations exist (foundation:0,1). A
  // tableau column exposes a 2s (opposite color of hearts), a legal but pointless
  // Ace->tableau landing. The hint must show ONLY the left-most empty foundation
  // (foundation:0) and must NOT suggest the tableau 2.
  st.waste = [f('hearts', 1)];
  st.foundations = [[], [], [], []];
  st.tableau = [
    [f('spades', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
  ];
  const hints = findHints(st);
  assert.equal(hints.length, 1, 'exactly one Ace hint expected');
  const hit = hints[0];
  assert.equal(hit.from, 'waste');
  assert.equal(hit.to, 'foundation:0', 'Ace must target the left-most empty foundation');
  assert.equal(hit.cardId, st.waste[st.waste.length - 1].id);
});

test('findHints restricts a tableau-top Ace to a single left-most empty foundation (no tableau 2)', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false });
  // tableau:0 top is the Ah (Ace). Two empty foundations exist. A tableau 2s is
  // present. The hint must show ONLY foundation:0 and no tableau target.
  st.foundations = [[], [], [], []];
  st.tableau = [
    [f('hearts', 1)],
    [f('spades', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
  ];
  const hints = findHints(st);
  assert.equal(hints.length, 1, 'exactly one Ace hint expected');
  const hit = hints[0];
  assert.equal(hit.from, 'tableau:0');
  assert.equal(hit.to, 'foundation:0', 'Ace must target the left-most empty foundation');
  assert.equal(hit.cardId, st.tableau[0][st.tableau[0].length - 1].id);
});

test('findHints suppresses a buried-run reshuffle onto a non-empty column', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false });
  // tableau:0 bottom->top = X(face-up), 5s, 4d, 3c. The run 5s-4d-3c can legally
  // move onto the 6c in tableau:1, but it is a mid-column run that neither reveals
  // a hidden card nor frees the column nor is the column's top card — a pure
  // lateral reshuffle that must be omitted from the hints.
  st.tableau = [
    [f('hearts', 9), f('spades', 5), f('diamonds', 4), f('clubs', 3)],
    [f('clubs', 6)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
  ];
  const hints = findHints(st);
  const hit = hints.find(
    (h) => h.from === 'tableau:0' && h.to === 'tableau:1'
  );
  assert.equal(
    hit,
    undefined,
    'buried-run reshuffle onto a non-empty column must be excluded'
  );
});

test('findHints keeps a top-card reshuffle onto a non-empty column', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false });
  // tableau:0 top 3c can move onto 4h in tableau:1. Although it reveals no hidden
  // card and does not free the column, the moving card IS the column's top, so it
  // is a normal re-stack and must remain a hint (locks the isColumnTop keep-path).
  st.tableau = [
    [f('hearts', 9), f('spades', 5), f('clubs', 3)],
    [f('hearts', 4)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
  ];
  const hints = findHints(st);
  const hit = hints.find(
    (h) => h.from === 'tableau:0' && h.to === 'tableau:1'
  );
  assert.ok(hit, 'top-card reshuffle onto a non-empty column must remain a hint');
});

test('findHints records the buried moving card, not the column top (run)', () => {
  const st = createEmptyGameState();
  const f = (s, r) => createCard(s, r, { faceUp: true });
  const d = (s, r) => createCard(s, r, { faceUp: false });
  // tableau:0 bottom->top = 9s, 8d, 7c  (column top is 7c at index 2).
  // tableau:1 top is 10h, so only the buried 9s (top of the run 9s,8d,7c) can
  // legally move there; the column top (7c) has no valid move. The hint must
  // record 9s (the moving card), not 7c (the column top).
  st.tableau = [
    [f('spades', 9), f('diamonds', 8), f('clubs', 7)],
    [f('hearts', 10)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
    [d('clubs', 2)],
  ];
  const hints = findHints(st);
  const hit = hints.find(
    (h) => h.from === 'tableau:0' && h.to === 'tableau:1'
  );
  assert.ok(hit, 'expected a hint from tableau:0 to tableau:1');
  const movingId = st.tableau[0][0].id; // 9s, the buried moving card
  const topId = st.tableau[0][st.tableau[0].length - 1].id; // 7c, column top
  assert.equal(hit.cardId, movingId, 'hint cardId must be the actual moving card');
  assert.notEqual(hit.cardId, topId, 'hint cardId must NOT be the column top');
});
