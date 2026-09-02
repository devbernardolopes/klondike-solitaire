import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTime } from './formatTime.js';

test('formatTime renders minutes, seconds, and truncated hundredths', () => {
  assert.equal(formatTime(0), '00:00.00');
  assert.equal(formatTime(-1), '00:00.00');
  assert.equal(formatTime(999), '00:00.99');
  assert.equal(formatTime(1000), '00:01.00');
  assert.equal(formatTime(1005), '00:01.00');
  assert.equal(formatTime(1037), '00:01.03');
  assert.equal(formatTime(72370), '01:12.37');
  assert.equal(formatTime(30 * 60 * 1000), '30:00.00');
});
