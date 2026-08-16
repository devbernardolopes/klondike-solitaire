// core/solvablePool.js
// Framework-agnostic. No React / DOM / Node-fs imports allowed in this file —
// it ships to the browser and imports the pre-generated pool JSON directly.

import solvableSeeds from '../data/solvableSeeds.json';

/**
 * Pick a random seed from the pre-verified solvable pool.
 * @returns {number}
 */
export function randomSolvableSeed() {
  const i = Math.floor(Math.random() * solvableSeeds.length);
  return solvableSeeds[i];
}
