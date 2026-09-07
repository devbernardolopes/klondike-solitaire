// audio/synth/tone.js
// Pure oscillator + gain stage. Used by every pitched sfx (cardMove, cardLand,
// foundationLand, invalidShake, winFanfare). Connects through the caller's
// destinationNode — never ctx.destination directly — so the AudioEngine master
// gain sits in the graph and a single volume change silences everything.

import { applyEnvelope } from './envelope.js';

/**
 * Play a short oscillator tone with an attack/decay envelope. Routes through an
 * optional lowpass BiquadFilterNode first (when filterFreq is provided), then
 * through an envelope-controlled GainNode, finally into destinationNode.
 *
 * The oscillator auto-stops after `attack + decay + 0.05` seconds so the node
 * does not leak past its audible window. The function returns immediately —
 * the audio runs on the Web Audio clock and never blocks the caller.
 *
 * @param {AudioContext} ctx
 * @param {AudioNode} destinationNode  destination for the final gain stage
 *   (typically audioEngine.masterGain). May be null; the call is a no-op.
 * @param {{
 *   freq?: number,
 *   detune?: number,
 *   type?: OscillatorType,
 *   attack?: number,
 *   decay?: number,
 *   peak?: number,
 *   filterFreq?: number,
 * }} [opts]
 * @returns {OscillatorNode|null}
 */
export function playTone(ctx, destinationNode, opts = {}) {
  if (!ctx || !destinationNode) return null;
  const {
    freq = 440,
    detune = 0,
    type = 'sine',
    attack,
    decay,
    peak,
    filterFreq,
  } = opts;
  let osc;
  let gain;
  try {
    osc = ctx.createOscillator();
    gain = ctx.createGain();
  } catch {
    return null;
  }
  try {
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (detune) {
      try { osc.detune.setValueAtTime(detune, ctx.currentTime); } catch {}
    }
    applyEnvelope(gain, ctx, { attack, decay, peak });
    let head = osc;
    if (typeof filterFreq === 'number' && Number.isFinite(filterFreq) && filterFreq > 0) {
      let filt;
      try { filt = ctx.createBiquadFilter(); } catch { filt = null; }
      if (filt) {
        try {
          filt.type = 'lowpass';
          filt.frequency.setValueAtTime(filterFreq, ctx.currentTime);
          osc.connect(filt);
          filt.connect(gain);
          head = filt;
        } catch {
          try { osc.connect(gain); head = osc; } catch {}
        }
      } else {
        try { osc.connect(gain); head = osc; } catch {}
      }
    } else {
      try { osc.connect(gain); } catch {}
    }
    try { gain.connect(destinationNode); } catch {}
    const a = Math.max(0, Number(attack) || 0);
    const d = Math.max(0.001, Number(decay) || 0.15);
    const stopAt = ctx.currentTime + a + d + 0.05;
    osc.start(ctx.currentTime);
    osc.stop(stopAt);
    // GC hygiene: disconnect once the oscillator has ended so the node graph
    // does not retain references after the sound has finished.
    try {
      osc.onended = () => {
        try { osc.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
        if (head && head !== osc) { try { head.disconnect(); } catch {} }
      };
    } catch {}
  } catch {
    try { osc.disconnect(); } catch {}
    try { gain.disconnect(); } catch {}
    return null;
  }
  return osc;
}