import { db } from '../db/schema.js';
import { supabase } from '../lib/supabaseClient.js';

const memoryCache = new Map();

export function getCachedImageUrl(imagePath) {
  return memoryCache.get(imagePath) ?? null;
}

export function getEventImageUrlSync(imagePath) {
  if (imagePath && memoryCache.has(imagePath)) return memoryCache.get(imagePath);
  if (imagePath && supabase) return supabase.storage.from('event-images').getPublicUrl(imagePath).data.publicUrl;
  return '/event_placeholder.jpg';
}

export async function warmImageCache() {
  try {
    const rows = await db.eventImageCache.toArray();
    for (const r of rows) {
      if (!r.imagePath || !r.blob || memoryCache.has(r.imagePath)) continue;
      const url = URL.createObjectURL(r.blob);
      memoryCache.set(r.imagePath, url);
    }
  } catch {}
}

const failedPaths = new Set();

export async function ensureImageCached(imagePath) {
  if (!imagePath) return;
  if (memoryCache.has(imagePath) || failedPaths.has(imagePath)) return;
  try {
    const row = await db.eventImageCache.get(imagePath);
    if (row?.blob) {
      if (!memoryCache.has(imagePath)) {
        memoryCache.set(imagePath, URL.createObjectURL(row.blob));
      }
      return;
    }
  } catch {}
  if (!supabase) return;
  try {
    const publicUrl = supabase.storage.from('event-images').getPublicUrl(imagePath).data.publicUrl;
    const res = await fetch(publicUrl);
    if (!res.ok) {
      failedPaths.add(imagePath);
      return;
    }
    const blob = await res.blob();
    await db.eventImageCache.put({ imagePath, blob, updatedAt: Date.now() });
    if (!memoryCache.has(imagePath)) {
      memoryCache.set(imagePath, URL.createObjectURL(blob));
    }
  } catch {
    failedPaths.add(imagePath);
  }
}
