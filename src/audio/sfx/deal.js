// audio/sfx/deal.js
// Fires `count` short blips at ~50ms apart to sonically mirror the initial
// deal animation. The blip itself is a low-pass-filtered triangle wave so it
// reads as a soft "thwip" rather than the brighter in-flight move blip. A
// large `count` (the default 28 cards in a Klondike deal) is fine — each
// blip is scheduled via setTimeout and runs on the Web Audio clock, so the
// scheduling cost is O(count) one-time setTimeouts, not O(count) audio nodes
// kept alive.

import { playTone } from '../synth/tone.js';

const STEP_MS = 50;
const BASE_FREQ = 380;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {{ count?: number }} [opts]
 */
export function deal(ctx, dest, { count = 28 } = {}) {
  if (!ctx || !dest) return;
  const n = Math.max(0, Math.min(60, Math.floor(Number(count) || 0)));
  for (let i = 0; i < n; i++) {
    const delayMs = i * STEP_MS;
    setTimeout(() => {
      try {
        playTone(ctx, dest, {
          // Subtle upward pitch drift so the deal sounds like it accelerates
          // very slightly toward the end — purely cosmetic, ±30Hz max.
          freq: BASE_FREQ + (i * 1.2) + (Math.random() * 2 - 1) * 6,
          type: 'triangle',
          attack: 0.004,
          decay: 0.06,
          peak: 0.45,
          filterFreq: 2400,
        });
      } catch {}
    }, delayMs);
  }
}