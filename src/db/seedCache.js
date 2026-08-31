import { db } from './schema.js';

export async function getSeedCache(key) {
  const row = await db.seedCache.get(key);
  return row || null;
}

export async function setSeedCache(key, value) {
  await db.seedCache.put({ key, value, fetchedAt: Date.now() });
}

export async function clearSeedCache() {
  await db.seedCache.clear();
}
