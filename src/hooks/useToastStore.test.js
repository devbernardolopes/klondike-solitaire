import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useToastStore, TOAST_PRIORITY } from './useToastStore.js';

function reset() {
  useToastStore.setState({
    config: { enabled: true, position: 'top-center' },
    queue: [],
    active: null,
    phase: 'idle',
  });
}

test('first push promotes to active; later coins push never preempts active', () => {
  reset();
  const store = useToastStore.getState();
  store.push({ name: 'achievement', priority: TOAST_PRIORITY.DEFAULT });
  assert.equal(useToastStore.getState().active.name, 'achievement');
  store.push({ name: 'coins', priority: TOAST_PRIORITY.COINS });
  assert.equal(useToastStore.getState().active.name, 'achievement');
  assert.deepEqual(
    useToastStore.getState().queue.map((t) => t.name),
    ['coins'],
  );
});

test('queue orders coins -> personal bests -> rest, stable within a level', () => {
  reset();
  const store = useToastStore.getState();
  store.push({ name: 'active', priority: TOAST_PRIORITY.DEFAULT });
  store.push({ name: 'achievement', priority: TOAST_PRIORITY.DEFAULT });
  store.push({ name: 'best-time', priority: TOAST_PRIORITY.PERSONAL_BEST });
  store.push({ name: 'best-moves', priority: TOAST_PRIORITY.PERSONAL_BEST });
  store.push({ name: 'coins', icon: 'coins', priority: TOAST_PRIORITY.COINS });
  assert.deepEqual(
    useToastStore.getState().queue.map((t) => t.name),
    ['coins', 'best-time', 'best-moves', 'achievement'],
  );
});

test('late coins push jumps ahead of queued personal bests and achievements', () => {
  reset();
  const store = useToastStore.getState();
  store.push({ name: 'active', priority: TOAST_PRIORITY.DEFAULT });
  store.push({ name: 'achievement', priority: TOAST_PRIORITY.DEFAULT });
  store.push({ name: 'best-time', priority: TOAST_PRIORITY.PERSONAL_BEST });
  store.push({ name: 'coins', icon: 'coins', priority: TOAST_PRIORITY.COINS });
  assert.deepEqual(
    useToastStore.getState().queue.map((t) => t.name),
    ['coins', 'best-time', 'achievement'],
  );
});

test('push without priority defaults to last', () => {
  reset();
  const store = useToastStore.getState();
  store.push({ name: 'active' });
  store.push({ name: 'plain' });
  store.push({ name: 'coins', priority: TOAST_PRIORITY.COINS });
  assert.deepEqual(
    useToastStore.getState().queue.map((t) => t.name),
    ['coins', 'plain'],
  );
});

test('push is a no-op when toasts are disabled', () => {
  reset();
  useToastStore.setState({ config: { enabled: false, position: 'top-center' } });
  useToastStore.getState().push({ name: 'coins', priority: TOAST_PRIORITY.COINS });
  assert.equal(useToastStore.getState().active, null);
  assert.deepEqual(useToastStore.getState().queue, []);
});
