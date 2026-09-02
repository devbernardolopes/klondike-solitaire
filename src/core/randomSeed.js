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

// Reserved seeds that must never appear as a Random Shuffle deal: the bundled
// solvable pool (Winning Deal seeds) and the pre-generated daily challenge
// seeds. Special-event seeds are excluded at runtime via buildKnownSet() —
// they are fetched live from Supabase (repo/specialEventsRepository.js) and
// passed in explicitly, so they don't need a static fallback here.
const FALLBACK_KNOWN_SEEDS = (() => {
  const s = new Set();
  for (const x of SOLVABLE_SEEDS) s.add(x);
  const dailySeeds = (dailyData && dailyData.seeds) || {};
  for (const k of Object.keys(dailySeeds)) {
    const v = dailySeeds[k];
    if (typeof v === 'number') s.add(v);
  }
  return s;
})();

const KNOWN_SEEDS = FALLBACK_KNOWN_SEEDS;

export function buildKnownSet({ winningPool, dailyMap, events } = {}) {
  const s = new Set();
  const w = winningPool || SOLVABLE_SEEDS;
  for (const x of w) s.add(x);
  const dm = dailyMap || (dailyData && dailyData.seeds) || {};
  for (const k of Object.keys(dm)) {
    const v = dm[k];
    if (typeof v === 'number') s.add(v);
  }
  const evs = events || [];
  for (const ev of evs) {
    for (const sd of ev.seeds || []) s.add(sd);
  }
  return s;
}

/** Number of permanently reserved (data-file) seeds. @returns {number} */
export function knownSeedCount(knownSet = null) {
  return knownSet ? knownSet.size : KNOWN_SEEDS.size;
}

/**
 * Whether a seed is one of the permanently reserved data-file seeds (solvable
 * pool, daily challenge, or special-event seeds).
 * @param {number} seed
 * @param {Set<number>} [knownSet]
 * @returns {boolean}
 */
export function isKnownSeed(seed, knownSet = null) {
  return knownSet ? knownSet.has(seed) : KNOWN_SEEDS.has(seed);
}

const U32 = 4294967296; // 2**32 — the full mulberry32 seed space.

/**
 * Generate a random 32-bit unsigned seed that is NOT in the reserved data-file
 * set nor in the supplied set of previously-dealt Random seeds.
 *
 * @param {Set<number>} [usedRandomSeeds]  previously dealt Random seeds that
 *   must also be avoided (persisted by the app). Defaults to an empty set.
 * @param {Set<number>} [knownSet]  reserved seeds to avoid; defaults to bundled fallback
 * @returns {number} a seed in [0, 2**32)
 * @throws {Error} if the entire 32-bit space is exhausted (practically never;
 *   the caller is expected to clear the used set long before this happens).
 */
export function randomUnusedSeed(usedRandomSeeds = new Set(), knownSet = null) {
  const reserved = knownSet || KNOWN_SEEDS;
  let attempts = 0;
  let seed;
  do {
    if (++attempts > U32) {
      throw new Error('Random seed space exhausted (every 32-bit seed used).');
    }
    seed = Math.floor(Math.random() * U32);
  } while (reserved.has(seed) || usedRandomSeeds.has(seed));
  return seed;
}
