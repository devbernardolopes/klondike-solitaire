// toast/achievementToastBridge.js
// Connects the achievement-unlock signal (useAchievementEventsStore, fed by the
// offline-first sync queue) to the toast UI (useToastStore). For each newly
// unlocked id it resolves the achievement's display name + image URL (cached for
// the session) and pushes a toast.
//
// TIMING REALITY (same as useAchievementEventsStore): this fires via the sync
// queue, so it can arrive well after the win itself — on a later boot or only
// after reconnect. The toast is confirming an award, NOT celebrating a live
// moment; copy must not imply "just now".

import { supabase } from '../lib/supabaseClient.js';
import { useAchievementEventsStore } from '../hooks/useAchievementEventsStore.js';
import { useToastStore, TOAST_PRIORITY } from '../hooks/useToastStore.js';
import { achievementImageUrl, preloadAchievementImage, clearAchievementImagePreloads } from '../utils/achievementImage.js';
import { translateAchievement } from '../i18n/db.js';

// Session cache so the same id is never looked up twice.
const cache = new Map();
let generation = 0;

/**
 * Resolve an achievement id to its display name + description + image URL.
 * @param {string} id
 * @returns {Promise<{ name: string, description: string, image: string|null }>}
 */
async function resolve(id) {
  const cached = cache.get(id);
  if (cached) return cached;

  let result = { name: id, description: '', image: null };
  if (supabase) {
    try {
      const { data } = await supabase
        .from('achievements_definitions')
        .select('name, description, image_path')
        .eq('id', id)
        .single();
      if (data) {
          const image = achievementImageUrl(data.image_path);
        const translated = translateAchievement({ id, name: data.name || id, description: data.description || '' });
        result = { name: translated.name, description: translated.description, image };
      }
    } catch {
      // Leave the id-based fallback name if the lookup fails.
    }
  }
  cache.set(id, result);
  return result;
}

/** Drain and dispatch any queued unlock batches as toasts. */
function process() {
  const batches = useAchievementEventsStore.getState().consume();
  if (!batches.length) return;
  for (const batch of batches) {
    for (const id of batch.ids) {
      const activeGeneration = generation;
      resolve(id).then(async ({ name, description, image }) => {
        const readyImage = await preloadAchievementImage(image);
        if (activeGeneration !== generation) return;
        useToastStore.getState().push({ name, description, image: readyImage, priority: TOAST_PRIORITY.DEFAULT });
      });
    }
  }
}

export function clearAchievementToastCache() {
  generation++;
  cache.clear();
  clearAchievementImagePreloads();
}

let started = false;

/**
 * Subscribe the toast UI to achievement-unlock events. Idempotent (StrictMode-
 * safe): repeated calls return the original unsubscribe. Call once at boot.
 * @returns {() => void} unsubscribe
 */
export function initAchievementToastBridge() {
  if (started) return () => {};
  started = true;

  // Drain anything already queued before this subscription was attached.
  process();

  const unsub = useAchievementEventsStore.subscribe(() => process());

  return () => {
    unsub();
    started = false;
  };
}
