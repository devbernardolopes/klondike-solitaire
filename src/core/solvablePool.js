// core/solvablePool.js
// Framework-agnostic. No React / DOM / Node-fs imports allowed in this file —
// it ships to the browser and imports the pre-generated pool JSON directly.

import solvableSeeds from '../data/solvableSeeds.json';

/** The full pre-verified solvable seed pool. @type {number[]} */
export const SOLVABLE_SEEDS = solvableSeeds;

/**
 * Pick a random seed from the pre-verified solvable pool.
 * @returns {number}
 */
export function randomSolvableSeed() {
  const i = Math.floor(Math.random() * solvableSeeds.length);
  return solvableSeeds[i];
}

/**
 * Pick a seed while excluding already-used ones.
 * @param {number[]} [exclude] seeds that must not be returned
 * @returns {{ seed: number, exhausted: boolean }}
 *   `exhausted` is true when every pool seed was excluded (caller should clear
 *   its exclusion set); in that case a seed is still returned from the full pool
 *   so play can continue.
 */
export function pickSolvableSeed(exclude = []) {
  const blocked = new Set(exclude);
  const available = SOLVABLE_SEEDS.filter((s) => !blocked.has(s));
  if (available.length === 0) {
    const i = Math.floor(Math.random() * SOLVABLE_SEEDS.length);
    return { seed: SOLVABLE_SEEDS[i], exhausted: true };
  }
  const i = Math.floor(Math.random() * available.length);
  return { seed: available[i], exhausted: false };
}
