// store/useSoundStore.js
// Persisted sound preferences (enabled + volume) backed by the Dexie `settings`
// table (see db/schema.js). Mirrors the existing useSettingsStore persistence
// pattern (LS-as-sync-mirror for first paint + Dexie for cross-session source
// of truth) so the Settings UI toggle and volume slider render the saved
// value before Dexie's async init() resolves.
//
// `enabled` and `volume` are also exposed as plain getters from anywhere —
// audio/index.js reads `enabled` on every playSfx call so the toggle takes
// effect on the very next sfx (no need to bounce the AudioContext).
//
// `setVolume` additionally forwards to audioEngine.setVolume(v) so the live
// audio output reflects the slider without waiting for the next sfx to play.

import { create } from 'zustand';
import { getSetting, setSetting } from '../db/schema.js';
import { audioEngine } from '../audio/AudioEngine.js';

const LS_KEY_ENABLED = 'klondike:soundEnabled';
const LS_KEY_VOLUME = 'klondike:soundVolume';

const DEFAULTS = {
  enabled: true,
  volume: 0.75,
};

function readLSBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function readLSNumber(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

export const useSoundStore = create((set, get) => ({
  enabled: readLSBool(LS_KEY_ENABLED, DEFAULTS.enabled),
  volume: readLSNumber(LS_KEY_VOLUME, DEFAULTS.volume),
  loaded: false,

  /**
   * Load persisted values from Dexie. Safe to call once on app start;
   * missing keys fall back to DEFAULTS. The LS read above already seeded
   * the initial state, so this call mostly reconciles with the slower
   * IndexedDB read and flips `loaded: true`.
   */
  init: async () => {
    let enabled = DEFAULTS.enabled;
    let volume = DEFAULTS.volume;
    try {
      enabled = await getSetting('soundEnabled', DEFAULTS.enabled);
    } catch {}
    try {
      const v = await getSetting('soundVolume', DEFAULTS.volume);
      if (typeof v === 'number' && Number.isFinite(v)) {
        volume = Math.max(0, Math.min(1, v));
      }
    } catch {}
    writeLS(LS_KEY_ENABLED, enabled);
    writeLS(LS_KEY_VOLUME, volume);
    try {
      audioEngine.ensureContext();
      audioEngine.setVolume(volume);
    } catch {}
    set({ enabled, volume, loaded: true });
  },

  /**
   * Toggle the master sfx enabled flag. Persists to Dexie + LS immediately.
   * Audio playback reads `enabled` on every call (see audio/index.js), so
   * flipping this off takes effect on the very next playSfx without needing
   * to bounce the AudioContext.
   * @param {boolean} v
   */
  setEnabled: (v) => {
    const next = !!v;
    set({ enabled: next });
    setSetting('soundEnabled', next);
    writeLS(LS_KEY_ENABLED, next);
  },

  /**
   * Set the master volume (0..1). Persists to Dexie + LS and pushes the
   * new value to audioEngine so the change is audible immediately (no
   * wait for the next scheduled sfx).
   * @param {number} v
   */
  setVolume: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const next = Math.max(0, Math.min(1, n));
    set({ volume: next });
    setSetting('soundVolume', next);
    writeLS(LS_KEY_VOLUME, next);
    try {
      audioEngine.ensureContext();
      audioEngine.setVolume(next);
    } catch {}
  },
}));

// Selectors for direct reads (used by audio/index.js without subscribing).
export const selectSoundEnabled = (s) => s.enabled;
export const selectSoundVolume = (s) => s.volume;