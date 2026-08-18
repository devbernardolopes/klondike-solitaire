// db/playedSeeds.js
// Persistence for the set of Winning-Deal seeds the user has *won*. A single
// keyed row in the Dexie `playedSeeds` table holds the array; exclusion logic
// and reset live in the store (src/hooks/useSeedStore.js) so reads/writes stay
// synchronous there. Intentionally separate from the `stats` table so a
// statistics reset cannot wipe played-seed history.

import { db } from './schema.js';

const KEY = 'won';

/**
 * @returns {Promise<number[]>} list of won Winning-Deal seeds
 */
export async function loadPlayedSeeds() {
  const row = await db.playedSeeds.get(KEY);
  return row && Array.isArray(row.seeds) ? row.seeds : [];
}

/**
 * Persist the full list of won seeds.
 * @param {number[]} seeds
 * @returns {Promise<void>}
 */
export async function savePlayedSeeds(seeds) {
  await db.playedSeeds.put({ key: KEY, seeds });
}
