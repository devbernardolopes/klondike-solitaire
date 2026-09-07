// audio/index.js
// Single entry point for every gameplay sfx. Owns the shared white-noise
// buffer (allocated lazily on first stockDraw call) and routes every playSfx
// through the AudioEngine's master gain so a single volume change silences
// everything in one shot.
//
// Designed to be safe under all failure modes:
//   - No AudioContext support (older browser, restricted iframe, etc.):
//     playSfx no-ops via the audioEngine's null guards.
//   - AudioContext suspended (browser autoplay policy before any user
//     gesture): the first sfx attempts to call ctx.resume() inside unlock(),
//     which is invoked from the earliest gesture handler — but if a call
//     slips in before unlock() runs, the note still schedules (it just
//     won't be heard until the context resumes).
//   - OS-muted / no output device: Web Audio still constructs and runs the
//     node graph; the audio simply doesn't reach the speakers.
//   - Unknown sfx name: no-op + dev-only console.warn, never throws.
//
// No React/DOM imports — this module is safe to import from core/* if ever
// needed (currently only consumed from hooks/, components/, and stores/).

import { audioEngine } from './AudioEngine.js';
import { createNoiseBuffer } from './synth/noise.js';
import { useSoundStore } from '../store/useSoundStore.js';
import { cardMove } from './sfx/cardMove.js';
import { cardLand } from './sfx/cardLand.js';
import { invalidShake } from './sfx/invalidShake.js';
import { stockDraw } from './sfx/stockDraw.js';
import { deal } from './sfx/deal.js';
import { foundationLand } from './sfx/foundationLand.js';
import { winFanfare } from './sfx/winFanfare.js';

let noiseBuffer = null;

// Internal registry. Every key is the `name` argument of playSfx. Adding a
// new sfx: implement audio/sfx/<name>.js, import it above, and add an entry
// here. The order is alphabetical for easy scanning.
const REGISTRY = {
  cardMove,
  cardLand,
  invalidShake,
  stockDraw,
  deal,
  foundationLand,
  winFanfare,
};

function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  if (!ctx) return null;
  noiseBuffer = createNoiseBuffer(ctx, 0.3);
  return noiseBuffer;
}

function isSoundEnabled() {
  try {
    const state = useSoundStore.getState();
    if (state && typeof state.enabled === 'boolean') return state.enabled;
  } catch {}
  return true;
}

/**
 * Trigger a named sfx. Cheap to call — does NOT allocate per-call state; the
 * actual node graph is built on demand inside the underlying sfx function.
 * Safe to call from any code path that might fire during unmount.
 *
 * @param {string} name  one of the keys in REGISTRY
 * @param {object} [opts]  forwarded to the sfx function
 */
export function playSfx(name, opts) {
  if (!isSoundEnabled()) return;
  const fn = REGISTRY[name];
  if (!fn) {
    if (import.meta && import.meta.env && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[audio] unknown sfx: ${name}`);
    }
    return;
  }
  audioEngine.ensureContext();
  const ctx = audioEngine.ctx;
  const dest = audioEngine.masterGain;
  if (!ctx || !dest) return;
  try {
    if (name === 'stockDraw') {
      fn(ctx, dest, getNoiseBuffer(ctx), opts);
    } else {
      fn(ctx, dest, opts);
    }
  } catch {
    // Swallow — sfx must never break gameplay.
  }
}

export { audioEngine };