import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareEventSummaries } from './specialEventsRepository.js';

const summary = (id, sortOrder) => ({ id, sortOrder });

test('compareEventSummaries orders by sortOrder ascending', () => {
  const list = [summary('c', 10), summary('a', 5), summary('b', 7)];
  assert.deepEqual(list.sort(compareEventSummaries).map((s) => s.id), ['a', 'b', 'c']);
});

test('compareEventSummaries breaks sortOrder ties by id', () => {
  const list = [summary('b', 5), summary('a', 5)];
  assert.deepEqual(list.sort(compareEventSummaries).map((s) => s.id), ['a', 'b']);
});

test('compareEventSummaries sorts missing sortOrder last (legacy cache rows)', () => {
  const list = [summary('legacy', null), summary('known', 3), summary('missing', undefined)];
  assert.deepEqual(list.sort(compareEventSummaries).map((s) => s.id), ['known', 'legacy', 'missing']);
});
