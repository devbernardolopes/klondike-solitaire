// core/solverClient.test.js
// Verifies the offline / no-Worker fallback: when a Web Worker cannot be
// constructed (no network to fetch the worker chunk, or a non-browser env such
// as Node), solveAsync must still settle (never throw or hang) by running the
// pure solver on the main thread.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from './Card.js';
import { createEmptyGameState } from './GameState.js';
import { solveAsync, STALE } from './solverClient.js';

// Build a state where an Ace sits in the waste and can move to an empty
// foundation — a directly-reachable move, so findReachableMove -> true.
function aceReachableState() {
  const s = createEmptyGameState();
  s.waste = [createCard('spades', 1, { faceUp: true })];
  return s;
}

test('solveAsync falls back to main thread and settles when Worker is unavailable', async () => {
  // Force the "no usable worker" path the same way an offline browser would.
  const original = globalThis.Worker;
  globalThis.Worker = undefined;
  try {
    const { promise } = solveAsync(aceReachableState(), { goal: 'move' });
    const result = await promise;
    // A directly reachable foundation move must be found on the main thread.
    assert.equal(result, true);
  } finally {
    globalThis.Worker = original;
  }
});

test('solveAsync resolves STALE-safe and never rejects', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = undefined;
  try {
    const { promise, cancel } = solveAsync(aceReachableState(), { goal: 'move' });
    cancel();
    const result = await promise;
    // With no worker the cancel is a no-op but the promise still settles to a
    // real (non-throwing) value rather than hanging.
    assert.ok(result === true || result === STALE || result === null);
  } finally {
    globalThis.Worker = original;
  }
});
