// core/dailyChallenge.test.js
// Unit tests for the calendar / range helpers added for the Daily Challenge UI.
// Framework-agnostic (no DOM), so runnable via `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSupportedRange,
  listSupportedYears,
  isSupportedYM,
  withinSupported,
  isAfter,
  addMonths,
  daysInMonth,
  toDateStr,
  dateToUTC,
} from './dailyChallenge.js';

test('getSupportedRange covers the full bundled window (anchor + windowYears)', () => {
  const { start, end } = getSupportedRange();
  assert.equal(start, '2026-01-01');
  assert.equal(end, '2026-12-31');
});

test('listSupportedYears returns the years spanned by the window', () => {
  assert.deepEqual(listSupportedYears(), [2026]);
});

test('isSupportedYM is true only inside the window', () => {
  assert.equal(isSupportedYM(2026, 1), true);
  assert.equal(isSupportedYM(2026, 12), true);
  assert.equal(isSupportedYM(2025, 12), false);
  assert.equal(isSupportedYM(2027, 1), false);
});

test('withinSupported is inclusive of both ends', () => {
  assert.equal(withinSupported('2026-01-01'), true);
  assert.equal(withinSupported('2026-12-31'), true);
  assert.equal(withinSupported('2025-12-31'), false);
  assert.equal(withinSupported('2027-01-01'), false);
});

test('isAfter compares dates chronologically', () => {
  assert.equal(isAfter('2026-02-01', '2026-01-31'), true);
  assert.equal(isAfter('2026-01-31', '2026-02-01'), false);
  assert.equal(isAfter('2026-01-01', '2026-01-01'), false);
});

test('addMonths rolls the year at the boundaries', () => {
  assert.deepEqual(addMonths(2026, 1, -1), { y: 2025, m: 12 });
  assert.deepEqual(addMonths(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(addMonths(2026, 6, 3), { y: 2026, m: 9 });
});

test('daysInMonth is correct across leap years', () => {
  assert.equal(daysInMonth(2026, 2), 28); // non-leap
  assert.equal(daysInMonth(2024, 2), 29); // leap
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 1), 31);
});

test('toDateStr zero-pads year/month/day', () => {
  assert.equal(toDateStr(2026, 1, 1), '2026-01-01');
  assert.equal(toDateStr(2026, 12, 31), '2026-12-31');
});

test('dateToUTC matches Date.UTC', () => {
  assert.equal(dateToUTC('2026-03-15'), Date.UTC(2026, 2, 15));
});
