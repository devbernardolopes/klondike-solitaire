import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeDailyResults } from './dailyResults.js';

const row = (date, over = {}) => ({
  date,
  seed: 111,
  bestScore: 10,
  bestTimeMs: 60000,
  bestMoves: 100,
  wins: 1,
  ...over,
});

test('mergeDailyResults keeps a local-only win the server has not confirmed yet', () => {
  const merged = mergeDailyResults([], [row('2026-09-09')]);
  assert.deepEqual(merged.map((r) => r.date), ['2026-09-09']);
});

test('mergeDailyResults keeps server-only rows (cross-device truth)', () => {
  const merged = mergeDailyResults([row('2026-09-08')], []);
  assert.deepEqual(merged.map((r) => r.date), ['2026-09-08']);
});

test('mergeDailyResults folds bests when both sides have the date', () => {
  const server = row('2026-09-09', { seed: 111, bestScore: 5, bestTimeMs: 90000, bestMoves: 120, wins: 2 });
  const local = row('2026-09-09', { seed: 222, bestScore: 10, bestTimeMs: 60000, bestMoves: 150, wins: 1 });
  const [merged] = mergeDailyResults([server], [local]);
  assert.equal(merged.seed, 222);
  assert.equal(merged.bestScore, 10);
  assert.equal(merged.bestTimeMs, 60000);
  assert.equal(merged.bestMoves, 120);
  assert.equal(merged.wins, 2);
});

test('mergeDailyResults tolerates nulls and empty inputs', () => {
  assert.deepEqual(mergeDailyResults(null, null), []);
  assert.deepEqual(mergeDailyResults(undefined, [row('2026-09-09')]).map((r) => r.date), ['2026-09-09']);
});

test('mergeDailyResults unions disjoint date sets', () => {
  const merged = mergeDailyResults([row('2026-09-08')], [row('2026-09-09')]);
  assert.deepEqual(merged.map((r) => r.date).sort(), ['2026-09-08', '2026-09-09']);
});
