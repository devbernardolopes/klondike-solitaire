// db/syncQueue.js
// Persistence for the offline-first sync outbox (Dexie `syncQueue` table, see
// db/schema.js v5). Each row is one pending sync operation; the engine in
// sync/syncEngine.js enqueues via enqueueOp and drains them in id order.
// Payload shape and semantics are owned by the handler registry (sync/operations.js).

import { db } from './schema.js';

/**
 * @typedef {Object} QueuedOp
 * @property {number} [id]          auto-increment primary key (flush order)
 * @property {string} type           operation name — key into sync/operations.js
 * @property {Object} payload        args for the operation handler
 * @property {number} createdAt      epoch ms when enqueued
 * @property {number} attempts       failed-attempt count
 * @property {string|null} lastError last failure message, or null
 */

/**
 * Append a pending operation to the outbox.
 * @param {string} type
 * @param {Object} payload
 * @returns {Promise<number>} the new row id
 */
export async function enqueueOp(type, payload) {
  return db.syncQueue.add({
    type,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  });
}

/**
 * Return all pending ops in flush (id) order.
 * @returns {Promise<QueuedOp[]>}
 */
export async function listQueuedOps() {
  return db.syncQueue.orderBy('id').toArray();
}

/**
 * Remove a successfully-flushed (or unrecognized) op from the outbox.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function removeQueuedOp(id) {
  await db.syncQueue.delete(id);
}

/**
 * Record a failed flush attempt so the engine can back off / surface it later.
 * @param {number} id
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
export async function markOpFailed(id, errorMessage) {
  const row = await db.syncQueue.get(id);
  const attempts = (row && row.attempts) || 0;
  await db.syncQueue.update(id, { attempts: attempts + 1, lastError: errorMessage });
}

/**
 * Drop every pending op. Used when abandoning a session's queue outright (see
 * useAuthStore.resolveLinkConflict) rather than letting it flush under a
 * different, just-adopted identity.
 * @returns {Promise<void>}
 */
export async function clearQueuedOps() {
  await db.syncQueue.clear();
}
