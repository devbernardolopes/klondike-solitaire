// Module-level mutable queue of pending transition snapshots. Store actions
// enqueue a snapshot (keyed by a unique transition id + the move type) right
// before mutating state; the animation hooks dequeue the entry that matches
// their type after React re-renders and tween from old → new positions.
//
// Using a queue (rather than a single `current` snapshot) lets several moves
// animate *concurrently*: a second transition's snapshot can no longer clobber
// the first's, because each transition carries its own snapshot + tid.
export const flipBridge = { queue: [] };

let _tidCounter = 0;

/**
 * Push a transition snapshot onto the queue.
 * @param {string} type  one of 'move' | 'auto' | 'draw' | 'recycle' | 'deal'
 * @param {Map<string, DOMRect>} rects  pre-mutation rects keyed by card id
 * @returns {number} the transition id for this snapshot
 */
export function enqueueFlip(type, rects) {
  const tid = ++_tidCounter;
  flipBridge.queue.push({ tid, type, snapshot: rects });
  return tid;
}

/**
 * Remove and return the first queued entry whose type matches, or null.
 * @param {string} type
 * @returns {{tid:number, type:string, snapshot:Map<string,DOMRect>}|null}
 */
export function dequeueFlip(type) {
  const i = flipBridge.queue.findIndex((e) => e.type === type);
  if (i === -1) return null;
  return flipBridge.queue.splice(i, 1)[0];
}
