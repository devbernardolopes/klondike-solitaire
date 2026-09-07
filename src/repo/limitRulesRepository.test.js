import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_MAX_MOVES,
  FALLBACK_MAX_TIME_MS,
  clearLimitRulesMemory,
  getLimitConfigSync,
  limitsFor,
} from './limitRulesRepository.js';

test('bundled fallback mirrors the migration_033 seeds', () => {
  clearLimitRulesMemory();
  assert.equal(FALLBACK_MAX_TIME_MS, 1800000);
  assert.equal(FALLBACK_MAX_MOVES, 500);
  const config = getLimitConfigSync();
  for (const kind of ['winning', 'daily', 'random', 'event']) {
    assert.deepEqual(config.rules[kind], { max_time_ms: 1800000, max_moves: 500 });
  }
  assert.equal(config.fallbackMaxTimeMs, 1800000);
  assert.equal(config.fallbackMaxMoves, 500);
});

test('limitsFor resolves per kind and falls back for unknown kinds', () => {
  clearLimitRulesMemory();
  assert.deepEqual(limitsFor('winning'), { maxTimeMs: 1800000, maxMoves: 500 });
  assert.deepEqual(limitsFor('daily'), { maxTimeMs: 1800000, maxMoves: 500 });
  assert.deepEqual(limitsFor('nope'), { maxTimeMs: 1800000, maxMoves: 500 });
  assert.deepEqual(limitsFor(null), { maxTimeMs: 1800000, maxMoves: 500 });
  assert.deepEqual(limitsFor(undefined), { maxTimeMs: 1800000, maxMoves: 500 });
  clearLimitRulesMemory();
});
