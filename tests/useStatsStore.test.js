// tests/useStatsStore.test.js
// Guards that the time-limit game-over never fires once the clock has already
// stopped (e.g. the game was won). Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useStatsStore, MAX_TIME_MS } from '../src/hooks/useStatsStore.js';

function reset() {
  useStatsStore.setState({
    moves: 0,
    score: 0,
    startTime: null,
    endTime: null,
    isOver: false,
    overReason: null,
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
