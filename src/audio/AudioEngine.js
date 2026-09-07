// audio/AudioEngine.js
// Singleton wrapper around a lazily-created AudioContext + master GainNode.
// All sfx in src/audio/sfx/* connect through audioEngine.masterGain rather
// than directly to ctx.destination so a single volume change applies to every
// effect, and so a future mute toggle can swap gain without rewiring each sfx.
//
// Browser policies gate AudioContext playback behind a user gesture: the
// context can be created any time, but its state is "suspended" until a click/
// pointerdown/keydown happens. unlock() is called from the earliest existing
// gesture handler in the app (see useDragEngine.js's pointerdown listener) so
// the context is warm by the time the first sfx fires.
//
// Never throws — even with no audio output device, with an OS-level mute, or
// in environments where AudioContext is absent entirely. Per the Web Audio
// spec, AudioContext construction and node graph wiring proceed normally in
// all of those cases; the audio simply never reaches the speakers.

let instance = null;

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this._volume = 0.7;
  }

  /**
   * Lazily create a single AudioContext and master gain. Idempotent: safe to
   * call repeatedly. Uses webkitAudioContext where the standard property is
   * missing (older Safari).
   */
  ensureContext() {
    if (this.ctx) {
      try {
        if (this.ctx.state === 'closed') return this;
      } catch {}
      return this;
    }
    try {
      const Ctor = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!Ctor) return this;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._volume;
      try {
        this.masterGain.connect(this.ctx.destination);
      } catch {}
    } catch {
      // AudioContext creation failed (extremely rare; e.g. some sandboxed
      // iframes). Leave ctx/masterGain null; every sfx that asks for the
      // destination will short-circuit on the null guard.
      this.ctx = null;
      this.masterGain = null;
    }
    return this;
  }

  /**
   * Resume the context if it is currently suspended. Called from the app's
   * first user-gesture entry point so a fresh AudioContext transitions to
   * "running" before any sfx tries to play. No-op if the context is missing
   * or already running, and never throws — the returned promise is best-
   * effort (rejection is swallowed).
   */
  unlock() {
    if (!this.ctx) this.ensureContext();
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
    } catch {}
  }

  /**
   * Set the master gain (0..1). Safe to call before ensureContext — the value
   * is cached and applied when the context is created. Out-of-range values are
   * clamped at the Web Audio level.
   * @param {number} v
   */
  setVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    this._volume = Math.max(0, Math.min(1, n));
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setValueAtTime(this._volume, this.ctx.currentTime);
      } catch {}
    }
  }

  /**
   * @returns {boolean} whether the audio graph is currently usable (context
   *   present + in 'running' state). Sfx callers may use this as a final guard,
   *   though every sfx also tolerates a null ctx/destination on its own.
   */
  isReady() {
    if (!this.ctx) return false;
    try { return this.ctx.state === 'running'; } catch { return false; }
  }
}

/**
 * Process-wide singleton. Imported as `audioEngine` by sfx/* and useSoundStore.
 */
export const audioEngine = new AudioEngine();