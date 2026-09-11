import test from 'node:test';
import assert from 'node:assert/strict';
import { flushPendingStockDraw } from './pendingStockDraw.js';

test('flushPendingStockDraw: idle when nothing queued', () => {
  assert.equal(flushPendingStockDraw({ current: false }, { stockWasteBusy: false, blocked: false }), false);
});

test('flushPendingStockDraw: stays queued while busy', () => {
  const ref = { current: true };
  assert.equal(flushPendingStockDraw(ref, { stockWasteBusy: true, blocked: false }), false);
  assert.equal(ref.current, true);
});

test('flushPendingStockDraw: consume-once — no re-fire on later transitions', () => {
  const ref = { current: true };
  assert.equal(flushPendingStockDraw(ref, { stockWasteBusy: false, blocked: false }), true);
  assert.equal(ref.current, false);
  // Subsequent busy→idle cycles must NOT fire again without a new tap.
  assert.equal(flushPendingStockDraw(ref, { stockWasteBusy: true, blocked: false }), false);
  assert.equal(flushPendingStockDraw(ref, { stockWasteBusy: false, blocked: false }), false);
});

test('flushPendingStockDraw: blocked states drop (never latch) the tap', () => {
  for (const blocked of [true]) {
    const ref = { current: true };
    assert.equal(flushPendingStockDraw(ref, { stockWasteBusy: false, blocked }), false);
    assert.equal(ref.current, false, 'blocked flush must still consume the queue');
    assert.equal(flushPendingStockDraw(ref, { stockWasteBusy: false, blocked: false }), false);
  }
});
