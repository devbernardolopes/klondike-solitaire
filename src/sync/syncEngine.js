// sync/syncEngine.js
// Offline-first flush engine for the Dexie-backed outbox (see db/syncQueue.js).
// Queueing an op via enqueue() persists it immediately and triggers a flush;
// flush() drains ops in id order, stops at the first failure (so later ops
// never apply ahead of an earlier one that hasn't succeeded), and retries on
// the next trigger. A flush only proceeds once the auth store yields a userId,
// so everything stays queued (and offline-safe) until a session exists.
//
// startSyncEngine() wires the recurring/event triggers and is called once from
// App.jsx. This step queues nothing on its own — game code in later steps calls
// enqueue(). A DEV-only window.__syncEngine hook is exposed for manual testing.

import { listQueuedOps, removeQueuedOp, markOpFailed, enqueueOp } from '../db/syncQueue.js';
import { operations } from './operations.js';
import { useAuthStore } from '../hooks/useAuthStore.js';

let flushing = false;

/**
 * Queue an operation and immediately attempt to flush.
 * @param {string} type    key into operations registry
 * @param {Object} [payload]
 * @param {string} [dedupeKey]  when provided, collapse any not-yet-flushed queued
 *   op sharing this key (see db/syncQueue.js enqueueOp). Existing 2-arg callers
 *   are unaffected.
 * @returns {Promise<void>}
 */
export async function enqueue(type, payload = {}, dedupeKey = null) {
  if (!operations[type]) {
    console.error(`syncEngine: unknown operation "${type}"`);
    return;
  }
  await enqueueOp(type, payload, dedupeKey);
  flush();
}

/**
 * Process queued ops in order. Stops at the first failure (leaving it and
 * everything after it queued) so later ops never apply out of order ahead of an
 * earlier one that hasn't succeeded yet. Safe to call repeatedly — re-entrant
 * calls while a flush is in progress are no-ops.
 * @returns {Promise<void>}
 */
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const userId = await useAuthStore.getState().ensureSignedIn();
    if (!userId) return; // no session yet (offline/new install) — retry on next trigger

    const pending = await listQueuedOps();
    let flushedCount = 0;
    for (const op of pending) {
      const handler = operations[op.type];
      if (!handler) {
        // Unknown type (e.g. from an older build) — drop rather than block forever.
        await removeQueuedOp(op.id);
        flushedCount++;
        continue;
      }
      try {
        await handler(op.payload);
        await removeQueuedOp(op.id);
        flushedCount++;
      } catch (err) {
        await markOpFailed(op.id, String(err?.message ?? err));
        break;
      }
    }
    if (flushedCount > 0) {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sync-flushed', { detail: { count: flushedCount } }));
        }
      } catch {}
    }
  } finally {
    flushing = false;
  }
}

/**
 * Wire up the flush triggers (online event, tab-visible, periodic interval) and
 * run an initial flush to drain anything queued during a previous offline
 * session. Call once from App.jsx's init effect.
 */
export function startSyncEngine() {
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) flush();
  });
  setInterval(flush, 30000);
  flush(); // catch anything queued during a previous offline session

  if (import.meta.env.DEV) {
    // Manual testing hook — not present in production builds.
    window.__syncEngine = { enqueue, flush };
  }
}
