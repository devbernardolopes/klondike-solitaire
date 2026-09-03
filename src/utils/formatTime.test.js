import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTime, formatTimeClock } from './formatTime.js';

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

test('formatTimeClock defaults to centiseconds (matches formatTime)', () => {
  assert.equal(formatTimeClock(0), '00:00.00');
  assert.equal(formatTimeClock(999), '00:00.99');
  assert.equal(formatTimeClock(72370), '01:12.37');
  assert.equal(formatTimeClock(30 * 60 * 1000), '30:00.00');
});

test('formatTimeClock with centiseconds:false drops the .hh suffix', () => {
  assert.equal(formatTimeClock(0, { centiseconds: false }), '00:00');
  assert.equal(formatTimeClock(999, { centiseconds: false }), '00:00');
  assert.equal(formatTimeClock(1000, { centiseconds: false }), '00:01');
  assert.equal(formatTimeClock(1037, { centiseconds: false }), '00:01');
  assert.equal(formatTimeClock(72370, { centiseconds: false }), '01:12');
  assert.equal(formatTimeClock(30 * 60 * 1000, { centiseconds: false }), '30:00');
  assert.equal(formatTimeClock(-1, { centiseconds: false }), '00:00');
});

