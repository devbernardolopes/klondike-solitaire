// audio/sfx/winFanfare.js
// 4-note ascending arpeggio (C5 E5 G5 C6) with a brighter lowpass so it reads
// as a celebration rather than a move. Each note fires 120ms apart; moderate
// decay lets the notes overlap slightly into a small chord at the tail.

import { playTone } from '../synth/tone.js';

const NOTES_HZ = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
const STEP_MS = 120;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 */
export function winFanfare(ctx, dest) {
  if (!ctx || !dest) return;
  for (let i = 0; i < NOTES_HZ.length; i++) {
    const delayMs = i * STEP_MS;
    setTimeout(() => {
      try {
        playTone(ctx, dest, {
          freq: NOTES_HZ[i],
          type: 'sine',
          attack: 0.005,
          decay: 0.4,
          peak: 0.55,
          filterFreq: 6000,
        });
      } catch {}
    }, delayMs);
  }
}