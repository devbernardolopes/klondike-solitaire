import { db } from '../db/schema.js';
import { supabase } from '../lib/supabaseClient.js';
import { ACHIEVEMENT_PLACEHOLDER } from './achievementImage.js';

const memoryCache = new Map();
const failedPaths = new Set();
const pendingPaths = new Map();

function publicUrlFor(imagePath) {
  if (!imagePath || !supabase) return null;
  try {
    return supabase.storage.from('achievement-images').getPublicUrl(imagePath).data.publicUrl;
  } catch {
    return null;
  }
}

async function blobsEqual(a, b) {
  if (a.size !== b.size || a.type !== b.type) return false;
  try {
    const [ab, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    if (ab.byteLength !== bb.byteLength) return false;
    const av = new Uint8Array(ab);
    const bv = new Uint8Array(bb);
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function setMemoryUrl(imagePath, blob) {
  const prev = memoryCache.get(imagePath);
  const next = URL.createObjectURL(blob);
  memoryCache.set(imagePath, next);
  if (prev && prev !== next) {
    try { URL.revokeObjectURL(prev); } catch {}
  }
  return next;
}

export function getCachedAchievementBlobUrl(imagePath) {
  return memoryCache.get(imagePath) ?? null;
}

export function getAchievementImageUrlSync(imagePath) {
  if (imagePath && memoryCache.has(imagePath)) return memoryCache.get(imagePath);
  const publicUrl = publicUrlFor(imagePath);
  if (publicUrl) return publicUrl;
  return ACHIEVEMENT_PLACEHOLDER;
}

export async function warmAchievementImageCache() {
  try {
    const rows = await db.achievementImageCache.toArray();
    for (const r of rows) {
      if (!r.imagePath || !r.blob || memoryCache.has(r.imagePath)) continue;
      try {
        memoryCache.set(r.imagePath, URL.createObjectURL(r.blob));
      } catch {}
    }
  } catch {}
}

export async function ensureAchievementImageCached(imagePath) {
  if (!imagePath) return;
  if (pendingPaths.has(imagePath)) return pendingPaths.get(imagePath);
  const job = runEnsure(imagePath);
  pendingPaths.set(imagePath, job);
  try {
    await job;
  } finally {
    pendingPaths.delete(imagePath);
  }
}

async function runEnsure(imagePath) {
  let cachedBlob = null;
  try {
    const row = await db.achievementImageCache.get(imagePath);
    if (row?.blob) {
      cachedBlob = row.blob;
      if (!memoryCache.has(imagePath)) {
        try { memoryCache.set(imagePath, URL.createObjectURL(cachedBlob)); } catch {}
      }
    }
  } catch {}
  if (failedPaths.has(imagePath)) return;
  const publicUrl = publicUrlFor(imagePath);
  if (!publicUrl) return;
  try {
    const res = await fetch(publicUrl);
    if (!res.ok) {
      failedPaths.add(imagePath);
      return;
    }
    const blob = await res.blob();
    if (cachedBlob && await blobsEqual(cachedBlob, blob)) return;
    try {
      await db.achievementImageCache.put({ imagePath, blob, updatedAt: Date.now() });
    } catch {}
    try { setMemoryUrl(imagePath, blob); } catch {}
  } catch {
    failedPaths.add(imagePath);
  }
}

export function clearAchievementImageCache() {
  for (const url of memoryCache.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  memoryCache.clear();
  failedPaths.clear();
}
