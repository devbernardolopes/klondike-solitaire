import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  queuedOpToHistoryEntry,
  serverRowToHistoryEntry,
  mergeHistoryEntries,
} from './gameHistoryRepository.js';

const winPayload = {
  p_won: true,
  p_moves: 120,
  p_duration_ms: 261370,
  p_score: 0,
  p_undos: 2,
  p_seed: 12345,
  p_game_kind: 'winning',
  p_game_id: 'game-1',
  p_hint_used: true,
  p_undo_used: true,
  p_tableau_to_tableau_moves: 10,
  p_foundation_moves: 20,
  p_foundation_to_tableau_moves: 1,
  p_recycle_count: 3,
  p_foundation_first_eligible: true,
  p_ace_collector_eligible: false,
  p_aces_to_foundation: 4,
};

test('queuedOpToHistoryEntry maps a win payload to a pending entry', () => {
  const entry = queuedOpToHistoryEntry({ id: 7, type: 'submit_game_result', payload: winPayload, createdAt: 1700000000000 });
  assert.equal(entry.key, 'pending-7');
  assert.equal(entry.gameId, 'game-1');
  assert.equal(entry.won, true);
  assert.equal(entry.moves, 120);
  assert.equal(entry.seed, 12345);
  assert.equal(entry.gameKind, 'winning');
  assert.equal(entry.pending, true);
  assert.equal(entry.hintUsed, true);
  assert.equal(entry.aceCollectorEligible, false);
});

test('queuedOpToHistoryEntry tolerates loss payloads without seed/kind', () => {
  const entry = queuedOpToHistoryEntry({
    id: 8,
    type: 'submit_game_result',
    payload: { p_won: false, p_moves: 12, p_duration_ms: 30000 },
    createdAt: 1700000000000,
  });
  assert.equal(entry.won, false);
  assert.equal(entry.seed, null);
  assert.equal(entry.gameKind, null);
  assert.equal(entry.gameId, null);
  assert.equal(entry.pending, true);
});

test('queuedOpToHistoryEntry maps a loss payload with full win-parity context', () => {
  const entry = queuedOpToHistoryEntry({
    id: 9,
    type: 'submit_game_result',
    payload: {
      p_won: false,
      p_moves: 45,
      p_duration_ms: 90000,
      p_score: 0,
      p_undos: 1,
      p_seed: 777,
      p_game_kind: 'daily',
      p_daily_date: '2026-02-01',
      p_game_id: 'loss-1',
    },
    createdAt: 1700000000000,
  });
  assert.equal(entry.won, false);
  assert.equal(entry.moves, 45);
  assert.equal(entry.seed, 777);
  assert.equal(entry.gameKind, 'daily');
  assert.equal(entry.gameId, 'loss-1');
  assert.equal(entry.pending, true);
});

test('serverRowToHistoryEntry maps a game_results row', () => {
  const entry = serverRowToHistoryEntry({
    id: 'row-uuid',
    game_id: 'game-1',
    won: true,
    moves: 120,
    duration_ms: 261370,
    score: 5,
    undos: 2,
    seed: 12345,
    game_kind: 'event',
    hint_used: false,
    undo_used: true,
    tableau_to_tableau_moves: 10,
    foundation_moves: 20,
    foundation_to_tableau_moves: 1,
    recycle_count: 3,
    foundation_first_eligible: true,
    ace_collector_eligible: true,
    aces_to_foundation: 4,
    ace_ids_to_foundation: ['a', 'b'],
    created_at: '2026-01-01T00:00:00Z',
  });
  assert.equal(entry.key, 'server-row-uuid');
  assert.equal(entry.pending, false);
  assert.equal(entry.gameKind, 'event');
  assert.deepEqual(entry.aceIdsToFoundation, ['a', 'b']);
  assert.equal(entry.createdAt, '2026-01-01T00:00:00Z');
});

test('serverRowToHistoryEntry defaults non-array ace ids to []', () => {
  const entry = serverRowToHistoryEntry({
    id: 'r', game_id: null, won: false, moves: 1, duration_ms: 1,
    ace_ids_to_foundation: null, created_at: '2026-01-01T00:00:00Z',
  });
  assert.deepEqual(entry.aceIdsToFoundation, []);
});

test('mergeHistoryEntries puts pending first, newest first', () => {
  const server = [{ key: 'server-1', gameId: 'g1', createdAt: '2026-01-01T00:00:00Z' }];
  const ops = [
    { id: 1, type: 'submit_game_result', payload: { p_won: true, p_game_id: 'g2' }, createdAt: 1000 },
    { id: 2, type: 'submit_game_result', payload: { p_won: false, p_game_id: 'g3' }, createdAt: 2000 },
  ];
  const merged = mergeHistoryEntries(server, ops);
  assert.deepEqual(merged.map((e) => e.gameId), ['g3', 'g2', 'g1']);
  assert.equal(merged[0].pending, true);
  assert.equal(merged[2].pending, undefined);
});

test('mergeHistoryEntries drops pending rows already flushed to the server', () => {
  const server = [{ key: 'server-1', gameId: 'g1', createdAt: '2026-01-01T00:00:00Z' }];
  const ops = [
    { id: 1, type: 'submit_game_result', payload: { p_won: true, p_game_id: 'g1' }, createdAt: 3000 },
    { id: 2, type: 'submit_game_result', payload: { p_won: false, p_game_id: null }, createdAt: 2000 },
    { id: 3, type: 'reset_statistics', payload: {}, createdAt: 4000 },
  ];
  const merged = mergeHistoryEntries(server, ops);
  assert.deepEqual(merged.map((e) => e.key), ['pending-2', 'server-1']);
});

test('mergeHistoryEntries handles empty inputs', () => {
  assert.deepEqual(mergeHistoryEntries([], []), []);
  assert.deepEqual(mergeHistoryEntries(null, null), []);
});
