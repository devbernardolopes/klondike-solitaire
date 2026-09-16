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

test('mergeDailyResults preserves a locally-witnessed last win', () => {
  const server = row('2026-09-09');
  const local = row('2026-09-09', { lastTimeMs: 70000, lastMoves: 110, lastWonAt: '2026-09-09T10:00:00.000Z' });
  const [merged] = mergeDailyResults([server], [local]);
  assert.equal(merged.lastTimeMs, 70000);
  assert.equal(merged.lastMoves, 110);
  assert.equal(merged.lastWonAt, '2026-09-09T10:00:00.000Z');
});

test('mergeDailyResults never backfills last-win fields without a timestamp', () => {
  const server = row('2026-09-09', { lastTimeMs: 5000, lastMoves: 5 });
  const local = row('2026-09-09');
  const [merged] = mergeDailyResults([server], [local]);
  assert.ok(!('lastTimeMs' in merged));
  assert.ok(!('lastMoves' in merged));
  assert.ok(!('lastWonAt' in merged));
});

test('mergeDailyResults takes the server last win when its stamp is newer', () => {
  const server = row('2026-09-09', { lastTimeMs: 50000, lastMoves: 90, lastWonAt: '2026-09-09T12:00:00.000Z' });
  const local = row('2026-09-09', { lastTimeMs: 70000, lastMoves: 110, lastWonAt: '2026-09-09T10:00:00.000Z' });
  const [merged] = mergeDailyResults([server], [local]);
  assert.equal(merged.lastTimeMs, 50000);
  assert.equal(merged.lastMoves, 90);
  assert.equal(merged.lastWonAt, '2026-09-09T12:00:00.000Z');
});

test('mergeDailyResults keeps the local last win when its stamp is newer (offline race)', () => {
  const server = row('2026-09-09', { lastTimeMs: 50000, lastMoves: 90, lastWonAt: '2026-09-09T10:00:00.000Z' });
  const local = row('2026-09-09', { lastTimeMs: 70000, lastMoves: 110, lastWonAt: '2026-09-09T12:00:00.000Z' });
  const [merged] = mergeDailyResults([server], [local]);
  assert.equal(merged.lastTimeMs, 70000);
  assert.equal(merged.lastMoves, 110);
  assert.equal(merged.lastWonAt, '2026-09-09T12:00:00.000Z');
});

test('mergeDailyResults keeps time+moves atomically from the winning side', () => {
  // A newer stamp must never mix its time with the other side's moves.
  const server = row('2026-09-09', { lastTimeMs: 50000, lastMoves: 90, lastWonAt: '2026-09-09T12:00:00.000Z' });
  const local = row('2026-09-09', { lastTimeMs: 70000, lastMoves: 110, lastWonAt: '2026-09-09T10:00:00.000Z' });
  const [merged] = mergeDailyResults([server], [local]);
  assert.deepEqual([merged.lastTimeMs, merged.lastMoves], [50000, 90]);
});

test('mergeDailyResults keeps a legacy local last win without a stamp', () => {
  const server = row('2026-09-09');
  const local = row('2026-09-09', { lastTimeMs: 70000, lastMoves: 110 });
  const [merged] = mergeDailyResults([server], [local]);
  assert.equal(merged.lastTimeMs, 70000);
  assert.equal(merged.lastMoves, 110);
  assert.ok(!('lastWonAt' in merged));
});

test('mergeDailyResults normalizes null server last fields to absent keys', () => {
  const server = row('2026-09-09', { lastTimeMs: null, lastMoves: null, lastWonAt: null });
  const [merged] = mergeDailyResults([server], []);
  assert.ok(!('lastTimeMs' in merged));
  assert.ok(!('lastMoves' in merged));
  assert.ok(!('lastWonAt' in merged));
});
