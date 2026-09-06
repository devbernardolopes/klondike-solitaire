import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReward } from './coinRewards.js';

const config = {
  fallbackBase: 5,
  rules: {
    winning: {
      base_reward: 10,
      fast_ms_threshold: 300000,
      fast_bonus: 3,
      few_moves_threshold: 100,
      few_moves_bonus: 2,
    },
    daily: { base_reward: 15 },
  },
};

test('computeReward: base only when no bonus earned', () => {
  assert.deepEqual(
    computeReward({ gameKind: 'winning', durationMs: 600000, moves: 150 }, config),
    { base: 10, timeBonus: 0, movesBonus: 0, total: 10 },
  );
});

test('computeReward: bonuses stack additively', () => {
  assert.deepEqual(
    computeReward({ gameKind: 'winning', durationMs: 240000, moves: 80 }, config),
    { base: 10, timeBonus: 3, movesBonus: 2, total: 15 },
  );
});

test('computeReward: thresholds are exclusive (under X, not at X)', () => {
  const at = computeReward({ gameKind: 'winning', durationMs: 300000, moves: 100 }, config);
  assert.equal(at.total, 10);
  const under = computeReward({ gameKind: 'winning', durationMs: 299999, moves: 99 }, config);
  assert.equal(under.total, 15);
});

test('computeReward: unknown kind falls back to base with no bonuses', () => {
  assert.deepEqual(
    computeReward({ gameKind: 'nope', durationMs: 1000, moves: 5 }, config),
    { base: 5, timeBonus: 0, movesBonus: 0, total: 5 },
  );
  assert.deepEqual(
    computeReward({ gameKind: null, durationMs: 1000, moves: 5 }, config),
    { base: 5, timeBonus: 0, movesBonus: 0, total: 5 },
  );
});

test('computeReward: missing config or rule without thresholds', () => {
  assert.deepEqual(
    computeReward({ gameKind: 'winning', durationMs: 1000, moves: 5 }, null),
    { base: 5, timeBonus: 0, movesBonus: 0, total: 5 },
  );
  assert.deepEqual(
    computeReward({ gameKind: 'daily', durationMs: 1000, moves: 5 }, config),
    { base: 15, timeBonus: 0, movesBonus: 0, total: 15 },
  );
});

test('computeReward: negative inputs earn no bonus', () => {
  const r = computeReward({ gameKind: 'winning', durationMs: -5, moves: -2 }, config);
  assert.equal(r.timeBonus, 0);
  assert.equal(r.movesBonus, 0);
});
