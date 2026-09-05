// sync/factoryReset.js
// Shared Factory Reset implementation: the active flow (Advanced modal wipes
// this device + the server) and the passive flow (other devices on the same
// account notice the remote wipe and clear their own stale Dexie caches).
//
// Cross-device protocol: factory_reset() stamps profiles.factory_reset_at.
// Every client remembers the newest marker it has applied in the preserved
// `settings` table (LAST_APPLIED_KEY — never wiped). Profile pulls and
// Special Events fetches compare the remote marker first; when it is newer
// than the remembered one, the full local user-data wipe runs here too, so
// the server stays the authority everywhere.
//
// NOTE on imports: specialEventsRepository.js imports maybeApplyRemoteReset
// from this module, and this module imports clearEventCatalogMemory from
// there. The cycle is safe — both are called only at runtime, never during
// module evaluation.

import { supabase } from '../lib/supabaseClient.js';
import { db, getSetting, setSetting } from '../db/schema.js';
import { resetStats } from '../db/stats.js';
import { savePlayedSeeds } from '../db/playedSeeds.js';
import { clearUsedRandomSeeds } from '../db/usedRandomSeeds.js';
import { clearSeedCache } from '../db/seedCache.js';
import { clearActiveSession } from '../db/activeSession.js';
import { clearQueuedOps } from '../db/syncQueue.js';
import { clearAllSeenDissolve } from '../db/eventDissolveSeen.js';
import { cancelAllSolves } from '../core/solverClient.js';
import { clearEventCatalogMemory } from '../repo/specialEventsRepository.js';

// The Zustand stores, win-cascade cancel, sync engine, and session device id
// are imported lazily (inside the functions that need them): they pull a
// JSON/i18n chain that plain node --test cannot load, and only real
// reset paths (browser/Vite handles the JSON fine) ever resolve them.

export const LAST_APPLIED_RESET_KEY = 'lastAppliedFactoryResetAt';

// localStorage keys that hold user progress (not display settings). Settings
// mirrors (klondike:theme, klondike:language, …) are deliberately preserved.
const LS_PROGRESS_PREFIXES = [
  'klondike:eventLastSelection:',
  'klondike:eventLastViewedPage:',
];
const LS_PROGRESS_KEYS = [
  'klondike:dailyLastSelection',
  'klondike:dissolveSeen',
];

export function clearProgressLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    for (const key of LS_PROGRESS_KEYS) localStorage.removeItem(key);
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && LS_PROGRESS_PREFIXES.some((p) => k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage may be unavailable; Dexie remains the source of truth */
  }
}

export async function cancelOngoingDeal() {
  try {
    cancelAllSolves();
  } catch {}
  try {
    const { cancelWinCascade } = await import('../render/animation/winCascade.js');
    cancelWinCascade();
  } catch {}
  try {
    const { useUiStore } = await import('../hooks/useUiStore.js');
    const ui = useUiStore.getState();
    ui.clearAllTransitions();
    ui.closeWinDialog();
    ui.setNoMovesDialogOpen(false);
    ui.setGameOverDialogOpen(false);
    ui.clearHints();
    ui.dismissNoHintsBanner();
  } catch {}
}

/**
 * Wipe every local user-data store. The `settings` table (language, theme,
 * deck, …) is preserved except the seen-badge keys, which reference wiped
 * owned items / achievements.
 */
export async function wipeLocalUserData() {
  // Drop the offline outbox first so stale ops can't re-push wiped state.
  await clearQueuedOps();
  await resetStats();
  await savePlayedSeeds([]);
  await db.dailyResults.clear();
  await clearUsedRandomSeeds();
  await clearSeedCache();
  await db.eventCatalogCache.clear();
  await db.eventImageCache.clear();
  await db.games.clear();
  try {
    clearEventCatalogMemory();
  } catch {}
  try {
    clearAllSeenDissolve();
  } catch {}
  // Seen badges reference wiped owned items / achievements; prefs stay.
  await setSetting('seenThemeItemIds', []);
  await setSetting('seenAchievementIds', []);
  clearProgressLocalStorage();
}

/** Re-read the wiped Dexie rows into the in-memory stores. */
export async function refreshInMemoryState() {
  const [{ useStatisticsStore }, { useSeedStore }, { useAuthStore }, { useSettingsStore }] = await Promise.all([
    import('../hooks/useStatisticsStore.js'),
    import('../hooks/useSeedStore.js'),
    import('../hooks/useAuthStore.js'),
    import('../hooks/useSettingsStore.js'),
  ]);
  await useStatisticsStore.getState().init();
  await useSeedStore.getState().init();
  // Wallet + ownership reflect the wiped server state; identity (display
  // name) is preserved and stays as-is.
  useAuthStore.setState({ coins: 0, coinsEarnedTotal: 0, coinsSpentTotal: 0, ownedItemIds: [] });
  try {
    useSettingsStore.getState().clearAchievementsSeen();
  } catch {}
  try {
    useSettingsStore.setState({ seenThemeItemIds: new Set() });
  } catch {}
  // Clear the saved session last (store inits above can re-save it via the
  // session-persistence subscriber) and mirror the delete remotely. The
  // shared dedupe key collapses any still-queued save behind this clear.
  await clearActiveSession();
  try {
    const [{ enqueue }, { getDeviceId }] = await Promise.all([
      import('./syncEngine.js'),
      import('./sessionPersistence.js'),
    ]);
    await enqueue('clear_game_session', { device_id: getDeviceId() }, 'game_session');
  } catch {
    /* deviceId not ready — local row already cleared */
  }
}

/** The newest reset marker this device has applied (null = none seen). */
export async function getLastAppliedResetAt() {
  try {
    return (await getSetting(LAST_APPLIED_RESET_KEY, null)) ?? null;
  } catch {
    return null;
  }
}

function markerTime(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Apply a remote reset marker: when it is newer than the remembered one,
 * run the full local wipe so this device converges to the wiped server
 * state. Idempotent — already-applied markers are no-ops.
 * @param {string|null} remoteIso
 * @returns {Promise<boolean>} true when a wipe was applied
 */
export async function applyResetMarker(remoteIso) {
  const remote = markerTime(remoteIso);
  if (remote == null) return false;
  const local = markerTime(await getLastAppliedResetAt());
  if (local != null && remote <= local) return false;
  await cancelOngoingDeal();
  await wipeLocalUserData();
  await refreshInMemoryState();
  try {
    await setSetting(LAST_APPLIED_RESET_KEY, remoteIso);
  } catch {}
  return true;
}

/** Read this account's reset marker from Supabase (null when unavailable). */
export async function fetchRemoteResetAt() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('factory_reset_at')
      .single();
    if (error || !data) return null;
    return data.factory_reset_at ?? null;
  } catch {
    return null;
  }
}

let markerCheckInFlight = null;

/**
 * Fetch the remote marker and self-wipe when it is newer than remembered.
 * Concurrent callers share one in-flight check. Never throws — resolution
 * failures simply skip the check so normal fetches proceed.
 * @returns {Promise<boolean>} true when a wipe was applied
 */
export function maybeApplyRemoteReset() {
  if (markerCheckInFlight) return markerCheckInFlight;
  markerCheckInFlight = (async () => {
    try {
      return await applyResetMarker(await fetchRemoteResetAt());
    } catch {
      return false;
    } finally {
      markerCheckInFlight = null;
    }
  })();
  return markerCheckInFlight;
}
