import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAchievementTelemetry,
  markHintUsed,
  markUndoUsed,
  recordAchievementMove,
  recordRecycle,
} from './achievementTelemetry.js';

const move = (telemetry, from, to, card) =>
  recordAchievementMove(telemetry, { from, to, card });

test('telemetry keeps Undo and Hint usage monotonic', () => {
  const initial = createAchievementTelemetry('game-1');
  const next = markUndoUsed(markHintUsed(initial));

  assert.equal(next.gameId, 'game-1');
  assert.equal(next.undoUsed, true);
  assert.equal(next.hintUsed, true);
  assert.equal(initial.undoUsed, false);
  assert.equal(initial.hintUsed, false);
});

test('telemetry records ordering and Foundation retreat moves', () => {
  let telemetry = createAchievementTelemetry('game-2');
  telemetry = move(telemetry, 'tableau:0', 'tableau:1', { rank: 13, id: 'k' });
  assert.equal(telemetry.foundationFirstEligible, false);
  telemetry = move(telemetry, 'tableau:1', 'foundation:0', { rank: 1, id: 'ace-s' });
  telemetry = move(telemetry, 'foundation:0', 'tableau:1', { rank: 1, id: 'ace-s' });

  assert.equal(telemetry.foundationMoves, 1);
  assert.equal(telemetry.foundationToTableauMoves, 1);
  assert.equal(telemetry.tableauToTableauMoves, 1);
});

test('Ace Collector requires four distinct Aces before a non-Ace Foundation move', () => {
  let telemetry = createAchievementTelemetry('game-3');
  for (const id of ['ace-s', 'ace-h', 'ace-d', 'ace-c']) {
    telemetry = move(telemetry, 'waste', 'foundation:0', { rank: 1, id });
  }
  telemetry = move(telemetry, 'waste', 'foundation:0', { rank: 2, id: 'two-s' });
  assert.equal(telemetry.acesToFoundation, 4);
  assert.equal(telemetry.aceIdsToFoundation.length, 4);
  assert.equal(telemetry.aceCollectorEligible, true);

  let failed = createAchievementTelemetry('game-4');
  failed = move(failed, 'waste', 'foundation:0', { rank: 2, id: 'two-s' });
  failed = move(failed, 'waste', 'foundation:0', { rank: 1, id: 'ace-s' });
  assert.equal(failed.aceCollectorEligible, false);
});

test('recycle count distinguishes no pass, one pass, and multiple passes', () => {
  let telemetry = createAchievementTelemetry('game-5');
  assert.equal(telemetry.recycleCount, 0);
  telemetry = recordRecycle(telemetry);
  assert.equal(telemetry.recycleCount, 1);
  telemetry = recordRecycle(telemetry);
  assert.equal(telemetry.recycleCount, 2);
});
