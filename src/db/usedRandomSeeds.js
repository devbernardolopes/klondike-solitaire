// db/usedRandomSeeds.js
// Persistence for the set of Random-Shuffle seeds that have already been dealt.
// A dedicated keyed Dexie table (one row per seed) keeps add/has O(1) and scales
// to very large sets; an in-memory Set mirror gives the synchronous reads the
// deal loop needs (no await on the hot path).
//
// This module is the single seam for Random-seed history. Its exported functions
// (init/add/is/get/clear) form a stable contract that can later be reimplemented
// against Supabase (scoped per useAuthStore.userId) without touching the core
// generator or the game store.

import { db } from './schema.js';

// In-memory mirror of every dealt Random seed, for synchronous lookups.
let usedSet = new Set();
let loaded = false;

/**
 * Load the persisted used-Random-seed set from Dexie. Safe to call once on mount
 * (before any Random deal). Idempotent.
 * @returns {Promise<void>}
 */
export async function initUsedRandomSeeds() {
  const rows = await db.usedRandomSeeds.toArray();
  usedSet = new Set(rows.map((r) => r.seed));
  loaded = true;
}

/** Whether the persisted set has been loaded into memory. */
export function usedRandomSeedsLoaded() {
  return loaded;
}

/**
 * Record a dealt Random seed. Updates the in-memory mirror synchronously (so a
 * re-deal in the same session can't repeat it) and persists to Dexie.
 * @param {number} seed
 */
export function addUsedRandomSeed(seed) {
  usedSet.add(seed);
  db.usedRandomSeeds.put({ seed }).catch((err) => {
    // Persistence is best-effort; the in-memory mirror is authoritative for the
    // current session. Surfacing in the console is enough for now.
    console.error('Failed to persist used Random seed', seed, err);
  });
}

/**
 * Whether a seed has already been dealt as a Random game.
 * @param {number} seed
 * @returns {boolean}
 */
export function isUsedRandomSeed(seed) {
  return usedSet.has(seed);
}

/**
 * The in-memory set of previously dealt Random seeds. Pass this to
 * core/randomSeed.js's `randomUnusedSeed` so generation excludes them.
 * @returns {Set<number>}
 */
export function getUsedRandomSeedsSet() {
  return usedSet;
}

/**
 * Clear the used-Random-seed history so every seed becomes available again.
 * Used as a last resort when the 32-bit space is exhausted.
 * @returns {Promise<void>}
 */
export async function clearUsedRandomSeeds() {
  usedSet = new Set();
  await db.usedRandomSeeds.clear();
}
