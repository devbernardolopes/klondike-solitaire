// tests/deck.test.js
//
// Sanity checks for the deck renderer registry. Importing the renderer modules
// runs their registerDeck(...) side effects; actual canvas drawing is lazy, so
// these assertions are safe to run under `node --test` without a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listDecks, getDeck } from '../src/render/deck/deckRegistry.js';
import '../src/render/deck/ProceduralDeckRenderer.js';

test('Dark 2 deck is registered', () => {
  assert.ok(listDecks().includes('procedural-dark-2'));
});

test('Dark 2 deck resolves via the registry', () => {
  // Note: createProceduralDeckRenderer hardcodes name:'procedural' (registry key
  // differs from the object's name property); assert on key, not object name.
  const deck = getDeck('procedural-dark-2');
  assert.ok(deck && typeof deck.renderCard === 'function');
  // renderCard lazily builds a canvas; guard in case document is unavailable.
  if (typeof document === 'undefined') return;
  const url = deck.renderCard('hearts', 5);
  assert.match(url, /^data:image\/png/);
});
