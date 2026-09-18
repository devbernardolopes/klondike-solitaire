import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOAST_DURATION_MIN,
  TOAST_DURATION_MAX,
  TOAST_DURATION_DEFAULT,
  clampToastDuration,
} from './toastDuration.js';

test('range constants are 1–5s with a 5s default', () => {
  assert.equal(TOAST_DURATION_MIN, 1);
  assert.equal(TOAST_DURATION_MAX, 5);
  assert.equal(TOAST_DURATION_DEFAULT, 5);
});

test('clampToastDuration passes through whole seconds in range', () => {
  assert.equal(clampToastDuration(1), 1);
  assert.equal(clampToastDuration(3), 3);
  assert.equal(clampToastDuration(5), 5);
});

test('clampToastDuration clamps out-of-range values', () => {
  assert.equal(clampToastDuration(0), 1);
  assert.equal(clampToastDuration(-10), 1);
  assert.equal(clampToastDuration(6), 5);
  assert.equal(clampToastDuration(999), 5);
});

test('clampToastDuration rounds to whole seconds (1s slider steps)', () => {
  assert.equal(clampToastDuration(2.4), 2);
  assert.equal(clampToastDuration(2.5), 3);
});

test('clampToastDuration falls back to default for non-numeric input', () => {
  assert.equal(clampToastDuration(undefined), TOAST_DURATION_DEFAULT);
  assert.equal(clampToastDuration(null), TOAST_DURATION_DEFAULT);
  assert.equal(clampToastDuration(Number.NaN), TOAST_DURATION_DEFAULT);
  assert.equal(clampToastDuration('nope'), TOAST_DURATION_DEFAULT);
  assert.equal(clampToastDuration('3'), 3);
});
