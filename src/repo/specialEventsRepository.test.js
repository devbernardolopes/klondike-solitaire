import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareEventSummaries } from './specialEventsRepository.js';
import { collectSolvedIds, mergeSolvedIds, findNextUnsolvedDeal, getEventDealProgress } from './specialEventsProgress.js';

const summary = (id, startsAt, title) => ({ id, startsAt, title: title ?? id });

test('compareEventSummaries orders by startsAt ascending', () => {
  const list = [summary('c', '2026-03-01T00:00:00Z'), summary('a', '2026-01-01T00:00:00Z'), summary('b', '2026-02-01T00:00:00Z')];
  assert.deepEqual(list.sort(compareEventSummaries).map((s) => s.id), ['a', 'b', 'c']);
});

test('compareEventSummaries breaks same-date ties alphabetically by title', () => {
  const list = [summary('b', '2026-01-01T00:00:00Z', 'Banana'), summary('a', '2026-01-01T00:00:00Z', 'Apple')];
  assert.deepEqual(list.sort(compareEventSummaries).map((s) => s.id), ['a', 'b']);
});

test('compareEventSummaries breaks title ties by id', () => {
  const list = [summary('b', '2026-01-01T00:00:00Z', 'Same'), summary('a', '2026-01-01T00:00:00Z', 'Same')];
  assert.deepEqual(list.sort(compareEventSummaries).map((s) => s.id), ['a', 'b']);
});

test('compareEventSummaries sorts missing startsAt last (legacy cache rows)', () => {
  const list = [summary('legacy', null), summary('known', '2026-01-01T00:00:00Z'), summary('missing', undefined)];
  assert.deepEqual(list.sort(compareEventSummaries).map((s) => s.id), ['known', 'legacy', 'missing']);
});

const detailWith = (solvedIds) => ({
  id: 'evt',
  pages: [{
    id: 1, pageNumber: 1, gridSize: 2, imagePath: 'p.jpg', coinReward: 0,
    completed: false, unlocked: true,
    deals: [1, 2, 3, 4].map((id, i) => ({ id, position: i + 1, seed: 100 + id, solved: solvedIds.has(id) })),
  }],
});

test('mergeSolvedIds never clears a locally-known solve (stale server truth)', () => {
  const server = detailWith(new Set([1, 2]));
  mergeSolvedIds(server, new Set([1, 2, 4]));
  assert.deepEqual(server.pages[0].deals.map((d) => d.solved), [true, true, false, true]);
});

test('out-of-order wins converge: solve 4 then 3 keeps all solved', () => {
  const server = detailWith(new Set([1, 2]));
  mergeSolvedIds(server, new Set([1, 2, 4]));
  mergeSolvedIds(server, new Set([3]));
  assert.deepEqual(server.pages[0].deals.map((d) => d.solved), [true, true, true, true]);
  assert.equal(findNextUnsolvedDeal(server, 3), null);
});

test('collectSolvedIds returns only solved deal ids', () => {
  assert.deepEqual([...collectSolvedIds(detailWith(new Set([2, 4])))].sort(), [2, 4]);
});

test('getEventDealProgress counts deals and rounds the percent', () => {
  assert.deepEqual(getEventDealProgress(detailWith(new Set([1]))), { totalDeals: 4, solvedDeals: 1, percent: 25 });
  assert.deepEqual(getEventDealProgress(detailWith(new Set([1, 2]))), { totalDeals: 4, solvedDeals: 2, percent: 50 });
  assert.deepEqual(getEventDealProgress(detailWith(new Set([1, 2, 3, 4]))), { totalDeals: 4, solvedDeals: 4, percent: 100 });
});

test('getEventDealProgress rounds whole percent (1/3 -> 33, 2/3 -> 67)', () => {
  const three = { id: 'evt', pages: [{ id: 1, pageNumber: 1, deals: [1, 2, 3].map((id) => ({ id, solved: id <= 1 })) }] };
  assert.equal(getEventDealProgress(three).percent, 33);
  const twoThirds = { id: 'evt', pages: [{ id: 1, pageNumber: 1, deals: [1, 2, 3].map((id) => ({ id, solved: id <= 2 })) }] };
  assert.equal(getEventDealProgress(twoThirds).percent, 67);
});

test('getEventDealProgress returns null percent when there are no deals', () => {
  assert.deepEqual(getEventDealProgress({ id: 'evt', pages: [] }), { totalDeals: 0, solvedDeals: 0, percent: null });
  assert.deepEqual(getEventDealProgress({ id: 'evt', pages: [{ id: 1, pageNumber: 1, deals: [] }] }), { totalDeals: 0, solvedDeals: 0, percent: null });
});
