import { supabase } from '../lib/supabaseClient.js';
import { getEventImageUrlSync } from './eventImageCache.js';

export const EVENT_IMAGE_PLACEHOLDER = '/event_placeholder.jpg';

export function eventImageUrl(imagePath) {
  return getEventImageUrlSync(imagePath);
}

export function onEventImageError(e) {
  const el = e.currentTarget;
  el.onerror = null;
  el.src = EVENT_IMAGE_PLACEHOLDER;
}
