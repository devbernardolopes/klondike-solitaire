import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectAwards, paginateAwards } from './awardsRepository.js';

const ach = (id, unlockedAt) => ({ kind: 'achievement', id, title: id, imagePath: `${id}.jpg`, unlockedAt, ref: null });
const post = (id, unlockedAt) => ({ kind: 'postcard', id, title: id, imagePath: `${id}.jpg`, unlockedAt, ref: null });

test('collectAwards orders by unlock time across kinds', () => {
  const items = collectAwards({
    achievements: [ach('a1', '2026-09-03T10:00:00Z')],
    postcards: [post('p1', '2026-09-01T10:00:00Z')],
  });
  assert.deepEqual(items.map((i) => i.id), ['p1', 'a1']);
});

test('collectAwards sinks unknown timestamps last with deterministic ties', () => {
  const items = collectAwards({
    achievements: [ach('a2', null), ach('a1', '2026-09-01T10:00:00Z')],
    postcards: [post('p1', null)],
  });
  assert.deepEqual(items.map((i) => i.id), ['a1', 'a2', 'p1']);
});

test('collectAwards tolerates empty input', () => {
  assert.deepEqual(collectAwards(), []);
  assert.deepEqual(collectAwards({}), []);
});

test('paginateAwards chunks and always returns at least one page', () => {
  const items = [ach('a1'), ach('a2'), ach('a3')];
  assert.deepEqual(paginateAwards(items, 2).map((p) => p.length), [2, 1]);
  assert.deepEqual(paginateAwards([], 4), [[]]);
  assert.deepEqual(paginateAwards(items, 0).map((p) => p.length), [1, 1, 1]);
});
