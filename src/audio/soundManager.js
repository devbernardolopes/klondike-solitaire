// audio/soundManager.js
// STUB: registers sound keys and makes play() a no-op console.log for now.
// Real Howler playback (loading actual sound files) is out of scope this pass.
//
// TODO(next pass): load Howl instances per key, respect a global mute setting
// from the settings store, and play actual buffers.

/** @type {Map<string, string>} sound key -> (future) file path */
const sounds = new Map();

/**
 * Register a sound key with its future asset path.
 * @param {string} key
 * @param {string} [path]
 */
export function registerSound(key, path) {
  sounds.set(key, path ?? `sounds/${key}.mp3`);
}

/**
 * Play a registered sound. No-op stub (logs) until real assets exist.
 * @param {string} key
 */
export function play(key) {
  if (!sounds.has(key)) {
    console.warn(`[soundManager] unknown sound key: ${key}`);
    return;
  }
  // TODO(next pass): replace with Howler playback.
  console.log(`[soundManager] play (stub): ${key}`);
}

/** Pre-register the keys the game will eventually use. */
['deal', 'flip', 'move', 'win', 'invalid'].forEach((k) => registerSound(k));
