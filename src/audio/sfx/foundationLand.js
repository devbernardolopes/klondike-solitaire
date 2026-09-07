// audio/sfx/foundationLand.js
// Brighter, higher-pitched variant of cardLand so a card landing on a
// foundation reads as a distinct "score!" moment vs. a plain tableau/waste
// landing. Sine wave + higher cutoff gives it a more "chime"-like tail.

import { playTone } from '../synth/tone.js';

const BASE_FREQ = 660;
const JITTER_HZ = 30;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 */
export function foundationLand(ctx, dest) {
  if (!ctx || !dest) return;
  const jitter = (Math.random() * 2 - 1) * JITTER_HZ;
  playTone(ctx, dest, {
    freq: BASE_FREQ + jitter,
    type: 'sine',
    attack: 0.004,
    decay: 0.22,
    peak: 0.65,
    filterFreq: 4500,
  });
}