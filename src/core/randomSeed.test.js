// core/randomSeed.test.js
// Unit tests for the Random-Shuffle seed generator. Framework-agnostic (no DOM),
// so runnable via `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUnusedSeed, isKnownSeed, knownSeedCount } from './randomSeed.js';

const U32 = 4294967296;

test('randomUnusedSeed returns an unsigned 32-bit integer', () => {
  for (let i = 0; i < 50; i++) {
    const s = randomUnusedSeed();
    assert.equal(Number.isInteger(s), true);
    assert.ok(s >= 0, 'seed must be >= 0');
    assert.ok(s < U32, 'seed must be < 2**32');
  }
});

test('randomUnusedSeed never returns a reserved data-file seed', () => {
  for (let i = 0; i < 200; i++) {
    assert.equal(isKnownSeed(randomUnusedSeed()), false);
  }
});

test('randomUnusedSeed excludes a supplied used set', () => {
  const used = new Set([123456, 789012, 345678]);
  for (let i = 0; i < 200; i++) {
    const s = randomUnusedSeed(used);
    assert.equal(used.has(s), false);
  }
});

test('randomUnusedSeed never collides with a large supplied used set', () => {
  const used = new Set();
  for (let s = 0; s < 5000; s++) if (!isKnownSeed(s)) used.add(s);
  for (let i = 0; i < 200; i++) {
    const s = randomUnusedSeed(used);
    assert.equal(used.has(s), false);
  }
});

test('knownSeedCount is positive (data files contribute reserved seeds)', () => {
  assert.ok(knownSeedCount() > 0);
});
