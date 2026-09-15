import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCoinsFull, formatCoinsShort, COINS_COMPACT_THRESHOLD } from './formatCoins.js';

test('threshold is 100,000', () => {
  assert.equal(COINS_COMPACT_THRESHOLD, 100000);
});

test('formatCoinsFull renders grouped exact digits', () => {
  assert.equal(formatCoinsFull(0), '0');
  assert.equal(formatCoinsFull(999), '999');
  assert.equal(formatCoinsFull(2500), '2,500');
  assert.equal(formatCoinsFull(99999), '99,999');
  assert.equal(formatCoinsFull(1234567), '1,234,567');
});

test('formatCoinsFull coerces unsafe values', () => {
  assert.equal(formatCoinsFull(NaN), '0');
  assert.equal(formatCoinsFull(undefined), '0');
  assert.equal(formatCoinsFull(-5), '0');
});

test('formatCoinsShort is exact below the threshold', () => {
  assert.equal(formatCoinsShort(0), '0');
  assert.equal(formatCoinsShort(99999), '99,999');
});

test('formatCoinsShort compacts at and above the threshold (en)', () => {
  assert.equal(formatCoinsShort(100000), '100K');
  assert.equal(formatCoinsShort(1234567), '1.2M');
  assert.equal(formatCoinsShort(1000000), '1M');
});
