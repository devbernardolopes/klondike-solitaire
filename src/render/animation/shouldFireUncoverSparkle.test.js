import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldFireUncoverSparkle } from './shouldFireUncoverSparkle.js';

// Tiny test helper: returns a mock trigger that records every invocation.
function makeMockTrigger() {
  const calls = [];
  const fn = (cardId) => { calls.push(cardId); };
  fn.calls = calls;
  return fn;
}

test('shouldFireUncoverSparkle: moveCards with flippedId + actionType=move fires the trigger', () => {
  const trigger = makeMockTrigger();
  shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', from: 'tableau:2', to: 'tableau:5', cardIds: ['C9'], flippedId: 'C4' },
    actionType: 'move',
    trigger,
  });
  assert.deepEqual(trigger.calls, ['C4']);
});

test('shouldFireUncoverSparkle: moveCards WITHOUT flippedId does NOT fire (no card was exposed)', () => {
  const trigger = makeMockTrigger();
  // e.g. source was a foundation pile (no auto-flip happens) or the new top
  // was already face-up.
  shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', from: 'tableau:2', to: 'foundation:0', cardIds: ['C1'], flippedId: null },
    actionType: 'move',
    trigger,
  });
  assert.deepEqual(trigger.calls, []);
});

test('shouldFireUncoverSparkle: actionType=auto does NOT fire even when flippedId is set (regression: no sparkles during auto-complete)', () => {
  const trigger = makeMockTrigger();
  shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', from: 'tableau:0', to: 'tableau:3', cardIds: ['D7'], flippedId: 'H5' },
    actionType: 'auto',
    trigger,
  });
  assert.deepEqual(trigger.calls, []);
});

test('shouldFireUncoverSparkle: actionType=draw does NOT fire (regression: no sparkle when drawing from stock)', () => {
  const trigger = makeMockTrigger();
  shouldFireUncoverSparkle({
    moveRecord: { type: 'draw' },
    actionType: 'draw',
    trigger,
  });
  assert.deepEqual(trigger.calls, []);
});

test('shouldFireUncoverSparkle: actionType=recycle does NOT fire (regression: no sparkle when recycling stock)', () => {
  const trigger = makeMockTrigger();
  shouldFireUncoverSparkle({
    moveRecord: { type: 'recycle' },
    actionType: 'recycle',
    trigger,
  });
  assert.deepEqual(trigger.calls, []);
});

test('shouldFireUncoverSparkle: actionType=undo does NOT fire (regression: no sparkle on undo itself)', () => {
  // The user's spec: the sparkle must re-fire when the SAME card is exposed
  // again after being covered by an undo. That re-fire happens on the NEXT
  // moveCards action that exposes it, not on the undo itself. Undo COVERS a
  // card; it does not REVEAL one.
  const trigger = makeMockTrigger();
  shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', from: 'tableau:2', to: 'tableau:5', cardIds: ['C9'], flippedId: 'C4' },
    actionType: 'undo',
    trigger,
  });
  assert.deepEqual(trigger.calls, []);
});

test('shouldFireUncoverSparkle: actionType=deal with null moveRecord does NOT fire (regression: no sparkle on initial deal)', () => {
  const trigger = makeMockTrigger();
  shouldFireUncoverSparkle({
    moveRecord: null,
    actionType: 'deal',
    trigger,
  });
  assert.deepEqual(trigger.calls, []);
});

test('shouldFireUncoverSparkle: re-fires correctly when a card is re-exposed after undo (the user-reported scenario)', () => {
  // Sequence:
  //   1. moveCards exposes card C4 -> sparkle fires (moveRecord.flippedId='C4')
  //   2. undo (no sparkle, by design)
  //   3. moveCards exposes C4 again -> sparkle fires (the Map is fresh because
  //      we are dispatching off the move record, not off a sticky cache)
  const trigger = makeMockTrigger();

  shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', from: 'tableau:2', to: 'tableau:5', cardIds: ['C9'], flippedId: 'C4' },
    actionType: 'move',
    trigger,
  });
  shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', from: 'tableau:5', to: 'tableau:2', cardIds: ['C9'], flippedId: 'C4' },
    actionType: 'undo',
    trigger,
  });
  shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', from: 'tableau:5', to: 'tableau:6', cardIds: ['C9'], flippedId: 'C4' },
    actionType: 'move',
    trigger,
  });

  assert.deepEqual(trigger.calls, ['C4', 'C4'], 'sparkle fires for the two moveCards exposures, not the undo');
});

test('shouldFireUncoverSparkle: missing or non-function trigger is a no-op (defensive)', () => {
  // The helper must not throw if a caller forgets to pass a trigger.
  assert.doesNotThrow(() => shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', flippedId: 'C4' },
    actionType: 'move',
    trigger: undefined,
  }));
  assert.doesNotThrow(() => shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', flippedId: 'C4' },
    actionType: 'move',
    trigger: null,
  }));
  assert.doesNotThrow(() => shouldFireUncoverSparkle({
    moveRecord: { type: 'moveCards', flippedId: 'C4' },
    actionType: 'move',
    trigger: 'not a function',
  }));
});

test('shouldFireUncoverSparkle: full truth table covering every actionType × moveRecord.type combination', () => {
  // Exhaustive enumeration of the relevant action types × move record types.
  // The helper should only fire on the single (moveCards, move) combination
  // with flippedId set, plus its (moveCards, move) re-expose after undo.
  const moveRecordTypes = [
    { type: 'moveCards', flippedId: 'C4' },
    { type: 'moveCards', flippedId: null },
    { type: 'draw' },
    { type: 'recycle' },
    null,
  ];
  const actionTypes = ['deal', 'draw', 'recycle', 'move', 'auto', 'undo'];

  // Expected firing rule: only when actionType === 'move' AND moveRecord.type
  // === 'moveCards' AND flippedId is truthy.
  for (const record of moveRecordTypes) {
    for (const action of actionTypes) {
      const trigger = makeMockTrigger();
      shouldFireUncoverSparkle({
        moveRecord: record,
        actionType: action,
        trigger,
      });
      const shouldFire = action === 'move'
        && record !== null
        && record.type === 'moveCards'
        && !!record.flippedId;
      assert.equal(
        trigger.calls.length > 0,
        shouldFire,
        `record=${JSON.stringify(record)} action=${action} should ${shouldFire ? 'fire' : 'not fire'}`
      );
    }
  }
});
