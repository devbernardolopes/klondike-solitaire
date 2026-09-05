import { db } from '../db/schema.js';
import { supabase } from '../lib/supabaseClient.js';

const catalogMemory = new Map();

export function getCachedAchievementsSync() {
  const values = [...catalogMemory.values()];
  return values.length ? values : null;
}

export async function hydrateAchievementCache() {
  try {
    const rows = await db.achievementCatalogCache.toArray();
    catalogMemory.clear();
    for (const row of rows) {
      if (row.definition?.id) catalogMemory.set(row.definition.id, row.definition);
    }
  } catch {}
  return getCachedAchievementsSync();
}

export async function fetchAchievements() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('achievements_definitions')
    .select('id, name, description, image_path, sort_order')
    .eq('enabled', true)
    .order('sort_order');
  if (error || !data) throw error || new Error('Unable to load achievements');

  const definitions = data;
  const ids = new Set(definitions.map((definition) => definition.id));
  catalogMemory.clear();
  for (const definition of definitions) catalogMemory.set(definition.id, definition);
  try {
    await db.transaction('rw', db.achievementCatalogCache, async () => {
      await db.achievementCatalogCache.clear();
      await db.achievementCatalogCache.bulkPut(
        definitions.map((definition) => ({ id: definition.id, definition, updatedAt: Date.now() })),
      );
    });
  } catch {}
  return definitions.filter((definition) => ids.has(definition.id));
}

export function clearAchievementMemory() {
  catalogMemory.clear();
}

export async function clearAchievementCache() {
  clearAchievementMemory();
  try {
    await db.achievementCatalogCache.clear();
    await db.achievementImageCache.clear();
  } catch {}
}