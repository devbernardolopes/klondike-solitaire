// core/solver.worker.js
// Web Worker that runs the (potentially expensive) win-proving search off the
// main thread so the UI never freezes. It only imports the pure core solver.

import { findWinningSequence, findReachableProgress } from './solver.js';

self.onmessage = (e) => {
  const { id, state, opts } = e.data || {};
  let seq = null;
  try {
    if (state) {
      // `goal: 'progress'` answers "is any progress move reachable?" (used by the
      // "no moves remaining" detector); otherwise we prove a full win.
      seq = opts && opts.goal === 'progress'
        ? findReachableProgress(state, opts || {})
        : findWinningSequence(state, opts || {});
    }
  } catch {
    seq = null;
  }
  self.postMessage({ id, seq });
};
