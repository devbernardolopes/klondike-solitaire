// tests/useStatsStore.test.js
// Guards that the time-limit game-over never fires once the clock has already
// stopped (e.g. the game was won). Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useStatsStore, MAX_TIME_MS, MAX_MOVES } from '../src/hooks/useStatsStore.js';
import { useStatisticsStore } from '../src/hooks/useStatisticsStore.js';

// Counts calls to useStatisticsStore.recordLoss so the Game Over flow can assert a
// loss is recorded without touching Dexie/Supabase (unavailable in node --test).
// Reset to a no-op stub on every test.
let recordLossCalls;

function reset() {
  useStatsStore.setState({
    moves: 0,
    score: 0,
    startTime: null,
    endTime: null,
    isOver: false,
    overReason: null,
  });
  recordLossCalls = 0;
  useStatisticsStore.setState({
    recordLoss: async () => {
      recordLossCalls++;
    },
  });
}

test('checkTimeLimit does not trigger after a win (endTime pinned)', () => {
  reset();
  // Simulate a won game: clock started, then stopTimer() pinned endTime.
  // NOTE: use a startTime far enough in the past that, absent the win, the
  // 60:00 limit would already have been crossed.
  const startTime = Date.now() - MAX_TIME_MS - 1000;
  useStatsStore.setState({ startTime, endTime: Date.now() });

  useStatsStore.getState().checkTimeLimit();

  const s = useStatsStore.getState();
  assert.equal(s.isOver, false, 'isOver must stay false after a win');
  assert.equal(s.overReason, null, 'overReason must not be set after a win');
});

test('freeze does not overwrite a win-state when endTime is already set', () => {
  reset();
  const startTime = Date.now() - MAX_TIME_MS - 1000;
  useStatsStore.setState({ startTime, endTime: Date.now() });

  useStatsStore.getState().freeze('time');

  const s = useStatsStore.getState();
  assert.equal(s.isOver, false, 'freeze must not flip isOver on a finished (won) game');
  assert.equal(s.overReason, null);
  // A won game (endTime pinned, isOver still false) must NOT record a loss: the
  // win recorded its own streak via recordWin, and freeze bails on a finished game.
  assert.equal(recordLossCalls, 0, 'a won game must not record a loss on freeze');
});

test('checkTimeLimit still triggers the time limit on a live game', () => {
  reset();
  const startTime = Date.now() - MAX_TIME_MS - 1000;
  useStatsStore.setState({ startTime, endTime: null });

  useStatsStore.getState().checkTimeLimit();

  const s = useStatsStore.getState();
  assert.equal(s.isOver, true, 'isOver should trigger for an expired live game');
  assert.equal(s.overReason, 'time');
});

test('freeze records a loss (breaking the streak) when the time limit is hit', () => {
  reset();
  const startTime = Date.now() - MAX_TIME_MS - 1000;
  useStatsStore.setState({ startTime, endTime: null, isOver: false });

  // A live, expired game crosses the time limit -> checkTimeLimit -> freeze('time')
  // -> Game Over, which must be recorded as a loss.
  useStatsStore.getState().checkTimeLimit();

  assert.equal(recordLossCalls, 1, 'the limit that ends the game must record exactly one loss');
  const s = useStatsStore.getState();
  assert.equal(s.isOver, true);
  assert.equal(s.overReason, 'time');
  assert.equal(s.endTime, startTime + MAX_TIME_MS, 'endTime is pinned to exactly 60:00');

  // The guard in freeze() makes a second freeze a no-op: no double loss.
  useStatsStore.getState().freeze('moves');
  assert.equal(recordLossCalls, 1, 'freeze must not re-record a loss on an already-over game');
});

test('freeze records a loss when the 999-move limit is hit', () => {
  reset();
  useStatsStore.setState({ startTime: Date.now(), endTime: null, isOver: false, moves: MAX_MOVES - 1 });

  useStatsStore.getState().addMoves(1);

  assert.equal(recordLossCalls, 1, 'hitting the move limit must record a loss');
  const s = useStatsStore.getState();
  assert.equal(s.isOver, true);
  assert.equal(s.overReason, 'moves');
});
