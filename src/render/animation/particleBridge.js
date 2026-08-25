// render/animation/particleBridge.js
//
// Module-level queue of pending foundation particle-burst events. The DOM-free
// game store enqueues an event whenever a card lands on a foundation; the
// animation hook (useFoundationParticles) drains the queue after each React
// commit and spawns the burst. Mirrors the flipBridge pattern so the store
// stays free of any DOM/render concerns.
//
// Each event carries the suit (for the glyph image) and the destination
// foundation locator (so the hook can locate the origin on screen).

export const particleBridge = { queue: [] };

/**
 * Queue a foundation burst event.
 * @param {string} suit  'hearts'|'diamonds'|'clubs'|'spades'
 * @param {string} loc   destination locator, e.g. 'foundation:2'
 */
export function enqueueParticle(suit, loc) {
  particleBridge.queue.push({ suit, loc });
}

/**
 * Remove and return every queued event (drained once per commit).
 * @returns {Array<{suit:string, loc:string}>}
 */
export function drainParticles() {
  if (particleBridge.queue.length === 0) return [];
  const out = particleBridge.queue;
  particleBridge.queue = [];
  return out;
}
