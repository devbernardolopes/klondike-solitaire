// audio/synth/noise.js
// White-noise buffer + bandpass-filtered playback. Used by the stock-draw sfx
// (paper-flick) and reusable from any other sfx that needs a non-pitched
// transient. The buffer is shared across all sfx (created once on first use
// in audio/index.js) so a fresh AudioBuffer is not allocated per click.

/**
 * Build a mono AudioBuffer filled with white noise samples in [-1, 1].
 * The returned buffer can be passed to AudioBufferSourceNode as many times
 * as desired; each play() spawns a new source node that consumes the same
 * underlying buffer without modifying it.
 * @param {AudioContext} ctx
 * @param {number} [durationSec=0.3]
 * @returns {AudioBuffer|null}
 */
export function createNoiseBuffer(ctx, durationSec = 0.3) {
  if (!ctx) return null;
  const dur = Math.max(0.01, Number(durationSec) || 0.3);
  let buf;
  try {
    buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  } catch {
    return null;
  }
  try {
    const channel = buf.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
  } catch {}
  return buf;
}

/**
 * Play a single noise burst through a bandpass BiquadFilter and an AD gain
 * envelope, into destinationNode. Safe to call with a null ctx / destination
 * — returns null without side-effects.
 *
 * @param {AudioContext} ctx
 * @param {AudioNode} destinationNode
 * @param {AudioBuffer|null} buffer  shared white-noise buffer
 * @param {{ playbackRate?: number, attack?: number, decay?: number, filterFreq?: number, filterType?: BiquadFilterType }} [opts]
 * @returns {AudioBufferSourceNode|null}
 */
export function playNoise(ctx, destinationNode, buffer, opts = {}) {
  if (!ctx || !destinationNode || !buffer) return null;
  const {
    playbackRate = 1,
    attack = 0.001,
    decay = 0.08,
    filterFreq = 4000,
    filterType = 'bandpass',
  } = opts;
  let src, gain, filt;
  try {
    src = ctx.createBufferSource();
    gain = ctx.createGain();
    filt = ctx.createBiquadFilter();
  } catch {
    return null;
  }
  try {
    src.buffer = buffer;
    try { src.playbackRate.setValueAtTime(playbackRate, ctx.currentTime); } catch {}
    try {
      filt.type = filterType;
      filt.frequency.setValueAtTime(filterFreq, ctx.currentTime);
    } catch {}
    applyEnvelopeLocal(gain, ctx, { attack, decay, peak: 1 });
    try { src.connect(filt); } catch {}
    try { filt.connect(gain); } catch {}
    try { gain.connect(destinationNode); } catch {}
    const a = Math.max(0, Number(attack) || 0);
    const d = Math.max(0.001, Number(decay) || 0.08);
    const stopAt = ctx.currentTime + a + d + 0.05;
    src.start(ctx.currentTime);
    src.stop(stopAt);
    try {
      src.onended = () => {
        try { src.disconnect(); } catch {}
        try { filt.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
      };
    } catch {}
  } catch {
    try { src.disconnect(); } catch {}
    try { gain.disconnect(); } catch {}
    try { filt.disconnect(); } catch {}
    return null;
  }
  return src;
}

// Local copy of the envelope to keep this module self-contained (the envelope
// helper is intentionally not re-exported from here to avoid an extra import
// site in callers).
function applyEnvelopeLocal(gainNode, ctx, { attack = 0.005, decay = 0.15, peak = 1 }) {
  const a = Math.max(0, Number(attack) || 0);
  const d = Math.max(0.001, Number(decay) || 0.15);
  const p = Math.max(0, Number(peak) || 0);
  const now = ctx.currentTime;
  try {
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(p, now + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
  } catch {}
}