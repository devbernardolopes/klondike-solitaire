// core/solverClient.js
// Async wrapper around the solver Web Worker. Results are matched by id; stale
// jobs are dropped via a generation counter bumped on cancel(), so a new deal /
// move never causes a previous (now-irrelevant) solve to act on the board.
//
// Offline resilience: the worker is a separate JS chunk that must be fetched
// from the server. When that fetch fails (e.g. the network is down and the
// chunk is not yet cached), `new Worker()` throws or the worker dies before it
// can answer. We detect that and transparently fall back to running the PURE
// solver on the main thread, so auto-complete / dead-end detection still work
// without a network connection. The main-thread path is also what runs under
// Node (where `Worker`/`import.meta.url` workers don't exist), which keeps the
// core unit-testable in isolation.

import { findWinningSequence, findReachableMove } from './solver.js';

let worker = null;
let workerBroken = false;
let nextId = 1;
let generation = 0;
const pending = new Map();
export const STALE = '__solver_stale__';

function runMainThread(state, opts) {
  if (!state) return null;
  return opts && opts.goal === 'move'
    ? findReachableMove(state, opts || {})
    : findWinningSequence(state, opts || {});
}

function ensureWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
  } catch {
    // Construction failed (offline, blocked, unsupported). Disable the worker
    // permanently for this session and let callers fall back to main thread.
    worker = null;
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e) => {
    const { id, seq } = e.data || {};
    const resolve = pending.get(id);
    if (!resolve) return;
    pending.delete(id);
    resolve(seq);
  };
  worker.onerror = () => {
    // If the worker dies (e.g. its chunk failed to load), fail every pending
    // job gracefully (treated as "no win") and mark the worker broken so future
    // calls skip it and run on the main thread instead.
    workerBroken = true;
    worker = null;
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
  };
  return worker;
}

/**
 * Prove a winning sequence for `state` off the main thread.
 * @param {import('./GameState.js').GameState} state
 * @param {{ maxNodes?: number, maxMs?: number }} [opts]
 * @returns {{ promise: Promise<Array<object>|null>, cancel: () => void }}
 *   `promise` resolves to the move sequence, `null` (no win), or `STALE`
 *   (superseded by a later cancel). `cancel()` drops this job immediately.
 */
export function solveAsync(state, opts = {}) {
  const w = ensureWorker();
  if (!w) {
    // No usable worker (offline / unsupported). Run the pure solver on the
    // main thread. We defer the computation to a microtask (rather than
    // resolving an already-computed value) so the heavy search never blocks
    // the call stack that requested it, and so callers' `.then()` still fires
    // after the current stack unwinds. `cancel` is a no-op because the work is
    // already dispatched.
    return {
      promise: Promise.resolve().then(() => runMainThread(state, opts)),
      cancel: () => {},
    };
  }
  const id = nextId++;
  const myGen = generation;
  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
    pending.set(id, resolveFn);
  });
  w.postMessage({ id, state, opts });
  const wrapped = promise.then((seq) => (myGen !== generation ? STALE : seq));
  const cancel = () => {
    generation++;
    pending.delete(id);
    resolveFn(STALE);
  };
  return { promise: wrapped, cancel };
}

/** Cancel every in-flight solve (used when the game is reset/redirected). */
export function cancelAllSolves() {
  generation++;
  pending.clear();
}
