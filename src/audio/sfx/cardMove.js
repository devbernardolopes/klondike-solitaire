// audio/sfx/cardMove.js
// Short triangle-wave blip for any in-flight card relocation (manual tap,
// drag-drop, auto-move, auto-complete step). Pitch drifts slightly upward
// with `speedFactor` so a snappier move reads as snappier — `speedFactor`
// maps to detune in cents (~50 cents per 1.0 of speedFactor above 1).

import { playTone } from '../synth/tone.js';

const BASE_FREQ = 600;
const JITTER_HZ = 40;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {{ speedFactor?: number }} [opts]
 */
export function cardMove(ctx, dest, { speedFactor = 1 } = {}) {
  if (!ctx || !dest) return;
  // Random per-call pitch jitter for natural variation. ±40Hz around BASE_FREQ.
  const jitter = (Math.random() * 2 - 1) * JITTER_HZ;
  // Detune scales with speedFactor: a factor of 1 → 0 cents, 1.5 → +50 cents,
  // 0.5 → -50 cents. Capped to ±200 cents so an extreme speedFactor can't
  // produce a wildly different note.
  const detuneCents = Math.max(-200, Math.min(200, (speedFactor - 1) * 100));
  playTone(ctx, dest, {
    freq: BASE_FREQ + jitter,
    detune: detuneCents,
    type: 'triangle',
    attack: 0.005,
    decay: 0.08,
    peak: 0.6,
    filterFreq: 3000,
  });
}