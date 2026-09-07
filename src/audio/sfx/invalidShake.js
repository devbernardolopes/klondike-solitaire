// audio/sfx/invalidShake.js
// Three quick descending square-wave blips staggered ~0/90/180 ms to loosely
// mirror the GSAP shake animation's back-and-forth timing. Plays alongside
// the existing shake trigger — audio and animation are independent so a
// muted setting can't break either.

import { playTone } from '../synth/tone.js';

const BASE_FREQ = 180;
const STEP_MS = 90;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 */
export function invalidShake(ctx, dest) {
  if (!ctx || !dest) return;
  // Three descending blips: 180Hz → 150Hz → 120Hz, each shorter than the
  // previous so the cluster reads as a single "nope" gesture.
  const notes = [BASE_FREQ, BASE_FREQ - 30, BASE_FREQ - 60];
  for (let i = 0; i < notes.length; i++) {
    const delayMs = i * STEP_MS;
    setTimeout(() => {
      try {
        playTone(ctx, dest, {
          freq: notes[i],
          type: 'square',
          attack: 0.003,
          decay: 0.05,
          peak: 0.35,
          filterFreq: 1200,
        });
      } catch {}
    }, delayMs);
  }
}