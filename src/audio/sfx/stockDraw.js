// audio/sfx/stockDraw.js
// Paper-flick: a noise burst played slightly faster and bandpass-narrowed to
// around 2.5kHz so it reads as a quick "shff" rather than a generic hiss.
// Uses the shared white-noise buffer owned by audio/index.js.

import { playNoise } from '../synth/noise.js';

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {AudioBuffer|null} noiseBuffer
 */
export function stockDraw(ctx, dest, noiseBuffer) {
  if (!ctx || !dest) return;
  playNoise(ctx, dest, noiseBuffer, {
    playbackRate: 1.5,
    attack: 0.001,
    decay: 0.06,
    filterFreq: 2500,
    filterType: 'bandpass',
  });
}