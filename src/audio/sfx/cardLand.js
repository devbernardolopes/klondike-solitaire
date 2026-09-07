// audio/sfx/cardLand.js
// Lower-pitched, longer-tailed tone for the moment a card SETTLES into a
// tableau or waste pile. Distinct from cardMove so the ear reads the end of
// a slide as a distinct event rather than just the tail of the in-flight blip.

import { playTone } from '../synth/tone.js';

const BASE_FREQ = 320;
const JITTER_HZ = 25;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 */
export function cardLand(ctx, dest) {
  if (!ctx || !dest) return;
  const jitter = (Math.random() * 2 - 1) * JITTER_HZ;
  playTone(ctx, dest, {
    freq: BASE_FREQ + jitter,
    type: 'triangle',
    attack: 0.003,
    decay: 0.18,
    peak: 0.7,
    filterFreq: 2200,
  });
}