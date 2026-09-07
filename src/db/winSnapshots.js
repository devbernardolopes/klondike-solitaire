import { db } from './schema.js';

export async function saveWinSnapshot(snapshot) {
  await db.winSnapshots.put(snapshot);
}

export async function getWinSnapshot(gameId) {
  if (gameId == null) return null;
  const row = await db.winSnapshots.get(gameId);
  return row || null;
}

export async function clearWinSnapshot(gameId) {
  if (gameId == null) return;
  await db.winSnapshots.delete(gameId);
}

export async function clearWinSnapshots() {
  await db.winSnapshots.clear();
}
