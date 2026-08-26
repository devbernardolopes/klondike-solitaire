// tests/serverTime.test.js
// Regression coverage for the Daily Challenge "today" source. The key behavior:
// on a failed server fetch, fetchServerNow must keep the last-known-good cached
// server time (so the calendar never collapses to the window anchor and disables
// every day) and only use the hard fallback when there is no cache at all.

import test from 'node:test';
import assert from 'node:assert/strict';

const FALLBACK = Date.UTC(2026, 0, 1); // 2026-01-01, the window anchor
const SEED = Date.UTC(2026, 7, 26); // 2026-08-26

function setFetchResolved(json, ok = true) {
  global.fetch = async () => ({ ok, json: async () => json });
}
function setFetchRejected() {
  global.fetch = async () => { throw new Error('network'); };
}

test('fetchServerNow keeps the cached time when the fetch fails', async () => {
  setFetchResolved({ year: 2026, month: 8, day: 26 });
  const { refreshServerNow, fetchServerNow } = await import('../src/utils/serverTime.js');
  await refreshServerNow(); // seed the in-memory cache

  setFetchRejected();
  const ms = await fetchServerNow();

  assert.equal(ms, SEED);
  assert.notEqual(ms, FALLBACK);
});

test('fetchServerNow falls back to the anchor only with no cached value', async () => {
  setFetchRejected();
  // Fresh module instance so the cache starts empty (null) as on a first-ever load.
  const mod = await import('../src/utils/serverTime.js?fresh=1');
  const ms = await mod.fetchServerNow();

  assert.equal(ms, FALLBACK);
});

test('refreshServerNow does not regress the cache on failure', async () => {
  setFetchResolved({ year: 2026, month: 8, day: 26 });
  const { refreshServerNow, getCachedServerNow } = await import('../src/utils/serverTime.js');
  await refreshServerNow();
  assert.equal(getCachedServerNow(), SEED);

  setFetchRejected();
  await refreshServerNow();

  assert.equal(getCachedServerNow(), SEED);
});

test('refreshServerNowWithRetry returns the server time after failures', async () => {
  // Fresh module instance so its cache starts empty.
  const mod = await import('../src/utils/serverTime.js?retry=1');
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls < 3) throw new Error('fail');
    return { ok: true, json: async () => ({ year: 2026, month: 8, day: 26 }) };
  };

  const ms = await mod.refreshServerNowWithRetry({ maxAttempts: 5, delayMs: 1, shouldCancel: () => false });

  assert.equal(ms, SEED);
  assert.ok(calls >= 3);
});

test('refreshServerNowWithRetry returns null after maxAttempts', async () => {
  const mod = await import('../src/utils/serverTime.js?retry=2');
  global.fetch = async () => { throw new Error('fail'); };

  const ms = await mod.refreshServerNowWithRetry({ maxAttempts: 3, delayMs: 1, shouldCancel: () => false });

  assert.equal(ms, null);
});

test('refreshServerNowWithRetry returns null when cancelled', async () => {
  const mod = await import('../src/utils/serverTime.js?retry=3');
  global.fetch = async () => ({ ok: true, json: async () => ({ year: 2026, month: 8, day: 26 }) });

  const ms = await mod.refreshServerNowWithRetry({ maxAttempts: 3, delayMs: 1, shouldCancel: () => true });

  assert.equal(ms, null);
});
