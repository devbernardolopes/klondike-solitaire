// core/playback.test.js
// Parser + state builder for the move-log playback feature.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deal } from './dealer.js';
import { applyMove, undo as coreUndo } from './moveEngine.js';
import { getAutoMoveTargets } from './rules.js';
import { formatMove } from './moveLog.js';
import {
  parseLogLine,
  expandLocator,
  resolvePlaybackMove,
  buildPlaybackStates,
  diffPlaybackStates,
} from './playback.js';

test('parseLogLine handles D/R/U and moves', () => {
  assert.deepEqual(parseLogLine('D'), { type: 'draw' });
  assert.deepEqual(parseLogLine('R'), { type: 'recycle' });
  assert.deepEqual(parseLogLine('U'), { type: 'undo' });
  assert.deepEqual(parseLogLine('Ah W->F1'), {
    type: 'moveCards', labels: ['Ah'], from: 'waste', to: 'foundation:0',
  });
  assert.deepEqual(parseLogLine('7h,6s,5h T3->T6'), {
    type: 'moveCards', labels: ['7h', '6s', '5h'], from: 'tableau:2', to: 'tableau:5',
  });
  assert.equal(parseLogLine('bogus'), null);
  assert.equal(parseLogLine('Ah W->F9'), null);
  assert.equal(parseLogLine('Ah X1->F1'), null);
  assert.equal(parseLogLine(''), null);
  assert.equal(parseLogLine(null), null);
});

test('expandLocator maps short piles to canonical locators', () => {
  assert.equal(expandLocator('S'), 'stock');
  assert.equal(expandLocator('W'), 'waste');
  assert.equal(expandLocator('F1'), 'foundation:0');
  assert.equal(expandLocator('F4'), 'foundation:3');
  assert.equal(expandLocator('T1'), 'tableau:0');
  assert.equal(expandLocator('T7'), 'tableau:6');
  assert.equal(expandLocator('F5'), null);
  assert.equal(expandLocator('T0'), null);
});

test('round trip: recorded draw + waste move resolve against a fresh deal', () => {
  // Play forward on one deal instance, recording lines as the game would.
  let live = deal({ seed: 7 });
  const lines = [];
  let recordedMove = null;
  for (let i = 0; i < 24; i++) {
    if (live.stock.length === 0) break;
    lines.push(formatMove(live, { type: 'draw' }));
    live = applyMove(live, { type: 'draw' });
    const w = live.waste[live.waste.length - 1];
    const targets = getAutoMoveTargets(live, 'waste', w.id);
    if (targets.length > 0) {
      recordedMove = { type: 'moveCards', from: 'waste', to: targets[0], cardIds: [w.id] };
      lines.push(formatMove(live, recordedMove));
      break;
    }
  }
  assert.ok(recordedMove, 'seed 7 should yield a movable waste card within 24 draws');
  // Resolve every recorded line against a FRESH deal (different card ids).
  const fresh = deal({ seed: 7 });
  const states = buildPlaybackStates(fresh, lines);
  assert.equal(states.length, lines.length + 1);
  const last = states[states.length - 1];
  assert.equal(last.waste.length, live.waste.length - 1);
});

test('buildPlaybackStates replays draw + move + undo to identical boards', () => {
  // Build a real sequence with the engine, recording lines along the way.
  const initial = deal({ seed: 11 });
  let live = initial;
  const lines = [];
  const rec = (move) => {
    lines.push(formatMove(live, move));
    live = applyMove(live, move);
  };
  rec({ type: 'draw' });
  // Undo the draw in the live game to capture the U line.
  lines.push('U');
  live = coreUndo(live);

  const states = buildPlaybackStates(deal({ seed: 11 }), lines);
  assert.equal(states.length, 3);
  // states[1] has one waste card; states[2] equals the initial layout.
  assert.equal(states[1].waste.length, 1);
  assert.equal(states[1].stock.length, initial.stock.length - 1);
  assert.deepEqual(
    states[2].tableau.map((p) => p.map((c) => `${c.suit}:${c.rank}:${c.faceUp}`)),
    initial.tableau.map((p) => p.map((c) => `${c.suit}:${c.rank}:${c.faceUp}`)),
  );
  assert.deepEqual(states[2].stock.length, initial.stock.length);
  assert.deepEqual(states[2].waste.length, 0);
});

test('buildPlaybackStates throws on corrupt lines', () => {
  const initial = deal({ seed: 5 });
  assert.throws(() => buildPlaybackStates(initial, ['bogus']), /Unrecognized/);
  assert.throws(() => buildPlaybackStates(initial, ['U']), /no previous step/);
  // Log diverged from board: Ah W->F1 while waste top is something else.
  assert.throws(
    () => buildPlaybackStates(initial, ['D', 'Ah W->F1', 'Ah W->F1']),
    /diverged|Source pile/,
  );
});

test('diffPlaybackStates reports moved cards and destinations', () => {
  const a = deal({ seed: 9 });
  const b = applyMove(a, { type: 'draw' });
  const { animIds, destLocs } = diffPlaybackStates(a, b);
  assert.equal(animIds.length, 1);
  assert.deepEqual(destLocs, ['waste']);
  const none = diffPlaybackStates(a, a);
  assert.deepEqual(none.animIds, []);
});
