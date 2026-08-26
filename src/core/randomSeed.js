// core/randomSeed.js
// Framework-agnostic. No React / DOM / UI / DB imports allowed in this file.
//
// Generates a random 32-bit unsigned seed for "Random Shuffle" deals that is
// guaranteed NOT to collide with any seed bundled in the data files
// (solvable pool, daily challenge, special events) nor with any seed that has
// already been dealt in the past (the caller supplies the set of previously
// used random seeds, persisted by the app).

import { SOLVABLE_SEEDS } from './solvablePool.js';
import dailyData from '../data/dailyChallenge.json' with { type: 'json' };
import { listEvents } from './specialEvents.js';

// Every seed that is permanently reserved by the bundled data. A Random deal
// must never reuse any of these, or it could masquerade as a Winning/Daily/
// Event deal.
const KNOWN_SEEDS = (() => {
  const s = new Set();
  for (const x of SOLVABLE_SEEDS) s.add(x);
  const dailySeeds = (dailyData && dailyData.seeds) || {};
  for (const k of Object.keys(dailySeeds)) {
    const v = dailySeeds[k];
    if (typeof v === 'number') s.add(v);
  }
  for (const ev of listEvents()) {
    for (const sd of ev.seeds || []) s.add(sd);
  }
  return s;
})();

/** Number of permanently reserved (data-file) seeds. @returns {number} */
export function knownSeedCount() {
  return KNOWN_SEEDS.size;
}

/**
 * Whether a seed is one of the permanently reserved data-file seeds (solvable
 * pool, daily challenge, or special-event seeds).
 * @param {number} seed
 * @returns {boolean}
 */
export function isKnownSeed(seed) {
  return KNOWN_SEEDS.has(seed);
}

const U32 = 4294967296; // 2**32 — the full mulberry32 seed space.

/**
 * Generate a random 32-bit unsigned seed that is NOT in the reserved data-file
 * set nor in the supplied set of previously-dealt Random seeds.
 *
 * @param {Set<number>} [usedRandomSeeds]  previously dealt Random seeds that
 *   must also be avoided (persisted by the app). Defaults to an empty set.
 * @returns {number} a seed in [0, 2**32)
 * @throws {Error} if the entire 32-bit space is exhausted (practically never;
 *   the caller is expected to clear the used set long before this happens).
 */
export function randomUnusedSeed(usedRandomSeeds = new Set()) {
  let attempts = 0;
  let seed;
  do {
    if (++attempts > U32) {
      throw new Error('Random seed space exhausted (every 32-bit seed used).');
    }
    seed = Math.floor(Math.random() * U32);
  } while (KNOWN_SEEDS.has(seed) || usedRandomSeeds.has(seed));
  return seed;
}
