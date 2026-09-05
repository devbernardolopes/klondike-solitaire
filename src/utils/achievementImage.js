// utils/achievementImage.js
// Resolves the display image for an achievement. Centralizes the logic that was
// duplicated across AchievementsModal and the achievement toast bridge: a
// non-empty image_path resolves (when Supabase is configured) to the public URL
// in the `achievement-images` bucket; everything else falls back to a local
// placeholder asset so missing/broken images never render blank. A broken
// Supabase URL (404 / offline) still returns a URL here, so consumers must also
// handle <img onError> by swapping to ACHIEVEMENT_PLACEHOLDER.

import { supabase } from '../lib/supabaseClient.js';

export const ACHIEVEMENT_PLACEHOLDER = '/achievement_placeholder.jpg';

const pendingImages = new Map();
const completedImages = new Map();

/**
 * Resolve an achievement's image URL, falling back to the local placeholder.
 * @param {string|null|undefined} imagePath
 * @returns {string}
 */
export function achievementImageUrl(imagePath) {
  if (typeof imagePath === 'string' && /^https?:\/\//i.test(imagePath)) return imagePath;
  if (imagePath && supabase) {
    return supabase.storage.from('achievement-images').getPublicUrl(imagePath).data.publicUrl;
  }
  return ACHIEVEMENT_PLACEHOLDER;
}

/** Resolve once the current image is loadable; failures use the placeholder. */
export function preloadAchievementImage(url) {
  if (!url || url === ACHIEVEMENT_PLACEHOLDER || typeof Image === 'undefined') return Promise.resolve(url || ACHIEVEMENT_PLACEHOLDER);
  if (completedImages.has(url)) return Promise.resolve(completedImages.get(url));
  if (pendingImages.has(url)) return pendingImages.get(url);
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      completedImages.set(url, url);
      resolve(url);
    };
    image.onerror = () => {
      completedImages.set(url, ACHIEVEMENT_PLACEHOLDER);
      resolve(ACHIEVEMENT_PLACEHOLDER);
    };
    image.src = url;
  }).finally(() => pendingImages.delete(url));
  pendingImages.set(url, promise);
  return promise;
}

export function clearAchievementImagePreloads() {
  pendingImages.clear();
  completedImages.clear();
}

export function getCachedAchievementImageUrl(url) {
  return completedImages.get(url) ?? null;
}

/**
 * Swap a broken <img> to the placeholder exactly once. Attach to onError so a
 * 404'd Supabase URL degrades gracefully without looping.
 * @param {React.SyntheticEvent<HTMLImageElement>} e
 */
export function onAchievementImageError(e) {
  const el = e.currentTarget;
  el.onerror = null;
  el.src = ACHIEVEMENT_PLACEHOLDER;
}
