import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleCoins } from './coinFlyDisplay.js';

test('visibleCoins: inactive flight shows the store balance', () => {
  assert.equal(visibleCoins({ coins: 42, flight: { active: false } }), 42);
  assert.equal(visibleCoins({ coins: 42, flight: null }), 42);
  assert.equal(visibleCoins({ coins: 42 }), 42);
});

test('visibleCoins: active flight shows base + landed (masking the pre-credited bump)', () => {
  // Store already holds base+total (100+10); display counts up from base.
  assert.equal(visibleCoins({ coins: 110, flight: { active: true, base: 100, landed: 0, total: 10 } }), 100);
  assert.equal(visibleCoins({ coins: 110, flight: { active: true, base: 100, landed: 4, total: 10 } }), 104);
  assert.equal(visibleCoins({ coins: 110, flight: { active: true, base: 100, landed: 10, total: 10 } }), 110);
});

test('visibleCoins: landed clamps to [0, total]', () => {
  assert.equal(visibleCoins({ coins: 110, flight: { active: true, base: 100, landed: 99, total: 10 } }), 110);
  assert.equal(visibleCoins({ coins: 110, flight: { active: true, base: 100, landed: -3, total: 10 } }), 100);
});
