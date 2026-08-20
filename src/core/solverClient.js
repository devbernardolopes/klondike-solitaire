// core/solverClient.js
// Async wrapper around the solver Web Worker. Results are matched by id; stale
// jobs are dropped via a generation counter bumped on cancel(), so a new deal /
// move never causes a previous (now-irrelevant) solve to act on the board.

let worker = null;
let nextId = 1;
let generation = 0;
const pending = new Map();
export const STALE = '__solver_stale__';

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, seq } = e.data || {};
    const resolve = pending.get(id);
    if (!resolve) return;
    pending.delete(id);
    resolve(seq);
  };
  worker.onerror = () => {
    // If the worker dies, fail every pending job gracefully (treated as "no win").
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
