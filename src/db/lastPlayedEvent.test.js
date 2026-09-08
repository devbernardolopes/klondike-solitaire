import { test } from 'node:test';
import assert from 'node:assert/strict';

import { saveLastPlayedEvent, loadLastPlayedEvent, loadLastPlayedEventSync, clearLastPlayedEvent } from './lastPlayedEvent.js';

test('save/load round-trips the last-played event id through the memory mirror', async () => {
  await saveLastPlayedEvent('holi-2026');
  assert.equal(loadLastPlayedEventSync(), 'holi-2026');
  assert.equal(await loadLastPlayedEvent(), 'holi-2026');
  await saveLastPlayedEvent(null);
  assert.equal(loadLastPlayedEventSync(), null);
});

test('clearLastPlayedEvent forgets the id', async () => {
  await saveLastPlayedEvent('holi-2026');
  clearLastPlayedEvent();
  assert.equal(loadLastPlayedEventSync(), null);
  assert.equal(await loadLastPlayedEvent(), null);
});

test('non-string ids are normalized', async () => {
  await saveLastPlayedEvent(42);
  assert.equal(loadLastPlayedEventSync(), '42');
  await saveLastPlayedEvent(null);
});
