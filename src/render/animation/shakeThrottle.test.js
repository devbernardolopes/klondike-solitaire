import assert from 'node:assert/strict';
import test from 'node:test';
import { MOTION } from './motion.js';
import { shouldPlayShakeVisual, markShakeVisual, clearShakeThrottle } from './shakeThrottle.js';

test('shake throttle: first visual for a card always plays', () => {
  clearShakeThrottle('C1');
  assert.equal(shouldPlayShakeVisual('C1', 1000), true);
});

test('shake throttle: repeat within cooldown is suppressed (visual only)', () => {
  clearShakeThrottle('C2');
  markShakeVisual('C2', 1000);
  assert.equal(shouldPlayShakeVisual('C2', 1000 + 100), false);
});

test('shake throttle: repeat after cooldown plays again', () => {
  clearShakeThrottle('C3');
  markShakeVisual('C3', 1000);
  const cooldown = MOTION.shake?.cooldownMs ?? 400;
  assert.equal(shouldPlayShakeVisual('C3', 1000 + cooldown), true);
  assert.equal(shouldPlayShakeVisual('C3', 1000 + cooldown + 1), true);
});

test('shake throttle: cooldown is per-card (one spammed card never blocks another)', () => {
  clearShakeThrottle();
  markShakeVisual('C4', 5000);
  assert.equal(shouldPlayShakeVisual('C4', 5100), false);
  assert.equal(shouldPlayShakeVisual('C5', 5100), true);
});

test('shake throttle: cooldownMs 0 disables throttling', () => {
  clearShakeThrottle('C6');
  const prev = MOTION.shake.cooldownMs;
  MOTION.shake.cooldownMs = 0;
  try {
    markShakeVisual('C6', 2000);
    assert.equal(shouldPlayShakeVisual('C6', 2001), true);
  } finally {
    MOTION.shake.cooldownMs = prev;
  }
  clearShakeThrottle('C6');
});
