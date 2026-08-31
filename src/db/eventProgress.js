import { db } from './schema.js';

export async function getEventProgress(eventId) {
  const row = await db.eventProgress.get(eventId);
  return row || { eventId, wonSeeds: [], wins: 0 };
}

export async function getAllEventProgress() {
  const rows = await db.eventProgress.toArray();
  const map = {};
  for (const r of rows) map[r.eventId] = r;
  return map;
}

export async function recordEventWin(eventId, seed) {
  const existing = await db.eventProgress.get(eventId);
  if (!existing) {
    const next = { eventId, wonSeeds: [seed], wins: 1 };
    await db.eventProgress.put(next);
    return next;
  }
  if (existing.wonSeeds.includes(seed)) return existing;
  const next = { eventId, wonSeeds: [...existing.wonSeeds, seed], wins: existing.wonSeeds.length + 1 };
  await db.eventProgress.put(next);
  return next;
}

export async function isEventSeedWon(eventId, seed) {
  const row = await db.eventProgress.get(eventId);
  return row ? row.wonSeeds.includes(seed) : false;
}

export async function clearEventProgress() {
  await db.eventProgress.clear();
}

export function revealThresholds(total) {
  if (total <= 3) return [1, 2, total];
  return [Math.ceil(total / 3), Math.ceil((total * 2) / 3), total];
}

export function revealedCount(wins, total) {
  const th = revealThresholds(total);
  let c = 0;
  for (const t of th) if (wins >= t) c++;
  return c;
}
