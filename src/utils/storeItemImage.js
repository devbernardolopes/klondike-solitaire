// utils/storeItemImage.js
// Resolves the display image for a store item. Mirrors utils/achievementImage.js:
// a non-empty image_path resolves (when Supabase is configured) to the public URL
// in the `store-item-images` bucket (created in migration 008); an empty path
// resolves to null so callers fall back to the theme-specific preview (e.g. the
// card-back registry) or plain text. A broken Supabase URL (404 / offline) still
// returns a URL here, so consumers must also handle <img onError>.

import { supabase } from '../lib/supabaseClient.js';

/**
 * Resolve a store item's image URL, or null when there is no image.
 * @param {string|null|undefined} imagePath
 * @returns {string|null}
 */
export function storeItemImageUrl(imagePath) {
  if (imagePath && supabase) {
    return supabase.storage.from('store-item-images').getPublicUrl(imagePath).data.publicUrl;
  }
  return null;
}

/**
 * Swap a broken <img> to a hidden state exactly once. Attach to onError so a
 * 404'd Supabase URL degrades gracefully without looping — callers then show
 * their theme-fallback preview or text instead.
 * @param {React.SyntheticEvent<HTMLImageElement>} e
 */
export function onStoreItemImageError(e) {
  const el = e.currentTarget;
  el.onerror = null;
  el.style.display = 'none';
}
