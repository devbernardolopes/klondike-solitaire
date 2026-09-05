import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flipBridge, enqueueFlip, dequeueFlip } from './flipBridge.js';

function drain() {
  flipBridge.queue.length = 0;
}

test('dequeueFlip returns only entries of the requested type', () => {
  drain();
  const moveTid = enqueueFlip('move', new Map());
  const drawTid = enqueueFlip('draw', new Map());
  assert.equal(dequeueFlip('draw').tid, drawTid);
  assert.equal(dequeueFlip('move').tid, moveTid);
  assert.equal(dequeueFlip('draw'), null);
  drain();
});

test('stranded entries of one type are drainable without touching others', () => {
  // Mirrors the stale-release path: a superseded 'draw' entry must be
  // releasable even when newer entries of other types are queued behind it.
  drain();
  enqueueFlip('draw', new Map());
  enqueueFlip('move', new Map());
  let stale;
  let released = 0;
  while ((stale = dequeueFlip('draw'))) released += 1;
  assert.equal(released, 1);
  assert.equal(flipBridge.queue.length, 1);
  assert.equal(flipBridge.queue[0].type, 'move');
  drain();
});

test('dequeueFlip on an empty queue returns null', () => {
  drain();
  assert.equal(dequeueFlip('draw'), null);
  assert.equal(dequeueFlip('move'), null);
});
