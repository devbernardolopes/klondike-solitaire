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

/**
 * Resolve an achievement's image URL, falling back to the local placeholder.
 * @param {string|null|undefined} imagePath
 * @returns {string}
 */
export function achievementImageUrl(imagePath) {
  if (imagePath && supabase) {
    return supabase.storage.from('achievement-images').getPublicUrl(imagePath).data.publicUrl;
  }
  return ACHIEVEMENT_PLACEHOLDER;
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
