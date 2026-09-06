import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareEventSummaries, eventStartYear, isUpcomingEvent, wonEventDealIdFromQueuedOp } from './specialEventsRepository.js';
import { collectSolvedIds, mergeSolvedIds, findNextUnsolvedDealOnPage, getEventDealProgress } from './specialEventsProgress.js';

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

test('isUpcomingEvent flags future startsAt as a disabled teaser', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  assert.equal(isUpcomingEvent('2026-09-09T12:00:00Z', now), true);
  assert.equal(isUpcomingEvent('2026-09-06T11:59:59Z', now), false);
  assert.equal(isUpcomingEvent(null, now), false);
  assert.equal(isUpcomingEvent('not-a-date', now), false);
});

test('eventStartYear reads the UTC calendar year for year filters', () => {
  assert.equal(eventStartYear('2025-12-31T23:00:00-02:00'), 2026);
  assert.equal(eventStartYear('2026-06-15T00:00:00Z'), 2026);
  assert.equal(eventStartYear(null), null);
  assert.equal(eventStartYear('not-a-date'), null);
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
  assert.equal(findNextUnsolvedDealOnPage(server, 3), null);
});

test('findNextUnsolvedDealOnPage advances forward within the same page', () => {
  const target = findNextUnsolvedDealOnPage(detailWith(new Set([1])), 1);
  assert.equal(target?.deal.id, 2);
  assert.equal(target?.pageNumber, 1);
});

test('findNextUnsolvedDealOnPage wraps to the page start when nothing is ahead', () => {
  const target = findNextUnsolvedDealOnPage(detailWith(new Set([1, 3, 4])), 4);
  assert.equal(target?.deal.id, 2);
  assert.equal(target?.pageNumber, 1);
});

test('findNextUnsolvedDealOnPage never leaves the page', () => {
  const twoPages = {
    id: 'evt',
    pages: [
      { id: 1, pageNumber: 1, deals: [1, 2].map((id) => ({ id, position: id, dealNumber: id, solved: true })) },
      { id: 2, pageNumber: 2, deals: [3, 4].map((id) => ({ id, position: id - 2, dealNumber: id, solved: false })) },
    ],
  };
  assert.equal(findNextUnsolvedDealOnPage(twoPages, 2), null);
  assert.equal(findNextUnsolvedDealOnPage(twoPages, 99), null);
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

test('wonEventDealIdFromQueuedOp ignores losses so Game Over never solves a deal', () => {
  assert.equal(
    wonEventDealIdFromQueuedOp({ type: 'submit_game_result', payload: { p_won: false, p_event_deal_id: 42 } }),
    null,
  );
  assert.equal(
    wonEventDealIdFromQueuedOp({ type: 'submit_game_result', payload: { p_won: true, p_event_deal_id: 42 } }),
    42,
  );
  assert.equal(
    wonEventDealIdFromQueuedOp({ type: 'submit_game_result', payload: { p_won: true } }),
    null,
  );
  assert.equal(wonEventDealIdFromQueuedOp({ type: 'reset_statistics', payload: {} }), null);
});
