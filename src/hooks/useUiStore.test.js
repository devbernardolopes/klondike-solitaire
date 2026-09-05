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

test('endTransition on an unknown tid is a safe no-op preserving live locks', () => {
  // The stale-entry release path may end a tid that already resolved (double
  // release). It must never corrupt or drop unrelated in-flight locks.
  const ui = useUiStore.getState();
  ui.clearAllTransitions();
  ui.beginTransition(101, ['live1'], ['tableau:0']);
  ui.endTransition(999);
  const s = useUiStore.getState();
  assert.ok(s.animatingCards.has('live1'));
  assert.ok(s.animatingLocs.has('tableau:0'));
  ui.clearAllTransitions();
  assert.equal(useUiStore.getState().animatingCards.size, 0);
});

test('ending one transition keeps concurrent transitions locked', () => {
  const ui = useUiStore.getState();
  ui.clearAllTransitions();
  ui.beginTransition(201, ['a1'], ['foundation:0']);
  ui.beginTransition(202, ['b1'], ['tableau:1']);
  ui.endTransition(201);
  const s = useUiStore.getState();
  assert.ok(!s.animatingCards.has('a1'));
  assert.ok(s.animatingCards.has('b1'));
  assert.ok(s.animatingLocs.has('tableau:1'));
  ui.clearAllTransitions();
  assert.equal(lockSizes(), 0);
});
