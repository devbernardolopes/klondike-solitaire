// core/solvablePool.js
// Framework-agnostic. No React / DOM / Node-fs imports allowed in this file —
// it ships to the browser and imports the pre-generated pool JSON directly.

import solvableSeeds from '../data/solvableSeeds.json' with { type: 'json' };

/** The full pre-verified solvable seed pool (bundled fallback). @type {number[]} */
export const SOLVABLE_SEEDS = solvableSeeds;

/**
 * Whether a seed is part of the pre-verified solvable pool (i.e. a valid
 * Winning-Deal seed the user can request directly).
 * @param {number} seed
 * @param {number[]} [pool]  pool to check; defaults to bundled fallback
 * @returns {boolean}
 */
export function isSolvableSeed(seed, pool = SOLVABLE_SEEDS) {
  return pool.includes(seed);
}

/**
 * Pick a random seed from the pre-verified solvable pool.
 * @param {number[]} [pool]  pool to pick from; defaults to bundled fallback
 * @returns {number}
 */
export function randomSolvableSeed(pool = SOLVABLE_SEEDS) {
  const src = pool && pool.length ? pool : solvableSeeds;
  const i = Math.floor(Math.random() * src.length);
  return src[i];
}

/**
 * Pick a seed while excluding already-used ones.
 * @param {number[]} [exclude] seeds that must not be returned
 * @param {number[]} [pool] pool to pick from; defaults to bundled fallback
 * @returns {{ seed: number, exhausted: boolean }}
 *   `exhausted` is true when every pool seed was excluded (caller should clear
 *   its exclusion set); in that case a seed is still returned from the full pool
 *   so play can continue.
 */
export function pickSolvableSeed(exclude = [], pool = SOLVABLE_SEEDS) {
  const src = pool && pool.length ? pool : SOLVABLE_SEEDS;
  const blocked = new Set(exclude);
  const available = src.filter((s) => !blocked.has(s));
  if (available.length === 0) {
    const i = Math.floor(Math.random() * src.length);
    return { seed: src[i], exhausted: true };
  }
  const i = Math.floor(Math.random() * available.length);
  return { seed: available[i], exhausted: false };
}
