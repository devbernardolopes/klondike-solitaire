import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  serverRowToFavoriteEntry,
  mergeFavorites,
} from './favoritesRepository.js';

const serverRow = {
  seed: 111,
  game_kind: 'winning',
  daily_date: null,
  event_deal_id: null,
  event_id: null,
  created_at: '2026-09-01T10:00:00.000Z',
};

test('serverRowToFavoriteEntry maps a favorite_deals row', () => {
  const entry = serverRowToFavoriteEntry(serverRow);
  assert.equal(entry.seed, 111);
  assert.equal(entry.gameKind, 'winning');
  assert.equal(entry.favoritedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(entry.pending, false);
});

test('serverRowToFavoriteEntry defaults a sparse row', () => {
  const entry = serverRowToFavoriteEntry({ seed: 5, created_at: '2026-09-02T00:00:00.000Z' });
  assert.equal(entry.gameKind, 'winning');
  assert.equal(entry.dailyDate, null);
  assert.equal(entry.eventDealId, null);
  assert.equal(entry.eventId, null);
});

test('mergeFavorites puts queued adds first, newest first', () => {
  const ops = [
    { id: 1, type: 'add_favorite', payload: { seed: 222, game_kind: 'random' }, createdAt: 1788300000000 },
  ];
  const merged = mergeFavorites([serverRow], [], ops);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].seed, 222);
  assert.equal(merged[0].pending, true);
  assert.equal(merged[1].seed, 111);
  assert.equal(merged[1].pending, false);
});

test('mergeFavorites drops server rows with a queued remove', () => {
  const ops = [{ id: 2, type: 'remove_favorite', payload: { seed: 111 }, createdAt: 1700000002000 }];
  const merged = mergeFavorites([serverRow], [], ops);
  assert.deepEqual(merged, []);
});

test('mergeFavorites honors op order per seed (add then remove)', () => {
  const ops = [
    { id: 3, type: 'add_favorite', payload: { seed: 333, game_kind: 'daily', daily_date: '2026-09-03' }, createdAt: 1700000003000 },
    { id: 4, type: 'remove_favorite', payload: { seed: 333 }, createdAt: 1700000004000 },
  ];
  const merged = mergeFavorites([], [], ops);
  assert.deepEqual(merged, []);
});

test('mergeFavorites honors op order per seed (remove then add)', () => {
  const ops = [
    { id: 5, type: 'remove_favorite', payload: { seed: 111 }, createdAt: 1700000005000 },
    { id: 6, type: 'add_favorite', payload: { seed: 111, game_kind: 'winning' }, createdAt: 1700000006000 },
  ];
  const merged = mergeFavorites([serverRow], [], ops);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].seed, 111);
  assert.equal(merged[0].pending, true);
});

test('mergeFavorites keeps local-only rows whose add is still queued', () => {
  const local = [{ seed: 444, gameKind: 'event', dailyDate: null, eventDealId: 7, eventId: 'ev', favoritedAt: '2026-09-04T00:00:00.000Z' }];
  const ops = [
    { id: 7, type: 'add_favorite', payload: { seed: 444, game_kind: 'event', event_deal_id: 7, event_id: 'ev' }, createdAt: 1700000007000 },
  ];
  const merged = mergeFavorites([], local, ops);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].seed, 444);
});

test('mergeFavorites strips local-only rows the server does not confirm', () => {
  const local = [{ seed: 555, gameKind: 'winning', dailyDate: null, eventDealId: null, eventId: null, favoritedAt: '2026-09-05T00:00:00.000Z' }];
  const merged = mergeFavorites([serverRow], local, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].seed, 111);
});

test('mergeFavorites handles empty inputs', () => {
  assert.deepEqual(mergeFavorites([], [], []), []);
  assert.deepEqual(mergeFavorites(null, null, null), []);
});
