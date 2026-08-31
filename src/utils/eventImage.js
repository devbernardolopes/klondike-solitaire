import { supabase } from '../lib/supabaseClient.js';

export const EVENT_IMAGE_PLACEHOLDER = '/event_placeholder.jpg';

export function eventImageUrl(imagePath) {
  if (imagePath && supabase) {
    return supabase.storage.from('event-images').getPublicUrl(imagePath).data.publicUrl;
  }
  return EVENT_IMAGE_PLACEHOLDER;
}

export function onEventImageError(e) {
  const el = e.currentTarget;
  el.onerror = null;
  el.src = EVENT_IMAGE_PLACEHOLDER;
}
