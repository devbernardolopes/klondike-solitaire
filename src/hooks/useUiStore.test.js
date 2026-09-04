import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useUiStore, lockSnapshot, warnDealBlocked } from './useUiStore.js';

function lockSizes() {
  const s = useUiStore.getState();
  return s.animatingCards.size + s.slidingCards.size;
}

test('clearAllTransitions releases slide locks, not just move locks', () => {
  const ui = useUiStore.getState();
  ui.beginTransition(1, ['c1'], ['waste']);
  ui.promoteDrawToSlide('c1', 1);
  assert.equal(useUiStore.getState().slidingCards.size, 1);
  assert.ok(lockSizes() > 0);
  ui.clearAllTransitions();
  const s = useUiStore.getState();
  assert.equal(s.slidingCards.size, 0);
  assert.equal(s.animatingCards.size, 0);
  assert.equal(s.animatingLocs.size, 0);
  assert.deepEqual(s.activeTransitions, {});
});

test('simulated win-kill path leaves deal guards passable', () => {
  const ui = useUiStore.getState();
  ui.beginTransition(7, ['c9'], ['waste']);
  ui.promoteDrawToSlide('c9', 7);
  ui.clearAllTransitions();
  assert.equal(lockSizes(), 0);
});

test('lockSnapshot reports lock state and warnDealBlocked never throws', () => {
  const snap = lockSnapshot();
  assert.ok(Array.isArray(snap.slidingCards));
  assert.ok(Array.isArray(snap.animatingLocs));
  assert.ok(Array.isArray(snap.activeTransitions));
  assert.equal(warnDealBlocked('test'), undefined);
});
